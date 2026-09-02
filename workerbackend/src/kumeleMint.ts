// The Kumele integration: api.kumele.com already collected payment on its own Stripe
// account and calls in here to get the NFT minted. This worker never sees that
// PaymentIntent any other way - there is no shared Stripe webhook between the two
// systems, which is what makes a duplicate mint structurally impossible rather than
// merely unlikely. See docs/kumele-mint-service.md for the full contract.

import { Context } from 'hono'
import { withPrisma, getConnectionString } from './db'
import { isSolanaAddress } from './chains'
import { getBalance } from './solana'
import { quoteMintFee, assetBytesFor, utf8Bytes, MAX_NAME_BYTES, MAX_URI_BYTES } from './web3fees'
import { platformSigner, runMintJob } from './mintjob'
import { hmacSha256Hex, timingSafeEqual } from './stripe'
import { kickOff, VAULT_SAFETY_FACTOR } from './payments'

// --- auth --------------------------------------------------------------------------------

export type SignatureVerdict = { ok: true } | { ok: false; reason: string }

/**
 * X-Kumele-Signature: sha256=<hex>, X-Kumele-Timestamp: <unix seconds>, HMAC-SHA256 over
 * `${timestamp}.${rawBody}`. Same construction as verifyWebhookSignature in stripe.ts, but a
 * different header shape (two headers, not one combined t=,v1= value), so it isn't reused
 * verbatim - hmacSha256Hex and timingSafeEqual, the actual primitives, are.
 */
export const verifyMintApiSignature = async (
    rawBody: string,
    sigHeader: string | undefined,
    tsHeader: string | undefined,
    secret: string,
    toleranceSeconds = 300,
    nowMs: number = Date.now()
): Promise<SignatureVerdict> => {
    if (!secret) return { ok: false, reason: 'shared secret is not configured' }
    if (!sigHeader) return { ok: false, reason: 'missing X-Kumele-Signature header' }
    if (!tsHeader || !/^\d+$/.test(tsHeader)) {
        return { ok: false, reason: 'missing or invalid X-Kumele-Timestamp header' }
    }
    if (!sigHeader.startsWith('sha256=')) {
        return { ok: false, reason: 'X-Kumele-Signature must be sha256=<hex>' }
    }
    const candidate = sigHeader.slice('sha256='.length)

    const timestamp = Number(tsHeader)
    if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) {
        return { ok: false, reason: 'timestamp outside the tolerance window' }
    }

    const expected = await hmacSha256Hex(secret, `${tsHeader}.${rawBody}`)
    return timingSafeEqual(expected, candidate)
        ? { ok: true }
        : { ok: false, reason: 'signature did not match' }
}

// --- validation ----------------------------------------------------------------------------

export type MintRequest = {
    paymentIntentId: string
    orderId: string
    chain: 'solana'
    recipientWallet: string
    name: string
    metadataUri: string
}

export type ValidationResult =
    | { ok: true; value: MintRequest }
    | { ok: false; error: string; code: string }

/**
 * Pure so the check file can pin every rejection without a running server. Mirrors the
 * validation createIntent already does for the standalone flow (payments.ts:42-62) - same
 * byte-bounded name/URI checks, same isSolanaAddress call - because the buyer-present
 * checkout and this server-to-server call are minting the same shape of asset.
 */
