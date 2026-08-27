// Asserts for src/stripe.ts. Run: npx tsx stripe-check.ts
//
// Two things here are a trust boundary and one is a wire contract.
//
// The signature check is what stands between "Stripe told us this payment succeeded" and
// "anyone on the internet told us this payment succeeded". Minting is gated on it, so a
// verifier that accepts a forged body hands out NFTs for free.
//
// The fixture below was computed with Node's crypto.createHmac, a completely different
// implementation from the Web Crypto one under test. That is the point: a check that
// verifies a signature it generated itself passes just as happily when both halves are
// wrong together.
//
// Pure: no network, no DB, no Stripe account.

import { formEncode, verifyWebhookSignature, signPayloadForTest } from './src/stripe'

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

// Ground truth from `crypto.createHmac('sha256', secret).update(`${t}.${payload}`)`.
const SECRET = 'whsec_kumule_test_secret_not_real'
const TS = 1_700_000_000
const PAYLOAD = '{"id":"evt_test_1","type":"payment_intent.succeeded","created":1700000000}'
const EXPECTED_HEX = 'e64b1b322c85cd44f4fe5a59230e8d2a5e5ba4ea592f68966f5bb928fe5427b1'
// What the signature would be if the whsec_ prefix were stripped and the rest base64-decoded
// before being used as the key. Stripe does not do that, and getting it wrong costs a day.
const DECODED_VARIANT_HEX = '3070415ba893b381dd189c400293c5b1e5af07954da1639b266be7c1757e3cb7'

// Inside the tolerance window relative to TS.
const AT = TS * 1_000 + 1_000

