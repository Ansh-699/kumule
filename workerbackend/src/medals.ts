// Events and medal rewards. Replaces event.ts, event-rewards.ts, event-auto-mint.ts,
// reward.ts, admin-rewards.ts and reward-drafts.ts - six files and two competing reward
// systems collapsed into one.
//
// The flow, which is admin-driven by design:
//   1. admin creates an event and configures Gold / Silver / Bronze
//   2. admin mints the medal NFTs into the vault wallet
//   3. a user joins the event
//   4. admin grants points        <- deliberately mocked, no on-chain verification
//   5. once points >= a tier's threshold the user claims
//   6. the vault key signs the transfer and the medal lands in their wallet
//
// Point granting is mocked on purpose, but it is admin-authenticated. v1 exposed
// POST /api/events/:id/progress/add-points unauthenticated with a caller-supplied `points`,
// which made the medal vault a free-NFT faucet for anyone who could read the route table.

import { Context } from 'hono'
import { Prisma } from '@prisma/client'
import { generateSigner, keypairIdentity, publicKey, type Transaction } from '@metaplex-foundation/umi'
import { createV1, transferV1, fetchAssetV1 } from '@metaplex-foundation/mpl-core'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { getUmi } from './umi'
import { withPrisma, getConnectionString, ensureUser } from './db'
import { solanaRpc, makeAssetId, isSolanaAddress } from './chains'
import { logSecurityEvent, auditedTransactionData } from './audit'
import { verifySolanaTransaction } from './solana'

const TIERS = ['GOLD', 'SILVER', 'BRONZE'] as const
type Tier = (typeof TIERS)[number]

/** Defaults matching the v1 reward config, so existing expectations still hold. */
const TIER_DEFAULTS: Record<Tier, { points: number; supply: number; name: string }> = {
    GOLD: { points: 100, supply: 1, name: 'Gold Medal' },
    SILVER: { points: 60, supply: 3, name: 'Silver Medal' },
    BRONZE: { points: 30, supply: 5, name: 'Bronze Medal' },
}

/**
 * Tier thresholds must not invert. Gold being easier than Silver makes the tiers meaningless,
 * and it is the kind of config mistake that only shows up once someone claims the wrong medal.
 */
export const validateTierConfig = (
    tiers: Array<{ tier: Tier; requiredPoints: number; supply: number }>
): { ok: true } | { ok: false; error: string } => {
    for (const t of tiers) {
        if (!Number.isInteger(t.requiredPoints) || t.requiredPoints < 0) {
            return { ok: false, error: `${t.tier}: requiredPoints must be a non-negative integer` }
        }
        if (!Number.isInteger(t.supply) || t.supply < 1) {
            return { ok: false, error: `${t.tier}: supply must be at least 1` }
        }
    }
    const at = (tier: Tier) => tiers.find((t) => t.tier === tier)?.requiredPoints
    const [gold, silver, bronze] = [at('GOLD'), at('SILVER'), at('BRONZE')]
    if (gold === undefined || silver === undefined || bronze === undefined) {
        return { ok: false, error: 'all three tiers (GOLD, SILVER, BRONZE) are required' }
    }
    if (!(gold >= silver && silver >= bronze)) {
        return { ok: false, error: 'requiredPoints must satisfy GOLD >= SILVER >= BRONZE' }
    }
    return { ok: true }
}

/**
 * Whether a wallet can claim a given medal right now, and why not when it cannot.
 *
 * Pure so the rule lives in exactly one place: the API computes it for the UI, and claimMedal
 * enforces the same conditions before touching the chain. Two copies of this would drift.
 */
export const medalStatus = (
    medal: { requiredPoints: number; supply: number; claimedCount: number; minted: boolean },
    points: number,
    alreadyClaimed: boolean
): { eligible: boolean; claimable: boolean; pointsNeeded: number; reason: string | null } => {
    const eligible = points >= medal.requiredPoints
    const pointsNeeded = Math.max(medal.requiredPoints - points, 0)

    let reason: string | null = null
    if (!eligible) reason = `needs ${pointsNeeded} more points`
    else if (alreadyClaimed) reason = 'already claimed'
    else if (!medal.minted) reason = 'not minted yet'
    else if (medal.claimedCount >= medal.supply) reason = 'supply exhausted'

    return { eligible, claimable: reason === null, pointsNeeded, reason }
}

