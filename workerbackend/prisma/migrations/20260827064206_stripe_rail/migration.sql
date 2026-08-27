-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUIRES_PAYMENT', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "MintJobStatus" AS ENUM ('AWAITING_PAYMENT', 'PENDING', 'MINTING', 'MINTED', 'FAILED', 'BLOCKED', 'REFUNDED');

-- CreateTable
CREATE TABLE "fee_quotes" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "chain" "Chain" NOT NULL DEFAULT 'SOLANA',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "network_fee_lamports" BIGINT NOT NULL,
    "rate_scaled" BIGINT NOT NULL,
    "estimated_fee_minor" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'REQUIRES_PAYMENT',
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "base_amount_minor" INTEGER NOT NULL,
    "tax_amount_minor" INTEGER NOT NULL,
    "mint_fee_minor" INTEGER NOT NULL,
    "total_amount_minor" INTEGER NOT NULL,
    "quote_id" TEXT,
    "user_id" TEXT,
    "stripe_refund_id" TEXT,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mint_jobs" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "status" "MintJobStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "chain" "Chain" NOT NULL DEFAULT 'SOLANA',
    "owner_address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metadata_uri" TEXT NOT NULL,
    "mint_address" TEXT,
    "seed_version" INTEGER NOT NULL DEFAULT 1,
    "tx_signature" TEXT,
    "estimated_fee_minor" INTEGER NOT NULL,
    "actual_fee_lamports" BIGINT,
    "actual_fee_minor" INTEGER,
    "ownership_verified" BOOLEAN NOT NULL DEFAULT false,
    "ownership_source" TEXT,
    "nft_id" TEXT,
    "last_error" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mint_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_quotes_expires_at_idx" ON "fee_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_quote_id_key" ON "payments"("quote_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mint_jobs_payment_id_key" ON "mint_jobs"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "mint_jobs_mint_address_key" ON "mint_jobs"("mint_address");

-- CreateIndex
CREATE UNIQUE INDEX "mint_jobs_tx_signature_key" ON "mint_jobs"("tx_signature");

-- CreateIndex
CREATE UNIQUE INDEX "mint_jobs_nft_id_key" ON "mint_jobs"("nft_id");

-- CreateIndex
CREATE INDEX "mint_jobs_status_idx" ON "mint_jobs"("status");

-- CreateIndex
CREATE INDEX "mint_jobs_status_locked_at_idx" ON "mint_jobs"("status", "locked_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "fee_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mint_jobs" ADD CONSTRAINT "mint_jobs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mint_jobs" ADD CONSTRAINT "mint_jobs_nft_id_fkey" FOREIGN KEY ("nft_id") REFERENCES "nfts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
