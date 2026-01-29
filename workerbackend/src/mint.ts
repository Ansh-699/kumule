
import { Context } from 'hono'
import { getUmi } from './umi'
import { generateSigner, publicKey } from '@metaplex-foundation/umi'
import { createV1 } from '@metaplex-foundation/mpl-core'
import { base58 } from '@metaplex-foundation/umi/serializers'

import { checkChargeStatus } from './payment'
import { withPrisma, getConnectionString } from './db'
import { logBlockchainTransaction, logSecurityEvent, recordAuditedTransaction } from './audit'

export const mintNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const startTime = Date.now()
    console.log('[MINT] Request received:', new Date().toISOString())
    
    try {
        const body = await c.req.json()
        let { uri, name, owner, collection, paymentMethod, chargeId } = body

        console.log('[MINT] Params:', JSON.stringify({ name, owner: owner?.slice(0, 8) + '...', paymentMethod, hasUri: !!uri }))

        if (!uri || !name || !owner) {
            console.log('[MINT] Missing required fields')
            return c.text('Missing required fields: uri, name, owner', 400)
        }

        // Validate owner is a valid Solana public key (32-44 chars, base58)
        if (typeof owner !== 'string' || owner.length < 32 || owner.length > 44) {
            return c.text('Invalid owner wallet address. Must be a valid Solana public key (32-44 characters)', 400)
        }

        // Clean up optional fields - ignore placeholder values from Swagger or invalid types
        // Convert to string first if needed, then check for placeholders
        if (collection !== undefined && collection !== null) {
            collection = String(collection)
            if (collection === 'string' || collection === '' || collection === 'undefined' || collection === 'null') {
                collection = undefined
            }
        }
        if (paymentMethod !== undefined && paymentMethod !== null) {
            paymentMethod = String(paymentMethod)
            if (paymentMethod === 'string' || paymentMethod === '' || paymentMethod === 'undefined' || paymentMethod === 'null') {
                paymentMethod = undefined
            }
        }
        if (chargeId !== undefined && chargeId !== null) {
            chargeId = String(chargeId)
            if (chargeId === 'string' || chargeId === '' || chargeId === 'undefined' || chargeId === 'null') {
                chargeId = undefined
            }
        }

        // Validate collection if provided
        if (collection && (collection.length < 32 || collection.length > 44)) {
            return c.text('Invalid collection address. Must be a valid Solana public key (32-44 characters)', 400)
        }

        // Check for duplicate mint attempt using same metadata URI
        const connectionStringForDupeCheck = getConnectionString(c.env)
        if (connectionStringForDupeCheck) {
            try {
                const existingNft = await withPrisma(connectionStringForDupeCheck, async (prisma) => {
                    return prisma.nft.findFirst({
                        where: { metadataUri: uri }
                    })
                })
                if (existingNft) {
                    logSecurityEvent('duplicate_mint_attempt', {
                        actor: owner,
                        target: uri,
                        metadata: { existingNftId: existingNft.nftId }
                    })
                    return c.json({
                        error: 'Duplicate mint attempt',
                        message: 'An NFT with this metadata URI already exists',
                        existingNftId: existingNft.nftId
                    }, 409) // Conflict status
                }
            } catch (e) {
                console.warn('Duplicate check failed (continuing):', e)
            }
        }

        // Verify payment if method is coinbase
        if (paymentMethod === 'coinbase') {
            if (!chargeId) {
                return c.text('Missing chargeId for Coinbase payment', 402)
            }

            let paymentVerified = false;
            
            // Check DB first (populated by webhook)
            const connectionString = getConnectionString(c.env)
            if (connectionString) {
                try {
                    const transaction = await withPrisma(connectionString, async (prisma) => {
                        return prisma.transaction.findUnique({
                            where: { transactionId: chargeId }
                        })
                    })
                    
                    if (transaction && (transaction.status === 'COMPLETED' || transaction.status === 'CONFIRMED')) {
                        paymentVerified = true;
                    }
                } catch (dbError) {
                    console.warn('Database check failed, falling back to API check:', dbError)
                }
            }

            if (!paymentVerified) {
                // Fallback to API check if not in DB yet
                const paymentStatus = await checkChargeStatus(chargeId, c.env.COINBASE_COMMERCE_API_KEY)

                if (paymentStatus.status !== 'COMPLETED' && paymentStatus.status !== 'CONFIRMED') {
                    return c.text(`Payment not completed. Status: ${paymentStatus.status}`, 402)
                }
            }
        }

        // Use public RPC as fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)
        const ownerKey = publicKey(owner)
        const asset = generateSigner(umi)
        let assetKey = asset.publicKey.toString();

        const userSigner = {
            publicKey: ownerKey,
            signMessage: async (msg: Uint8Array) => msg,
            signTransaction: async (tx: any) => tx,
            signAllTransactions: async (txs: any[]) => txs,
        }

        // Build create instruction with optional collection
        const createParams: any = {
            asset,
            name,
            uri,
            owner: ownerKey,
            authority: userSigner,
            payer: userSigner,
        }

        // Add collection if provided
        if (collection) {
            createParams.collection = publicKey(collection)
        }

        let builder = createV1(umi, createParams)
        let base64Tx: string
        
        // Try to build transaction with RPC fallback
        try {
            const builderWithBlockhash = await builder
                .setFeePayer(userSigner)
                .setLatestBlockhash(umi)

            const tx = await builderWithBlockhash.build(umi)
            const signedTx = await asset.signTransaction(tx)
            const serializedTx = umi.transactions.serialize(signedTx)
            base64Tx = Buffer.from(serializedTx).toString('base64')
        } catch (rpcError: any) {
            // If RPC fails, try public devnet RPC
            if (rpcError.message?.includes('401') || rpcError.message?.includes('Invalid API key') || rpcError.message?.includes('Unauthorized') || rpcError.message?.includes('failed to get recent blockhash')) {
                console.log('RPC failed in mintNft, trying public devnet RPC...')
                rpcUrl = 'https://api.devnet.solana.com'
                umi = getUmi(rpcUrl)
                
                // Recreate asset signer with new umi instance
                const newAsset = generateSigner(umi)
                assetKey = newAsset.publicKey.toString()
                
                // Update createParams with new asset
                createParams.asset = newAsset
                
                builder = createV1(umi, createParams)
                const builderWithBlockhash = await builder
                    .setFeePayer(userSigner)
                    .setLatestBlockhash(umi)

                const tx = await builderWithBlockhash.build(umi)
                const signedTx = await newAsset.signTransaction(tx)
                const serializedTx = umi.transactions.serialize(signedTx)
                base64Tx = Buffer.from(serializedTx).toString('base64')
            } else {
                throw rpcError
            }
        }

        // Record mint in database (after we know the final asset key)
        const dbConnectionString = getConnectionString(c.env)
        if (dbConnectionString) {
            try {
                await withPrisma(dbConnectionString, async (prisma) => {
                    const walletAddress = owner;
                    console.log('Mint DB: Processing mint for wallet', walletAddress)

                    // 1. Find or Create User and Wallet
                    let user = await prisma.user.findFirst({
                        where: {
                            wallets: {
                                some: { walletAddress: walletAddress }
                            }
                        },
                        include: { wallets: true }
                    });

                    if (!user) {
                        console.log('Mint DB: Creating new user + wallet')
                        user = await prisma.user.create({
                            data: {
                                wallets: {
                                    create: {
                                        walletAddress: walletAddress,
                                        walletType: 'solana'
                                    }
                                }
                            },
                            include: { wallets: true }
                        });
                    }

                    // 2. Get the wallet
                    const wallet = user.wallets.find((w: { walletAddress: string }) => w.walletAddress === walletAddress) 
                        || await prisma.wallet.findUnique({ where: { walletAddress: walletAddress } });
                    
                    if (wallet) {
                        console.log('Mint DB: Creating NFT record', assetKey)
                        await prisma.nft.create({
                            data: {
                                nftId: assetKey,
                                name: name,
                                metadataUri: uri,
                                walletId: wallet.id,
                            }
                        });
                        console.log('Mint DB: NFT record created successfully')

                        // 3. Create or update Transaction record
                        if (paymentMethod === 'coinbase' && chargeId) {
                            // Get the NFT we just created
                            const nft = await prisma.nft.findUnique({ where: { nftId: assetKey } });
                            if (nft) {
                                await prisma.transaction.update({
                                    where: { transactionId: chargeId },
                                    data: {
                                        nftId: nft.id,
                                        status: 'COMPLETED'
                                    }
                                }).catch((e: unknown) => console.log('Transaction update failed (may not exist):', e));
                            }
                        } else if (paymentMethod === 'wallet') {
                            // Create transaction record for wallet payments
                            const nft = await prisma.nft.findUnique({ where: { nftId: assetKey } });
                            await prisma.transaction.create({
                                data: {
                                    transactionId: `mint_${assetKey}_${Date.now()}`,
                                    userId: user.id,
                                    amount: 0, // Wallet payments typically don't have a fee
                                    nftId: nft?.id || null,
                                    transactionType: 'MINT',
                                    status: 'COMPLETED',
                                    walletAddress: walletAddress || null,
                                    txHash: null,
                                    currency: 'SOL',
                                    network: 'solana',
                                    metadata: JSON.stringify({
                                        source: 'wallet_mint',
                                        mintedAt: new Date().toISOString()
                                    })
                                } as any
                            }).catch((e: unknown) => console.log('Transaction creation failed:', e));
                        }
                    } else {
                        console.warn('Mint DB: Wallet not found after user creation')
                    }
                });
            } catch (e) {
                console.error('Failed to record mint in DB (continuing anyway):', e)
                // Don't block minting if DB fails
            }
        } else {
            console.warn('Database connection not configured - skipping DB recording')
        }

        // Log successful transaction preparation
        logBlockchainTransaction({
            action: 'mint_nft',
            walletAddress: owner,
            assetId: assetKey,
            success: true
        })

        const duration = Date.now() - startTime
        console.log('[MINT] Success:', JSON.stringify({ assetId: assetKey, durationMs: duration }))

        return c.json({
            transaction: base64Tx,
            mint: assetKey
        })

    } catch (error) {
        const duration = Date.now() - startTime
        console.error('[MINT] Error:', error, `Duration: ${duration}ms`)
        
        // Log failed mint attempt
        logBlockchainTransaction({
            action: 'mint_nft',
            walletAddress: 'unknown',
            success: false,
            error: error instanceof Error ? error.message : String(error)
        })
        
        return c.text(`Mint failed: ${error} `, 500)
    }
}
