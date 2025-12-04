import { Context } from 'hono'
import { Buffer } from 'buffer'
import { getUmi } from './umi'
import { generateSigner, publicKey } from '@metaplex-foundation/umi'
import { createV1, fetchAssetV1 } from '@metaplex-foundation/mpl-core'
import { withPrisma, getConnectionString } from './db'
import { adminAuth } from './admin'

// Mint a reward NFT (admin only)
export const mintRewardNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { name, description, metadataUri, imageUrl, requiredPoints, rewardType, adminWallet, totalSupply } = body

        if (!name || !metadataUri || !requiredPoints || !adminWallet) {
            return c.json({ error: 'Missing required fields: name, metadataUri, requiredPoints, adminWallet' }, 400)
        }

        // Use public RPC as fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)
        
        const adminKey = publicKey(adminWallet)
        const asset = generateSigner(umi)
        const assetKey = asset.publicKey.toString()

        const adminSigner = {
            publicKey: adminKey,
            signMessage: async (msg: Uint8Array) => msg,
            signTransaction: async (tx: any) => tx,
            signAllTransactions: async (txs: any[]) => txs,
        }

        // Build create instruction with RPC fallback
        const createParams: any = {
            asset,
            name,
            uri: metadataUri,
            owner: adminKey,
            authority: adminSigner,
            payer: adminSigner,
        }

        let builder = createV1(umi, createParams)
        let base64Tx: string
        let rewardNft: any
        
        // Try to set blockhash, fallback to public RPC if needed
        try {
            const builderWithBlockhash = await builder
                .setFeePayer(adminSigner)
                .setLatestBlockhash(umi)
            
            const tx = await builderWithBlockhash.build(umi)
            const signedTx = await asset.signTransaction(tx)
            const serializedTx = umi.transactions.serialize(signedTx)
            base64Tx = Buffer.from(serializedTx).toString('base64')
        } catch (rpcError: any) {
            // If RPC fails, try public devnet RPC
            if (rpcError.message?.includes('401') || rpcError.message?.includes('Invalid API key') || rpcError.message?.includes('Unauthorized') || rpcError.message?.includes('failed to get recent blockhash')) {
                console.log('RPC failed, trying public devnet RPC...')
                rpcUrl = 'https://api.devnet.solana.com'
                umi = getUmi(rpcUrl)
                
                builder = createV1(umi, createParams)
                const builderWithBlockhash = await builder
                    .setFeePayer(adminSigner)
                    .setLatestBlockhash(umi)
                
                const tx = await builderWithBlockhash.build(umi)
                const signedTx = await asset.signTransaction(tx)
                const serializedTx = umi.transactions.serialize(signedTx)
                base64Tx = Buffer.from(serializedTx).toString('base64')
            } else {
                throw rpcError
            }
        }

        // Save reward NFT to database
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        rewardNft = await withPrisma(connectionString, async (prisma) => {
            return await prisma.rewardNft.create({
                data: {
                    name,
                    description: description || null,
                    nftAsset: assetKey,
                    metadataUri,
                    imageUrl: imageUrl || null,
                    requiredPoints: parseInt(requiredPoints) || 100,
                    rewardType: rewardType || 'MUSIC_NFT',
                    adminWallet,
                    totalSupply: totalSupply || 1,
                    isActive: true
                }
            })
        })

        return c.json({
            success: true,
            transaction: base64Tx,
            rewardNft: {
                id: rewardNft.id,
                name: rewardNft.name,
                nftAsset: rewardNft.nftAsset,
                requiredPoints: rewardNft.requiredPoints,
                rewardType: rewardNft.rewardType
            }
        })
    } catch (error: any) {
        console.error('Mint reward NFT error:', error)
        return c.json({ error: error.message || 'Failed to mint reward NFT' }, 500)
    }
}

// Get all reward NFTs (admin)
export const getAllRewardNfts = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const rewardNfts = await withPrisma(connectionString, async (prisma) => {
            return await prisma.rewardNft.findMany({
                include: {
                    claimedRewards: {
                        select: {
                            id: true,
                            createdAt: true,
                            rewardAccount: {
                                select: {
                                    walletAddress: true
                                }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            })
        })

        return c.json({ rewardNfts })
    } catch (error: any) {
        console.error('Get reward NFTs error:', error)
        return c.json({ error: error.message || 'Failed to get reward NFTs' }, 500)
    }
}

// Update reward NFT (admin)
export const updateRewardNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { id } = c.req.param()
        const body = await c.req.json()
        const { name, description, requiredPoints, isActive, totalSupply } = body

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const rewardNft = await withPrisma(connectionString, async (prisma) => {
            return await prisma.rewardNft.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(description !== undefined && { description }),
                    ...(requiredPoints && { requiredPoints: parseInt(requiredPoints) }),
                    ...(isActive !== undefined && { isActive }),
                    ...(totalSupply && { totalSupply: parseInt(totalSupply) })
                }
            })
        })

        return c.json({ success: true, rewardNft })
    } catch (error: any) {
        console.error('Update reward NFT error:', error)
        return c.json({ error: error.message || 'Failed to update reward NFT' }, 500)
    }
}

// Delete reward NFT (admin)
export const deleteRewardNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { id } = c.req.param()

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        await withPrisma(connectionString, async (prisma) => {
            await prisma.rewardNft.delete({
                where: { id }
            })
        })

        return c.json({ success: true })
    } catch (error: any) {
        console.error('Delete reward NFT error:', error)
        return c.json({ error: error.message || 'Failed to delete reward NFT' }, 500)
    }
}
