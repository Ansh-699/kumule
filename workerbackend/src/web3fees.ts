// Blockchain processing fee quotes.
//
// Kumele's platform wallet pays the real Solana cost of a mint, and the buyer covers it
// economically through a line on the Stripe invoice. This file is the estimate behind that
// line, and everything about it rounds towards the platform: a fee quoted low is money
// Kumele pays out of pocket on every single mint.
//
// What a mint actually costs, in the order the numbers matter:
//
// What a mint actually costs, measured on devnet rather than reasoned about:
//
//   MPL Core fee      1,500,000 lamports   Metaplex charges a flat protocol fee to create an
//                                          asset. It is deposited into the asset account on
//                                          top of rent, so it does not appear in any rent
//                                          calculation and is invisible until you diff a real
//                                          fee payer's balance.
//   rent exemption   ~1,700,000 lamports   a new account must be rent-exempt at creation
//   priority fee         10,000 lamports   what withPriorityFees actually attaches
//   signature fee        10,000 lamports   5,000 per signature, and a mint has two
//
// A real devnet mint came to 3,225,200 lamports against an account holding 3,205,200 for
// 117 bytes of data - rent for which is 1,705,200. The 1,500,000 difference is the protocol
// fee, and leaving it out under-charged by about a third on every mint.
//
// The transaction fee, the number everyone reaches for first, is 0.6% of the total.

import { Context } from 'hono'
import { CHAIN_CONFIG, fromBaseUnits, ceilDiv } from './chains'
import { rpc, rentExemptLamports } from './solana'
import { getSolEurRate, lamportsToEurMinor, formatMinor, type SolRate } from './fx'
import { mintPricing } from './config'
import { withPrisma, getConnectionString } from './db'

/** Lamports per signature, fixed by the runtime. */
const LAMPORTS_PER_SIGNATURE = 5_000n
/** A mint is signed by the fee payer and by the new asset keypair. */
const SIGNATURES_PER_MINT = 2n

/**
 * Metaplex's flat protocol fee for creating a Core asset.
 *
 * Not rent, and not a transaction fee: it lands in the asset account alongside the rent, so
 * getMinimumBalanceForRentExemption does not know about it and nothing on chain will tell you
 * it is coming. Measured by diffing a real fee payer's balance across a devnet mint - the
 * account held exactly 1,500,000 lamports more than its rent-exempt minimum.
 */
const MPL_CORE_CREATE_FEE = 1_500_000n

/**
 * Compute budget the mint transaction asks for, and the price it offers per unit. These are
 * the defaults withPriorityFees already applies, kept here so the fee we quote is the fee we
 * actually attach - quoting a priority fee and then sending a transaction without one is
 * charging for something we did not buy.
 */
export const COMPUTE_UNITS = 200_000
/** Exported so a check can assert the quote covers what a real mint actually costs. */
export const CORE_CREATE_FEE_LAMPORTS = MPL_CORE_CREATE_FEE
export const PRIORITY_MICRO_LAMPORTS = 50_000

/** Priority fee in lamports implied by a micro-lamport-per-compute-unit price. */
const priorityLamports = (microLamportsPerCu: number): bigint =>
    ceilDiv(BigInt(Math.round(microLamportsPerCu)) * BigInt(COMPUTE_UNITS), 1_000_000n)

/**
 * Bytes to reserve when asking the cluster for a rent-exempt minimum.
 *
 * Solved, not guessed. Two real devnet assets give two equations:
 *
 *     117 bytes total - name 10  - uri 32  = 75
 *     303 bytes total - name 37  - uri 191 = 75
 *
 * so assetBytes = 75 + len(name) + len(uri), counted in UTF-8 BYTES. Characters would be
 * wrong: an emoji in a name is one character and four bytes, and the chain stores bytes.
 */
export const MPL_CORE_ASSET_FIXED_BYTES = 75

/** Longest name and URI createIntent will accept, and therefore the most a quote must cover. */
export const MAX_NAME_BYTES = 128
export const MAX_URI_BYTES = 200

/**
 * What to assume when the caller does not say how big the asset is.
 *
 * A flat guess is wrong in both directions - it over-charges a short asset and under-charges
 * a long one, and under-charging is money Kumele never gets back. So this is the worst case
 * createIntent permits, and callers who know their asset (the frontend uploads its metadata
 * before asking for a price) send the real sizes and get charged for the real thing.
 */
const DEFAULT_ASSET_BYTES = MPL_CORE_ASSET_FIXED_BYTES + MAX_NAME_BYTES + MAX_URI_BYTES

