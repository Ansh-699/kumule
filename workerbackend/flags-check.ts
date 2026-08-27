// Asserts for the ENABLE_DIRECT_CRYPTO gate in src/index.ts. Run: npx tsx flags-check.ts
//
// The owner's decision was that escrow AND the wallet-signed mint go dormant for the Stripe
// MVP, while every file stays in the repo. That makes the flag the only thing standing
// between "these routes are off" and "these routes are quietly still on", and a flag nobody
// tests is a flag that silently defaults the wrong way after a refactor.
//
// Imports the real app from src/index.ts rather than rebuilding a router, so this fails if a
// route is registered without its wrapper - which is exactly the mistake that would reopen
// the escrow surface by accident.
//
// Note this deliberately does NOT assert the handlers work when the flag is on; it asserts
// they are REACHED. Anything other than 404 means the gate let the request through, which is
// the whole question.
//
// Pure: no DB, no chain. The handlers fail on their own once reached, and that is fine.

import { app } from './src/index'

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}

const OFF = { ADMIN_API_KEY: 'test-key' }
const ON = { ADMIN_API_KEY: 'test-key', ENABLE_DIRECT_CRYPTO: 'true' }

const call = (method: string, path: string, env: Record<string, string>) =>
    app.request(
        path,
        {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Admin-API-Key': 'test-key' },
            ...(method === 'POST' ? { body: '{}' } : {}),
        },
        env
    )

// Every route the owner chose to switch off: the whole Solana escrow surface, settlement,
// and the wallet-signed mint.
const FLAGGED: [string, string][] = [
    ['POST', '/api/solana/mint'],
    ['POST', '/api/solana/list'],
    ['POST', '/api/solana/listing/sync'],
    ['POST', '/api/solana/buy'],
    ['POST', '/api/solana/cancel'],
    ['GET', '/api/solana/escrows'],
    ['POST', '/api/admin/escrow/resolve'],
]

// Routes that must never be affected by this flag, whichever way it is set.
const ALWAYS_OPEN: [string, string][] = [
    ['GET', '/health'],
    // Reconciliation, not a payment path. Base trading is still live in this deployment, so
    // gating this would leave EVM purchases landing on chain and never reaching the
    // marketplace.
    ['POST', '/api/settle'],
    ['GET', '/api/chains'],
    ['GET', '/openapi.json'],
    ['GET', '/api/v1/web3/fees/quote?operation=nft_mint&chain=solana'],
    ['POST', '/api/v1/payments/intent'],
    ['POST', '/api/v1/stripe/webhook'],
    ['GET', '/api/solana/asset?asset=x'],
    ['POST', '/api/solana/burn'],
    ['POST', '/api/solana/transfer'],
]

const run = async () => {
    console.log('with ENABLE_DIRECT_CRYPTO unset, the direct-crypto routes are gone:')
    for (const [method, path] of FLAGGED) {
        const res = await call(method, path, OFF)
        if (res.status === 404) ok(`${method} ${path} -> 404`)
        else fail(`${method} ${path} -> ${res.status}`, 'expected 404; the gate let this through')
    }

    console.log('')
    console.log('and they explain themselves rather than just 404ing:')
    const sample = await call('POST', '/api/solana/buy', OFF)
    const body = (await sample.json()) as { error?: string; hint?: string }
    if (body.error?.includes('disabled')) ok('the body names the reason')
    else fail('the 404 body does not explain itself', JSON.stringify(body))
    if (body.hint?.includes('/api/v1/')) ok('and points at the payment flow that replaced it')
    else fail('the 404 body offers no alternative', JSON.stringify(body))

    console.log('')
    console.log('with ENABLE_DIRECT_CRYPTO=true, the same routes are reachable again:')
    for (const [method, path] of FLAGGED) {
        const res = await call(method, path, ON)
        // Not 200 - these handlers need a database and a chain. Anything but 404 proves the
        // gate opened and the request reached the handler.
        if (res.status !== 404) ok(`${method} ${path} -> ${res.status} (reached)`)
        else fail(`${method} ${path} still 404 with the flag on`, 'the flag does not reopen it')
    }

    console.log('')
    console.log('the flag never touches anything else:')
    for (const [method, path] of ALWAYS_OPEN) {
        const off = await call(method, path, OFF)
        const on = await call(method, path, ON)
        if (off.status === 404) {
            fail(`${method} ${path} 404s with the flag off`, 'this route must not be gated')
        } else if (off.status !== on.status) {
            fail(`${method} ${path} changes with the flag`, `${off.status} off vs ${on.status} on`)
        } else {
            ok(`${method} ${path} -> ${off.status}, flag-independent`)
        }
    }

    console.log('')
    console.log('the flag is off unless it is exactly "true":')
    // A truthy-string bug here would reopen the escrow surface on any non-empty value.
    for (const value of ['false', 'False', '1', 'yes', 'TRUE', '', 'off']) {
        const res = await call('POST', '/api/solana/buy', { ...OFF, ENABLE_DIRECT_CRYPTO: value })
        if (res.status === 404) ok(`ENABLE_DIRECT_CRYPTO="${value}" leaves it closed`)
        else fail(`ENABLE_DIRECT_CRYPTO="${value}" opened the route`, `got ${res.status}`)
    }

    console.log('')
    console.log('/api/chains tells the frontend which way the flag is set:')
    for (const [env, expected] of [[OFF, false], [ON, true]] as const) {
        const res = await call('GET', '/api/chains', env)
        const json = (await res.json()) as { features?: { directCrypto?: boolean } }
        if (json.features?.directCrypto === expected) {
            ok(`features.directCrypto is ${expected}`)
        } else {
            fail('features.directCrypto is wrong', JSON.stringify(json.features))
        }
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run().catch((e) => {
    console.error('flags-check crashed:', e)
    process.exit(1)
})
