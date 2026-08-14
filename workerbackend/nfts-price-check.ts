// Regression check for the price-filter trust boundary in listNfts.
//
// `new Prisma.Decimal(v)` throws on anything that is not a decimal literal, and the two lines
// that build the price filter sit OUTSIDE listNfts' try block - so a malformed minPrice or
// maxPrice escaped the handler entirely and surfaced as a 500.
//
// A bare "." is not a hypothetical value: the marketplace's own price inputs sanitize by
// stripping non-digit characters, which permits "." on its own, so the request fired while the
// user was still typing.
//
// Runs fully offline: validation must reject before any database work.
//
// Run: npx tsx nfts-price-check.ts

import { Hono } from 'hono'
import { listNfts } from './src/nfts'

const app = new Hono()
app.get('/nfts', listNfts as any)

// A syntactically valid but unreachable host: if validation ever falls through, the failure is
// a connection error rather than a silent pass.
const env = { DATABASE_URL: 'postgresql://u:p@db.invalid:5432/x' }

const call = (qs: string) => app.request(`/nfts?${qs}`, {}, env)

let failures = 0

const run = async () => {
    console.log('listNfts price-filter validation:')

    const bad: [string, string][] = [
        ['minPrice=.', 'a bare point'],
        ['maxPrice=.', 'a bare point on maxPrice'],
        ['minPrice=abc', 'letters'],
        ['minPrice=-5', 'a negative amount'],
        ['minPrice=1e9', 'exponent notation'],
        ['minPrice=1.2.3', 'two decimal points'],
        ['minPrice=1&maxPrice=.', 'a valid min with a malformed max'],
    ]

    for (const [qs, label] of bad) {
        const res = await call(qs)
        if (res.status === 400) {
            console.log(`  ok   ${label} -> 400`)
        } else {
            console.log(`  FAIL ${label} -> ${res.status} (expected 400): ${(await res.text()).slice(0, 120)}`)
            failures++
        }
    }

    console.log('')
    console.log('well-formed prices are not rejected:')

    // These must clear validation. They then fail on the unreachable database, which is fine -
    // anything other than 400 proves the guard did not eat a legitimate filter.
    //
    // ".5" and "5." are in this list deliberately. Prisma.Decimal accepts both, so both worked
    // before this guard existed; an earlier version of it rejected them, which silently dropped
    // a filter the user had actually set. Found by typing into the real price field in a browser,
    // not by any assertion here - hence the assertion here now.
    for (const qs of [
        'minPrice=0', 'minPrice=1.5', 'maxPrice=0.000000001', 'minPrice=1&maxPrice=2', '',
        'minPrice=.5', 'maxPrice=.5', 'minPrice=5.', 'minPrice=.000000001',
    ]) {
        const res = await call(qs)
        if (res.status === 400) {
            console.log(`  FAIL "${qs}" was wrongly rejected -> 400: ${(await res.text()).slice(0, 120)}`)
            failures++
        } else {
            console.log(`  ok   "${qs}" clears validation -> ${res.status} (not blocked at 400)`)
        }
    }

    console.log('')
    console.log('validation runs before the database check:')

    // With no DATABASE_URL the handler answers 503. If the price guard sat after that check it
    // would be unreachable here - which is exactly how it was first written, and why it could
    // not be verified against a worker that has no database bound.
    const noDb = (qs: string) => app.request(`/nfts?${qs}`, {}, {})

    for (const [qs, label] of [
        ['minPrice=.', 'a bare point'],
        ['maxPrice=abc', 'letters on maxPrice'],
    ] as const) {
        const res = await noDb(qs)
        if (res.status === 400) {
            console.log(`  ok   ${label} -> 400 even with no DATABASE_URL`)
        } else {
            console.log(`  FAIL ${label} -> ${res.status} (expected 400); the guard is behind the 503`)
            failures++
        }
    }

    const wellFormedNoDb = await noDb('minPrice=1.5')
    if (wellFormedNoDb.status === 503) {
        console.log('  ok   a valid price still reaches the 503 when no database is configured')
    } else {
        console.log(`  FAIL valid price with no DATABASE_URL -> ${wellFormedNoDb.status} (expected 503)`)
        failures++
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run()
