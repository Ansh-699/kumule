import { Context } from 'hono'
import { withPrisma, getConnectionString, ensureUserExists } from './db'

// Create a new event
export const createEvent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const { name, description, entryFee, eventDate, creatorWallet } = await c.req.json()
        if (!name || !creatorWallet) {
            return c.json({ error: 'Missing required fields: name and creatorWallet are required' }, 400)
        }
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }
        const event = await withPrisma(connectionString, async (prisma) => {
            // Find or create user based on wallet address
            const creatorId = await ensureUserExists(prisma, creatorWallet)
            
            return await prisma.event.create({
                data: {
                    name,
                    description,
                    entryFee: entryFee || 0,
                    eventDate: eventDate ? new Date(eventDate) : null,
                    creatorWallet,
                    creatorId,
                }
            })
        })
        return c.json(event)
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
        const { userId, walletAddress, amount, txHash } = await c.req.json()
        if (!eventId || !userId || !walletAddress) {
            return c.json({ error: 'Missing required fields' }, 400)
        }
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }
        const entry = await withPrisma(connectionString, async (prisma) => {
            return await prisma.eventEntry.create({
                data: {
                    eventId,
                    userId,
                    walletAddress,
                    amount: amount || 0,
                    txHash: txHash || null,
                }
            })
        })
        return c.json(entry)
    } catch (e: any) {
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
