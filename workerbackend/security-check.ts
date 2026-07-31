// Regression check for the admin auth hole. Run: bun security-check.ts
//
// Before the fix, adminAuth accepted two hardcoded keys compiled into the worker
// ('anshtyagi' and 'admin-secret-key-change-in-production') and also read the key from a
// ?apiKey= query param. Both are published in a public repo, so /api/admin/* - which dumps
// every user, wallet, transaction and dispute - was effectively open. These asserts fail if
// either behaviour comes back.

import { Hono } from 'hono'
import assert from 'node:assert'
import { adminAuth } from './src/admin'

const REAL_KEY = 'a-long-random-value-set-in-cf-secrets'

const app = new Hono<{ Bindings: any }>()
app.get('/api/admin/dashboard', adminAuth, (c) => c.json({ ok: true }))

const call = (headers: Record<string, string>, env: any, path = '/api/admin/dashboard') =>
    app.request(path, { headers }, env)

let failures = 0
const check = async (name: string, expected: number, got: Promise<Response>) => {
    const status = (await got).status
    try {
        assert.strictEqual(status, expected)
        console.log(`  ok   ${name} -> ${status}`)
    } catch {
        failures++
        console.error(`  FAIL ${name} -> expected ${expected}, got ${status}`)
    }
}

console.log('adminAuth:')

// Fails closed when no key is provisioned, rather than falling back to a shared default.
await check('no ADMIN_API_KEY configured', 503, call({ 'X-Admin-API-Key': REAL_KEY }, {}))

await check('no key supplied', 401, call({}, { ADMIN_API_KEY: REAL_KEY }))
await check('wrong key', 401, call({ 'X-Admin-API-Key': 'nope' }, { ADMIN_API_KEY: REAL_KEY }))

// The two keys that used to be hardcoded.
await check('retired backdoor "anshtyagi"', 401,
    call({ 'X-Admin-API-Key': 'anshtyagi' }, { ADMIN_API_KEY: REAL_KEY }))
await check('retired backdoor "admin-secret-key-change-in-production"', 401,
    call({ 'X-Admin-API-Key': 'admin-secret-key-change-in-production' }, { ADMIN_API_KEY: REAL_KEY }))

// Query params land in CF request logs, browser history and Referer headers.
await check('key via ?apiKey= query param', 401,
    call({}, { ADMIN_API_KEY: REAL_KEY }, `/api/admin/dashboard?apiKey=${REAL_KEY}`))

// A prefix of the real key must not pass.
await check('prefix of real key', 401,
    call({ 'X-Admin-API-Key': REAL_KEY.slice(0, 8) }, { ADMIN_API_KEY: REAL_KEY }))

await check('correct key in header', 200,
    call({ 'X-Admin-API-Key': REAL_KEY }, { ADMIN_API_KEY: REAL_KEY }))

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
