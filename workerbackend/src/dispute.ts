import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'

// Create a new dispute
export const createDispute = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { walletAddress, eventId, eventEntryId, amount, reason, transactionId } = body

        if (!walletAddress || !amount || !reason) {
            return c.json({ error: 'Missing required fields: walletAddress, amount, reason' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const dispute = await withPrisma(connectionString, async (prisma) => {
            // Find or create user by wallet address
            let user = await prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress: walletAddress }
                    }
                },
                include: { wallets: true }
            })

            if (!user) {
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

            // Create dispute
            return await prisma.dispute.create({
                data: {
                    userId: user.id,
                    eventId: eventId || null,
                    eventEntryId: eventEntryId || null,
                    walletAddress: walletAddress,
                    amount: parseFloat(amount.toString()),
                    reason: reason,
                    transactionId: transactionId || null,
                    status: 'PENDING'
                }
            })
        })

        return c.json({ success: true, dispute })
    } catch (error: any) {
        console.error('Create dispute error:', error)
        return c.json({ error: error.message || 'Failed to create dispute' }, 500)
    }
}

// Get all disputes (admin)
export const getDisputes = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const status = c.req.query('status') // Optional filter: PENDING | APPROVED | REJECTED | REFUNDED
        const walletAddress = c.req.query('walletAddress')

        const disputes = await withPrisma(connectionString, async (prisma) => {
            const where: any = {}
            if (status) where.status = status
            if (walletAddress) where.walletAddress = walletAddress

            return prisma.dispute.findMany({
                where,
                include: {
                    user: {
                        include: {
                            wallets: true
                        }
                    },
                    event: true
                },
                orderBy: { createdAt: 'desc' }
            })
        })

        return c.json({ disputes })
    } catch (error: any) {
        console.error('Get disputes error:', error)
        return c.json({ error: error.message || 'Failed to fetch disputes' }, 500)
    }
}

// Get single dispute by ID
export const getDispute = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const id = c.req.param('id')
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const dispute = await withPrisma(connectionString, async (prisma) => {
            return prisma.dispute.findUnique({
                where: { id },
                include: {
                    user: {
                        include: {
                            wallets: true
                        }
                    },
                    event: true
                }
            })
        })

        if (!dispute) {
            return c.json({ error: 'Dispute not found' }, 404)
        }

        return c.json({ dispute })
    } catch (error: any) {
        console.error('Get dispute error:', error)
        return c.json({ error: error.message || 'Failed to fetch dispute' }, 500)
    }
}

// Resolve dispute (admin): APPROVE or REJECT
export const resolveDispute = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const id = c.req.param('id')
        const body = await c.req.json()
        const { status, adminNotes, refundTxHash } = body

        if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
            return c.json({ error: 'Invalid status. Must be APPROVED or REJECTED' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const dispute = await withPrisma(connectionString, async (prisma) => {
            return prisma.dispute.update({
                where: { id },
                data: {
                    status: status,
                    adminNotes: adminNotes || null,
                    refundTxHash: refundTxHash || null,
                    resolvedAt: new Date()
                },
                include: {
                    user: {
                        include: {
                            wallets: true
                        }
                    },
                    event: true
                }
            })
        })

        return c.json({ success: true, dispute })
    } catch (error: any) {
        console.error('Resolve dispute error:', error)
        return c.json({ error: error.message || 'Failed to resolve dispute' }, 500)
    }
}

// Mark dispute as refunded (after manual refund)
export const markDisputeRefunded = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const id = c.req.param('id')
        const body = await c.req.json()
        const { refundTxHash } = body

        if (!refundTxHash) {
            return c.json({ error: 'Missing refundTxHash' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const dispute = await withPrisma(connectionString, async (prisma) => {
            return prisma.dispute.update({
                where: { id },
                data: {
                    status: 'REFUNDED',
                    refundTxHash: refundTxHash,
                    resolvedAt: new Date()
                }
            })
        })

        return c.json({ success: true, dispute })
    } catch (error: any) {
        console.error('Mark dispute refunded error:', error)
        return c.json({ error: error.message || 'Failed to mark dispute as refunded' }, 500)
    }
}