const run = async () => {
    console.log('form encoding matches what Stripe parses:')

    eq('flat values', formEncode({ amount: 227, currency: 'eur' }), 'amount=227&currency=eur')
    // The metadata block the payment endpoint is required to send. Nested keys become
    // metadata[key]; getting this wrong is invisible until someone reads the dashboard.
    eq(
        'nested metadata',
        formEncode({ metadata: { requires_nft_mint: 'true', nft_chain: 'solana' } }),
        'metadata%5Brequires_nft_mint%5D=true&metadata%5Bnft_chain%5D=solana'
    )
    eq(
        'arrays are indexed',
        formEncode({ payment_method_types: ['card'] }),
        'payment_method_types%5B0%5D=card'
    )
    eq('undefined is omitted, not sent as the string', formEncode({ a: 1, b: undefined }), 'a=1')
    eq('null is omitted', formEncode({ a: 1, b: null }), 'a=1')
    eq('values are escaped', formEncode({ description: 'a b&c=d' }), 'description=a%20b%26c%3Dd')
    // Zero is a real amount and must survive; a falsy check here would drop it.
    eq('zero is not falsy-dropped', formEncode({ tax: 0 }), 'tax=0')

    console.log('')
    console.log('signature verification against an independently computed fixture:')

    const good = await verifyWebhookSignature(PAYLOAD, `t=${TS},v1=${EXPECTED_HEX}`, SECRET, 300, AT)
    if (good.ok) ok('a genuine Stripe signature verifies')
    else fail('a genuine Stripe signature was rejected', good.reason)

    // The key is the literal whsec_ string. If someone "helpfully" decodes it, this fixture
    // is what starts passing instead.
    const decoded = await verifyWebhookSignature(
        PAYLOAD, `t=${TS},v1=${DECODED_VARIANT_HEX}`, SECRET, 300, AT
    )
    if (!decoded.ok) ok('the base64-decoded-key variant does NOT verify')
    else fail('a signature keyed on the decoded secret verified', 'the whsec_ prefix is part of the key')

    console.log('')
    console.log('forgeries and mistakes are refused:')

    const cases: [string, string, string, number][] = [
        // label, payload, header, nowMs
        ['a tampered body', PAYLOAD.replace('succeeded', 'faaaled'), `t=${TS},v1=${EXPECTED_HEX}`, AT],
        ['a body with one byte appended', PAYLOAD + ' ', `t=${TS},v1=${EXPECTED_HEX}`, AT],
        ['a signature for a different timestamp', PAYLOAD, `t=${TS + 1},v1=${EXPECTED_HEX}`, AT + 1000],
        ['a malformed header', PAYLOAD, 'not-a-signature', AT],
        ['a header with no v1', PAYLOAD, `t=${TS}`, AT],
        ['a header with no timestamp', PAYLOAD, `v1=${EXPECTED_HEX}`, AT],
        ['a non-numeric timestamp', PAYLOAD, `t=abc,v1=${EXPECTED_HEX}`, AT],
        ['an empty signature value', PAYLOAD, `t=${TS},v1=`, AT],
    ]
    for (const [label, payload, header, now] of cases) {
        const v = await verifyWebhookSignature(payload, header, SECRET, 300, now)
        if (!v.ok) ok(`${label} is rejected`)
        else fail(`${label} VERIFIED`, 'this is a forgery path')
    }

    const wrongSecret = await verifyWebhookSignature(
        PAYLOAD, `t=${TS},v1=${EXPECTED_HEX}`, 'whsec_a_different_secret', 300, AT
    )
    if (!wrongSecret.ok) ok('a different endpoint secret is rejected')
    else fail('a different endpoint secret verified')

    const noHeader = await verifyWebhookSignature(PAYLOAD, undefined, SECRET, 300, AT)
    if (!noHeader.ok) ok('a missing header is rejected')
    else fail('a missing header verified')

    // No configured secret must never mean "allow everything".
    const noSecret = await verifyWebhookSignature(PAYLOAD, `t=${TS},v1=${EXPECTED_HEX}`, '', 300, AT)
    if (!noSecret.ok) ok('an unconfigured secret fails closed')
    else fail('an unconfigured secret verified', 'this would accept any request')

    console.log('')
    console.log('the replay window:')

    // Old enough that a replayed body cannot be re-submitted forever.
    const stale = await verifyWebhookSignature(
        PAYLOAD, `t=${TS},v1=${EXPECTED_HEX}`, SECRET, 300, AT + 301_000
    )
    if (!stale.ok) ok('a signature older than the tolerance is rejected')
    else fail('a stale signature verified', 'replay protection is not working')

    // Clock skew runs both ways; a webhook from a node a few seconds ahead is not an attack.
    const future = await verifyWebhookSignature(
        PAYLOAD, `t=${TS},v1=${EXPECTED_HEX}`, SECRET, 300, AT - 200_000
    )
    if (future.ok) ok('a signature slightly in the future is accepted')
    else fail('a slightly-future signature was rejected', future.reason)

    const justInside = await verifyWebhookSignature(
        PAYLOAD, `t=${TS},v1=${EXPECTED_HEX}`, SECRET, 300, TS * 1_000 + 299_000
    )
    if (justInside.ok) ok('299s old is still inside the window')
    else fail('299s old was rejected', justInside.reason)

    console.log('')
    console.log('secret rotation:')

    // Stripe sends several v1 values while an endpoint secret is being rolled. Accepting only
    // the first breaks payments for the duration of the rotation.
    const rotating = await verifyWebhookSignature(
        PAYLOAD,
        `t=${TS},v1=${'0'.repeat(64)},v1=${EXPECTED_HEX}`,
        SECRET, 300, AT
    )
    if (rotating.ok) ok('a header carrying several v1 values matches on any of them')
    else fail('a rotating-secret header was rejected', rotating.reason)

    const allWrong = await verifyWebhookSignature(
        PAYLOAD, `t=${TS},v1=${'0'.repeat(64)},v1=${'f'.repeat(64)}`, SECRET, 300, AT
    )
    if (!allWrong.ok) ok('several wrong v1 values are still all wrong')
    else fail('a header of wrong signatures verified')

    // v0 is Stripe's older scheme and is not what this endpoint accepts.
    const v0Only = await verifyWebhookSignature(PAYLOAD, `t=${TS},v0=${EXPECTED_HEX}`, SECRET, 300, AT)
    if (!v0Only.ok) ok('a v0-only header is rejected')
    else fail('a v0-only header verified')

    console.log('')
    console.log('the test signer agrees with the verifier:')

    for (const body of ['{}', PAYLOAD, '{"nested":{"a":[1,2,3]}}', 'not json at all']) {
        const header = await signPayloadForTest(body, SECRET, TS)
        const v = await verifyWebhookSignature(body, header, SECRET, 300, AT)
        if (v.ok) ok(`round-trip: ${body.slice(0, 24)}`)
        else fail(`round-trip failed for ${body.slice(0, 24)}`, v.reason)
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run()
