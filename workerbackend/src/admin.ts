import { Context } from 'hono'
import { Prisma } from '@prisma/client'
import { withPrisma, getConnectionString } from './db'
import { Chain, CHAIN_CONFIG, parseChain } from './chains'

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

// ---------------------------------------------------------------------------
// Admin data. Rewritten for the v2 schema: the Dispute and Escrow tables are gone (escrow
// folded into Listing), Nft carries its owner directly instead of through a wallet join, and
// everything is grouped by chain because "which chain is this marketplace actually used on"
// is the question the dashboard exists to answer.

/** GET /api/admin/overview — counts, chain split and recent activity in one round trip. */
export const getAdminOverview = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    try {
        const data = await withPrisma(connectionString, async (prisma) => {
            const [
                users, wallets, nfts, hiddenNfts, imagelessNfts, collections,
                activeListings, sales, events, claims,
                nftsByChain, walletsByChain, listingsByChain, salesByChain,
                nftsByCategory, recentSales, recentTx,
            ] = await Promise.all([
                prisma.user.count(),
                prisma.wallet.count(),
                prisma.nft.count(),
                prisma.nft.count({ where: { hidden: true } }),
                prisma.nft.count({ where: { imageOk: false } }),
                prisma.collection.count(),
                prisma.listing.count({ where: { status: 'ACTIVE' } }),
                prisma.sale.count(),
                prisma.event.count(),
                prisma.medalClaim.count(),
                prisma.nft.groupBy({ by: ['chain'], _count: { _all: true } }),
                prisma.wallet.groupBy({ by: ['chain'], _count: { _all: true } }),
                prisma.listing.groupBy({
                    by: ['chain'], where: { status: 'ACTIVE' },
                    _count: { _all: true }, _sum: { price: true },
                }),
                prisma.sale.groupBy({
                    by: ['chain'], _count: { _all: true }, _sum: { price: true },
                }),
                prisma.nft.groupBy({ by: ['category'], _count: { _all: true } }),
                prisma.sale.findMany({
                    orderBy: { soldAt: 'desc' }, take: 10,
                    include: { nft: { select: { name: true, assetId: true, imageUrl: true } } },
                }),
                prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
            ])
            return {
                users, wallets, nfts, hiddenNfts, imagelessNfts, collections,
                activeListings, sales, events, claims,
                nftsByChain, walletsByChain, listingsByChain, salesByChain,
                nftsByCategory, recentSales, recentTx,
            }
        })

        const perChain = (chain: Chain) => ({
            label: CHAIN_CONFIG[chain].label,
            currency: CHAIN_CONFIG[chain].currency,
            nfts: data.nftsByChain.find((r) => r.chain === chain)?._count._all ?? 0,
            wallets: data.walletsByChain.find((r) => r.chain === chain)?._count._all ?? 0,
            activeListings: data.listingsByChain.find((r) => r.chain === chain)?._count._all ?? 0,
            // Decimal.toString(), never Number(): these are money.
            listedValue: data.listingsByChain.find((r) => r.chain === chain)?._sum.price?.toString() ?? '0',
            sales: data.salesByChain.find((r) => r.chain === chain)?._count._all ?? 0,
            volume: data.salesByChain.find((r) => r.chain === chain)?._sum.price?.toString() ?? '0',
        })

        return c.json({
            totals: {
                users: data.users,
                wallets: data.wallets,
                nfts: data.nfts,
                hiddenNfts: data.hiddenNfts,
                // Surfaced deliberately: v1 shipped 152 unrenderable NFTs with nothing showing it.
                nftsMissingImages: data.imagelessNfts,
                collections: data.collections,
                activeListings: data.activeListings,
                sales: data.sales,
                events: data.events,
                medalClaims: data.claims,
            },
            chains: { SOLANA: perChain('SOLANA'), ETHEREUM: perChain('ETHEREUM') },
            categories: data.nftsByCategory.map((r) => ({ category: r.category, count: r._count._all })),
            recentSales: data.recentSales.map((s) => ({
                chain: s.chain,
                nftName: s.nft.name,
                assetId: s.nft.assetId,
                imageUrl: s.nft.imageUrl,
                price: s.price.toString(),
                currency: s.currency,
                buyerAddress: s.buyerAddress,
                sellerAddress: s.sellerAddress,
                txHash: s.txHash,
                explorerUrl: CHAIN_CONFIG[s.chain as Chain].explorerTx(s.txHash),
                soldAt: s.soldAt,
            })),
            recentTransactions: data.recentTx.map((t) => ({
                id: t.id,
                chain: t.chain,
                kind: t.kind,
                status: t.status,
                walletAddress: t.walletAddress,
                amount: t.amount?.toString() ?? null,
                currency: t.currency,
                txHash: t.txHash,
                explorerUrl: t.txHash ? CHAIN_CONFIG[t.chain as Chain].explorerTx(t.txHash) : null,
                createdAt: t.createdAt,
            })),
        })
    } catch (e: any) {
        console.error('getAdminOverview failed:', e)
        return c.json({ error: 'Failed to load overview', details: e?.message }, 500)
    }
}

/** Shared paging for the admin tables. */
const paging = (c: Context) => ({
    limit: Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200),
    offset: Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0),
})

