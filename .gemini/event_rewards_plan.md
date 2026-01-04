# Event Rewards System - Implementation Plan

## ✅ Phase 1: Completed Features

### 1. Delete Events from Admin Portal
- **Backend**: Added `DELETE /api/events/:id` endpoint with admin authentication
- **Frontend**: 
  - Added delete button (trash icon) in admin events table
  - Implemented confirmation dialog before deletion
  - Cascading delete: removes all event entries when event is deleted
  - Loading states and error handling

### 2. Enhanced Participant Details
- **Improved Display**:
  - Full wallet address (12 chars on each side)
  - Amount paid with SOL badge
  - Join date/time
  - Transaction hash (if available)
  - Empty state when no participants
  - Scrollable list for many participants

## 🚀 Phase 2: Event-Specific Reward System (To Implement)

### Overview
Create a comprehensive reward system where each event can have:
- Custom tasks/challenges
- Progress tracking for participants
- Unique NFT rewards
- Admin management interface

### Database Schema Changes Needed

```prisma
// Event Reward NFT - The reward for completing an event
model EventReward {
  id              String   @id @default(uuid())
  eventId         String   @map("event_id")
  name            String
  description     String?
  imageUrl        String   @map("image_url")
  metadataUri     String   @map("metadata_uri")
  nftAsset        String?  @unique @map("nft_asset") // On-chain NFT address (after minting)
  totalSupply     Int      @default(1) @map("total_supply")
  claimedCount    Int      @default(0) @map("claimed_count")
  createdAt       DateTime @default(now()) @map("created_at")
  event           Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  claims          EventRewardClaim[]

  @@index([eventId])
  @@map("event_rewards")
}

// Tasks required to earn the event reward
model EventTask {
  id              String   @id @default(uuid())
  eventId         String   @map("event_id")
  title           String
  description     String?
  taskType        String   @map("task_type") // "ATTENDANCE", "INTERACTION", "PURCHASE", "CUSTOM"
  requiredCount   Int      @default(1) @map("required_count") // How many times to complete
  points          Int      @default(10) // Points earned per completion
  order           Int      @default(0) // Display order
  createdAt       DateTime @default(now()) @map("created_at")
  event           Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  progress        EventTaskProgress[]

  @@index([eventId])
  @@map("event_tasks")
}

// Track user progress on event tasks
model EventTaskProgress {
  id              String   @id @default(uuid())
  taskId          String   @map("task_id")
  userId          String   @map("user_id")
  eventId         String   @map("event_id")
  completedCount  Int      @default(0) @map("completed_count")
  totalPoints     Int      @default(0) @map("total_points")
  isCompleted     Boolean  @default(false) @map("is_completed")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  task            EventTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user            User     @relation(fields: [userId], references: [id])
  event           Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([taskId, userId])
  @@index([userId])
  @@index([eventId])
  @@map("event_task_progress")
}

// Track reward claims
model EventRewardClaim {
  id              String   @id @default(uuid())
  rewardId        String   @map("reward_id")
  userId          String   @map("user_id")
  eventId         String   @map("event_id")
  walletAddress   String   @map("wallet_address")
  nftAsset        String?  @map("nft_asset") // Claimed NFT address
  txHash          String?  @map("tx_hash")
  claimedAt       DateTime @default(now()) @map("claimed_at")
  reward          EventReward @relation(fields: [rewardId], references: [id])
  user            User     @relation(fields: [userId], references: [id])
  event           Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([eventId])
  @@index([rewardId])
  @@map("event_reward_claims")
}

// Update Event model to include relations
model Event {
  // ... existing fields ...
  rewards         EventReward[]
  tasks           EventTask[]
  taskProgress    EventTaskProgress[]
  rewardClaims    EventRewardClaim[]
}

// Update User model
model User {
  // ... existing fields ...
  eventTaskProgress EventTaskProgress[]
  eventRewardClaims EventRewardClaim[]
}
```

### Backend API Endpoints Needed

#### Event Rewards Management (Admin)
- `POST /api/admin/events/:eventId/rewards` - Create reward for event
- `GET /api/admin/events/:eventId/rewards` - List rewards for event
- `PUT /api/admin/events/:eventId/rewards/:rewardId` - Update reward
- `DELETE /api/admin/events/:eventId/rewards/:rewardId` - Delete reward

#### Event Tasks Management (Admin)
- `POST /api/admin/events/:eventId/tasks` - Create task
- `GET /api/admin/events/:eventId/tasks` - List tasks
- `PUT /api/admin/events/:eventId/tasks/:taskId` - Update task
- `DELETE /api/admin/events/:eventId/tasks/:taskId` - Delete task

#### User Progress & Claims
- `GET /api/events/:eventId/progress` - Get user's progress on event
- `POST /api/events/:eventId/tasks/:taskId/complete` - Mark task as completed
- `POST /api/events/:eventId/rewards/:rewardId/claim` - Claim reward NFT
- `GET /api/events/:eventId/leaderboard` - Get top participants

### Frontend Components Needed

#### Admin Portal
1. **EventRewardsManager.tsx**
   - Upload reward NFT image
   - Set reward metadata
   - Configure supply limits
   - Mint reward NFT to admin wallet

2. **EventTasksManager.tsx**
   - Create/edit/delete tasks
   - Set task types and requirements
   - Configure points per task
   - Reorder tasks

3. **EventProgressDashboard.tsx**
   - View all participants' progress
   - See completion rates
   - Track reward claims
   - Export participant data

#### User-Facing
1. **EventDetailsPage.tsx**
   - Show event information
   - Display available rewards
   - List tasks with progress bars
   - Show leaderboard
   - Claim reward button (when eligible)

2. **EventProgressCard.tsx**
   - Personal progress overview
   - Task checklist
   - Points earned
   - Reward eligibility status

3. **EventLeaderboard.tsx**
   - Top participants by points
   - Completion percentages
   - Claimed rewards count

### Implementation Steps

1. **Database Migration**
   - Add new tables to Prisma schema
   - Run migration
   - Update types

2. **Backend Development**
   - Create reward management endpoints
   - Create task management endpoints
   - Implement progress tracking logic
   - Add reward claim functionality

3. **Admin UI**
   - Build reward upload/management interface
   - Create task configuration UI
   - Add progress monitoring dashboard

4. **User UI**
   - Create event details page with tasks
   - Build progress tracking components
   - Implement reward claim flow
   - Add leaderboard display

5. **Integration**
   - Connect to Solana for NFT minting
   - Implement NFT transfer on claim
   - Add notifications for task completion
   - Test end-to-end flow

### Task Types Examples

- **ATTENDANCE**: Join the event (auto-completed on entry)
- **INTERACTION**: Like/share/comment on event
- **PURCHASE**: Buy specific NFTs during event
- **SOCIAL**: Follow on social media
- **CUSTOM**: Admin-verified manual tasks

### Reward Eligibility Logic

```typescript
// User can claim reward if:
1. Joined the event (has EventEntry)
2. Completed all required tasks
3. Earned minimum points threshold
4. Reward supply not exhausted
5. Haven't already claimed
```

## Next Steps

Would you like me to:
1. Start with the database schema migration?
2. Build the admin reward management UI first?
3. Create the user-facing progress tracking?
4. Implement a specific feature from the plan?

Let me know which direction you'd like to go!
