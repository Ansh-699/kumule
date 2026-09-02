// The money half of the Stripe rail.
//
// Three endpoints and one rule: the server decides every amount. The only things a caller
// contributes are a quote id, a destination wallet, and what to mint. Anything that looks
// like a price in the request body is ignored - a checkout that trusts the client for the
// number is a checkout that sells NFTs for a cent.

import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'
import { isSolanaAddress } from './chains'
import { getBalance } from './solana'
import { mintPricing, taxOn, directCryptoEnabled, MINT_LEASE_MS } from './config'
import { assetBytesFor, utf8Bytes, MAX_NAME_BYTES, MAX_URI_BYTES } from './web3fees'
import { formatMinor } from './fx'
import { createPaymentIntent, verifyWebhookSignature } from './stripe'
import { platformSigner, runMintJob, sweepMintJobs, refundJob, backfillMintCosts } from './mintjob'
import { logSecurityEvent } from './audit'

/**
 * Multiple of the quoted network fee the vault must be holding before we take money.
 *
 * Charging for a mint the platform cannot fund is the worst outcome in this whole flow, and
 * the check costs one RPC call. Three times over, so a vault that is about to run dry stops
 * selling before it does rather than after.
 */
export const VAULT_SAFETY_FACTOR = 3n

// --- POST /api/v1/payments/intent -------------------------------------------------------