export const validateMintRequest = (body: any): ValidationResult => {
    const paymentIntentId = body?.payment_intent_id
    const orderId = body?.order_id
    const chain = body?.chain
    const recipientWallet = body?.recipient_wallet
    const quantity = body?.quantity
    const name = body?.name
    const metadataUri = body?.metadata_uri

    if (typeof paymentIntentId !== 'string' || !paymentIntentId) {
        return { ok: false, error: 'payment_intent_id is required', code: 'missing_payment_intent_id' }
    }
    if (typeof orderId !== 'string' || !orderId) {
        return { ok: false, error: 'order_id is required', code: 'missing_order_id' }
    }
    if (chain !== 'solana') {
        return { ok: false, error: 'chain must be "solana"', code: 'unsupported_chain' }
    }
    if (typeof recipientWallet !== 'string' || !isSolanaAddress(recipientWallet)) {
        return { ok: false, error: 'recipient_wallet must be a valid Solana public key', code: 'invalid_wallet' }
    }
    // One asset per payment - see docs/kumele-mint-service.md for why quantity > 1 isn't
    // supported yet (MintJob.paymentId is @unique, not @@unique([paymentId, index])).
    if (quantity !== 1) {
        return { ok: false, error: 'quantity must be 1', code: 'unsupported_quantity' }
    }
    if (typeof name !== 'string' || !name.trim() || utf8Bytes(name) > MAX_NAME_BYTES) {
        return { ok: false, error: `name is required and must be at most ${MAX_NAME_BYTES} bytes`, code: 'invalid_name' }
    }
    if (typeof metadataUri !== 'string' || !/^https?:\/\//.test(metadataUri)) {
        return { ok: false, error: 'metadata_uri must be an http(s) URL', code: 'invalid_metadata_uri' }
    }
    if (utf8Bytes(metadataUri) > MAX_URI_BYTES) {
        return { ok: false, error: `metadata_uri must be at most ${MAX_URI_BYTES} bytes`, code: 'invalid_metadata_uri' }
    }

    return {
        ok: true,
        value: { paymentIntentId, orderId, chain: 'solana', recipientWallet, name: name.trim(), metadataUri },
    }
}

// --- response shaping ------------------------------------------------------------------------

type JobLike = { status: string; mintAddress?: string | null; txSignature?: string | null; lastError?: string | null }

/**
 * One mapping, used both for the fresh-accept path and for a replayed request that finds an
 * existing row - so "what does a caller see" can't drift between the two.
 */
export const mintApiResponseFor = (job: JobLike): { httpStatus: number; body: Record<string, unknown> } => {
    if (job.status === 'MINTED') {
        return { httpStatus: 200, body: { status: 'minted', mint_address: job.mintAddress, tx_signature: job.txSignature } }
    }
    if (job.status === 'BLOCKED' || job.status === 'FAILED' || job.status === 'REFUNDED') {
        return { httpStatus: 200, body: { status: 'mint_failed', reason: job.lastError ?? 'mint could not complete' } }
    }
    // AWAITING_PAYMENT never actually occurs for a KUMELE_API row (created straight into
    // PENDING below), listed for completeness rather than left to fall through silently.
    return { httpStatus: 202, body: { status: 'mint_pending' } }
}

// --- handler -----------------------------------------------------------------------------

