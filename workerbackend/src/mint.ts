
import { Context } from 'hono'
import { getUmi } from './umi'
import { generateSigner, publicKey } from '@metaplex-foundation/umi'
import { createV1 } from '@metaplex-foundation/mpl-core'
import { base58 } from '@metaplex-foundation/umi/serializers'

import { verifySolPayment } from './solana'
import { withPrisma, getConnectionString, ensureUser } from './db'
import { makeAssetId, toBaseUnits, fromBaseUnits, isSolanaAddress } from './chains'
import { resolveMetadata } from './metadata'
import { logBlockchainTransaction, logSecurityEvent, auditedTransactionData } from './audit'

export const mintNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const startTime = Date.now()
    console.log('[MINT] Request received:', new Date().toISOString())
    
    try {
        const body = await c.req.json()
        let { uri, name, owner, collection, paymentMethod, feeTxSignature } = body

        // owner?.slice used to assume owner was a string whenever it was non-nullish; a
        // non-string owner (e.g. a JSON number) crashed here with a raw 500 before
        // validation below ever ran.
        console.log('[MINT] Params:', JSON.stringify({ name, owner: typeof owner === 'string' ? owner.slice(0, 8) + '...' : owner, paymentMethod, hasUri: !!uri }))

        if (!uri || !name || !owner) {
            console.log('[MINT] Missing required fields')
            return c.text('Missing required fields: uri, name, owner', 400)
        }

        // Validate owner is a valid Solana public key (base58, 32-44 chars). A same-length
        // string with a base58-illegal char (0, O, I, l) used to slip past a bare .length
        // check and crash later in publicKey(owner) with a raw 500.
        if (typeof owner !== 'string' || !isSolanaAddress(owner)) {
            return c.text('Invalid owner wallet address. Must be a valid Solana public key', 400)
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
        if (feeTxSignature !== undefined && feeTxSignature !== null) {
            feeTxSignature = String(feeTxSignature)
            if (['string', '', 'undefined', 'null'].includes(feeTxSignature)) {
                feeTxSignature = undefined
            }
        }

        // Validate collection if provided
        if (collection && !isSolanaAddress(collection)) {
            return c.text('Invalid collection address. Must be a valid Solana public key', 400)
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
                        metadata: { existingAssetId: existingNft.assetId }
                    })
                    return c.json({
                        error: 'Duplicate mint attempt',
                        message: 'An NFT with this metadata URI already exists',
                        existingAssetId: existingNft.assetId
                    }, 409)
                }
            } catch (e) {
                console.warn('Duplicate check failed (continuing):', e)
            }
        }

        // Platform mint fee, verified on-chain.
        //
        // v1 gated minting on a Coinbase Commerce charge. Commerce shut down 2026-03-31, and
        // the old flow trusted a charge status that returned COMPLETED whenever it could not
        // reach Coinbase - so an outage minted for free. A fee is now a SOL transfer to the
        // treasury that the chain can confirm independently.
        //
        // With MINT_FEE_LAMPORTS unset, minting is free: the caller signs and pays their own
        // rent and network fee, which is what already happens for every mint.
        const feeLamports = c.env.MINT_FEE_LAMPORTS ? BigInt(c.env.MINT_FEE_LAMPORTS) : 0n
        const treasury = c.env.MINT_FEE_TREASURY

        if (feeLamports > 0n) {
            if (!treasury) {
                console.error('MINT_FEE_LAMPORTS is set but MINT_FEE_TREASURY is not')
                return c.text('Mint fee is misconfigured', 503)
            }
            if (!feeTxSignature) {
                return c.text(
                    `Mint fee required: send ${fromBaseUnits(feeLamports, 'SOLANA')} SOL to ${treasury} and pass feeTxSignature`,
                    402
                )
            }

            const connectionString = getConnectionString(c.env)
            if (!connectionString) return c.text('Fee verification unavailable', 503)

            // One signature cannot pay for two mints. Checked before the chain lookup because a
            // replay is cheaper to reject from the database.
            const alreadySpent = await withPrisma(connectionString, (prisma) =>
                prisma.transaction.findUnique({ where: { txHash: feeTxSignature } })
            )
            if (alreadySpent) {
                logSecurityEvent('unauthorized_access', {
                    actor: owner,
                    target: feeTxSignature,
                    metadata: { reason: 'fee_signature_reuse' },
                })
                return c.text('feeTxSignature has already been used to mint', 409)
            }

            const paid = await verifySolPayment(c.env, feeTxSignature, treasury, feeLamports)
            if (!paid.ok) {
                logSecurityEvent('unauthorized_access', {
                    actor: owner,
                    target: feeTxSignature,
                    metadata: { reason: 'fee_unverified', detail: paid.reason },
                })
                return c.text(`Mint fee not verified: ${paid.reason}`, 402)
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
                // Resolved before opening a connection: fetching a remote URI while holding a
                // pooled Postgres connection is how a slow metadata host becomes a database
                // problem. resolveMetadata never throws, so a failure here still records the mint.
                const meta = await resolveMetadata(c.env, uri)

                await withPrisma(dbConnectionString, async (prisma) => {
                    console.log('Mint DB: recording mint for', owner)

                    // ensureUser keys on (chain, address) and swallows the unique-constraint
                    // race, so two concurrent mints from one wallet cannot create two users.
                    const userId = await ensureUser(prisma, 'SOLANA', owner)

                    // assetId is the cross-chain identity: the bare mint address on Solana.
                    // Ownership lives on the Nft row itself now rather than through a wallet
                    // join, because an asset's owner changes on transfer while its minter does not.
                    const nft = await prisma.nft.create({
                        data: {
                            chain: 'SOLANA',
                            assetId: makeAssetId('SOLANA', { mintAddress: assetKey }),
                            mintAddress: assetKey,
                            name,
                            metadataUri: uri,
                            ownerAddress: owner,
                            creatorAddress: owner,
                            // Resolved from the metadata JSON rather than taken on trust from the
                            // caller: that URI is what the token actually points at. Without this
                            // the row landed with imageUrl null and category OTHER while the
                            // metadata sitting at the URI held both, so every mint rendered as
                            // "No image available".
                            imageUrl: meta.imageUrl,
                            animationUrl: meta.animationUrl,
                            description: meta.description,
                            category: meta.category,
                            attributes: meta.attributes ?? undefined,
                            imageOk: meta.imageOk,
                        },
                    })
                    if (!meta.imageOk) {
                        console.warn(`[MINT] ${assetKey} image unresolved: ${meta.reason}`)
                    }
                    console.log('Mint DB: nft row created', nft.assetId)

                    await prisma.transaction.create({
                        data: await auditedTransactionData({
                            chain: 'SOLANA',
                            kind: 'MINT',
                            // The mint transaction is returned unsigned for the wallet to sign,
                            // so nothing is confirmed at this point.
                            status: 'PENDING',
                            userId,
                            walletAddress: owner,
                            amount: feeLamports > 0n ? fromBaseUnits(feeLamports, 'SOLANA') : '0',
                            // The verified fee payment, which doubles as the replay guard: this
                            // column is unique, so the same signature cannot fund a second mint.
                            txHash: feeTxSignature ?? null,
                            assetId: nft.assetId,
                            metadata: {
                                source: 'mint',
                                nftRowId: nft.id,
                                paymentMethod: paymentMethod ?? 'self-paid',
                                mintedAt: new Date().toISOString(),
                            },
                        }),
                    })
                    console.log('Mint DB: transaction recorded (PENDING)')
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