export const createIntent = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments are not configured' }, 503)

    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { quoteId, ownerAddress, name, metadataUri } = body ?? {}

    if (typeof quoteId !== 'string' || !quoteId) {
        return c.json({ error: 'quoteId is required' }, 400)
    }
    // Validated here rather than at mint time, because at mint time the buyer has already
    // paid and a bad address is unrecoverable without a refund.
    if (typeof ownerAddress !== 'string' || !isSolanaAddress(ownerAddress)) {
        return c.json({ error: 'ownerAddress must be a valid Solana public key' }, 400)
    }
    // Bounded in BYTES rather than characters: a 100-character name of emoji is 400 bytes of
    // on-chain rent, which is not what a 100-character limit reads like it is promising.
    if (typeof name !== 'string' || !name.trim() || utf8Bytes(name) > MAX_NAME_BYTES) {
        return c.json({ error: `name is required and must be at most ${MAX_NAME_BYTES} bytes` }, 400)
    }
    if (typeof metadataUri !== 'string' || !/^https?:\/\//.test(metadataUri)) {
        return c.json({ error: 'metadataUri must be an http(s) URL' }, 400)
    }
    if (utf8Bytes(metadataUri) > MAX_URI_BYTES) {
        return c.json({ error: `metadataUri must be at most ${MAX_URI_BYTES} bytes` }, 400)
    }

    const pricing = mintPricing(c.env)

    try {
        const quote = await withPrisma(connectionString, (prisma) =>
            prisma.feeQuote.findUnique({ where: { id: quoteId } })
        )
        if (!quote) return c.json({ error: 'Unknown quoteId' }, 404)
        if (quote.expiresAt.getTime() < Date.now()) {
            return c.json({ error: 'This quote has expired. Request a new one.', code: 'quote_expired' }, 409)
        }
        // One asset per payment. The quote endpoint prices any quantity, but the unique
        // constraint on MintJob.paymentId is what enforces "one payment cannot mint twice",
        // and honouring quantity here would mean giving that up.
        if (quote.quantity !== 1) {
            return c.json(
                { error: 'Only quantity=1 can be paid for today', code: 'unsupported_quantity' },
                400
            )
        }

        // The quote paid rent for an account of a specific size. If the asset about to be
        // minted is bigger than that, the platform silently eats the difference on every
        // such mint - so this refuses rather than absorbing it. Measured in UTF-8 bytes,
        // because that is what the chain stores: an emoji is one character and four bytes.
        const actualAssetBytes = assetBytesFor(utf8Bytes(name.trim()), utf8Bytes(metadataUri))
        if (actualAssetBytes > quote.assetBytes) {
            return c.json(
                {
                    error:
                        'This name and metadata URI need more on-chain space than the quote covers. ' +
                        'Request a new quote with nameBytes and uriBytes.',
                    code: 'quote_too_small',
                    needsBytes: actualAssetBytes,
                    quotedBytes: quote.assetBytes,
                },
                409
            )
        }

        // Can the platform actually pay for this mint?
        // Both mint prerequisites, checked before any money is taken. The seed was the one
        // that was not: without it runMintJob returns before the claim, so `attempts` never
        // increments, the cap is never reached and no refund ever fires - a charged order
        // retrying every five minutes forever with nothing to stop it.
        const vault = platformSigner(c.env)
        if (!vault || !c.env.MINT_ASSET_SEED) {
            console.error('[PAYMENTS] refusing checkout: mint vault or MINT_ASSET_SEED missing')
            return c.json({ error: 'Minting is not configured. No payment was taken.' }, 503)
        }
        const balance = await getBalance(c.env, vault.address)
        if (balance !== null && balance < quote.networkFeeLamports * VAULT_SAFETY_FACTOR) {
            console.error(
                `[PAYMENTS] vault ${vault.address} holds ${balance} lamports, need ` +
                `${quote.networkFeeLamports * VAULT_SAFETY_FACTOR} to accept this order`
            )
            return c.json(
                { error: 'Minting is temporarily unavailable. No payment was taken.', code: 'vault_unfunded' },
                503
            )
        }

        // Every figure below is derived here. Nothing came from the request body.
        const baseAmountMinor = pricing.baseAmountMinor
        const taxAmountMinor = taxOn(baseAmountMinor, pricing.taxRateBps)
        const mintFeeMinor = quote.estimatedFeeMinor
        const totalAmountMinor = baseAmountMinor + taxAmountMinor + mintFeeMinor

        // Stripe refuses EUR charges under 50 minor units. Caught here so the buyer sees a
        // sentence rather than a declined card.
        if (totalAmountMinor < pricing.minChargeMinor) {
            return c.json(
                {
                    error:
                        `The total (${formatMinor(totalAmountMinor)}) is below the ` +
                        `${formatMinor(pricing.minChargeMinor)} minimum a card payment can take.`,
                    code: 'amount_too_small',
                },
                400
            )
        }

        // The row first, Stripe second. A Stripe call that fails after the row exists is a
        // retryable no-op; a row write that fails after the charge exists is a payment
        // nothing can find and nobody can refund.
        const payment = await withPrisma(connectionString, (prisma) =>
            prisma.payment.create({
                data: {
                    status: 'REQUIRES_PAYMENT',
                    currency: pricing.currency,
                    baseAmountMinor,
                    taxAmountMinor,
                    mintFeeMinor,
                    totalAmountMinor,
                    quoteId: quote.id,
                    // Nested create, so the job cannot fail to exist for a payment that does.
                    mintJob: {
                        create: {
                            status: 'AWAITING_PAYMENT',
                            chain: 'SOLANA',
                            ownerAddress,
                            name: name.trim(),
                            metadataUri,
                            estimatedFeeMinor: mintFeeMinor,
                        },
                    },
                },
                include: { mintJob: true },
            })
        )

        const intent = await createPaymentIntent(c.env, {
            amountMinor: totalAmountMinor,
            currency: pricing.currency,
            description: `Kumule NFT mint: ${name.trim().slice(0, 60)}`,
            // Derived, never random: a retried call reaches the same charge instead of
            // creating a second one.
            idempotencyKey: `pi:${payment.id}`,
            metadata: {
                requires_nft_mint: 'true',
                nft_minting_fee_minor: String(mintFeeMinor),
                nft_minting_fee_quote_id: quote.id,
                nft_minting_fee_label: 'NFT minting fee',
                nft_chain: 'solana',
                kumule_payment_id: payment.id,
            },
        })

        if (!intent.ok) {
            await withPrisma(connectionString, (prisma) =>
                prisma.payment.update({
                    where: { id: payment.id },
                    data: { status: 'FAILED', failureReason: intent.message.slice(0, 500) },
                })
            )
            // Stripe's own message is deliberately NOT forwarded. It is a third party talking
            // about our credentials: a misconfigured key makes it read "Invalid API Key
            // provided: sk_test_****...only", which is key material - masked, but ours - in a
            // response body sent to a browser. It is kept in the logs and on the row, where
            // support can read it, and the caller gets a payment id to quote instead.
            //
            // The other `details: e?.message` returns in this file are our own exception text
            // and follow the pattern the rest of the repo uses. This one is different in kind.
            console.error(`[PAYMENTS] stripe refused intent for ${payment.id}: ${intent.message}`)
            return c.json(
                { error: 'Could not start the payment. Please try again.', paymentId: payment.id },
                502
            )
        }

        await withPrisma(connectionString, (prisma) =>
            prisma.payment.update({
                where: { id: payment.id },
                data: { stripePaymentIntentId: intent.data.id },
            })
        )

        return c.json({
            paymentId: payment.id,
            clientSecret: intent.data.client_secret,
            currency: pricing.currency,
            breakdown: {
                base_amount_minor: baseAmountMinor,
                tax_amount_minor: taxAmountMinor,
                nft_minting_fee_minor: mintFeeMinor,
                total_amount_minor: totalAmountMinor,
                display: {
                    base: formatMinor(baseAmountMinor),
                    tax: formatMinor(taxAmountMinor),
                    nft_minting_fee: formatMinor(mintFeeMinor),
                    total: formatMinor(totalAmountMinor),
                },
            },
        })
    } catch (e: any) {
        // Payment.quoteId is unique, so a second checkout against the same quote - a
        // double-click, a retried request - threw P2002 out of prisma.payment.create and
        // landed here as a 500 quoting the constraint and the column name. That is an
        // undocumented status for an ordinary user action, and it leaks schema while doing it.
        if (e?.code === 'P2002') {
            const existing = await withPrisma(connectionString, (prisma) =>
                prisma.payment.findUnique({ where: { quoteId }, select: { id: true } })
            ).catch(() => null)
            return c.json(
                {
                    error: 'This quote has already been used to start a payment.',
                    code: 'quote_already_used',
                    paymentId: existing?.id ?? null,
                },
                409
            )
        }
        console.error('createIntent failed:', e)
        return c.json({ error: 'Could not start the payment', details: e?.message }, 500)
    }
}

