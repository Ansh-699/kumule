-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "wallet_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfts" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "nft_id" TEXT NOT NULL,
    "event_id" TEXT,
    "badge_id" TEXT,
    "mint_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata_uri" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "nfts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrows" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nft_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escrows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "nft_id" TEXT,
    "transaction_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "wallet_address" TEXT,
    "tx_hash" TEXT,
    "currency" TEXT,
    "network" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_logs" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "charge_code" TEXT,
    "wallet_address" TEXT,
    "tx_hash" TEXT,
    "amount" DECIMAL(65,30),
    "currency" TEXT,
    "network" TEXT,
    "status" TEXT NOT NULL,
    "raw_payload" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "creator_wallet" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entry_fee" DECIMAL(65,30) NOT NULL,
    "event_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "tx_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_escrows" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_entry_id" TEXT,
    "event_id_on_chain" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "participant_wallet" TEXT NOT NULL,
    "event_creator_wallet" TEXT NOT NULL,
    "escrow_pda" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL,
    "deposit_tx_hash" TEXT,
    "release_tx_hash" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_escrows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "interaction_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_nfts" INTEGER NOT NULL DEFAULT 0,
    "reward_pda" TEXT,
    "last_interaction_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "reward_account_id" TEXT NOT NULL,
    "interaction_type" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_drafts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metadata_uri" TEXT,
    "image_url" TEXT,
    "image_file" TEXT,
    "required_points" INTEGER NOT NULL DEFAULT 100,
    "reward_type" TEXT NOT NULL DEFAULT 'MUSIC_NFT',
    "total_supply" INTEGER NOT NULL DEFAULT 1,
    "is_listed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_nfts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "nft_asset" TEXT NOT NULL,
    "metadata_uri" TEXT NOT NULL,
    "image_url" TEXT,
    "required_points" INTEGER NOT NULL,
    "reward_type" TEXT NOT NULL DEFAULT 'MUSIC_NFT',
    "admin_wallet" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "total_supply" INTEGER NOT NULL DEFAULT 1,
    "claimed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_nfts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claimed_rewards" (
    "id" TEXT NOT NULL,
    "reward_account_id" TEXT NOT NULL,
    "reward_nft_id" TEXT,
    "nft_id" TEXT,
    "nft_asset" TEXT,
    "points_used" INTEGER NOT NULL,
    "reward_type" TEXT NOT NULL,
    "tx_hash" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claimed_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" TEXT,
    "event_entry_id" TEXT,
    "wallet_address" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "reason" TEXT NOT NULL,
    "transaction_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "admin_notes" TEXT,
    "refund_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_reward_nfts" (
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
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_reward_nfts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_user_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_user_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_reward_claims" (
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

-- CreateIndex
CREATE UNIQUE INDEX "wallets_wallet_address_key" ON "wallets"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "nfts_nft_id_key" ON "nfts"("nft_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_transaction_id_key" ON "transactions"("transaction_id");

-- CreateIndex
CREATE INDEX "transactions_wallet_address_idx" ON "transactions"("wallet_address");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_transaction_type_idx" ON "transactions"("transaction_type");

-- CreateIndex
CREATE INDEX "payment_logs_charge_id_idx" ON "payment_logs"("charge_id");

-- CreateIndex
CREATE INDEX "payment_logs_wallet_address_idx" ON "payment_logs"("wallet_address");

-- CreateIndex
CREATE INDEX "payment_logs_event_type_idx" ON "payment_logs"("event_type");

-- CreateIndex
CREATE INDEX "events_creator_id_idx" ON "events"("creator_id");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE INDEX "event_entries_user_id_idx" ON "event_entries"("user_id");

-- CreateIndex
CREATE INDEX "event_entries_event_id_idx" ON "event_entries"("event_id");

-- CreateIndex
CREATE INDEX "event_entries_wallet_address_idx" ON "event_entries"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "event_escrows_event_entry_id_key" ON "event_escrows"("event_entry_id");

-- CreateIndex
CREATE INDEX "event_escrows_event_id_idx" ON "event_escrows"("event_id");

-- CreateIndex
CREATE INDEX "event_escrows_participant_wallet_idx" ON "event_escrows"("participant_wallet");

-- CreateIndex
CREATE INDEX "event_escrows_status_idx" ON "event_escrows"("status");

-- CreateIndex
CREATE INDEX "event_escrows_escrow_pda_idx" ON "event_escrows"("escrow_pda");

-- CreateIndex
CREATE UNIQUE INDEX "reward_accounts_user_id_key" ON "reward_accounts"("user_id");

-- CreateIndex
CREATE INDEX "reward_accounts_wallet_address_idx" ON "reward_accounts"("wallet_address");

-- CreateIndex
CREATE INDEX "reward_accounts_user_id_idx" ON "reward_accounts"("user_id");

-- CreateIndex
CREATE INDEX "interactions_reward_account_id_idx" ON "interactions"("reward_account_id");

-- CreateIndex
CREATE INDEX "interactions_created_at_idx" ON "interactions"("created_at");

-- CreateIndex
CREATE INDEX "reward_drafts_is_listed_idx" ON "reward_drafts"("is_listed");

-- CreateIndex
CREATE UNIQUE INDEX "reward_nfts_nft_asset_key" ON "reward_nfts"("nft_asset");

-- CreateIndex
CREATE INDEX "reward_nfts_is_active_idx" ON "reward_nfts"("is_active");

-- CreateIndex
CREATE INDEX "reward_nfts_required_points_idx" ON "reward_nfts"("required_points");

-- CreateIndex
CREATE INDEX "claimed_rewards_reward_account_id_idx" ON "claimed_rewards"("reward_account_id");

-- CreateIndex
CREATE INDEX "claimed_rewards_nft_asset_idx" ON "claimed_rewards"("nft_asset");

-- CreateIndex
CREATE INDEX "claimed_rewards_reward_nft_id_idx" ON "claimed_rewards"("reward_nft_id");

-- CreateIndex
CREATE INDEX "disputes_user_id_idx" ON "disputes"("user_id");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "disputes_wallet_address_idx" ON "disputes"("wallet_address");

-- CreateIndex
CREATE INDEX "disputes_event_id_idx" ON "disputes"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_reward_nfts_nft_asset_key" ON "event_reward_nfts"("nft_asset");

-- CreateIndex
CREATE INDEX "event_reward_nfts_event_id_idx" ON "event_reward_nfts"("event_id");

-- CreateIndex
CREATE INDEX "event_reward_nfts_medal_type_idx" ON "event_reward_nfts"("medal_type");

-- CreateIndex
CREATE INDEX "event_user_progress_event_id_idx" ON "event_user_progress"("event_id");

-- CreateIndex
CREATE INDEX "event_user_progress_wallet_address_idx" ON "event_user_progress"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "event_user_progress_user_id_event_id_key" ON "event_user_progress"("user_id", "event_id");

-- CreateIndex
CREATE INDEX "event_reward_claims_user_id_idx" ON "event_reward_claims"("user_id");

-- CreateIndex
CREATE INDEX "event_reward_claims_event_id_idx" ON "event_reward_claims"("event_id");

-- CreateIndex
CREATE INDEX "event_reward_claims_reward_nft_id_idx" ON "event_reward_claims"("reward_nft_id");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfts" ADD CONSTRAINT "nfts_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_entries" ADD CONSTRAINT "event_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_entries" ADD CONSTRAINT "event_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_escrows" ADD CONSTRAINT "event_escrows_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_escrows" ADD CONSTRAINT "event_escrows_event_entry_id_fkey" FOREIGN KEY ("event_entry_id") REFERENCES "event_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_accounts" ADD CONSTRAINT "reward_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_reward_account_id_fkey" FOREIGN KEY ("reward_account_id") REFERENCES "reward_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claimed_rewards" ADD CONSTRAINT "claimed_rewards_reward_account_id_fkey" FOREIGN KEY ("reward_account_id") REFERENCES "reward_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claimed_rewards" ADD CONSTRAINT "claimed_rewards_reward_nft_id_fkey" FOREIGN KEY ("reward_nft_id") REFERENCES "reward_nfts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reward_nfts" ADD CONSTRAINT "event_reward_nfts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_user_progress" ADD CONSTRAINT "event_user_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_user_progress" ADD CONSTRAINT "event_user_progress_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reward_claims" ADD CONSTRAINT "event_reward_claims_reward_nft_id_fkey" FOREIGN KEY ("reward_nft_id") REFERENCES "event_reward_nfts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reward_claims" ADD CONSTRAINT "event_reward_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reward_claims" ADD CONSTRAINT "event_reward_claims_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
