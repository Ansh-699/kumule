# NFT Marketplace Documentation

## Overview

A decentralized NFT marketplace on Solana Devnet with support for artwork, music albums, and event badges.

**Live Demo:** [https://frontend.ansht.workers.dev](https://frontend.ansht.workers.dev)

**Escrow Program ID:** `3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44`

---

## Quick Start

### Prerequisites
- Node.js 18+ or Bun
- Solana CLI (for program deployment)
- Cloudflare account (for deployment)

### Backend Setup

```bash
cd workerbackend
bun install

# Create environment file
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your credentials

# Generate Prisma client
npx prisma generate

# Push database schema
npx prisma db push

# Start dev server
bun run dev
# → http://localhost:8788
```

### Frontend Setup

```bash
cd frontend
bun install

# Create environment file
cp .env.example .env
# Edit .env with your RPC URL

# Start dev server
bun run dev
# → http://localhost:5173
```

---

## Environment Variables

### Backend (.dev.vars)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `SOLANA_RPC_URL` | Helius or other Solana RPC endpoint |
| `COINBASE_COMMERCE_API_KEY` | Coinbase Commerce API key |
| `ADMIN_API_KEY` | Admin dashboard authentication key |

### Frontend (.env)

| Variable | Description |
|----------|-------------|
| `VITE_SOLANA_RPC_URL` | Solana RPC URL for wallet connections |

---

## Features

### NFT Minting
- Upload images/audio to Cloudflare R2
- Auto-generate metadata JSON
- Duplicate mint prevention
- Wallet or Coinbase payment options

### Marketplace
- List NFTs for sale (escrow-based)
- Browse and buy NFTs
- Cancel listings
- Atomic swap via Solana program

### Music Albums
- Create albums with multiple tracks
- Upload audio files (up to 100MB)
- Stream with HTTP range support
- Generate per-track NFT metadata

### Events & Badges
- Create events with entry fees
- Mint attendance badges
- Event escrow for payments

### Rewards System
- Loyalty meter for interactions
- Claim reward NFTs at milestones

### Security
- Transaction checksum verification
- Duplicate mint detection
- Security event logging
- Admin-only endpoints

---

## API Reference

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/mint` | POST | Mint new NFT |
| `/list` | POST | List NFT for sale |
| `/buy` | POST | Buy listed NFT |
| `/cancel` | POST | Cancel listing |
| `/listings` | GET | Get all listings |
| `/owner?owner=<wallet>` | GET | Get NFTs by owner |

### Album Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/albums` | GET | List all albums |
| `/api/albums` | POST | Create album |
| `/api/albums/:id` | GET | Get album with tracks |
| `/api/albums/:id` | PUT | Update album |
| `/api/albums/:id` | DELETE | Delete album |
| `/api/albums/:id/tracks` | POST | Add track |
| `/api/albums/:id/tracks/:trackId` | PUT | Update track |
| `/api/albums/:id/tracks/:trackId` | DELETE | Delete track |

### Upload Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upload/image` | POST | Upload image (multipart) |
| `/api/upload/audio` | POST | Upload audio (multipart) |
| `/api/upload/metadata` | POST | Upload JSON metadata |
| `/cdn/images/:filename` | GET | Serve image |
| `/cdn/audio/:filename` | GET | Stream audio |

### Event Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET | List events |
| `/api/events` | POST | Create event |
| `/api/events/:id/join` | POST | Join event |

### Security Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/audit/verify/:transactionId` | GET | Verify transaction checksum |

---

## Request/Response Examples

### Mint NFT

```bash
curl -X POST http://localhost:8788/mint \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "https://your-worker.workers.dev/cdn/metadata/abc123.json",
    "name": "My NFT",
    "owner": "YourWalletPublicKey"
  }'
```

Response:
```json
{
  "transaction": "base64-encoded-transaction",
  "mint": "NFTAssetPublicKey"
}
```

### Create Album

```bash
curl -X POST http://localhost:8788/api/albums \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Album",
    "artist": "Artist Name",
    "creatorWallet": "YourWalletPublicKey",
    "description": "Album description",
    "coverUrl": "https://example.com/cover.jpg"
  }'
```

### Upload Audio

```bash
curl -X POST http://localhost:8788/api/upload/audio \
  -F "file=@track.mp3" \
  -F "filename=my-track.mp3"
```

Response:
```json
{
  "success": true,
  "url": "https://your-worker.workers.dev/cdn/audio/my-track.mp3",
  "integrityHash": "sha256-abc123..."
}
```

### Verify Transaction

```bash
curl http://localhost:8788/api/audit/verify/txn_123456
```

Response:
```json
{
  "valid": true,
  "message": "Checksum verified"
}
```

---

## Frontend Components

| Component | Route | Description |
|-----------|-------|-------------|
| `MarketplaceList` | `/marketplace` | Browse NFT listings |
| `UserNftList` | `/my-nfts` | View/list owned NFTs |
| `NftCreator` | `/create` | Mint new NFTs |
| `AlbumPage` | `/album/:id` | View album with tracks |
| `EventsPage` | `/events` | Browse/join events |
| `RewardSystem` | `/rewards` | Loyalty rewards |
| `AdminDashboard` | `/admin` | Admin controls |

### NftCard Features
- **Type Badges:** Music, Video, Event Badge, Artwork
- **Explorer Links:** Click to view on Solana Explorer
- **Audio Player:** Inline playback for music NFTs

---

## Testing

### Run Tests

```bash
# Anchor program tests
anchor test

# Worker tests
cd workerbackend && bun test

# Database connection test
cd workerbackend && bun run test-db.ts

# E2E flow test
cd frontend && node test-full-flow.mjs
```

### Manual Testing

```bash
# Health check
curl http://localhost:8788/health

# Get listings
curl http://localhost:8788/listings

# Get albums
curl http://localhost:8788/api/albums
```

---

## Deployment

### Deploy Backend

```bash
cd workerbackend

# Set secrets
npx wrangler secret put DATABASE_URL
npx wrangler secret put SOLANA_RPC_URL
npx wrangler secret put COINBASE_COMMERCE_API_KEY
npx wrangler secret put ADMIN_API_KEY

# Deploy
bun run deploy
```

### Deploy Frontend

```bash
cd frontend
bun run build
npx wrangler pages deploy dist
```

---

## Database Schema

### Core Models
- **User** - User accounts
- **Wallet** - Connected wallets (Solana)
- **NFT** - Minted NFTs with metadata URIs
- **Transaction** - Payment/mint transactions

### Marketplace Models
- **Escrow** - NFT listings held in escrow
- **Dispute** - Buyer/seller disputes

### Music Models
- **Album** - Music album metadata
- **Track** - Individual tracks with audio URLs

### Event Models
- **Event** - Event definitions
- **EventEntry** - User participation

---

## Security Features

1. **Duplicate Mint Prevention**
   - Checks metadata URI before minting
   - Returns 409 Conflict if duplicate

2. **Transaction Checksums**
   - SHA-256 hash of transaction parameters
   - Stored in transaction metadata
   - Verifiable via `/api/audit/verify/:id`

3. **Security Event Logging**
   - Duplicate mint attempts
   - Failed transactions
   - Unauthorized access attempts

4. **Admin Authentication**
   - API key required for admin endpoints
   - Header: `X-Admin-API-Key: your-key`

---

## Troubleshooting

### Prisma "album not found" Error
```bash
cd workerbackend
npx prisma generate
npx prisma db push
```

### TypeScript Errors After Schema Change
Restart VS Code TypeScript server: `Cmd/Ctrl + Shift + P` → "TypeScript: Restart TS Server"

### CORS Errors
Ensure frontend URL is allowed in backend CORS config (see `index.ts`)

### RPC Rate Limits
Backend auto-fallbacks to public devnet RPC if Helius fails

---

## Support

- **GitHub:** [Ansh-699/NFT-Marketplace](https://github.com/Ansh-699/NFT-Marketplace)
- **Solana Explorer:** [View on Devnet](https://explorer.solana.com/?cluster=devnet)
