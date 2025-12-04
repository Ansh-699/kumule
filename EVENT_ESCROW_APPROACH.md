# Event Escrow System - Implementation Approach

## Overview
This document outlines the approach for implementing an event creation and Solana-based escrow system where:
- Any user can create events
- Users pay SOL to join events (held in escrow)
- Payments are released after event confirmation OR 7 days after event completion (if no dispute)
- Separate from NFT escrow system

---

## Architecture Overview

### 1. **On-Chain Components (Solana Program)**

#### New Anchor Program: `event-escrow`
- **Purpose**: Handle SOL escrow for event payments (separate from NFT escrow)
- **Key Instructions**:
  - `create_event_escrow`: Create escrow account for event entry payment
  - `deposit_entry_fee`: User deposits SOL to join event
  - `confirm_event`: Event creator/guest confirms event happened
  - `release_payment`: Release payment to event creator after confirmation
  - `auto_release`: Admin/system call to auto-release after 7 days
  - `dispute_payment`: Move escrow to disputed state

#### Escrow Account Structure:
```rust
pub struct EventEscrow {
    pub event_id: String,        // Off-chain event ID (stored as bytes)
    pub participant: Pubkey,      // User joining the event
    pub event_creator: Pubkey,   // Event creator wallet
    pub amount: u64,             // SOL amount in escrow
    pub status: EscrowStatus,    // PENDING | CONFIRMED | RELEASED | DISPUTED | CANCELLED
    pub created_at: i64,         // Timestamp
    pub event_date: i64,         // Scheduled event date
    pub confirmed_at: Option<i64>, // When event was confirmed
    pub bump: u8,
}
```

**Alternative Approach (Simpler)**: 
- Store escrow data off-chain in database
- Use simple Solana transfers with PDA accounts for holding funds
- More flexible for complex logic (7-day timers, disputes)

---

### 2. **Off-Chain Components (Backend API)**

#### Database Schema Updates:
```prisma
model Event {
  id            String       @id @default(uuid())
  creatorId     String       @map("creator_id") // User who created event
  creatorWallet String       @map("creator_wallet") // Creator's SOL wallet
  name          String
  description   String?
  entryFee      Decimal      @map("entry_fee") // SOL amount
  eventDate     DateTime     @map("event_date") // Scheduled date
  status        String       @default("ACTIVE") // ACTIVE | COMPLETED | CANCELLED
  completedAt   DateTime?    @map("completed_at") // When event actually happened
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt @map("updated_at")
  entries       EventEntry[]
  disputes      Dispute[]
  escrows       EventEscrow[] // NEW: On-chain escrow references

  @@map("events")
}

model EventEscrow {
  id              String   @id @default(uuid())
  eventId         String   @map("event_id")
  eventEntryId    String   @unique @map("event_entry_id")
  participantId   String   @map("participant_id")
  participantWallet String @map("participant_wallet")
  escrowPda       String   @map("escrow_pda") // PDA address on-chain
  amount          Decimal  // SOL amount
  status          String   // PENDING | CONFIRMED | RELEASED | DISPUTED | CANCELLED
  depositTxHash   String?  @map("deposit_tx_hash") // SOL deposit transaction
  releaseTxHash   String?  @map("release_tx_hash") // SOL release transaction
  confirmedAt     DateTime? @map("confirmed_at")
  releasedAt      DateTime? @map("released_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  event           Event    @relation(fields: [eventId], references: [id])
  eventEntry      EventEntry @relation(fields: [eventEntryId], references: [id])

  @@index([eventId])
  @@index([participantWallet])
  @@index([status])
  @@map("event_escrows")
}

model EventEntry {
  id            String        @id @default(uuid())
  userId        String        @map("user_id")
  eventId       String        @map("event_id")
  walletAddress String       @map("wallet_address")
  amount        Decimal
  txHash        String?       @map("tx_hash")
  status        String        @default("ACTIVE") // ACTIVE | COMPLETED | DISPUTED | REFUNDED
  createdAt     DateTime      @default(now()) @map("created_at")
  updatedAt     DateTime      @updatedAt @map("updated_at")
  user          User          @relation(fields: [userId], references: [id])
  event         Event         @relation(fields: [eventId], references: [id])
  escrow        EventEscrow?  @relation(fields: [id], references: [eventEntryId]) // NEW

  @@index([userId])
  @@index([eventId])
  @@map("event_entries")
}
```

#### API Endpoints:

**Event Management:**
- `POST /api/events` - Create new event (any authenticated user)
- `GET /api/events` - List all events
- `GET /api/events/:id` - Get event details
- `PUT /api/events/:id` - Update event (creator only)
- `POST /api/events/:id/complete` - Mark event as completed (creator/guest)

**Event Participation:**
- `POST /api/events/:id/join` - Join event (pay entry fee via SOL)
- `GET /api/events/:id/entries` - List event participants

**Escrow Management:**
- `POST /api/events/:id/confirm` - Confirm event happened (trigger release)
- `POST /api/events/:id/escrows/:escrowId/release` - Manually release payment
- `GET /api/events/:id/escrows` - List escrows for event

