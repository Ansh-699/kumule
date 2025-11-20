import { Context } from 'hono'
import { Buffer } from 'buffer'
import { getUmi } from './umi'
import { generateSigner, publicKey } from '@metaplex-foundation/umi'
import { createV1 } from '@metaplex-foundation/mpl-core'
import { base58 } from '@metaplex-foundation/umi/serializers'

export const mintNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { uri, name, owner } = body

        if (!uri || !name || !owner) {
            return c.text('Missing required fields: uri, name, owner', 400)
        }

        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const ownerKey = publicKey(owner)
        const asset = generateSigner(umi)

        const userSigner = {
            publicKey: ownerKey,
            signMessage: async (msg: Uint8Array) => msg,
            signTransaction: async (tx: any) => tx,
            signAllTransactions: async (txs: any[]) => txs,
        }

        const builder = createV1(umi, {
            asset,
            name,
            uri,
            owner: ownerKey,
            authority: userSigner, 
            payer: userSigner,
        })

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
        return c.text(`Mint failed: ${error}`, 500)
    }
}
