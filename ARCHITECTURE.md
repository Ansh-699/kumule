# NFT Marketplace - Architecture Documentation

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + Vite)                        │
│                         Cloudflare Workers (kumele.ansht.workers.dev)       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Pages:                                                                     │
│  ├── MarketplacePage    - Browse, filter, collection chips                  │
│  ├── NftDetailPage      - List / buy / cancel / burn, then settle           │
│  ├── CollectionsPage    - Collections derived from NFT groupings            │
│  ├── CreatePage         - Mint on Solana or Base Sepolia                    │
│  ├── EventsPage         - Events, points, medal claims                      │
│  └── AdminPage          - Admin dashboard (needs X-Admin-API-Key)           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTPS
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Cloudflare Workers + Hono)                 │
│                              workerbackend/src/                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   mint.ts   │  │  escrow.ts  │  │  album.ts   │  │  upload.ts  │         │
│  │  NFT Mint   │  │ List/Buy/   │  │ Music NFT   │  │  R2 Storage │         │
│  │             │  │ Cancel      │  │ Albums      │  │  Upload     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  medals.ts  │  │  settle.ts  │  │  audit.ts   │  │  admin.ts   │         │
│  │ Events +    │  │ Post-buy    │  │ Security    │  │ adminAuth + │         │
│  │ Medals      │  │ settlement  │  │ Logging     │  │ Dashboard   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                          │
│  │   db.ts     │  │  chains.ts  │  │  burn.ts    │  Shared Helpers:         │
│  │ Prisma +    │  │ Chain cfg + │  │ Two-step    │  - ensureUser()          │
│  │ Neon        │  │ money units │  │ burn        │  - withPrisma()          │
│  └─────────────┘  └─────────────┘  └─────────────┘  - getConnectionString() │
│                                                                             │
│  Reads: nfts.ts  evm.ts  solana.ts  umi.ts  metadata.ts  transfer.ts        │
│         searchnftbyasset.ts  searchnftbyowner.ts  openapi.ts               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
          │                    │                         │
          │                    │                         │
          ▼                    ▼                         ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────┐
│   PostgreSQL    │  │  Cloudflare R2  │  │        Solana Devnet            │
│   (Neon)        │  │  (nftimages)    │  │                                 │
├─────────────────┤  ├─────────────────┤  ├─────────────────────────────────┤
│ Users           │  │ /images/        │  │  Escrow Program                 │
│ Wallets         │  │ /metadata/      │  │  3ozh4TQJbeyXFUuXs...           │
│ NFTs            │  │ /audio/         │  │                                 │
│ Transactions    │  │                 │  │  MPL Core (NFT Standard)        │
│ Albums          │  │                 │  │  CoREENxT6tW1HoK8y...           │
│ Tracks          │  │                 │  │                                 │
│ Events          │  │                 │  │  System Program                 │
│ Listings        │  │                 │  │  11111111111111111              │
│ Sales           │  │                 │  │                                 │
└─────────────────┘  └─────────────────┘  └─────────────────────────────────┘
```

---

## Data Flow Diagrams

### 1. NFT Minting Flow

```
User                    Frontend                  Backend                 Solana
 │                         │                         │                      │
 │ Upload Image/Audio      │                         │                      │
 ├────────────────────────►│                         │                      │
 │                         │ POST /api/upload/image  │                      │
 │                         ├────────────────────────►│                      │
 │                         │        imageUrl         │──► R2 Storage        │
 │                         │◄────────────────────────┤                      │
 │                         │ POST /api/upload/metadata                      │
 │                         ├────────────────────────►│                      │
 │                         │       metadataUri       │──► R2 Storage        │
 │                         │◄────────────────────────┤                      │
 │                         │ POST /mint              │                      │
 │                         ├────────────────────────►│                      │
 │                         │                         │ Duplicate check      │
 │                         │                         │ Build transaction    │
 │                         │    { transaction }      │                      │
 │                         │◄────────────────────────┤                      │
 │     Sign Transaction    │                         │                      │
 │◄────────────────────────┤                         │                      │
 │ Wallet Signature        │                         │                      │
 ├────────────────────────►│                         │                      │
 │                         │───────────────────────────────────────────────►│
 │                         │                         │      Create NFT      │
 │                         │◄───────────────────────────────────────────────┤
 │     Success!            │                         │                      │
 │◄────────────────────────┤                         │                      │
