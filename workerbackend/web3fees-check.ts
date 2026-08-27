// Asserts for src/fx.ts, src/config.ts and src/web3fees.ts. Run: npx tsx web3fees-check.ts
//
// This is the arithmetic that decides what a buyer is charged for a mint, and the wire
// contract the iOS, Flutter and web clients all read. Both get pinned.
//
// A note on why the conversion is BigInt, since it is worth being accurate rather than
// dramatic about it: at the magnitudes involved here a float implementation produces the
// same answers, and a search over 400,000 random (lamport, rate) pairs found no divergence.
// The integer path earns its place somewhere else - at the PARSE. `res.json()` on a rate
// turns the digits into a double before any arithmetic happens, and that loss is silent and
// unrecoverable. Doing the whole path in integers means nobody has to re-derive which
// magnitudes are safe.
//
// The expected values below were computed with Python's exact rational arithmetic, not with
// the code under test.
//
// Pure: no network, no DB.

import { parseDecimal, ceilDiv, fromBaseUnits } from './src/chains'
import {
    lamportsToEurMinor, formatMinor, parseEurRate, RATE_DECIMALS,
    getSolEurRate, fallbackRate, __setRateMemoForTests, extractRate,
} from './src/fx'
import { taxOn, intEnv, mintPricing } from './src/config'
import {
    serializeQuote, MAX_QUANTITY, COMPUTE_UNITS, PRIORITY_MICRO_LAMPORTS,
    MPL_CORE_ASSET_FIXED_BYTES, MAX_NAME_BYTES, MAX_URI_BYTES, assetBytesFor, utf8Bytes,
} from './src/web3fees'

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}
const eq = (label: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got), w = JSON.stringify(want)
    g === w ? ok(label) : fail(label, `got ${g} want ${w}`)
}
const throws = (label: string, fn: () => unknown) => {
    try { fn(); fail(label, 'expected a throw') } catch { ok(label) }
}

const rate = (decimal: string) => parseDecimal(decimal, RATE_DECIMALS)

