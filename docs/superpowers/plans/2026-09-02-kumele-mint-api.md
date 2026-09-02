# Kumele Mint API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `POST /api/v1/mint` on this worker (`workerbackend/`), authenticated
with a shared secret, so Kumele's NestJS backend (`api.kumele.com`) — which owns Stripe
for real Kumele orders — can hand this worker an already-paid PaymentIntent and get an
NFT minted. Report the outcome back via a signed callback to
`api.kumele.com/api/v1/web3/mint-callback`.

**Architecture:** Reuse the existing Stripe-rail idempotency stack (`Payment` +
`MintJob`, `@unique` constraints, compare-and-swap claim, deterministic asset address,
cron sweep) rather than building a parallel path. A `Payment.origin` column
(`DIRECT` | `KUMELE_API`) distinguishes rows created by this worker's own standalone
checkout from rows created by an incoming `/api/v1/mint` call; everything downstream of
that column (minting, ownership verification, admin views) is unchanged. The callback is
a new cron-driven sweep, following the exact shape of the existing `backfillMintCosts`
sweep, not a synchronous side effect of the mint itself — minting takes longer than one
HTTP round trip.

**Tech Stack:** Cloudflare Workers, Hono, Prisma over Neon Postgres, Web Crypto
(`crypto.subtle`) for HMAC — no new dependencies.

**Spec:** `docs/kumele-mint-service.md` — the wire contract (request/response shapes,
callback payload, auth scheme) is authoritative there; this plan implements it.

## Global Constraints

- No float touches money. EUR is `Int` minor units; lamports are `BigInt`; nothing here
  divides or multiplies money through a JS `number` except where the existing codebase
  already does (`lamportsToEurMinor`, reused as-is).
- No new npm dependency. HMAC is Web Crypto, already used by `src/stripe.ts`.
- `quantity` other than `1` is rejected 4xx — supporting more is a documented, deliberate
  non-goal (see `docs/kumele-mint-service.md`).
- Every new route this worker exposes must appear in `src/openapi.ts`
  (`openapi-check.ts` fails the build otherwise).
- Every new check file gets added to `check:units` in `package.json` and must pass with
  `cd workerbackend && npm run check:units`.
- Devnet/testnet only. Nothing here touches mainnet.
- Never commit a real secret. `KUMELE_MINT_API_SECRET` is exchanged out of band and set
  via `wrangler secret put`, never written to `.dev.vars.example` beyond a placeholder.

---

### Task 1: Schema — `Payment.origin`/`orderId`, `MintJob.callback*`

**Files:**
- Modify: `workerbackend/prisma/schema.prisma`
- Create: a new Prisma migration under `workerbackend/prisma/migrations/`

**Interfaces:**
- Produces: `PaymentOrigin` enum (`DIRECT` | `KUMELE_API`), `Payment.origin` (default
  `DIRECT`), `Payment.orderId` (`String?  @unique`), `MintJob.callbackSentAt`
  (`DateTime?`), `MintJob.callbackAttempts` (`Int @default(0)`),
  `MintJob.callbackLastError` (`String?`). Every later task in this plan reads/writes
  these exact field names.

- [ ] **Step 1: Add the enum and fields**

In `workerbackend/prisma/schema.prisma`, add the enum near the existing
`PaymentStatus`/`MintJobStatus` enums:

```prisma
enum PaymentOrigin {
  DIRECT      // this worker's own quote -> intent -> Stripe -> webhook flow
  KUMELE_API  // Kumele's backend already collected payment; called POST /api/v1/mint
}
```

