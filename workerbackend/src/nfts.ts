// The read API behind the marketplace grid: filters, sorting, pagination, stats.
//
// Every response carries `chain` per item, because the badge on each card is data, not a
// styling decision. One query path serves both chains - filtering by chain is a where clause,
// not a separate endpoint.

import { Context } from 'hono'
import { Prisma } from '@prisma/client'
import { withPrisma, getConnectionString, ensureUser } from './db'
import { Chain, parseChain, CHAIN_CONFIG, normalizeAddress, chainFromAddress } from './chains'

const CATEGORIES = [
    'ART', 'PFP', 'GAMING', 'PHOTOGRAPHY', 'MUSIC', 'UTILITY', 'VIRTUAL_WORLDS', 'OTHER',
] as const
type Category = (typeof CATEGORIES)[number]

const parseCategory = (v: unknown): Category | null => {
    if (typeof v !== 'string') return null
    const s = v.trim().toUpperCase().replace(/[\s-]+/g, '_')
    return (CATEGORIES as readonly string[]).includes(s) ? (s as Category) : null
}

const SORTS = {
    recent: { mintedAt: 'desc' },
    oldest: { mintedAt: 'asc' },
    most_liked: { likeCount: 'desc' },
    name: { name: 'asc' },
} as const
type SortKey = keyof typeof SORTS

const parseSort = (v: unknown): SortKey =>
    typeof v === 'string' && v in SORTS ? (v as SortKey) : 'recent'

/** Clamped so a caller cannot ask for the whole table in one request. */
const parsePaging = (c: Context) => {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '24', 10) || 24, 1), 100)
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)
    return { limit, offset }
}

/** Shape sent to the client. Decimals become strings so no price passes through a float. */
const serialize = (n: any) => ({
    id: n.id,
    assetId: n.assetId,
    chain: n.chain as Chain,
    chainId: n.chainId,
    chainLabel: CHAIN_CONFIG[n.chain as Chain].label,
    currency: CHAIN_CONFIG[n.chain as Chain].currency,
    contractAddress: n.contractAddress,
    tokenId: n.tokenId,
    mintAddress: n.mintAddress,
    name: n.name,
    description: n.description,
    imageUrl: n.imageUrl,
    metadataUri: n.metadataUri,
    animationUrl: n.animationUrl,
    category: n.category,
    attributes: n.attributes,
    ownerAddress: n.ownerAddress,
    creatorAddress: n.creatorAddress,
    likeCount: n.likeCount,
    mintedAt: n.mintedAt,
    collection: n.collection
        ? {
            id: n.collection.id,
            slug: n.collection.slug,
            name: n.collection.name,
            imageUrl: n.collection.imageUrl,
            verified: n.collection.verified,
        }
        : null,
    listing: n.listings?.[0]
        ? {
            id: n.listings[0].id,
            price: n.listings[0].price.toString(),
            currency: n.listings[0].currency,
            sellerAddress: n.listings[0].sellerAddress,
            status: n.listings[0].status,
        }
        : null,
    explorerUrl: n.assetId
        ? CHAIN_CONFIG[n.chain as Chain].explorerAddress(n.mintAddress || n.contractAddress || '')
        : null,
})

/**
 * GET /api/nfts
 *
 * chain, category, owner, collection, minPrice, maxPrice, listedOnly, search, sort, limit, offset
 *
 * Hidden NFTs are excluded unless includeHidden=true. Hiding rather than deleting is how the
 * 152 broken-image assets from v1 stay recoverable if their metadata host returns.
 */
