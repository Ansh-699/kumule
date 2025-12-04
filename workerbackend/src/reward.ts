import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import { getUmi } from './umi'
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'

// Reward program ID - placeholder until deployed
// Lazy initialization to avoid module-level PublicKey creation
const getRewardProgramId = () => new PublicKey('11111111111111111111111111111111')

// Reward System IDL (simplified - will be generated after deployment)
const REWARD_IDL = {
    version: "0.1.0",
    name: "reward_system",
    instructions: [
        {
            name: "initializeReward",
            accounts: [
                { name: "user", isMut: true, isSigner: true },
                { name: "reward", isMut: true, isSigner: false },
                { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: []
        },
        {
            name: "recordInteraction",
            accounts: [
                { name: "authority", isMut: false, isSigner: true },
                { name: "reward", isMut: true, isSigner: false }
            ],
            args: [{ name: "points", type: "u64" }]
        },
        {
            name: "claimNftReward",
            accounts: [
                { name: "user", isMut: false, isSigner: true },
                { name: "reward", isMut: true, isSigner: false },
                { name: "nftAsset", isMut: true, isSigner: false },
                { name: "rewardVault", isMut: false, isSigner: false },
                { name: "systemProgram", isMut: false, isSigner: false }
            ],
            args: [{ name: "requiredPoints", type: "u64" }]
        }
    ]
}

// Get or create reward account for user
export const getOrCreateRewardAccount = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        console.log('getOrCreateRewardAccount called')
        
        // Try query param first (GET request), then body (POST request)
        let walletAddress = c.req.query('walletAddress')
        
        if (!walletAddress) {
            try {
                const body = await c.req.json().catch(() => ({}))
                walletAddress = body.walletAddress
            } catch (e) {
                // Ignore JSON parse errors
            }
        }
        
        if (!walletAddress) {
            return c.json({ error: 'walletAddress is required' }, 400)
        }
        
        console.log('Wallet address:', walletAddress)

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        // Add timeout wrapper for database operations
        const dbPromise = withPrisma(connectionString, async (prisma) => {
            console.log('Finding or creating user for wallet:', walletAddress)
            // Find or create user
            let user = await prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress: walletAddress }
                    }
                },
                include: { wallets: true }
            })

            if (!user) {
                console.log('Creating new user for wallet:', walletAddress)
                user = await prisma.user.create({
                    data: {
                        wallets: {
                            create: {
                                walletAddress: walletAddress,
                                walletType: 'solana'
                            }
                        }
                    },
                    include: { wallets: true }
                })
            }

            console.log('Finding or creating reward account for user:', user.id)
            // Get or create reward account
            let rewardAccount = await prisma.rewardAccount.findUnique({
                where: { userId: user.id },
                include: {
                    interactions: {
                        orderBy: { createdAt: 'desc' },
                        take: 10
                    },
                    claimedRewards: {
                        orderBy: { createdAt: 'desc' },
                        take: 10
                    }
                }
            })

            if (!rewardAccount) {
                console.log('Creating new reward account for user:', user.id)
                rewardAccount = await prisma.rewardAccount.create({
                    data: {
                        userId: user.id,
                        walletAddress: walletAddress,
                        interactionCount: 0,
                        claimedNfts: 0
                    },
                    include: {
                        interactions: true,
                        claimedRewards: true
                    }
                })
            }

            console.log('Reward account found/created:', rewardAccount.id)
            return {
                rewardAccount: {
                    id: rewardAccount.id,
                    userId: rewardAccount.userId,
                    walletAddress: rewardAccount.walletAddress,
                    interactionCount: rewardAccount.interactionCount,
                    claimedNfts: rewardAccount.claimedNfts,
                    lastInteractionAt: rewardAccount.lastInteractionAt,
                    createdAt: rewardAccount.createdAt,
                    recentInteractions: rewardAccount.interactions,
                    recentClaims: rewardAccount.claimedRewards
                }
            }
        })
        
        // Add timeout
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database operation timeout')), 15000)
        )
        
        const result = await Promise.race([dbPromise, timeoutPromise])
        return c.json(result)
    } catch (error: any) {
        console.error('Error in getOrCreateRewardAccount:', error)
        const errorMessage = error.message || 'Failed to get reward account'
        console.error('Error details:', errorMessage, error.stack)
        return c.json({ 
            error: errorMessage,
            rewardAccount: null 
        }, error.message?.includes('timeout') ? 408 : 500)
    }
}

