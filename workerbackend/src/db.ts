import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

// Create Prisma client using a connection string
// Works with both DATABASE_URL and Hyperdrive connectionString
export const getPrisma = (connectionString: string) => {
    const adapter = new PrismaNeon({ connectionString })
    const prisma = new PrismaClient({ adapter })
    return prisma
}

// Helper to execute database operations with proper cleanup
export const withPrisma = async <T>(
    connectionString: string,
    fn: (prisma: PrismaClient) => Promise<T>
): Promise<T> => {
    const adapter = new PrismaNeon({ connectionString })
    const prisma = new PrismaClient({ adapter })
    
    try {
        return await fn(prisma)
    } finally {
        await prisma.$disconnect()
    }
}

// Helper to get connection string from environment
// For local development, DATABASE_URL works better
// For production, Hyperdrive provides connection pooling
export const getConnectionString = (env: CloudflareBindings): string => {
    // For local dev, prefer DATABASE_URL (Hyperdrive local emulation has issues)
    if (env.DATABASE_URL) {
        console.log('DB: Using DATABASE_URL')
        return env.DATABASE_URL
    }
    // In production, use Hyperdrive if available
    if (env.HYPERDRIVE?.connectionString) {
        console.log('DB: Using Hyperdrive')
        return env.HYPERDRIVE.connectionString
    }
    console.error('DB: No connection string available')
    return ''
}

// Shared helper to ensure a user exists in the database (find by wallet or create)
// This eliminates duplicate code across escrow.ts, event.ts, reward.ts, dispute.ts, etc.
export async function ensureUserExists(prisma: PrismaClient, walletAddress: string): Promise<string> {
    let user = await prisma.user.findFirst({
        where: {
            wallets: {
                some: { walletAddress: walletAddress }
            }
        },
        include: { wallets: true }
    });

    if (!user) {
        console.log('DB: Creating new user for wallet', walletAddress)
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
        });
    }

    return user.id
}