/** Bytes an asset account needs for a given name and URI. */
export const assetBytesFor = (nameBytes: number, uriBytes: number): number =>
    MPL_CORE_ASSET_FIXED_BYTES + nameBytes + uriBytes

/** UTF-8 byte length, which is what the chain actually stores. */
export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length

export type FeeSource =
    | 'helius_priority_fee_estimate'
    | 'solana_recent_prioritization_fees'
    | 'static_fallback'

/**
 * Priority fee estimate, in lamports.
 *
 * Helius exposes getPriorityFeeEstimate and nothing else does, so this is one branch rather
 * than a strategy: if the configured RPC is Helius, ask it; otherwise use the same constant
 * the transaction builder attaches. Devnet's getRecentPrioritizationFees returns essentially
 * zeros, so a third path would be three implementations of "0".
 */
const estimatePriorityFee = async (
    env: CloudflareBindings
): Promise<{ lamports: bigint; source: FeeSource }> => {
    const isHelius = (env.SOLANA_RPC_URL ?? '').includes('helius')
    if (isHelius) {
        const r = await rpc<{ priorityFeeEstimate?: number }>(env, 'getPriorityFeeEstimate', [
            { options: { recommended: true } },
        ])
        const estimate = r?.priorityFeeEstimate
        if (typeof estimate === 'number' && Number.isFinite(estimate) && estimate >= 0) {
            // Never quote below what we will actually attach, or the transaction costs more
            // than the invoice says.
            const lamports = priorityLamports(Math.max(estimate, PRIORITY_MICRO_LAMPORTS))
            return { lamports, source: 'helius_priority_fee_estimate' }
        }
    }
    return {
        lamports: priorityLamports(PRIORITY_MICRO_LAMPORTS),
        source: 'static_fallback',
    }
}

export type MintFeeQuote = {
    /** Size this quote paid rent for. createIntent refuses an asset larger than this. */
    assetBytes: number
    operation: 'nft_mint'
    chain: 'solana'
    quantity: number
    currency: string
    networkFeeLamports: bigint
    rate: SolRate
    estimatedFeeMinor: number
    source: FeeSource
    confidence: 'estimated' | 'fallback'
    expiresAt: Date
}

/** The maximum a single quote may cover. Bounds one payment's blast radius. */
export const MAX_QUANTITY = 50

/**
 * Price a mint. Pure of HTTP, so the payment endpoint and the check can both call it.
 *
 * Never throws on a degraded dependency: an unreachable price oracle or an RPC that will
 * not answer produces a fallback-flavoured quote rather than a dead checkout. `confidence`
 * says which happened, honestly.
 */
export const quoteMintFee = async (
    env: CloudflareBindings,
    quantity = 1,
    assetBytes: number = DEFAULT_ASSET_BYTES
): Promise<MintFeeQuote> => {
    const pricing = mintPricing(env)

    const [priority, rentFromChain, rate] = await Promise.all([
        estimatePriorityFee(env),
        rentExemptLamports(env, assetBytes),
        getSolEurRate(),
    ])

    // (128 + bytes) * 6960 is the runtime's own formula, used only when the cluster will not
    // answer. It gives 890,880 for an empty account and 2,039,280 for a 165-byte token
    // account, both of which are the documented figures.
    const rent = rentFromChain ?? BigInt(128 + assetBytes) * 6_960n

    const perMint =
        LAMPORTS_PER_SIGNATURE * SIGNATURES_PER_MINT +
        priority.lamports +
        rent +
        MPL_CORE_CREATE_FEE
    const networkFeeLamports = perMint * BigInt(quantity)

    const converted = lamportsToEurMinor(networkFeeLamports, rate.scaled)
    const estimatedFeeMinor = Math.max(pricing.feeFloorMinor, converted)

    // A quote built on a stale or fallback rate, or on a rent figure the chain did not
    // confirm, is still a usable quote - but it must not claim to be a live estimate.
    const degraded = !rate.live || rentFromChain === null
    const source: FeeSource = rentFromChain === null ? 'static_fallback' : priority.source

    return {
        assetBytes,
        operation: 'nft_mint',
        chain: 'solana',
        quantity,
        currency: pricing.currency,
        networkFeeLamports,
        rate,
        estimatedFeeMinor,
        source,
        confidence: degraded ? 'fallback' : 'estimated',
        expiresAt: new Date(Date.now() + pricing.quoteTtlSeconds * 1_000),
    }
}