// Fill meter (admin) - add points to user's reward account
export const fillMeter = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { walletAddress, points } = await c.req.json()
        
        if (!walletAddress || !points) {
            return c.json({ error: 'Wallet address and points are required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const result = await withPrisma(connectionString, async (prisma) => {
            // Find user
            const user = await prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress: walletAddress }
                    }
                }
            })

            if (!user) {
                return { error: 'User not found' }
            }

            // Get or create reward account
            let rewardAccount = await prisma.rewardAccount.findUnique({
                where: { userId: user.id }
            })

            if (!rewardAccount) {
                rewardAccount = await prisma.rewardAccount.create({
                    data: {
                        userId: user.id,
                        walletAddress: walletAddress,
                        interactionCount: parseInt(points) || 0,
                        claimedNfts: 0
                    }
                })
            } else {
                // Update points
                rewardAccount = await prisma.rewardAccount.update({
                    where: { id: rewardAccount.id },
                    data: {
                        interactionCount: {
                            increment: parseInt(points) || 0
                        }
                    }
                })
            }

            return {
                success: true,
                rewardAccount: {
                    interactionCount: rewardAccount.interactionCount,
                    claimedNfts: rewardAccount.claimedNfts
                }
            }
        })

        if (result.error) {
            return c.json(result, 404)
        }

        return c.json(result)
    } catch (error: any) {
        console.error('Fill meter error:', error)
        return c.json({ error: error.message || 'Failed to fill meter' }, 500)
    }
}

// Reset meter (admin) - reset user's points to 0
export const resetMeter = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { walletAddress } = await c.req.json()
        
        if (!walletAddress) {
            return c.json({ error: 'Wallet address is required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const result = await withPrisma(connectionString, async (prisma) => {
            // Find user
            const user = await prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress: walletAddress }
                    }
                }
            })

            if (!user) {
                return { error: 'User not found' }
            }

            // Get reward account
            const rewardAccount = await prisma.rewardAccount.findUnique({
                where: { userId: user.id }
            })

            if (!rewardAccount) {
                return { error: 'Reward account not found' }
            }

            // Reset points
            const updatedReward = await prisma.rewardAccount.update({
                where: { id: rewardAccount.id },
                data: {
                    interactionCount: 0
                }
            })

            return {
                success: true,
                rewardAccount: {
                    interactionCount: updatedReward.interactionCount,
                    claimedNfts: updatedReward.claimedNfts
                }
            }
        })

        if (result.error) {
            return c.json(result, 404)
        }

        return c.json(result)
    } catch (error: any) {
        console.error('Reset meter error:', error)
        return c.json({ error: error.message || 'Failed to reset meter' }, 500)
    }
}

