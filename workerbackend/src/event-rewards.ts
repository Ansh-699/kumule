import { Context } from 'hono'
import { withPrisma, getConnectionString, ensureUserExists } from './db'
import { getUmi } from './umi'
import { transferV1 } from '@metaplex-foundation/mpl-core'
import { publicKey as umiPublicKey, keypairIdentity } from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { verifySolanaTransaction } from './webhook'

// Claim fee in SOL (covers NFT transfer gas)
const CLAIM_FEE_SOL = 0.002 // ~0.002 SOL for transfer

/**
 * Get user's progress for a specific event
 */
export const getEventProgress = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')
        const walletAddress = c.req.query('walletAddress')

        if (!eventId || !walletAddress) {
            return c.json({ error: 'Event ID and wallet address are required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        console.log(`[EVENT-REWARDS] Getting progress for event=${eventId}, wallet=${walletAddress}`)

        const result = await withPrisma(connectionString, async (prisma) => {
            // Find user
            const user = await prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress }
                    }
                }
            })

            if (!user) {
                console.log(`[EVENT-REWARDS] User not found for wallet=${walletAddress}`)
                return { 
                    progress: null, 
                    rewards: [], 
                    claims: [],
                    hasJoined: false 
                }
            }

            // Check if user has joined the event
            const eventEntry = await prisma.eventEntry.findFirst({
                where: {
                    eventId,
                    userId: user.id
                }
            })

            // Get or create progress
            let progress = await prisma.eventUserProgress.findUnique({
                where: {
                    userId_eventId: {
                        userId: user.id,
                        eventId
                    }
                }
            })

            // If user joined but has no progress, create initial progress
            if (eventEntry && !progress) {
                console.log(`[EVENT-REWARDS] Creating initial progress for user=${user.id}, event=${eventId}`)
                progress = await prisma.eventUserProgress.create({
                    data: {
                        userId: user.id,
                        eventId,
                        walletAddress,
                        totalPoints: 10, // Points for joining
                        tasksCompleted: 1
                    }
                })
            }

            // Get available rewards for this event
            const rewards = await prisma.eventRewardNft.findMany({
                where: {
                    eventId,
                    isActive: true
                },
                orderBy: { requiredPoints: 'asc' }
            })

            // Get user's claims for this event
            const claims = await prisma.eventRewardClaim.findMany({
                where: {
                    eventId,
                    userId: user.id
                },
                include: {
                    rewardNft: true
                }
            })

            console.log(`[EVENT-REWARDS] Progress: points=${progress?.totalPoints || 0}, rewards=${rewards.length}, claims=${claims.length}`)

            return {
                progress: progress ? {
                    id: progress.id,
                    totalPoints: progress.totalPoints,
                    tasksCompleted: progress.tasksCompleted,
                    createdAt: progress.createdAt,
                    updatedAt: progress.updatedAt
                } : null,
                rewards: rewards.map(r => ({
                    id: r.id,
                    medalType: r.medalType,
                    name: r.name,
                    description: r.description,
                    imageUrl: r.imageUrl,
                    requiredPoints: r.requiredPoints,
                    totalSupply: r.totalSupply,
                    claimedCount: r.claimedCount,
                    available: r.totalSupply - r.claimedCount,
                    nftAsset: r.nftAsset
                })),
                claims: claims.map(cl => ({
                    id: cl.id,
                    medalType: cl.rewardNft?.medalType,
                    nftAsset: cl.nftAsset,
                    pointsUsed: cl.pointsUsed,
                    txHash: cl.txHash,
                    claimedAt: cl.claimedAt
                })),
                hasJoined: !!eventEntry,
                claimFee: CLAIM_FEE_SOL
            }
        })

        return c.json(result)
    } catch (e: any) {
        console.error('[EVENT-REWARDS] Get progress error:', e)
        return c.json({ error: e.message }, 500)
    }
}

/**
 * Add points to user's event progress
 */
