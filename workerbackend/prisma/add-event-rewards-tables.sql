-- Safe migration: Add only the new event rewards tables without touching existing data
-- This uses IF NOT EXISTS so it's safe to run multiple times

-- Create event_reward_configs table if not exists
CREATE TABLE IF NOT EXISTS "event_reward_configs" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "gold_supply" INTEGER NOT NULL DEFAULT 1,
    "gold_points" INTEGER NOT NULL DEFAULT 100,
    "gold_image_url" TEXT,
    "silver_supply" INTEGER NOT NULL DEFAULT 3,
    "silver_points" INTEGER NOT NULL DEFAULT 50,
    "silver_image_url" TEXT,
    "bronze_supply" INTEGER NOT NULL DEFAULT 5,
    "bronze_points" INTEGER NOT NULL DEFAULT 25,
    "bronze_image_url" TEXT,
    "auto_mint_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_reward_configs_pkey" PRIMARY KEY ("id")
);

-- Create unique index on event_id if not exists
CREATE UNIQUE INDEX IF NOT EXISTS "event_reward_configs_event_id_key" ON "event_reward_configs"("event_id");

-- Create event_reward_nfts table if not exists  
CREATE TABLE IF NOT EXISTS "event_reward_nfts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "medal_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT NOT NULL,
    "metadata_uri" TEXT NOT NULL,
    "nft_asset" TEXT,
    "required_points" INTEGER NOT NULL,
    "total_supply" INTEGER NOT NULL DEFAULT 1,
    "claimed_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_reward_nfts_pkey" PRIMARY KEY ("id")
);

-- Create event_user_progress table if not exists
CREATE TABLE IF NOT EXISTS "event_user_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_user_progress_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint for user+event combo
CREATE UNIQUE INDEX IF NOT EXISTS "event_user_progress_user_id_event_id_key" ON "event_user_progress"("user_id", "event_id");

-- Create event_reward_claims table if not exists
CREATE TABLE IF NOT EXISTS "event_reward_claims" (
    "id" TEXT NOT NULL,
    "reward_nft_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "nft_asset" TEXT,
    "tx_hash" TEXT,
    "points_used" INTEGER NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_reward_claims_pkey" PRIMARY KEY ("id")
);