// Record interaction (add points)
export const recordInteraction = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { walletAddress, interactionType, points = 1, metadata } = await c.req.json()
        
        if (!walletAddress) {
            return c.json({ error: 'Wallet address required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const result = await withPrisma(connectionString, async (prisma) => {
            // Find user
            const user = await prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress: walletAddress }
                    }
                }
            })

            if (!user) {
                return { error: 'User not found' }
            }

            // Get or create reward account
            let rewardAccount = await prisma.rewardAccount.findUnique({
                where: { userId: user.id }
            })

            if (!rewardAccount) {
                rewardAccount = await prisma.rewardAccount.create({
                    data: {
                        userId: user.id,
                        walletAddress: walletAddress,
                        interactionCount: 0,
                        claimedNfts: 0
                    }
                })
            }

            // Record interaction
            const interaction = await prisma.interaction.create({
                data: {
                    rewardAccountId: rewardAccount.id,
                    interactionType: interactionType || 'CLICK',
                    points: points,
                    metadata: metadata ? JSON.stringify(metadata) : null
                }
            })

            // Update reward account
            const updatedReward = await prisma.rewardAccount.update({
                where: { id: rewardAccount.id },
                data: {
                    interactionCount: {
                        increment: points
                    },
                    lastInteractionAt: new Date()
                },
                include: {
                    interactions: {
                        orderBy: { createdAt: 'desc' },
                        take: 5
                    }
                }
            })

            return {
                success: true,
                rewardAccount: {
                    interactionCount: updatedReward.interactionCount,
                    claimedNfts: updatedReward.claimedNfts,
                    lastInteractionAt: updatedReward.lastInteractionAt
                },
                interaction: {
                    id: interaction.id,
                    points: interaction.points,
                    type: interaction.interactionType,
                    createdAt: interaction.createdAt
                }
            }
        })

        if (result.error) {
            return c.json(result, 404)
        }

        return c.json(result)
    } catch (error: any) {
        console.error('Record interaction error:', error)
        return c.json({ error: error.message || 'Failed to record interaction' }, 500)
    }
}

// Claim NFT reward - transfers NFT from admin vault to user
export const claimNftReward = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { walletAddress, rewardNftId } = await c.req.json()
        
        if (!walletAddress || !rewardNftId) {
            return c.json({ error: 'Wallet address and reward NFT ID are required' }, 400)
        }

        if (!c.env.SOLANA_RPC_URL) {
            return c.json({ error: 'SOLANA_RPC_URL not configured' }, 500)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        // Use public RPC as fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)

        const result = await withPrisma(connectionString, async (prisma) => {
            // Find user
            const user = await prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress: walletAddress }
                    }
                },
                include: { wallets: true }
            })

            if (!user) {
                return { error: 'User not found' }
            }

            // Get reward account
            const rewardAccount = await prisma.rewardAccount.findUnique({
                where: { userId: user.id }
            })

            if (!rewardAccount) {
                return { error: 'Reward account not found' }
            }

            // Get reward NFT
            const rewardNft = await prisma.rewardNft.findUnique({
                where: { id: rewardNftId }
            })

            if (!rewardNft) {
                return { error: 'Reward NFT not found' }
            }

            if (!rewardNft.isActive) {
                return { error: 'Reward NFT is not active' }
            }

            // Check if supply is available
            if (rewardNft.claimedCount >= rewardNft.totalSupply) {
                return { error: 'Reward NFT is out of supply' }
            }

            // Check if user has enough points
            if (rewardAccount.interactionCount < rewardNft.requiredPoints) {
                return { 
                    error: 'Insufficient points',
                    required: rewardNft.requiredPoints,
                    available: rewardAccount.interactionCount
                }
            }

            // Transfer NFT from admin vault to user with RPC fallback
            const { transferV1 } = await import('@metaplex-foundation/mpl-core')
            const { createNoopSigner, signerIdentity, publicKey: umiPublicKey } = await import('@metaplex-foundation/umi')

            const adminKey = umiPublicKey(rewardNft.adminWallet)
            const userKey = umiPublicKey(walletAddress)
            const assetKey = umiPublicKey(rewardNft.nftAsset)

            const adminSigner = createNoopSigner(adminKey)
            
            let base64Tx: string
            
            // Try to build transaction with RPC fallback
            try {
                umi.use(signerIdentity(adminSigner, true))

                const builder = transferV1(umi, {
                    asset: assetKey,
                    newOwner: userKey,
                    authority: adminSigner,
                })

                const builderWithBlockhash = await builder
                    .setFeePayer(adminSigner)
                    .setLatestBlockhash(umi)

                const tx = await builderWithBlockhash.build(umi)
                const serializedTx = umi.transactions.serialize(tx)
                base64Tx = Buffer.from(serializedTx).toString('base64')
            } catch (rpcError: any) {
                // If RPC fails, try public devnet RPC
                if (rpcError.message?.includes('401') || rpcError.message?.includes('Invalid API key') || rpcError.message?.includes('Unauthorized') || rpcError.message?.includes('failed to get recent blockhash')) {
                    console.log('RPC failed in claimNftReward, trying public devnet RPC...')
                    rpcUrl = 'https://api.devnet.solana.com'
                    umi = getUmi(rpcUrl)
                    umi.use(signerIdentity(adminSigner, true))

                    const builder = transferV1(umi, {
                        asset: assetKey,
                        newOwner: userKey,
                        authority: adminSigner,
                    })

                    const builderWithBlockhash = await builder
                        .setFeePayer(adminSigner)
                        .setLatestBlockhash(umi)

                    const tx = await builderWithBlockhash.build(umi)
                    const serializedTx = umi.transactions.serialize(tx)
                    base64Tx = Buffer.from(serializedTx).toString('base64')
                } else {
                    throw rpcError
                }
            }

            // Create claimed reward record
            const claimedReward = await prisma.claimedReward.create({
                data: {
                    rewardAccountId: rewardAccount.id,
                    rewardNftId: rewardNft.id,
                    nftAsset: rewardNft.nftAsset,
                    pointsUsed: rewardNft.requiredPoints,
                    rewardType: rewardNft.rewardType,
                    metadata: JSON.stringify({
                        rewardNftName: rewardNft.name,
                        claimedAt: new Date().toISOString()
                    })
                }
            })

            // Update reward account
            const updatedReward = await prisma.rewardAccount.update({
                where: { id: rewardAccount.id },
                data: {
                    interactionCount: {
                        decrement: rewardNft.requiredPoints
                    },
                    claimedNfts: {
                        increment: 1
                    }
                }
            })

            // Update reward NFT claimed count
            await prisma.rewardNft.update({
                where: { id: rewardNft.id },
                data: {
                    claimedCount: {
                        increment: 1
                    }
                }
            })

            return {
                success: true,
                transaction: base64Tx,
                claimedReward: {
                    id: claimedReward.id,
                    nftAsset: claimedReward.nftAsset,
                    pointsUsed: claimedReward.pointsUsed,
                    rewardType: claimedReward.rewardType,
                    createdAt: claimedReward.createdAt
                },
                rewardAccount: {
                    interactionCount: updatedReward.interactionCount,
                    claimedNfts: updatedReward.claimedNfts
                }
            }
        })

        if (result.error) {
            return c.json(result, result.error === 'User not found' || result.error === 'Reward account not found' ? 404 : 400)
        }

        return c.json(result)
    } catch (error: any) {
        console.error('Claim NFT reward error:', error)
        return c.json({ error: error.message || 'Failed to claim NFT reward' }, 500)
    }
}

