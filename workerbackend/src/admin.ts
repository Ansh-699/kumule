import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'

// Simple API key authentication middleware
export const adminAuth = async (c: Context<{ Bindings: CloudflareBindings }>, next: () => Promise<void>) => {
    const apiKey = c.req.header('X-Admin-API-Key') || c.req.query('apiKey')
    
    // Support both env key and a fallback hardcoded key for development
    const envKey = c.env.ADMIN_API_KEY
    const fallbackKey = 'admin-secret-key-change-in-production'
    
    console.log('Admin auth check:', { 
        providedKey: apiKey ? apiKey.substring(0, 10) + '...' : 'none', 
        envKey: envKey ? envKey.substring(0, 10) + '...' : 'none',
        hasEnvKey: !!envKey
    })

    // Accept env key, fallback key, or password "anshtyagi"
    const passwordKey = 'anshtyagi'
    if (!apiKey || (apiKey !== envKey && apiKey !== fallbackKey && apiKey !== passwordKey)) {
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

