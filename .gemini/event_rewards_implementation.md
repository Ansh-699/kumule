# Event Rewards System - Implementation Summary

## ✅ Phase 1: Database Schema (COMPLETED)

### New Tables Created:

1. **event_reward_nfts** - Stores Gold/Silver/Bronze NFTs for each event
   - `medalType`: "GOLD" | "SILVER" | "BRONZE"
   - `requiredPoints`: Points needed to claim
   - `imageUrl`, `metadataUri`: NFT assets
   - `nftAsset`: On-chain NFT address
   - `totalSupply`, `claimedCount`: Supply tracking

2. **event_user_progress** - Tracks user points per event
   - `totalPoints`: User's current points
   - `tasksCompleted`: Number of tasks completed
   - Unique constraint on (userId, eventId)

3. **event_reward_claims** - Tracks NFT claims
   - Links user, event, and reward NFT
   - Stores claim transaction hash
   - Points used for claim

### Relations Added:
- Event → EventRewardNft (one-to-many)
- Event → EventUserProgress (one-to-many)
- Event → EventRewardClaim (one-to-many)
- User → EventUserProgress (one-to-many)
- User → EventRewardClaim (one-to-many)

## 🚀 Phase 2: Backend API (TO IMPLEMENT)

### Event Rewards Management (Admin)

**File**: `/workerbackend/src/event-rewards.ts`

```typescript
// Create reward NFT for an event
POST /api/admin/events/:eventId/rewards
Body: {
  medalType: "GOLD" | "SILVER" | "BRONZE",
  name: string,
  description: string,
  imageUrl: string,
  metadataUri: string,
  requiredPoints: number,
  totalSupply: number
}

// List rewards for an event
GET /api/admin/events/:eventId/rewards

// Update reward
PUT /api/admin/events/:eventId/rewards/:rewardId

// Delete reward
DELETE /api/admin/events/:eventId/rewards/:rewardId

// Mint reward NFT (integrate with Solana)
POST /api/admin/events/:eventId/rewards/:rewardId/mint
```

### User Progress & Claims

**File**: `/workerbackend/src/event-progress.ts`

```typescript
// Get user's progress for an event
GET /api/events/:eventId/progress?walletAddress=xxx

// Add points (mock for development)
POST /api/events/:eventId/progress/add-points
Body: {
  walletAddress: string,
  points: number
}

// Get available rewards for user
GET /api/events/:eventId/rewards?walletAddress=xxx

// Claim reward NFT
POST /api/events/:eventId/rewards/:rewardId/claim
Body: {
  walletAddress: string
}
```

## 🎨 Phase 3: Frontend Implementation

### 1. Update EventDetailPage.tsx

**Add Points Counter:**
```tsx
// Mock points counter with fill-up functionality
<Card>
  <CardHeader>
    <CardTitle>Your Progress</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="space-y-4">
      <div>
        <div className="flex justify-between mb-2">
          <span>Points</span>
          <span className="font-bold">{userPoints} / 100</span>
        </div>
        <Progress value={(userPoints / 100) * 100} />
      </div>
      
      {/* Mock button to add points */}
      <Button onClick={handleAddPoints}>
        + Add 10 Points (Mock)
      </Button>
    </div>
  </CardContent>
</Card>
```

**Add Claimable NFTs Section:**
```tsx
<Card>
  <CardHeader>
    <CardTitle>Claimable Rewards</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="grid grid-cols-3 gap-4">
      {/* Bronze NFT */}
      <RewardNftCard
        medal="bronze"
        name="Bronze Medal"
        requiredPoints={30}
        userPoints={userPoints}
        onClaim={() => handleClaimNft('bronze')}
      />
      
      {/* Silver NFT */}
      <RewardNftCard
        medal="silver"
        name="Silver Medal"
        requiredPoints={60}
        userPoints={userPoints}
        onClaim={() => handleClaimNft('silver')}
      />
      
      {/* Gold NFT */}
      <RewardNftCard
        medal="gold"
        name="Gold Medal"
        requiredPoints={100}
        userPoints={userPoints}
        onClaim={() => handleClaimNft('gold')}
      />
    </div>
  </CardContent>
</Card>
```

