import { Context } from 'hono'
import { fetchAssetsByOwner } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import { getUmi } from './umi'
import { isSolanaAddress } from './chains'

/** BigInt is not JSON-serializable; umi hands back several of them per asset. */
const convertBigInt = (obj: any): any => {
    if (obj === null || obj === undefined) return obj
    if (typeof obj === 'bigint') return obj.toString()
    if (Array.isArray(obj)) return obj.map(convertBigInt)
    if (typeof obj === 'object') {
        const converted: any = {}
        for (const [key, value] of Object.entries(obj)) {
            converted[key] = convertBigInt(value)
        }
        return converted
    }
    return obj
}

/**
 * mpl-core has returned this shape three different ways across versions: a bare array,
 * `{ items: [...] }`, and a paginated `{ items: { items: [...] } }`. The primary and fallback
 * paths used to unwrap it differently - the primary handled only the first two - so the same
 * RPC response could yield assets on the fallback path and an empty list on the primary.
 */
const unwrapAssets = (result: any): any[] => {
    if (Array.isArray(result)) return result
    if (!result || typeof result !== 'object') return []
    if (Array.isArray(result.items)) return result.items
    if (result.items && typeof result.items === 'object') {
        return Array.isArray(result.items.items) ? result.items.items : [result.items]
    }
    return []
}

const fetchAndFormat = async (rpcUrl: string, ownerAddress: string) => {
    const result = await Promise.race([
        fetchAssetsByOwner(getUmi(rpcUrl), publicKey(ownerAddress), { skipDerivePlugins: false }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout after 20 seconds')), 20000)
        )
    ]) as any

    return unwrapAssets(result).map((asset: any) => {
        const assetKey = asset.publicKey?.toString() || asset.publicKey || asset.key?.toString() || asset.key
        const updateAuthority = asset.updateAuthority?.address?.toString() ||
                              asset.updateAuthority?.toString() ||
                              asset.updateAuthority

        return {
            publicKey: assetKey,
            name: asset.name || asset.metadata?.name || 'Unnamed NFT',
            uri: asset.uri || asset.metadata?.uri || '',
            owner: asset.owner?.toString() || asset.owner || ownerAddress,
            updateAuthority: updateAuthority ? {
                type: asset.updateAuthority?.type || 'program',
                address: updateAuthority
            } : undefined,
            // Solana Explorer link for verification
            explorerUrl: `https://explorer.solana.com/address/${assetKey}?cluster=devnet`,
            // Preserve other fields but convert BigInt values
            ...convertBigInt(asset)
        }
    })
}

export const searchNftByOwner = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const ownerAddress = c.req.query('owner')

    if (!ownerAddress) {
        return c.json({ error: 'Please provide an owner address via ?owner=<address>' }, 400)
    }

    // Full base58 validation, not just a length window: a same-length string containing
    // base58-illegal characters (0, O, I, l) used to pass here, throw inside publicKey(),
    // and get swallowed by the catch-all below into a silent `200 []` - indistinguishable
    // from a wallet that genuinely holds nothing.
    if (!isSolanaAddress(ownerAddress)) {
        return c.json({ error: 'Invalid Solana address format' }, 400)
    }

    const rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'

    try {
        console.log(`Fetching assets for owner: ${ownerAddress}`)
        return c.json(await fetchAndFormat(rpcUrl, ownerAddress), 200)
    } catch (error: any) {
        console.error('Error fetching assets by owner:', error?.message ?? error)

        // If the paid RPC key is missing, expired, or revoked, retry against public devnet.
        if (error.message?.includes('401') || error.message?.includes('Invalid API key') || error.message?.includes('Unauthorized')) {
            console.log('API key invalid, trying public devnet RPC...')
            try {
                return c.json(await fetchAndFormat('https://api.devnet.solana.com', ownerAddress), 200)
            } catch (fallbackError: any) {
                console.error('Fallback RPC also failed:', fallbackError?.message ?? fallbackError)
                return c.json([], 200)
            }
        }

        // An RPC that is down or slow means "we don't know what this wallet holds", which this
        // endpoint reports as an empty shelf rather than an error. Malformed input can no
        // longer reach here - it is rejected at 400 above.
        console.log('Returning empty array due to error:', error?.message ?? error)
        return c.json([], 200)
    }
}