export const addEventPoints = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')
        const { walletAddress, points, reason } = await c.req.json()

        if (!eventId || !walletAddress || !points) {
            return c.json({ error: 'Event ID, wallet address, and points are required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        console.log(`[EVENT-REWARDS] Adding ${points} points for event=${eventId}, wallet=${walletAddress}, reason=${reason || 'manual'}`)

        const result = await withPrisma(connectionString, async (prisma) => {
            // Find or create user
            const userId = await ensureUserExists(prisma, walletAddress)

            // Check if user has joined the event
            const eventEntry = await prisma.eventEntry.findFirst({
                where: {
                    eventId,
                    userId
                }
            })

            if (!eventEntry) {
                return { error: 'User has not joined this event' }
            }

            // Upsert progress
            const progress = await prisma.eventUserProgress.upsert({
                where: {
                    userId_eventId: {
                        userId,
                        eventId
                    }
                },
                update: {
                    totalPoints: {
                        increment: points
                    },
                    tasksCompleted: {
                        increment: 1
                    }
                },
                create: {
                    userId,
                    eventId,
                    walletAddress,
                    totalPoints: points,
                    tasksCompleted: 1
                }
            })

            console.log(`[EVENT-REWARDS] Points added. New total: ${progress.totalPoints}`)

            return {
                success: true,
                progress: {
                    totalPoints: progress.totalPoints,
                    tasksCompleted: progress.tasksCompleted
                },
                pointsAdded: points,
                reason: reason || 'manual'
            }
        })

        if (result.error) {
            return c.json(result, 400)
        }

        return c.json(result)
    } catch (e: any) {
        console.error('[EVENT-REWARDS] Add points error:', e)
        return c.json({ error: e.message }, 500)
    }
}

/**
 * Create claim transaction for event reward NFT
 * User must pay claim fee before NFT is transferred
 */
export const claimEventReward = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')
        const rewardId = c.req.param('rewardId')
        const { walletAddress, feeTxHash } = await c.req.json()

        if (!eventId || !rewardId || !walletAddress) {
            return c.json({ error: 'Event ID, reward ID, and wallet address are required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        console.log(`[EVENT-REWARDS] Claim request: event=${eventId}, reward=${rewardId}, wallet=${walletAddress}`)

        const result = await withPrisma(connectionString, async (prisma) => {
            // Find user
            const user = await prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress }
                    }
                }
            })

            if (!user) {
                return { error: 'User not found' }
            }

            // Get event and reward
            const event = await prisma.event.findUnique({
                where: { id: eventId }
            })

            if (!event) {
                return { error: 'Event not found' }
            }

            const rewardNft = await prisma.eventRewardNft.findUnique({
                where: { id: rewardId }
            })

            if (!rewardNft) {
                return { error: 'Reward NFT not found' }
            }

            if (!rewardNft.isActive) {
                return { error: 'Reward NFT is no longer active' }
            }

            if (!rewardNft.nftAsset) {
                return { error: 'Reward NFT has not been minted yet' }
            }

            // Check supply
            if (rewardNft.claimedCount >= rewardNft.totalSupply) {
                return { error: 'All rewards have been claimed' }
            }

            // Check if user already claimed this reward type for this event
            const existingClaim = await prisma.eventRewardClaim.findFirst({
                where: {
                    userId: user.id,
                    eventId,
                    rewardNftId: rewardId
                }
            })

            if (existingClaim) {
                return { error: 'You have already claimed this reward' }
            }

            // Get user's progress
            const progress = await prisma.eventUserProgress.findUnique({
                where: {
                    userId_eventId: {
                        userId: user.id,
                        eventId
                    }
                }
            })

            if (!progress) {
                return { error: 'You have not participated in this event' }
            }

            // Check if user has enough points
            if (progress.totalPoints < rewardNft.requiredPoints) {
                return { 
                    error: 'Insufficient points',
                    required: rewardNft.requiredPoints,
                    current: progress.totalPoints
                }
            }

            console.log(`[EVENT-REWARDS] User has ${progress.totalPoints} points, needs ${rewardNft.requiredPoints}`)

            // If no fee transaction provided, return the required fee
            if (!feeTxHash) {
                return {
                    requiresFee: true,
                    claimFee: CLAIM_FEE_SOL,
                    adminWallet: event.creatorWallet, // Fee goes to event creator
                    message: 'Please pay the claim fee to receive your NFT'
                }
            }

            // The NFT transfer below is signed and sent with the admin key, so an unverified
            // feeTxHash meant any string ("x") claimed a real NFT for free.
            const feeOk = await verifySolanaTransaction(
                c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
                feeTxHash
            )
            if (!feeOk) {
                return { error: 'Claim fee transaction could not be verified on-chain' }
            }

            // ponytail: verifies the fee tx exists and succeeded, not that it paid CLAIM_FEE_SOL to
            // event.creatorWallet, and not that it is single-use - so any successful signature the
            // caller knows is currently accepted, and one fee can cover a gold+silver+bronze sweep.
            // Upgrade when rewards have value: parse the tx for a transfer of >= CLAIM_FEE_SOL to
            // event.creatorWallet, and add a unique feeTxHash column on EventRewardClaim.
            console.log(`[EVENT-REWARDS] Fee verified, transferring NFT. feeTxHash=${feeTxHash}`)

            // Build NFT transfer transaction
            const rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
            let umi = getUmi(rpcUrl)

            const privateKeyBase58 = c.env.ADMIN_WALLET_PRIVATE_KEY
            if (!privateKeyBase58) {
                return { error: 'Admin wallet not configured for transfers' }
            }

            // Set up admin keypair
            const privateKeyBytes = base58.serialize(privateKeyBase58)
            const adminKeypair = umi.eddsa.createKeypairFromSecretKey(privateKeyBytes)
            umi = umi.use(keypairIdentity(adminKeypair))

            const assetKey = umiPublicKey(rewardNft.nftAsset)
            const userKey = umiPublicKey(walletAddress)

            // Build transfer transaction
            const builder = transferV1(umi, {
                asset: assetKey,
                newOwner: userKey,
            })

            const builderWithBlockhash = await builder.setLatestBlockhash(umi)
            const tx = await builderWithBlockhash.build(umi)
            
            // Sign and send transaction
            const signedTx = await umi.identity.signTransaction(tx)
            const signature = await umi.rpc.sendTransaction(signedTx)
            const transferTxHash = base58.deserialize(signature)[0]

            console.log(`[EVENT-REWARDS] NFT transferred! txHash=${transferTxHash}`)

            // Record the claim
            const claim = await prisma.eventRewardClaim.create({
                data: {
                    rewardNftId: rewardId,
                    userId: user.id,
                    eventId,
                    walletAddress,
                    nftAsset: rewardNft.nftAsset,
                    txHash: transferTxHash,
                    pointsUsed: rewardNft.requiredPoints
                }
            })

            // Update reward claimed count
            await prisma.eventRewardNft.update({
                where: { id: rewardId },
                data: {
                    claimedCount: {
                        increment: 1
                    }
                }
            })

            // Deduct points from user (optional - depends on your design)
            // await prisma.eventUserProgress.update({
            //     where: { userId_eventId: { userId: user.id, eventId } },
            //     data: {
            //         totalPoints: { decrement: rewardNft.requiredPoints }
            //     }
            // })

            return {
                success: true,
                claim: {
                    id: claim.id,
                    medalType: rewardNft.medalType,
                    nftAsset: claim.nftAsset,
                    txHash: claim.txHash,
                    pointsUsed: claim.pointsUsed,
                    claimedAt: claim.claimedAt
                }
            }
        })

        if (result.error) {
            const status = result.error === 'User not found' || result.error === 'Event not found' 
                ? 404 : 400
            return c.json(result, status)
        }

        return c.json(result)
    } catch (e: any) {
        console.error('[EVENT-REWARDS] Claim error:', e)
        return c.json({ error: e.message }, 500)
    }
}

