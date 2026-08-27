// Stripe over plain fetch and Web Crypto.
//
// Not the `stripe` npm package: the surface used here is three REST calls and one HMAC, and
// the SDK is over a megabyte in a Worker bundle. This repo has already deleted a 50KB Buffer
// shim for the same reason.
//
// Money crossing this boundary is always an integer count of minor units, which is the only
// shape Stripe accepts anyway. Nothing in this file parses or formats a decimal.

const API = 'https://api.stripe.com/v1'

// --- encoding ---------------------------------------------------------------------------

const encodePairs = (value: unknown, key: string, out: string[]): void => {
    if (value === undefined || value === null) return
    if (Array.isArray(value)) {
        value.forEach((v, i) => encodePairs(v, `${key}[${i}]`, out))
        return
    }
    if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            encodePairs(v, key ? `${key}[${k}]` : k, out)
        }
        return
    }
    out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
}

/**
 * Stripe's form encoding: nested objects become metadata[key], arrays become
 * payment_method_types[0]. Exported so a check can pin the wire format without a network
 * call - a silently mis-encoded metadata block is invisible until someone reads the Stripe
 * dashboard weeks later.
 */
export const formEncode = (data: Record<string, unknown>): string => {
    const out: string[] = []
    for (const [k, v] of Object.entries(data)) encodePairs(v, k, out)
    return out.join('&')
}

// --- signature verification -------------------------------------------------------------

const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time compare, same shape as timingSafeEqual in admin.ts. */
const timingSafeEqual = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

export type SignatureVerdict =
    | { ok: true; timestamp: number }
    | { ok: false; reason: string }

/**
 * Verify a Stripe-Signature header against the raw request body.
 *
 * Three things here are easy to get subtly wrong and expensive to debug:
 *
 *   - the HMAC key is the literal `whsec_...` string, prefix included and not decoded;
 *   - the signed payload is `${timestamp}.${rawBody}`, so the body must be the exact bytes
 *     Stripe sent, never a re-serialised object;
 *   - the header may carry several v1 values at once while an endpoint secret is being
 *     rotated, and rejecting all but the first breaks payments mid-rotation.
 *
 * `nowMs` is injectable so the tolerance window is testable without waiting five minutes.
 */
export const verifyWebhookSignature = async (
    rawBody: string,
    header: string | undefined,
    secret: string,
    toleranceSeconds = 300,
    nowMs: number = Date.now()
): Promise<SignatureVerdict> => {
    if (!header) return { ok: false, reason: 'missing Stripe-Signature header' }
    if (!secret) return { ok: false, reason: 'webhook secret is not configured' }

    let timestampRaw: string | null = null
    const signatures: string[] = []
    for (const part of header.split(',')) {
        const piece = part.trim()
        const eq = piece.indexOf('=')
        if (eq < 0) continue
        const scheme = piece.slice(0, eq)
        const value = piece.slice(eq + 1)
        if (scheme === 't') timestampRaw = value
        else if (scheme === 'v1') signatures.push(value)
    }

    if (!timestampRaw || !/^\d+$/.test(timestampRaw)) {
        return { ok: false, reason: 'no valid timestamp in Stripe-Signature' }
    }
    if (signatures.length === 0) return { ok: false, reason: 'no v1 signature in Stripe-Signature' }

    const timestamp = Number(timestampRaw)
    if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) {
        return { ok: false, reason: 'timestamp outside the tolerance window' }
    }

    const expected = await hmacSha256Hex(secret, `${timestampRaw}.${rawBody}`)
    for (const candidate of signatures) {
        if (timingSafeEqual(expected, candidate)) return { ok: true, timestamp }
    }
    return { ok: false, reason: 'no signature matched' }
}

/** Build a valid header for a payload. Only used by checks - never call this on real input. */
export const signPayloadForTest = async (
    rawBody: string,
    secret: string,
    timestamp: number
): Promise<string> => `t=${timestamp},v1=${await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`

// --- api calls ----------------------------------------------------------------------------

export type StripeResult<T> =
    | { ok: true; data: T }
    | { ok: false; status: number; message: string; code?: string }

const call = async <T>(
    env: CloudflareBindings,
    path: string,
    body: Record<string, unknown>,
    idempotencyKey?: string
): Promise<StripeResult<T>> => {
    const secretKey = env.STRIPE_SECRET_KEY
    if (!secretKey) return { ok: false, status: 503, message: 'STRIPE_SECRET_KEY is not configured' }

    const headers: Record<string, string> = {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
    }
    // Pinning is opt-in. An API version string that does not exist makes every call fail, so
    // unset means the account default - which is stable per account - rather than a guess
    // baked into the source.
    if (env.STRIPE_API_VERSION) headers['Stripe-Version'] = env.STRIPE_API_VERSION
    // Never random: a retried request must reach the same charge, not create a second one.
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

    try {
        const res = await fetch(`${API}${path}`, {
            method: 'POST',
            headers,
            body: formEncode(body),
        })
        const parsed = (await res.json().catch(() => null)) as
            | { error?: { message?: string; code?: string } }
            | null

        if (!res.ok) {
            const message = parsed?.error?.message ?? `Stripe returned ${res.status}`
            console.error(`stripe ${path} -> ${res.status}: ${message}`)
            return { ok: false, status: res.status, message, code: parsed?.error?.code }
        }
        return { ok: true, data: parsed as T }
    } catch (e) {
        console.error(`stripe ${path} threw:`, e)
        return { ok: false, status: 502, message: 'Could not reach Stripe' }
    }
}

export type PaymentIntent = {
    id: string
    status: string
    client_secret: string | null
    amount: number
    currency: string
}

export const createPaymentIntent = (
    env: CloudflareBindings,
    params: {
        amountMinor: number
        currency: string
        metadata: Record<string, string>
        idempotencyKey: string
        description?: string
    }
): Promise<StripeResult<PaymentIntent>> =>
    call<PaymentIntent>(
        env,
        '/payment_intents',
        {
            amount: params.amountMinor,
            currency: params.currency,
            // Card only, deliberately. automatic_payment_methods would offer delayed
            // notification methods like SEPA Direct Debit, where succeeded can arrive days
            // after the quote - so the mint would run against a fee estimated at a price
            // that no longer exists. It also removes every redirect-based method, which is
            // what lets the browser confirm with redirect: 'if_required' and no return page.
            payment_method_types: ['card'],
            metadata: params.metadata,
            description: params.description,
        },
        params.idempotencyKey
    )

export type Refund = { id: string; status: string; amount: number }

/**
 * Refund a payment whose mint can never succeed.
 *
 * The idempotency key is derived from the payment row, so a sweep that runs twice - or a
 * cron tick that overlaps an admin clicking refund - issues one refund, not two.
 */
export const createRefund = (
    env: CloudflareBindings,
    params: { paymentIntentId: string; paymentRowId: string; reason?: string }
): Promise<StripeResult<Refund>> =>
    call<Refund>(
        env,
        '/refunds',
        {
            payment_intent: params.paymentIntentId,
            // The reason is deliberately NOT sent. Stripe compares an idempotent request's
            // parameters against the original and errors when they differ - and the two
            // callers pass different free-text reasons for the same payment, so the retry
            // that matters would have been rejected outright rather than replayed. The reason
            // is already kept on MintJob.lastError and Payment.failureReason, where it is
            // actually readable.
            metadata: { kumule_payment_id: params.paymentRowId },
        },
        `refund:${params.paymentRowId}`
    )
