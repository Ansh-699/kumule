import { Context } from 'hono'
import { getUmi } from './umi'
import { createNoopSigner, publicKey, signerIdentity } from '@metaplex-foundation/umi'
import { transferV1 } from '@metaplex-foundation/mpl-core'
import { withPrisma, getConnectionString, ensureUser } from './db'
import { auditedTransactionData } from './audit'

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

        const umi = getUmi(c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com')
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
                    // Both sides get a user row keyed on (chain, address). This is a Solana
                    // asset, so both addresses are Solana and must not be case-folded.
                    await ensureUser(prisma, 'SOLANA', currentOwner)
                    const newOwnerUserId = await ensureUser(prisma, 'SOLANA', newOwner)
                    console.log('Transfer DB: both wallets tracked')

                    if (numericSalePrice && numericSalePrice > 0) {
                        // The asset is looked up but not linked: Transaction no longer holds an
                        // nftId column, so the asset reference travels in metadata.assetId.
                        const nft = await prisma.nft.findUnique({ where: { assetId } })

                        await prisma.transaction.create({
                            data: await auditedTransactionData({
                                chain: 'SOLANA',
                                kind: 'TRANSFER',
                                status: 'PENDING',
                                userId: newOwnerUserId,
                                walletAddress: newOwner,
                                // Passed as a string so the Decimal column is built from exact
                                // digits rather than a float.
                                amount: String(numericSalePrice),
                                assetId,
                                metadata: {
                                    source: 'nft_transfer',
                                    nftRowId: nft?.id ?? null,
                                    from: currentOwner,
                                    to: newOwner,
                                    salePrice: String(numericSalePrice),
                                },
                            }),
                        })
                        console.log('Transfer DB: transaction recorded')
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