const slugify = (name: string): string => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    return `${base || 'event'}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Vault signer that holds every unclaimed medal.
 *
 * Returns null when unset so callers answer 503 rather than throwing. The medal NFT lives in
 * the vault, so only the vault key can authorise moving it - the user's wallet cannot sign
 * this transfer, which is why v1's "return an unsigned transaction" design never worked.
 */
const vaultSigner = (env: CloudflareBindings) => {
    const secret = env.MEDAL_VAULT_PRIVATE_KEY
    if (!secret) return null
    try {
        const umi = getUmi(solanaRpc(env))
        const kp = umi.eddsa.createKeypairFromSecretKey(base58.serialize(secret))
        return { umi: umi.use(keypairIdentity(kp)), address: kp.publicKey.toString() }
    } catch (e) {
        console.error('MEDAL_VAULT_PRIVATE_KEY is not a valid base58 secret key:', e)
        return null
    }
}


/**
 * Send a built transaction and wait for confirmation within a Worker's budget.
 *
 * umi's sendAndConfirm blocks until its own strategy gives up, which took longer than the 30
 * second ceiling Cloudflare allows a request - the medal mint returned an empty body and looked
 * like it had done nothing. This sends once, then polls a bounded number of times.
 *
 * Returns the signature either way. `confirmed: false` means the transaction is in flight, not
 * that it failed, so callers must not treat it as a failure and retry blindly.
 */
const sendWithBoundedConfirm = async (
    env: CloudflareBindings,
    umi: ReturnType<typeof getUmi>,
    tx: Transaction
): Promise<{ signature: string; confirmed: boolean }> => {
    const raw = await umi.rpc.sendTransaction(tx)
    const signature = base58.deserialize(raw)[0]

    // Roughly 12 seconds of polling. Devnet MPL Core mints land in one to three.
    for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((r) => setTimeout(r, 1_500))
        if (await verifySolanaTransaction(env, signature)) return { signature, confirmed: true }
    }
    return { signature, confirmed: false }
}

const serializeMedal = (m: any) => ({
    id: m.id,
    tier: m.tier,
    chain: m.chain,
    name: m.name,
    description: m.description,
    imageUrl: m.imageUrl,
    metadataUri: m.metadataUri,
    requiredPoints: m.requiredPoints,
    supply: m.supply,
    claimedCount: m.claimedCount,
    remaining: Math.max(m.supply - m.claimedCount, 0),
    minted: Boolean(m.nftId),
    mintTxHash: m.mintTxHash,
})

// ---------------------------------------------------------------- events

/** POST /api/admin/events — create an event and its three medal tiers. */
export const createEvent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { name, description, imageUrl, startsAt, endsAt, medals } = body
    if (!name || typeof name !== 'string') {
        return c.json({ error: 'name is required' }, 400)
    }

    // Per-tier overrides, falling back to the defaults above.
    const tierConfig = TIERS.map((tier) => {
        const override = medals?.[tier.toLowerCase()] ?? medals?.[tier] ?? {}
        const requiredPoints = Number(override.requiredPoints ?? TIER_DEFAULTS[tier].points)
        const supply = Number(override.supply ?? TIER_DEFAULTS[tier].supply)
        return {
            tier,
            name: String(override.name ?? `${TIER_DEFAULTS[tier].name} - ${name}`),
            description: override.description ?? null,
            imageUrl: override.imageUrl ?? null,
            metadataUri: override.metadataUri ?? null,
            requiredPoints,
            supply,
        }
    })

    const valid = validateTierConfig(tierConfig)
    if (!valid.ok) return c.json({ error: valid.error }, 400)

    try {
        const event = await withPrisma(connectionString, (prisma) =>
            prisma.event.create({
                data: {
                    slug: slugify(name),
                    name,
                    description: description ?? null,
                    imageUrl: imageUrl ?? null,
                    status: 'ACTIVE',
                    startsAt: startsAt ? new Date(startsAt) : null,
                    endsAt: endsAt ? new Date(endsAt) : null,
                    medals: { create: tierConfig.map((t) => ({ ...t, chain: 'SOLANA' as const })) },
                },
                include: { medals: { orderBy: { requiredPoints: 'desc' } } },
            })
        )
        return c.json({
            success: true,
            event: {
                id: event.id,
                slug: event.slug,
                name: event.name,
                status: event.status,
                medals: event.medals.map(serializeMedal),
            },
        }, 201)
    } catch (e: any) {
        console.error('createEvent failed:', e)
        return c.json({ error: 'Failed to create event', details: e?.message }, 500)
    }
}

/** GET /api/events */
export const listEvents = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const status = c.req.query('status')?.toUpperCase()
    const where: Prisma.EventWhereInput = {}
    if (status && ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'].includes(status)) {
        where.status = status as any
    }

    try {
        const events = await withPrisma(connectionString, (prisma) =>
            prisma.event.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    medals: { orderBy: { requiredPoints: 'desc' } },
                    _count: { select: { participants: true, claims: true } },
                },
            })
        )
        return c.json({
            data: events.map((e) => ({
                id: e.id,
                slug: e.slug,
                name: e.name,
                description: e.description,
                imageUrl: e.imageUrl,
                status: e.status,
                startsAt: e.startsAt,
                endsAt: e.endsAt,
                participants: e._count.participants,
                claims: e._count.claims,
                medals: e.medals.map(serializeMedal),
            })),
            count: events.length,
        })
    } catch (e: any) {
        console.error('listEvents failed:', e)
        return c.json({ error: 'Failed to list events', details: e?.message }, 500)
    }
}

/** GET /api/events/:id — medals, and this wallet's progress when ?wallet= is supplied. */
export const getEvent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const id = c.req.param('id')
    const wallet = c.req.query('wallet')?.trim()

    try {
        const result = await withPrisma(connectionString, async (prisma) => {
            const event = await prisma.event.findFirst({
                where: { OR: [{ id }, { slug: id }] },
                include: {
                    medals: { orderBy: { requiredPoints: 'desc' } },
                    _count: { select: { participants: true, claims: true } },
                },
            })
            if (!event) return null

            let participant = null
            let claimedMedalIds: string[] = []
            if (wallet) {
                participant = await prisma.eventParticipant.findFirst({
                    where: { eventId: event.id, walletAddress: wallet },
                })
                const claims = await prisma.medalClaim.findMany({
                    where: { eventId: event.id, walletAddress: wallet },
                    select: { medalId: true },
                })
                claimedMedalIds = claims.map((x) => x.medalId)
            }
            return { event, participant, claimedMedalIds }
        })

        if (!result) return c.json({ error: 'Event not found' }, 404)
        const { event, participant, claimedMedalIds } = result
        const points = participant?.points ?? 0

        return c.json({
            id: event.id,
            slug: event.slug,
            name: event.name,
            description: event.description,
            imageUrl: event.imageUrl,
            status: event.status,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            participants: event._count.participants,
            claims: event._count.claims,
            you: participant
                ? {
                    joined: true,
                    points,
                    tasksCompleted: participant.tasksCompleted,
                    claimedMedalIds,
                }
                : { joined: false, points: 0, tasksCompleted: 0, claimedMedalIds: [] },
            medals: event.medals.map((m) => {
                const serialized = serializeMedal(m)
                // Same function claimMedal enforces with, so the UI and the guard cannot drift.
                const status = medalStatus(serialized, points, claimedMedalIds.includes(m.id))
                return { ...serialized, claimed: claimedMedalIds.includes(m.id), ...status }
            }),
        })
    } catch (e: any) {
        console.error('getEvent failed:', e)
        return c.json({ error: 'Failed to fetch event', details: e?.message }, 500)
    }
}

/** POST /api/events/:id/join */
export const joinEvent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const eventId = c.req.param('id')
    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const wallet = body?.walletAddress
    // Medals are Solana MPL Core assets, so a claimant needs a Solana wallet.
    if (!wallet || !isSolanaAddress(wallet)) {
        return c.json({ error: 'A valid Solana walletAddress is required' }, 400)
    }

    try {
        const result = await withPrisma(connectionString, async (prisma) => {
            const event = await prisma.event.findFirst({
                where: { OR: [{ id: eventId }, { slug: eventId }] },
                select: { id: true, status: true },
            })
            if (!event) return { error: 'Event not found', code: 404 as const }
            if (event.status !== 'ACTIVE') {
                return { error: `Event is ${event.status}, not ACTIVE`, code: 409 as const }
            }

            const userId = await ensureUser(prisma, 'SOLANA', wallet)
            // Idempotent: joining twice is a no-op rather than an error, and the unique index
            // on (eventId, userId) is what actually enforces one row.
            const participant = await prisma.eventParticipant.upsert({
                where: { eventId_userId: { eventId: event.id, userId } },
                update: {},
                create: { eventId: event.id, userId, walletAddress: wallet, chain: 'SOLANA' },
            })
            return { participant }
        })

        if ('error' in result) return c.json({ error: result.error }, result.code)
        return c.json({
            success: true,
            joined: true,
            points: result.participant.points,
            tasksCompleted: result.participant.tasksCompleted,
        })
    } catch (e: any) {
        console.error('joinEvent failed:', e)
        return c.json({ error: 'Failed to join event', details: e?.message }, 500)
    }
}

/** DELETE /api/admin/events/:id */
export const deleteEvent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    const id = c.req.param('id')
    try {
        // Cascades to medals, participants and claims via the schema.
        await withPrisma(connectionString, (prisma) => prisma.event.delete({ where: { id } }))
        return c.json({ success: true })
    } catch (e: any) {
        if (e?.code === 'P2025') return c.json({ error: 'Event not found' }, 404)
        console.error('deleteEvent failed:', e)
        return c.json({ error: 'Failed to delete event', details: e?.message }, 500)
    }
}

// ---------------------------------------------------------------- points (mocked, admin-only)

/**
 * POST /api/admin/events/:id/points — grant points to a participant.
 *
 * Mounted behind adminAuth. The points value is caller-supplied and unverified, which is the
 * agreed design for now, but that is exactly why it must never be publicly reachable: points
 * convert directly into a real NFT leaving the vault.
 */
export const grantPoints = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const eventId = c.req.param('id')
    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { walletAddress, points, reason } = body
    if (!walletAddress || !isSolanaAddress(walletAddress)) {
        return c.json({ error: 'A valid Solana walletAddress is required' }, 400)
    }
    const delta = Number(points)
    if (!Number.isInteger(delta) || delta === 0) {
        return c.json({ error: 'points must be a non-zero integer' }, 400)
    }

    try {
        const result = await withPrisma(connectionString, async (prisma) => {
            const event = await prisma.event.findFirst({
                where: { OR: [{ id: eventId }, { slug: eventId }] },
                select: { id: true },
            })
            if (!event) return { error: 'Event not found', code: 404 as const }

            const userId = await ensureUser(prisma, 'SOLANA', walletAddress)
            const existing = await prisma.eventParticipant.findUnique({
                where: { eventId_userId: { eventId: event.id, userId } },
            })
            if (!existing) return { error: 'Wallet has not joined this event', code: 409 as const }

            // Clamped at zero: a negative grant corrects a mistake, it should not create a
            // negative balance that later grants have to climb out of.
            const nextPoints = Math.max(existing.points + delta, 0)
            const participant = await prisma.eventParticipant.update({
                where: { id: existing.id },
                data: {
                    points: nextPoints,
                    tasksCompleted: delta > 0 ? { increment: 1 } : undefined,
                },
            })
            return { participant }
        })

        if ('error' in result) return c.json({ error: result.error }, result.code)
        console.log(`[MEDALS] granted ${delta} points to ${walletAddress} (${reason ?? 'no reason given'})`)
        return c.json({
            success: true,
            points: result.participant.points,
            tasksCompleted: result.participant.tasksCompleted,
        })
    } catch (e: any) {
        console.error('grantPoints failed:', e)
        return c.json({ error: 'Failed to grant points', details: e?.message }, 500)
    }
}

// ---------------------------------------------------------------- medal minting (admin)

/**
 * POST /api/admin/events/:id/medals/mint — mint one unminted medal into the vault.
 *
 * Minted up front, before anyone can claim, so a claim transfers an asset that already exists
 * rather than a mint that might fail while a user waits.
 *
 * One medal per call, deliberately. Minting all three in a single request meant three sequential
 * sendAndConfirm round trips, which exceeded the Worker's request budget and returned an empty
 * body - the mint appeared to do nothing. Call until `remaining` reaches 0.
 */
export const mintMedals = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const vault = vaultSigner(c.env)
    if (!vault) {
        return c.json(
            { error: 'MEDAL_VAULT_PRIVATE_KEY is not configured; medals cannot be minted' },
            503
        )
    }

    const eventId = c.req.param('id')

    try {
        const pending = await withPrisma(connectionString, async (prisma) => {
            const event = await prisma.event.findFirst({
                where: { OR: [{ id: eventId }, { slug: eventId }] },
                select: { id: true, name: true },
            })
            if (!event) return null
            const medals = await prisma.eventMedal.findMany({
                where: { eventId: event.id, nftId: null },
                orderBy: { requiredPoints: 'desc' },
                take: 1,
            })
            const remaining = await prisma.eventMedal.count({
                where: { eventId: event.id, nftId: null },
            })
            return { event, medals, remaining }
        })

        if (!pending) return c.json({ error: 'Event not found' }, 404)
        if (pending.medals.length === 0) {
            return c.json({ success: true, minted: [], message: 'All medals already minted' })
        }

        const minted: Array<{ tier: string; assetId: string; txHash: string }> = []
        const failed: Array<{ tier: string; error: string }> = []

        for (const medal of pending.medals) {
            try {
                const asset = generateSigner(vault.umi)
                const uri = medal.metadataUri || medal.imageUrl || ''
                if (!uri) {
                    failed.push({ tier: medal.tier, error: 'medal has no metadataUri or imageUrl' })
                    continue
                }

                // createV1 and setLatestBlockhash both return promises in this version, so each
                // is awaited before the next step rather than chained.
                const builder = await createV1(vault.umi, {
                    asset,
                    name: medal.name,
                    uri,
                    owner: vault.umi.identity.publicKey,
                })
                const withBlockhash = await builder.setLatestBlockhash(vault.umi)
                // buildAndSign, not build + identity.signTransaction: createV1 generates a new
                // asset keypair that must also sign. Signing with the vault alone produced
                // "Transaction did not pass signature verification".
                const signed = await withBlockhash.buildAndSign(vault.umi)

                const { signature: txHash, confirmed } = await sendWithBoundedConfirm(
                    c.env, vault.umi, signed
                )
                if (!confirmed) {
                    // Recorded as failed for this call rather than written to the database: the
                    // transaction may still land, and re-running picks it up once it has.
                    failed.push({
                        tier: medal.tier,
                        error: `sent but not confirmed within the request budget (${txHash}); re-run to pick it up`,
                    })
                    continue
                }
                const assetId = asset.publicKey.toString()

                // The Nft row is written only after the mint confirms, so the database never
                // claims an asset that does not exist on chain.
                await withPrisma(connectionString, async (prisma) => {
                    const nft = await prisma.nft.create({
                        data: {
                            chain: 'SOLANA',
                            assetId: makeAssetId('SOLANA', { mintAddress: assetId }),
                            mintAddress: assetId,
                            name: medal.name,
                            description: medal.description,
                            imageUrl: medal.imageUrl,
                            metadataUri: uri,
                            category: 'UTILITY',
                            ownerAddress: vault.address,
                            creatorAddress: vault.address,
                            imageOk: Boolean(medal.imageUrl),
                        },
                    })
                    await prisma.eventMedal.update({
                        where: { id: medal.id },
                        data: { nftId: nft.id, mintTxHash: txHash },
                    })
                })

                minted.push({ tier: medal.tier, assetId, txHash })
            } catch (e: any) {
                console.error(`medal mint failed for ${medal.tier}:`, e)
                failed.push({ tier: medal.tier, error: e?.message ?? String(e) })
            }
        }

        return c.json({
            success: failed.length === 0,
            vault: vault.address,
            minted,
            failed,
            // Nonzero means there is more to do: call this again.
            remaining: Math.max(pending.remaining - minted.length, 0),
        }, failed.length > 0 && minted.length === 0 ? 502 : 200)
    } catch (e: any) {
        console.error('mintMedals failed:', e)
        return c.json({ error: 'Failed to mint medals', details: e?.message }, 500)
    }
}

// ---------------------------------------------------------------- claiming

/**
 * POST /api/events/:id/medals/:medalId/claim
 *
 * The vault signs and sends the transfer, then the claim is recorded. Ordering matters: the
 * database row is written only after the asset has actually moved, so a failed transfer
 * cannot leave a claim marked complete with the medal still in the vault.
 */
export const claimMedal = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const vault = vaultSigner(c.env)
    if (!vault) {
        return c.json({ error: 'MEDAL_VAULT_PRIVATE_KEY is not configured; claims are unavailable' }, 503)
    }

    const eventId = c.req.param('id')
    const medalId = c.req.param('medalId')
    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const wallet = body?.walletAddress
    if (!wallet || !isSolanaAddress(wallet)) {
        return c.json({ error: 'A valid Solana walletAddress is required' }, 400)
    }

    try {
        // Every eligibility check happens before anything is sent on chain.
        const check = await withPrisma(connectionString, async (prisma) => {
            const event = await prisma.event.findFirst({
                where: { OR: [{ id: eventId }, { slug: eventId }] },
                select: { id: true },
            })
            if (!event) return { error: 'Event not found', code: 404 as const }

            const medal = await prisma.eventMedal.findFirst({
                where: { id: medalId, eventId: event.id },
                include: { nft: true },
            })
            if (!medal) return { error: 'Medal not found for this event', code: 404 as const }
            if (!medal.nftId || !medal.nft) {
                return { error: 'Medal has not been minted yet', code: 409 as const }
            }
            if (medal.claimedCount >= medal.supply) {
                return { error: 'Medal supply exhausted', code: 409 as const }
            }

            const userId = await ensureUser(prisma, 'SOLANA', wallet)
            const participant = await prisma.eventParticipant.findUnique({
                where: { eventId_userId: { eventId: event.id, userId } },
            })
            if (!participant) return { error: 'Wallet has not joined this event', code: 409 as const }
            if (participant.points < medal.requiredPoints) {
                return {
                    error: `Not enough points: have ${participant.points}, need ${medal.requiredPoints}`,
                    code: 403 as const,
                }
            }

            const already = await prisma.medalClaim.findUnique({
                where: { medalId_userId: { medalId: medal.id, userId } },
            })
            if (already) return { error: 'Medal already claimed by this wallet', code: 409 as const }

            return { eventId: event.id, medal, userId, points: participant.points }
        })

        if ('error' in check) return c.json({ error: check.error }, check.code)

        // The asset must still be in the vault. If it is not, something moved it out of band
        // and transferring would fail anyway - better to say so precisely.
        const mintAddress = check.medal.nft!.mintAddress!
        const onChain = await fetchAssetV1(vault.umi, publicKey(mintAddress)).catch(() => null)
        if (!onChain) {
            return c.json({ error: 'Medal asset could not be read on chain' }, 502)
        }
        if (onChain.owner.toString() !== vault.address) {
            logSecurityEvent('suspicious_activity', {
                actor: wallet,
                target: mintAddress,
                metadata: { reason: 'medal_not_in_vault', owner: onChain.owner.toString() },
            })
            return c.json({ error: 'Medal is no longer held by the vault' }, 409)
        }

        // sendWithBoundedConfirm, not sendAndConfirm - the same reason mintMedals uses it. umi's
        // sendAndConfirm blocks on its own retry strategy for longer than Cloudflare's 30 second
        // request ceiling, so a slow confirmation killed the request *after* the transfer was
        // already in flight. Nothing below then ran: no claim row, no claimedCount increment, no
        // owner update. The medal landed in the user's wallet while the database still showed it
        // in the vault, and every retry hit the "no longer held by the vault" check above, so the
        // medal was permanently unclaimable and uncounted.
        const builder = await transferV1(vault.umi, {
            asset: publicKey(mintAddress),
            newOwner: publicKey(wallet),
        })
        const withBlockhash = await builder.setLatestBlockhash(vault.umi)
        const signed = await withBlockhash.buildAndSign(vault.umi)
        const { signature: txHash, confirmed } = await sendWithBoundedConfirm(c.env, vault.umi, signed)

        // Recorded whether or not confirmation arrived inside the budget. An unconfirmed transfer
        // is in flight, not failed, and leaving it unrecorded is what stranded the medal: the
        // Transaction row carries PENDING so a reconciliation can settle it, and the unique index
        // on (medalId, userId) is still the real guard against a double claim.
        await withPrisma(connectionString, async (prisma) => {
            await prisma.medalClaim.create({
                data: {
                    medalId: check.medal.id,
                    eventId: check.eventId,
                    userId: check.userId,
                    walletAddress: wallet,
                    pointsAtClaim: check.points,
                    txHash,
                },
            })
            await prisma.eventMedal.update({
                where: { id: check.medal.id },
                data: { claimedCount: { increment: 1 } },
            })
            await prisma.nft.update({
                where: { id: check.medal.nftId! },
                data: { ownerAddress: wallet },
            })
            await prisma.transaction.create({
                data: await auditedTransactionData({
                    chain: 'SOLANA',
                    kind: 'MEDAL_CLAIM',
                    status: confirmed ? 'CONFIRMED' : 'PENDING',
                    userId: check.userId,
                    walletAddress: wallet,
                    txHash,
                    assetId: check.medal.nft!.assetId,
                    metadata: {
                        eventId: check.eventId,
                        medalId: check.medal.id,
                        tier: check.medal.tier,
                    },
                }),
            })
        })

        return c.json({
            success: true,
            confirmed,
            tier: check.medal.tier,
            assetId: check.medal.nft!.assetId,
            txHash,
            // `confirmed: false` means the transfer is in flight, not that it failed. Callers must
            // not retry on it - the claim is already recorded and a retry would be rejected.
            ...(confirmed ? {} : { note: 'Transfer sent but not yet confirmed; it should land shortly.' }),
            explorerUrl: `https://explorer.solana.com/tx/${txHash}?cluster=devnet`,
        })
    } catch (e: any) {
        console.error('claimMedal failed:', e)
        return c.json({ error: 'Failed to claim medal', details: e?.message }, 500)
    }
}

