// SOL to EUR, as an exact scaled integer.
//
// The whole point of this file is that a rate never becomes a JavaScript number. `res.json()`
// on {"solana":{"eur":123.45}} hands back a float and the precision is already gone before
// any BigInt could protect it - so the response is read as text and the digits are pulled
// out as a string, then parsed with the same parseDecimal every price in this repo goes
// through.
//
// EUR is the canonical currency for the Stripe rail. Nothing here converts the other way:
// crypto amounts stay in lamports until the moment a fee has to be charged.

import { parseDecimal, ceilDiv } from './chains'

/** Decimals kept on the rate. 1e-8 of a EUR per SOL is far below one cent of a mint fee. */
export const RATE_DECIMALS = 8
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS)
const LAMPORTS_PER_SOL = 10n ** 9n

const TTL_MS = 5 * 60_000
const RATE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eur'

/**
 * Used only when the oracle has never answered, this isolate has no memo, AND the database
 * holds no recent quote to borrow a rate from.
 *
 * Deliberately far above the market so it can never under-charge. That also means it
 * over-charges - at a real rate near EUR 90 this bills roughly double - which is why every
 * other source is tried first rather than this being a casual default.
 */
const FALLBACK_EUR_PER_SOL = '200'

export type SolRate = {
    /** EUR per SOL, scaled by 10^RATE_DECIMALS. */
    scaled: bigint
    source: 'coingecko' | 'coingecko_cached' | 'coingecko_stale' | 'last_known' | 'static_fallback'
    live: boolean
}

/**
 * A rate this deployment has seen before, read from the most recent quote row.
 *
 * Every FeeQuote stores the rate it used, so the database is already a record of the last
 * rate that was actually true - it just was not being read back. This exists because the
 * module memo is per-isolate and Workers isolates are cold constantly, while the free tier
 * of the price API rate-limits after a handful of calls. Without this, a large share of
 * production traffic would price against the static constant.
 */
export type RateHint = { scaled: bigint; at: number } | null

// Module scope, so it survives across requests in the same isolate but never outlives it.
// ponytail: per-isolate memo, not shared. Move to the Cache API or KV if the oracle starts
// rate-limiting across colos.
let memo: { rate: SolRate; at: number } | null = null

/** Cut a decimal string to at most `decimals` fractional digits, truncating not rounding. */
const truncateFraction = (value: string, decimals: number): string => {
    const [whole, frac = ''] = value.split('.')
    return frac ? `${whole}.${frac.slice(0, decimals)}` : whole
}

/**
 * Pull the EUR figure out of the raw body as a string.
 *
 * A regex over text rather than a JSON parse, because JSON.parse is exactly the step that
 * turns "123.456789" into a float. Exported so a check can pin it against real response
 * shapes without a network call.
 */
export const parseEurRate = (body: string): bigint | null => {
    const m = /"eur"\s*:\s*(\d+(?:\.\d+)?)/.exec(body)
    if (!m) return null
    try {
        const scaled = parseDecimal(truncateFraction(m[1], RATE_DECIMALS), RATE_DECIMALS)
        return scaled > 0n ? scaled : null
    } catch {
        return null
    }
}

/** The static rate, for the fallback path and for tests that need a fixed number. */
export const fallbackRate = (): SolRate => ({
    scaled: parseDecimal(FALLBACK_EUR_PER_SOL, RATE_DECIMALS),
    source: 'static_fallback',
    live: false,
})

/**
 * Current SOL/EUR rate. Never throws: quoting a fee has to keep working when a free-tier
 * price API is down, and the caller reports which source answered rather than pretending
 * a fallback is a live quote.
 */
export const getSolEurRate = async (hint: RateHint = null): Promise<SolRate> => {
    const now = Date.now()
    if (memo && now - memo.at < TTL_MS) return memo.rate

    // A recently persisted rate is as good as this isolate's own memo, and using it avoids a
    // call that is rate-limited in practice. Measured: the free endpoint starts answering 429
    // after about four requests.
    if (hint && now - hint.at < TTL_MS) {
        const rate: SolRate = { scaled: hint.scaled, source: 'coingecko_cached', live: true }
        memo = { rate, at: hint.at }
        return rate
    }

    try {
        const res = await fetch(RATE_URL, { headers: { accept: 'application/json' } })
        if (res.ok) {
            const scaled = parseEurRate(await res.text())
            if (scaled) {
                const rate: SolRate = { scaled, source: 'coingecko', live: true }
                memo = { rate, at: now }
                return rate
            }
            console.error('sol/eur rate: response had no usable eur figure')
        } else {
            console.error(`sol/eur rate: http ${res.status}`)
        }
    } catch (e) {
        console.error('sol/eur rate fetch failed:', e)
    }

    // Ordered by how close each is to the truth. A rate that was real an hour ago beats a
    // constant that was written months ago, and the constant is deliberately far above the
    // market so it never under-charges - which also means it over-charges badly, so it is
    // genuinely the last resort.
    if (memo) return { ...memo.rate, source: 'coingecko_stale', live: false }
    if (hint) return { scaled: hint.scaled, source: 'last_known', live: false }
    return fallbackRate()
}

/** Only for tests - lets a check run the conversion path with a known rate. */
export const __setRateMemoForTests = (rate: SolRate | null, at = Date.now()) => {
    memo = rate ? { rate, at } : null
}

/**
 * Lamports to EUR minor units (cents), rounding up, BigInt the whole way.
 *
 *   lamports / 1e9        -> SOL
 *   SOL * scaled / 1e8    -> EUR
 *   EUR * 100             -> cents
 *
 * which collapses to lamports * scaled * 100 / (1e9 * 1e8), evaluated as one integer
 * division so there is no intermediate rounding to accumulate.
 */
export const lamportsToEurMinor = (lamports: bigint, rateScaled: bigint): number => {
    if (lamports < 0n || rateScaled <= 0n) throw new Error('lamportsToEurMinor: bad input')
    const minor = ceilDiv(lamports * rateScaled * 100n, LAMPORTS_PER_SOL * RATE_SCALE)
    // Int columns and Stripe amounts are both 32-bit; a number this large means the rate or
    // the lamport count is wrong, and silently truncating it would mis-charge someone.
    if (minor > 2_000_000_000n) throw new Error(`lamportsToEurMinor: implausible result ${minor}`)
    return Number(minor)
}

/**
 * Minor units to a display string, e.g. 27 -> "€0.27".
 *
 * String arithmetic rather than (minor / 100).toFixed(2), because dividing money by 100 in
 * JavaScript is a float operation and this repo does not do that even where it would round
 * correctly - the habit is what keeps the rule easy to check.
 */
export const formatMinor = (minor: number, currency = 'eur'): string => {
    const symbol = currency.toLowerCase() === 'eur' ? '€' : ''
    const neg = minor < 0
    const digits = String(Math.abs(minor)).padStart(3, '0')
    return `${neg ? '-' : ''}${symbol}${digits.slice(0, -2)}.${digits.slice(-2)}`
}
