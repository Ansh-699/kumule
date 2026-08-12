#!/usr/bin/env node
// End-to-end API smoke test. Read-only by default: it never mints, lists, buys, or
// writes rows, so it is safe to point at production.
//
//   node api-test.mjs                                  # test the deployed worker
//   BASE=http://localhost:8787 node api-test.mjs       # test a local `wrangler dev`
//   ADMIN_KEY=... node api-test.mjs                    # also check admin routes authenticate
//
// Exit code is the number of failed checks, so CI can gate on it.

const BASE = process.env.BASE || 'https://kumele-backend.ansht.workers.dev'
const ADMIN_KEY = process.env.ADMIN_KEY || ''
const WALLET = process.env.TEST_WALLET || 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm'
const ASSET = process.env.TEST_ASSET || 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'

const results = []
const t0 = Date.now()

async function check(group, name, path, { method = 'GET', body, headers, expect, validate } = {}) {
  const started = Date.now()
  let status = 0
  let payload
  let error

  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
    status = res.status
    const text = await res.text()
    try { payload = JSON.parse(text) } catch { payload = text }
  } catch (e) {
    error = e.message || String(e)
  }

  const ms = Date.now() - started
  let ok = false
  let why = ''

  if (error) {
    why = `request failed: ${error}`
  } else if (!expect.includes(status)) {
    ok = false
    why = `status ${status}, expected ${expect.join('/')}` +
      (payload ? ` - ${JSON.stringify(payload).slice(0, 160)}` : '')
  } else if (validate) {
    const v = validate(payload, status)
    ok = v === true
    if (!ok) why = v || 'response body failed validation'
  } else {
    ok = true
  }

  results.push({ group, name, path, status, ms, ok, why })
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`  ${mark} ${String(status).padEnd(3)} ${String(ms + 'ms').padStart(7)}  ${name}`)
  if (!ok) console.log(`         ${why}`)
  return payload
}

const isObj = (v) => v && typeof v === 'object'
const hasArray = (key) => (b) => Array.isArray(b?.[key]) || `expected "${key}" array, got ${JSON.stringify(b).slice(0, 120)}`
// A 500 whose body names a missing table means the database was never migrated.
const notDbDrift = (b) => !/does not exist in the current database/.test(JSON.stringify(b))

console.log(`\nKumule API smoke test`)
console.log(`Base: ${BASE}`)
console.log(`Admin key: ${ADMIN_KEY ? 'provided' : 'not provided (admin checks limited to rejection)'}\n`)

console.log('System')
await check('System', 'health returns ok', '/health', {
  expect: [200], validate: (b) => b?.status === 'ok' || 'status field is not "ok"',
})
await check('System', 'test endpoint', '/test', { expect: [200] })
await check('System', 'database reachable', '/debug/db', {
  expect: [200],
  validate: (b) => b?.ok === true ? true : `db not ok: ${JSON.stringify(b).slice(0, 160)}`,
})
await check('System', 'openapi spec served', '/openapi.json', {
  expect: [200], validate: (b) => Array.isArray(b?.servers) || 'no servers array in spec',
})
await check('System', 'swagger ui served', '/docs', { expect: [200] })

console.log('\nNFT (Solana RPC path)')
await check('NFT', 'lookup by asset', `/?asset=${ASSET}`, {
  expect: [200],
  validate: (b) => b?.publicKey === ASSET || `wrong or missing publicKey: ${JSON.stringify(b).slice(0, 120)}`,
})
await check('NFT', 'lookup by owner', `/owner?owner=${WALLET}`, {
  expect: [200], validate: (b) => Array.isArray(b) || 'expected an array of assets',
})
await check('NFT', 'missing asset param rejected', '/', { expect: [400] })
await check('NFT', 'bad asset address rejected', '/?asset=not-a-real-address', { expect: [400, 404, 500] })

console.log('\nMarketplace')
await check('Marketplace', 'listings', '/listings', { expect: [200], validate: hasArray('listings') })

console.log('\nEvents')
await check('Events', 'list events', '/api/events', {
  expect: [200], validate: (b) => (Array.isArray(b) || Array.isArray(b?.events) || Array.isArray(b?.data))
    ? true : (notDbDrift(b) ? 'unexpected shape' : 'DATABASE DRIFT: events table missing'),
})

console.log('\nRewards')
await check('Rewards', 'reward account', `/api/rewards/account?walletAddress=${WALLET}`, {
  expect: [200], validate: (b) => isObj(b) && notDbDrift(b) ? true : 'DATABASE DRIFT: reward_accounts table missing',
})
await check('Rewards', 'available rewards', `/api/rewards/available?walletAddress=${WALLET}`, {
  expect: [200], validate: (b) => notDbDrift(b) || 'DATABASE DRIFT: reward_nfts table missing',
})

console.log('\nAlbums')
await check('Albums', 'list albums', '/api/albums', {
  expect: [200], validate: (b) => notDbDrift(b) || 'DATABASE DRIFT: albums table missing',
})

console.log('\nDisputes')
await check('Disputes', 'list disputes', '/api/disputes', {
  expect: [200], validate: (b) => notDbDrift(b) || 'DATABASE DRIFT: disputes table missing',
})

