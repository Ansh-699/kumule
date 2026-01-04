import { Context } from 'hono'
import { fetchAsset } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import { getUmi } from './umi'

export const searchNftByAsset = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const address = c.req.query('asset')

    if (!address) {
        return c.json({ error: 'Please provide an asset address via ?asset=<address>' }, 400)
    }

    // Validate Solana address format
    if (address.length < 32 || address.length > 44) {
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
            fetchAsset(umi, publicKey(address), {
                skipDerivePlugins: false,
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout after 20 seconds')), 20000)
            )
        ]) as any
        
        console.log(`Asset fetched successfully`)

        // Format the asset response
        const publicKey = asset.publicKey?.toString() || asset.publicKey || asset.key?.toString() || asset.key
        const name = asset.name || asset.metadata?.name || 'Unnamed NFT'
        const uri = asset.uri || asset.metadata?.uri || ''
        const owner = asset.owner?.toString() || asset.owner
        const updateAuthority = asset.updateAuthority?.address?.toString() || 
                              asset.updateAuthority?.toString() || 
                              asset.updateAuthority

        const formattedAsset = {
            publicKey,
            name,
            uri,
            owner,
            updateAuthority: updateAuthority ? {
                type: asset.updateAuthority?.type || 'program',
                address: updateAuthority
            } : undefined,
            // Solana Explorer link for verification
            explorerUrl: `https://explorer.solana.com/address/${publicKey}?cluster=devnet`,
            // Preserve other fields
            ...asset
        }

        return c.json(formattedAsset, 200)
    } catch (error: any) {
        console.error('Error fetching asset:', error)
        
        if (error.message?.includes('timeout')) {
            console.warn('Request timed out')
            return c.json({ error: 'Request timeout' }, 408)
        }
        
        return c.json({ 
            error: 'Error fetching asset',
            message: error.message 
        }, 500)
    }
}
