// Regression check for the ?to= range param in indexEvmTokens (issue 011).
//
// BigInt() throws a SyntaxError on anything that is not an integer literal, and the conversion
// runs outside any try block in indexEvmTokens, so a typo'd ?to= escaped the handler entirely
// and surfaced as a 500 rather than a 400.
//
// Hermetic: both hosts below are unroutable, so nothing here touches a real network. That also
// pins the ordering - validation has to happen before the contract read, otherwise the
// `supply === 0n` early return answers 200 and the parameter is never checked at all.
//
// Run: npx tsx admin-range-check.ts

import { Hono } from 'hono'
import { indexEvmTokens } from './src/admin'

const app = new Hono()
app.post('/index', indexEvmTokens as any)

// BASE_SEPOLIA_RPC_URL is the name evmRpc() actually reads; an unrecognised key would silently
// fall back to the real public Base Sepolia endpoint and make this check hit the network.
const env = {
    DATABASE_URL: 'postgresql://u:p@db.invalid:5432/x',
    BASE_SEPOLIA_RPC_URL: 'https://rpc.invalid/',
}

const call = (qs: string) => app.request(`/index?${qs}`, { method: 'POST' }, env)

let failures = 0

const run = async () => {
    console.log('indexEvmTokens ?to= validation:')

    for (const [qs, label] of [
        ['to=abc', 'letters'],
        ['to=1.5', 'a decimal'],
        ['to=-5', 'a negative'],
        ['to=0x10', 'hex notation'],
        ['to=1e3', 'exponent notation'],
        ['to=%20', 'whitespace'],
        ['from=1&to=abc', 'a valid from with a malformed to'],
    ] as const) {
        const res = await call(qs)
        if (res.status === 400) {
            console.log(`  ok   ${label} -> 400`)
        } else {
            console.log(`  FAIL ${label} -> ${res.status} (expected 400): ${(await res.text()).slice(0, 100)}`)
            failures++
        }
    }

    console.log('')
    console.log('well-formed ranges are not rejected by the param guard:')

    // These clear validation. The unroutable RPC then makes totalMinted return 0n, so the
    // response is the "nothing minted" 200. Anything coming back 400 with the range message
    // means the guard ate a legitimate request.
    for (const qs of ['to=5', 'from=2&to=9', 'to=0', '']) {
        const res = await call(qs)
        const body = await res.text()
        if (res.status === 400 && /to must be a non-negative integer/.test(body)) {
            console.log(`  FAIL "${qs}" was wrongly rejected by the range guard: ${body}`)
            failures++
        } else {
            console.log(`  ok   "${qs}" clears the range guard -> ${res.status}`)
        }
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run()
