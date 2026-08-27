// Regression check for issue 002 (auth-parity / seam 2): the six album.ts mutation routes
// and two of upload.ts's four routes (files, audio) must carry adminAuth in index.ts's route
// table; upload/image and upload/metadata must stay public for the unauthenticated mint flow
// (frontend/src/pages/CreatePage.tsx calls them with no admin key).
//
// Imports the real exported `app` from index.ts, not a rebuilt toy router, so this fails if
// adminAuth is wired to the wrong route, not just if it's entirely absent.
//
// Run: npx tsx auth-parity-check.ts
//
// Named import, not default: the default export is a handler object so the cron trigger has
// somewhere to land, and only the Hono instance itself has .request().
import { app } from './src/index'

const REAL_KEY = 'a-long-random-value-set-in-cf-secrets'
const WRONG_KEY = 'definitely-not-the-real-key'
const env = { ADMIN_API_KEY: REAL_KEY }

const call = (method: string, path: string) =>
    app.request(path, { method, headers: { 'X-Admin-API-Key': WRONG_KEY } }, env)

let failures = 0

// [method, path to call, label to print]
const gated: [string, string, string][] = [
    ['POST', '/api/albums', 'POST /api/albums'],
    ['PUT', '/api/albums/x1', 'PUT /api/albums/:id'],
    ['DELETE', '/api/albums/x1', 'DELETE /api/albums/:id'],
    ['POST', '/api/albums/x1/tracks', 'POST /api/albums/:id/tracks'],
    ['PUT', '/api/albums/x1/tracks/t1', 'PUT /api/albums/:id/tracks/:trackId'],
    ['DELETE', '/api/albums/x1/tracks/t1', 'DELETE /api/albums/:id/tracks/:trackId'],
    ['POST', '/api/upload/files', 'POST /api/upload/files'],
    ['POST', '/api/upload/audio', 'POST /api/upload/audio'],
    // Refunding is moving money back out, so it sits behind the same key as everything else
    // that mutates. Listing payments is admin-only too: it exposes what people paid.
    ['GET', '/api/admin/payments', 'GET /api/admin/payments'],
    ['POST', '/api/admin/payments/p1/refund', 'POST /api/admin/payments/:id/refund'],
]

const publicRoutes: [string, string, string][] = [
    ['POST', '/api/upload/image', 'POST /api/upload/image'],
    ['POST', '/api/upload/metadata', 'POST /api/upload/metadata'],
    // A buyer has no admin key and never will. These are the checkout surface.
    ['GET', '/api/v1/web3/fees/quote', 'GET /api/v1/web3/fees/quote'],
    ['POST', '/api/v1/payments/intent', 'POST /api/v1/payments/intent'],
    ['GET', '/api/v1/payments/abc', 'GET /api/v1/payments/:paymentId'],
    // Stripe cannot send an admin key. This one is authenticated by an HMAC over the raw
    // body instead, which is asserted separately below - "not 401" is not "not authenticated".
    ['POST', '/api/v1/stripe/webhook', 'POST /api/v1/stripe/webhook'],
]

console.log('admin-gated mutation routes (must be 401 with a wrong key):')
for (const [method, path, label] of gated) {
    const res = await call(method, path)
    if (res.status === 401) {
        console.log(`  ok   ${label} -> ${res.status}`)
    } else {
        failures++
        console.error(`  FAIL ${label} -> ${res.status} (expected gated=true)`)
    }
}

console.log('\npublic mint-flow upload routes (must stay reachable, never 401):')
for (const [method, path, label] of publicRoutes) {
    const res = await call(method, path)
    if (res.status !== 401) {
        console.log(`  ok   ${label} -> ${res.status}`)
    } else {
        failures++
        console.error(`  FAIL ${label} -> ${res.status} (expected gated=false)`)
    }
}

// The webhook is the one unauthenticated-looking route that mints NFTs, so "it is not behind
// adminAuth" must not be the end of the story. With a secret configured and no valid
// signature it has to refuse - if this ever answers 2xx, anyone can forge a paid order.
console.log('\nthe stripe webhook is signature-gated, not key-gated:')
{
    const withSecret = { ADMIN_API_KEY: REAL_KEY, STRIPE_WEBHOOK_SECRET: 'whsec_test' }
    const unsigned = await app.request(
        '/api/v1/stripe/webhook',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"payment_intent.succeeded"}' },
        withSecret
    )
    if (unsigned.status === 400) {
        console.log('  ok   an unsigned webhook body -> 400')
    } else {
        failures++
        console.error(`  FAIL an unsigned webhook body -> ${unsigned.status} (expected 400)`)
    }

    const forged = await app.request(
        '/api/v1/stripe/webhook',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}` },
            body: '{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_forged"}}}',
        },
        withSecret
    )
    if (forged.status === 400) {
        console.log('  ok   a forged signature -> 400')
    } else {
        failures++
        console.error(`  FAIL a forged signature -> ${forged.status} (expected 400)`)
    }

    // No secret configured must never mean "accept anything".
    const noSecret = await app.request(
        '/api/v1/stripe/webhook',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        { ADMIN_API_KEY: REAL_KEY }
    )
    if (noSecret.status === 503) {
        console.log('  ok   an unconfigured webhook secret -> 503, fails closed')
    } else {
        failures++
        console.error(`  FAIL an unconfigured webhook secret -> ${noSecret.status} (expected 503)`)
    }
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
