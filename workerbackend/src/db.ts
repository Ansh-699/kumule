import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { Chain, normalizeAddress, isValidAddress } from './chains'

/**
 * Run a unit of work against the database and always release the connection.
 *
 * Workers get a fresh isolate per request, so a client is built per call rather than kept
 * as module state - a cached client would outlive its isolate and hand back a dead socket.
 */
export const withPrisma = async <T>(
    connectionString: string,
    fn: (prisma: PrismaClient) => Promise<T>
): Promise<T> => {
    const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })
    try {
        return await fn(prisma)
    } finally {
        await prisma.$disconnect()
    }
}

/**
 * Hyperdrive first in production for pooling, DATABASE_URL otherwise. Returns '' rather than
 * throwing so callers can answer 503 instead of surfacing a stack trace.
 *
 * Note for CLI work: Neon's `channel_binding=require` breaks the Prisma CLI (P1001) even
 * though this runtime adapter handles it. Strip that parameter for `prisma migrate` commands.
 */
export const getConnectionString = (env: CloudflareBindings): string => {
    // DATABASE_URL first, deliberately. Hyperdrive used to win here, which meant a stale
    // Hyperdrive config silently overrode the secret and kept the worker reading an old
    // database - with no error to explain why. An explicitly-set secret should always beat
    // an inherited binding.
    if (env.DATABASE_URL) return env.DATABASE_URL
    if (env.HYPERDRIVE?.connectionString) return env.HYPERDRIVE.connectionString
    console.error('DB: no connection string configured')
    return ''
}

/**
 * Find or create the user owning `address` on `chain`, returning the user id.
 *
 * Uniqueness is (chain, address), not address alone, so one person can hold a Solana wallet
 * and an EVM wallet under a single user - the entire point of a multi-chain marketplace.
 * EVM addresses are normalised first, because a checksummed and a lowercased form of the same
 * wallet would otherwise create two users.
 */
export const ensureUser = async (
    prisma: PrismaClient,
    chain: Chain,
    address: string
): Promise<string> => {
    if (!isValidAddress(chain, address)) {
        throw new Error(`not a valid ${chain} address: ${address}`)
    }
    const addr = normalizeAddress(chain, address)

    const existing = await prisma.wallet.findUnique({
        where: { chain_address: { chain, address: addr } },
        select: { userId: true },
    })
    if (existing) return existing.userId

    // A concurrent request may win the race between the check above and this create; the
    // unique constraint is what actually guarantees one row, so treat a conflict as success.
    try {
        const user = await prisma.user.create({
            data: { wallets: { create: { chain, address: addr, isPrimary: true } } },
            select: { id: true },
        })
        return user.id
    } catch (e: any) {
        if (e?.code === 'P2002') {
            const w = await prisma.wallet.findUnique({
                where: { chain_address: { chain, address: addr } },
                select: { userId: true },
            })
            if (w) return w.userId
        }
        throw e
    }
}

/** Attach another chain's wallet to an existing user, so both chains share one identity. */
export const linkWallet = async (
    prisma: PrismaClient,
    userId: string,
    chain: Chain,
    address: string
): Promise<void> => {
    if (!isValidAddress(chain, address)) {
        throw new Error(`not a valid ${chain} address: ${address}`)
    }
    const addr = normalizeAddress(chain, address)
    await prisma.wallet.upsert({
        where: { chain_address: { chain, address: addr } },
        update: { userId },
        create: { userId, chain, address: addr, isPrimary: false },
    })
}