export const listNfts = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const { limit, offset } = parsePaging(c)
    const chain = parseChain(c.req.query('chain'))
    const category = parseCategory(c.req.query('category'))
    const owner = c.req.query('owner')?.trim()
    const collection = c.req.query('collection')?.trim()
    const search = c.req.query('search')?.trim()
    // The marketplace shows what is for sale. An unlisted asset is the owner's own inventory as
    // far as this grid is concerned, so listed-only is the default and a caller opts out
    // explicitly.
    //
    // A product decision, not privacy: a minted token is public on chain forever and visible
    // through any explorer. This only controls what the storefront puts on a shelf.
    const listedParam = c.req.query('listedOnly')
    const listedOnly = listedParam === undefined
        // Browsing one wallet is a portfolio view, where unlisted items are the whole point.
        ? !owner
        : listedParam !== 'false'
    const includeHidden = c.req.query('includeHidden') === 'true'
    const sort = parseSort(c.req.query('sort'))
    const minPrice = c.req.query('minPrice')
    const maxPrice = c.req.query('maxPrice')

    const where: Prisma.NftWhereInput = {}
    if (chain) where.chain = chain
    if (category) where.category = category
    if (!includeHidden) where.hidden = false

    if (owner) {
        // The caller may send either chain's address form; infer which so a Solana key is not
        // lowercased into something that matches nothing.
        const ownerChain = chain ?? chainFromAddress(owner)
        where.ownerAddress = ownerChain ? normalizeAddress(ownerChain, owner) : owner
    }
    if (collection) {
        where.collection = /^[0-9a-f-]{36}$/i.test(collection) ? { id: collection } : { slug: collection }
    }
    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
        ]
    }

    const priceFilter: Prisma.ListingWhereInput = { status: 'ACTIVE' }
    if (minPrice) priceFilter.price = { ...(priceFilter.price as object), gte: new Prisma.Decimal(minPrice) }
    if (maxPrice) priceFilter.price = { ...(priceFilter.price as object), lte: new Prisma.Decimal(maxPrice) }
    const filteringOnPrice = Boolean(minPrice || maxPrice)
    if (listedOnly || filteringOnPrice) where.listings = { some: priceFilter }

    try {
        const { rows, total } = await withPrisma(connectionString, async (prisma) => {
            const [rows, total] = await Promise.all([
                prisma.nft.findMany({
                    where,
                    orderBy: SORTS[sort],
                    take: limit,
                    skip: offset,
                    include: {
                        collection: { select: { id: true, slug: true, name: true, imageUrl: true, verified: true } },
                        listings: {
                            where: { status: 'ACTIVE' },
                            orderBy: { createdAt: 'desc' },
                            take: 1,
                        },
                    },
                }),
                prisma.nft.count({ where }),
            ])
            return { rows, total }
        })

        return c.json({
            data: rows.map(serialize),
            count: rows.length,
            total,
            limit,
            offset,
            hasMore: offset + rows.length < total,
            filters: { chain, category, owner: owner ?? null, listedOnly, sort },
        })
    } catch (e: any) {
        console.error('listNfts failed:', e)
        return c.json({ error: 'Failed to list NFTs', details: e?.message }, 500)
    }
}

/** GET /api/nfts/:assetId — one asset with its collection, active listing and sale history. */
export const getNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const assetId = c.req.param('assetId')
    if (!assetId) return c.json({ error: 'assetId required' }, 400)

    try {
        const nft = await withPrisma(connectionString, (prisma) =>
            prisma.nft.findUnique({
                where: { assetId },
                include: {
                    collection: true,
                    listings: { orderBy: { createdAt: 'desc' }, take: 5 },
                    sales: { orderBy: { soldAt: 'desc' }, take: 10 },
                    track: { include: { album: true } },
                },
            })
        )
        if (!nft) return c.json({ error: 'NFT not found' }, 404)

        return c.json({
            ...serialize(nft),
            listingHistory: nft.listings.map((l) => ({
                id: l.id,
                price: l.price.toString(),
                currency: l.currency,
                status: l.status,
                sellerAddress: l.sellerAddress,
                createdAt: l.createdAt,
            })),
            sales: nft.sales.map((s) => ({
                price: s.price.toString(),
                currency: s.currency,
                buyerAddress: s.buyerAddress,
                sellerAddress: s.sellerAddress,
                txHash: s.txHash,
                explorerUrl: CHAIN_CONFIG[s.chain as Chain].explorerTx(s.txHash),
                soldAt: s.soldAt,
            })),
            music: nft.track
                ? {
                    trackId: nft.track.id,
                    title: nft.track.title,
                    audioUrl: nft.track.audioUrl,
                    durationSec: nft.track.durationSec,
                    isPreviewable: nft.track.isPreviewable,
                    previewSeconds: nft.track.previewSeconds,
                    album: { id: nft.track.album.id, name: nft.track.album.name, artist: nft.track.album.artist },
                }
                : null,
        })
    } catch (e: any) {
        console.error('getNft failed:', e)
        return c.json({ error: 'Failed to fetch NFT', details: e?.message }, 500)
    }
}

