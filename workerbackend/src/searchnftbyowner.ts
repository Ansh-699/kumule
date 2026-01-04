import { Context } from 'hono'
import { fetchAssetsByOwner } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import { getUmi } from './umi'

export const searchNftByOwner = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const ownerAddress = c.req.query('owner')

    if (!ownerAddress) {
        return c.json({ error: 'Please provide an owner address via ?owner=<address>' }, 400)
    }

    // Validate Solana address format
    if (ownerAddress.length < 32 || ownerAddress.length > 44) {
        return c.json({ error: 'Invalid Solana address format' }, 400)
    }

    try {
        // Use public devnet RPC as fallback if API key is invalid
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        
        // If Helius URL but might be invalid, try public RPC first
        if (rpcUrl.includes('helius-rpc.com')) {
            // Keep Helius but will fallback on error
        }
        
        if (!rpcUrl) {
            return c.json({ error: 'SOLANA_RPC_URL not configured' }, 500)
        }

        const umi = getUmi(rpcUrl)
        const owner = publicKey(ownerAddress)
        
        console.log(`Fetching assets for owner: ${ownerAddress}`)
        
        // Fetch assets with timeout
        const assetsByOwner = await Promise.race([
            fetchAssetsByOwner(umi, owner, {
                skipDerivePlugins: false,
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout after 20 seconds')), 20000)
            )
        ]) as any
        
        console.log(`Assets fetched successfully, processing...`)

        // fetchAssetsByOwner returns an object with items array
        let assets: any[] = []
        if (assetsByOwner && typeof assetsByOwner === 'object') {
            // MPL Core returns { items: [...] }
            if (Array.isArray(assetsByOwner.items)) {
                assets = assetsByOwner.items
            } else if (Array.isArray(assetsByOwner)) {
                assets = assetsByOwner
            }
        }
        
        console.log(`Found ${assets.length} assets for owner ${ownerAddress}`)
        
        // Helper to convert BigInt to string for JSON serialization
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
        
        // Transform the assets to match the expected format
        const formattedAssets = assets.map((asset: any) => {
            // Handle different asset formats
            const publicKey = asset.publicKey?.toString() || asset.publicKey || asset.key?.toString() || asset.key
            const name = asset.name || asset.metadata?.name || 'Unnamed NFT'
            const uri = asset.uri || asset.metadata?.uri || ''
            const owner = asset.owner?.toString() || asset.owner || ownerAddress
            const updateAuthority = asset.updateAuthority?.address?.toString() || 
                                  asset.updateAuthority?.toString() || 
                                  asset.updateAuthority

            return {
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
                // Preserve other fields but convert BigInt values
                ...convertBigInt(asset)
            }
        })

        return c.json(formattedAssets, 200)
    } catch (error: any) {
        console.error('Error fetching assets by owner:', error)
        console.error('Error details:', error.message)
        
        // If API key is invalid, try public RPC as fallback
        if (error.message?.includes('401') || error.message?.includes('Invalid API key') || error.message?.includes('Unauthorized')) {
            console.log('API key invalid, trying public devnet RPC...')
            try {
                const publicRpcUrl = 'https://api.devnet.solana.com'
                const umi = getUmi(publicRpcUrl)
                const owner = publicKey(ownerAddress)
                
                const assetsByOwner = await Promise.race([
                    fetchAssetsByOwner(umi, owner, {
                        skipDerivePlugins: false,
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout after 20 seconds')), 20000)
                    )
                ]) as any
                
                console.log('Raw assetsByOwner type:', typeof assetsByOwner)
                console.log('Is array?', Array.isArray(assetsByOwner))
                console.log('Has items?', assetsByOwner?.items ? 'yes' : 'no')
                console.log('Items length:', assetsByOwner?.items?.length || 0)
                
                let assets: any[] = []
                if (Array.isArray(assetsByOwner)) {
                    assets = assetsByOwner
                } else if (assetsByOwner && typeof assetsByOwner === 'object') {
                    if (Array.isArray(assetsByOwner.items)) {
                        assets = assetsByOwner.items
                    } else if (assetsByOwner.items && typeof assetsByOwner.items === 'object') {
                        // Handle paginated response
                        if (Array.isArray(assetsByOwner.items.items)) {
                            assets = assetsByOwner.items.items
                        } else {
                            assets = [assetsByOwner.items]
                        }
                    }
                }
                
                console.log(`Found ${assets.length} assets using public RPC`)
                if (assets.length > 0) {
                    console.log('First asset keys:', Object.keys(assets[0] || {}))
                    console.log('First asset publicKey:', assets[0]?.publicKey?.toString() || assets[0]?.publicKey || 'not found')
                }
                
                // Helper to convert BigInt to string for JSON serialization
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
                
                const formattedAssets = assets.map((asset: any) => {
                    const publicKey = asset.publicKey?.toString() || asset.publicKey || asset.key?.toString() || asset.key
                    const name = asset.name || asset.metadata?.name || 'Unnamed NFT'
                    const uri = asset.uri || asset.metadata?.uri || ''
                    const owner = asset.owner?.toString() || asset.owner || ownerAddress
                    const updateAuthority = asset.updateAuthority?.address?.toString() || 
                                          asset.updateAuthority?.toString() || 
                                          asset.updateAuthority

                    const formatted = {
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
                        ...convertBigInt(asset)
                    }
                    
                    return formatted
                })

                console.log(`Returning ${formattedAssets.length} formatted assets`)
                console.log('Sample formatted asset:', JSON.stringify(formattedAssets[0] || {}).substring(0, 100))
                const response = c.json(formattedAssets, 200)
                console.log('Response created, returning...')
                return response
            } catch (fallbackError: any) {
                console.error('Fallback RPC also failed:', fallbackError.message)
                console.error('Fallback error stack:', fallbackError.stack)
                return c.json([], 200)
            }
        }
        
        if (error.message?.includes('timeout')) {
            console.warn('Request timed out')
            return c.json([], 200)
        }
        
        console.log('Returning empty array due to error:', error.message)
        return c.json([], 200)
    }
}
