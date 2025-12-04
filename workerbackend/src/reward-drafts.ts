import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'

// Create a draft reward (save uploaded image/metadata)
export const createRewardDraft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { name, description, metadataUri, imageUrl, imageFile, requiredPoints, rewardType, totalSupply } = body

        if (!name || !metadataUri || !imageUrl) {
            return c.json({ error: 'Missing required fields: name, metadataUri, imageUrl' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const draft = await withPrisma(connectionString, async (prisma) => {
            return await prisma.rewardDraft.create({
                data: {
                    name,
                    description: description || null,
                    metadataUri,
                    imageUrl,
                    imageFile: imageFile || null,
                    requiredPoints: parseInt(requiredPoints) || 100,
                    rewardType: rewardType || 'MUSIC_NFT',
                    totalSupply: parseInt(totalSupply) || 1,
                    isListed: false
                }
            })
        })

        return c.json({ success: true, draft })
    } catch (error: any) {
        console.error('Create reward draft error:', error)
        return c.json({ error: error.message || 'Failed to create reward draft' }, 500)
    }
}

// Get all drafts
export const getAllRewardDrafts = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const drafts = await withPrisma(connectionString, async (prisma) => {
            return await prisma.rewardDraft.findMany({
                orderBy: { createdAt: 'desc' }
            })
        })

        return c.json({ drafts })
    } catch (error: any) {
        console.error('Get reward drafts error:', error)
        return c.json({ error: error.message || 'Failed to get reward drafts' }, 500)
    }
}

// Update draft (toggle listed status)
export const updateRewardDraft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { id } = c.req.param()
        const body = await c.req.json()
        const { isListed, name, description, requiredPoints, totalSupply } = body

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const draft = await withPrisma(connectionString, async (prisma) => {
            return await prisma.rewardDraft.update({
                where: { id },
                data: {
                    ...(isListed !== undefined && { isListed }),
                    ...(name && { name }),
                    ...(description !== undefined && { description }),
                    ...(requiredPoints && { requiredPoints: parseInt(requiredPoints) }),
                    ...(totalSupply && { totalSupply: parseInt(totalSupply) })
                }
            })
        })

        return c.json({ success: true, draft })
    } catch (error: any) {
        console.error('Update reward draft error:', error)
        return c.json({ error: error.message || 'Failed to update reward draft' }, 500)
    }
}

// Delete draft
export const deleteRewardDraft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { id } = c.req.param()

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        await withPrisma(connectionString, async (prisma) => {
            await prisma.rewardDraft.delete({
                where: { id }
            })
        })

        return c.json({ success: true })
    } catch (error: any) {
        console.error('Delete reward draft error:', error)
        return c.json({ error: error.message || 'Failed to delete reward draft' }, 500)
    }
}

