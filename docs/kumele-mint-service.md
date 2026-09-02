# This service: what it is, what it does, how Kumele's backend calls it

**Naming correction first, because it caused the confusion this doc replaces:** this
worker is deployed under the name `kumele-backend` (`https://kumele-backend.ansht.workers.dev`),
but it is **not** the Kumele backend. It's the **Web3 / minting service** in this
architecture — a Cloudflare Worker (`workerbackend/` in this repo) that owns Solana
minting and, separately, runs its own standalone Stripe→mint flow. The actual Kumele
backend is a separate NestJS API at `api.kumele.com`, owned by a different team, which
owns Stripe, tax, store credit, refunds and accounting for real Kumele orders. The
Worker's name is a holdover from before that split was decided (2026-09-01) and isn't
being renamed mid-flight, since that's a live production URL.

Settled 2026-09-01: **Kumele owns Stripe, this service owns minting.** Kumele's backend
collects payment on its own Stripe integration, then calls in to this service with the
PaymentIntent ID once the charge has cleared. This doc describes both what already
exists here and the new integration surface being built to make that call possible.

## Two things this service does, and why there are two

1. **The standalone flow** — quote → PaymentIntent → this worker's own Stripe webhook →
   mint. Fully built, deployed, proven with real money (see below). Stays exactly as-is;
   nothing here changes it or depends on it going away.
2. **The Kumele-integration flow** — `POST /api/v1/mint`, called by `api.kumele.com`
   after *it* has already collected payment. New; this doc is also its spec.

They share the same database, the same idempotency machinery, and the same mint
executor (`src/mintjob.ts`). They do not share a Stripe webhook — Kumele's Stripe events
go to Kumele's own webhook at `api.kumele.com`, never to this worker. This worker never
sees a Kumele PaymentIntent until Kumele's backend hands it one explicitly via
`POST /api/v1/mint`. That's what makes double-minting structurally impossible rather
than merely unlikely: there's no shared event stream for two systems to race on.

## Proof the standalone flow actually works, not just compiles

`npm run test:spec` — 60 conformance checks against the deployed system, 60/0 last run —
plus 4 real Stripe test-card charges that each produced exactly one NFT on Solana
devnet, 0 stranded.

## Standalone flow, end to end

```
browser                worker                     stripe            solana
   |  quote ------------->|                          |                 |
   |                      |-- rent + priority fee ----------------->|
   |                      |-- SOL/EUR rate --------->(oracle)        |
   |<-- fee + quote_id ---|  persists FeeQuote        |                |
   |  intent ------------>|                           |                |
   |                      |  writes Payment + MintJob |                |
   |                      |-- create PaymentIntent -->|                |
   |<-- client_secret ----|                           |                |
   |  confirm card -------------------------------->|                 |
   |                      |<-- payment_intent.succeeded --            |
   |                      |  job AWAITING_PAYMENT -> PENDING          |
   |                      |-- createV1, platform pays -------------->|
   |  poll -------------->|  Nft row, ownership verified              |
```

