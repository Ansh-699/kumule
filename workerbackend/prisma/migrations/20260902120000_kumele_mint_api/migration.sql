-- CreateEnum
CREATE TYPE "PaymentOrigin" AS ENUM ('DIRECT', 'KUMELE_API');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "origin" "PaymentOrigin" NOT NULL DEFAULT 'DIRECT',
ADD COLUMN     "order_id" TEXT;

-- AlterTable
ALTER TABLE "mint_jobs" ADD COLUMN     "callback_sent_at" TIMESTAMP(3),
ADD COLUMN     "callback_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "callback_last_error" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");