/** GET /api/admin/users — users with their wallets across both chains. */
export const listUsers = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    const { limit, offset } = paging(c)

    try {
        const { rows, total } = await withPrisma(connectionString, async (prisma) => {
            const [rows, total] = await Promise.all([
                prisma.user.findMany({
                    orderBy: { createdAt: 'desc' }, take: limit, skip: offset,
                    include: {
                        wallets: true,
                        _count: { select: { likes: true, participants: true, claims: true, transactions: true } },
                    },
                }),
                prisma.user.count(),
            ])
            return { rows, total }
        })

        return c.json({
            data: rows.map((u) => ({
                id: u.id,
                handle: u.handle,
                createdAt: u.createdAt,
                wallets: u.wallets.map((w) => ({
                    chain: w.chain,
                    address: w.address,
                    isPrimary: w.isPrimary,
                    explorerUrl: CHAIN_CONFIG[w.chain as Chain].explorerAddress(w.address),
                })),
                counts: u._count,
            })),
            count: rows.length, total, limit, offset, hasMore: offset + rows.length < total,
        })
    } catch (e: any) {
        console.error('listUsers failed:', e)
        return c.json({ error: 'Failed to list users', details: e?.message }, 500)
    }
}

/** GET /api/admin/listings — every listing regardless of status. */
export const listAllListings = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    const { limit, offset } = paging(c)
    const chain = parseChain(c.req.query('chain'))
    const status = c.req.query('status')?.toUpperCase()

    const where: Prisma.ListingWhereInput = {}
    if (chain) where.chain = chain
    if (status && ['ACTIVE', 'SOLD', 'CANCELLED'].includes(status)) where.status = status as any

    try {
        const { rows, total } = await withPrisma(connectionString, async (prisma) => {
            const [rows, total] = await Promise.all([
                prisma.listing.findMany({
                    where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset,
                    include: { nft: { select: { name: true, assetId: true, imageUrl: true, ownerAddress: true } } },
                }),
                prisma.listing.count({ where }),
            ])
            return { rows, total }
        })

        return c.json({
            data: rows.map((l) => ({
                id: l.id,
                chain: l.chain,
                status: l.status,
                price: l.price.toString(),
                currency: l.currency,
                sellerAddress: l.sellerAddress,
                escrowPda: l.escrowPda,
                nft: l.nft,
                createdAt: l.createdAt,
            })),
            count: rows.length, total, limit, offset, hasMore: offset + rows.length < total,
        })
    } catch (e: any) {
        console.error('listAllListings failed:', e)
        return c.json({ error: 'Failed to list listings', details: e?.message }, 500)
    }
}

/** GET /api/admin/transactions */
export const listTransactions = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    const { limit, offset } = paging(c)
    const chain = parseChain(c.req.query('chain'))
    const kind = c.req.query('kind')?.toUpperCase()
    const status = c.req.query('status')?.toUpperCase()

    const where: Prisma.TransactionWhereInput = {}
    if (chain) where.chain = chain
    if (kind) where.kind = kind
    if (status) where.status = status

    try {
        const { rows, total } = await withPrisma(connectionString, async (prisma) => {
            const [rows, total] = await Promise.all([
                prisma.transaction.findMany({
                    where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset,
                }),
                prisma.transaction.count({ where }),
            ])
            return { rows, total }
        })

        return c.json({
            data: rows.map((t) => ({
                id: t.id,
                chain: t.chain,
                kind: t.kind,
                status: t.status,
                walletAddress: t.walletAddress,
                amount: t.amount?.toString() ?? null,
                currency: t.currency,
                txHash: t.txHash,
                explorerUrl: t.txHash ? CHAIN_CONFIG[t.chain as Chain].explorerTx(t.txHash) : null,
                metadata: t.metadata,
                createdAt: t.createdAt,
            })),
            count: rows.length, total, limit, offset, hasMore: offset + rows.length < total,
        })
    } catch (e: any) {
        console.error('listTransactions failed:', e)
        return c.json({ error: 'Failed to list transactions', details: e?.message }, 500)
    }
}

/**
 * POST /api/admin/nfts/:assetId/hide  { hidden: boolean }
 *
 * Hiding rather than deleting: an unrenderable asset still exists on chain, and its metadata
 * host may come back. This is the operational answer to v1's 152 blank cards.
 */
export const setNftHidden = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const assetId = c.req.param('assetId')
    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }
    if (typeof body?.hidden !== 'boolean') {
        return c.json({ error: 'hidden must be a boolean' }, 400)
    }

    try {
        const nft = await withPrisma(connectionString, (prisma) =>
            prisma.nft.update({ where: { assetId }, data: { hidden: body.hidden } })
        )
        return c.json({ success: true, assetId: nft.assetId, hidden: nft.hidden })
    } catch (e: any) {
        if (e?.code === 'P2025') return c.json({ error: 'NFT not found' }, 404)
        console.error('setNftHidden failed:', e)
        return c.json({ error: 'Failed to update NFT', details: e?.message }, 500)
    }
}

/** GET /api/admin/nfts/broken — assets whose image never resolved, so they can be triaged. */
export const listBrokenNfts = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    const { limit, offset } = paging(c)

    try {
        const { rows, total } = await withPrisma(connectionString, async (prisma) => {
            const where: Prisma.NftWhereInput = { imageOk: false }
            const [rows, total] = await Promise.all([
                prisma.nft.findMany({ where, orderBy: { mintedAt: 'desc' }, take: limit, skip: offset }),
                prisma.nft.count({ where }),
            ])
            return { rows, total }
        })

        return c.json({
            data: rows.map((n) => ({
                assetId: n.assetId,
                chain: n.chain,
                name: n.name,
                metadataUri: n.metadataUri,
                imageUrl: n.imageUrl,
                hidden: n.hidden,
                ownerAddress: n.ownerAddress,
                mintedAt: n.mintedAt,
            })),
            count: rows.length, total, limit, offset, hasMore: offset + rows.length < total,
        })
    } catch (e: any) {
        console.error('listBrokenNfts failed:', e)
        return c.json({ error: 'Failed to list broken NFTs', details: e?.message }, 500)
    }
}
