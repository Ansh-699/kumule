import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'

// Constant-time string compare so a wrong key leaks no timing signal.
const timingSafeEqual = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

// API key authentication middleware.
// Header only: a query param would land in CF request logs, browser history and Referer headers.
export const adminAuth = async (c: Context<{ Bindings: CloudflareBindings }>, next: () => Promise<void>) => {
    const apiKey = c.req.header('X-Admin-API-Key')
    const envKey = c.env.ADMIN_API_KEY

    // No key configured => admin surface stays closed rather than falling back to a shared default.
    if (!envKey) {
        console.error('ADMIN_API_KEY is not configured; refusing all admin requests')
        return c.json({ error: 'Admin API is not configured.' }, 503)
    }

    if (!apiKey || !timingSafeEqual(apiKey, envKey)) {
        return c.json({ error: 'Unauthorized. Invalid admin API key.' }, 401)
    }

    await next()
}

// Get admin dashboard data (all users, transactions, NFTs, disputes)
export const getAdminDashboard = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const data = await withPrisma(connectionString, async (prisma) => {
            // Get all users with their wallets and all related data
            const users = await prisma.user.findMany({
                include: {
                    wallets: {
                        include: {
                            nfts: {
                                orderBy: { mintTimestamp: 'desc' }
                            }
                        }
                    },
                    transactions: {
                        include: {
                            nft: true
                        },
                        orderBy: { createdAt: 'desc' }
                    },
                    disputes: {
                        include: {
                            event: true
                        },
                        orderBy: { createdAt: 'desc' }
                    },
                    eventEntries: {
                        include: {
                            event: true
                        },
                        orderBy: { createdAt: 'desc' }
                    }
                },
                orderBy: { createdAt: 'desc' }
            })

            // Get all transactions
            const transactions = await prisma.transaction.findMany({
                include: {
                    user: {
                        include: {
                            wallets: true
                        }
                    },
                    nft: true
                },
                orderBy: { createdAt: 'desc' },
                take: 100
            })

            // Get all NFTs
            const nfts = await prisma.nft.findMany({
                include: {
                    wallet: {
                        include: {
                            user: true
                        }
                    }
                },
                orderBy: { mintTimestamp: 'desc' },
                take: 100
            })

            // Get all disputes
            const disputes = await prisma.dispute.findMany({
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

            // Get all escrows
            const escrows = await prisma.escrow.findMany({
                include: {
                    user: {
                        include: {
                            wallets: true
                        }
                    },
                    nft: true
                },
                orderBy: { createdAt: 'desc' },
                take: 100
            })

            // Get all events
            const events = await prisma.event.findMany({
                include: {
                    entries: {
                        include: {
                            user: true
                        }
                    },
                    disputes: true
                },
                orderBy: { createdAt: 'desc' }
            })

            // Get stats
            const stats = {
                totalUsers: await prisma.user.count(),
                totalNfts: await prisma.nft.count(),
                totalTransactions: await prisma.transaction.count(),
                totalDisputes: await prisma.dispute.count(),
                pendingDisputes: await prisma.dispute.count({ where: { status: 'PENDING' } }),
                approvedDisputes: await prisma.dispute.count({ where: { status: 'APPROVED' } }),
                totalEvents: await prisma.event.count(),
                totalEscrows: await prisma.escrow.count()
            }

            return {
                users,
                transactions,
                nfts,
                disputes,
                escrows,
                events,
                stats
            }
        })

        return c.json(data)
    } catch (error: any) {
        console.error('Get admin dashboard error:', error)
        return c.json({ error: error.message || 'Failed to fetch dashboard data' }, 500)
    }
}