export const mintFromKumele = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 500)

    const secret = c.env.KUMELE_MINT_API_SECRET
    if (!secret) return c.json({ error: 'Kumele mint API is not configured' }, 503)

    // Raw text, not c.req.json() first: the signature covers the exact bytes sent, and
    // Hono's body cache would otherwise hand back JSON.stringify(body) to a second reader,
    // silently breaking verification. Same reasoning as the Stripe webhook (payments.ts:371).
    const rawBody = await c.req.raw.text()
    const verdict = await verifyMintApiSignature(
        rawBody,
        c.req.header('X-Kumele-Signature'),
        c.req.header('X-Kumele-Timestamp'),
        secret
    )
    if (!verdict.ok) return c.json({ error: `Signature verification failed: ${verdict.reason}` }, 401)

    let body: any
    try {
        body = JSON.parse(rawBody)
    } catch {
        return c.json({ error: 'Body is not JSON' }, 400)
    }

    const idempotencyKey = c.req.header('Idempotency-Key')
    if (idempotencyKey && idempotencyKey !== body?.payment_intent_id) {
        return c.json({ error: 'Idempotency-Key must match payment_intent_id' }, 400)
    }

    const validated = validateMintRequest(body)
    if (!validated.ok) return c.json({ error: validated.error, code: validated.code }, 400)
    const req = validated.value

    // Checked before the vault preflight, not after: Kumele's own dispatcher retries with
    // backoff (docs/kumele-mint-service.md), so a replayed payment_intent_id is the common
    // case, not the rare one. Answering it here skips an RPC call (getBalance, plus the
    // priority-fee/rent reads inside quoteMintFee) on every retry instead of burning
    // Helius's rate limit on requests that were never going to mint again. The P2002 catch
    // below still exists, for the race between two FIRST attempts arriving at once - this
    // check narrows how often that race is even reached, it doesn't replace the guard.
    const already = await withPrisma(connectionString, (prisma) =>
        prisma.payment.findUnique({
            where: { stripePaymentIntentId: req.paymentIntentId },
            include: { mintJob: true },
        })
    )
    if (already?.mintJob) {
        const { httpStatus, body: respBody } = mintApiResponseFor(already.mintJob)
        return c.json(respBody, httpStatus as any)
    }

    const vault = platformSigner(c.env)
    if (!vault || !c.env.MINT_ASSET_SEED) {
        console.error('[KUMELE-MINT] refusing: mint vault or MINT_ASSET_SEED missing')
        return c.json({ error: 'Minting is not configured' }, 503)
    }

    // Same pre-flight the standalone checkout runs (payments.ts:108-123): refuse rather
    // than accept an order the vault cannot actually fund. estimatedFeeMinor here is a
    // cost record, not a charge - Kumele already charged the buyer on their own Stripe.
    const quote = await quoteMintFee(
        c.env,
        1,
        assetBytesFor(utf8Bytes(req.name), utf8Bytes(req.metadataUri))
    )
    const balance = await getBalance(c.env, vault.address)
    if (balance !== null && balance < quote.networkFeeLamports * VAULT_SAFETY_FACTOR) {
        console.error(
            `[KUMELE-MINT] vault ${vault.address} holds ${balance} lamports, need ` +
            `${quote.networkFeeLamports * VAULT_SAFETY_FACTOR} to accept ${req.paymentIntentId}`
        )
        return c.json({ error: 'Minting is temporarily unavailable', code: 'vault_unfunded' }, 503)
    }

    try {
        const payment = await withPrisma(connectionString, (prisma) =>
            prisma.payment.create({
                data: {
                    status: 'PAID',
                    paidAt: new Date(),
                    origin: 'KUMELE_API',
                    stripePaymentIntentId: req.paymentIntentId,
                    orderId: req.orderId,
                    currency: 'eur',
                    // 0, not omitted: this worker charged the buyer nothing on either of
                    // these lines - Kumele's own Stripe integration did. Omitting the
                    // columns isn't possible (all four are non-null Int); 0 here is the
                    // honest value, not a placeholder standing in for an unknown one.
                    baseAmountMinor: 0,
                    taxAmountMinor: 0,
                    mintFeeMinor: quote.estimatedFeeMinor,
                    totalAmountMinor: 0,
                    mintJob: {
                        create: {
                            // Not AWAITING_PAYMENT: payment already happened on Kumele's side.
                            status: 'PENDING',
                            chain: 'SOLANA',
                            ownerAddress: req.recipientWallet,
                            name: req.name,
                            metadataUri: req.metadataUri,
                            estimatedFeeMinor: quote.estimatedFeeMinor,
                        },
                    },
                },
                include: { mintJob: true },
            })
        )

        kickOff(c, runMintJob(c.env, connectionString, payment.mintJob!.id))
        return c.json({ status: 'mint_pending' }, 202)
    } catch (e: any) {
        // Duplicate payment_intent_id: the exact case the @unique constraint exists for.
        // Read the existing row back and answer with its CURRENT state rather than
        // minting again - a replay reports, it never re-triggers.
        if (e?.code === 'P2002') {
            const existing = await withPrisma(connectionString, (prisma) =>
                prisma.payment.findUnique({
                    where: { stripePaymentIntentId: req.paymentIntentId },
                    include: { mintJob: true },
                })
            )
            if (existing?.mintJob) {
                const { httpStatus, body: respBody } = mintApiResponseFor(existing.mintJob)
                return c.json(respBody, httpStatus as any)
            }
            // orderId collided instead of paymentIntentId - a different order reusing an
            // id, not a legitimate replay. Refuse rather than guess which row is meant.
            return c.json({ error: 'order_id or payment_intent_id already in use', code: 'duplicate' }, 409)
        }
        console.error('[KUMELE-MINT] failed:', e)
        return c.json({ error: 'Could not queue the mint', details: e?.message }, 500)
    }
}