const run = async () => {
    console.log('parseDecimal keeps every digit a rate can carry:')
    eq('a whole number', rate('200').toString(), '20000000000')
    eq('two decimals', rate('123.45').toString(), '12345000000')
    eq('all eight decimals survive', rate('123.45678901').toString(), '12345678901')
    eq('a tiny rate', rate('0.00000001').toString(), '1')
    eq('trailing zeros are not significant', rate('1.10').toString(), '110000000')
    // The guard that makes silent precision loss impossible: too many digits is an error, never
    // a quiet round.
    throws('nine decimals is refused, not rounded', () => rate('1.123456789'))
    throws('not a number', () => rate('abc'))
    throws('empty', () => rate(''))

    console.log('')
    console.log('ceilDiv rounds towards the platform, always:')
    eq('exact division is not bumped', ceilDiv(100n, 10n).toString(), '10')
    eq('a remainder rounds up', ceilDiv(101n, 10n).toString(), '11')
    eq('one unit over rounds up', ceilDiv(1n, 1000n).toString(), '1')
    eq('zero stays zero', ceilDiv(0n, 10n).toString(), '0')

    console.log('')
    console.log('lamports to EUR cents (expected values computed with exact rationals):')

    // [lamports, rate, expected cents]
    const conversions: [bigint, string, number][] = [
        [1n, '200', 1],
        [5_000n, '200', 1],
        [10_000n, '200', 1],
        [2_035_360n, '200', 41],
        [2_035_360n, '123.45678901', 26],
        [1_000_000_000n, '200', 20_000],
        [1_000_000_000n, '0.01', 1],
        [2_035_360n, '1', 1],
        [0n, '200', 0],
        [101_768_000n, '200', 2_036],
    ]
    for (const [lamports, r, want] of conversions) {
        eq(`${lamports} lamports at ${r} EUR/SOL`, lamportsToEurMinor(lamports, rate(r)), want)
    }

    // The property that actually matters for the platform's margin: a real cost never becomes a
    // zero charge. One lamport is not free.
    let neverZero = true
    for (const lamports of [1n, 2n, 7n, 4_999n, 999_999n]) {
        if (lamportsToEurMinor(lamports, rate('0.00000001')) < 1) neverZero = false
    }
    if (neverZero) ok('a non-zero cost never rounds down to a zero fee')
    else fail('some non-zero cost rounded to zero', 'the platform would eat it')

    // Monotonic: more lamports can never cost less.
    let monotonic = true
    let previous = -1
    for (const lamports of [0n, 1n, 1_000n, 10_000n, 100_000n, 2_035_360n, 10_000_000n]) {
        const v = lamportsToEurMinor(lamports, rate('200'))
        if (v < previous) monotonic = false
        previous = v
    }
    monotonic ? ok('the fee is monotonic in lamports') : fail('the fee is not monotonic')

    throws('a negative lamport count is refused', () => lamportsToEurMinor(-1n, rate('200')))
    throws('a zero rate is refused', () => lamportsToEurMinor(1n, 0n))
    // A rate this wrong means the oracle returned garbage; charging thousands of euros for gas
    // is worse than failing the quote.
    throws('an implausible result is refused', () => lamportsToEurMinor(10n ** 18n, rate('200')))

    console.log('')
    console.log('quantity scales the fee linearly:')
    const one = lamportsToEurMinor(2_035_360n, rate('200'))
    const fifty = lamportsToEurMinor(2_035_360n * 50n, rate('200'))
    eq('fifty mints cost fifty times one mint (within the ceiling)', fifty, one * 50 - 14)
    eq('MAX_QUANTITY is bounded', MAX_QUANTITY <= 50, true)

    console.log('')
    console.log('reading a rate out of a raw oracle body, as a string:')
    eq('the documented shape', parseEurRate('{"solana":{"eur":123.45}}')?.toString(), '12345000000')
    eq('whitespace', parseEurRate('{ "solana" : { "eur" : 200 } }')?.toString(), '20000000000')
    // More precision than we keep is truncated deterministically, never rounded up into a
    // charge the oracle did not justify.
    eq('excess precision truncates', parseEurRate('{"eur":123.456789019999}')?.toString(), '12345678901')
    eq('a missing figure is null, not zero', parseEurRate('{"solana":{}}'), null)
    eq('an error body is null', parseEurRate('{"status":{"error_code":429}}'), null)
    eq('html is null', parseEurRate('<html>rate limited</html>'), null)
    eq('a zero rate is null, not zero', parseEurRate('{"eur":0}'), null)

    console.log('')
    console.log('the rate falls back through real values before a constant:')

    // The static constant sits far above the market so it can never under-charge, which means it
    // over-charges badly - measured at roughly double at a real rate near EUR 90. So it has to be
    // the LAST resort, not the first thing a cold isolate reaches for. Workers isolates are cold
    // constantly and the free price endpoint answers 429 after about four calls, so this ordering
    // decides what a large share of production traffic is actually billed.
    {
        const HINT_SCALED = rate('89.46')
        const now = Date.now()

        __setRateMemoForTests(null)
        const fresh = await getSolEurRate({ scaled: HINT_SCALED, at: now })
        eq('a recent persisted rate is used as-is', fresh.scaled.toString(), HINT_SCALED.toString())
        eq('and counts as live', fresh.live, true)
        eq('labelled honestly', fresh.source, 'cached')

        // With the oracle unreachable - the only time this ordering matters at all. The first
        // version of this test let the real network answer, and the code correctly returned a
        // live rate: that proves the fetch is attempted and tests nothing about the fallback.
        const realFetch = globalThis.fetch
        globalThis.fetch = (async (input: any, init?: any) => {
            const url = typeof input === 'string' ? input : input?.url ?? String(input)
            if (/coingecko|binance|kraken/.test(url)) throw new Error('simulated outage')
            return realFetch(input, init)
        }) as typeof fetch
        try {
            __setRateMemoForTests(null)
            const stale = await getSolEurRate({ scaled: HINT_SCALED, at: now - 7 * 24 * 3_600_000 })
            // A week-old real rate still beats a constant written months ago, but must say so.
            eq('with the oracle down, a stale persisted rate beats the constant',
                stale.scaled.toString(), HINT_SCALED.toString())
            eq('but is not called live', stale.live, false)
            eq('and is labelled last_known', stale.source, 'last_known')

            // Nothing to borrow at all: only then the constant.
            __setRateMemoForTests(null)
            const nothing = await getSolEurRate(null)
            eq('with nothing to borrow, the constant is used', nothing.source, 'static_fallback')

            // Whatever path produced it, a rate is never zero - that would make every fee free.
            for (const r of [stale, nothing]) {
                if (r.scaled > 0n) ok(`${r.source} is a positive rate`)
                else fail(`${r.source} produced a non-positive rate`)
            }
        } finally {
            globalThis.fetch = realFetch
        }

        const constant = fallbackRate()
        eq('the constant is the last resort only', constant.source, 'static_fallback')
        eq('and never claims to be live', constant.live, false)
        // The whole reason the ordering matters: this is what a customer would be billed if the
        // constant were reached casually.
        const realFee = lamportsToEurMinor(3_663_680n, HINT_SCALED)
        const constantFee = lamportsToEurMinor(3_663_680n, constant.scaled)
        eq('the constant over-charges, which is why it is last', constantFee > realFee * 2 - 1, true)
        __setRateMemoForTests(null)
    }

    console.log('')
    console.log('each price source is parsed from its own real response shape:')

    // Bodies captured from the live endpoints. Each publishes a different shape, and a regex
    // written against the wrong one silently yields null and drops that source - which is how
    // production ended up pricing against the static constant in the first place.
    const bodies: [string, string, string][] = [
        ['binance', '{"symbol":"SOLEUR","price":"89.81000000"}', '8981000000'],
        ['kraken', '{"error":[],"result":{"SOLEUR":{"a":["89.83000","42","42.000"],"b":["89.82000","24","24.000"],"c":["89.80000","16.45327000"]}}}', '8980000000'],
        ['coingecko', '{"solana":{"eur":89.76}}', '8976000000'],
    ]
    for (const [name, body, want] of bodies) {
        eq(`${name} parses to an exact scaled integer`, extractRate(name, body)?.toString(), want)
    }
    // They agree to within a few cents, which is what makes falling through between them safe
    // rather than a silent repricing.
    const spread = bodies.map(([n, b]) => Number(extractRate(n, b)))
    eq('the sources agree within 1%', (Math.max(...spread) - Math.min(...spread)) / Math.min(...spread) < 0.01, true)
    eq('a body from the wrong source yields null, not a wrong number',
        extractRate('binance', '{"solana":{"eur":89.76}}'), null)
    eq('garbage yields null', extractRate('kraken', '<html>rate limited</html>'), null)

    console.log('')
    console.log('money renders without a float:')
    eq('a normal fee', formatMinor(27), '€0.27')
    eq('under ten cents', formatMinor(5), '€0.05')
    eq('zero', formatMinor(0), '€0.00')
    eq('a round euro', formatMinor(100), '€1.00')
    eq('the default mint price', formatMinor(200), '€2.00')
    eq('a large amount', formatMinor(123456), '€1234.56')
    eq('a refund', formatMinor(-227), '-€2.27')

    console.log('')
    console.log('tax is integer-exact and rounds towards the tax authority:')
    eq('no rate configured', taxOn(200, 0), 0)
    eq('20% of 200', taxOn(200, 2000), 40)
    eq('19% of 227', taxOn(227, 1900), 44)
    eq('a part-cent rounds up', taxOn(1, 2000), 1)
    eq('zero base', taxOn(0, 2000), 0)

    console.log('')
    console.log('config refuses values that would become NaN amounts:')
    eq('unset falls back', intEnv(undefined, 200, 'X'), 200)
    eq('empty falls back', intEnv('', 200, 'X'), 200)
    eq('a plain integer', intEnv('350', 200, 'X'), 350)
    eq('zero is a legitimate price', intEnv('0', 200, 'X'), 0)
    throws('a decimal is refused', () => intEnv('2.50', 200, 'MINT_SERVICE_PRICE_MINOR'))
    throws('a negative is refused', () => intEnv('-5', 200, 'X'))
    throws('garbage is refused', () => intEnv('free', 200, 'X'))

    const defaults = mintPricing({} as CloudflareBindings)
    eq('default mint price is €2.00', defaults.baseAmountMinor, 200)
    eq('default tax is zero', defaults.taxRateBps, 0)
    eq('default fee floor', defaults.feeFloorMinor, 15)
    eq('default currency', defaults.currency, 'eur')
    // The number that stops a live customer discovering Stripe's minimum for us.
    eq('the card minimum is guarded', defaults.minChargeMinor, 50)
    eq('a real order clears the card minimum',
        defaults.baseAmountMinor + taxOn(defaults.baseAmountMinor, defaults.taxRateBps) + 41 >= defaults.minChargeMinor,
        true)

    console.log('')
    console.log('the quote we quote is the fee we attach:')
    // withPriorityFees is given these same two numbers by the mint job. Quoting a priority fee
    // and then sending a transaction that offers none would be charging for something we did
    // not buy.
    eq('compute units', COMPUTE_UNITS, 200_000)
    eq('priority price', PRIORITY_MICRO_LAMPORTS, 50_000)
    eq('which is 10000 lamports of priority fee',
        Number(ceilDiv(BigInt(PRIORITY_MICRO_LAMPORTS) * BigInt(COMPUTE_UNITS), 1_000_000n)), 10_000)

    console.log('')
    console.log('asset sizing is solved from real assets, not guessed:')

    // Two assets actually minted on devnet, measured from the chain. Both give the same fixed
    // part, which is what makes this arithmetic rather than estimation.
    eq('the fixed part of an AssetV1', MPL_CORE_ASSET_FIXED_BYTES, 75)
    eq('the 117-byte devnet asset reconstructs', assetBytesFor(10, 32), 117)
    eq('the 303-byte devnet asset reconstructs', assetBytesFor(37, 191), 303)

    // Bytes, not characters. An emoji name is one character and four bytes of rent, and the
    // chain charges for bytes.
    eq('ascii is one byte per character', utf8Bytes('Devnet E2E'), 10)
    eq('an emoji is four bytes, not one', utf8Bytes('\u{1F680}'), 4)
    eq('accented latin is two bytes', utf8Bytes('café'), 5)
    eq('a name of emoji is sized by bytes', assetBytesFor(utf8Bytes('\u{1F680}\u{1F680}\u{1F680}'), 0), 87)

    // The bound createIntent enforces is the bound an unspecified quote must cover, or a caller
    // who sends no sizes can still mint something the quote did not pay for.
    eq('the no-info default covers the largest allowed asset',
        MPL_CORE_ASSET_FIXED_BYTES + MAX_NAME_BYTES + MAX_URI_BYTES >= assetBytesFor(MAX_NAME_BYTES, MAX_URI_BYTES),
        true)

    console.log('')
    console.log('the wire contract has exactly the agreed keys:')

    const wire = serializeQuote('quote-123', {
        assetBytes: 182,
        operation: 'nft_mint',
        chain: 'solana',
        quantity: 1,
        currency: 'eur',
        networkFeeLamports: 2_035_360n,
        rate: { scaled: rate('200'), source: 'coingecko', live: true },
        estimatedFeeMinor: 41,
        source: 'helius_priority_fee_estimate',
        confidence: 'estimated',
        expiresAt: new Date('2026-08-27T18:30:00.000Z'),
    })

    // Every key the consuming backends were told to expect, and no extras that would have to be
    // removed later.
    eq('key set', Object.keys(wire).sort(), [
        'chain', 'charged_to_user', 'confidence', 'currency', 'display_amount',
        'estimated_fee_minor', 'estimated_network_fee', 'expires_at', 'fee_payer',
        'label', 'operation', 'quantity', 'quote_id', 'source',
    ].sort())
    eq('quote_id is present - the field the backend snippet reads', wire.quote_id, 'quote-123')
    eq('operation', wire.operation, 'nft_mint')
    eq('chain is lowercase, as specified', wire.chain, 'solana')
    eq('currency', wire.currency, 'eur')
    eq('fee_payer names the platform', wire.fee_payer, 'kumele_platform_wallet')
    eq('charged_to_user', wire.charged_to_user, true)
    eq('lamports', wire.estimated_network_fee.lamports, 2_035_360)
    eq('sol is the canonical decimal string', wire.estimated_network_fee.sol, '0.00203536')
    eq('the sol string agrees with fromBaseUnits',
        wire.estimated_network_fee.sol, fromBaseUnits(2_035_360n, 'SOLANA'))
    eq('estimated_fee_minor', wire.estimated_fee_minor, 41)
    eq('display_amount', wire.display_amount, '€0.41')
    eq('label', wire.label, 'NFT minting fee')
    eq('expires_at is ISO 8601', wire.expires_at, '2026-08-27T18:30:00.000Z')
    eq('source', wire.source, 'helius_priority_fee_estimate')
    eq('confidence', wire.confidence, 'estimated')

    // The one thing that must never appear in a response body.
    const serialized = JSON.stringify(wire)
    const leaks = ['helius-rpc.com', 'api-key', 'http://', 'https://', 'whsec_', 'sk_']
        .filter((needle) => serialized.includes(needle))
    eq('no URL, RPC endpoint or key leaks into the quote', leaks, [])

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')

}

run()