// --- GET /api/v1/payments/:paymentId ----------------------------------------------------

/**
 * Status for the checkout page to poll.
 *
 * A capability URL: whoever holds the id gets the status. It carries no client secret, no
 * Stripe ids and no personal data - and no mint address until the asset actually exists,
 * because a derived-but-unminted address is one someone could dust to break the mint.
 */
export const getPayment = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const paymentId = c.req.param('paymentId')
    try {
        const payment = await withPrisma(connectionString, (prisma) =>
            prisma.payment.findUnique({
                where: { id: paymentId },
                include: { mintJob: { include: { nft: { select: { assetId: true, imageUrl: true } } } } },
            })
        )
        if (!payment) return c.json({ error: 'Unknown payment' }, 404)

        const job = payment.mintJob
        const minted = job?.status === 'MINTED'

        return c.json({
            paymentId: payment.id,
            status: payment.status,
            currency: payment.currency,
            breakdown: {
                base_amount_minor: payment.baseAmountMinor,
                tax_amount_minor: payment.taxAmountMinor,
                nft_minting_fee_minor: payment.mintFeeMinor,
                total_amount_minor: payment.totalAmountMinor,
            },
            mint: job
                ? {
                    status: job.status,
                    ownerAddress: job.ownerAddress,
                    // Only once it exists on chain.
                    assetId: minted ? job.nft?.assetId ?? job.mintAddress : null,
                    txSignature: minted ? job.txSignature : null,
                    imageUrl: minted ? job.nft?.imageUrl ?? null : null,
                    ownershipVerified: job.ownershipVerified,
                    estimatedFeeMinor: job.estimatedFeeMinor,
                    actualFeeMinor: job.actualFeeMinor,
                }
                : null,
        })
    } catch (e: any) {
        console.error('getPayment failed:', e)
        return c.json({ error: 'Could not read the payment', details: e?.message }, 500)
    }
}