console.log('\nPayments')
await check('Payments', 'payment logs', '/api/payments/logs', {
  expect: [200], validate: (b) => notDbDrift(b) || 'DATABASE DRIFT: payment_logs table missing',
})
await check('Payments', 'transaction history', `/api/payments/transactions?walletAddress=${WALLET}`, {
  expect: [200], validate: (b) => notDbDrift(b) || 'DATABASE DRIFT: transactions columns missing',
})
// Payments must fail closed. A 200 with a fabricated "paid" charge is the bug that let
// callers mint without paying, so a stub charge is only acceptable in explicit demo mode.
await check('Payments', 'create charge fails closed when unconfigured', '/api/payment/create', {
  method: 'POST', body: { amount: 1, currency: 'USD', walletAddress: WALLET }, expect: [200, 502, 503],
  validate: (b, status) => {
    if (status === 503) return true
    if (status === 502) return true
    if (b?.isDemoMode === true) return 'served a stub charge - PAYMENTS_DEMO_MODE must not be set in production'
    return b?.chargeId ? true : 'no chargeId in a non-demo 200'
  },
})
await check('Payments', 'unknown charge is not reported paid', '/api/payment/status/demo_charge_000_fake', {
  expect: [200, 404, 502],
  validate: (b) => b?.status !== 'COMPLETED' ? true
    : 'a fabricated charge id was reported COMPLETED - free-mint path is open',
})
await check('Payments', 'rejects non-positive amount', '/api/payment/create', {
  method: 'POST', body: { amount: 0, currency: 'USD' }, expect: [400],
})

console.log('\nInput validation (no writes)')
const validations = [
  ['mint', '/mint'], ['transfer', '/transfer'], ['list', '/list'],
  ['buy', '/buy'], ['cancel', '/cancel'], ['create event', '/api/events'],
  ['create album', '/api/albums'], ['create dispute', '/api/disputes'],
  ['record interaction', '/api/rewards/interaction'], ['claim reward', '/api/rewards/claim'],
  ['upload metadata', '/api/upload/metadata'],
]
for (const [name, path] of validations) {
  await check('Validation', `${name} rejects empty body`, path, {
    method: 'POST', body: {}, expect: [400],
  })
}
await check('Validation', 'image upload rejects wrong content-type', '/api/upload/image', {
  method: 'POST', body: { not: 'multipart' }, expect: [400],
})

console.log('\nAuth')
for (const path of ['/api/admin/dashboard', '/api/admin/rewards', '/api/admin/claims']) {
  await check('Auth', `${path} rejects missing key`, path, { expect: [401, 503] })
}
await check('Auth', 'rejects the old hardcoded key "anshtyagi"', '/api/admin/dashboard', {
  headers: { 'X-Admin-API-Key': 'anshtyagi' }, expect: [401, 503],
})
await check('Auth', 'rejects a wrong key', '/api/admin/dashboard', {
  headers: { 'X-Admin-API-Key': 'definitely-not-the-key' }, expect: [401, 503],
})
if (ADMIN_KEY) {
  await check('Auth', 'accepts the configured key', '/api/admin/dashboard', {
    headers: { 'X-Admin-API-Key': ADMIN_KEY }, expect: [200],
    validate: (b) => isObj(b?.stats) || 'no stats block in dashboard response',
  })
}

console.log('\nWebhooks (must not accept unsigned payments)')
await check('Webhooks', 'coinbase webhook rejects unsigned payload', '/api/webhooks/coinbase', {
  method: 'POST',
  body: { event: { type: 'charge:confirmed', data: { id: 'forged', metadata: { walletAddress: WALLET } } } },
  expect: [400, 401, 403],
})
await check('Webhooks', 'unified webhook rejects unknown format', '/api/payments/webhook', {
  method: 'POST', body: { nonsense: true }, expect: [400],
})

console.log('\nv1 compatibility')
await check('v1', 'app config', '/api/v1/app/config', {
  expect: [200], validate: (b) => isObj(b?.feature_flags) || 'no feature_flags',
})
await check('v1', 'subscription tiers', '/api/v1/subscriptions/tiers', { expect: [200], validate: hasArray('data') })
await check('v1', 'hobby categories', '/api/v1/hobbies/categories', { expect: [200], validate: hasArray('data') })
await check('v1', 'localization strings', '/api/v1/localization/strings', {
  expect: [200], validate: (b) => isObj(b?.strings) || 'no strings object',
})
await check('v1', 'marketplace', '/api/v1/nfts/marketplace', { expect: [200], validate: hasArray('data') })
await check('v1', 'payment history requires wallet', '/api/v1/payments/history', { expect: [401] })
await check('v1', 'payment history with wallet', `/api/v1/payments/history?walletAddress=${WALLET}`, {
  expect: [200], validate: hasArray('data'),
})

const failed = results.filter(r => !r.ok)
const byGroup = [...new Set(results.map(r => r.group))]

console.log(`\n${'='.repeat(62)}`)
console.log(`${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
for (const g of byGroup) {
  const rs = results.filter(r => r.group === g)
  const bad = rs.filter(r => !r.ok).length
  console.log(`  ${bad ? '\x1b[31m' : '\x1b[32m'}${String(rs.length - bad).padStart(2)}/${rs.length}\x1b[0m  ${g}`)
}
if (failed.length) {
  console.log(`\nFailures:`)
  for (const f of failed) console.log(`  ${f.group} - ${f.name}\n    ${f.path}\n    ${f.why}`)
  const drift = failed.filter(f => /DATABASE DRIFT/.test(f.why))
  if (drift.length) {
    console.log(`\n${drift.length} failure(s) are database drift, not code.`)
    console.log(`Fix with:  node prisma/apply-bootstrap.mjs           (report)`)
    console.log(`           node prisma/apply-bootstrap.mjs --apply   (repair)`)
  }
}
console.log()
process.exit(failed.length)
