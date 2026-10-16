-- CreateEnum
CREATE TYPE "BillingReminderOrigin" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable
ALTER TABLE "billing_reminders" ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "origin" "BillingReminderOrigin" NOT NULL DEFAULT 'AUTOMATIC';

-- Backfill automatic idempotency key for reminders created before this migration
UPDATE "billing_reminders" SET "dedupe_key" = CONCAT('auto:', "offset_days") WHERE "origin" = 'AUTOMATIC';

-- DropIndex
DROP INDEX "billing_reminders_charge_id_offset_days_key";

-- CreateIndex
CREATE UNIQUE INDEX "billing_reminders_charge_id_dedupe_key_key" ON "billing_reminders"("charge_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "billing_reminders_charge_id_idempotency_key_key" ON "billing_reminders"("charge_id", "idempotency_key");