// --- POST /api/v1/stripe/webhook --------------------------------------------------------

/**
 * Start background work without letting the absence of an ExecutionContext become an error.
 *
 * `c.executionCtx` is a getter that THROWS when there is no context, not a property that is
 * undefined - so `c.executionCtx?.waitUntil?.(p)` still throws. Left unguarded, a webhook
 * whose database work had already succeeded would answer 500 and Stripe would redeliver an
 * event that was in fact handled. It also makes the route impossible to exercise from a
 * check, since app.request(path, init, env) passes no context.
 */
export const kickOff = (c: Context<{ Bindings: CloudflareBindings }>, work: Promise<unknown>): void => {
    const swallow = (e: unknown) => console.error('[WEBHOOK] background work failed:', e)
    try {
        c.executionCtx.waitUntil(work.catch(swallow))
    } catch {
        // No ExecutionContext: run it detached. The cron sweep is the real guarantee either
        // way, so losing this one is a latency cost, never a correctness one.
        void work.catch(swallow)
    }
}

/**
 * Find the payment intent an event is about.
 *
 * Not simply `data.object.id`, because that is only the intent for `payment_intent.*` events.
 * A `charge.*` event carries a Charge, whose own id is `ch_...` and which names its intent in
 * a separate field - so reading `.id` there yields something that is not a payment intent at
 * all, and a prefix guard then discards the event silently. That is how the entire refund path
 * became unreachable in production while a test that fabricated the wrong shape went green.
 *
 * `payment_intent` is an expandable field: a string normally, an object when the caller asked
 * Stripe to expand it. Both are accepted.
 */
export const paymentIntentIdFrom = (event: any): string | null => {
    const object = event?.data?.object ?? {}
    const type: string = event?.type ?? ''

    if (type.startsWith('charge.') || type.startsWith('refund.')) {
        const pi = object.payment_intent
        const id = typeof pi === 'string' ? pi : pi?.id
        return typeof id === 'string' && id.startsWith('pi_') ? id : null
    }

    const id = object.id
    return typeof id === 'string' && id.startsWith('pi_') ? id : null
}

/** Stripe stops retrying after roughly three days; past that a missing row is not a race. */
const STALE_EVENT_MS = 60 * 60 * 1_000

