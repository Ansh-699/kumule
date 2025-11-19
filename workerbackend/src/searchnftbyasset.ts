import { Context } from 'hono'
import { fetchAsset } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import { getUmi } from './umi'

export const searchNftByAsset = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const address = c.req.query('asset')

    if (!address) {
        return c.text('Please provide an asset address via ?asset=<address>')
    }

    try {
        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const asset = await fetchAsset(umi, publicKey(address), {
            skipDerivePlugins: false,
        })

        return c.text(JSON.stringify(asset, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ), 200, {
            'Content-Type': 'application/json',
        })
    } catch (error) {
        console.error('Error fetching asset:', error)
        return c.text('Error fetching asset. Check logs for details.', 500)
    }
}
