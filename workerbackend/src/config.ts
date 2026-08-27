// Numeric configuration, parsed once and defended.
//
// Every value here is money or a bound on money. `parseInt(undefined)` is NaN, and a NaN
// amount propagates silently all the way to a Stripe call that fails with something
// unrelated - so a bad value throws here, at the edge, naming itself.

import { ceilDiv } from './chains'

/** A non-negative integer from the environment, or the default when unset. */
export const intEnv = (raw: string | undefined, fallback: number, label: string): number => {
    if (raw === undefined || raw === '') return fallback
    if (!/^\d+$/.test(raw.trim())) {
        throw new Error(`${label} must be a non-negative integer, got "${raw}"`)
    }
    return Number(raw.trim())
}

export type MintPricing = {
    /** Kumele's own charge for minting, in EUR minor units. */
    baseAmountMinor: number
    /** VAT in basis points; 2000 = 20%. */
    taxRateBps: number
    /** Lower bound on the blockchain fee line. */
    feeFloorMinor: number
    /**
     * Lower bound on the CHARGED TOTAL, not on any single line. Stripe rejects EUR charges
     * under 50 minor units outright, and finding that out from a live customer's declined
     * checkout is the wrong place to learn it.
     */
    minChargeMinor: number
    quoteTtlSeconds: number
    currency: string
}

export const mintPricing = (env: CloudflareBindings): MintPricing => ({
    baseAmountMinor: intEnv(env.MINT_SERVICE_PRICE_MINOR, 200, 'MINT_SERVICE_PRICE_MINOR'),
    taxRateBps: intEnv(env.TAX_RATE_BPS, 0, 'TAX_RATE_BPS'),
    feeFloorMinor: intEnv(env.MINT_FEE_FLOOR_MINOR, 15, 'MINT_FEE_FLOOR_MINOR'),
    minChargeMinor: intEnv(env.STRIPE_MIN_CHARGE_MINOR, 50, 'STRIPE_MIN_CHARGE_MINOR'),
    quoteTtlSeconds: intEnv(env.FEE_QUOTE_TTL_SECONDS, 900, 'FEE_QUOTE_TTL_SECONDS'),
    currency: 'eur',
})

/**
 * Tax on a base amount, rounded up, integer only.
 *
 * Through BigInt rather than Math.ceil(base * bps / 10000): that division is a float
 * operation, and a float that lands on 40.00000000000001 rounds up to 41 cents of tax that
 * nobody owes. Rounding direction is deliberate - under-collecting VAT is the platform's
 * liability, so a part-cent goes to the tax line rather than being dropped.
 */
export const taxOn = (baseMinor: number, bps: number): number =>
    bps <= 0 ? 0 : Number(ceilDiv(BigInt(baseMinor) * BigInt(bps), 10_000n))

/** How many times a mint job may be attempted before it is refunded rather than retried. */
export const MAX_MINT_ATTEMPTS = 5

/** How long a MINTING claim is honoured before a sweep may take the job back. */
export const MINT_LEASE_MS = 5 * 60_000

/** Direct-crypto routes are off unless this is explicitly turned on. */
export const directCryptoEnabled = (env: CloudflareBindings): boolean =>
    env.ENABLE_DIRECT_CRYPTO === 'true'