export const stripeWebhook = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    // c.req.raw.text(), not c.req.text(): Hono caches the body, and if anything upstream
    // ever parses it as JSON the text form comes back as JSON.stringify(body) - byte-identical
    // only by luck, which would silently break every signature check.
    const rawBody = await c.req.raw.text()
    const secret = c.env.STRIPE_WEBHOOK_SECRET

    if (!secret) {
        console.error('STRIPE_WEBHOOK_SECRET is not configured; refusing all webhooks')
        return c.json({ error: 'Webhooks are not configured' }, 503)
    }

    const verdict = await verifyWebhookSignature(rawBody, c.req.header('Stripe-Signature'), secret)
    if (!verdict.ok) {
        logSecurityEvent('invalid_signature', {
            actor: 'stripe_webhook',
            metadata: { reason: verdict.reason },
        })
        // 400, not 500: a bad signature will never verify on a retry.
        return c.json({ error: `Signature verification failed: ${verdict.reason}` }, 400)
    }

    let event: any
    try {
        event = JSON.parse(rawBody)
    } catch {
        return c.json({ error: 'Body is not JSON' }, 400)
    }

    const type: string = event?.type ?? ''
    const intent = event?.data?.object ?? {}
    const intentId = paymentIntentIdFrom(event)

    // Stripe guarantees neither ordering nor exactly-once delivery, so anything not keyed on
    // the payment intent is acknowledged and ignored.
    if (!intentId) {
        return c.json({ received: true, ignored: 'no payment intent on this event' })
    }

    const connectionString = getConnectionString(c.env)
    if (!connectionString) {
        // 500 so Stripe retries once the database is back.
        console.error('webhook: database not configured')
        return c.json({ error: 'Database not configured' }, 500)
    }

    const eventAgeMs = event?.created ? Date.now() - Number(event.created) * 1_000 : 0

    try {
        if (type === 'payment_intent.succeeded') {
            // Written into the PaymentIntent at checkout so the payment can be found even if
            // the column that normally finds it was never written.
            const metadataPaymentId: string | undefined = intent?.metadata?.kumule_payment_id

            const result = await withPrisma(connectionString, async (prisma) => {
                let payment = await prisma.payment.findUnique({
                    where: { stripePaymentIntentId: intentId },
                    include: { mintJob: true },
                })

                // The recovery path for a window this design deliberately creates. createIntent
                // writes the Payment row FIRST, then calls Stripe, then attaches the intent id -
                // that ordering is what stops a charge existing with no row. But if the attach
                // fails, the row exists and is unfindable by the only column the webhook looks
                // at, and the customer's money sits against a payment nothing can advance.
                //
                // The id has been travelling in the Stripe metadata the whole time and was
                // simply never read back. It is only ever used to FIND the row - every amount
                // still comes from the database - so trusting it costs nothing.
                if (!payment && metadataPaymentId) {
                    payment = await prisma.payment.findUnique({
                        where: { id: metadataPaymentId },
                        include: { mintJob: true },
                    })
                    if (payment && !payment.stripePaymentIntentId) {
                        // Repair it, so every later event finds it the normal way. Guarded, so
                        // a metadata id pointing at someone else's already-attached payment
                        // cannot hijack it.
                        const { count } = await prisma.payment.updateMany({
                            where: { id: payment.id, stripePaymentIntentId: null },
                            data: { stripePaymentIntentId: intentId },
                        })
                        if (count > 0) {
                            console.warn(
                                `[WEBHOOK] recovered payment ${payment.id} via metadata; ` +
                                'the intent id was never attached at checkout'
                            )
                        }
                    } else if (payment && payment.stripePaymentIntentId !== intentId) {
                        // Points at a payment belonging to a different intent. Not ours.
                        logSecurityEvent('suspicious_activity', {
                            actor: 'stripe_webhook',
                            target: intentId,
                            metadata: { reason: 'metadata payment id belongs to another intent' },
                        })
                        payment = null
                    }
                }

                if (!payment) return { kind: 'missing' as const }

                await prisma.payment.updateMany({
                    where: { id: payment.id, status: { not: 'REFUNDED' } },
                    data: { status: 'PAID', paidAt: new Date() },
                })

                // The transition that matters. count 0 here means the job already left
                // AWAITING_PAYMENT - a duplicate delivery, which is normal and not an error.
                const { count } = await prisma.mintJob.updateMany({
                    where: { paymentId: payment.id, status: 'AWAITING_PAYMENT' },
                    data: { status: 'PENDING' },
                })
                return { kind: 'ok' as const, jobId: payment.mintJob?.id ?? null, advanced: count > 0 }
            })

            if (result.kind === 'missing') {
                // Ambiguous on purpose, and resolved in favour of retrying. Either this event
                // raced the row that createIntent was writing, or that write failed after the
                // charge existed. Answering 200 would strand a real payment forever, so this
                // asks Stripe to come back - until the event is too old for a race to explain.
                if (eventAgeMs > STALE_EVENT_MS) {
                    logSecurityEvent('suspicious_activity', {
                        actor: 'stripe_webhook',
                        target: intentId,
                        metadata: { reason: 'succeeded event has no matching payment row', eventAgeMs },
                    })
                    return c.json({ received: true, ignored: 'no matching payment, event is stale' })
                }
                console.error(`webhook: no payment row for ${intentId}; asking Stripe to retry`)
                return c.json({ error: 'Payment row not found yet' }, 500)
            }

            // Fast path only. waitUntil buys about 30 seconds, which is one mint on a good
            // day - the cron sweep is what actually guarantees the job runs.
            if (result.advanced && result.jobId) {
                kickOff(c, runMintJob(c.env, connectionString, result.jobId))
            }
            return c.json({ received: true, minting: result.advanced })
        }

        if (type === 'payment_intent.payment_failed' || type === 'payment_intent.canceled') {
            // A DECLINE IS NOT THE END OF A PAYMENT. Stripe returns a failed PaymentIntent to
            // requires_payment_method so the buyer can try another card on the same intent -
            // and the checkout page leaves the same client secret mounted, so retrying is the
            // normal path, not an edge case.
            //
            // This used to move the job to FAILED on a decline. The later succeeded event only
            // advances a job in AWAITING_PAYMENT, so it matched nothing, answered 200 so Stripe
            // never redelivered, and no sweep looks at FAILED. The buyer paid on the second
            // card and received nothing, permanently, with no refund and no retry.
            //
            // So a decline touches the Payment row only. Cancellation is the terminal one.
            const terminal = type === 'payment_intent.canceled'
            await withPrisma(connectionString, async (prisma) => {
                const payment = await prisma.payment.findUnique({
                    where: { stripePaymentIntentId: intentId },
                })
                if (!payment) return

                // Guarded, because Stripe guarantees no ordering: a decline event can arrive
                // after the retry that succeeded, and must not overwrite a settled payment.
                // The succeeded handler above guards its own write for the same reason.
                await prisma.payment.updateMany({
                    where: { id: payment.id, status: { in: ['REQUIRES_PAYMENT', 'FAILED'] } },
                    data: {
                        status: terminal ? 'FAILED' : 'REQUIRES_PAYMENT',
                        failureReason: intent?.last_payment_error?.message?.slice(0, 500) ?? type,
                    },
                })

                if (terminal) {
                    // Cancelled intents cannot be retried, so the job that was waiting on one
                    // never will be paid for.
                    await prisma.mintJob.updateMany({
                        where: { paymentId: payment.id, status: 'AWAITING_PAYMENT' },
                        data: { status: 'FAILED', lastError: type },
                    })
                }
            })
            return c.json({ received: true, terminal })
        }

        if (type === 'charge.refunded') {
            // This event fires for PARTIAL refunds as well as full ones. Treating a partial
            // refund as a cancellation would stop a mint the buyer has still largely paid for.
            // The Charge carries both numbers, so ask rather than assume; when it does not
            // (a shape we do not recognise), treat it as full, because failing to stop a mint
            // we were told to stop is the worse mistake.
            const refunded = Number(intent?.amount_refunded)
            const charged = Number(intent?.amount)
            const isFull =
                !Number.isFinite(refunded) || !Number.isFinite(charged) || refunded >= charged

            await withPrisma(connectionString, async (prisma) => {
                const payment = await prisma.payment.findUnique({
                    where: { stripePaymentIntentId: intentId },
                })
                if (!payment) return

                if (!isFull) {
                    // Recorded, not acted on. A partial refund is a commercial decision about
                    // an order that still stands.
                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: {
                            failureReason:
                                `partially refunded: ${refunded} of ${charged} ${payment.currency}`,
                        },
                    })
                    return
                }

                await prisma.payment.update({
                    where: { id: payment.id },
                    data: { status: 'REFUNDED' },
                })
                // A refund that arrives before the mint starts simply stops it.
                await prisma.mintJob.updateMany({
                    where: { paymentId: payment.id, status: { in: ['AWAITING_PAYMENT', 'PENDING'] } },
                    data: { status: 'REFUNDED', lastError: 'payment refunded before minting' },
                })
                // One that arrives later cannot: an asset on chain does not come back. Rather
                // than pretend otherwise, the job keeps its real status and carries a flag, so
                // "refunded but delivered" shows up in the admin view as the human decision it
                // is instead of vanishing into a status nobody reconciles.
                await prisma.mintJob.updateMany({
                    where: { paymentId: payment.id, status: { in: ['MINTING', 'MINTED'] } },
                    data: { lastError: 'payment refunded after minting began; asset was still delivered' },
                })
            })
            return c.json({ received: true })
        }

        return c.json({ received: true, ignored: type })
    } catch (e: any) {
        // 500 so Stripe retries: the event was genuine and we failed to act on it.
        console.error('webhook handling failed:', e)
        return c.json({ error: 'Could not process the event', details: e?.message }, 500)
    }
}

