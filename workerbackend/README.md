# Kumule backend worker

Cloudflare Workers + Hono API for the Kumule NFT marketplace. Solana devnet via MPL Core,
Base Sepolia via viem, Postgres (Neon) through Prisma's Neon driver adapter, R2 for
images, audio and metadata.

## Setup

```txt
npm install --legacy-peer-deps   # umi's peer ranges conflict; npm ci will not resolve
cp .dev.vars.example .dev.vars
npm run dev                      # wrangler dev on :8787
```

Every secret is read from `.dev.vars` locally and from Cloudflare secrets in production.
Nothing sensitive belongs in `wrangler.jsonc` — it is committed.

## Checks

```txt
npm run check          # typecheck + bundle + every unit check. Run this one.
```

The three stages exist separately because each catches what the others cannot:

```txt
npm run typecheck      # tsc --noEmit
npm run check:build    # wrangler deploy --dry-run
npm run check:units    # the *-check.ts files
```

`check:build` is not optional ceremony. esbuild resolves packages under different
conditions than Node ESM does, so **a clean `tsc` and green unit checks can describe a
worker that cannot be bundled at all** — which is exactly what happened in Aug 2026, when
an import that both `tsc` and `tsx` accepted broke the deploy for a week's worth of
commits. If it is not in `npm run check`, assume nobody runs it.

Each `*-check.ts` pins one behaviour and says which bug it exists for, in its header. They
are plain scripts: no framework, no runner, `process.exit(1)` on failure.

`db-flows-check.ts` is the only one that needs anything external. It runs the real handlers
against a real Postgres through the shipped Neon adapter — see `db-harness.ts` for how,
and its header for the two commands that start a database. Without one it skips loudly
rather than failing, so `npm run check` still works on a bare machine.

```txt
npm run test:api                          # read-only smoke test, safe against production
BASE=http://localhost:8787 npm run test:api
ADMIN_KEY=... npm run test:api            # also exercises admin authentication
```

`test:api` never mints, lists, buys, or writes a row. Exit code is the number of failures.

## Paying for a mint

NFTs are minted on Solana after a card payment clears. Kumele's wallet signs the mint and
pays the network cost; the buyer reimburses it as a line on the Stripe invoice.

```
POST /api/upload/image, /api/upload/metadata     artwork and metadata land in R2
GET  /api/v1/web3/fees/quote                     price the blockchain fee, persist the quote
POST /api/v1/payments/intent                     amounts derived server-side, PaymentIntent
     <card confirmed in the browser>
POST /api/v1/stripe/webhook                      the only thing that starts a mint
     <mint runs, inline or on the next cron tick>
GET  /api/v1/payments/:paymentId                 poll until the asset exists
```

**What a mint costs.** About 0.00244 SOL, and roughly 99% of that is the rent-exempt minimum
for the new asset account, not the transaction fee. The platform never gets it back, because
the asset ends up owned by the buyer. `MINT_VAULT_PRIVATE_KEY` therefore needs funding, and
checkout returns 503 rather than taking money when the vault cannot cover the next mint.

**One payment cannot mint twice**, enforced in three independent places:

- `MintJob.paymentId` is unique, so a payment cannot own two jobs
- claiming a job is a conditional single-row update, the only atomicity primitive here
- the asset address is derived from the payment id, so a retry targets the same account

That last one is why `MINT_ASSET_SEED` is a **derivation root, not a rotatable secret**.
Rotating it while jobs are open makes them underivable; they stop with a `BLOCKED` status
rather than minting a second asset. Drain to zero open jobs first.

**Stripe minimums.** EUR charges under €0.50 are refused by Stripe, so the intent endpoint
guards the total and returns a clear 400 instead of letting a customer's card decline.

**Testing the webhook locally:**

```
npx wrangler dev --local
stripe listen --forward-to localhost:8787/api/v1/stripe/webhook
```

The cron sweep can be fired by hand:

```
npx wrangler dev --local --test-scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*%2F5+*+*+*+*"
```

## Direct crypto routes

The Solana escrow surface (`/api/solana/list`, `/buy`, `/cancel`, `/listing/sync`,
`/escrows`, `/api/admin/escrow/resolve`) and the wallet-signed `/api/solana/mint` are **off
by default** and answer 404. Every file stays in the repo and stays type-checked; set
`ENABLE_DIRECT_CRYPTO=true` to reopen them, and `flags-check.ts` grades both directions.

`/api/settle` is deliberately *not* gated: it records a purchase that already landed on
chain, and Base trading is still live.

## Database

`prisma/schema.prisma` is the source of truth and `prisma/migrations/` is the history.

```txt
DATABASE_URL=... npx prisma migrate deploy
```

Neon's `channel_binding=require` breaks the Prisma CLI with P1001 even though the runtime
adapter handles it fine. Strip that parameter for CLI commands only.

## Deploy

```txt
npm run deploy
npm run cf-typegen     # regenerate worker-configuration.d.ts after binding changes
```

Secrets: `DATABASE_URL` and `ADMIN_API_KEY` are required; `SOLANA_RPC_URL`,
`BASE_SEPOLIA_RPC_URL`, `EVM_NFT_ADDRESS`, `EVM_MARKET_ADDRESS`, `MINT_FEE_LAMPORTS`,
`MINT_FEE_TREASURY`, `MEDAL_VAULT_PRIVATE_KEY` and `PUBLIC_URL` are optional. See
`.dev.vars.example` for what each one does and what happens when it is unset.

Admin routes return 503 until `ADMIN_API_KEY` is set, rather than falling back to a shared
default.