/** GET /api/listings — active listings across both chains, newest first. */
export const listListings = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const { limit, offset } = parsePaging(c)
    const chain = parseChain(c.req.query('chain'))
    const where: Prisma.ListingWhereInput = { status: 'ACTIVE' }
    if (chain) where.chain = chain

    try {
        const { rows, total } = await withPrisma(connectionString, async (prisma) => {
            const [rows, total] = await Promise.all([
                prisma.listing.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset,
                    include: { nft: { include: { collection: true } } },
                }),
                prisma.listing.count({ where }),
            ])
            return { rows, total }
        })

        return c.json({
            data: rows.map((l) => ({
                listingId: l.id,
                chain: l.chain,
                chainLabel: CHAIN_CONFIG[l.chain as Chain].label,
                price: l.price.toString(),
                currency: l.currency,
                sellerAddress: l.sellerAddress,
                escrowPda: l.escrowPda,
                createdAt: l.createdAt,
                nft: serialize(l.nft),
            })),
            count: rows.length,
            total,
            limit,
            offset,
            hasMore: offset + rows.length < total,
        })
    } catch (e: any) {
        console.error('listListings failed:', e)
        return c.json({ error: 'Failed to list listings', details: e?.message }, 500)
    }
}

/**
 * GET /api/stats — the numbers in the hero strip, per chain and combined.
 *
 * Volume is summed from Sale rows rather than recomputed from chain, so the figure is
 * consistent with what the marketplace actually recorded.
 */
export const getStats = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 365)
    const since = new Date(Date.now() - days * 86_400_000)

    try {
        const stats = await withPrisma(connectionString, async (prisma) => {
            const [nftTotal, collectors, listed, perChain, volume] = await Promise.all([
                prisma.nft.count({ where: { hidden: false } }),
                prisma.wallet.count(),
                prisma.listing.count({ where: { status: 'ACTIVE' } }),
                prisma.nft.groupBy({ by: ['chain'], where: { hidden: false }, _count: { _all: true } }),
                prisma.sale.groupBy({
                    by: ['chain'],
                    where: { soldAt: { gte: since } },
                    _sum: { price: true },
                    _count: { _all: true },
                }),
            ])
            return { nftTotal, collectors, listed, perChain, volume }
        })

        const volumeFor = (chain: Chain) =>
            stats.volume.find((v) => v.chain === chain)?._sum.price?.toString() ?? '0'
        const countFor = (chain: Chain) =>
            stats.perChain.find((p) => p.chain === chain)?._count._all ?? 0

        return c.json({
            totals: { nfts: stats.nftTotal, collectors: stats.collectors, activeListings: stats.listed },
            windowDays: days,
            chains: {
                SOLANA: { label: 'Solana', nfts: countFor('SOLANA'), volume: volumeFor('SOLANA'), currency: 'SOL' },
                ETHEREUM: { label: 'Ethereum', nfts: countFor('ETHEREUM'), volume: volumeFor('ETHEREUM'), currency: 'ETH' },
            },
            sales: stats.volume.reduce((n, v) => n + v._count._all, 0),
        })
    } catch (e: any) {
        console.error('getStats failed:', e)
        return c.json({ error: 'Failed to compute stats', details: e?.message }, 500)
    }
}

