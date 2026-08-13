#!/usr/bin/env node
// End-to-end smoke test for the Kumule v2 API.
//
// Read-only: it never mints, lists, buys, or writes a row, so it is safe against production.
// Exit code is the number of failed checks, so CI can gate on it.
//
//   node api-test.mjs
//   BASE=http://localhost:8787 node api-test.mjs
//   ADMIN_KEY=... node api-test.mjs      # also exercises the admin surface
//
// This replaced the v1 suite wholesale. The old file tested /mint, /listings, /api/rewards/*,
// /api/disputes and /api/v1/* - routes v2 removed or moved - so every correct 404 read as a
// failure and the run reported 10/47 on a healthy deployment.

const BASE = (process.env.BASE || 'https://kumele-backend.ansht.workers.dev').replace(/\/$/, '')
const ADMIN_KEY = process.env.ADMIN_KEY || ''
const SOL_WALLET = process.env.TEST_WALLET || 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm'
const SOL_ASSET = process.env.TEST_ASSET || 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'

const results = []
const t0 = Date.now()

async function check(group, name, path, opts = {}) {
    const { method = 'GET', body, headers, expect, validate } = opts
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

    if (error) why = `request failed: ${error}`
    else if (!expect.includes(status)) {
        why = `status ${status}, expected ${expect.join('/')}` +
            (payload ? ` - ${JSON.stringify(payload).slice(0, 160)}` : '')
    } else if (validate) {
        const v = validate(payload, status)
        ok = v === true
        if (!ok) why = v || 'response body failed validation'
    } else ok = true

    results.push({ group, name, path, status, ms, ok, why })
    console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${String(status).padEnd(3)} ${String(ms + 'ms').padStart(7)}  ${name}`)
    if (!ok) console.log(`         ${why}`)
    return payload
}

const isObj = (v) => v && typeof v === 'object'
const hasArray = (key) => (b) => Array.isArray(b?.[key]) || `expected "${key}" array, got ${JSON.stringify(b).slice(0, 120)}`
// A missing table means the schema was never applied to whatever DATABASE_URL points at.
const notDbDrift = (b) =>
    !/does not exist in the current database/.test(JSON.stringify(b)) || 'DATABASE DRIFT: schema not applied'
/** Money must never arrive as a JSON number - a float cannot hold 0.1 exactly. */
const pricesAreStrings = (items, pick) => {
    for (const item of items ?? []) {
        const v = pick(item)
        if (v === null || v === undefined) continue
        if (typeof v !== 'string') return `price came back as ${typeof v}, expected a decimal string`
    }
    return true
}

console.log(`\nKumule v2 API smoke test`)
console.log(`Base: ${BASE}`)
console.log(`Admin key: ${ADMIN_KEY ? 'provided' : 'not provided (admin checks limited to rejection)'}\n`)

console.log('System')
await check('System', 'health reports v2', '/health', {
    expect: [200],
    validate: (b) => (b?.status === 'ok' && String(b?.version).startsWith('2'))
        || `expected status ok and version 2.x, got ${JSON.stringify(b)}`,
})
await check('System', 'database reachable', '/debug/db', {
    expect: [200],
    validate: (b) => b?.ok === true ? true : `db not ok: ${JSON.stringify(b).slice(0, 160)}`,
})
await check('System', 'schema present (all v2 tables counted)', '/debug/db', {
    expect: [200],
    validate: (b) => ['users', 'wallets', 'nfts', 'listings', 'sales', 'events']
        .every((k) => typeof b?.[k] === 'number') || `missing counts: ${JSON.stringify(b)}`,
})
await check('System', 'chain registry lists both chains', '/api/chains', {
    expect: [200],
    validate: (b) => {
        const chains = (b?.data ?? []).map((c) => c.chain)
        if (!chains.includes('SOLANA') || !chains.includes('ETHEREUM')) return `got ${chains.join()}`
        const evm = b.data.find((c) => c.chain === 'ETHEREUM')
        return evm?.chainId === 84532 || `expected Base Sepolia chainId 84532, got ${evm?.chainId}`
    },
})
await check('System', 'openapi spec is v2', '/openapi.json', {
    expect: [200],
    validate: (b) => String(b?.info?.version).startsWith('2') || `spec version ${b?.info?.version}`,
})
await check('System', 'unknown route 404s as JSON', '/definitely-not-a-route', {
    expect: [404],
    validate: (b) => typeof b?.error === 'string' || 'expected a JSON error body',
})

console.log('\nMarketplace (chain-agnostic reads)')
await check('Marketplace', 'browse NFTs', '/api/nfts', {
    expect: [200],
    validate: (b) => {
        if (!Array.isArray(b?.data)) return notDbDrift(b) === true ? 'no data array' : notDbDrift(b)
        if (typeof b.total !== 'number' || typeof b.hasMore !== 'boolean') return 'missing paging fields'
        // Every item must carry its chain: the badge on each card is data, not a guess.
        const missing = b.data.find((n) => !n.chain || !n.chainLabel)
        if (missing) return `item ${missing.assetId} has no chain`
        return pricesAreStrings(b.data, (n) => n.listing?.price)
    },
})
await check('Marketplace', 'chain filter accepts an alias', '/api/nfts?chain=sol&limit=1', {
    expect: [200],
    validate: (b) => b?.filters?.chain === 'SOLANA' || `alias not normalised: ${JSON.stringify(b?.filters)}`,
})
await check('Marketplace', 'ethereum alias normalises', '/api/nfts?chain=base&limit=1', {
    expect: [200],
    validate: (b) => b?.filters?.chain === 'ETHEREUM' || `got ${JSON.stringify(b?.filters)}`,
})
await check('Marketplace', 'bogus chain is ignored, not an error', '/api/nfts?chain=dogecoin&limit=1', {
    expect: [200],
    validate: (b) => b?.filters?.chain === null || `expected null chain filter, got ${b?.filters?.chain}`,
})
await check('Marketplace', 'limit is clamped', '/api/nfts?limit=99999', {
    expect: [200],
    validate: (b) => b?.limit <= 100 || `limit not clamped: ${b?.limit}`,
})
await check('Marketplace', 'category filter', '/api/nfts?category=ART&limit=1', { expect: [200] })
await check('Marketplace', 'sort accepted', '/api/nfts?sort=most_liked&limit=1', {
    expect: [200],
    validate: (b) => b?.filters?.sort === 'most_liked' || `sort not applied`,
})
await check('Marketplace', 'search accepted', '/api/nfts?search=test&limit=1', { expect: [200] })
await check('Marketplace', 'listings', '/api/listings', {
    expect: [200],
    validate: (b) => Array.isArray(b?.data)
        ? pricesAreStrings(b.data, (l) => l.price)
        : notDbDrift(b),
})
await check('Marketplace', 'collections', '/api/collections', {
    expect: [200],
    validate: (b) => Array.isArray(b?.data)
        ? pricesAreStrings(b.data, (c) => c.floorPrice)
        : notDbDrift(b),
})
await check('Marketplace', 'stats carry per-chain volume as strings', '/api/stats', {
    expect: [200],
    validate: (b) => {
        if (!isObj(b?.chains?.SOLANA) || !isObj(b?.chains?.ETHEREUM)) return 'missing per-chain stats'
        for (const c of ['SOLANA', 'ETHEREUM']) {
            if (typeof b.chains[c].volume !== 'string') return `${c} volume is ${typeof b.chains[c].volume}`
        }
        return typeof b?.totals?.nfts === 'number' || 'missing totals'
    },
})
await check('Marketplace', 'unknown assetId 404s', '/api/nfts/not-a-real-asset', { expect: [404] })

console.log('\nSolana (devnet)')
await check('Solana', 'asset lookup from chain', `/api/solana/asset?asset=${SOL_ASSET}`, {
    expect: [200],
    validate: (b) => b?.publicKey === SOL_ASSET || `got ${JSON.stringify(b).slice(0, 120)}`,
})
await check('Solana', 'owner lookup from chain', `/api/solana/owner?owner=${SOL_WALLET}`, {
    expect: [200],
    validate: (b) => Array.isArray(b) || 'expected an array of assets',
})
await check('Solana', 'missing asset param rejected', '/api/solana/asset', { expect: [400] })
await check('Solana', 'escrow accounts read from chain', '/api/solana/escrows', {
    expect: [200],
    validate: (b) => {
        if (!Array.isArray(b?.listings)) return 'expected listings array'
        // The escrow price is a u64 of lamports; it must not come back as a float.
        return pricesAreStrings(b.listings, (l) => l.price)
    },
})
// Fails closed: a bogus signature must never verify.
await check('Solana', 'bogus signature does not verify', '/api/solana/verify/' + 'z'.repeat(88), {
    expect: [400],
    validate: (b) => b?.verified === false || 'a bogus signature reported verified',
})
await check('Solana', 'malformed signature does not verify', '/api/solana/verify/abc', {
    expect: [400],
    validate: (b) => b?.verified === false || 'a malformed signature reported verified',
})

console.log('\nEthereum (Base Sepolia)')
await check('Ethereum', 'contract addresses', '/api/evm/contracts', {
    expect: [200],
    validate: (b) => (b?.chainId === 84532 && /^0x[0-9a-fA-F]{40}$/.test(b?.nft ?? '') && /^0x[0-9a-fA-F]{40}$/.test(b?.market ?? ''))
        || `unexpected: ${JSON.stringify(b)}`,
})
await check('Ethereum', 'total supply read from chain', '/api/evm/supply', {
    expect: [200],
    // A uint256 as a string, so a large supply cannot lose precision.
    validate: (b) => typeof b?.totalMinted === 'string' || `totalMinted is ${typeof b?.totalMinted}`,
})
await check('Ethereum', 'token 1 exists on chain', '/api/evm/asset/1', {
    expect: [200],
    // Coerced with Boolean(): an && chain ending in a truthy string returns that string, and
    // check() requires exactly true, so the address itself would read as a failure message.
    validate: (b) =>
        Boolean(b?.chain === 'ETHEREUM' && b?.assetId?.includes(':') && b?.ownerAddress) ||
        `unexpected: ${JSON.stringify(b).slice(0, 160)}`,
})
await check('Ethereum', 'assetId is contract:tokenId lowercased', '/api/evm/asset/1', {
    expect: [200],
    validate: (b) => {
        const [contract, tokenId] = String(b?.assetId ?? '').split(':')
        if (tokenId !== '1') return `tokenId part is ${tokenId}`
        return contract === contract?.toLowerCase() || 'contract part is not lowercased'
    },
})
await check('Ethereum', 'absurd tokenId 404s', '/api/evm/asset/999999999', { expect: [404] })
await check('Ethereum', 'non-numeric tokenId rejected', '/api/evm/asset/abc', { expect: [400] })
await check('Ethereum', 'marketplace listings read from chain', '/api/evm/listings', {
    expect: [200],
    validate: (b) => {
        if (!Array.isArray(b?.data)) return 'expected data array'
        for (const l of b.data) {
            if (typeof l.price !== 'string' || typeof l.priceWei !== 'string') {
                return 'price/priceWei must be strings'
            }
        }
        return true
    },
})
await check('Ethereum', 'non-numeric listingId rejected', '/api/evm/listings/abc', { expect: [400] })
await check('Ethereum', 'bogus txHash does not verify', '/api/evm/verify/0x' + '0'.repeat(64), {
    expect: [400],
    validate: (b) => b?.verified === false || 'a bogus tx reported verified',
})

console.log('\nEvents and medals')
await check('Events', 'list events', '/api/events', {
    expect: [200],
    validate: (b) => Array.isArray(b?.data) ? true : notDbDrift(b),
})
await check('Events', 'unknown event 404s', '/api/events/no-such-event', { expect: [404] })
await check('Events', 'unknown leaderboard 404s', '/api/events/no-such-event/leaderboard', { expect: [404] })
await check('Events', 'join requires a valid Solana wallet', '/api/events/no-such-event/join', {
    method: 'POST', body: { walletAddress: '0xabc' }, expect: [400],
})
await check('Events', 'join rejects empty body', '/api/events/no-such-event/join', {
    method: 'POST', body: {}, expect: [400],
})

console.log('\nMusic')
await check('Music', 'list albums', '/api/albums', {
    expect: [200],
    validate: (b) => Array.isArray(b?.albums) ? true : notDbDrift(b),
})
await check('Music', 'create album rejects empty body', '/api/albums', {
    method: 'POST', body: {}, expect: [400],
})

console.log('\nStorage')
await check('Storage', 'image upload rejects wrong content-type', '/api/upload/image', {
    method: 'POST', body: { not: 'multipart' }, expect: [400],
})
await check('Storage', 'metadata upload rejects empty body', '/api/upload/metadata', {
    method: 'POST', body: {}, expect: [400],
})

console.log('\nValidation on chain-write routes (no writes performed)')
for (const [name, path] of [
    ['solana mint', '/api/solana/mint'],
    ['solana transfer', '/api/solana/transfer'],
    ['solana list', '/api/solana/list'],
    ['solana buy', '/api/solana/buy'],
    ['solana cancel', '/api/solana/cancel'],
]) {
    await check('Validation', `${name} rejects empty body`, path, {
        method: 'POST', body: {}, expect: [400],
    })
}
// A price finer than 9 decimals must be refused, never silently rounded.
await check('Validation', 'list rejects sub-lamport precision', '/api/solana/list', {
    method: 'POST',
    body: { assetId: SOL_ASSET, seller: SOL_WALLET, price: '0.0000000001' },
    expect: [400],
    validate: (b, s) => s === 400 || 'a price finer than a lamport was accepted',
})
await check('Validation', 'list rejects a zero price', '/api/solana/list', {
    method: 'POST',
    body: { assetId: SOL_ASSET, seller: SOL_WALLET, price: '0' },
    expect: [400],
})
await check('Validation', 'list rejects a non-numeric price', '/api/solana/list', {
    method: 'POST',
    body: { assetId: SOL_ASSET, seller: SOL_WALLET, price: 'free' },
    expect: [400],
})

console.log('\nAdmin auth')
for (const path of [
    '/api/admin/overview', '/api/admin/users', '/api/admin/listings',
    '/api/admin/transactions', '/api/admin/nfts/broken',
]) {
    await check('Auth', `${path} rejects a missing key`, path, { expect: [401, 503] })
}
await check('Auth', 'rejects the retired hardcoded key "anshtyagi"', '/api/admin/overview', {
    headers: { 'X-Admin-API-Key': 'anshtyagi' }, expect: [401, 503],
})
await check('Auth', 'rejects a wrong key', '/api/admin/overview', {
    headers: { 'X-Admin-API-Key': 'definitely-not-the-key' }, expect: [401, 503],
})
// A key in a query param would land in CF logs, browser history and Referer headers.
await check('Auth', 'ignores a key passed as a query param', '/api/admin/overview?apiKey=anshtyagi', {
    expect: [401, 503],
})
await check('Auth', 'mocked point granting is not public', '/api/admin/events/x/points', {
    method: 'POST', body: { walletAddress: SOL_WALLET, points: 999999 }, expect: [401, 503],
})
await check('Auth', 'medal minting is not public', '/api/admin/events/x/medals/mint', {
    method: 'POST', expect: [401, 503],
})

if (ADMIN_KEY) {
    const H = { 'X-Admin-API-Key': ADMIN_KEY }
    console.log('\nAdmin surface (key provided)')
    await check('Admin', 'overview', '/api/admin/overview', {
        headers: H, expect: [200],
        validate: (b) => {
            if (!isObj(b?.totals) || !isObj(b?.chains)) return 'missing totals or chains'
            for (const c of ['SOLANA', 'ETHEREUM']) {
                if (typeof b.chains[c]?.volume !== 'string') return `${c} volume is not a string`
            }
            return true
        },
    })
    await check('Admin', 'users', '/api/admin/users', { headers: H, expect: [200], validate: hasArray('data') })
    await check('Admin', 'listings', '/api/admin/listings', { headers: H, expect: [200], validate: hasArray('data') })
    await check('Admin', 'transactions', '/api/admin/transactions', { headers: H, expect: [200], validate: hasArray('data') })
    await check('Admin', 'broken images', '/api/admin/nfts/broken', { headers: H, expect: [200], validate: hasArray('data') })
    await check('Admin', 'create event rejects a nameless body', '/api/admin/events', {
        method: 'POST', headers: H, body: {}, expect: [400],
    })
    // Gold must not be easier than Silver, or the tiers stop meaning anything.
    await check('Admin', 'create event rejects inverted tier thresholds', '/api/admin/events', {
        method: 'POST', headers: H,
        body: { name: 'tier order check', medals: { gold: { requiredPoints: 1 }, silver: { requiredPoints: 50 }, bronze: { requiredPoints: 10 } } },
        expect: [400],
        validate: (b) => /GOLD >= SILVER >= BRONZE/.test(b?.error ?? '') || `unexpected error: ${b?.error}`,
    })
    await check('Admin', 'audit lookup on unknown id', '/api/admin/audit/does-not-exist', {
        headers: H, expect: [400],
        validate: (b) => b?.valid === false || 'expected valid:false',
    })
}

// ---------------------------------------------------------------- settlement
//
// The step that makes a landed purchase visible. Every one of these must fail closed: an
// unverifiable transaction may never move an owner, close a listing or add to volume.

await check('Settlement', 'settle rejects an empty body', '/api/settle', {
    method: 'POST', body: {}, expect: [400],
})
await check('Settlement', 'settle requires a buyer, not just a hash', '/api/settle', {
    method: 'POST', body: { assetId: SOL_ASSET, txHash: 'x'.repeat(88) }, expect: [400],
    validate: (b) => /buyer/.test(b?.error ?? '') || 'expected the buyer to be required',
})
await check('Settlement', 'settle rejects an unparseable assetId', '/api/settle', {
    method: 'POST', body: { assetId: 'nonsense', txHash: 'x', buyer: SOL_WALLET }, expect: [400],
})
await check('Settlement', 'settle refuses a transaction that never landed', '/api/settle', {
    method: 'POST',
    // Well-formed but fictional: verification has to reject it rather than trust the caller.
    body: { assetId: SOL_ASSET, txHash: '5'.repeat(88), buyer: SOL_WALLET },
    expect: [400],
    validate: (b) => /did not confirm/i.test(b?.error ?? '') || 'expected a confirmation failure',
})
await check('Settlement', 'settle refuses a fictional EVM transaction', '/api/settle', {
    method: 'POST',
    body: { assetId: `0x${'a'.repeat(40)}:1`, txHash: `0x${'1'.repeat(64)}`, buyer: `0x${'b'.repeat(40)}` },
    expect: [400],
})
await check('Settlement', 'listing sync rejects an empty body', '/api/solana/listing/sync', {
    method: 'POST', body: {}, expect: [400],
})
await check('Settlement', 'listing sync refuses an unconfirmed signature', '/api/solana/listing/sync', {
    method: 'POST', body: { assetId: SOL_ASSET, seller: SOL_WALLET, signature: '5'.repeat(88) },
    expect: [400],
})
await check('Settlement', 'evm token index rejects a malformed hash', '/api/evm/index-token', {
    method: 'POST', body: { txHash: '0xdeadbeef' }, expect: [400],
})
await check('Settlement', 'evm token index rejects a non-mint transaction', '/api/evm/index-token', {
    method: 'POST', body: { txHash: `0x${'1'.repeat(64)}` }, expect: [400],
})
await check('Settlement', 'evm listing index rejects a malformed hash', '/api/evm/index-listing', {
    method: 'POST', body: {}, expect: [400],
})

const failed = results.filter((r) => !r.ok)
const groups = [...new Set(results.map((r) => r.group))]

console.log(`\n${'='.repeat(62)}`)
console.log(`${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
for (const g of groups) {
    const rs = results.filter((r) => r.group === g)
    const bad = rs.filter((r) => !r.ok).length
    console.log(`  ${bad ? '\x1b[31m' : '\x1b[32m'}${String(rs.length - bad).padStart(2)}/${rs.length}\x1b[0m  ${g}`)
}
if (failed.length) {
    console.log(`\nFailures:`)
    for (const f of failed) console.log(`  ${f.group} - ${f.name}\n    ${f.path}\n    ${f.why}`)
    if (failed.some((f) => /DATABASE DRIFT/.test(f.why))) {
        console.log(`\nSchema missing from the database DATABASE_URL points at.`)
        console.log(`Apply prisma/migrations/20260812000000_v2_multichain/migration.sql.`)
    }
}
console.log()
process.exit(failed.length)
