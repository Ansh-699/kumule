// The Stripe rail against a real Postgres. Run: npx tsx payment-flows-check.ts
//
// Skips loudly (exit 0) without a database, the same way db-flows-check.ts does:
//   podman run -d --name kumule-pg -e POSTGRES_PASSWORD=kumule -e POSTGRES_USER=kumule \
//     -e POSTGRES_DB=kumule -p 55432:5432 docker.io/library/postgres:16-alpine
//   DATABASE_URL=postgresql://kumule:kumule@localhost:55432/kumule npx prisma migrate deploy
//
// What this exists to prove, in one sentence: a buyer cannot be charged and left without an
// NFT, and cannot be charged once and given two.
//
// Everything runs through the real handlers, the real Prisma adapter and the real signature
// verifier. Two things are stubbed, both at the network edge rather than in src/:
//   - Solana RPC, by a local http server
//   - api.stripe.com, by wrapping globalThis.fetch
// Wrapping fetch rather than adding a STRIPE_API_BASE setting keeps the production code free
// of a knob that exists only for tests.

import net from 'node:net'
import { createServer, type Server } from 'node:http'
import { Hono } from 'hono'
import { PublicKey } from '@solana/web3.js'
import { startLocalNeonProxy, resetDatabase, inspect, POSTGRES_URL } from './db-harness'
import { getFeeQuote, CORE_CREATE_FEE_LAMPORTS } from './src/web3fees'
import { createIntent, getPayment, stripeWebhook, paymentIntentIdFrom } from './src/payments'
import { signPayloadForTest } from './src/stripe'
import { withPrisma } from './src/db'
import { runMintJob, sweepMintJobs } from './src/mintjob'
import { MAX_MINT_ATTEMPTS } from './src/config'

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}
const eq = (label: string, actual: unknown, wanted: unknown) =>
    actual === wanted ? ok(`${label} -> ${String(actual)}`) : fail(label, `got ${String(actual)}, wanted ${String(wanted)}`)

const OWNER = new PublicKey(Buffer.alloc(32, 21)).toBase58()
const WEBHOOK_SECRET = 'whsec_kumule_flow_test'

const postgresReachable = (): Promise<boolean> =>
    new Promise((resolve) => {
        const url = new URL(POSTGRES_URL)
        const socket = net.connect({ host: url.hostname, port: Number(url.port || 5432) })
        const done = (v: boolean) => { socket.destroy(); resolve(v) }
        socket.setTimeout(1500)
        socket.on('connect', () => done(true))
        socket.on('error', () => done(false))
        socket.on('timeout', () => done(false))
    })

/** Minimal Solana RPC: enough for a fee quote and a vault balance check. */
const startStubRpc = async () => {
    const server: Server = createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
            const answer = (one: any) => {
                const id = one?.id ?? 1
                switch (one?.method) {
                    case 'getMinimumBalanceForRentExemption':
                        return { jsonrpc: '2.0', id, result: 2_035_360 }
                    case 'getBalance':
                        // A well-funded vault, so the pre-flight passes.
                        return { jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: 5_000_000_000 } }
                    case 'getAccountInfo':
                        return { jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: null } }
                    default:
                        return { jsonrpc: '2.0', id, error: { code: -32601, message: one?.method } }
                }
            }
            const call = JSON.parse(raw || '{}')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(Array.isArray(call) ? call.map(answer) : answer(call)))
        })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    return {
        url: `http://127.0.0.1:${(server.address() as any).port}`,
        stop: () => new Promise<void>((r) => server.close(() => r())),
    }
}