**Auto-Release:**
- `POST /api/cron/auto-release-escrows` - Cron endpoint to check and release after 7 days

---

### 3. **Frontend Components**

#### Event Creation Page:
- Form: Name, Description, Entry Fee (SOL), Event Date
- Preview event details
- Submit creates event on-chain/off-chain

#### Event Listing Page:
- Show all events (active, upcoming, completed)
- Filter by status, date, entry fee
- Click to view details

#### Event Detail Page:
- Event information
- "Join Event" button (if active)
- List of participants
- "Confirm Event" button (if creator/guest)
- Escrow status for each participant

#### My Events Page:
- Events user created
- Events user joined
- Escrow status for each

---

## Implementation Phases

### Phase 1: Database & Backend Foundation
1. ✅ Update Prisma schema with EventEscrow model
2. ✅ Create event creation API endpoint
3. ✅ Create event listing/retrieval endpoints
4. ✅ Create event joining endpoint (with SOL payment)

### Phase 2: Solana Escrow Program (Simplified Approach)
**Option A: Full On-Chain Program**
- Create new Anchor program for event escrow
- Deploy to devnet
- Integrate with backend

**Option B: Hybrid Approach (Recommended)**
- Use simple Solana transfers to PDA accounts
- Store escrow state in database
- More flexible for 7-day timers and complex logic
- Simpler to implement and maintain

**Recommendation: Option B (Hybrid)**
- Easier to implement 7-day auto-release logic
- Better for dispute handling
- Can upgrade to full on-chain later if needed

### Phase 3: Payment Flow
1. User clicks "Join Event"
2. Frontend creates transaction to transfer SOL to PDA
3. Backend verifies transaction and creates EventEntry + EventEscrow records
4. SOL held in PDA until release conditions met

### Phase 4: Event Confirmation & Release
1. Event creator/guest confirms event happened
2. Backend creates release transaction (PDA → Event Creator)
3. Update EventEscrow status to RELEASED
4. Update EventEntry status to COMPLETED

### Phase 5: Auto-Release System
1. Cron job (Cloudflare Workers Cron Triggers) runs daily
2. Check events completed 7+ days ago
3. Check for disputes
4. If no disputes, auto-release payments
5. Update database records

### Phase 6: Frontend Integration
1. Event creation UI
2. Event listing UI
3. Event detail & joining UI
4. My events dashboard
5. Escrow status displays

---

## Technical Details

### PDA (Program Derived Address) Structure:
```
seeds = [
    b"event-escrow",
    event_id.as_bytes(),
    participant_wallet.as_ref(),
]
```

### Payment Flow:
1. **Join Event**:
   - User signs transaction: `User Wallet → PDA (escrow)`
   - Backend verifies transaction
   - Creates EventEntry + EventEscrow records
   - Status: PENDING

2. **Event Confirmation**:
   - Creator/guest confirms event
   - Backend creates transaction: `PDA → Event Creator Wallet`
   - Updates status: RELEASED

3. **Auto-Release**:
   - Cron checks events completed 7+ days ago
   - No disputes found
   - Backend creates release transaction
   - Updates status: RELEASED

### Dispute Integration:
- User raises dispute → EventEscrow status → DISPUTED
- Admin resolves → Either release or refund
- Uses existing dispute system

---

## Security Considerations

1. **Access Control**:
   - Only event creator can confirm event
   - Only participants can raise disputes
   - Admin can resolve disputes

2. **Transaction Verification**:
   - Verify all SOL transfers on-chain
   - Store transaction hashes
   - Validate PDA signatures

3. **Auto-Release Safety**:
   - Double-check event completion date
   - Verify no active disputes
   - Log all auto-releases

---

## Future Enhancements

1. **NFT Badge Rewards** (Separate Feature):
   - Users get NFT badges for completing events
   - Display on profile/wallet
   - Reward system for tasks

2. **Event Types**:
   - Free events (no escrow)
   - Paid events (with escrow)
   - Recurring events

3. **Guest Confirmation**:
   - Multiple guests can confirm
   - Consensus mechanism

---

## Questions to Clarify

1. **Who can confirm events?**
   - Only event creator?
   - Event creator + guests?
   - Any participant?

2. **What happens if event is cancelled?**
   - Auto-refund all participants?
   - Manual refund process?

3. **Event completion detection:**
   - Manual confirmation only?
   - Automatic based on event date?

4. **Multiple payments per event:**
   - Can users join multiple times?
   - One entry per user per event?

---

## Next Steps

1. **Review & Approve Approach**
2. **Clarify Questions Above**
3. **Start with Phase 1: Database & Backend**
4. **Implement Solana Escrow (Hybrid Approach)**
5. **Build Frontend Components**
6. **Test End-to-End Flow**
7. **Deploy to Devnet**

---

## Estimated Timeline

- Phase 1: 2-3 days
- Phase 2: 3-4 days
- Phase 3: 2-3 days
- Phase 4: 2 days
- Phase 5: 1-2 days
- Phase 6: 3-4 days

**Total: ~2 weeks**