```

### 2. Escrow (List/Buy) Flow

```
LISTING:
Seller                  Frontend                  Backend                 Solana
 │ List NFT                │                         │                      │
 ├────────────────────────►│ POST /list              │                      │
 │                         ├────────────────────────►│                      │
 │                         │                         │ Create Escrow PDA    │
 │                         │                         │ Build deposit tx     │
 │                         │    { transaction }      │                      │
 │                         │◄────────────────────────┤                      │
 │     Sign                │                         │                      │
 ├────────────────────────►│───────────────────────────────────────────────►│
 │                         │                         │  NFT → Escrow PDA    │
 │     Listed!             │◄───────────────────────────────────────────────┤

BUYING:
Buyer                   Frontend                  Backend                 Solana
 │ Buy NFT                 │                         │                      │
 ├────────────────────────►│ POST /buy               │                      │
 │                         ├────────────────────────►│                      │
 │                         │                         │ Build buy tx         │
 │                         │    { transaction }      │                      │
 │                         │◄────────────────────────┤                      │
 │     Sign                │                         │                      │
 ├────────────────────────►│───────────────────────────────────────────────►│
 │                         │                         │  SOL → Seller        │
 │                         │                         │  NFT → Buyer         │
 │     Purchased!          │◄───────────────────────────────────────────────┤
```

---

## Database Schema

The schema itself is the source of truth: `workerbackend/prisma/schema.prisma`.
Fourteen models — `User`, `Wallet`, `Collection`, `Nft`, `Listing`, `Sale`,
`Like`, `Event`, `EventMedal`, `EventParticipant`, `MedalClaim`, `Album`,
`Track`, `Transaction`.

The shape that matters, and that the v1 diagram this section used to hold got
wrong in every particular:

- **`Nft.assetId` is the canonical key**, unique across both chains. A bare mint
  address on Solana; `<contract>:<tokenId>`, lowercased, on EVM. Built only by
  `makeAssetId()` in `workerbackend/src/chains.ts` — never assembled ad hoc.
- **Ownership is an address, not a join.** `Nft.ownerAddress` holds it directly;
  there is no NFT→Wallet foreign key. `Wallet` rows exist to group addresses
  under a `User`, not to own assets.
- **There is no `Escrow` model and no `Dispute` model.** Escrow folded into
  `Listing`, which carries `escrowPda`, `listTxHash` and `closeTxHash` alongside
  `status` (`ACTIVE` | `SOLD` | `CANCELLED`).
- **Money is `Decimal(38, 18)`, never a float.** `Listing.price`, `Sale.price`
  and `Transaction.amount`. It is read back with `.toString()` and converted only
  through `toBaseUnits()` / `fromBaseUnits()`; `fromBaseUnits` emits the
  canonical trailing-zero-stripped form, which is what lets an audit checksum
  survive the database round trip.
- **`Transaction` was renamed out of v1:** `transactionId` → `txHash` (unique, the
  natural on-chain key and the mint-fee replay guard), `transactionType` → `kind`,
  `network` → `chain`. Its `nftId` column is gone; an asset reference lives in
  `metadata.assetId`. `metadata` is real `Json`, not a stringified blob.
- **Chain is an enum on nearly every table** (`SOLANA` | `ETHEREUM`), because
  "which chain is this actually used on" is the question the admin dashboard
  exists to answer.

---

## Security Architecture

### Transaction Integrity

```
┌─────────────────────────────────────────────────────────────┐
│                    AUDIT SYSTEM (audit.ts)                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. CHECKSUM over the fields that define a transaction      │
│     ┌───────────────────────────────────────────────┐       │
│     │ SHA-256 over, in this order:                  │       │
│     │   type, actor, target, amount, chain,         │       │
│     │   assetId, timestamp                          │       │
│     │ (target is in the signed set but unused)      │       │
│     │                                               │       │
│     │ amount is a decimal STRING, never a number.   │       │
│     │ A float would make the checksum depend on     │       │
│     │ IEEE-754 rounding.                            │       │
│     │                                               │       │
│     │ One mapping, checksumTransaction(), serves    │       │
│     │ both the writer and the reader. If they       │       │
│     │ disagree by one field, every verification     │       │
│     │ becomes a false tamper alarm.                 │       │
│     │                                               │       │
│     │ amount is canonicalised through Decimal       │       │
│     │ before hashing: Postgres stores 1.10 as 1.1,  │       │
│     │ and the reader hashes what comes back.        │       │
│     │                                               │       │
│     │ -> transaction.metadata._checksum             │       │
│     └───────────────────────────────────────────────┘       │
│                                                             │
│     Every writer goes through auditedTransactionData(),     │
│     which returns the row rather than writing it, because   │
│     each caller is already inside a withPrisma block.       │
│     Writers: mint, escrow, transfer, burn, medals, settle.  │
│     Until Aug 2026 only mint wrote a checksum, so the       │
│     other five kinds could only answer "missing checksum    │
│     data". audit-check.ts asserts the whole set.            │
│                                                             │
│  2. VERIFICATION ENDPOINT (adminAuth required)              │
│     GET /api/admin/audit/:identifier                        │
│     identifier is a txHash or a row id                      │
│     -> recomputes the checksum, compares with stored        │
│                                                             │
│  3. SECURITY EVENT LOGGING (logSecurityEvent)               │
│     - duplicate_mint_attempt                                │
│     - invalid_signature                                     │
│     - rate_limit_exceeded                                   │
│     - unauthorized_access                                   │
│     - suspicious_activity                                   │
│                                                             │
│  4. BLOCKCHAIN TRANSACTION LOGGING                          │
│     - mint/list/buy/cancel logged via                       │
│       logBlockchainTransaction()                            │
│     - success/failure tracking with error messages          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Duplicate Mint Prevention

