-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('SOLANA', 'ETHEREUM');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('ART', 'PFP', 'GAMING', 'PHOTOGRAPHY', 'MUSIC', 'UTILITY', 'VIRTUAL_WORLDS', 'OTHER');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MedalTier" AS ENUM ('GOLD', 'SILVER', 'BRONZE');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "handle" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "address" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "chain_id" INTEGER,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "banner_url" TEXT,
    "category" "Category" NOT NULL DEFAULT 'OTHER',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "creator_address" TEXT NOT NULL,
    "contract_address" TEXT,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "floor_price" DECIMAL(38,18),
    "volume" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfts" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "chain_id" INTEGER,
    "asset_id" TEXT NOT NULL,
    "contract_address" TEXT,
    "token_id" TEXT,
    "mint_address" TEXT,
    "collection_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "metadata_uri" TEXT,
    "animation_url" TEXT,
    "category" "Category" NOT NULL DEFAULT 'OTHER',
    "attributes" JSONB,
    "image_ok" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "owner_address" TEXT NOT NULL,
    "creator_address" TEXT,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "minted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "nft_id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "seller_address" TEXT NOT NULL,
    "price" DECIMAL(38,18) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "escrow_pda" TEXT,
    "list_tx_hash" TEXT,
    "close_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "nft_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "chain" "Chain" NOT NULL,
    "seller_address" TEXT NOT NULL,
    "buyer_address" TEXT NOT NULL,
    "price" DECIMAL(38,18) NOT NULL,
    "currency" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "likes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nft_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_medals" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "tier" "MedalTier" NOT NULL,
    "chain" "Chain" NOT NULL DEFAULT 'SOLANA',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "metadata_uri" TEXT,
    "required_points" INTEGER NOT NULL,
    "supply" INTEGER NOT NULL DEFAULT 1,
    "claimed_count" INTEGER NOT NULL DEFAULT 0,
    "nft_id" TEXT,
    "mint_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_medals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participants" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medal_claims" (
    "id" TEXT NOT NULL,
    "medal_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "points_at_claim" INTEGER NOT NULL,
    "tx_hash" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medal_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "albums" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "description" TEXT,
    "cover_url" TEXT NOT NULL,
    "genre" TEXT,
    "release_date" TIMESTAMP(3),
    "price" DECIMAL(38,18),
    "currency" TEXT,
    "creator_address" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "track_count" INTEGER NOT NULL DEFAULT 0,
    "nft_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" TEXT NOT NULL,
    "album_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "audio_url" TEXT NOT NULL,
    "artwork_url" TEXT,
    "duration_sec" INTEGER,
    "track_number" INTEGER NOT NULL,
    "price" DECIMAL(38,18),
    "currency" TEXT,
    "integrity_hash" TEXT,
    "is_previewable" BOOLEAN NOT NULL DEFAULT true,
    "preview_seconds" INTEGER NOT NULL DEFAULT 30,
    "nft_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "chain" "Chain" NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "wallet_address" TEXT,
    "amount" DECIMAL(38,18),
    "currency" TEXT,
    "tx_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");

-- CreateIndex
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- CreateIndex
CREATE INDEX "wallets_address_idx" ON "wallets"("address");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_chain_address_key" ON "wallets"("chain", "address");

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");

-- CreateIndex
CREATE INDEX "collections_chain_idx" ON "collections"("chain");

-- CreateIndex
CREATE INDEX "collections_category_idx" ON "collections"("category");

-- CreateIndex
CREATE INDEX "collections_verified_idx" ON "collections"("verified");

-- CreateIndex
CREATE UNIQUE INDEX "nfts_asset_id_key" ON "nfts"("asset_id");

-- CreateIndex
CREATE INDEX "nfts_chain_idx" ON "nfts"("chain");

-- CreateIndex
CREATE INDEX "nfts_owner_address_idx" ON "nfts"("owner_address");

-- CreateIndex
CREATE INDEX "nfts_collection_id_idx" ON "nfts"("collection_id");

-- CreateIndex
CREATE INDEX "nfts_category_idx" ON "nfts"("category");

-- CreateIndex
CREATE INDEX "nfts_chain_hidden_idx" ON "nfts"("chain", "hidden");

-- CreateIndex
CREATE INDEX "nfts_image_ok_idx" ON "nfts"("image_ok");

-- CreateIndex
CREATE INDEX "listings_status_idx" ON "listings"("status");

-- CreateIndex
CREATE INDEX "listings_chain_status_idx" ON "listings"("chain", "status");

-- CreateIndex
CREATE INDEX "listings_seller_address_idx" ON "listings"("seller_address");

-- CreateIndex
CREATE INDEX "listings_nft_id_idx" ON "listings"("nft_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_listing_id_key" ON "sales"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tx_hash_key" ON "sales"("tx_hash");

-- CreateIndex
CREATE INDEX "sales_chain_idx" ON "sales"("chain");

-- CreateIndex
CREATE INDEX "sales_sold_at_idx" ON "sales"("sold_at");

-- CreateIndex
CREATE INDEX "sales_nft_id_idx" ON "sales"("nft_id");

-- CreateIndex
CREATE INDEX "likes_nft_id_idx" ON "likes"("nft_id");

-- CreateIndex
CREATE UNIQUE INDEX "likes_user_id_nft_id_key" ON "likes"("user_id", "nft_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "event_medals_nft_id_key" ON "event_medals"("nft_id");

-- CreateIndex
CREATE INDEX "event_medals_event_id_idx" ON "event_medals"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_medals_event_id_tier_key" ON "event_medals"("event_id", "tier");

-- CreateIndex
CREATE INDEX "event_participants_event_id_idx" ON "event_participants"("event_id");

-- CreateIndex
CREATE INDEX "event_participants_wallet_address_idx" ON "event_participants"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "event_participants_event_id_user_id_key" ON "event_participants"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "medal_claims_event_id_idx" ON "medal_claims"("event_id");

-- CreateIndex
CREATE INDEX "medal_claims_wallet_address_idx" ON "medal_claims"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "medal_claims_medal_id_user_id_key" ON "medal_claims"("medal_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "albums_slug_key" ON "albums"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "albums_nft_id_key" ON "albums"("nft_id");

-- CreateIndex
CREATE INDEX "albums_chain_idx" ON "albums"("chain");

-- CreateIndex
CREATE INDEX "albums_artist_idx" ON "albums"("artist");

-- CreateIndex
CREATE INDEX "albums_creator_address_idx" ON "albums"("creator_address");

-- CreateIndex
CREATE INDEX "albums_is_published_idx" ON "albums"("is_published");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_nft_id_key" ON "tracks"("nft_id");

-- CreateIndex
CREATE INDEX "tracks_album_id_idx" ON "tracks"("album_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_album_id_track_number_key" ON "tracks"("album_id", "track_number");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_tx_hash_key" ON "transactions"("tx_hash");

-- CreateIndex
CREATE INDEX "transactions_wallet_address_idx" ON "transactions"("wallet_address");

-- CreateIndex
CREATE INDEX "transactions_chain_idx" ON "transactions"("chain");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfts" ADD CONSTRAINT "nfts_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_medals" ADD CONSTRAINT "event_medals_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_medals" ADD CONSTRAINT "event_medals_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medal_claims" ADD CONSTRAINT "medal_claims_medal_id_fkey" FOREIGN KEY ("medal_id") REFERENCES "event_medals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medal_claims" ADD CONSTRAINT "medal_claims_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medal_claims" ADD CONSTRAINT "medal_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

