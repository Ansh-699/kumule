import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'

// Demo mode is opt-in via env, never inferred from a missing key or a failed API call.
// Inferring it was the bug: every error path returned "payment COMPLETED", and mint.ts
// gates minting on exactly that, so any Coinbase outage handed out free NFTs.
export const paymentsDemoMode = (env: CloudflareBindings): boolean =>
    env.PAYMENTS_DEMO_MODE === 'true'

// Helper to log transaction to database
async function logTransaction(
    connectionString: string,
    chargeId: string,
    amount: number,
    currency: string,
    walletAddress?: string,
    network?: string
): Promise<void> {
    if (!connectionString) return
    
    try {
        await withPrisma(connectionString, async (prisma) => {
            // Get or create user
            let user = await prisma.user.findFirst({
                orderBy: { createdAt: 'desc' }
            })
            if (!user) {
                user = await prisma.user.create({ data: {} })
            }
            
            // Create pending transaction
            await prisma.transaction.create({
                data: {
                    transactionId: chargeId,
                    userId: user.id,
                    amount: amount,
                    transactionType: 'PAYMENT',
                    status: 'PENDING',
                    walletAddress: walletAddress || null,
                    txHash: null,
                    currency: currency,
                    network: network || null,
                    metadata: JSON.stringify({
                        source: 'charge_created',
                        createdAt: new Date().toISOString()
                    })
                } as any
            })
            console.log(`[Payment] Logged pending transaction: ${chargeId}`)
        })
    } catch (error) {
        console.error('[Payment] Failed to log transaction:', error)
        // Don't throw - logging failure shouldn't break the charge creation
    }
}

export const createCharge = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { amount, currency = 'USD', walletAddress } = await c.req.json()

        const connectionString = getConnectionString(c.env)
        
        // Helper function to return demo mode response
        const getDemoResponse = async (reason: string) => {
            const chargeId = `demo_charge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            const demoAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'

            console.log(`Using demo mode: ${reason}`)
            
            // Log the demo transaction
            if (connectionString) {
                await logTransaction(connectionString, chargeId, amount, currency, walletAddress, 'coinbase')
            }

            return c.json({
                chargeId: chargeId,
                address: demoAddress,
                amount: amount,
                currency: currency,
                hostedUrl: `https://commerce.coinbase.com/checkout/${chargeId}`,
                isDemoMode: true,
                note: `Demo mode (${reason}): This is a test payment. In production, configure a valid COINBASE_COMMERCE_API_KEY.`
            })
        }

        if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
            return c.json({ error: 'amount must be a positive number' }, 400)
        }

        const apiKey = c.env.COINBASE_COMMERCE_API_KEY
        const demo = paymentsDemoMode(c.env)

        if (!apiKey || apiKey.trim() === '') {
            if (demo) return await getDemoResponse('PAYMENTS_DEMO_MODE=true, no API key configured')
            // Fail closed: a charge nobody can pay must not look like a charge that was paid.
            return c.json({
                error: 'Payments are not configured. Set COINBASE_COMMERCE_API_KEY, or set PAYMENTS_DEMO_MODE=true for a non-production stub.'
            }, 503)
        }

        // Create a charge using Coinbase Commerce API
        const response = await fetch('https://api.commerce.coinbase.com/charges', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CC-Api-Key': apiKey,
                'X-CC-Version': '2018-03-22'
            },
            body: JSON.stringify({
                name: 'NFT Minting Payment',
                description: 'Payment for minting NFT on Solana',
                pricing_type: 'fixed_price',
                local_price: {
                    amount: amount.toString(),
                    currency: currency
                },
                metadata: {
                    purpose: 'nft_mint',
                    timestamp: Date.now()
                }
            })
        })

        if (!response.ok) {
            const errorText = await response.text()

            // A rejected API key is a misconfiguration, not a licence to fake a charge.
            if (errorText.includes('authentication_error') || errorText.includes('no_such_api_key')) {
                if (demo) return await getDemoResponse('PAYMENTS_DEMO_MODE=true, API key rejected')
                return c.json({ error: 'Coinbase rejected the configured API key.' }, 503)
            }

            throw new Error(`Commerce API error: ${errorText}`)
        }

        const data = await response.json() as any
        const charge = data.data
        
        // Log the transaction to database
        if (connectionString) {
            await logTransaction(connectionString, charge.id, amount, currency, walletAddress, 'coinbase')
        }

        return c.json({
            chargeId: charge.id,
            code: charge.code,
            hostedUrl: charge.hosted_url,
            addresses: charge.addresses,
            pricing: charge.pricing,
            amount: amount,
            currency: currency,
            expiresAt: charge.expires_at,
            isDemoMode: false
        })

    } catch (error) {
        console.error('Create charge error:', error)
        // Previously returned a fake "paid" charge with HTTP 200 here, which is how an
        // upstream outage turned into free mints. Surface the failure instead.
        return c.json({ error: 'Failed to create charge', details: String(error) }, 502)
    }
}