/** Intercept api.stripe.com; everything else goes to the real fetch. */
const stubStripe = () => {
    const real = globalThis.fetch
    const created: { amount: number; idempotencyKey: string | null; metadata: Record<string, string> }[] = []
    const refunds: { paymentIntent: string; idempotencyKey: string | null }[] = []
    let nextId = 0
    let failNext = false

    globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? String(input)
        if (!url.startsWith('https://api.stripe.com')) return real(input, init)

        if (failNext) {
            failNext = false
            return new Response(JSON.stringify({ error: { message: 'card_declined' } }), {
                status: 402, headers: { 'Content-Type': 'application/json' },
            })
        }

        const body = new URLSearchParams(String(init?.body ?? ''))

        if (url.includes('/refunds')) {
            refunds.push({
                paymentIntent: body.get('payment_intent') ?? '',
                idempotencyKey: (init?.headers?.['Idempotency-Key'] as string) ?? null,
            })
            return new Response(
                JSON.stringify({ id: `re_stub_${refunds.length}`, status: 'succeeded', amount: 249 }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        }

        const metadata: Record<string, string> = {}
        for (const [k, v] of body.entries()) {
            const m = /^metadata\[(.+)\]$/.exec(k)
            if (m) metadata[m[1]] = v
        }
        const id = `pi_stub_${++nextId}`
        created.push({
            amount: Number(body.get('amount')),
            idempotencyKey: (init?.headers?.['Idempotency-Key'] as string) ?? null,
            metadata,
        })
        return new Response(
            JSON.stringify({ id, status: 'requires_payment_method', client_secret: `${id}_secret_x`, amount: Number(body.get('amount')), currency: 'eur' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    }) as typeof fetch

    return { created, refunds, restore: () => { globalThis.fetch = real }, declineNext: () => { failNext = true } }
}

const run = async () => {
    if (!(await postgresReachable())) {
        console.log(`SKIPPED: no Postgres on ${POSTGRES_URL.replace(/:\/\/.*@/, '://<redacted>@')}`)
        console.log('all passed (skipped)')
        return
    }

    const stopProxy = await startLocalNeonProxy(5489)
    const rpc = await startStubRpc()
    const stripe = stubStripe()

    const env: any = {
        DATABASE_URL: POSTGRES_URL,
        SOLANA_RPC_URL: rpc.url,
        STRIPE_SECRET_KEY: 'sk_test_stub',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        MINT_ASSET_SEED: 'flow-test-seed',
        // A throwaway keypair generated for this check and nothing else. It signs nothing
        // real: the RPC above is a stub, and no transaction leaves this process.
        MINT_VAULT_PRIVATE_KEY: '2xE8uChjxyEDKERG47fPQCyZD4fS58xnhiXAh23Cv5rLarMDXfmvuuyxmPKEQRWJnVmiQH8fuRxUqzQ6xjuGcSaK',
    }

    const app = new Hono()
    app.get('/quote', getFeeQuote as any)
    app.post('/intent', createIntent as any)
    app.get('/payment/:paymentId', getPayment as any)
    app.post('/webhook', stripeWebhook as any)

    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        app.request(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        }, env)

    const webhook = async (payload: object, e = env, sign = true) => {
        const raw = JSON.stringify(payload)
        const ts = Math.floor(Date.now() / 1000)
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        headers['Stripe-Signature'] = sign
            ? await signPayloadForTest(raw, WEBHOOK_SECRET, ts)
            : `t=${ts},v1=${'0'.repeat(64)}`
        return app.request('/webhook', { method: 'POST', headers, body: raw }, e)
    }

    try {
        await resetDatabase()

        // ------------------------------------------------------------------ quote
        console.log('a quote is priced server-side and persisted:')

        const quoteRes = await app.request('/quote?operation=nft_mint&chain=solana&quantity=1', {}, env)
        eq('GET the quote', quoteRes.status, 200)
        const quote = (await quoteRes.json()) as any

        eq('it carries a quote_id', typeof quote.quote_id, 'string')
        eq('operation', quote.operation, 'nft_mint')
        eq('fee_payer is the platform', quote.fee_payer, 'kumele_platform_wallet')
        eq('charged_to_user', quote.charged_to_user, true)
        // Composition, not a magic number. The stub returns 2,035,360 for rent; on top of that
        // sit Metaplex's 1,500,000 protocol fee for creating a Core asset and 20,000 of
        // signature and priority fees.
        //
        // Both of the big terms are invisible if you reason from the transaction fee alone,
        // and the protocol fee is invisible even if you reason from rent - it is deposited
        // into the asset account and no rent calculation knows about it. A real devnet mint
        // measured 3,225,200; quoting only the transaction fee would have charged 20,000.
        const fee = quote.estimated_network_fee.lamports
        eq('the fee covers rent, the protocol fee and the transaction fees',
            fee, 2_035_360 + Number(CORE_CREATE_FEE_LAMPORTS) + 20_000)
        eq('which is dominated by rent and the protocol fee, not the transaction fee',
            fee - 20_000 > fee * 0.9, true)

        const storedQuote: any = await inspect((p: any) => p.feeQuote.findUnique({ where: { id: quote.quote_id } }))
        if (storedQuote) ok('the quote is persisted for later reconciliation')
        else fail('no FeeQuote row was written')
        eq('with the exchange rate it used', typeof storedQuote?.rateScaled, 'bigint')

        // ------------------------------------------------------------------ intent
        console.log('')
        console.log('the payment endpoint derives every amount itself:')

        const intentRes = await post('/intent', {
            quoteId: quote.quote_id,
            ownerAddress: OWNER,
            name: 'Flow Test',
            metadataUri: 'https://example.invalid/meta.json',
            // Everything below is a lie a client might tell. None of it may reach the charge.
            baseAmountMinor: 1,
            totalAmountMinor: 1,
            amount: 1,
            mintFeeMinor: 0,
            currency: 'usd',
        })
        eq('POST the intent', intentRes.status, 200)
        const intent = (await intentRes.json()) as any

        eq('a client secret comes back', typeof intent.clientSecret, 'string')
        eq('the base price is the configured one, not the body\'s', intent.breakdown.base_amount_minor, 200)
        eq('the fee is the quote\'s, not the body\'s', intent.breakdown.nft_minting_fee_minor, quote.estimated_fee_minor)
        eq('the total is the server\'s sum',
            intent.breakdown.total_amount_minor,
            intent.breakdown.base_amount_minor + intent.breakdown.tax_amount_minor + intent.breakdown.nft_minting_fee_minor)
        eq('the currency is EUR regardless of what was asked for', intent.currency, 'eur')

        const charged = stripe.created[stripe.created.length - 1]
        eq('Stripe was asked for the server total', charged.amount, intent.breakdown.total_amount_minor)
        eq('with a derived idempotency key, never random', charged.idempotencyKey, `pi:${intent.paymentId}`)

        console.log('')
        console.log('and the metadata block the integration contract specifies:')
        eq('requires_nft_mint', charged.metadata.requires_nft_mint, 'true')
        eq('nft_minting_fee_minor', charged.metadata.nft_minting_fee_minor, String(quote.estimated_fee_minor))
        eq('nft_minting_fee_quote_id', charged.metadata.nft_minting_fee_quote_id, quote.quote_id)
        eq('nft_minting_fee_label', charged.metadata.nft_minting_fee_label, 'NFT minting fee')
        eq('nft_chain', charged.metadata.nft_chain, 'solana')

        const job: any = await inspect((p: any) => p.mintJob.findFirst({ where: { payment: { id: intent.paymentId } } }))
        eq('a mint job exists, waiting for the money', job?.status, 'AWAITING_PAYMENT')
        eq('holding the destination wallet', job?.ownerAddress, OWNER)
        eq('and what to mint', job?.metadataUri, 'https://example.invalid/meta.json')
        eq('nothing has been minted yet', job?.mintAddress, null)

        // ------------------------------------------------------------------ validation
        console.log('')
        console.log('a checkout that cannot be delivered is refused before the card is charged:')

        const badAddress = await post('/intent', {
            quoteId: quote.quote_id, ownerAddress: 'not-a-solana-key',
            name: 'x', metadataUri: 'https://example.invalid/m.json',
        })
        eq('an invalid destination wallet', badAddress.status, 400)

        // 43 characters of base58 that decode to 43 bytes, not 32. Right shape, wrong key -
        // it would pass a length check and fail at mint time, after the money was taken.
        const wrongLength = await post('/intent', {
            quoteId: quote.quote_id, ownerAddress: '1'.repeat(43),
            name: 'x', metadataUri: 'https://example.invalid/m.json',
        })
        eq('a base58 string that is not 32 bytes', wrongLength.status, 400)

        eq('an unknown quote', (await post('/intent', {
            quoteId: 'no-such-quote', ownerAddress: OWNER, name: 'x', metadataUri: 'https://example.invalid/m.json',
        })).status, 404)

        eq('a non-http metadata URI', (await post('/intent', {
            quoteId: quote.quote_id, ownerAddress: OWNER, name: 'x', metadataUri: 'javascript:alert(1)',
        })).status, 400)

        eq('a missing name', (await post('/intent', {
            quoteId: quote.quote_id, ownerAddress: OWNER, metadataUri: 'https://example.invalid/m.json',
        })).status, 400)

        // An expired quote must not be honoured: SOL may have moved since.
        const staleQuote: any = await withPrisma(POSTGRES_URL, (p: any) =>
            p.feeQuote.create({
                data: {
                    operation: 'nft_mint', chain: 'SOLANA', quantity: 1, currency: 'eur',
                    networkFeeLamports: 2_055_360n, rateScaled: 20_000_000_000n,
                    estimatedFeeMinor: 41, source: 'static_fallback', confidence: 'estimated',
                    expiresAt: new Date(Date.now() - 60_000),
                },
            })
        )
        eq('an expired quote', (await post('/intent', {
            quoteId: staleQuote.id, ownerAddress: OWNER, name: 'x', metadataUri: 'https://example.invalid/m.json',
        })).status, 409)

        // Stripe rejects EUR under 50 minor units. Caught here, not by a declined card.
        const freeQuote: any = await withPrisma(POSTGRES_URL, (p: any) =>
            p.feeQuote.create({
                data: {
                    operation: 'nft_mint', chain: 'SOLANA', quantity: 1, currency: 'eur',
                    networkFeeLamports: 1_000n, rateScaled: 20_000_000_000n,
                    estimatedFeeMinor: 1, source: 'static_fallback', confidence: 'estimated',
                    expiresAt: new Date(Date.now() + 600_000),
                },
            })
        )
        const tiny = await app.request('/intent', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteId: freeQuote.id, ownerAddress: OWNER, name: 'x', metadataUri: 'https://example.invalid/m.json' }),
        }, { ...env, MINT_SERVICE_PRICE_MINOR: '0' })
        eq('a total under the card minimum', tiny.status, 400)
        const tinyBody = (await tiny.json()) as any
        eq('and says why', tinyBody.code, 'amount_too_small')

        // ------------------------------------------------------------------ webhook
        console.log('')
        console.log('a quote cannot be spent on an asset bigger than it paid rent for:')

        // A quote buys rent for an account of a known size. Minting something larger than
        // that is the platform absorbing the difference on every such mint - so it is
        // refused, not absorbed. Sized quotes make this reachable: ask for a tiny asset,
        // then try to mint a large one against it.
        const tinyQuoteRes = await app.request(
            '/quote?operation=nft_mint&chain=solana&quantity=1&nameBytes=5&uriBytes=20', {}, env
        )
        const tinyQuote = (await tinyQuoteRes.json()) as any
        eq('a sized quote is priced for that size', tinyQuoteRes.status, 200)

        const tooBig = await post('/intent', {
            quoteId: tinyQuote.quote_id,
            ownerAddress: OWNER,
            name: 'A name far longer than the five bytes that quote paid for',
            metadataUri: 'https://example.invalid/a-considerably-longer-metadata-path/meta.json',
        })
        eq('minting a larger asset against it is refused', tooBig.status, 409)
        eq('and says why', ((await tooBig.json()) as any).code, 'quote_too_small')

        // Bytes, not characters: an emoji name that "fits" by length must not slip through.
        const emojiRes = await post('/intent', {
            quoteId: tinyQuote.quote_id, ownerAddress: OWNER,
            name: '\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}',
            metadataUri: 'https://example.invalid/m.json',
        })
        eq('a six-character emoji name is measured as 24 bytes', emojiRes.status, 409)

        // Over the hard cap, regardless of any quote.
        const hugeName = await post('/intent', {
            quoteId: quote.quote_id, ownerAddress: OWNER,
            name: 'x'.repeat(200), metadataUri: 'https://example.invalid/m.json',
        })
        eq('a name over the byte cap is refused outright', hugeName.status, 400)

        console.log('')
        console.log('minting begins only on a genuine payment_intent.succeeded:')

        const paid: any = await inspect((p: any) => p.payment.findUnique({ where: { id: intent.paymentId } }))
        const intentId = paid.stripePaymentIntentId

        const forged = await webhook({
            type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
            data: { object: { id: intentId } },
        }, env, false)
        eq('a forged signature', forged.status, 400)
        const afterForged: any = await inspect((p: any) => p.mintJob.findUnique({ where: { id: job.id } }))
        eq('and nothing moved', afterForged.status, 'AWAITING_PAYMENT')

        const good = await webhook({
            type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
            data: { object: { id: intentId } },
        })
        eq('a signed succeeded event', good.status, 200)

        const afterPaid: any = await inspect(async (p: any) => ({
            job: await p.mintJob.findUnique({ where: { id: job.id } }),
            payment: await p.payment.findUnique({ where: { id: intent.paymentId } }),
        }))
        eq('the job is now queued to mint', afterPaid.job.status, 'PENDING')
        eq('the payment is marked paid', afterPaid.payment.status, 'PAID')
        if (afterPaid.payment.paidAt) ok('with a settlement timestamp')
        else fail('paidAt was not set')

        // ------------------------------------------------------------------ idempotency
        console.log('')
        console.log('THE guarantee: one payment cannot become two mints:')

        // Stripe redelivers routinely and guarantees neither ordering nor exactly-once.
        for (let i = 0; i < 5; i++) {
            const replay = await webhook({
                type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
                data: { object: { id: intentId } },
            })
            if (replay.status !== 200) fail(`replay ${i + 1} answered ${replay.status}`, 'a duplicate must be acknowledged')
        }
        ok('five duplicate deliveries are all acknowledged')

        const jobCount: any = await inspect((p: any) => p.mintJob.count({ where: { paymentId: intent.paymentId } }))
        eq('there is still exactly one mint job', jobCount, 1)

        const paymentCount: any = await inspect((p: any) => p.payment.count({ where: { stripePaymentIntentId: intentId } }))
        eq('and exactly one payment', paymentCount, 1)

        // The database itself refuses a second job for the same payment, so a future code path
        // that forgets to check cannot create one either.
        let blockedByDb = false
        try {
            await withPrisma(POSTGRES_URL, (p: any) =>
                p.mintJob.create({
                    data: {
                        paymentId: intent.paymentId, status: 'PENDING', chain: 'SOLANA',
                        ownerAddress: OWNER, name: 'Second', metadataUri: 'https://example.invalid/2.json',
                        estimatedFeeMinor: 41,
                    },
                })
            )
        } catch {
            blockedByDb = true
        }
        eq('a second job for the same payment is refused by the database', blockedByDb, true)

        console.log('')
        console.log('an event for a payment we have no record of asks Stripe to retry:')

        // Ambiguous between "this raced the row being written" and "the row write failed after
        // the charge". Answering 200 would strand a real payment forever, so it must be 500.
        const orphan = await webhook({
            type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
            data: { object: { id: 'pi_never_seen' } },
        })
        eq('a fresh unknown intent', orphan.status, 500)

        // ...but not forever. An hour is far longer than any write race.
        const ancient = await webhook({
            type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000) - 7_200,
            data: { object: { id: 'pi_never_seen_old' } },
        })
        eq('an unknown intent from two hours ago is given up on', ancient.status, 200)

        console.log('')
        console.log('a refund stops the mint:')

        const refundQuote = await app.request('/quote?operation=nft_mint&chain=solana', {}, env)
        const rq = (await refundQuote.json()) as any
        const rIntent = await post('/intent', {
            quoteId: rq.quote_id, ownerAddress: OWNER, name: 'Refunded', metadataUri: 'https://example.invalid/r.json',
        })
        const rBody = (await rIntent.json()) as any
        const rPayment: any = await inspect((p: any) => p.payment.findUnique({ where: { id: rBody.paymentId } }))

        // Case one: refunded before the mint starts. It simply never runs.
        // The shape Stripe actually sends: data.object is a CHARGE, whose own id is ch_... and
        // which names the intent in a separate field. An earlier version of this check made up
        // a payload with the intent at .id - a shape Stripe never sends - and passed while the
        // refund handler was unreachable in production.
        await webhook({
            type: 'charge.refunded', created: Math.floor(Date.now() / 1000),
            data: { object: { id: 'ch_stub_refund_1', payment_intent: rPayment.stripePaymentIntentId, refunded: true } },
        })
        const refunded: any = await inspect(async (p: any) => ({
            payment: await p.payment.findUnique({ where: { id: rBody.paymentId } }),
            job: await p.mintJob.findFirst({ where: { paymentId: rBody.paymentId } }),
        }))
        eq('the payment reads refunded', refunded.payment.status, 'REFUNDED')
        eq('and the mint will not run', refunded.job.status, 'REFUNDED')

        // Case two: refunded after the mint is already in flight. An asset on chain does not
        // come back, so the honest outcome is a flagged record, not a status that pretends
        // nothing was delivered.
        const lq = (await (await app.request('/quote?operation=nft_mint&chain=solana', {}, env)).json()) as any
        const lBody = (await (await post('/intent', {
            quoteId: lq.quote_id, ownerAddress: OWNER, name: 'Late Refund', metadataUri: 'https://example.invalid/l.json',
        })).json()) as any
        const lPayment: any = await inspect((p: any) => p.payment.findUnique({ where: { id: lBody.paymentId } }))
        await withPrisma(POSTGRES_URL, (p: any) =>
            p.mintJob.updateMany({ where: { paymentId: lBody.paymentId }, data: { status: 'MINTING' } })
        )
        await webhook({
            type: 'charge.refunded', created: Math.floor(Date.now() / 1000),
            data: { object: { id: 'ch_stub_refund_2', payment_intent: lPayment.stripePaymentIntentId, refunded: true } },
        })
        const late: any = await inspect(async (p: any) => ({
            payment: await p.payment.findUnique({ where: { id: lBody.paymentId } }),
            job: await p.mintJob.findFirst({ where: { paymentId: lBody.paymentId } }),
        }))
        eq('the payment is still marked refunded', late.payment.status, 'REFUNDED')
        eq('the in-flight mint is not falsely cancelled', late.job.status, 'MINTING')
        eq('but the discrepancy is recorded for a human',
            String(late.job.lastError).includes('after minting began'), true)

        console.log('')
        console.log('a failed card leaves nothing queued:')

        const fq = (await (await app.request('/quote?operation=nft_mint&chain=solana', {}, env)).json()) as any
        const fIntent = (await (await post('/intent', {
            quoteId: fq.quote_id, ownerAddress: OWNER, name: 'Declined', metadataUri: 'https://example.invalid/d.json',
        })).json()) as any
        const fPayment: any = await inspect((p: any) => p.payment.findUnique({ where: { id: fIntent.paymentId } }))
        await webhook({
            type: 'payment_intent.payment_failed', created: Math.floor(Date.now() / 1000),
            data: { object: { id: fPayment.stripePaymentIntentId, last_payment_error: { message: 'card declined' } } },
        })
        const declined: any = await inspect(async (p: any) => ({
            payment: await p.payment.findUnique({ where: { id: fIntent.paymentId } }),
            job: await p.mintJob.findFirst({ where: { paymentId: fIntent.paymentId } }),
        }))
        eq('the payment is failed', declined.payment.status, 'FAILED')
        eq('the job is failed, not pending', declined.job.status, 'FAILED')

        console.log('')
        console.log('a mint that can never succeed gives the money back:')

        // The path that exists so nobody is charged for something undeliverable - and until
        // now the only one never actually executed. A job past its attempt cap must refund
        // rather than retry forever, because retrying forever is indistinguishable from
        // keeping the money.
        const dq = (await (await app.request('/quote?operation=nft_mint&chain=solana', {}, env)).json()) as any
        const doomed = (await (await post('/intent', {
            quoteId: dq.quote_id, ownerAddress: OWNER, name: 'Doomed',
            metadataUri: 'https://example.invalid/doomed.json',
        })).json()) as any
        const doomedPayment: any = await inspect((p: any) => p.payment.findUnique({ where: { id: doomed.paymentId } }))

        // Deliberately NOT driven through the webhook here. A succeeded webhook kicks off a
        // detached mint, which then races this call for the claim - and wins about half the
        // time, so the assertion below would report whichever caller lost rather than what
        // the code did. That race is correct behaviour (only one worker ever proceeds, which
        // the devnet concurrency test proves) but it makes for a useless test.
        //
        // Already past the attempt cap, which is the shape of a vault that cannot pay: the
        // mint has been tried and cannot work.
        await withPrisma(POSTGRES_URL, (p: any) =>
            p.payment.update({ where: { id: doomed.paymentId }, data: { status: 'PAID', paidAt: new Date() } })
        )
        await withPrisma(POSTGRES_URL, (p: any) =>
            p.mintJob.updateMany({
                where: { paymentId: doomed.paymentId },
                data: { status: 'PENDING', attempts: MAX_MINT_ATTEMPTS + 1, lastError: 'vault unfunded' },
            })
        )
        const doomedJob: any = await inspect((p: any) => p.mintJob.findFirst({ where: { paymentId: doomed.paymentId } }))

        const refundsBefore = stripe.refunds.length
        const outcome = await runMintJob(env, POSTGRES_URL, doomedJob.id)
        eq('the job refunds instead of retrying', outcome, 'refunded')
        eq('exactly one refund was issued', stripe.refunds.length - refundsBefore, 1)

        const issued = stripe.refunds[stripe.refunds.length - 1]
        eq('against the right payment intent', issued.paymentIntent, doomedPayment.stripePaymentIntentId)
        // Derived, so a sweep racing an admin refunds once rather than twice.
        eq('with a derived idempotency key', issued.idempotencyKey, `refund:${doomed.paymentId}`)

        const settled: any = await inspect(async (p: any) => ({
            payment: await p.payment.findUnique({ where: { id: doomed.paymentId } }),
            job: await p.mintJob.findUnique({ where: { id: doomedJob.id } }),
            nfts: await p.nft.count({ where: { name: 'Doomed' } }),
        }))
        eq('the payment reads refunded', settled.payment.status, 'REFUNDED')
        eq('the job reads refunded', settled.job.status, 'REFUNDED')
        eq('the refund id is recorded', typeof settled.payment.stripeRefundId, 'string')
        eq('the reason is kept for support', String(settled.payment.failureReason).length > 0, true)
        eq('and nothing was minted', settled.nfts, 0)

        // A sweep must not pick a refunded job back up. Scoped to THIS job: the table still
        // holds pending jobs from earlier sections, and asserting the sweep did nothing at
        // all would be asserting something about them instead.
        await sweepMintJobs(env, POSTGRES_URL)
        const afterSweep: any = await inspect((p: any) => p.mintJob.findUnique({ where: { id: doomedJob.id } }))
        eq('the refunded job is untouched by a sweep', afterSweep.status, 'REFUNDED')
        eq('its attempt count did not move', afterSweep.attempts, settled.job.attempts)
        eq('and no second refund is issued', stripe.refunds.length - refundsBefore, 1)

        console.log('')
        console.log('the payment intent is found wherever the event actually puts it:')

        // Real Stripe payload shapes. payment_intent.* events carry the intent itself;
        // charge.* events carry a Charge that merely references it.
        eq('payment_intent.succeeded -> data.object.id',
            paymentIntentIdFrom({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_a' } } }), 'pi_a')
        eq('payment_intent.payment_failed -> data.object.id',
            paymentIntentIdFrom({ type: 'payment_intent.payment_failed', data: { object: { id: 'pi_b' } } }), 'pi_b')
        eq('charge.refunded -> data.object.payment_intent, NOT .id',
            paymentIntentIdFrom({ type: 'charge.refunded', data: { object: { id: 'ch_x', payment_intent: 'pi_c' } } }), 'pi_c')
        eq('charge.succeeded -> the same field',
            paymentIntentIdFrom({ type: 'charge.succeeded', data: { object: { id: 'ch_y', payment_intent: 'pi_d' } } }), 'pi_d')
        // Expandable field: a string normally, an object when expand was requested.
        eq('an expanded payment_intent object',
            paymentIntentIdFrom({ type: 'charge.refunded', data: { object: { id: 'ch_z', payment_intent: { id: 'pi_e' } } } }), 'pi_e')
        // A charge that never went through a PaymentIntent is not ours.
        eq('a charge with no intent is ignored',
            paymentIntentIdFrom({ type: 'charge.refunded', data: { object: { id: 'ch_legacy', payment_intent: null } } }), null)
        eq('a charge id is never mistaken for an intent',
            paymentIntentIdFrom({ type: 'charge.refunded', data: { object: { id: 'ch_only' } } }), null)
        eq('an unrelated event is ignored',
            paymentIntentIdFrom({ type: 'customer.created', data: { object: { id: 'cus_1' } } }), null)
        eq('a malformed event does not throw', paymentIntentIdFrom({}), null)

        console.log('')
        console.log('the status endpoint leaks nothing the buyer should not hold:')

        const statusRes = await app.request(`/payment/${intent.paymentId}`, {}, env)
        eq('GET the payment', statusRes.status, 200)
        const status = (await statusRes.json()) as any
        eq('it reports the mint state', status.mint.status, 'PENDING')
        // A derived-but-unminted address is one an attacker could dust to brick the mint.
        eq('no mint address before the asset exists', status.mint.assetId, null)
        const serialized = JSON.stringify(status)
        eq('no client secret', serialized.includes('_secret'), false)
        eq('no Stripe intent id', serialized.includes('pi_stub'), false)
        eq('an unknown payment is a 404', (await app.request('/payment/nope', {}, env)).status, 404)

        await resetDatabase()
    } finally {
        stripe.restore()
        await rpc.stop()
        await stopProxy()
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run().catch((e) => {
    console.error('payment-flows-check crashed:', e)
    process.exit(1)
})