/** GET /api/admin/events/:id/claims */
export const listClaims = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const eventId = c.req.param('id')
    try {
        const claims = await withPrisma(connectionString, async (prisma) => {
            const event = await prisma.event.findFirst({
                where: { OR: [{ id: eventId }, { slug: eventId }] },
                select: { id: true },
            })
            if (!event) return null
            return prisma.medalClaim.findMany({
                where: { eventId: event.id },
                orderBy: { claimedAt: 'desc' },
                include: { medal: { select: { tier: true, name: true } } },
            })
        })
        if (!claims) return c.json({ error: 'Event not found' }, 404)

        return c.json({
            data: claims.map((cl) => ({
                id: cl.id,
                tier: cl.medal.tier,
                medalName: cl.medal.name,
                walletAddress: cl.walletAddress,
                pointsAtClaim: cl.pointsAtClaim,
                txHash: cl.txHash,
                explorerUrl: cl.txHash
                    ? `https://explorer.solana.com/tx/${cl.txHash}?cluster=devnet`
                    : null,
                claimedAt: cl.claimedAt,
            })),
            count: claims.length,
        })
    } catch (e: any) {
        console.error('listClaims failed:', e)
        return c.json({ error: 'Failed to list claims', details: e?.message }, 500)
    }
}

/** GET /api/events/:id/leaderboard */
export const getLeaderboard = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const eventId = c.req.param('id')
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '25', 10) || 25, 1), 100)

    try {
        const rows = await withPrisma(connectionString, async (prisma) => {
            const event = await prisma.event.findFirst({
                where: { OR: [{ id: eventId }, { slug: eventId }] },
                select: { id: true },
            })
            if (!event) return null
            return prisma.eventParticipant.findMany({
                where: { eventId: event.id },
                orderBy: [{ points: 'desc' }, { joinedAt: 'asc' }],
                take: limit,
            })
        })
        if (!rows) return c.json({ error: 'Event not found' }, 404)

        return c.json({
            data: rows.map((p, i) => ({
                rank: i + 1,
                walletAddress: p.walletAddress,
                points: p.points,
                tasksCompleted: p.tasksCompleted,
                joinedAt: p.joinedAt,
            })),
            count: rows.length,
        })
    } catch (e: any) {
        console.error('getLeaderboard failed:', e)
        return c.json({ error: 'Failed to fetch leaderboard', details: e?.message }, 500)
    }
}
