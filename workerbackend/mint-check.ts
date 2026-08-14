// Asserts for mintNft's address validation in src/mint.ts.
// Run: npx tsx mint-check.ts
//
// owner and collection used to be validated with a bare .length check (32-44 chars).
// A same-length string containing a base58-illegal character (0, O, I, l) passed that
// check, then crashed deeper in publicKey(owner)/publicKey(collection) with a raw 500
// leaking an InvalidPublicKeyError message instead of the clean 400 every other
// validated field in this handler returns. This pins that a malformed address is
// rejected at 400, and that a well-formed address still clears validation.
//
// No network or DB access needed: the fix rejects before any RPC call, so this runs
// fully offline and never reaches c.env.

import { Hono } from 'hono'
import { mintNft } from './src/mint'

let failures = 0
const check = async (name: string, expected: number, got: Response | Promise<Response>) => {
    const res = await got
    const status = res.status
    if (status === expected) {
        console.log(`  ok   ${name} -> ${status}`)
    } else {
        failures++
        const body = await res.text().catch(() => '<unreadable body>')
        console.error(`  FAIL ${name} -> expected ${expected}, got ${status}: ${body}`)
    }
}

const app = new Hono<{ Bindings: any }>()
app.post('/api/solana/mint', mintNft)
const post = (body: unknown) =>
    app.request('/api/solana/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }, {})

// 32 chars (inside the old .length check's 32-44 window), base58-illegal only (0, O, I, l).
// Passes the old check, fails isSolanaAddress.
const BASE58_ILLEGAL = '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl'
// A real, well-formed Solana address (base58, 44 chars).
const WELL_FORMED = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'

console.log('mintNft owner validation:')
await check('base58-illegal owner rejected with 400, not a raw 500', 400,
    post({ uri: 'https://example.com/meta.json', name: 'Test', owner: BASE58_ILLEGAL }))
await check('too-short owner rejected with 400', 400,
    post({ uri: 'https://example.com/meta.json', name: 'Test', owner: 'short' }))
await check('non-string owner rejected with 400', 400,
    post({ uri: 'https://example.com/meta.json', name: 'Test', owner: 12345 }))

console.log('\nmintNft collection validation:')
await check('base58-illegal collection rejected with 400, not a raw 500', 400,
    post({ uri: 'https://example.com/meta.json', name: 'Test', owner: WELL_FORMED, collection: BASE58_ILLEGAL }))

console.log('\nmintNft accepts well-formed addresses past validation:')
// A well-formed owner (and no collection) must clear the address-validation gate.
// SOLANA_RPC_URL points at an unused local port to keep the RPC leg fast and local rather
// than depending on a live devnet endpoint - mint.ts falls back to the public devnet RPC
// on a failed connection though, so what happens after validation (a successful mint build
// via that fallback, or a downstream failure) is environment-dependent and not asserted
// here. Only "did address validation block this" is: it must never be a 400, and the body
// must never carry the invalid-address message or a raw InvalidPublicKeyError.
const unreachableEnv = { SOLANA_RPC_URL: 'http://127.0.0.1:1' }
const res = await app.request('/api/solana/mint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uri: 'https://example.com/meta.json', name: 'Test', owner: WELL_FORMED }),
}, unreachableEnv)
const body = await res.text()
if (res.status === 400 || body.includes('Invalid owner wallet address') || body.includes('InvalidPublicKeyError')) {
    failures++
    console.error(`  FAIL well-formed owner clears validation -> blocked by address validation, got ${res.status}: ${body}`)
} else {
    console.log(`  ok   well-formed owner clears validation -> ${res.status} (not blocked at 400)`)
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