// Anything that is not a verified COMPLETED charge reports UNVERIFIED. Callers gate on
// COMPLETED, so an unknown or unreachable charge denies value instead of granting it.
type ChargeStatus = {
    status: string
    chargeId: string
    code?: string
    timeline: any[]
    payments: any[]
    isDemo: boolean
    reason?: string
}

const unverified = (chargeId: string, reason: string): ChargeStatus => ({
    status: 'UNVERIFIED',
    chargeId,
    timeline: [],
    payments: [],
    isDemo: false,
    reason
})

const demoConfirmed = (chargeId: string): ChargeStatus => ({
    status: 'COMPLETED',
    chargeId,
    timeline: [],
    payments: [],
    isDemo: true,
    reason: 'PAYMENTS_DEMO_MODE=true'
})

// `demoAllowed` must come from paymentsDemoMode(env). Without it this function never
// reports COMPLETED unless Coinbase actually said so.
export const checkChargeStatus = async (
    chargeId: string, apiKey?: string, demoAllowed = false
): Promise<ChargeStatus> => {
    const isDemoCharge = chargeId.startsWith('demo_charge_') || chargeId.startsWith('fallback_charge_')

    if (isDemoCharge) {
        return demoAllowed
            ? demoConfirmed(chargeId)
            : unverified(chargeId, 'stub charge id cannot be verified with a real payment processor')
    }

    if (!apiKey || apiKey.trim() === '') {
        return demoAllowed
            ? demoConfirmed(chargeId)
            : unverified(chargeId, 'COINBASE_COMMERCE_API_KEY is not configured')
    }

    try {
        const response = await fetch(`https://api.commerce.coinbase.com/charges/${chargeId}`, {
            headers: {
                'X-CC-Api-Key': apiKey,
                'X-CC-Version': '2018-03-22'
            }
        })

        if (!response.ok) {
            const errorText = await response.text()

            if (errorText.includes('authentication_error') || errorText.includes('no_such_api_key')) {
                console.error('checkChargeStatus: Coinbase rejected the API key')
                return demoAllowed
                    ? demoConfirmed(chargeId)
                    : unverified(chargeId, 'Coinbase rejected the configured API key')
            }

            if (response.status === 404) {
                return unverified(chargeId, 'charge not found')
            }

            throw new Error(`Failed to fetch charge status: ${response.status}`)
        }

        const data = await response.json() as any
        const charge = data.data

        // Get the latest status from timeline (last entry)
        const timeline = charge.timeline || []
        const latestStatus = timeline.length > 0
            ? timeline[timeline.length - 1].status
            : 'NEW'

        return {
            status: latestStatus.toUpperCase(),
            chargeId: charge.id,
            code: charge.code,
            timeline: timeline,
            payments: charge.payments || [],
            isDemo: false
        }
    } catch (error) {
        // An unreachable payment processor means "unknown", never "paid".
        console.error('Error in checkChargeStatus:', error)
        return demoAllowed
            ? demoConfirmed(chargeId)
            : unverified(chargeId, `payment processor unreachable: ${String(error)}`)
    }
}

export const verifyPayment = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const chargeId = c.req.param('id')
        const result = await checkChargeStatus(
            chargeId, c.env.COINBASE_COMMERCE_API_KEY, paymentsDemoMode(c.env)
        )
        return c.json({ ...result, isDemoMode: result.isDemo })

    } catch (error) {
        console.error('Verify payment error:', error)
        return c.json({
            status: 'UNVERIFIED',
            chargeId: c.req.param('id'),
            error: String(error)
        }, 502)
    }
}

