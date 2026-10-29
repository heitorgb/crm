-- AlterTable
ALTER TABLE "whatsapp_instances"
    ADD COLUMN "history_sync_chunks" INTEGER,
    ADD COLUMN "history_sync_messages" INTEGER,
    ADD COLUMN "history_sync_updated_at" TIMESTAMP(3);
