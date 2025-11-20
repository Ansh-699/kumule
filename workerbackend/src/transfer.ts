import { Context } from 'hono'
import { Buffer } from 'buffer'
import { getUmi } from './umi'
import { createNoopSigner, publicKey, signerIdentity } from '@metaplex-foundation/umi'
import { transferV1 } from '@metaplex-foundation/mpl-core'

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

        return c.json({ transaction: base64Tx, salePrice: numericSalePrice ?? null })
    } catch (error) {
        console.error('Transfer error:', error)
        return c.text(`Transfer failed: ${error}`, 500)
    }
}