### 2. Create RewardNftCard Component

**File**: `/frontend/src/components/RewardNftCard.tsx`

```tsx
interface RewardNftCardProps {
  medal: 'bronze' | 'silver' | 'gold';
  name: string;
  imageUrl?: string;
  requiredPoints: number;
  userPoints: number;
  claimed: boolean;
  onClaim: () => void;
}

export const RewardNftCard = ({
  medal,
  name,
  imageUrl,
  requiredPoints,
  userPoints,
  claimed,
  onClaim
}: RewardNftCardProps) => {
  const canClaim = userPoints >= requiredPoints && !claimed;
  
  const colors = {
    bronze: 'from-amber-700 to-amber-900',
    silver: 'from-gray-400 to-gray-600',
    gold: 'from-yellow-400 to-yellow-600'
  };
  
  return (
    <Card className={`border-2 ${canClaim ? 'border-green-500 animate-pulse' : ''}`}>
      <div className={`h-32 bg-gradient-to-br ${colors[medal]} flex items-center justify-center`}>
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="w-20 h-20 object-cover" />
        ) : (
          <Trophy className="w-16 h-16 text-white" />
        )}
      </div>
      <CardContent className="pt-4">
        <h4 className="font-bold mb-2">{name}</h4>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Required:</span>
            <span className="font-semibold">{requiredPoints} pts</span>
          </div>
          <Progress value={(userPoints / requiredPoints) * 100} />
          <Button
            onClick={onClaim}
            disabled={!canClaim}
            className="w-full"
            variant={canClaim ? "default" : "outline"}
          >
            {claimed ? '✓ Claimed' : canClaim ? 'Claim NFT' : 'Locked'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
```

### 3. Admin Portal - Event Rewards Manager

**File**: `/frontend/src/components/AdminEventRewardsManager.tsx`

Similar to the existing RewardNfts admin panel, but for events:

```tsx
// Features:
- Upload NFT image for Gold/Silver/Bronze
- Set required points for each medal
- Mint NFTs to admin wallet
- Assign NFTs to specific events
- View claim statistics
```

## 📊 Mock Data Flow (Development)

### User Journey:
1. **Join Event** → Get 10 points automatically
2. **Click "Add Points" button** → Add 10 points (mock)
3. **Reach 30 points** → Bronze NFT becomes claimable
4. **Reach 60 points** → Silver NFT becomes claimable
5. **Reach 100 points** → Gold NFT becomes claimable
6. **Click "Claim NFT"** → Simulate claim transaction

### Admin Journey:
1. **Go to Admin Portal** → Events tab
2. **Click "Manage Rewards" on an event**
3. **Upload Bronze/Silver/Gold NFT images**
4. **Set required points** (30/60/100)
5. **Mint NFTs** to admin wallet
6. **Activate rewards** for the event
7. **View claims** and statistics

## 🎯 Next Steps

1. ✅ Database schema created
2. ⏳ Run Prisma migration
3. ⏳ Create backend API endpoints
4. ⏳ Update EventDetailPage with points counter
5. ⏳ Create RewardNftCard component
6. ⏳ Add Admin Event Rewards Manager
7. ⏳ Test mock points system
8. ⏳ Integrate Solana NFT minting
9. ⏳ Test claim flow

## 💡 Points System Design

### How Users Earn Points:
- Join event: +10 points
- Share event: +15 points
- Complete tasks: +20 points
- Attend event: +50 points
- Mock button (dev): +10 points

### Medal Tiers:
- 🥉 **Bronze**: 30 points (2% discount)
- 🥈 **Silver**: 60 points (4% discount)
- 🥇 **Gold**: 100 points (8% discount)

### Claim Rules:
- Must have joined the event
- Must have required points
- NFT supply not exhausted
- Can only claim each medal once per event

Let me know when you're ready to proceed with the next phase!