// --- cron -------------------------------------------------------------------------------

export const scheduled = async (
    _controller: ScheduledController,
    env: CloudflareBindings,
    _ctx: ExecutionContext
): Promise<void> => {
    const connectionString = getConnectionString(env)
    if (!connectionString) {
        console.error('[CRON] database not configured; nothing to sweep')
        return
    }
    try {
        const { processed, outcomes } = await sweepMintJobs(env, connectionString)
        if (processed > 0) console.log('[CRON] swept mint jobs:', JSON.stringify(outcomes))
    } catch (e) {
        // Most likely cause by far: the code is deployed and the migration has not run, so
        // mint_jobs does not exist yet. That is a deploy-ordering state, not an emergency, and
        // it resolves itself the moment the migration lands - so it logs and returns rather
        // than throwing out of a scheduled handler every five minutes.
        console.error('[CRON] sweep failed (is the schema migrated?):', e)
        return
    }

    await backfillMintCosts(env, connectionString).catch((e) =>
        console.error('[CRON] cost backfill failed:', e)
    )
    await pruneAbandonedQuotes(env, connectionString)
}

/**
 * Delete quotes nobody spent.
 *
 * The quote endpoint is public and writes a row per call, so an abandoned checkout - or a
 * crawler - leaves one behind forever. Nothing read them after they expired, so the table
 * grew without bound for no benefit.
 *
 * Quotes attached to a payment are never touched: they are the record of what a customer was
 * charged and why, and the whole reason the rate is stored on them. Only the ones that expired
 * unused go, and only after a week, so there is a wide window in which to investigate a
 * checkout that went wrong.
 */
