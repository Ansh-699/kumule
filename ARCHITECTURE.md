# NFT Marketplace - Architecture Documentation

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + Vite)                        │
│                         Cloudflare Workers (frontend.ansht.workers.dev)     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Components:                                                                │
│  ├── MarketplaceList    - Browse & buy NFTs                                 │
│  ├── UserNftList        - View owned NFTs, list for sale                    │
│  ├── NftCreator         - Mint new NFTs                                     │
│  ├── AlbumPage          - Music album display with track player             │
│  ├── EventsPage         - Event badges & participation                      │
│  ├── RewardSystem       - Loyalty rewards                                   │
│  └── AdminDashboard     - Admin controls                                    │
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
│  │  event.ts   │  │  reward.ts  │  │  audit.ts   │  │ payment.ts  │         │
│  │ Event Mgmt  │  │ Loyalty     │  │ Security    │  │ Coinbase    │         │
│  │             │  │ Rewards     │  │ Logging     │  │ Commerce    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐                                           │
│  │   db.ts     │  │  webhook.ts │   Shared Helpers:                         │
│  │ Prisma +    │  │ Payment     │   - ensureUserExists()                    │
│  │ Neon        │  │ Webhooks    │   - withPrisma()                          │
│  └─────────────┘  └─────────────┘   - getConnectionString()                 │
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
│ Escrows         │  │                 │  │  11111111111111111              │
│ Disputes        │  │                 │  │                                 │
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

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     User     │     │    Wallet    │     │     NFT      │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id           │◄───┐│ id           │     │ id           │
│ createdAt    │    ││ walletAddress│     │ nftId        │
│ updatedAt    │    ││ walletType   │     │ name         │
└──────────────┘    ││ userId ──────┼────►│ metadataUri  │
       │            │└──────────────┘     │ walletId ────┼──►
       │            │                     └──────────────┘
       ▼            │
┌──────────────┐    │     ┌──────────────┐
│ Transaction  │    │     │    Album     │
├──────────────┤    │     ├──────────────┤
│ transactionId│    │     │ id           │
│ userId ──────┼────┘     │ creatorId ───┼──►
│ amount       │          │ name         │
│ nftId        │          │ artist       │
│ txHash       │          │ coverUrl     │
│ status       │          │ price        │
└──────────────┘          │ nftAsset     │
                          └──────────────┘
       │                         │
       ▼                         ▼
┌──────────────┐          ┌──────────────┐
│    Escrow    │          │    Track     │
├──────────────┤          ├──────────────┤
│ id           │          │ id           │
│ userId       │          │ albumId ─────┼──►
│ nftId        │          │ title        │
│ amount       │          │ audioUrl     │
│ status       │          │ duration     │
└──────────────┘          │ trackNumber  │
                          │ integrityHash│
                          └──────────────┘
```

---

## Security Architecture

### Transaction Integrity

```
┌─────────────────────────────────────────────────────────────┐
│                    AUDIT SYSTEM (audit.ts)                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. CHECKSUM GENERATION                                     │
│     ┌─────────────────────────────────────────────────┐     │
│     │ SHA-256({type, actor, amount, timestamp})       │     │
│     │ → Stored in transaction.metadata._checksum      │     │
│     └─────────────────────────────────────────────────┘     │
│                                                             │
│  2. VERIFICATION ENDPOINT                                   │
│     GET /api/audit/verify/:transactionId                    │
│     → Recalculates checksum, compares with stored value     │
│                                                             │
│  3. SECURITY EVENT LOGGING                                  │
│     - duplicate_mint_attempt                                │
│     - invalid_signature                                     │
│     - rate_limit_exceeded                                   │
│     - unauthorized_access                                   │
│                                                             │
│  4. BLOCKCHAIN TRANSACTION LOGGING                          │
│     - All mint/list/buy/cancel operations logged            │
│     - Success/failure tracking with error messages          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Duplicate Mint Prevention

```
POST /mint
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

```
/                              GET    Search NFT by asset
/owner                         GET    Search NFTs by owner wallet
/listings                      GET    Get all marketplace listings
/mint                          POST   Mint new NFT
/list                          POST   List NFT for sale
/buy                           POST   Buy listed NFT
/cancel                        POST   Cancel listing
/health                        GET    Health check

/api/albums                    GET    List albums
/api/albums                    POST   Create album
/api/albums/:id                GET    Get album with tracks
/api/albums/:id                PUT    Update album
/api/albums/:id                DELETE Delete album
/api/albums/:id/tracks         POST   Add track
/api/albums/:id/tracks/:tid    PUT    Update track
/api/albums/:id/tracks/:tid    DELETE Delete track
/api/albums/:id/tracks/:tid/metadata  GET  Generate NFT metadata

/api/upload/image              POST   Upload image to R2
/api/upload/audio              POST   Upload audio to R2
/api/upload/metadata           POST   Upload JSON metadata to R2
/cdn/images/:filename          GET    Serve image
/cdn/audio/:filename           GET    Stream audio (range support)
/cdn/metadata/:filename        GET    Serve metadata JSON

/api/events                    GET    List events
/api/events                    POST   Create event
/api/events/:id/join           POST   Join event

/api/payment/create            POST   Create Coinbase charge
/api/payment/status/:id        GET    Check payment status
/api/payments/webhook          POST   Payment webhook handler

/api/disputes                  GET    List disputes
/api/disputes                  POST   Create dispute
/api/disputes/:id/resolve      POST   Resolve dispute

/api/rewards/account           GET    Get reward account
/api/rewards/claim             POST   Claim reward NFT

/api/admin/dashboard           GET    Admin dashboard (auth required)
/api/audit/verify/:txId        GET    Verify transaction checksum
```

---

## File Structure

```
nftmarketplace/
├── frontend/src/
│   ├── components/
│   │   ├── MarketplaceList.tsx   # NFT marketplace grid
│   │   ├── UserNftList.tsx       # User's owned NFTs
│   │   ├── NftCard.tsx           # NFT display card with badges
│   │   ├── NftCreator.tsx        # Mint new NFTs
│   │   ├── AlbumPage.tsx         # Album display with player
│   │   ├── EventsPage.tsx        # Event badges
│   │   └── AdminDashboard.tsx    # Admin panel
│   └── services/
│       └── api.ts                # API client functions
│
├── workerbackend/src/
│   ├── index.ts                  # Route registration
│   ├── db.ts                     # Prisma helpers
│   ├── mint.ts                   # NFT minting
│   ├── escrow.ts                 # List/buy/cancel
│   ├── album.ts                  # Music albums
│   ├── upload.ts                 # R2 file uploads
│   ├── audit.ts                  # Security logging
│   ├── event.ts                  # Event management
│   ├── reward.ts                 # Loyalty system
│   ├── payment.ts                # Coinbase integration
│   └── webhook.ts                # Payment webhooks
│
├── programs/
│   ├── nftmarketplace/           # Main escrow program
│   ├── event-escrow/             # Event escrow program
│   └── reward-system/            # Reward program
│
└── prisma/
    └── schema.prisma             # Database schema
```

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
│  │ frontend.ansht.  │◄────►│  (API Worker)    │             │
│  │ workers.dev      │      │                  │             │
│  └──────────────────┘      └──────────────────┘             │
│           │                         │                       │
│           │                         │                       │
│           ▼                         ▼                       │
│  ┌──────────────────┐      ┌──────────────────┐             │
│  │   R2 Bucket      │      │   Hyperdrive     │             │
│  │   (nftimages)    │      │   (DB Proxy)     │             │
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