// Get available NFT rewards (for display) - fetch from database and listed drafts
export const getAvailableRewards = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const rewards = await withPrisma(connectionString, async (prisma) => {
            // Get minted reward NFTs
            const mintedRewards = await prisma.rewardNft.findMany({
                where: {
                    isActive: true
                },
                orderBy: { requiredPoints: 'asc' }
            })

            // Get listed drafts (drafts that are marked as listed)
            const listedDrafts = await prisma.rewardDraft.findMany({
                where: {
                    isListed: true
                },
                orderBy: { requiredPoints: 'asc' }
            })

            // Convert drafts to reward format
            const draftRewards = listedDrafts.map(draft => ({
                id: draft.id,
                name: draft.name,
                description: draft.description,
                requiredPoints: draft.requiredPoints,
                rewardType: draft.rewardType,
                nftAsset: '', // Not minted yet
                imageUrl: draft.imageUrl,
                metadataUri: draft.metadataUri,
                totalSupply: draft.totalSupply,
                claimedCount: 0,
                isActive: true,
                isDraft: true // Flag to indicate this is a draft
            }))

            // Combine minted rewards and listed drafts
            return [...mintedRewards, ...draftRewards].sort((a, b) => a.requiredPoints - b.requiredPoints)
        })

        return c.json({ rewards })
    } catch (error: any) {
        console.error('Get available rewards error:', error)
        return c.json({ error: error.message || 'Failed to get available rewards' }, 500)
    }
}