```
POST /api/solana/mint
    │
    ▼
┌─────────────────────────┐
│ Check: NFT with same    │
│ metadataUri exists?     │
├─────────────────────────┤
│ Yes → 409 Conflict      │
│       Log security event│
│                         │
│ No  → Continue mint     │
└─────────────────────────┘
```

---

## API Route Map

The authoritative route list is the OpenAPI document in
`workerbackend/src/openapi.ts` (`openAPISpec`), served as JSON at
`GET /openapi.json`.

It is not hand-maintained prose: `workerbackend/openapi-check.ts` compares the
document against the real route table exported from `index.ts` and fails when
they drift, so a route added without documentation breaks the check. Earlier
revisions of this section listed routes by hand and drifted badly - it still
advertised `/api/payment/*` (Coinbase Commerce, shut down 2026-03-31),
`/api/disputes/*` and `/api/rewards/*`, none of which exist in v2.

Which routes require the `X-Admin-API-Key` header is decided in one place, the
route table in `workerbackend/src/index.ts`, and pinned by
`workerbackend/auth-parity-check.ts`.


## File Structure

```
kumule-v2/
├── frontend/src/
│   ├── pages/
│   │   ├── MarketplacePage.tsx   # Grid, filters, collection chips
│   │   ├── NftDetailPage.tsx     # Detail, list/buy/cancel/burn, settle
│   │   ├── CollectionsPage.tsx   # Collections derived from NFT groupings
│   │   ├── CreatePage.tsx        # Mint on either chain
│   │   ├── EventsPage.tsx        # Events and medal claims
│   │   └── AdminPage.tsx         # Admin dashboard (tabbed)
│   ├── components/
│   │   ├── NftCard.tsx           # Card with chain badge and hover glow
│   │   ├── FilterSidebar.tsx     # Chain/category/price/status filters
│   │   ├── WalletButton.tsx      # Dual-chain connect (Solana + EVM)
│   │   ├── ChainBadge.tsx        # Chain mark and badge
│   │   ├── ConnectForChain.tsx   # Per-chain connect prompt
│   │   ├── LikeButton.tsx        # Favorite toggle
│   │   ├── Layout.tsx            # Shell and nav
│   │   └── Providers.tsx         # wagmi + wallet-adapter + query
│   └── lib/
│       ├── api.ts                # API client, API_BASE, shared request()
│       ├── chain-ui.ts           # Chain presentation, price formatting
│       ├── evm-abi.ts            # NFT + marketplace ABIs
│       ├── solana-tx.ts          # Sign/send helpers
│       └── utils.ts              # cn()
│
│   Every file above is reachable from main.tsx. The shadcn ui/ directory and a
│   useUmi hook used to sit here unimported; the browser never builds a
│   transaction, it signs one the backend serialised.
│
├── workerbackend/src/
│   ├── index.ts                  # Route table (adminAuth wiring lives here)
│   ├── db.ts                     # Prisma + Neon helpers, withPrisma
│   ├── chains.ts                 # Chain config, assetIds, base-unit money
│   ├── nfts.ts                   # Marketplace read API, collections
│   ├── mint.ts                   # Solana minting + fee verification
│   ├── web3fees.ts       # blockchain processing fee quotes
│   ├── fx.ts             # SOL->EUR as an exact scaled integer
│   ├── stripe.ts         # Stripe over fetch + Web Crypto, no SDK
│   ├── payments.ts       # intent, webhook, status, cron entry
│   ├── mintjob.ts        # idempotent platform-paid mint
│   ├── config.ts         # money config, parsed and defended
│   ├── escrow.ts                 # Solana list/buy/cancel/sync
│   ├── settle.ts                 # Post-purchase settlement, EVM indexing
│   ├── transfer.ts               # Direct transfers
│   ├── burn.ts                   # Two-step burn
│   ├── medals.ts                 # Events, medal mint and claim
│   ├── admin.ts                  # adminAuth + admin dashboard API
│   ├── audit.ts                  # Audit log and transaction checksums
│   ├── evm.ts                    # Base Sepolia reads (viem)
│   ├── solana.ts                 # Solana JSON-RPC, payment verification
│   ├── umi.ts                    # umi factory ('confirmed' commitment)
│   ├── metadata.ts               # Metadata + image resolution
│   ├── album.ts                  # Music albums
│   ├── upload.ts                 # R2 uploads and CDN serving
│   ├── searchnftbyasset.ts       # Lookup one asset on chain
│   ├── searchnftbyowner.ts       # Lookup a wallet's assets on chain
│   └── openapi.ts                # OpenAPI document (drift-guarded)
│
├── workerbackend/prisma/
│   └── schema.prisma             # Database schema
│
├── programs/nftmarketplace/      # LIVE Anchor escrow program - see below
├── tests/                        # Anchor + e2e tests for that program
├── migrations/                   # `anchor migrate` deploy entry point
├── Anchor.toml                   # Globs into tests/ ; do not treat as v1
│
└── contracts-evm/                # Foundry: Base Sepolia NFT + marketplace
```

