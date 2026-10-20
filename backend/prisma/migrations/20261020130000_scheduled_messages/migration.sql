-- CreateEnum
CREATE TYPE "ScheduledMessageType" AS ENUM ('CAMPAIGN', 'REMINDER');

-- CreateEnum
CREATE TYPE "ScheduledMessageStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ScheduledMessageRecurrence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ScheduledMessageRecipientStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "scheduled_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "type" "ScheduledMessageType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "valor" TEXT,
    "attachment_storage_key" TEXT,
    "attachment_thumbnail_key" TEXT,
    "attachment_file_name" TEXT,
    "attachment_mime_type" TEXT,
    "attachment_size" INTEGER,
    "recurrence" "ScheduledMessageRecurrence" NOT NULL DEFAULT 'ONCE',
    "time_zone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'SCHEDULED',
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_message_recipients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scheduled_message_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "recipient_key" TEXT NOT NULL,
    "conversation_id" UUID,
    "contact_id" UUID,
    "recipient_name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "whatsapp_instance_id" UUID,
    "status" "ScheduledMessageRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "external_message_id" TEXT,
    "message_id" UUID,
    "error_code" TEXT,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_message_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_messages_tenant_id_status_next_run_at_idx" ON "scheduled_messages"("tenant_id", "status", "next_run_at");

-- CreateIndex
CREATE INDEX "scheduled_messages_tenant_id_created_at_idx" ON "scheduled_messages"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sched_msg_recipient_run_key" ON "scheduled_message_recipients"("scheduled_message_id", "scheduled_for", "recipient_key");

-- CreateIndex
CREATE INDEX "sched_recipient_tenant_status_run_idx" ON "scheduled_message_recipients"("tenant_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "sched_msg_recipient_run_idx" ON "scheduled_message_recipients"("scheduled_message_id", "scheduled_for");

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_message_recipients" ADD CONSTRAINT "scheduled_message_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_message_recipients" ADD CONSTRAINT "scheduled_message_recipients_scheduled_message_id_fkey" FOREIGN KEY ("scheduled_message_id") REFERENCES "scheduled_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
