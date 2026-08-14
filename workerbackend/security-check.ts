// Regression asserts for the two things that can hand out value for free.
// Run: bun security-check.ts
//
// 1. adminAuth. Before it was hardened, two keys were compiled into the worker
//    ('anshtyagi' and 'admin-secret-key-change-in-production') and the key was also accepted
//    from a ?apiKey= query param. Both are published in a public repo, so /api/admin/* was
//    effectively open.
//
// 2. Medal eligibility. Points convert directly into a real NFT leaving the vault, so the
//    rule deciding "may this wallet claim" is money-adjacent. It lives in one pure function
//    that both the API response and the claim guard use, and these asserts pin it.
//
// The v1 payment asserts are gone with payment.ts: Coinbase Commerce shut down 2026-03-31 and
// the mint fee is now an on-chain SOL transfer verified by solana.ts.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { adminAuth } from './src/admin'
import { validateTierConfig, medalStatus } from './src/medals'

const assert = {
    strictEqual(actual: unknown, expected: unknown) {
        if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`)
    },
}

let failures = 0
const check = async (name: string, expected: number, got: Response | Promise<Response>) => {
    const status = (await got).status
    try {
        assert.strictEqual(status, expected)
        console.log(`  ok   ${name} -> ${status}`)
    } catch {
        failures++
        console.error(`  FAIL ${name} -> expected ${expected}, got ${status}`)
    }
}
const eq = (name: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got)
    const w = JSON.stringify(want)
    if (g === w) console.log(`  ok   ${name}`)
    else {
        failures++
        console.error(`  FAIL ${name}: got ${g} want ${w}`)
    }
}

// ---------------------------------------------------------------- adminAuth

const REAL_KEY = 'a-long-random-value-set-in-cf-secrets'
const app = new Hono<{ Bindings: any }>()
app.get('/api/admin/overview', adminAuth, (c) => c.json({ ok: true }))
const call = (headers: Record<string, string>, env: any, path = '/api/admin/overview') =>
    app.request(path, { headers }, env)

console.log('adminAuth:')
// Fails closed when no key is provisioned rather than falling back to a shared default.
await check('no ADMIN_API_KEY configured', 503, call({ 'X-Admin-API-Key': REAL_KEY }, {}))
await check('no key supplied', 401, call({}, { ADMIN_API_KEY: REAL_KEY }))
await check('wrong key', 401, call({ 'X-Admin-API-Key': 'nope' }, { ADMIN_API_KEY: REAL_KEY }))
await check('retired backdoor "anshtyagi"', 401,
    call({ 'X-Admin-API-Key': 'anshtyagi' }, { ADMIN_API_KEY: REAL_KEY }))
await check('retired backdoor "admin-secret-key-change-in-production"', 401,
    call({ 'X-Admin-API-Key': 'admin-secret-key-change-in-production' }, { ADMIN_API_KEY: REAL_KEY }))
// Query params land in CF request logs, browser history and Referer headers.
await check('key via ?apiKey= query param', 401,
    call({}, { ADMIN_API_KEY: REAL_KEY }, `/api/admin/overview?apiKey=${REAL_KEY}`))
await check('prefix of the real key', 401,
    call({ 'X-Admin-API-Key': REAL_KEY.slice(0, 8) }, { ADMIN_API_KEY: REAL_KEY }))
await check('correct key in header', 200,
    call({ 'X-Admin-API-Key': REAL_KEY }, { ADMIN_API_KEY: REAL_KEY }))

// ---------------------------------------------------------------- tier config

const tiers = (g: number, s: number, b: number, supply = 1) => [
    { tier: 'GOLD' as const, requiredPoints: g, supply },
    { tier: 'SILVER' as const, requiredPoints: s, supply },
    { tier: 'BRONZE' as const, requiredPoints: b, supply },
]

console.log('\nvalidateTierConfig:')
eq('the defaults are valid', validateTierConfig(tiers(100, 60, 30)).ok, true)
eq('equal thresholds allowed', validateTierConfig(tiers(50, 50, 50)).ok, true)
eq('zero is a legal threshold', validateTierConfig(tiers(0, 0, 0)).ok, true)
// Gold easier than Silver makes the tiers meaningless.
eq('inverted gold/silver rejected', validateTierConfig(tiers(10, 60, 30)).ok, false)
eq('inverted silver/bronze rejected', validateTierConfig(tiers(100, 10, 30)).ok, false)
eq('fully reversed rejected', validateTierConfig(tiers(30, 60, 100)).ok, false)
eq('negative points rejected', validateTierConfig(tiers(100, 60, -1)).ok, false)
eq('fractional points rejected', validateTierConfig(tiers(100, 60.5, 30)).ok, false)
eq('NaN points rejected', validateTierConfig(tiers(100, NaN, 30)).ok, false)
eq('zero supply rejected', validateTierConfig(tiers(100, 60, 30, 0)).ok, false)
eq('negative supply rejected', validateTierConfig(tiers(100, 60, 30, -5)).ok, false)
eq('missing a tier rejected', validateTierConfig([tiers(100, 60, 30)[0]]).ok, false)

// ---------------------------------------------------------------- medal eligibility

const medal = (over: Partial<{ requiredPoints: number; supply: number; claimedCount: number; minted: boolean }> = {}) => ({
    requiredPoints: 100,
    supply: 3,
    claimedCount: 0,
    minted: true,
    ...over,
})

console.log('\nmedalStatus:')
eq('exactly at threshold is claimable', medalStatus(medal(), 100, false).claimable, true)
eq('above threshold is claimable', medalStatus(medal(), 250, false).claimable, true)
// Off-by-one at the boundary is the whole risk here.
eq('one point short is not claimable', medalStatus(medal(), 99, false).claimable, false)
eq('one point short is not eligible', medalStatus(medal(), 99, false).eligible, false)
eq('pointsNeeded is exact', medalStatus(medal(), 99, false).pointsNeeded, 1)
eq('pointsNeeded never negative', medalStatus(medal(), 500, false).pointsNeeded, 0)
eq('shortfall reason', medalStatus(medal(), 40, false).reason, 'needs 60 more points')

// An already-claimed medal must not be claimable again even when eligible.
eq('already claimed blocks', medalStatus(medal(), 200, true).claimable, false)
eq('already claimed reason', medalStatus(medal(), 200, true).reason, 'already claimed')
eq('already claimed is still eligible', medalStatus(medal(), 200, true).eligible, true)

// An unminted medal has no asset to transfer, so claiming would fail on chain.
eq('unminted blocks', medalStatus(medal({ minted: false }), 200, false).claimable, false)
eq('unminted reason', medalStatus(medal({ minted: false }), 200, false).reason, 'not minted yet')

// Supply is the hard cap on how many assets exist.
eq('supply exhausted blocks', medalStatus(medal({ supply: 3, claimedCount: 3 }), 200, false).claimable, false)
eq('supply exhausted reason', medalStatus(medal({ supply: 3, claimedCount: 3 }), 200, false).reason, 'supply exhausted')
eq('over-claimed still blocks', medalStatus(medal({ supply: 3, claimedCount: 9 }), 200, false).claimable, false)
eq('last unit is claimable', medalStatus(medal({ supply: 3, claimedCount: 2 }), 200, false).claimable, true)

// Shortfall is reported before any other reason, so the user sees the actionable one.
eq('shortfall reported over supply', medalStatus(medal({ supply: 1, claimedCount: 1 }), 5, false).reason, 'needs 95 more points')
eq('zero-threshold medal claimable at zero points', medalStatus(medal({ requiredPoints: 0 }), 0, false).claimable, true)

// Every chain send in medals.ts must go through sendWithBoundedConfirm. umi's sendAndConfirm
// blocks on its own retry strategy past Cloudflare's 30 second request ceiling, and both of this
// file's sends happen *after* value has already moved: claimMedal's transfer killed the request
// mid-flight, so the claim row, the claimedCount increment and the owner update never ran - the
// medal reached the user's wallet while the database still showed it in the vault, and the
// vault-ownership precheck then rejected every retry, stranding the medal permanently.
//
// A source assert rather than a behavioral one: reproducing a 30 second Worker timeout offline
// is not practical, and the property that matters is which sender the code calls.
// fileURLToPath on the raw string, not `new URL(...)`: the worker types in scope here define
// their own URL, which is not assignable to node:fs's PathOrFileDescriptor.
const medalsSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'src', 'medals.ts'),
    'utf8',
)
const liveSendAndConfirm = medalsSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .filter((line) => line.includes('.sendAndConfirm('))

eq('medals.ts makes no unbounded sendAndConfirm call', liveSendAndConfirm.length, 0)
eq(
    'medals.ts routes sends through sendWithBoundedConfirm',
    medalsSource.includes('sendWithBoundedConfirm(c.env, vault.umi'),
    true,
)

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