**Rule this implements:** Stripe handles payment (either this worker's own Stripe
integration for the standalone flow, or Kumele's for the integration flow). Web3 handles
minting and ownership. The frontend only shows a price breakdown and receives a client
secret — it never sees a Solana key, a Helius key, or a treasury wallet.

## Endpoints

```
GET  /api/v1/web3/fees/quote?operation=nft_mint&chain=solana&quantity=1   -- standalone flow
POST /api/v1/payments/intent      { quoteId, ownerAddress, name, metadataUri }  -- standalone flow
GET  /api/v1/payments/:paymentId                                          -- standalone flow
POST /api/v1/stripe/webhook       -- Stripe -> this worker, signature-verified, standalone flow only
POST /api/v1/mint                 -- Kumele -> this worker, shared-secret signed, NEW, see below
GET  /api/admin/payments          -- adminAuth
POST /api/admin/payments/:paymentId/refund   -- adminAuth
GET  /api/chains                  -- includes features.directCrypto
```

### Fee quote — exact response, `src/web3fees.ts`

```json
{
  "quote_id": "uuid",
  "operation": "nft_mint",
  "chain": "solana",
  "currency": "eur",
  "quantity": 1,
  "fee_payer": "kumele_platform_wallet",
  "charged_to_user": true,
  "estimated_network_fee": { "lamports": 3614960, "sol": "0.00361496" },
  "estimated_fee_minor": 48,
  "display_amount": "€0.48",
  "label": "NFT minting fee",
  "expires_at": "2026-...Z",
  "source": "helius_priority_fee_estimate",
  "confidence": "estimated"
}
```

Cost model, in the order the numbers matter:

| Component | Amount | Source |
|---|---|---|
| MPL Core protocol fee | **1,500,000 lamports** | Metaplex's flat fee to create a Core asset. Not rent, not a tx fee — it lands in the asset account on top of rent. Nothing on-chain documents it; found by diffing a real fee payer's balance across a real devnet mint. |
| Rent exemption | ~1,700,000 lamports | `getMinimumBalanceForRentExemption` for the asset account size, queried live, never guessed |
| Priority fee | 10,000 lamports | What `withPriorityFees` actually attaches (50,000 µ-lamports × 200,000 CU) |
| Signature fee | 10,000 lamports | 5,000 × 2 signatures (fee payer + new asset keypair) |

SOL→EUR rate: Binance, then Kraken, then CoinGecko, tried in order. Parsed as a
**decimal string**, never `res.json()`. Stored as an integer scaled by 1e8 on the
`FeeQuote` row it priced. Every downstream computation is BigInt or scaled-integer math,
ceiling-rounded in the platform's favor.

## The Kumele-integration flow (new)

Kumele's PaymentIntent has already succeeded on Kumele's own Stripe integration by the
time this endpoint is called. Nothing here takes payment; it only mints and reports
back.

### `POST /api/v1/mint`

Auth: `X-Kumele-Signature: sha256=<hex>` and `X-Kumele-Timestamp: <unix seconds>`,
HMAC-SHA256 over `${timestamp}.${rawBody}` with a shared secret
(`KUMELE_MINT_API_SECRET`), constant-time compared, 300s tolerance — the exact scheme
this worker already uses to verify Stripe's own webhook signature
(`src/stripe.ts:hmacSha256Hex`/`timingSafeEqual`), reused rather than reinvented.

`Idempotency-Key` header, if sent, must equal `payment_intent_id` in the body or the
request is rejected — it's informational on this side (the real idempotency key is the
`Payment.stripePaymentIntentId` unique constraint below), but a mismatch means the
caller's own retry logic disagrees with its own payload, which is worth refusing rather
than silently accepting.

Request body:

```json
{
  "payment_intent_id": "pi_...",
  "order_id": "kum_order_...",
  "chain": "solana",
  "recipient_wallet": "F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F",
  "quantity": 1,
  "name": "...",
  "metadata_uri": "https://..."
}
```

`quantity` must be `1`. This worker's idempotency guarantee (`MintJob.paymentId
@unique`) is one payment → one mint job; supporting more means a schema change
(`@@unique([paymentId, index])`) that isn't built. `quantity != 1` is rejected 4xx now
rather than silently minting one and dropping the rest.

`chain` must be `"solana"` — the only chain this worker mints on the platform's own
wallet. Anything else is a 4xx.

Responses:

| Case | Status | Body |
|---|---|---|
| Accepted, mint queued | 202 | `{"status":"mint_pending"}` |
| Replay, still in flight | 202 | `{"status":"mint_pending"}` |
| Replay, already minted | 200 | `{"status":"minted","mint_address":"...","tx_signature":"..."}` |
| Replay, permanently failed | 200 | `{"status":"mint_failed","reason":"..."}` |
| Bad auth | 401 | `{"error":"..."}` |
| Bad input (validation) | 400 | `{"error":"...","code":"..."}` |
| Vault can't fund this mint | 503 | `{"error":"...","code":"vault_unfunded"}` — retryable |
| DB unreachable | 500 | `{"error":"..."}` — retryable |

A repeated `payment_intent_id` never creates a second `Payment`/`MintJob` row — it hits
the same `Payment.stripePaymentIntentId @unique` constraint the standalone flow already
relies on, and the handler reads the existing row's current state back instead of
minting again.

### Callback: `POST https://api.kumele.com/api/v1/web3/mint-callback`

Sent once a mint job reaches a terminal state (`MINTED`, or a permanent failure —
`BLOCKED`/`FAILED`/`REFUNDED`), from the cron sweep (every 5 minutes) rather than
synchronously from the request that queued it, because minting takes longer than one
HTTP round trip. Same signature scheme as above, computed with this worker's own key
over its own outbound body: `X-Kumele-Signature: sha256=<hex>`,
`X-Kumele-Timestamp`, HMAC-SHA256 over `${timestamp}.${rawBody}`.

