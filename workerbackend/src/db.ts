import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

// Create Prisma client using a connection string
// Works with both DATABASE_URL and Hyperdrive connectionString
export const getPrisma = (connectionString: string) => {
    const pool = new Pool({ connectionString })
    const adapter = new PrismaPg(pool)
    const prisma = new PrismaClient({ adapter })
    return prisma
}

// Helper to execute database operations with proper cleanup
export const withPrisma = async <T>(
    connectionString: string,
    fn: (prisma: PrismaClient) => Promise<T>
): Promise<T> => {
    const pool = new Pool({ connectionString })
    const adapter = new PrismaPg(pool)
    const prisma = new PrismaClient({ adapter })
    
    try {
        return await fn(prisma)
    } finally {
        await prisma.$disconnect()
        await pool.end()
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
