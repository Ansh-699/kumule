// Regression check for issue 006 (burn.ts).
//
// Two properties, both about confirmBurn failing closed. confirmBurn takes no owner and does
// not verify the signature belongs to a burn *of this asset* - the only thing standing between
// a caller and "delete any NFT row" is the on-chain check that the asset account is gone. So
// every path that cannot positively confirm the burn must refuse.
//
// 1. A malformed assetId is rejected at 400. It used to reach publicKey() inside the try block
//    and come back as a 500 "Failed to record the burn".
// 2. With an unreachable RPC, confirmBurn never reports success. The existence check used to
//    `.catch(() => null)`, so an RPC error read as "the account is gone" and the row was
//    deleted anyway.
//
// Runs fully offline. The RPC host below is deliberately unroutable.
//
// Run: npx tsx burn-check.ts

import { createServer } from 'node:http'
import { Hono } from 'hono'
import { confirmBurn } from './src/burn'

const BASE58_ILLEGAL = '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl' // 32 chars, none of them base58
const WELL_FORMED_ASSET = '41FsitSTxa14SwaaSxRBTe6dz8vhGKP2FKUBZZQYrp3c'
// 88 base58 chars: passes verifySolanaTransaction's shape test, so it gets as far as the RPC.
const WELL_FORMED_SIG =
    '5'.repeat(88)

const app = new Hono()
app.post('/confirm', confirmBurn as any)

// .invalid is reserved by RFC 2606 and never resolves, so every RPC call from this check fails.
const UNREACHABLE = 'https://rpc.invalid/'

const post = (body: unknown, env: Record<string, string>) =>
    app.request('/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }, env)

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
    console.log('confirmBurn input validation:')

    const noFields = await post({}, { SOLANA_RPC_URL: UNREACHABLE })
    expect('missing assetId/signature rejected with 400', noFields.status, 400)

    // No DATABASE_URL, so a valid assetId would stop at 503 "Database not configured". A 400
    // here therefore proves validation ran *before* that, i.e. the address was actually checked.
    const illegal = await post(
        { assetId: BASE58_ILLEGAL, signature: WELL_FORMED_SIG },
        { SOLANA_RPC_URL: UNREACHABLE },
    )
    expect(
        'base58-illegal assetId rejected with 400, not a 500 about recording the burn',
        illegal.status,
        400,
        await illegal.text(),
    )

    console.log('')
    console.log('confirmBurn fails closed when the chain cannot be reached:')

    const unreachable = await post(
        { assetId: WELL_FORMED_ASSET, signature: WELL_FORMED_SIG },
        { SOLANA_RPC_URL: UNREACHABLE, DATABASE_URL: 'postgresql://u:p@db.invalid:5432/x' },
    )
    const text = await unreachable.text()

    if (unreachable.status >= 200 && unreachable.status < 300) {
        console.log(`  FAIL unreachable RPC returned a success status -> ${unreachable.status}: ${text}`)
        failures++
    } else {
        console.log(`  ok   unreachable RPC refuses -> ${unreachable.status}`)
    }

    if (/"success"\s*:\s*true/.test(text) || /"burned"\s*:/.test(text)) {
        console.log(`  FAIL unreachable RPC reported a burn: ${text}`)
        failures++
    } else {
        console.log('  ok   unreachable RPC reports no burn')
    }

    console.log('')
    console.log('confirmBurn fails closed when the signature confirms but the asset read errors:')

    // The case the unreachable-RPC test above cannot reach: verifySolanaTransaction succeeds,
    // so execution gets as far as the on-chain existence check, and *that* call fails. This is
    // the exact shape of a paid RPC key that 401s on some methods, and it is the only point
    // where confirmBurn decides whether to delete a row. A stub RPC gives us both halves:
    // getTransaction answers "confirmed, no error"; getAccountInfo answers a JSON-RPC error.
    const stub = createServer((req, res) => {
        let raw = ''
        req.on('data', (d: Buffer) => (raw += d))
        req.on('end', () => {
            let method = ''
            try {
                method = JSON.parse(raw).method
            } catch { /* fall through to the error branch below */ }

            res.setHeader('Content-Type', 'application/json')
            if (method === 'getTransaction') {
                res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { meta: { err: null } } }))
                return
            }
            // getAccountInfo and anything else: fail the way a revoked key does.
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                error: { code: -32601, message: 'Unauthorized' },
            }))
        })
    })

    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
    const port = (stub.address() as { port: number }).port

    try {
        const confirmed = await post(
            { assetId: WELL_FORMED_ASSET, signature: WELL_FORMED_SIG },
            {
                SOLANA_RPC_URL: `http://127.0.0.1:${port}`,
                DATABASE_URL: 'postgresql://u:p@db.invalid:5432/x',
            },
        )
        const body = await confirmed.text()

        if (confirmed.status >= 200 && confirmed.status < 300) {
            console.log(`  FAIL asset read errored but confirmBurn succeeded -> ${confirmed.status}: ${body}`)
            failures++
        } else {
            console.log(`  ok   asset read errored, confirmBurn refuses -> ${confirmed.status}`)
        }

        // The precise failure this pins: the old `.catch(() => null)` turned an RPC error into
        // "the account is gone", so the handler walked on into the delete. Reaching the
        // database at all (which then fails, because db.invalid does not resolve) proves the
        // guard let it through.
        if (/Database|prisma|ENOTFOUND|getaddrinfo|Failed to record/i.test(body)) {
            console.log(`  FAIL asset-read error fell through to the delete path: ${body}`)
            failures++
        } else {
            console.log('  ok   asset-read error stops before the delete path')
        }
    } finally {
        await new Promise<void>((resolve) => stub.close(() => resolve()))
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run()