```json
{
  "payment_intent_id": "pi_...",
  "order_id": "kum_order_...",
  "status": "minted",
  "mint_address": "...",
  "tx_signature": "...",
  "recipient_wallet": "...",
  "chain": "solana",
  "occurred_at": "2026-09-02T12:00:00Z",
  "failure_reason": null
}
```

`status` is `"minted"` or `"mint_failed"` (`failure_reason` set only in the latter
case). Delivery retries on non-2xx/timeout with backoff, capped, then gives up loudly
(logged for manual reconciliation) rather than retrying forever. Replays are expected
and must be handled idempotently on Kumele's side, same as this worker already treats
Stripe's own redelivery as normal rather than exceptional.

### PaymentIntent — Stripe metadata set on every intent (standalone flow only)

```
requires_nft_mint         = "true"
nft_minting_fee_minor     = <int>
nft_minting_fee_quote_id  = <uuid>
nft_minting_fee_label     = "NFT minting fee"
nft_chain                 = "solana"
```

`totalAmountMinor = baseAmountMinor + taxAmountMinor + mintFeeMinor`, computed
server-side. Stripe metadata is for the dashboard and reconciliation only — the webhook
re-reads the job from Postgres by `stripePaymentIntentId` and never trusts a number that
arrived on the Stripe event. Not used by the Kumele-integration flow, which never
creates a PaymentIntent — Kumele already has one before this service is called.

## Database (Postgres/Neon, owned by this worker)

```prisma
enum PaymentStatus  { REQUIRES_PAYMENT PAID FAILED REFUNDED }
enum MintJobStatus  { AWAITING_PAYMENT PENDING MINTING MINTED FAILED BLOCKED REFUNDED }
enum PaymentOrigin  { DIRECT KUMELE_API }   // NEW — which flow created this row

model FeeQuote {
  id, operation, chain, quantity, currency
  networkFeeLamports BigInt   // sig + priority + rent, already x quantity
  assetBytes         Int      // size the rent was quoted for
  rateScaled         BigInt   // EUR/SOL x 1e8, integer
  estimatedFeeMinor  Int
  source, confidence, expiresAt
}

model Payment {
  id
  stripePaymentIntentId String? @unique   // nullable: row written BEFORE Stripe is called
  status PaymentStatus
  origin PaymentOrigin @default(DIRECT)   // NEW — DIRECT = standalone flow, KUMELE_API = /api/v1/mint
  orderId String? @unique                 // NEW — Kumele's own order id, for their reconciliation
  baseAmountMinor, taxAmountMinor, mintFeeMinor, totalAmountMinor  Int  // 0 on KUMELE_API rows: this worker charged nothing, Kumele did
  quoteId String? @unique
  stripeRefundId, failureReason, paidAt
}

model MintJob {
  id
  paymentId String @unique               // one payment -> exactly one mint job, either flow
  status MintJobStatus
  attempts Int
  ownerAddress, name, metadataUri        // captured before minting starts
  mintAddress String? @unique            // HMAC-SHA256(MINT_ASSET_SEED, paymentId), written at claim time before send
  seedVersion Int
  txSignature String? @unique
  estimatedFeeMinor Int
  actualFeeLamports BigInt?              // fee payer's real balance delta, not meta.fee alone
  ownershipVerified Boolean
  ownershipSource String?                // "das" | "account_read"
  nftId String? @unique
  lockedAt DateTime?                     // lease so a crashed isolate doesn't wedge the row forever
  callbackSentAt DateTime?               // NEW — set once the Kumele callback is acked
  callbackAttempts Int @default(0)       // NEW
  callbackLastError String?              // NEW
}
```

`Transaction` still records the chain side of every mint (kind `MINT`, currency `SOL`,
amount = lamports actually spent) so the existing audit endpoint and admin dashboard keep
working unmodified, for jobs from either flow. `Payment` is a separate table because
Stripe truth and chain truth have different lifecycles, not because
`Transaction.currency` can't hold `"eur"` — it's a nullable string and could; that just
isn't the reason for the split.

## Idempotency — one payment cannot mint twice, either flow

Three independent layers, because this is the requirement that costs real money if wrong:

1. **DB constraints.** `Payment.stripePaymentIntentId` and `MintJob.paymentId` are both
   `@unique`. One payment — Stripe-created here or handed in by Kumele — can only ever
   own one mint job. A duplicate `/api/v1/mint` call or a duplicate webhook hits a
   unique-constraint violation, not a second mint.
