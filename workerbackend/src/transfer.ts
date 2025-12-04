import { Context } from 'hono'
import { Buffer } from 'buffer'
import { getUmi } from './umi'
import { createNoopSigner, publicKey, signerIdentity } from '@metaplex-foundation/umi'
import { transferV1 } from '@metaplex-foundation/mpl-core'
import { withPrisma, getConnectionString } from './db'

export const transferNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, newOwner, currentOwner, salePrice } = body

        if (!assetId || !newOwner || !currentOwner) {
            return c.text('Missing assetId, newOwner, or currentOwner', 400)
        }

        const numericSalePrice = salePrice !== undefined ? Number(salePrice) : undefined

        if (numericSalePrice !== undefined && (Number.isNaN(numericSalePrice) || numericSalePrice < 0)) {
            return c.text('Invalid salePrice - must be a positive number', 400)
        }

        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const asset = publicKey(assetId)
        const newOwnerKey = publicKey(newOwner)
        const currentOwnerKey = publicKey(currentOwner)

        const currentOwnerSigner = createNoopSigner(currentOwnerKey)

        umi.use(signerIdentity(currentOwnerSigner, true))

        const builder = transferV1(umi, {
            asset,
            newOwner: newOwnerKey,
            authority: currentOwnerSigner,
            collection: undefined,
        })

        const builderWithBlockhash = await builder
            .setFeePayer(currentOwnerSigner)
            .setLatestBlockhash(umi)

        const tx = await builderWithBlockhash.build(umi)

        const serializedTx = umi.transactions.serialize(tx)
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        // Track both sender and receiver in database
        const connectionString = getConnectionString(c.env)
        if (connectionString) {
            try {
                await withPrisma(connectionString, async (prisma) => {
                    // Helper to ensure user exists
                    const ensureUser = async (walletAddress: string) => {
                        let user = await prisma.user.findFirst({
                            where: {
                                wallets: { some: { walletAddress } }
                            }
                        });
                        if (!user) {
                            user = await prisma.user.create({
                                data: {
                                    wallets: {
                                        create: { walletAddress, walletType: 'solana' }
                                    }
                                }
                            });
                        }
                        return user.id
                    }

                    // Track both wallets
                    await ensureUser(currentOwner)
                    const newOwnerUserId = await ensureUser(newOwner)
                    console.log('Transfer DB: Both wallets tracked')

                    // Record transfer transaction if there's a sale price
                    if (numericSalePrice && numericSalePrice > 0) {
                        const nft = await prisma.nft.findUnique({
                            where: { nftId: assetId }
                        })

                        await prisma.transaction.create({
                            data: {
                                transactionId: `transfer_${assetId}_${Date.now()}`,
                                userId: newOwnerUserId,
                                amount: numericSalePrice,
                                nftId: nft?.id || null,
                                transactionType: 'TRANSFER',
                                status: 'PENDING',
                                walletAddress: newOwner,
                                currency: 'SOL',
                                network: 'solana',
                                metadata: JSON.stringify({
                                    source: 'nft_transfer',
                                    assetId: assetId,
                                    from: currentOwner,
                                    to: newOwner,
                                    salePrice: numericSalePrice
                                })
                            }
                        })
                        console.log('Transfer DB: Transaction recorded')
                    }
                })
            } catch (e) {
                console.error('Failed to track transfer in DB:', e)
                // Don't block the transaction
            }
        }

        return c.json({ transaction: base64Tx, salePrice: numericSalePrice ?? null })
    } catch (error) {
        console.error('Transfer error:', error)
        return c.text(`Transfer failed: ${error}`, 500)
    }
}
