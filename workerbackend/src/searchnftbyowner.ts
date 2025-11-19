import { Context } from 'hono'
import { fetchAssetsByOwner } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import { getUmi } from './umi'

export const searchNftByOwner = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const ownerAddress = c.req.query('owner')

    if (!ownerAddress) {
        return c.text('Please provide an owner address via ?owner=<address>')
    }

    try {
        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const owner = publicKey(ownerAddress)
        const assetsByOwner = await fetchAssetsByOwner(umi, owner, {
            skipDerivePlugins: false,
        })

        return c.text(JSON.stringify(assetsByOwner, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ), 200, {
            'Content-Type': 'application/json',
        })
    } catch (error: any) {
        console.error('Error fetching assets by owner:', error)
        return c.json({
            error: 'Error fetching assets by owner',
            message: error.message,
            stack: error.stack,
            details: error
        }, 500)
    }
}
