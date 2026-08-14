// Regression check for issue 009: searchNftByAsset must validate `asset` with the shared
// isSolanaAddress() base58 validator, not a bare 32-44 length window.
//
// The probe address below is 32 characters (inside the old length window) and consists only
// of base58-illegal characters (0, O, I, l), so it passes a length check and fails a real
// base58 one. Before the fix it fell through to the SOLANA_RPC_URL branch and reported a
// malformed address as a 500 server misconfiguration.
//
// Runs fully offline - the fix must reject before any RPC call is made.
//
// Run: npx tsx searchnftbyasset-check.ts

import { Hono } from 'hono'
import { searchNftByAsset } from './src/searchnftbyasset'

const BASE58_ILLEGAL = '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl' // 32 chars, none of them base58
const WELL_FORMED = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'

const app = new Hono()
app.get('/search', searchNftByAsset as any)

// SOLANA_RPC_URL is deliberately absent: that is exactly what made the old code answer 500
// for a malformed address. With the fix, validation rejects first and never reads it.
const env = {}

const call = (asset: string) => app.request(`/search?asset=${encodeURIComponent(asset)}`, {}, env)

let failures = 0
const expect = (label: string, actual: number, wanted: number, extra = '') => {
    if (actual === wanted) {
        console.log(`  ok   ${label} -> ${actual}`)
    } else {
        console.log(`  FAIL ${label} -> ${actual} (expected ${wanted})${extra ? ': ' + extra : ''}`)
        failures++
    }
}

const run = async () => {
    console.log('searchNftByAsset asset validation:')

    const missing = await call('')
    expect('missing asset rejected with 400', missing.status, 400)

    const illegal = await call(BASE58_ILLEGAL)
    expect(
        'base58-illegal asset rejected with 400, not a 500 about SOLANA_RPC_URL',
        illegal.status,
        400,
        await illegal.text(),
    )

    const short = await call('abc')
    expect('too-short asset rejected with 400', short.status, 400)

    // A well-formed address must clear validation. It will fail later (no RPC configured) -
    // that is fine and is the point: anything other than 400 proves validation let it past.
    const ok = await call(WELL_FORMED)
    if (ok.status === 400) {
        console.log(`  FAIL well-formed asset was wrongly rejected at 400: ${await ok.text()}`)
        failures++
    } else {
        console.log(`  ok   well-formed asset clears validation -> ${ok.status} (not blocked at 400)`)
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run()
