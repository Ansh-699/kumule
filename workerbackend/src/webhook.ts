import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'

// HMAC-SHA256 signature verification for Coinbase Commerce webhooks
async function verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
): Promise<boolean> {
    try {
        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        )
        
        const signatureBuffer = await crypto.subtle.sign(
            'HMAC',
            key,
            encoder.encode(payload)
        )
        
        const computedSignature = Array.from(new Uint8Array(signatureBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
        
        // Constant-time comparison to prevent timing attacks
        if (computedSignature.length !== signature.length) {
            return false
        }
        
        let result = 0
        for (let i = 0; i < computedSignature.length; i++) {
            result |= computedSignature.charCodeAt(i) ^ signature.charCodeAt(i)
        }
        
        return result === 0
    } catch (error) {
        console.error('Signature verification error:', error)
        return false
    }
}

// Map Coinbase event types to transaction statuses
function mapEventToStatus(eventType: string): string {
    const statusMap: Record<string, string> = {
        'charge:created': 'PENDING',
        'charge:pending': 'PENDING',
        'charge:confirmed': 'COMPLETED',
        'charge:failed': 'FAILED',
        'charge:delayed': 'PENDING',
        'charge:resolved': 'COMPLETED',
        'charge:expired': 'EXPIRED',
        'charge:canceled': 'CANCELED',
    }
    return statusMap[eventType] || 'UNKNOWN'
}

// Extract payment details from charge data
function extractPaymentDetails(charge: any, payments: any[] = []): {
    walletAddress: string | null,
    txHash: string | null,
    currency: string | null,
    network: string | null,
    amount: number
} {
    let walletAddress: string | null = null
    let txHash: string | null = null
    let currency: string | null = null
    let network: string | null = null
    
    // Try to get from payments array (most reliable)
    if (payments && payments.length > 0) {
        const payment = payments[0] // Use first payment
        walletAddress = payment.payer_addresses?.[0] || payment.from_address || null
        txHash = payment.transaction_id || payment.tx_hash || null
        network = payment.network || null
        currency = payment.value?.currency || null
    }
    
    // Fallback to charge metadata
    if (!walletAddress && charge.metadata?.wallet_address) {
        walletAddress = charge.metadata.wallet_address
    }
    
    // Get amount from pricing
    const amount = parseFloat(charge.pricing?.local?.amount || charge.pricing?.settlement?.amount || '0')
    
    return { walletAddress, txHash, currency, network, amount }
}

// Main Coinbase webhook handler
export const handleWebhook = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const signature = c.req.header('X-CC-Webhook-Signature')
    const secret = c.env.COINBASE_WEBHOOK_SECRET
    
    // Get raw body for signature verification
    const rawBody = await c.req.raw.clone().text()
    
    // A webhook marks a Transaction COMPLETED, and mint.ts trusts that status to release a paid
    // mint. An unverified payload is therefore a free-mint primitive - reject, never "log and continue".
    if (!secret) {
        console.error('COINBASE_WEBHOOK_SECRET is not configured; refusing webhook')
        return c.text('Webhook not configured', 503)
    }
    if (!signature) {
        return c.text('Missing X-CC-Webhook-Signature', 401)
    }
    const signatureVerified = await verifyWebhookSignature(rawBody, signature, secret)
    if (!signatureVerified) {
        console.warn('Webhook signature verification failed - rejecting')
        return c.text('Invalid signature', 401)
    }

    let body: any
    try {
        body = JSON.parse(rawBody)
    } catch (error) {
        console.error('Failed to parse webhook body:', error)
        return c.text('Invalid JSON', 400)
    }
    
    const event = body.event
    if (!event || !event.type) {
        console.error('Invalid webhook payload - missing event or event.type')
        return c.text('Invalid payload', 400)
    }
    
    const eventType = event.type
    const charge = event.data
    const chargeId = charge?.id
    const chargeCode = charge?.code
    
    console.log(`[Webhook] Received event: ${eventType} for charge: ${chargeId}`)
    
    const connectionString = getConnectionString(c.env)
    if (!connectionString) {
        console.error('Database not configured - cannot record webhook')
        return c.text('Database not configured', 500)
    }
    
    const status = mapEventToStatus(eventType)
    const payments = charge?.payments || []
    const { walletAddress, txHash, currency, network, amount } = extractPaymentDetails(charge, payments)
    
    try {
        await withPrisma(connectionString, async (prisma) => {
            // 1. Log the webhook event (for auditing)
            await prisma.paymentLog.create({
                data: {
                    eventType: eventType,
                    chargeId: chargeId || 'unknown',
                    chargeCode: chargeCode,
                    walletAddress: walletAddress,
                    txHash: txHash,
                    amount: amount,
                    currency: currency,
                    network: network,
                    status: status,
                    rawPayload: JSON.stringify(body),
                    verified: signatureVerified,
                }
            })
            console.log(`[Webhook] Logged payment event: ${eventType}`)
            
            // 2. Update or create Transaction record
            if (chargeId) {
                const existingTx = await prisma.transaction.findUnique({
                    where: { transactionId: chargeId }
                })
                
                if (existingTx) {
                    // Update existing transaction
                    await prisma.transaction.update({
                        where: { transactionId: chargeId },
                        data: {
                            status: status,
                            walletAddress: walletAddress || existingTx.walletAddress,
                            txHash: txHash || existingTx.txHash,
                            currency: currency || existingTx.currency,
                            network: network || existingTx.network,
                            metadata: JSON.stringify({
                                chargeCode: chargeCode,
                                lastEvent: eventType,
                                updatedAt: new Date().toISOString()
                            })
                        }
                    })
                    console.log(`[Webhook] Updated transaction ${chargeId} to status: ${status}`)
                } else {
                    // Create new transaction - need a user first
                    let user = await prisma.user.findFirst({
                        orderBy: { createdAt: 'desc' }
                    })
                    
                    if (!user) {
                        user = await prisma.user.create({ data: {} })
                    }
                    
                    await prisma.transaction.create({
                        data: {
                            transactionId: chargeId,
                            userId: user.id,
                            amount: amount,
                            transactionType: 'PAYMENT',
                            status: status,
                            walletAddress: walletAddress,
                            txHash: txHash,
                            currency: currency,
                            network: network,
                            metadata: JSON.stringify({
                                chargeCode: chargeCode,
                                source: 'webhook',
                                eventType: eventType
                            })
                        }
                    })
                    console.log(`[Webhook] Created new transaction for charge ${chargeId}`)
                }
            }
        })
        
        return c.json({
            success: true,
            message: 'Webhook processed',
            event: eventType,
            chargeId: chargeId,
            status: status
        })
        
    } catch (error: any) {
        console.error('[Webhook] Error processing webhook:', error)
        return c.json({
            success: false,
            error: error.message
        }, 500)
    }
}

