import { Context } from 'hono'
import { withPrisma, getConnectionString, ensureUserExists } from './db'
import { autoMintEventRewards } from './event-auto-mint'

// Default reward configuration
const DEFAULT_REWARD_CONFIG = {
    goldSupply: 1,
    goldPoints: 100,
    goldName: 'Gold Medal',
    goldImageUrl: null,
    silverSupply: 3,
    silverPoints: 60,
    silverName: 'Silver Medal',
    silverImageUrl: null,
    bronzeSupply: 5,
    bronzePoints: 30,
    bronzeName: 'Bronze Medal',
    bronzeImageUrl: null,
}

// Create a new event with optional auto-mint reward configuration
export const createEvent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { 
            name, 
            description, 
            entryFee, 
            eventDate, 
            creatorWallet,
            // New reward config fields
            rewardConfig,
            enableRewards = false // Whether to auto-mint rewards
        } = await c.req.json()
        
        if (!name || !creatorWallet) {
            return c.json({ error: 'Missing required fields: name and creatorWallet are required' }, 400)
        }
        
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }
        
        // Merge provided config with defaults
        const finalRewardConfig = enableRewards ? {
            ...DEFAULT_REWARD_CONFIG,
            ...(rewardConfig || {})
        } : null
        
        const event = await withPrisma(connectionString, async (prisma) => {
            // Find or create user based on wallet address
            const creatorId = await ensureUserExists(prisma, creatorWallet)
            
            // Create event
            const newEvent = await prisma.event.create({
                data: {
                    name,
                    description,
                    entryFee: entryFee || 0,
                    eventDate: eventDate ? new Date(eventDate) : null,
                    creatorWallet,
                    creatorId,
                }
            })
            
            // Create reward config if rewards are enabled
            if (finalRewardConfig) {
                await prisma.eventRewardConfig.create({
                    data: {
                        eventId: newEvent.id,
                        goldSupply: finalRewardConfig.goldSupply,
                        goldPoints: finalRewardConfig.goldPoints,
                        goldName: finalRewardConfig.goldName,
                        goldImageUrl: finalRewardConfig.goldImageUrl,
                        silverSupply: finalRewardConfig.silverSupply,
                        silverPoints: finalRewardConfig.silverPoints,
                        silverName: finalRewardConfig.silverName,
                        silverImageUrl: finalRewardConfig.silverImageUrl,
                        bronzeSupply: finalRewardConfig.bronzeSupply,
                        bronzePoints: finalRewardConfig.bronzePoints,
                        bronzeName: finalRewardConfig.bronzeName,
                        bronzeImageUrl: finalRewardConfig.bronzeImageUrl,
                        mintingStatus: 'PENDING',
                        totalToMint: finalRewardConfig.goldSupply + finalRewardConfig.silverSupply + finalRewardConfig.bronzeSupply
                    }
                })
            }
            
            return newEvent
        })
        
        // Trigger auto-minting in background (non-blocking) if rewards are enabled
        if (finalRewardConfig) {
            c.executionCtx.waitUntil(
                autoMintEventRewards(c.env, event.id, name, finalRewardConfig)
                    .then(result => {
                        console.log(`Auto-mint for event ${event.id} (${name}) completed:`, 
                            result.success ? 'SUCCESS' : 'PARTIAL/FAILED',
                            `- ${result.minted.filter(m => m.success).length}/${result.minted.length} NFTs minted`)
                    })
                    .catch(err => {
                        console.error(`Auto-mint for event ${event.id} (${name}) failed:`, err.message)
                    })
            )
        }
        
        return c.json({ 
            ...event, 
            rewardMinting: finalRewardConfig ? 'STARTED' : 'NOT_CONFIGURED',
            rewardConfig: finalRewardConfig ? {
                goldSupply: finalRewardConfig.goldSupply,
                silverSupply: finalRewardConfig.silverSupply,
                bronzeSupply: finalRewardConfig.bronzeSupply,
                totalNfts: finalRewardConfig.goldSupply + finalRewardConfig.silverSupply + finalRewardConfig.bronzeSupply
            } : null
        })
    } catch (e: any) {
        console.error('Create event error:', e)
        return c.json({ error: e.message }, 500)
    }
}

// List all events
export const listEvents = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }
        const events = await withPrisma(connectionString, async (prisma) => {
            return await prisma.event.findMany({
                include: { entries: true }
            })
        })
        return c.json(events)
    } catch (e: any) {
        return c.json({ error: e.message }, 500)
    }
}

// Join an event
export const joinEvent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')
        const { walletAddress, amount, txHash } = await c.req.json()
        if (!eventId || !walletAddress) {
            return c.json({ error: 'Missing required fields (eventId and walletAddress required)' }, 400)
        }
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }
        const entry = await withPrisma(connectionString, async (prisma) => {
            // Always resolve the user from the wallet. The old inline version accepted a
            // caller-supplied userId (so anyone could file an entry against another account) and
            // its wallet create omitted the required walletType, which made every *first-time*
            // wallet fail to join. ensureUserExists already does both correctly.
            const resolvedUserId = await ensureUserExists(prisma, walletAddress)


            // Check if already joined
            const existingEntry = await prisma.eventEntry.findFirst({
                where: { eventId, walletAddress }
            })
            if (existingEntry) {
                return existingEntry // Already joined, return existing entry
            }
            
            return await prisma.eventEntry.create({
                data: {
                    eventId,
                    userId: resolvedUserId,
                    walletAddress,
                    amount: amount || 0,
                    txHash: txHash || null,
                }
            })
        })
        return c.json(entry)
    } catch (e: any) {
        console.error('Join event error:', e)
        return c.json({ error: e.message }, 500)
    }
}

// Delete an event (admin only)
export const deleteEvent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')
        if (!eventId) {
            return c.json({ error: 'Event ID is required' }, 400)
        }
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }
        await withPrisma(connectionString, async (prisma) => {
            // First delete all entries for this event
            await prisma.eventEntry.deleteMany({
                where: { eventId }
            })
            // Then delete the event
            await prisma.event.delete({
                where: { id: eventId }
            })
        })
        return c.json({ success: true, message: 'Event deleted' })
    } catch (e: any) {
        console.error('Delete event error:', e)
        return c.json({ error: e.message }, 500)
    }
}