const QUOTE_RETENTION_MS = 7 * 24 * 3_600_000

export const pruneAbandonedQuotes = async (
    _env: CloudflareBindings,
    connectionString: string
): Promise<number> => {
    try {
        const { count } = await withPrisma(connectionString, (prisma) =>
            prisma.feeQuote.deleteMany({
                where: {
                    expiresAt: { lt: new Date(Date.now() - QUOTE_RETENTION_MS) },
                    payment: null,
                },
            })
        )
        if (count > 0) console.log(`[CRON] pruned ${count} abandoned quote(s)`)
        return count
    } catch (e) {
        // Housekeeping must never be the reason a sweep reports failure.
        console.error('[CRON] quote prune failed:', e)
        return 0
    }
}

/** Whether the direct-crypto routes are live, for the frontend to read off /api/chains. */
export const featureFlags = (env: CloudflareBindings) => ({
    directCrypto: directCryptoEnabled(env),
    stripePayments: Boolean(env.STRIPE_SECRET_KEY),
})

// --- admin ------------------------------------------------------------------------------

/**
 * GET /api/admin/payments?status=
 *
 * Exists for one question: is anybody paid but unminted? That is the only state in this
 * whole flow where a customer has given up money and holds nothing, and without somewhere
 * to see it the answer is "nobody knows".
 */