/** The wire shape. Exported so a check can pin the key names against the agreed contract. */
export const serializeQuote = (quoteId: string, q: MintFeeQuote) => ({
    quote_id: quoteId,
    operation: q.operation,
    chain: q.chain,
    currency: q.currency,
    quantity: q.quantity,
    // Named for what it is rather than for who signs: the platform wallet pays the chain,
    // and charged_to_user says the buyer reimburses it. Both facts are on the invoice.
    fee_payer: 'kumele_platform_wallet',
    charged_to_user: true,
    estimated_network_fee: {
        // A JSON number would lose lamport precision above 2^53; this is well under, but the
        // string beside it is the one to trust.
        lamports: Number(q.networkFeeLamports),
        sol: fromBaseUnits(q.networkFeeLamports, 'SOLANA'),
    },
    estimated_fee_minor: q.estimatedFeeMinor,
    display_amount: formatMinor(q.estimatedFeeMinor, q.currency),
    label: 'NFT minting fee',
    expires_at: q.expiresAt.toISOString(),
    // A label for which estimator answered. Never a URL and never a key: the Helius endpoint
    // lives in SOLANA_RPC_URL on the server and appears in no response body.
    source: q.source,
    confidence: q.confidence,
})

/**
 * GET /api/v1/web3/fees/quote?operation=nft_mint&chain=solana&quantity=1
 *
 * Persists the quote before returning it, because "what did we estimate, and at what rate"
 * has to be answerable months later when someone reconciles the fee charged against the
 * lamports actually spent.
 */
export const getFeeQuote = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const operation = (c.req.query('operation') ?? 'nft_mint').toLowerCase()
    const chain = (c.req.query('chain') ?? 'solana').toLowerCase()
    const quantityRaw = c.req.query('quantity') ?? '1'

    if (operation !== 'nft_mint') {
        return c.json({ error: `Unsupported operation "${operation}". Only nft_mint is priced.` }, 400)
    }
    if (chain !== 'solana') {
        return c.json(
            { error: `Unsupported chain "${chain}". Only solana mints are paid for through Stripe.` },
            400
        )
    }
    if (!/^\d+$/.test(quantityRaw)) {
        return c.json({ error: 'quantity must be a positive integer' }, 400)
    }
    const quantity = Number(quantityRaw)
    if (quantity < 1 || quantity > MAX_QUANTITY) {
        return c.json({ error: `quantity must be between 1 and ${MAX_QUANTITY}` }, 400)
    }

    // Optional, and the difference between a guess and a price. A caller that already knows
    // what it is minting - the frontend uploads its metadata before asking - sends the sizes
    // and is charged for that asset. Everyone else gets the worst case createIntent allows,
    // because the only safe assumption is the expensive one.
    const nameBytesRaw = c.req.query('nameBytes')
    const uriBytesRaw = c.req.query('uriBytes')
    let assetBytes: number | undefined
    if (nameBytesRaw !== undefined || uriBytesRaw !== undefined) {
        if (!/^\d+$/.test(nameBytesRaw ?? '') || !/^\d+$/.test(uriBytesRaw ?? '')) {
            return c.json({ error: 'nameBytes and uriBytes must both be non-negative integers' }, 400)
        }
        const nameBytes = Number(nameBytesRaw)
        const uriBytes = Number(uriBytesRaw)
        if (nameBytes > MAX_NAME_BYTES || uriBytes > MAX_URI_BYTES) {
            return c.json(
                { error: `nameBytes must be at most ${MAX_NAME_BYTES} and uriBytes at most ${MAX_URI_BYTES}` },
                400
            )
        }
        assetBytes = assetBytesFor(nameBytes, uriBytes)
    }

    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    try {
        const quote = await quoteMintFee(c.env, quantity, assetBytes)
        const row = await withPrisma(connectionString, (prisma) =>
            prisma.feeQuote.create({
                data: {
                    operation: quote.operation,
                    chain: 'SOLANA',
                    quantity: quote.quantity,
                    currency: quote.currency,
                    networkFeeLamports: quote.networkFeeLamports,
                    assetBytes: quote.assetBytes,
                    rateScaled: quote.rate.scaled,
                    estimatedFeeMinor: quote.estimatedFeeMinor,
                    source: quote.source,
                    confidence: quote.confidence,
                    expiresAt: quote.expiresAt,
                },
                select: { id: true },
            })
        )
        return c.json(serializeQuote(row.id, quote))
    } catch (e: any) {
        console.error('fee quote failed:', e)
        return c.json({ error: 'Could not price this mint', details: e?.message }, 500)
    }
}

/** Currency label for the chain a quote covers. Kept next to the quote for the admin view. */
export const chainCurrency = () => CHAIN_CONFIG.SOLANA.currency
