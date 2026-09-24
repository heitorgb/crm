-- CreateEnum
CREATE TYPE "AutomatedReviewOutcome" AS ENUM ('UPHELD', 'REVERSED');

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY', 'CONSENT_REVOCATION', 'OPPOSITION', 'AUTOMATED_REVIEW');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "legal_hold" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "lead_qualification_sessions" ADD COLUMN     "review_notes" TEXT,
ADD COLUMN     "review_outcome" "AutomatedReviewOutcome",
ADD COLUMN     "review_resolved_at" TIMESTAMP(3),
ADD COLUMN     "review_resolved_by" UUID;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "anonymized_at" TIMESTAMP(3),
ADD COLUMN     "consent_revoked_at" TIMESTAMP(3),
ADD COLUMN     "legal_hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "opposition_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "dpa_accepted_at" TIMESTAMP(3),
ADD COLUMN     "dpa_version" TEXT,
ADD COLUMN     "dpo_email" TEXT,
ADD COLUMN     "dpo_name" TEXT,
ADD COLUMN     "retention_conversation_days" INTEGER NOT NULL DEFAULT 365,
ADD COLUMN     "retention_lead_days" INTEGER NOT NULL DEFAULT 730,
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT;

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "DataSubjectRequestType" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'PENDING',
    "lead_id" UUID,
    "session_id" UUID,
    "requested_by" UUID,
    "subject_contact" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "response" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_subject_requests_tenant_id_type_idx" ON "data_subject_requests"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "data_subject_requests_tenant_id_created_at_idx" ON "data_subject_requests"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