// Unified payment webhook handler (combines Coinbase + Solana verification)
export const handlePaymentWebhook = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    // Clone request so we can read body multiple times
    const rawBody = await c.req.raw.clone().text()
    
    let body: any
    try {
        body = JSON.parse(rawBody)
    } catch (error) {
        return c.json({ error: 'Failed to parse JSON' }, 400)
    }
    
    // Check if it's a Solana transaction notification (has solanaSignature or txSignature)
    if (body.solanaSignature || body.txSignature) {
        return handleSolanaPaymentNotification(c, body)
    }
    
    // Check if it's a Coinbase webhook (has event.type structure)
    if (body.event && body.event.type) {
        return handleWebhook(c)
    }
    
    // Unknown format
    return c.json({ error: 'Unknown webhook format. Expected Coinbase event or Solana signature.' }, 400)
}

// Handle Solana payment notifications (from frontend or RPC webhooks)
async function handleSolanaPaymentNotification(
    c: Context<{ Bindings: CloudflareBindings }>,
    body: any
) {
    // This endpoint is unauthenticated, so nothing the caller sends may decide *which* record it
    // writes or what kind of record it is. Letting the caller pick chargeId/transactionType here
    // let anyone forge a settled PAYMENT row for an arbitrary charge and mint against it.
    const { solanaSignature, txSignature, walletAddress, amount } = body

    const signature = solanaSignature || txSignature
    const transactionType = 'SOLANA_TRANSFER'
    
    if (!signature) {
        return c.json({ error: 'Missing Solana signature' }, 400)
    }
    
    const connectionString = getConnectionString(c.env)
    if (!connectionString) {
        return c.json({ error: 'Database not configured' }, 500)
    }
    
    console.log(`[Solana Webhook] Processing tx: ${signature}`)
    
    try {
        // Verify the transaction on Solana
        const verified = await verifySolanaTransaction(c.env.SOLANA_RPC_URL, signature)
        
        await withPrisma(connectionString, async (prisma) => {
            // Log the event
            await prisma.paymentLog.create({
                data: {
                    eventType: 'solana:payment',
                    chargeId: signature,
                    walletAddress: walletAddress,
                    txHash: signature,
                    amount: amount ? parseFloat(amount) : null,
                    currency: 'SOL',
                    network: 'solana',
                    status: verified ? 'COMPLETED' : 'PENDING',
                    rawPayload: JSON.stringify(body),
                    verified: verified,
                }
            })
            
            // Create or update transaction. Keyed on the full signature so the same notification is
            // idempotent and cannot collide with (or overwrite) a Coinbase charge id.
            const txId = `sol_${signature}`
            const existingTx = await prisma.transaction.findUnique({
                where: { transactionId: txId }
            })
            
            if (existingTx) {
                await prisma.transaction.update({
                    where: { transactionId: txId },
                    data: {
                        status: verified ? 'COMPLETED' : 'PENDING',
                        txHash: signature,
                        walletAddress: walletAddress || existingTx.walletAddress,
                    }
                })
            } else {
                let user = await prisma.user.findFirst({
                    orderBy: { createdAt: 'desc' }
                })
                if (!user) {
                    user = await prisma.user.create({ data: {} })
                }
                
                await prisma.transaction.create({
                    data: {
                        transactionId: txId,
                        userId: user.id,
                        amount: amount ? parseFloat(amount) : 0,
                        transactionType: transactionType,
                        status: verified ? 'COMPLETED' : 'PENDING',
                        walletAddress: walletAddress,
                        txHash: signature,
                        currency: 'SOL',
                        network: 'solana',
                        metadata: JSON.stringify({
                            source: 'solana_webhook',
                            verified: verified
                        })
                    }
                })
            }
        })
        
        return c.json({
            success: true,
            verified: verified,
            signature: signature
        })
        
    } catch (error: any) {
        console.error('[Solana Webhook] Error:', error)
        return c.json({ success: false, error: error.message }, 500)
    }
}

