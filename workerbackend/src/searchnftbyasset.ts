import { Context } from 'hono'
import { fetchAsset } from '@metaplex-foundation/mpl-core'
import { publicKey as toPublicKey } from '@metaplex-foundation/umi'
import { getUmi } from './umi'
import { isSolanaAddress } from './chains'

export const searchNftByAsset = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const address = c.req.query('asset')

    if (!address) {
        return c.json({ error: 'Please provide an asset address via ?asset=<address>' }, 400)
    }

    // Full base58 validation, not just a length window: a same-length string containing
    // base58-illegal characters (0, O, I, l) used to pass here and fall through to the
    // SOLANA_RPC_URL branch, so a malformed address reported itself as a server
    // misconfiguration (500) instead of a bad request (400).
    if (!isSolanaAddress(address)) {
        return c.json({ error: 'Invalid Solana address format' }, 400)
    }

    try {
        if (!c.env.SOLANA_RPC_URL) {
            return c.json({ error: 'SOLANA_RPC_URL not configured' }, 500)
        }

        const umi = getUmi(c.env.SOLANA_RPC_URL)
        
        console.log(`Fetching asset: ${address}`)
        
        // Fetch asset with timeout
        const asset = await Promise.race([
            fetchAsset(umi, toPublicKey(address), {
                skipDerivePlugins: false,
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout after 20 seconds')), 20000)
            )
        ]) as any
        
        console.log(`Asset fetched successfully`)

        // Format the asset response
        const assetPublicKey = asset.publicKey?.toString() || asset.publicKey || asset.key?.toString() || asset.key
        const name = asset.name || asset.metadata?.name || 'Unnamed NFT'
        const uri = asset.uri || asset.metadata?.uri || ''
        const owner = asset.owner?.toString() || asset.owner
        const updateAuthority = asset.updateAuthority?.address?.toString() || 
                              asset.updateAuthority?.toString() || 
                              asset.updateAuthority

        // Helper to safely serialize values (handles BigInt)
        const safeSerialize = (obj: any): any => {
            if (obj === null || obj === undefined) return obj
            if (typeof obj === 'bigint') return obj.toString()
            if (typeof obj !== 'object') return obj
            if (Array.isArray(obj)) return obj.map(safeSerialize)
            
            const result: any = {}
            for (const [key, value] of Object.entries(obj)) {
                result[key] = safeSerialize(value)
            }
            return result
        }

        const formattedAsset = {
            publicKey: assetPublicKey,
            name,
            uri,
            owner,
            updateAuthority: updateAuthority ? {
                type: asset.updateAuthority?.type || 'program',
                address: updateAuthority
            } : undefined,
            explorerUrl: `https://explorer.solana.com/address/${assetPublicKey}?cluster=devnet`,
            header: asset.header ? safeSerialize(asset.header) : undefined,
            key: asset.key,
            seq: asset.seq ? safeSerialize(asset.seq) : undefined
        }

        return c.json(formattedAsset, 200)
    } catch (error: any) {
        console.error('Error fetching asset:', error)
        
        if (error.message?.includes('timeout')) {
            console.warn('Request timed out')
            return c.json({ error: 'Request timeout' }, 408)
        }
        
        // The provider's own error body is not forwarded. It names which RPC is refusing us -
        // a free health oracle for anyone who asks - and a keyed provider's failure messages
        // can quote the request back. The console line above keeps the detail for operators.
        //
        // An address with nothing at it is the caller's mistake, not ours, so it is a 404.
        const missing = /could not find|account does not exist|Expected a value of type|deserialize/i
            .test(error?.message ?? '')
        return c.json(
            { error: missing ? 'Asset not found' : 'Could not read the asset from chain' },
            missing ? 404 : 502
        )
    }
}
