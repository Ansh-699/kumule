import { Context } from 'hono'
import { Prisma } from '@prisma/client'
import { withPrisma, getConnectionString } from './db'
import { Chain, CHAIN_CONFIG, parseChain } from './chains'
import { resolveMetadata } from './metadata'
import { totalMinted, listAllListings as readEvmListings } from './evm'
import { upsertEvmToken } from './settle'

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
            // Everything currently off the storefront, not just unresolvable images.
            //
            // Asking only for imageOk:false made hiding a one-way trip: an asset whose image
            // came back was still hidden, and appeared nowhere in this dashboard, so there was
            // no way to put it back on the shelf. Two listed assets with working images were
            // stuck exactly like that.
            const where: Prisma.NftWhereInput = { OR: [{ imageOk: false }, { hidden: true }] }
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

/**
 * POST /api/admin/nfts/:assetId/resolve
 *
 * Re-read an asset's metadata JSON and refresh imageUrl, description, category and imageOk.
 *
 * This is the repair path for rows written before resolution existed, and for assets whose
 * metadata host was down at mint time. Idempotent, so it is safe to re-run.
 */
export const resolveNftMetadata = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const assetId = c.req.param('assetId')
    try {
        const existing = await withPrisma(connectionString, (prisma) =>
            prisma.nft.findUnique({ where: { assetId }, select: { metadataUri: true } })
        )
        if (!existing) return c.json({ error: 'NFT not found' }, 404)

        const meta = await resolveMetadata(c.env, existing.metadataUri)

        const updated = await withPrisma(connectionString, (prisma) =>
            prisma.nft.update({
                where: { assetId },
                data: {
                    imageUrl: meta.imageUrl,
                    animationUrl: meta.animationUrl,
                    description: meta.description,
                    category: meta.category,
                    attributes: meta.attributes ?? undefined,
                    imageOk: meta.imageOk,
                    // Hiding exists so a broken asset can come back, but nothing ever brought
                    // one back: an NFT hidden while its metadata host was down stayed off the
                    // shelf after the image resolved again, listing and all.
                    ...(meta.imageOk ? { hidden: false } : {}),
                },
            })
        )

        return c.json({
            success: true,
            assetId: updated.assetId,
            imageUrl: updated.imageUrl,
            category: updated.category,
            imageOk: updated.imageOk,
            reason: meta.reason,
        })
    } catch (e: any) {
        console.error('resolveNftMetadata failed:', e)
        return c.json({ error: 'Failed to resolve metadata', details: e?.message }, 500)
    }
}

/**
 * POST /api/admin/nfts/resolve-missing
 *
 * Re-resolve every asset whose image never came through. The backfill for the gap between
 * minting and resolution existing.
 *
 * Capped per call so one request cannot run past the worker's CPU budget; re-run until
 * `remaining` reaches zero.
 */
export const resolveMissingMetadata = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 25)

    try {
        const pending = await withPrisma(connectionString, (prisma) =>
            prisma.nft.findMany({
                where: { imageOk: false },
                select: { assetId: true, metadataUri: true },
                orderBy: { mintedAt: 'desc' },
                take: limit,
            })
        )

        const fixed: string[] = []
        const stillBroken: Array<{ assetId: string; reason: string | null }> = []

        for (const row of pending) {
            const meta = await resolveMetadata(c.env, row.metadataUri)
            await withPrisma(connectionString, (prisma) =>
                prisma.nft.update({
                    where: { assetId: row.assetId },
                    data: {
                        imageUrl: meta.imageUrl,
                        animationUrl: meta.animationUrl,
                        description: meta.description,
                        category: meta.category,
                        attributes: meta.attributes ?? undefined,
                        imageOk: meta.imageOk,
                        // Back on the shelf once it renders again, for the same reason.
                        ...(meta.imageOk ? { hidden: false } : {}),
                    },
                })
            )
            if (meta.imageOk) fixed.push(row.assetId)
            else stillBroken.push({ assetId: row.assetId, reason: meta.reason })
        }

        const remaining = await withPrisma(connectionString, (prisma) =>
            prisma.nft.count({ where: { imageOk: false } })
        )

        return c.json({ success: true, processed: pending.length, fixed, stillBroken, remaining })
    } catch (e: any) {
        console.error('resolveMissingMetadata failed:', e)
        return c.json({ error: 'Failed to backfill metadata', details: e?.message }, 500)
    }
}

/**
 * POST /api/admin/evm/index?from=1&to=50
 *
 * Index Base Sepolia tokens into the database.
 *
 * The worker never signs EVM transactions, so a mint that happens in a browser or from a script
 * leaves no row behind. This reads each token straight from the contract, resolves its metadata,
 * and upserts - which is also the repair path if the database is ever rebuilt from chain.
 *
 * Bounded per call so one request cannot exceed the worker's CPU budget.
 */