/**
 * Admin: Update event reward config
 */
export const updateEventRewardConfig = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')
        const body = await c.req.json()

        if (!eventId) {
            return c.json({ error: 'Event ID is required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const result = await withPrisma(connectionString, async (prisma) => {
            const updated = await prisma.eventRewardConfig.update({
                where: { eventId },
                data: {
                    goldSupply: body.goldSupply,
                    goldPoints: body.goldPoints,
                    goldName: body.goldName,
                    goldImageUrl: body.goldImageUrl,
                    silverSupply: body.silverSupply,
                    silverPoints: body.silverPoints,
                    silverName: body.silverName,
                    silverImageUrl: body.silverImageUrl,
                    bronzeSupply: body.bronzeSupply,
                    bronzePoints: body.bronzePoints,
                    bronzeName: body.bronzeName,
                    bronzeImageUrl: body.bronzeImageUrl,
                }
            })

            return { success: true, config: updated }
        })

        return c.json(result)
    } catch (e: any) {
        console.error('[EVENT-REWARDS] Update config error:', e)
        return c.json({ error: e.message }, 500)
    }
}

/**
 * Admin: Get all event reward claims
 */
export const getEventRewardClaims = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const claims = await withPrisma(connectionString, async (prisma) => {
            return await prisma.eventRewardClaim.findMany({
                where: eventId ? { eventId } : undefined,
                include: {
                    rewardNft: {
                        select: {
                            name: true,
                            medalType: true,
                            imageUrl: true
                        }
                    },
                    user: {
                        select: {
                            wallets: {
                                select: {
                                    walletAddress: true
                                },
                                take: 1
                            }
                        }
                    },
                    event: {
                        select: {
                            name: true
                        }
                    }
                },
                orderBy: { claimedAt: 'desc' }
            })
        })

        return c.json({ claims })
    } catch (e: any) {
        console.error('[EVENT-REWARDS] Get claims error:', e)
        return c.json({ error: e.message }, 500)
    }
}
