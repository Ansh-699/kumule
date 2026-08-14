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

### Frontend — `frontend/.env`

| Variable | Unset behaviour |
|----------|-----------------|
| `VITE_API_BASE` | The deployed worker |
| `VITE_SOLANA_RPC` | `api.devnet.solana.com` |
| `VITE_BASE_SEPOLIA_RPC` | wagmi's default for the chain |

---

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
