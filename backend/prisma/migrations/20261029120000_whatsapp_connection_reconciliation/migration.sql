-- AlterTable
ALTER TABLE "whatsapp_instances"
    ADD COLUMN "connection_observed_at" TIMESTAMP(3),
    ADD COLUMN "connection_status_reason" INTEGER,
    ADD COLUMN "connection_requested_at" TIMESTAMP(3);
