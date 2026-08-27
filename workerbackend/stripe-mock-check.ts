// The real Stripe client against stripe-mock. Run: npx tsx stripe-mock-check.ts
//
// This code talks to Stripe over hand-written fetch with no SDK, so nothing checks that
// `payment_method_types[0]` or `metadata[nft_chain]` are parameters Stripe actually accepts.
// Three separate bugs of exactly that kind have already been found here by reading docs, and
// reading docs is not a test.
//
// stripe-mock is Stripe's own open-source server, generated from their OpenAPI spec, and it
// validates request bodies against that spec rather than echoing them - a parameter Stripe
// does not define is rejected with "additional properties are not allowed". So a request this
// accepts is a request whose shape Stripe's own schema agrees with.
//
// What this still does NOT prove: real authentication, real idempotency-key semantics, real
// webhook delivery, or anything about live-mode behaviour. Those need a key.
//
// Start it with:
//   podman run -d --name stripe-mock -p 12111:12111 docker.io/stripe/stripe-mock:latest
// Skips loudly (exit 0) when it is not running.

import net from 'node:net'
import { createPaymentIntent, createRefund, formEncode } from './src/stripe'

const MOCK = 'http://127.0.0.1:12111'

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}
const eq = (label: string, actual: unknown, wanted: unknown) =>
    actual === wanted ? ok(`${label} -> ${String(actual)}`) : fail(label, `got ${String(actual)}, wanted ${String(wanted)}`)

const mockReachable = (): Promise<boolean> =>
    new Promise((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port: 12111 })
        const done = (v: boolean) => { socket.destroy(); resolve(v) }
        socket.setTimeout(1500)
        socket.on('connect', () => done(true))
        socket.on('error', () => done(false))
        socket.on('timeout', () => done(false))
    })

/** Send everything bound for Stripe to the mock instead. src/stripe.ts is unchanged. */
const redirectToMock = () => {
    const real = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? String(input)
        if (url.startsWith('https://api.stripe.com')) {
            return real(url.replace('https://api.stripe.com', MOCK), init)
        }
        return real(input, init)
    }) as typeof fetch
    return () => { globalThis.fetch = real }
}

const run = async () => {
    if (!(await mockReachable())) {
        console.log('SKIPPED: stripe-mock is not running on 12111')
        console.log('all passed (skipped)')
        return
    }

    const restore = redirectToMock()
    const env: any = { STRIPE_SECRET_KEY: 'sk_test_mock' }

    try {
        console.log('the mock validates rather than echoes, so a pass means something:')

        // Negative control. Without this, every assertion below could be passing against a
        // server that accepts anything at all.
        const bogus = await fetch(`${MOCK}/v1/payment_intents`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer sk_test_mock',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formEncode({ amount: 277, currency: 'eur', kumule_invented_field: 'x' }),
        })
        eq('an invented parameter is rejected', bogus.status, 400)
        const bogusBody = (await bogus.json()) as any
        eq('with a schema validation error',
            String(bogusBody?.error?.message).includes('additional properties'), true)

        console.log('')
        console.log('the real createPaymentIntent, exactly as checkout sends it:')

        const intent = await createPaymentIntent(env, {
            amountMinor: 277,
            currency: 'eur',
            description: 'Kumule NFT mint: My Artwork',
            idempotencyKey: 'pi:0468104a-1234-4000-8000-abcdefabcdef',
            metadata: {
                requires_nft_mint: 'true',
                nft_minting_fee_minor: '33',
                nft_minting_fee_quote_id: '3f9c1a2b-4d5e-6f70-8a9b-cdef01234567',
                nft_minting_fee_label: 'NFT minting fee',
                nft_chain: 'solana',
                kumule_payment_id: '0468104a-1234-4000-8000-abcdefabcdef',
            },
        })

        if (intent.ok) {
            ok('Stripe\'s schema accepts every parameter this sends')
            eq('an id comes back', String(intent.data.id).startsWith('pi_'), true)
            eq('and a client secret', typeof intent.data.client_secret, 'string')
        } else {
            fail('createPaymentIntent was rejected', `${intent.status}: ${intent.message}`)
        }

        console.log('')
        console.log('the real createRefund, exactly as the refund path sends it:')

        const refund = await createRefund(env, {
            paymentIntentId: 'pi_1234567890',
            paymentRowId: '0468104a-1234-4000-8000-abcdefabcdef',
            reason: 'mint did not complete after 8 attempts',
        })
        if (refund.ok) {
            ok('Stripe\'s schema accepts the refund body')
            eq('a refund id comes back', String(refund.data.id).startsWith('re_'), true)
        } else {
            fail('createRefund was rejected', `${refund.status}: ${refund.message}`)
        }

        console.log('')
        console.log('the shapes that carry the most risk, one at a time:')

        // Each of these is a parameter or nesting this code hand-writes. If Stripe renamed one
        // or never had it, the schema says so here rather than in production.
        const shapes: [string, Record<string, unknown>][] = [
            ['a card-only intent', { amount: 277, currency: 'eur', payment_method_types: ['card'] }],
            ['automatic payment methods', { amount: 277, currency: 'eur', automatic_payment_methods: { enabled: true } }],
            ['nested metadata', { amount: 277, currency: 'eur', metadata: { a: '1', b: '2' } }],
            ['a description', { amount: 277, currency: 'eur', description: 'x' }],
            ['the smallest EUR charge Stripe permits', { amount: 50, currency: 'eur' }],
        ]
        for (const [label, body] of shapes) {
            const res = await fetch(`${MOCK}/v1/payment_intents`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer sk_test_mock',
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formEncode(body),
            })
            if (res.status === 200) ok(`${label} is a valid request`)
            else fail(`${label} was rejected`, `${res.status}: ${(await res.text()).slice(0, 120)}`)
        }

        console.log('')
        console.log('and the header the retry story depends on is accepted:')
        const idem = await fetch(`${MOCK}/v1/refunds`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer sk_test_mock',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Idempotency-Key': 'refund:0468104a-1234-4000-8000-abcdefabcdef',
            },
            body: formEncode({ payment_intent: 'pi_1234567890', metadata: { kumule_payment_id: 'x' } }),
        })
        eq('Idempotency-Key on a refund', idem.status, 200)
    } finally {
        restore()
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run().catch((e) => {
    console.error('stripe-mock-check crashed:', e)
    process.exit(1)
})
