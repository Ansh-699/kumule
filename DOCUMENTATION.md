# Kumule — operator documentation

Multi-chain NFT marketplace: **Solana devnet** and **Base Sepolia**. Artwork, music albums
and event medals. Testnets only.

**Live demo:** [https://kumele.ansht.workers.dev](https://kumele.ansht.workers.dev)
(`frontend.ansht.workers.dev` is a leftover v1 worker, not deployed from this branch)
**Solana escrow program:** `3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44`
**Base Sepolia contracts:** NFT `0x416e7Fd93fc2210540AAC1c1cC17a851148DfEBD`,
marketplace `0x032774De36621265dc21056026372D7bA6f477eC`

For the architecture — data flows, schema, security model, file layout — see
`ARCHITECTURE.md`. This file is the operator's view: run it, configure it, deploy it.

---

## Quick start

### Prerequisites

- Node.js 20+
- Solana CLI and Anchor, only if you are deploying the escrow program
- Foundry, only if you are deploying the Base contracts
- Podman or Docker, only if you want to run the database-backed checks

### Backend

```bash
cd workerbackend
npm install --legacy-peer-deps    # umi's peer ranges conflict; npm ci will not resolve

cp .dev.vars.example .dev.vars    # DATABASE_URL and ADMIN_API_KEY are the only required ones

DATABASE_URL=... npx prisma migrate deploy
npm run dev                       # → http://localhost:8787
```

Neon's `channel_binding=require` breaks the Prisma CLI with P1001 even though the runtime
adapter handles it. Strip that parameter for CLI commands only.

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
cp .env.example .env              # every value is optional; defaults hit the deployed API
npm run dev                       # → http://localhost:5173
```

---

## Environment variables

Both `.example` files list every variable the code actually reads, what each does, and
what happens when it is unset. They are the reference; this table is a summary.

### Backend — `workerbackend/.dev.vars`

| Variable | Required | Unset behaviour |
|----------|----------|-----------------|
| `DATABASE_URL` | yes | Database-backed routes answer 503 |
| `ADMIN_API_KEY` | yes | Every admin route answers 503 |
| `SOLANA_RPC_URL` | no | Public devnet endpoint, which rate-limits |
| `BASE_SEPOLIA_RPC_URL` | no | `base-sepolia-rpc.publicnode.com` |
| `EVM_NFT_ADDRESS`, `EVM_MARKET_ADDRESS` | no | The deployed pair above |
| `MINT_FEE_LAMPORTS`, `MINT_FEE_TREASURY` | no | Minting is free; caller pays their own network fee |
| `MEDAL_VAULT_PRIVATE_KEY` | no | Medal minting and claiming answer 503 |
| `PUBLIC_URL` | no | Asset URLs derived from the request host |
| `STRIPE_SECRET_KEY` | for payments | `/api/v1/payments/intent` answers 503 |
| `STRIPE_WEBHOOK_SECRET` | for payments | The webhook answers 503 — it never falls back to accepting unsigned bodies |
| `STRIPE_API_VERSION` | no | The account default; a wrong pin breaks every call, so it is not guessed at |
| `MINT_ASSET_SEED` | for minting | Mint jobs refuse to run. A derivation root, not a rotatable secret |
| `MINT_VAULT_PRIVATE_KEY` | for minting | Falls back to `MEDAL_VAULT_PRIVATE_KEY`; without either, minting answers 503 |
| `MINT_SERVICE_PRICE_MINOR` | no | €2.00 per mint |
| `TAX_RATE_BPS` | no | No tax line |
| `MINT_FEE_FLOOR_MINOR` | no | Floor of 15 minor units under the blockchain fee |
| `STRIPE_MIN_CHARGE_MINOR` | no | 50 — Stripe's EUR minimum, guarded before the call |
| `FEE_QUOTE_TTL_SECONDS` | no | Quotes last 15 minutes |
| `ENABLE_DIRECT_CRYPTO` | no | Solana escrow and the wallet-signed mint answer 404 |

### Frontend — `frontend/.env`

| Variable | Unset behaviour |
|----------|-----------------|
| `VITE_API_BASE` | The deployed worker |
| `VITE_SOLANA_RPC` | `api.devnet.solana.com` |
| `VITE_BASE_SEPOLIA_RPC` | wagmi's default for the chain |
| `VITE_STRIPE_PUBLISHABLE_KEY` | The card form on /create explains that payments are not configured |

---

## Paying for a mint

NFTs are minted on Solana **after a card payment clears, and never before**. Kumele's
platform wallet signs the mint and pays the network cost; the buyer reimburses it through an
itemised "NFT minting fee" on the Stripe invoice.

### The fee quote

```
GET /api/v1/web3/fees/quote?operation=nft_mint&chain=solana&quantity=1
```

```json
{
  "quote_id": "…",
  "operation": "nft_mint",
  "chain": "solana",
  "currency": "eur",
  "quantity": 1,
  "fee_payer": "kumele_platform_wallet",
  "charged_to_user": true,
  "estimated_network_fee": { "lamports": 2442080, "sol": "0.00244208" },
  "estimated_fee_minor": 49,
  "display_amount": "€0.49",
  "label": "NFT minting fee",
  "expires_at": "…",
  "source": "static_fallback",
  "confidence": "estimated"
}
```

`source` names which estimator answered. It never carries a URL or an API key — the Helius
endpoint stays in `SOLANA_RPC_URL` on the server and appears in no response body.

**Why the number is bigger than you expect.** Minting an MPL Core asset creates a new
on-chain account, and Solana requires it to be rent-exempt: about 2,422,080 lamports for a
typical asset, against 10,000 for the signatures and 10,000 for the priority fee. Rent is
roughly 99% of the cost and the platform never gets it back, because the asset ends up owned
by the buyer. An estimate that counts only the transaction fee is short by about 200×.

### Taking the payment

```
POST /api/v1/payments/intent
{ "quoteId": "…", "ownerAddress": "<solana address>", "name": "…", "metadataUri": "https://…" }
```

Every amount is derived on the server from the quote row. The body contributes only the
quote id, where to send the NFT, and what to mint — anything in it that looks like a price
is ignored. The response carries `clientSecret` and the full breakdown.

The PaymentIntent metadata carries:

```
requires_nft_mint = "true"
nft_minting_fee_minor = "49"
nft_minting_fee_quote_id = "…"
nft_minting_fee_label = "NFT minting fee"
nft_chain = "solana"
```

That metadata is for the Stripe dashboard and reconciliation. The webhook re-reads
everything from the database and never trusts a number that arrived in it.

### Minting

`POST /api/v1/stripe/webhook` is the only thing that starts a mint. It verifies an HMAC
signature over the raw body, flips the job to `PENDING`, and returns 200. The mint then runs
either immediately (via `waitUntil`, good for about one job) or on the next cron tick, every
five minutes. `GET /api/v1/payments/:paymentId` is the poll endpoint for the checkout page.

**One payment cannot mint twice.** Three independent layers: `MintJob.paymentId` is unique;
claiming a job is a conditional single-row update; and the asset address is derived from the
payment id, so a retry targets the same account rather than creating a second asset.

**If a mint can never succeed** — a dusted address, an unfunded vault — the job reaches a
terminal state and the payment is refunded automatically. `GET /api/admin/payments` reports
a `stranded` count for anything paid but unminted, and
`POST /api/admin/payments/:id/refund` is the manual lever. It refuses to refund a mint that
actually succeeded.

### Operational notes

- The mint wallet needs roughly **0.00244 SOL per mint**. Checkout returns 503 rather than
  taking money when it cannot cover the next one.
- `MINT_ASSET_SEED` is a **derivation root, not a rotatable secret**. Rotating it while jobs
  are open makes them underivable — they stop with `BLOCKED` rather than double-minting.
  Drain to zero open jobs first.
- Stripe refuses EUR totals under €0.50. The intent endpoint guards this and returns a clear
  400 instead of a declined card.
- The Solana escrow routes and the wallet-signed mint are **off by default**
  (`ENABLE_DIRECT_CRYPTO`). Base Sepolia minting and trading are unaffected and still
  wallet-signed, so the Create page carries two payment models and says which is which.

## API reference

`GET /openapi.json` on any running worker is the reference, and it is not hand-maintained
prose: `workerbackend/openapi-check.ts` compares it against the route table in
`src/index.ts` and fails when they drift. A table copied into this file would be one more
thing to keep in sync, and the last one silently rotted through a whole product rewrite.

```bash
curl -s http://localhost:8787/openapi.json | jq '.paths | keys'
```

The shape, so you know where to look:

| Prefix | What lives there |
|--------|------------------|
| `/api/nfts`, `/api/listings`, `/api/collections`, `/api/stats` | Chain-agnostic marketplace reads |
| `/api/solana/*` | Mint, list, buy, cancel, transfer, burn — the worker builds, the wallet signs |
| `/api/evm/*` | Base Sepolia reads and post-transaction indexing |
| `/api/settle` | Reconciles the database with the chain after any wallet-signed action |
| `/api/events/*` | Events, leaderboards, medal claims |
| `/api/albums/*` | Music albums and tracks (writes are admin-only) |
| `/api/upload/*`, `/cdn/*` | R2 uploads and serving |
| `/api/admin/*` | Everything behind `X-Admin-API-Key` |
| `/health`, `/debug/db`, `/api/chains`, `/openapi.json` | Diagnostics |

Two things worth knowing before you call anything:

- **Nothing takes an outcome from the caller.** Every write path is handed a transaction
  hash and verifies it against the chain, then re-reads ownership from the chain. A client
  cannot report a sale that did not happen.
- **Prices are decimal strings, never numbers.** A JSON number would round `0.000025`.

### Verifying a transaction record

```bash
curl -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  http://localhost:8787/api/admin/audit/<txHash-or-row-id>
```

```json
{ "valid": true, "message": "Checksum verified" }
```

Returns 400 with `valid: false` when the row's stored checksum does not match one
recomputed from its own columns. Every transaction kind writes one — see the transaction
integrity section of `ARCHITECTURE.md` for what the checksum covers.

---

## Testing

```bash
cd workerbackend && npm run check   # typecheck + bundle + every unit check
cd frontend && npm run build        # tsc -b && vite build
anchor test                         # the Solana escrow program, against tests/
cd contracts-evm && forge test      # the Base Sepolia contracts
```

`npm run check` runs three stages and all three matter. `check:build` is
`wrangler deploy --dry-run`: esbuild resolves packages under different conditions than
Node ESM does, so a clean typecheck and green unit checks can describe a worker that
cannot be bundled at all. That is not hypothetical — it is why the stage exists.

`db-flows-check.ts` runs the real handlers against a real Postgres through the shipped
Neon adapter. It skips loudly without a database, so `npm run check` still works on a bare
machine; to actually run it:

```bash
podman run -d --name kumule-pg -e POSTGRES_PASSWORD=kumule -e POSTGRES_USER=kumule \
  -e POSTGRES_DB=kumule -p 55432:5432 docker.io/library/postgres:16-alpine
DATABASE_URL=postgresql://kumule:kumule@localhost:55432/kumule npx prisma migrate deploy
```

```bash
npm run test:api                     # read-only smoke test, safe against production
BASE=http://localhost:8787 npm run test:api
```

---

## Deployment

```bash
cd workerbackend
npx wrangler secret put DATABASE_URL
npx wrangler secret put ADMIN_API_KEY
npm run deploy

cd frontend
npm run deploy
```

Add the optional secrets from the table above as needed. `npm run cf-typegen` regenerates
`worker-configuration.d.ts` after any binding change.

---

## Troubleshooting

**`P1001` from the Prisma CLI against Neon.** Drop `channel_binding=require` from the URL
for CLI commands. The runtime adapter is fine with it.

**`npm ci` fails on peer dependencies.** umi's ranges genuinely conflict. Use
`npm install --legacy-peer-deps`.

**A route answers 503 "Database not configured".** `DATABASE_URL` is unset, or it is set
and `getConnectionString` fell through to a Hyperdrive binding that no longer exists. The
secret wins over the binding, deliberately.

**Admin routes answer 503.** `ADMIN_API_KEY` is unset. There is no fallback key.

**RPC rate limits on Solana.** The public devnet endpoint throttles. Set `SOLANA_RPC_URL`
to a paid endpoint; several call sites carry fallbacks but they only soften it.

**A green typecheck but a failing deploy.** Run `npm run check:build`. See the testing
section.

---

## Support

- **GitHub:** [Ansh-699/kumule](https://github.com/Ansh-699/kumule) — this repository's `origin`.
  `Ansh-699/NFT-Marketplace` is the v1 project, last pushed January 2026; it is a different
  codebase and this file used to link to it.
- **Solana Explorer:** [devnet](https://explorer.solana.com/?cluster=devnet)
- **Base Sepolia Explorer:** [sepolia.basescan.org](https://sepolia.basescan.org/)
