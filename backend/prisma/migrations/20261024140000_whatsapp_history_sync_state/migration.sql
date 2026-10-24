-- CreateEnum
CREATE TYPE "WhatsAppHistorySyncStatus" AS ENUM ('IDLE', 'SYNCING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "whatsapp_instances"
    ADD COLUMN "history_sync_status" "WhatsAppHistorySyncStatus" NOT NULL DEFAULT 'IDLE',
    ADD COLUMN "history_sync_progress" INTEGER,
    ADD COLUMN "history_sync_started_at" TIMESTAMP(3),
    ADD COLUMN "history_sync_completed_at" TIMESTAMP(3),
    ADD COLUMN "history_sync_error" TEXT;