2. **Claim (compare-and-swap).**
   `updateMany({ where: { status: 'PENDING' or (status: 'MINTING' AND lockedAt stale) }, data: { status: 'MINTING' } })`.
   `count === 0` means another worker or cron tick already has it; this invocation returns
   without doing anything. There's no `$transaction` anywhere in this codebase (Prisma over
   Neon, a fresh client per call) — a single-row conditional update is the only atomicity
   primitive it has, and it's sufficient.
3. **Chain.** The asset keypair is deterministic:
   `seed = HMAC-SHA256(MINT_ASSET_SEED, paymentId)` → `createKeypairFromSeed(seed)`,
   written to `mintAddress` **at claim time, before the send**. A retry re-derives the same
   address. Existence is checked with `fetchAsset` (a real MPL Core asset read), *not*
   `getAccountInfo` — a 1-lamport dust send to the derived address would satisfy
   `getAccountInfo` and make the runner falsely conclude "already minted, done," with the
   buyer charged and nothing minted.

A Cron Trigger (`*/5 * * * *`) sweeps stuck jobs, refunds through Stripe once a
standalone-flow job exhausts its retry attempts, and (new) sends the Kumele callback for
any terminal `KUMELE_API`-origin job that hasn't been acknowledged yet. The webhook's/
mint endpoint's `waitUntil` is the fast path; cron is the guarantee.

## What NOT to re-derive

Each of these was a real bug here at some point and is fixed in this codebase:

- The MPL Core protocol fee (1,500,000 lamports) is real and is not rent — omitting it
  under-quotes every mint by about a third.
- `charge.refunded` webhook events carry a **Charge** object, not a PaymentIntent —
  reading `object.id` directly silently no-ops the whole refund handler.
- Refund-before-asking-the-chain hands the buyer both the money back *and* the asset if
  the mint actually landed. The cap/refund decision has to happen strictly after reading
  the chain state, never before.
- `getBalance` at `finalized` commitment reads a freshly funded vault as empty right
  after funding — use a commitment that reflects a just-landed transfer, or the
  pre-flight balance check false-positives into a 503.
- Never forward a raw Stripe error string to any caller — it can contain masked key
  material; log it, return an opaque id instead.
- Devnet RPC needs a fallback chain and per-attempt rotation — a single public devnet
  endpoint gets rate-limited or blocked from a Cloudflare IP range in practice, not just
  in theory.

## Config (all backend-only, none reach a client)

Existing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_VERSION`,
`MINT_ASSET_SEED`, `SOLANA_PLATFORM_WALLET_SECRET`, `MINT_SERVICE_PRICE_MINOR`,
`TAX_RATE_BPS`, `MINT_FEE_FLOOR_MINOR`, `FEE_QUOTE_TTL_SECONDS`,
`STRIPE_MIN_CHARGE_MINOR`, `ENABLE_DIRECT_CRYPTO`.

New for the Kumele-integration flow: `KUMELE_MINT_API_SECRET` (shared secret, inbound
auth — `/api/v1/mint` returns 503 without it), `KUMELE_CALLBACK_URL` (where the signed
callback is POSTed — the cron sweep logs and skips, rather than crashing, if unset).

Frontend gets exactly one: `VITE_STRIPE_PUBLISHABLE_KEY`. No Helius key, no mint
authority, no treasury key, no Stripe secret key, no shared secret ever appears in a
response body, an error message, or a frontend bundle.

`ENABLE_DIRECT_CRYPTO` (currently `"true"`, MVP target `"false"`) gates the old
wallet-signed Solana mint and escrow routes behind a 404 without deleting the code —
unrelated to the Kumele integration, left as-is here.

## Build status

The standalone flow (everything above except `POST /api/v1/mint` and the callback) is
live and proven — see "Proof" above. `POST /api/v1/mint`, the shared-secret auth, and
the outbound callback are **not yet built**; this document is their spec as well as a
description of what already exists. Implementation plan:
`docs/superpowers/plans/2026-09-02-kumele-mint-api.md`.

Still open on this side: the shared secret itself needs exchanging out of band (not in
this doc, not in any chat log, not in git). `KUMELE_CALLBACK_URL` needs Kumele's real
callback endpoint once it exists to test against.

Open on Kumele's side, per their own report: `recipient_wallet` isn't captured at their
checkout yet, so it can't be populated until that's added there.
