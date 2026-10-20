-- CreateEnum
CREATE TYPE "BulkMediaBatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "BulkMediaRecipientStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "bulk_media_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "caption" TEXT,
    "storage_key" TEXT NOT NULL,
    "thumbnail_key" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "BulkMediaBatchStatus" NOT NULL DEFAULT 'PENDING',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_media_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_media_recipients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "contact_id" UUID,
    "name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "whatsapp_instance_id" UUID,
    "status" "BulkMediaRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "message_id" UUID,
    "external_message_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_media_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bulk_media_batches_tenant_id_idempotency_key_key" ON "bulk_media_batches"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "bulk_media_batches_tenant_id_created_at_idx" ON "bulk_media_batches"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "bulk_media_batches_tenant_id_status_idx" ON "bulk_media_batches"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_media_recipients_batch_id_conversation_id_key" ON "bulk_media_recipients"("batch_id", "conversation_id");

-- CreateIndex
CREATE INDEX "bulk_media_recipients_tenant_id_status_idx" ON "bulk_media_recipients"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "bulk_media_recipients_batch_id_status_idx" ON "bulk_media_recipients"("batch_id", "status");

-- AddForeignKey
ALTER TABLE "bulk_media_batches" ADD CONSTRAINT "bulk_media_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_media_recipients" ADD CONSTRAINT "bulk_media_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_media_recipients" ADD CONSTRAINT "bulk_media_recipients_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "bulk_media_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
