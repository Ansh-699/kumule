# Kumule backend worker

Cloudflare Workers + Hono API for the Kumule NFT marketplace. Solana devnet via MPL Core,
Postgres (Neon) through Prisma + Hyperdrive, R2 for images/audio/metadata.

## Setup

```txt
bun install                 # or npm install
cp .dev.vars.example .dev.vars
bun run dev                 # wrangler dev on :8787
```

Every secret is read from `.dev.vars` locally and from Cloudflare secrets in production.
Nothing sensitive belongs in `wrangler.jsonc` — it is committed.

## Testing

```txt
bun run test:api            # end-to-end smoke test against the deployed worker
BASE=http://localhost:8787 bun run test:api
ADMIN_KEY=... bun run test:api      # also verifies the admin key authenticates

bun run test:security       # auth + payment-verification regression asserts
```

`test:api` is read-only. It never mints, lists, buys, or writes a row, so it is safe to
point at production. Exit code is the number of failed checks.

## Database

`schema.prisma` is the source of truth. The live database had drifted from it — several
tables were missing entirely, which surfaced as `500 … table does not exist` on every
events, rewards, albums, disputes, and payment-log endpoint.

`prisma migrate deploy` cannot repair that (there is no `_prisma_migrations` baseline) and
`migrate dev` / `migrate reset` would drop live rows. So drift is repaired additively:

```txt
bun run db:check            # report which tables/columns are missing, change nothing
bun run db:repair           # apply prisma/bootstrap.sql
```

`bootstrap.sql` is generated, idempotent, and wrapped in a transaction. It creates missing
tables, columns, indexes, and foreign keys and **never drops a table, column, or row**. A
failure rolls back and leaves the database untouched.

Regenerate it whenever `schema.prisma` changes:

```txt
bun run db:bootstrap:build  # > prisma/bootstrap.sql
```

## Payments

Payment verification fails closed. `checkChargeStatus` reports `COMPLETED` only when
Coinbase confirms it — a missing API key, a rejected key, an unknown charge id, or an
unreachable processor all report `UNVERIFIED`, and `mint.ts` refuses to mint on anything
but `COMPLETED`.

`PAYMENTS_DEMO_MODE="true"` opts into stub charges that auto-confirm. It is for local
testing only; with it set, anyone can mint without paying. Production must leave it unset,
which means `/api/payment/create` returns 503 until `COINBASE_COMMERCE_API_KEY` is
configured.

## Deploy

```txt
bun run deploy
```

Required Cloudflare secrets: `SOLANA_RPC_URL`, `DATABASE_URL` (or the Hyperdrive binding),
`ADMIN_API_KEY`, `ADMIN_WALLET_PRIVATE_KEY`, `COINBASE_COMMERCE_API_KEY`,
`COINBASE_WEBHOOK_SECRET`. Admin routes return 503 until `ADMIN_API_KEY` is set, rather
than falling back to a shared default.

```txt
bun run cf-typegen          # regenerate worker-configuration.d.ts after binding changes
```
