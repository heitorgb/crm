-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "last_read_at" TIMESTAMP(3);

-- Backfill: conversations already in the inbox are considered read up to their
-- last activity, so historical messages never reappear as unread.
UPDATE "conversations"
SET "last_read_at" = COALESCE("last_message_at", "created_at")
WHERE "last_read_at" IS NULL;