export const indexEvmTokens = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const supply = await totalMinted(c.env)
    if (supply === 0n) return c.json({ success: true, indexed: [], skipped: [], supply: '0' })

    const from = BigInt(Math.max(parseInt(c.req.query('from') || '1', 10) || 1, 1))
    const requestedTo = c.req.query('to') ? BigInt(c.req.query('to')!) : supply
    // Never walk past what exists, and cap the span so a big backfill is paged rather than
    // timing out halfway through with no record of where it stopped.
    const to = requestedTo > supply ? supply : requestedTo
    const span = to - from + 1n
    if (span <= 0n) return c.json({ error: 'from must be <= to' }, 400)
    const capped = span > 25n ? from + 24n : to

    const indexed: Array<{ tokenId: string; assetId: string; name: string; imageOk: boolean }> = []
    const skipped: Array<{ tokenId: string; reason: string }> = []

    for (let id = from; id <= capped; id++) {
        try {
            // Same helper the public post-mint route uses, so a token indexed by either path
            // lands with identical columns.
            const row = await upsertEvmToken(c.env, connectionString, id)
            if (!row) {
                skipped.push({ tokenId: id.toString(), reason: 'token does not exist on chain' })
                continue
            }
            indexed.push({ tokenId: id.toString(), ...row })
        } catch (e: any) {
            console.error(`evm index failed for token ${id}:`, e)
            skipped.push({ tokenId: id.toString(), reason: e?.message ?? 'upsert failed' })
        }
    }

    return c.json({
        success: true,
        supply: supply.toString(),
        range: { from: from.toString(), to: capped.toString() },
        indexed,
        skipped,
        remaining: capped < to ? (to - capped).toString() : '0',
        note: 'run POST /api/admin/evm/index-listings to mirror marketplace listings',
    })
}

/**
 * Mirror the marketplace contract's listings into the Listing table.
 *
 * The chain is the source of truth: an active on-chain listing becomes an ACTIVE row, and a row
 * the chain no longer considers active is closed. That makes the sync idempotent and self-healing
 * rather than accumulating stale listings nobody can buy.
 */
export const indexEvmListings = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    const env = c.env

    // Bounded because a Worker gets 50 subrequests per request and each listing costs several
    // (one chain read, then database round trips). Sharing a request with the token indexer blew
    // that budget and the sync silently died after one listing. Page with ?limit= until
    // `remaining` is 0.
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '6', 10) || 6, 1), 10)
    const onChain = await readEvmListings(env, { limit, activeOnly: false })
    let created = 0
    let closed = 0
    let skipped = 0

    for (const l of onChain) {
        const nft = await withPrisma(connectionString, (prisma) =>
            prisma.nft.findUnique({ where: { assetId: l.assetId }, select: { id: true } })
        )
        // A listing for a token we have not indexed yet is skipped rather than guessed at.
        if (!nft) { skipped++; continue }

        const existing = await withPrisma(connectionString, (prisma) =>
            prisma.listing.findFirst({
                where: { nftId: nft.id, chain: 'ETHEREUM', sellerAddress: l.seller },
                orderBy: { createdAt: 'desc' },
            })
        )

        if (l.active) {
            if (existing?.status === 'ACTIVE') {
                if (existing.price.toString() !== l.price) {
                    await withPrisma(connectionString, (prisma) =>
                        prisma.listing.update({ where: { id: existing.id }, data: { price: l.price } })
                    )
                }
                continue
            }
            await withPrisma(connectionString, (prisma) =>
                prisma.listing.create({
                    data: {
                        nftId: nft.id,
                        chain: 'ETHEREUM',
                        sellerAddress: l.seller,
                        // Decimal string from the chain's wei value, never a float.
                        price: l.price,
                        currency: 'ETH',
                        status: 'ACTIVE',
                    },
                })
            )
            created++
        } else if (existing?.status === 'ACTIVE') {
            await withPrisma(connectionString, (prisma) =>
                prisma.listing.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } })
            )
            closed++
        }
    }

    const activeRows = await withPrisma(connectionString, (prisma) =>
        prisma.listing.count({ where: { chain: 'ETHEREUM', status: 'ACTIVE' } })
    )

    return c.json({
        success: true,
        scanned: onChain.length,
        created,
        closed,
        skipped,
        activeEthereumListings: activeRows,
    })
}

/**
 * PUT /api/admin/r2/:folder/:filename — overwrite an object in place.
 *
 * Repair path for a bad asset. An NFT's metadata URI is recorded on chain, so the URL cannot
 * change - but the bytes behind it can. Replacing the object fixes the image everywhere it is
 * referenced without any on-chain write.
 *
 * Admin-only and folder-restricted on purpose: a public endpoint that accepts an arbitrary key
 * would let anyone overwrite any asset's image.
 */
export const replaceR2Object = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const folder = c.req.param('folder')
    const filename = c.req.param('filename')

    if (!['images', 'metadata', 'audio'].includes(folder)) {
        return c.json({ error: 'folder must be images, metadata or audio' }, 400)
    }
    // No slashes or traversal: the key is built from exactly these two segments.
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
        return c.json({ error: 'filename contains characters that are not allowed' }, 400)
    }

    const key = `${folder}/${filename}`
    try {
        const existing = await c.env.NFT_IMAGES.head(key)
        if (!existing) return c.json({ error: `no existing object at ${key}` }, 404)

        const body = await c.req.arrayBuffer()
        if (body.byteLength === 0) return c.json({ error: 'empty body' }, 400)

        const contentType =
            c.req.header('content-type') || existing.httpMetadata?.contentType || 'application/octet-stream'

        await c.env.NFT_IMAGES.put(key, body, {
            httpMetadata: { contentType, cacheControl: 'public, max-age=31536000' },
        })

        return c.json({
            success: true,
            key,
            previousBytes: existing.size,
            bytes: body.byteLength,
            contentType,
        })
    } catch (e: any) {
        console.error('replaceR2Object failed:', e)
        return c.json({ error: 'Failed to replace object', details: e?.message }, 500)
    }
}