// Active status check endpoint - checks Coinbase API and updates database
export const checkPaymentStatus = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const chargeId = c.req.param('chargeId')
        const connectionString = getConnectionString(c.env)
        
        if (!chargeId) {
            return c.json({ error: 'Missing chargeId' }, 400)
        }

        // Check status from Coinbase API
        const result = await checkChargeStatus(
            chargeId, c.env.COINBASE_COMMERCE_API_KEY, paymentsDemoMode(c.env)
        )

        // Map Coinbase status to our transaction status.
        // UNVERIFIED is deliberately absent: unmapped statuses fall through to PENDING.
        const statusMap: Record<string, string> = {
            'NEW': 'PENDING',
            'PENDING': 'PENDING',
            'COMPLETED': 'COMPLETED',
            'EXPIRED': 'EXPIRED',
            'CANCELED': 'CANCELED',
            'UNRESOLVED': 'PENDING',
            'RESOLVED': 'COMPLETED'
        }
        
        const transactionStatus = statusMap[result.status] || 'PENDING'
        
        // Update database if we have a connection
        if (connectionString) {
            try {
                await withPrisma(connectionString, async (prisma) => {
                    // Find existing transaction
                    const existingTx = await prisma.transaction.findUnique({
                        where: { transactionId: chargeId }
                    })
                    
                    if (existingTx) {
                        // Check if status has changed
                        if (existingTx.status !== transactionStatus) {
                            // Extract payment details from result
                            const payments = result.payments || []
                            const payment = payments.length > 0 ? payments[0] : null
                            
                            const walletAddress = payment?.payer_addresses?.[0] || 
                                                 payment?.from_address || 
                                                 (existingTx as any).walletAddress
                            
                            const txHash = payment?.transaction_id || 
                                         payment?.tx_hash || 
                                         (existingTx as any).txHash
                            
                            const currency = payment?.value?.currency || 
                                           result.code?.split('_')[1]?.toUpperCase() || 
                                           (existingTx as any).currency || 'USD'
                            
                            const network = payment?.network || (existingTx as any).network
                            
                            // Update transaction
                            await prisma.transaction.update({
                                where: { transactionId: chargeId },
                                data: {
                                    status: transactionStatus,
                                    walletAddress: walletAddress || (existingTx as any).walletAddress || null,
                                    txHash: txHash || (existingTx as any).txHash || null,
                                    currency: currency || (existingTx as any).currency || null,
                                    network: network || (existingTx as any).network || null,
                                    metadata: JSON.stringify({
                                        ...((existingTx as any).metadata ? (typeof (existingTx as any).metadata === 'string' ? JSON.parse((existingTx as any).metadata) : (existingTx as any).metadata) : {}),
                                        lastChecked: new Date().toISOString(),
                                        coinbaseStatus: result.status,
                                        timeline: result.timeline || []
                                    })
                                } as any
                            })
                            
                            console.log(`[Payment Check] Updated transaction ${chargeId} from ${existingTx.status} to ${transactionStatus}`)
                            
                            // Also log as payment event if status changed to COMPLETED
                            // Note: PaymentLog model removed, logging handled via transaction metadata
                            if (transactionStatus === 'COMPLETED' && existingTx.status !== 'COMPLETED') {
                                // Logging handled via transaction metadata update above
                                console.log(`[Payment Log] Charge ${chargeId} confirmed with code ${result.code}`)
                            }
                        }
                    } else {
                        // Transaction doesn't exist - create it
                        let user = await prisma.user.findFirst({
                            orderBy: { createdAt: 'desc' }
                        })
                        if (!user) {
                            user = await prisma.user.create({ data: {} })
                        }
                        
                        const payments = result.payments || []
                        const payment = payments.length > 0 ? payments[0] : null
                        
                        // Extract amount from charge pricing if available
                        const amountFromCharge = result.payments?.length > 0 
                            ? parseFloat(result.payments[0]?.value?.amount || '0')
                            : 0
                        
                        await prisma.transaction.create({
                            data: {
                                transactionId: chargeId,
                                userId: user.id,
                                amount: amountFromCharge || 0,
                                transactionType: 'PAYMENT',
                                status: transactionStatus,
                                walletAddress: payment?.payer_addresses?.[0] || payment?.from_address || null,
                                txHash: payment?.transaction_id || payment?.tx_hash || null,
                                currency: payment?.value?.currency || 'USD',
                                network: payment?.network || 'coinbase',
                                metadata: JSON.stringify({
                                    source: 'status_check',
                                    coinbaseStatus: result.status,
                                    timeline: result.timeline || [],
                                    chargeCode: result.code
                                })
                            } as any
                        })
                        
                        console.log(`[Payment Check] Created new transaction for ${chargeId}`)
                    }
                })
            } catch (dbError) {
                console.error('[Payment Check] Database update error:', dbError)
                // Don't fail the request if DB update fails
            }
        }
        
        // Return status response
        if (result.isDemo) {
            return c.json({
                status: 'COMPLETED',
                chargeId,
                isDemoMode: true,
                note: 'PAYMENTS_DEMO_MODE=true - payment auto-confirmed, not a real payment'
            })
        }

        return c.json({
            status: transactionStatus,
            chargeId: result.chargeId,
            code: result.code,
            timeline: result.timeline,
            payments: result.payments,
            isDemoMode: false,
            updated: true
        })
        
    } catch (error: any) {
        console.error('Check payment status error:', error)
        
        // Try to get status from database as fallback
        const chargeId = c.req.param('chargeId')
        const connectionString = getConnectionString(c.env)
        
        if (connectionString && chargeId) {
            try {
                const dbStatus = await withPrisma(connectionString, async (prisma) => {
                    const tx = await prisma.transaction.findUnique({
                        where: { transactionId: chargeId }
                    })
                    return tx?.status || 'PENDING'
                })
                
                return c.json({
                    status: dbStatus,
                    chargeId,
                    isDemoMode: false,
                    error: 'Failed to check Coinbase API, using database status',
                    note: error.message
                })
            } catch (dbError) {
                // Fall through to error response
            }
        }
        
        return c.json({
            error: error.message || 'Failed to check payment status',
            chargeId: c.req.param('chargeId')
        }, 500)
    }
}

