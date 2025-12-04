
import { Context } from 'hono'
import { Buffer } from 'buffer'
import { getUmi } from './umi'
import { generateSigner, publicKey } from '@metaplex-foundation/umi'
import { createV1 } from '@metaplex-foundation/mpl-core'
import { base58 } from '@metaplex-foundation/umi/serializers'

import { checkChargeStatus } from './payment'
import { withPrisma, getConnectionString } from './db'

export const mintNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { uri, name, owner, collection, paymentMethod, chargeId } = body

        if (!uri || !name || !owner) {
            return c.text('Missing required fields: uri, name, owner', 400)
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

        if (!c.env.SOLANA_RPC_URL) {
            console.error('SOLANA_RPC_URL is not set')
            return c.text('Server configuration error: SOLANA_RPC_URL is missing', 500)
        }

        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const ownerKey = publicKey(owner)
        const asset = generateSigner(umi)
        const assetKey = asset.publicKey.toString();

        // Record mint in database
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

                        // 3. Link Transaction if applicable (for Coinbase payments)
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

        const builder = createV1(umi, createParams)

        const builderWithBlockhash = await builder
            .setFeePayer(userSigner)
            .setLatestBlockhash(umi)

        const tx = await builderWithBlockhash.build(umi)

        const signedTx = await asset.signTransaction(tx)

        const serializedTx = umi.transactions.serialize(signedTx)
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        return c.json({
            transaction: base64Tx,
            mint: asset.publicKey.toString()
        })

    } catch (error) {
        console.error('Mint error:', error)
        return c.text(`Mint failed: ${error} `, 500)
    }
}