// Verify a Solana transaction exists and is confirmed
export async function verifySolanaTransaction(rpcUrl: string, signature: string): Promise<boolean> {
    if (!rpcUrl) {
        console.warn('No Solana RPC URL configured')
        return false
    }
    
    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTransaction',
                params: [
                    signature,
                    { encoding: 'json', maxSupportedTransactionVersion: 0 }
                ]
            })
        })
        
        const data = await response.json() as any
        
        if (data.result && data.result.meta) {
            // Transaction found - check if it was successful
            const err = data.result.meta.err
            return err === null // null means success
        }
        
        return false
    } catch (error) {
        console.error('Solana verification error:', error)
        return false
    }
}

// Get payment logs (for admin/debugging)
export const getPaymentLogs = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) {
        return c.json({ error: 'Database not configured' }, 500)
    }
    
    const chargeId = c.req.query('chargeId')
    const walletAddress = c.req.query('walletAddress')
    const limit = parseInt(c.req.query('limit') || '50')
    
    try {
        const logs = await withPrisma(connectionString, async (prisma) => {
            const where: any = {}
            if (chargeId) where.chargeId = chargeId
            if (walletAddress) where.walletAddress = walletAddress
            
            return prisma.paymentLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: Math.min(limit, 100)
            })
        })
        
        return c.json({ logs })
    } catch (error: any) {
        return c.json({ error: error.message }, 500)
    }
}

// Get transaction history
export const getTransactionHistory = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) {
        return c.json({ error: 'Database not configured' }, 500)
    }
    
    const walletAddress = c.req.query('walletAddress')
    const status = c.req.query('status')
    const transactionType = c.req.query('type')
    const limit = parseInt(c.req.query('limit') || '50')
    
    try {
        const transactions = await withPrisma(connectionString, async (prisma) => {
            const where: any = {}
            if (walletAddress) where.walletAddress = walletAddress
            if (status) where.status = status
            if (transactionType) where.transactionType = transactionType
            
            return prisma.transaction.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: Math.min(limit, 100),
                select: {
                    id: true,
                    transactionId: true,
                    walletAddress: true,
                    txHash: true,
                    amount: true,
                    currency: true,
                    network: true,
                    transactionType: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                }
            })
        })
        
        return c.json({ transactions })
    } catch (error: any) {
        return c.json({ error: error.message }, 500)
    }
}