### `programs/`, `tests/`, `migrations/` and `Anchor.toml` are live

These four read like v1 leftovers because nothing references them from
TypeScript, and two separate analysis passes misclassified them as dead on
exactly that basis. They are wired by convention, not by import:

- `programs/nftmarketplace/src/lib.rs` declares
  `3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44` — the escrow program every
  Solana list, buy and cancel actually runs through. `workerbackend/src/escrow.ts`
  builds raw instructions against that id.
- `Anchor.toml` globs its test command into root `tests/`, which holds the only
  test suite that program has.
- `migrations/` is Anchor's `anchor migrate` entry point for the same program.

Deleting any of them removes the safety net for the contract that physically
holds users' assets, and nothing downstream would fail loudly.

The `event-escrow` and `reward-system` programs listed in earlier revisions of
this document never existed in v2; medals move by a vault-signed `transferV1`,
not by an on-chain program.

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE EDGE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐      ┌──────────────────┐             │
│  │    Frontend      │      │    Backend       │             │
│  │    Worker        │      │    Worker        │             │
│  │                  │      │                  │             │
│  │ kumele.ansht.    │◄────►│ kumele-backend   │             │
│  │ workers.dev      │      │ .ansht.workers.  │             │
│  └──────────────────┘      └──────────────────┘             │
│           │                         │                       │
│           │                         │                       │
│           ▼                         ▼                       │
│  ┌──────────────────┐      ┌──────────────────┐             │
│  │   R2 Bucket      │      │   Neon adapter   │             │
│  │   (nftimages)    │      │   (serverless)   │             │
│  └──────────────────┘      └──────────────────┘             │
│                                     │                       │
└─────────────────────────────────────│───────────────────────┘
                                      │
                                      ▼
                          ┌──────────────────┐
                          │   Neon Database  │
                          │   (PostgreSQL)   │
                          └──────────────────┘
```

## Payment rail (Stripe)

Stripe handles money. Web3 handles minting and ownership. The backend connects them, and
neither half trusts the other's numbers.

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

Money never crosses a float. Fiat is an integer count of EUR minor units; chain amounts are
BigInt lamports; the exchange rate is an integer scaled by 1e8, parsed out of the oracle's
response as a **string** because `res.json()` would have made it a double first. The rate a
quote used is stored on its row, so "estimated fee charged vs actual fee paid" is answerable
months later.

`Transaction` rows still record the chain side of every mint (kind `MINT`, currency `SOL`,
amount = the lamports the platform actually spent) through `auditedTransactionData`, so the
audit endpoint and the admin dashboard keep working. The EUR side lives on `Payment`, which
is a separate table because Stripe truth and chain truth have different lifecycles - not,
as an earlier draft claimed, because `Transaction.currency` could not hold "eur". It is a
nullable string and could.