In `model Payment`, add two fields (after `status`, before `currency` is fine — Prisma
field order doesn't matter functionally, keep it readable):

```prisma
  origin  PaymentOrigin @default(DIRECT) @map("origin")
  // Kumele's own order id. Null for DIRECT rows. Unique so a duplicate /api/v1/mint
  // call for the same order can be recognised the same way a duplicate stripePaymentIntentId is.
  orderId String?       @unique @map("order_id")
```

In `model MintJob`, add three fields (after `lockedAt` is fine):

```prisma
  // Set once the Kumele callback for this job's terminal state has been acknowledged
  // (2xx). Null means "not sent yet" or "still retrying" - the sweep in Task 5 reads
  // exactly this column to decide what's left to do.
  callbackSentAt    DateTime? @map("callback_sent_at")
  callbackAttempts  Int       @default(0) @map("callback_attempts")
  callbackLastError String?   @map("callback_last_error")
```

- [ ] **Step 2: Generate the migration**

Run (from `workerbackend/`):

```bash
npx prisma migrate dev --name kumele_mint_api
```

Expected: a new folder under `prisma/migrations/` named
`<timestamp>_kumele_mint_api/migration.sql`, containing `ALTER TYPE`/`ALTER TABLE`
statements for the enum and the five new columns. Review the generated SQL — it should
contain no `DROP` and no `NOT NULL` on an existing populated column (every new column is
either nullable or has a `DEFAULT`).

- [ ] **Step 3: Regenerate the Prisma client**

```bash
npx prisma generate
```

Expected: no errors; `node_modules/.prisma/client` now has `origin`, `orderId` on
`Payment` and the three `callback*` fields on `MintJob`.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: passes (this task touches no `.ts` files yet, so this just confirms the
regenerated client didn't break an existing call site).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
db: add Payment.origin/orderId and MintJob.callback* for the Kumele mint API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CF8wdLRzmYnjD8yjqTCEUG
EOF
)"
```

---

### Task 2: Export three existing internals for reuse

**Files:**
- Modify: `workerbackend/src/stripe.ts:43` (`hmacSha256Hex`), `:57` (`timingSafeEqual`)
- Modify: `workerbackend/src/payments.ts:26` (`VAULT_SAFETY_FACTOR`), `:327` (`kickOff`)

**Interfaces:**
- Produces: `export const hmacSha256Hex = async (secret: string, payload: string): Promise<string>`,
  `export const timingSafeEqual = (a: string, b: string): boolean`,
  `export const VAULT_SAFETY_FACTOR = 3n`,
  `export const kickOff = (c: Context<{ Bindings: CloudflareBindings }>, work: Promise<unknown>): void`.
  Task 3 and Task 5 import all four.

Reuse, not reimplementation: the Kumele mint API needs the exact same HMAC-over-
`${timestamp}.${rawBody}` scheme, the same constant-time compare, the same vault
funding check, and the same "fire the mint and don't block the response on it" helper
that this worker's Stripe path already has, correctly, with the subtle
`c.executionCtx` guard already worked out. Duplicating any of the four risks drifting
from the version that's already been through adversarial review.

- [ ] **Step 1: Export the two HMAC helpers in `src/stripe.ts`**

Change (line 43):

```ts
const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
```

to:

```ts
export const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
```

Change (line 57):

```ts
const timingSafeEqual = (a: string, b: string): boolean => {
```

to:

```ts
export const timingSafeEqual = (a: string, b: string): boolean => {
```

- [ ] **Step 2: Export `VAULT_SAFETY_FACTOR` and `kickOff` in `src/payments.ts`**

Change (line 26):

```ts
const VAULT_SAFETY_FACTOR = 3n
```

to:

```ts
export const VAULT_SAFETY_FACTOR = 3n
```

Change (line 327):

```ts
const kickOff = (c: Context<{ Bindings: CloudflareBindings }>, work: Promise<unknown>): void => {
```

to:

```ts
export const kickOff = (c: Context<{ Bindings: CloudflareBindings }>, work: Promise<unknown>): void => {
```

- [ ] **Step 3: Typecheck and run the existing Stripe/payment checks**

```bash
npm run typecheck
npx tsx stripe-check.ts
npx tsx payment-flows-check.ts
```

Expected: all pass unchanged — this task only widens visibility, it changes no
behaviour.

- [ ] **Step 4: Commit**

```bash
git add src/stripe.ts src/payments.ts
git commit -m "$(cat <<'EOF'
refactor: export hmacSha256Hex, timingSafeEqual, VAULT_SAFETY_FACTOR, kickOff

The Kumele mint API (next commit) reuses all four rather than reimplementing
Stripe-webhook-grade HMAC verification and the executionCtx guard from scratch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CF8wdLRzmYnjD8yjqTCEUG
EOF
)"
```

---

### Task 3: `POST /api/v1/mint` — auth, validation, idempotent handler

**Files:**
- Create: `workerbackend/src/kumeleMint.ts`
- Create: `workerbackend/kumele-mint-check.ts`
- Test: `workerbackend/kumele-mint-check.ts` (this codebase's checks live at repo root,
  not under `src/` — see `mintjob-check.ts`, `stripe-check.ts` for the existing
  pattern)

**Interfaces:**
- Consumes: `hmacSha256Hex`, `timingSafeEqual` (`./stripe`), `VAULT_SAFETY_FACTOR`,
  `kickOff` (`./payments`), `isSolanaAddress` (`./chains`), `quoteMintFee`,
  `assetBytesFor`, `utf8Bytes`, `MAX_NAME_BYTES`, `MAX_URI_BYTES` (`./web3fees`),
  `platformSigner`, `runMintJob` (`./mintjob`), `getBalance` (`./solana`),
  `withPrisma`, `getConnectionString` (`./db`).
- Produces: `export const mintFromKumele = async (c: Context<{ Bindings: CloudflareBindings }>) => ...`
  (the Hono handler, mounted in Task 4), plus three pure functions Task 5 and the check
  file both need: `export const verifyMintApiSignature`, `export const validateMintRequest`,
  `export const mintApiResponseFor`.

- [ ] **Step 1: Write the failing check for the pure auth/validation functions**

Create `workerbackend/kumele-mint-check.ts`:

```ts
// Asserts for src/kumeleMint.ts. Run: npx tsx kumele-mint-check.ts
//
// No DB, no network for this half of the file: verifyMintApiSignature, validateMintRequest
// and mintApiResponseFor are pure, the same way verifyWebhookSignature and quoteMintFee
// are pure - so the auth and validation logic for a real-money endpoint is checked without
// standing up Postgres or a stub RPC.

import {
    verifyMintApiSignature,
    validateMintRequest,
    mintApiResponseFor,
} from './src/kumeleMint'

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

const SECRET = 'test-shared-secret'
const RECIPIENT = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'

async function run() {
    // --- verifyMintApiSignature -----------------------------------------------------
    const body = '{"payment_intent_id":"pi_1"}'
    const ts = Math.floor(Date.now() / 1000)
    const hmacKey = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(`${ts}.${body}`))
    const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')

    const valid = await verifyMintApiSignature(body, `sha256=${hex}`, String(ts), SECRET)
    eq('valid signature accepted', valid.ok, true)

    const tampered = await verifyMintApiSignature(body + 'x', `sha256=${hex}`, String(ts), SECRET)
    eq('tampered body rejected', tampered.ok, false)

    const wrongSecret = await verifyMintApiSignature(body, `sha256=${hex}`, String(ts), 'not-the-secret')
    eq('wrong secret rejected', wrongSecret.ok, false)

    const stale = await verifyMintApiSignature(body, `sha256=${hex}`, String(ts - 400), SECRET)
    eq('stale timestamp rejected', stale.ok, false)

    const missing = await verifyMintApiSignature(body, undefined, String(ts), SECRET)
    eq('missing signature header rejected', missing.ok, false)

    const malformed = await verifyMintApiSignature(body, 'not-sha256-prefixed', String(ts), SECRET)
    eq('malformed signature header rejected', malformed.ok, false)

    // --- validateMintRequest ---------------------------------------------------------
    const goodInput = {
        payment_intent_id: 'pi_1',
        order_id: 'ord_1',
        chain: 'solana',
        recipient_wallet: RECIPIENT,
        quantity: 1,
        name: 'Test Asset',
        metadata_uri: 'https://example.com/m.json',
    }
    const goodResult = validateMintRequest(goodInput)
    eq('valid input accepted', goodResult.ok, true)

    eq(
        'quantity != 1 rejected',
        validateMintRequest({ ...goodInput, quantity: 2 }).ok,
        false
    )
    eq(
        'unsupported chain rejected',
        validateMintRequest({ ...goodInput, chain: 'ethereum' }).ok,
        false
    )
    eq(
        'invalid wallet rejected',
        validateMintRequest({ ...goodInput, recipient_wallet: 'not-a-wallet' }).ok,
        false
    )
    eq(
        'missing payment_intent_id rejected',
        validateMintRequest({ ...goodInput, payment_intent_id: '' }).ok,
        false
    )
    eq(
        'name over byte limit rejected',
        validateMintRequest({ ...goodInput, name: 'x'.repeat(200) }).ok,
        false
    )

    // --- mintApiResponseFor -----------------------------------------------------------
    eq(
        'PENDING maps to 202 mint_pending',
        mintApiResponseFor({ status: 'PENDING' } as any),
        { httpStatus: 202, body: { status: 'mint_pending' } }
    )
    eq(
        'MINTING maps to 202 mint_pending',
        mintApiResponseFor({ status: 'MINTING' } as any),
        { httpStatus: 202, body: { status: 'mint_pending' } }
    )
    eq(
        'MINTED maps to 200 minted with address+signature',
        mintApiResponseFor({
            status: 'MINTED', mintAddress: 'ADDR', txSignature: 'SIG',
        } as any),
        { httpStatus: 200, body: { status: 'minted', mint_address: 'ADDR', tx_signature: 'SIG' } }
    )
    eq(
        'BLOCKED maps to 200 mint_failed with reason',
        mintApiResponseFor({ status: 'BLOCKED', lastError: 'squatted address' } as any),
        { httpStatus: 200, body: { status: 'mint_failed', reason: 'squatted address' } }
    )

    console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
    process.exit(failures === 0 ? 0 : 1)
}

run()
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx tsx kumele-mint-check.ts
```

Expected: fails immediately with a module-not-found error for `./src/kumeleMint` — it
doesn't exist yet.

- [ ] **Step 3: Write `src/kumeleMint.ts`**

```ts
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
```

- [ ] **Step 4: Run the check again**

```bash
npx tsx kumele-mint-check.ts
```

Expected: `all passed`, every `ok` line green, `failures === 0`.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: passes. If `CloudflareBindings` complains about `KUMELE_MINT_API_SECRET` not
existing, that's Task 4's `cf-typegen` step — fine to see here, must be gone by the end
of Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/kumeleMint.ts kumele-mint-check.ts
git commit -m "$(cat <<'EOF'
feat: add Kumele mint API auth, validation, and idempotent handler

Not yet mounted - src/index.ts wiring and env plumbing land in the next
commit so this one stays reviewable as pure logic plus its check.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CF8wdLRzmYnjD8yjqTCEUG
EOF
)"
```

---

### Task 4: Mount the route, wire config, document it

**Files:**
- Modify: `workerbackend/src/index.ts:199` (mount point, right after the Stripe webhook)
- Modify: `workerbackend/.dev.vars.example`
- Modify: `workerbackend/src/openapi.ts`
- Modify: `workerbackend/package.json` (`check:units`)
- Modify: `workerbackend/worker-configuration.d.ts` (via `cf-typegen`, not by hand)

**Interfaces:**
- Consumes: `mintFromKumele` from `./kumeleMint` (Task 3).

- [ ] **Step 1: Mount the route in `src/index.ts`**

Right after line 199 (`app.post('/api/v1/stripe/webhook', stripeWebhook)`), add the
import near the other `payments`-family imports (around line 63-68) and the route:

```ts
import { mintFromKumele } from './kumeleMint'
```

```ts
app.post('/api/v1/mint', mintFromKumele)
```

- [ ] **Step 2: Add the env vars to `.dev.vars.example`**

Append to the `# --- stripe rail` section (or a new `# --- kumele integration` section
right after it) in `workerbackend/.dev.vars.example`:

```
# --- kumele integration --------------------------------------------------------

# Shared secret for POST /api/v1/mint. Kumele's backend signs its request with this;
# this worker verifies with the same key, same HMAC-SHA256-over-timestamp.body
# construction as the Stripe webhook check above. /api/v1/mint 503s without it.
#
# Exchanged with Kumele out of band - never in a commit, a chat log, or this file
# beyond this placeholder.
# KUMELE_MINT_API_SECRET="generate-a-long-random-value"

# Where the signed mint-outcome callback is POSTed once a job reaches a terminal
# state. The cron sweep logs and skips callback delivery, rather than failing the
# whole sweep, when this is unset.
# KUMELE_CALLBACK_URL="https://api.kumele.com/api/v1/web3/mint-callback"
```

- [ ] **Step 3: Regenerate Cloudflare Worker types**

```bash
npm run cf-typegen
```

Expected: `worker-configuration.d.ts` gains `KUMELE_MINT_API_SECRET?: string` and
`KUMELE_CALLBACK_URL?: string` on `CloudflareBindings`. This is generated from
`wrangler.jsonc`'s `vars` plus declared secrets — if it doesn't pick the new names up
automatically, add them under `vars` in `wrangler.jsonc` as empty-string placeholders
the same way `STRIPE_SECRET_KEY` is declared there, then rerun.

- [ ] **Step 4: Document the route in `src/openapi.ts`**

Add a new path entry near the existing `/api/v1/stripe/webhook` entry, following the
file's existing shape (look at how that entry is written for the exact structure — it
uses `security`, `requestBody`, `responses` keys). Add:

```ts
'/api/v1/mint': {
    post: {
        summary: 'Kumele backend hands off a paid order to be minted',
        description: [
            'Called by api.kumele.com after IT has collected payment on its own Stripe',
            'integration. Authenticated with X-Kumele-Signature / X-Kumele-Timestamp,',
            'HMAC-SHA256 over `${timestamp}.${rawBody}` with a shared secret - see',
            'docs/kumele-mint-service.md for the full contract. Idempotent on',
            'payment_intent_id: a repeated call never mints twice.',
        ].join(' '),
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['payment_intent_id', 'order_id', 'chain', 'recipient_wallet', 'quantity', 'name', 'metadata_uri'],
                        properties: {
                            payment_intent_id: { type: 'string' },
                            order_id: { type: 'string' },
                            chain: { type: 'string', enum: ['solana'] },
                            recipient_wallet: { type: 'string' },
                            quantity: { type: 'integer', enum: [1] },
                            name: { type: 'string' },
                            metadata_uri: { type: 'string' },
                        },
                    },
                },
            },
        },
        responses: {
            '202': { description: 'Mint queued or already in flight' },
            '200': { description: 'Replay: reports the existing minted or permanently-failed state' },
            '400': { description: 'Invalid request body' },
            '401': { description: 'Signature verification failed' },
            '503': { description: 'Not configured, or the platform vault cannot fund this mint' },
        },
    },
},
```

- [ ] **Step 5: Add the check to `check:units`**

In `workerbackend/package.json`, extend the `check:units` script's loop list to include
`kumele-mint`:

```json
"check:units": "for c in security audit burn escrow mint auth-parity openapi searchnftbyasset searchnftbyowner nfts-price admin-range chains stripe web3fees mintjob flags stripe-mock db-flows payment-flows kumele-mint; do echo \"--- $c ---\"; tsx \"$c-check.ts\" || exit 1; done",
```

- [ ] **Step 6: Run the full check suite**

```bash
npm run check
```

Expected: typecheck passes, `wrangler deploy --dry-run` passes, every check in
`check:units` prints `all passed`, including `openapi-check.ts` (confirms
`/api/v1/mint` is now documented) and `kumele-mint-check.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts .dev.vars.example src/openapi.ts package.json worker-configuration.d.ts
git commit -m "$(cat <<'EOF'
feat: mount POST /api/v1/mint, wire config, document in openapi.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CF8wdLRzmYnjD8yjqTCEUG
EOF
)"
```

---

### Task 5: Outbound callback — sign, send, retry via cron

**Files:**
- Modify: `workerbackend/src/kumeleMint.ts` (append)
- Modify: `workerbackend/src/payments.ts` (`scheduled`, around line 620-635)
- Modify: `workerbackend/src/config.ts` (new constant)
- Modify: `workerbackend/kumele-mint-check.ts` (append)

**Interfaces:**
- Consumes: `hmacSha256Hex` (`./stripe`), `withPrisma`.
- Produces: `export const buildCallbackPayload`, `export const signCallback`,
  `export const sendMintCallbacks`. `payments.ts`'s `scheduled()` calls
  `sendMintCallbacks`.

- [ ] **Step 1: Add the failing check cases first**

Append to `workerbackend/kumele-mint-check.ts`, inside `run()` before the final
`console.log(failures === 0 ...)` line:

```ts
    // --- buildCallbackPayload / signCallback -----------------------------------------
    const mintedPayment = {
        stripePaymentIntentId: 'pi_1', orderId: 'ord_1',
    }
    const mintedJob = {
        status: 'MINTED', mintAddress: 'ADDR', txSignature: 'SIG',
        ownerAddress: RECIPIENT, updatedAt: new Date('2026-09-02T12:00:00Z'), lastError: null,
    }
    const mintedPayload = buildCallbackPayload(mintedPayment as any, mintedJob as any)
    eq('minted callback payload shape', mintedPayload, {
        payment_intent_id: 'pi_1',
        order_id: 'ord_1',
        status: 'minted',
        mint_address: 'ADDR',
        tx_signature: 'SIG',
        recipient_wallet: RECIPIENT,
        chain: 'solana',
        occurred_at: '2026-09-02T12:00:00.000Z',
        failure_reason: null,
    })

    const failedJob = {
        status: 'BLOCKED', mintAddress: null, txSignature: null,
        ownerAddress: RECIPIENT, updatedAt: new Date('2026-09-02T12:00:00Z'), lastError: 'squatted address',
    }
    const failedPayload = buildCallbackPayload(mintedPayment as any, failedJob as any)
    eq('mint_failed callback payload shape', failedPayload, {
        payment_intent_id: 'pi_1',
        order_id: 'ord_1',
        status: 'mint_failed',
        mint_address: null,
        tx_signature: null,
        recipient_wallet: RECIPIENT,
        chain: 'solana',
        occurred_at: '2026-09-02T12:00:00.000Z',
        failure_reason: 'squatted address',
    })

    const rawPayload = JSON.stringify(mintedPayload)
    const { header, timestamp } = await signCallback(rawPayload, SECRET)
    const verified = await verifyMintApiSignature(rawPayload, header, String(timestamp), SECRET)
    eq('a callback this worker signs verifies against the same secret', verified.ok, true)
```

Add the two new imports at the top of `kumele-mint-check.ts`:

```ts
import {
    verifyMintApiSignature,
    validateMintRequest,
    mintApiResponseFor,
    buildCallbackPayload,
    signCallback,
} from './src/kumeleMint'
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx tsx kumele-mint-check.ts
```

Expected: fails — `buildCallbackPayload` and `signCallback` aren't exported yet.

- [ ] **Step 3: Add the callback constant to `src/config.ts`**

Append near `MAX_MINT_ATTEMPTS`:

```ts
/**
 * How many times the Kumele callback is retried before giving up and logging for manual
 * reconciliation. The sweep runs every five minutes, so 10 spans roughly 50 minutes -
 * long enough to ride out a brief outage on Kumele's side without silently losing the
 * fact that a mint succeeded or failed.
 */
export const MAX_CALLBACK_ATTEMPTS = 10
```

- [ ] **Step 4: Append the callback functions to `src/kumeleMint.ts`**

Add these imports at the top (alongside the existing ones):

```ts
import { withPrisma, getConnectionString } from './db'
import { hmacSha256Hex } from './stripe'
import { MAX_CALLBACK_ATTEMPTS } from './config'
```

(`withPrisma`/`getConnectionString` are already imported at the top of the file from
Task 3 — don't duplicate the import line, just confirm they're there.)

Append to the bottom of `src/kumeleMint.ts`:

```ts
// --- outbound callback ---------------------------------------------------------------------

type CallbackPayment = { stripePaymentIntentId: string | null; orderId: string | null }
type CallbackJob = {
    status: string
    mintAddress: string | null
    txSignature: string | null
    ownerAddress: string
    updatedAt: Date
    lastError: string | null
}

/** Pure, so the shape sent to Kumele is pinned without a network call. */
export const buildCallbackPayload = (payment: CallbackPayment, job: CallbackJob) => ({
    payment_intent_id: payment.stripePaymentIntentId,
    order_id: payment.orderId,
    status: job.status === 'MINTED' ? 'minted' : 'mint_failed',
    mint_address: job.mintAddress,
    tx_signature: job.txSignature,
    recipient_wallet: job.ownerAddress,
    chain: 'solana',
    occurred_at: job.updatedAt.toISOString(),
    failure_reason: job.status === 'MINTED' ? null : job.lastError,
})

/** Same construction this worker verifies incoming requests with, used the other direction. */
export const signCallback = async (
    rawBody: string,
    secret: string,
    timestamp: number = Math.floor(Date.now() / 1000)
): Promise<{ header: string; timestamp: number }> => ({
    header: `sha256=${await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`,
    timestamp,
})

/**
 * Cron-driven, not a side effect of the mint itself - minting takes longer than one HTTP
 * round trip, and this follows the same shape as backfillMintCosts (mintjob.ts:664): a
 * sweep that finds rows in a known state and advances them, independent of which code
 * path put them there.
 */
export const sendMintCallbacks = async (
    env: CloudflareBindings,
    connectionString: string,
    maxJobs = 5
): Promise<{ sent: number; failed: number }> => {
    const secret = env.KUMELE_MINT_API_SECRET
    const url = env.KUMELE_CALLBACK_URL
    if (!secret || !url) {
        console.log('[KUMELE-CALLBACK] not configured; skipping')
        return { sent: 0, failed: 0 }
    }

    const due = await withPrisma(connectionString, (prisma) =>
        prisma.mintJob.findMany({
            where: {
                callbackSentAt: null,
                callbackAttempts: { lt: MAX_CALLBACK_ATTEMPTS },
                status: { in: ['MINTED', 'BLOCKED', 'FAILED', 'REFUNDED'] },
                payment: { origin: 'KUMELE_API' },
            },
            include: { payment: true },
            take: maxJobs,
            orderBy: { updatedAt: 'asc' },
        })
    )

    let sent = 0
    let failed = 0

    for (const job of due) {
        const payload = buildCallbackPayload(job.payment, job)
        const rawBody = JSON.stringify(payload)
        const { header, timestamp } = await signCallback(rawBody, secret)

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Kumele-Signature': header,
                    'X-Kumele-Timestamp': String(timestamp),
                },
                body: rawBody,
            })

            if (res.ok) {
                await withPrisma(connectionString, (prisma) =>
                    prisma.mintJob.update({ where: { id: job.id }, data: { callbackSentAt: new Date() } })
                )
                sent++
            } else {
                const reason = `HTTP ${res.status}`
                await withPrisma(connectionString, (prisma) =>
                    prisma.mintJob.update({
                        where: { id: job.id },
                        data: { callbackAttempts: { increment: 1 }, callbackLastError: reason },
                    })
                )
                failed++
                if (job.callbackAttempts + 1 >= MAX_CALLBACK_ATTEMPTS) {
                    console.error(`[KUMELE-CALLBACK] giving up on job ${job.id} after ${MAX_CALLBACK_ATTEMPTS} attempts: ${reason}`)
                }
            }
        } catch (e: any) {
            const reason = e?.message ?? String(e)
            await withPrisma(connectionString, (prisma) =>
                prisma.mintJob.update({
                    where: { id: job.id },
                    data: { callbackAttempts: { increment: 1 }, callbackLastError: reason.slice(0, 500) },
                })
            )
            failed++
        }
    }

    return { sent, failed }
}
```

- [ ] **Step 5: Wire it into the cron in `src/payments.ts`**

Find the `scheduled` function (around line 610-635, where `sweepMintJobs` and
`backfillMintCosts` are called). Add the import at the top:

```ts
import { sendMintCallbacks } from './kumeleMint'
```

Add a third call, matching the existing `.catch`-wrapped pattern for `backfillMintCosts`
(read the exact surrounding lines before editing — insert right after the
`backfillMintCosts` call, same style):

```ts
    await sendMintCallbacks(env, connectionString).catch((e) =>
        console.error('[CRON] sendMintCallbacks failed:', e)
    )
```

- [ ] **Step 6: Run the check**

```bash
npx tsx kumele-mint-check.ts
```

Expected: `all passed`.

- [ ] **Step 7: Typecheck and full unit suite**

```bash
npm run typecheck
npm run check:units
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/kumeleMint.ts src/payments.ts src/config.ts kumele-mint-check.ts
git commit -m "$(cat <<'EOF'
feat: sign and send the Kumele mint-outcome callback from the cron sweep

Cron-driven rather than synchronous with the mint, matching the shape of
the existing backfillMintCosts sweep - minting outlasts one HTTP round trip.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CF8wdLRzmYnjD8yjqTCEUG
EOF
)"
```

---

### Task 6: End-to-end smoke test against a running worker

Not unit-testable — this exercises the real Neon database, a real (devnet) mint, and an
HTTP round trip this worker makes itself. Run manually before calling the feature done.

**Files:** none (verification only).

- [ ] **Step 1: Start a local stub for the Kumele callback receiver**

```bash
npx --yes http-echo-server 8899 &   # or any tool that logs a received POST body; kill it when done
```

(Any throwaway local HTTP listener that prints the request works — this just needs to
observe the callback fire with a valid signature.)

- [ ] **Step 2: Run the worker locally with the new env set**

In `workerbackend/.dev.vars` (git-ignored, not `.example`):

```
KUMELE_MINT_API_SECRET="local-test-secret"
KUMELE_CALLBACK_URL="http://localhost:8899/callback"
```

```bash
wrangler dev --local --test-scheduled
```

- [ ] **Step 3: Sign and send a real request**

```bash
BODY='{"payment_intent_id":"pi_smoke_1","order_id":"ord_smoke_1","chain":"solana","recipient_wallet":"F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F","quantity":1,"name":"Smoke Test","metadata_uri":"https://example.com/m.json"}'
TS=$(date +%s)
SECRET="local-test-secret"
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -s -X POST http://localhost:8787/api/v1/mint \
  -H "Content-Type: application/json" \
  -H "X-Kumele-Signature: sha256=$SIG" \
  -H "X-Kumele-Timestamp: $TS" \
  -d "$BODY"
```

Expected: `{"status":"mint_pending"}`, HTTP 202.

- [ ] **Step 4: Confirm the mint actually lands**

```bash
curl -s "http://localhost:8787/cdn-cgi/handler/scheduled"   # runs the cron sweep manually
```

Repeat every ~10s until `GET /api/admin/payments` (with the admin key) shows the
`ord_smoke_1` row's `mintJob.status` reach `MINTED` on Solana devnet.

- [ ] **Step 5: Confirm the callback fires**

Check the stub receiver's log for a POST to `/callback` carrying
`"status":"minted","mint_address":"...","tx_signature":"..."` and a valid
`X-Kumele-Signature` — verify it by hand with the same `openssl` construction as Step 3,
now against `KUMELE_CALLBACK_URL`'s secret (same shared secret, both directions).

- [ ] **Step 6: Replay the same request**

Re-run Step 3's `curl` verbatim (same `payment_intent_id`). Expected:
`{"status":"minted","mint_address":"...","tx_signature":"..."}`, HTTP 200 — no second
mint job, no second callback delivery attempt (confirm no new POST hits the stub
receiver).

- [ ] **Step 7: Note the outcome**

No commit for this task — it's verification, not a code change. If anything in Steps
3-6 didn't match expectations, that's a bug in Tasks 1-5 to fix and re-verify, not a
reason to adjust this task's expected output.

---

## Self-Review

**Spec coverage** (against `docs/kumele-mint-service.md`):
- `POST /api/v1/mint` contract (auth, body, all five response cases) — Task 3.
- Idempotency via `Payment.stripePaymentIntentId @unique` reused from the standalone
  flow — Task 1 (schema) + Task 3 (P2002 handling).
- Callback contract (URL, headers, payload shape, retry-then-give-up) — Task 5.
- `quantity != 1` rejected — Task 3 (`validateMintRequest`).
- Config additions (`KUMELE_MINT_API_SECRET`, `KUMELE_CALLBACK_URL`) — Task 4.
- `openapi-check.ts` / `check:units` parity — Task 4.
- Real end-to-end proof, not just unit checks — Task 6.

**Placeholder scan:** every code block above is complete, runnable TypeScript or shell —
no `TODO`, no "add validation here", no elided function bodies.

**Type consistency:** `MintRequest`/`ValidationResult` (Task 3) are the only new types
`mintFromKumele` consumes; `CallbackPayment`/`CallbackJob` (Task 5) are structurally
compatible with what Prisma's `payment.mintJob` include actually returns (verified
against the real `Payment`/`MintJob` field names from `prisma/schema.prisma`, not
guessed). `mintApiResponseFor` is called identically from the fresh-accept path
(implicitly, via the literal `{status:'mint_pending'}` for a brand-new 202) and the
replay path (explicitly) in Task 3 — the same function backs both, so they can't drift.