/** GET /api/collections — the Featured Collections row. */
export const listCollections = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const { limit, offset } = parsePaging(c)
    const chain = parseChain(c.req.query('chain'))
    const category = parseCategory(c.req.query('category'))
    const verifiedOnly = c.req.query('verified') === 'true'

    const where: Prisma.CollectionWhereInput = {}
    if (chain) where.chain = chain
    if (category) where.category = category
    if (verifiedOnly) where.verified = true

    try {
        const rows = await withPrisma(connectionString, (prisma) =>
            prisma.collection.findMany({
                where,
                orderBy: [{ verified: 'desc' }, { volume: 'desc' }],
                take: limit,
                skip: offset,
            })
        )
        return c.json({
            data: rows.map((r) => ({
                id: r.id,
                slug: r.slug,
                chain: r.chain,
                chainLabel: CHAIN_CONFIG[r.chain as Chain].label,
                currency: CHAIN_CONFIG[r.chain as Chain].currency,
                name: r.name,
                description: r.description,
                imageUrl: r.imageUrl,
                bannerUrl: r.bannerUrl,
                category: r.category,
                verified: r.verified,
                itemCount: r.itemCount,
                floorPrice: r.floorPrice?.toString() ?? null,
                volume: r.volume.toString(),
            })),
            count: rows.length,
        })
    } catch (e: any) {
        console.error('listCollections failed:', e)
        return c.json({ error: 'Failed to list collections', details: e?.message }, 500)
    }
}

/**
 * POST /api/nfts/:assetId/like   { walletAddress }
 *
 * Toggle a like. The heart on every card was rendering likeCount with nothing able to change it.
 *
 * Identity is the wallet, keyed (chain, address) through ensureUser, so one person liking from
 * their Solana and EVM wallets counts once. The unique index on (userId, nftId) is what actually
 * enforces one like per person - a count column alone would drift under concurrent clicks.
 */
export const toggleLike = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const assetId = c.req.param('assetId')
    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const wallet = body?.walletAddress
    if (!wallet || typeof wallet !== 'string') {
        return c.json({ error: 'walletAddress is required' }, 400)
    }
    const walletChain = chainFromAddress(wallet)
    if (!walletChain) return c.json({ error: 'walletAddress is not a recognised address' }, 400)

    try {
        const result = await withPrisma(connectionString, async (prisma) => {
            const nft = await prisma.nft.findUnique({ where: { assetId }, select: { id: true } })
            if (!nft) return { error: 'NFT not found' as const }

            const userId = await ensureUser(prisma, walletChain, wallet)
            const existing = await prisma.like.findUnique({
                where: { userId_nftId: { userId, nftId: nft.id } },
                select: { id: true },
            })

            // The count is derived from the rows rather than incremented blindly, so it cannot
            // drift away from reality if a request is retried.
            if (existing) {
                await prisma.like.delete({ where: { id: existing.id } })
            } else {
                await prisma.like.create({ data: { userId, nftId: nft.id } })
            }
            const likeCount = await prisma.like.count({ where: { nftId: nft.id } })
            await prisma.nft.update({ where: { id: nft.id }, data: { likeCount } })

            return { liked: !existing, likeCount }
        })

        if ('error' in result) return c.json({ error: result.error }, 404)
        return c.json({ success: true, ...result })
    } catch (e: any) {
        console.error('toggleLike failed:', e)
        return c.json({ error: 'Failed to toggle like', details: e?.message }, 500)
    }
}

/** GET /api/nfts/:assetId/liked?wallet= — whether this wallet already liked it. */
export const getLikeState = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const assetId = c.req.param('assetId')
    const wallet = c.req.query('wallet')?.trim()
    if (!wallet) return c.json({ liked: false })

    const walletChain = chainFromAddress(wallet)
    if (!walletChain) return c.json({ liked: false })

    try {
        const liked = await withPrisma(connectionString, async (prisma) => {
            const nft = await prisma.nft.findUnique({ where: { assetId }, select: { id: true } })
            if (!nft) return false
            const w = await prisma.wallet.findUnique({
                where: { chain_address: { chain: walletChain, address: normalizeAddress(walletChain, wallet) } },
                select: { userId: true },
            })
            if (!w) return false
            const like = await prisma.like.findUnique({
                where: { userId_nftId: { userId: w.userId, nftId: nft.id } },
                select: { id: true },
            })
            return Boolean(like)
        })
        return c.json({ liked })
    } catch (e: any) {
        console.error('getLikeState failed:', e)
        return c.json({ liked: false })
    }
}