export const adminListPayments = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200)
    const status = c.req.query('status')?.toUpperCase()
    const VALID = ['REQUIRES_PAYMENT', 'PAID', 'FAILED', 'REFUNDED']
    if (status && !VALID.includes(status)) {
        return c.json({ error: `status must be one of ${VALID.join(', ')}` }, 400)
    }

    try {
        const rows = await withPrisma(connectionString, (prisma) =>
            prisma.payment.findMany({
                where: status ? { status: status as any } : undefined,
                orderBy: { createdAt: 'desc' },
                take: limit,
                include: { mintJob: true },
            })
        )
        return c.json({
            data: rows.map((p) => ({
                id: p.id,
                status: p.status,
                currency: p.currency,
                totalAmountMinor: p.totalAmountMinor,
                total: formatMinor(p.totalAmountMinor, p.currency),
                baseAmountMinor: p.baseAmountMinor,
                taxAmountMinor: p.taxAmountMinor,
                mintFeeMinor: p.mintFeeMinor,
                stripePaymentIntentId: p.stripePaymentIntentId,
                stripeRefundId: p.stripeRefundId,
                failureReason: p.failureReason,
                paidAt: p.paidAt,
                createdAt: p.createdAt,
                mint: p.mintJob
                    ? {
                        status: p.mintJob.status,
                        attempts: p.mintJob.attempts,
                        ownerAddress: p.mintJob.ownerAddress,
                        mintAddress: p.mintJob.mintAddress,
                        txSignature: p.mintJob.txSignature,
                        estimatedFeeMinor: p.mintJob.estimatedFeeMinor,
                        actualFeeMinor: p.mintJob.actualFeeMinor,
                        actualFeeLamports: p.mintJob.actualFeeLamports?.toString() ?? null,
                        ownershipVerified: p.mintJob.ownershipVerified,
                        lastError: p.mintJob.lastError,
                    }
                    : null,
            })),
            count: rows.length,
            // The number worth alerting on.
            stranded: rows.filter(
                (p) => p.status === 'PAID' && p.mintJob && !['MINTED', 'REFUNDED'].includes(p.mintJob.status)
            ).length,
        })
    } catch (e: any) {
        console.error('adminListPayments failed:', e)
        return c.json({ error: 'Could not list payments', details: e?.message }, 500)
    }
}

/**
 * POST /api/admin/payments/:paymentId/refund
 *
 * Refuses to refund a payment whose NFT was actually delivered - that is a chargeback
 * decision, not an operational one, and doing it here would hand out an asset for free.
 */
export const adminRefundPayment = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const paymentId = c.req.param('paymentId')
    try {
        const payment = await withPrisma(connectionString, (prisma) =>
            prisma.payment.findUnique({ where: { id: paymentId }, include: { mintJob: true } })
        )
        if (!payment) return c.json({ error: 'Unknown payment' }, 404)
        if (payment.status === 'REFUNDED') {
            return c.json({ error: 'This payment has already been refunded' }, 409)
        }
        if (payment.mintJob?.status === 'MINTED') {
            return c.json(
                {
                    error: 'This mint succeeded; refunding it would give away the NFT.',
                    assetId: payment.mintJob.mintAddress,
                },
                409
            )
        }
        if (!payment.mintJob) return c.json({ error: 'Payment has no mint job' }, 409)

        // A job whose lease is still live has a worker inside it right now, possibly between
        // sendTransaction and confirmation. Refunding underneath that races an asset onto the
        // chain that has already been paid back.
        //
        // Only a LIVE lease though. A job stuck in MINTING with a long-dead lease is the
        // textbook stranded payment and is exactly what an operator needs this button for, so
        // refusing all of MINTING would block the common case to prevent the rare one.
        const lockedAt = payment.mintJob.lockedAt
        if (
            payment.mintJob.status === 'MINTING' &&
            lockedAt &&
            Date.now() - lockedAt.getTime() < MINT_LEASE_MS
        ) {
            return c.json(
                {
                    error: 'A mint is in flight for this payment. Try again once its lease expires.',
                    retryAfterSeconds: Math.ceil((MINT_LEASE_MS - (Date.now() - lockedAt.getTime())) / 1000),
                },
                409
            )
        }

        // Refunding something Stripe never captured makes Stripe raise an error and burns the
        // idempotency key for the refund that may genuinely be needed later.
        if (payment.status !== 'PAID') {
            return c.json(
                { error: `Only a paid payment can be refunded; this one is ${payment.status}.` },
                409
            )
        }

        const reason = (await c.req.json().catch(() => null))?.reason ?? 'refunded by an administrator'
        const ok = await refundJob(c.env, connectionString, payment.mintJob.id, String(reason))
        return c.json({ success: ok, paymentId }, ok ? 200 : 502)
    } catch (e: any) {
        console.error('adminRefundPayment failed:', e)
        return c.json({ error: 'Could not refund', details: e?.message }, 500)
    }
}
