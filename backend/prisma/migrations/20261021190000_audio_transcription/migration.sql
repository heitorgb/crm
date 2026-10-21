-- CreateEnum
CREATE TYPE "TranscriptionStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN "transcription_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "transcription_provider" "AiProvider" NOT NULL DEFAULT 'OPENAI',
ADD COLUMN "transcription_model" TEXT NOT NULL DEFAULT 'whisper-1';

-- AlterTable
ALTER TABLE "lead_commercial_contexts" ADD COLUMN "latest_transcription_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "message_transcriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "status" "TranscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "language" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "error_message" TEXT,
    "transcribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_transcriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_transcriptions_message_id_key" ON "message_transcriptions"("message_id");

-- CreateIndex
CREATE INDEX "message_transcriptions_tenant_id_status_idx" ON "message_transcriptions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "message_transcriptions_tenant_id_updated_at_idx" ON "message_transcriptions"("tenant_id", "updated_at");

-- AddForeignKey
ALTER TABLE "message_transcriptions" ADD CONSTRAINT "message_transcriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_transcriptions" ADD CONSTRAINT "message_transcriptions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
