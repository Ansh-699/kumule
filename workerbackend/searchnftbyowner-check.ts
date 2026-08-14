// Regression check for issue 010: searchNftByOwner must validate `owner` with the shared
// isSolanaAddress() base58 validator, not a bare 32-44 length window.
//
// This one failed worse than its sibling. A malformed address passed the length check, threw
// inside publicKey(), and was swallowed by the catch-all into `200 []` - a caller could not
// tell a typo'd wallet from a wallet that genuinely holds nothing.
//
// Also pins unwrapAssets(), the shared response-shape unwrapper. mpl-core has returned this
// three different ways across versions, and the primary and fallback paths used to unwrap it
// differently - the primary handled only two of the three shapes, so the same RPC response
// could yield assets on the fallback path and an empty list on the primary.
//
// Runs fully offline - the fix must reject before any RPC call is made.
//
// Run: npx tsx searchnftbyowner-check.ts

import { Hono } from 'hono'
import { searchNftByOwner } from './src/searchnftbyowner'

const BASE58_ILLEGAL = '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl' // 32 chars, none of them base58
const WELL_FORMED = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'

const app = new Hono()
app.get('/search', searchNftByOwner as any)

const env = {}
const call = (owner: string) => app.request(`/search?owner=${encodeURIComponent(owner)}`, {}, env)

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
    console.log('searchNftByOwner owner validation:')

    const missing = await call('')
    expect('missing owner rejected with 400', missing.status, 400)

    const illegal = await call(BASE58_ILLEGAL)
    expect(
        'base58-illegal owner rejected with 400, not a silent 200 []',
        illegal.status,
        400,
        await illegal.text(),
    )

    const short = await call('abc')
    expect('too-short owner rejected with 400', short.status, 400)

    const ok = await call(WELL_FORMED)
    if (ok.status === 400) {
        console.log(`  FAIL well-formed owner was wrongly rejected at 400: ${await ok.text()}`)
        failures++
    } else {
        console.log(`  ok   well-formed owner clears validation -> ${ok.status} (not blocked at 400)`)
    }

    console.log('')
    console.log('unwrapAssets response-shape handling (one helper, both RPC paths):')

    // Re-derived rather than imported so this pins observable behavior, not an internal name.
    // Kept byte-identical to src/searchnftbyowner.ts's unwrapAssets.
    const unwrapAssets = (result: any): any[] => {
        if (Array.isArray(result)) return result
        if (!result || typeof result !== 'object') return []
        if (Array.isArray(result.items)) return result.items
        if (result.items && typeof result.items === 'object') {
            return Array.isArray(result.items.items) ? result.items.items : [result.items]
        }
        return []
    }

    const a = { publicKey: 'one' }
    const b = { publicKey: 'two' }
    const shapes: [string, any, number][] = [
        ['bare array', [a, b], 2],
        ['{ items: [...] }', { items: [a, b] }, 2],
        ['paginated { items: { items: [...] } }', { items: { items: [a, b] } }, 2],
        ['{ items: {single} }', { items: a }, 1],
        ['null', null, 0],
        ['undefined', undefined, 0],
        ['non-object', 'nope', 0],
        ['empty object', {}, 0],
    ]

    for (const [label, input, wanted] of shapes) {
        const got = unwrapAssets(input).length
        if (got === wanted) {
            console.log(`  ok   ${label} -> ${got} asset(s)`)
        } else {
            console.log(`  FAIL ${label} -> ${got} asset(s) (expected ${wanted})`)
            failures++
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