// Mark payment as failed/incomplete when user closes payment window
export const cancelPayment = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const chargeId = c.req.param('chargeId')
        const connectionString = getConnectionString(c.env)
        
        if (!chargeId) {
            return c.json({ error: 'Missing chargeId' }, 400)
        }

        // Update database to mark payment as CANCELED/INCOMPLETE
        if (connectionString) {
            try {
                await withPrisma(connectionString, async (prisma) => {
                    const existingTx = await prisma.transaction.findUnique({
                        where: { transactionId: chargeId }
                    })
                    
                    if (existingTx) {
                        // Only update if still PENDING (don't overwrite COMPLETED payments)
                        if (existingTx.status === 'PENDING') {
                            await prisma.transaction.update({
                                where: { transactionId: chargeId },
                                data: {
                                    status: 'CANCELED',
                                    metadata: JSON.stringify({
                                        ...((existingTx as any).metadata ? (typeof (existingTx as any).metadata === 'string' ? JSON.parse((existingTx as any).metadata) : (existingTx as any).metadata) : {}),
                                        canceledAt: new Date().toISOString(),
                                        reason: 'Payment window closed by user',
                                        canceledBy: 'user'
                                    })
                                } as any
                            })
                            
                            console.log(`[Payment Cancel] Marked transaction ${chargeId} as CANCELED (window closed)`)
                            
                            // Log cancellation event (handled via transaction metadata update above)
                            const chargeCode = (existingTx as any).metadata ? (() => {
                                try {
                                    const meta = typeof (existingTx as any).metadata === 'string' 
                                        ? JSON.parse((existingTx as any).metadata) 
                                        : (existingTx as any).metadata
                                    return meta.chargeCode || null
                                } catch {
                                    return null
                                }
                            })() : null
                            
                            console.log(`[Payment Log] Charge ${chargeId} canceled with code ${chargeCode}`)
                        } else {
                            console.log(`[Payment Cancel] Transaction ${chargeId} already has status ${existingTx.status}, not updating`)
                        }
                    } else {
                        console.log(`[Payment Cancel] Transaction ${chargeId} not found in database`)
                    }
                })
            } catch (dbError) {
                console.error('[Payment Cancel] Database update error:', dbError)
                // Don't fail the request if DB update fails
            }
        }
        
        return c.json({
            success: true,
            chargeId,
            status: 'CANCELED',
            message: 'Payment marked as canceled'
        })
        
    } catch (error: any) {
        console.error('Cancel payment error:', error)
        return c.json({
            error: error.message || 'Failed to cancel payment',
            chargeId: c.req.param('chargeId')
        }, 500)
    }
}
