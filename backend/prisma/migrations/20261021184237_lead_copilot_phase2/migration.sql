-- CreateEnum
CREATE TYPE "LeadRecommendationKind" AS ENUM ('NEXT_ACTION', 'LEAD_UPDATE');

-- CreateEnum
CREATE TYPE "LeadRecommendationStatus" AS ENUM ('RECOMMENDED', 'ACCEPTED', 'REJECTED', 'EXECUTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "LeadRecommendationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LeadUpdateField" AS ENUM ('NEED', 'PRODUCT', 'BUDGET', 'DEADLINE', 'USERS', 'REQUIREMENTS', 'OBJECTION', 'STAGE', 'LOSS_REASON', 'NOTES');

-- CreateEnum
CREATE TYPE "LeadFollowUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELED');

-- CreateTable
CREATE TABLE "lead_commercial_contexts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "conversation_id" UUID,
    "summary" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "need" TEXT NOT NULL,
    "confirmed_facts" JSONB NOT NULL DEFAULT '[]',
    "hypotheses" JSONB NOT NULL DEFAULT '[]',
    "pending_information" JSONB NOT NULL DEFAULT '[]',
    "next_question" TEXT NOT NULL,
    "suggested_reply" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "analysis_version" INTEGER NOT NULL DEFAULT 1,
    "latest_message_id" TEXT,
    "latest_message_at" TIMESTAMP(3),
    "lead_updated_at" TIMESTAMP(3) NOT NULL,
    "last_analyzed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_commercial_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_recommendations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "conversation_id" UUID,
    "context_id" UUID,
    "analysis_version" INTEGER NOT NULL,
    "kind" "LeadRecommendationKind" NOT NULL,
    "status" "LeadRecommendationStatus" NOT NULL DEFAULT 'RECOMMENDED',
    "priority" "LeadRecommendationPriority" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expected_outcome" TEXT,
    "missing_information" JSONB NOT NULL DEFAULT '[]',
    "suggested_due_at" TIMESTAMP(3),
    "suggested_message" TEXT,
    "update_field" "LeadUpdateField",
    "proposed_value" TEXT,
    "evidence" TEXT,
    "decided_at" TIMESTAMP(3),
    "decided_by_membership_id" UUID,
    "result" JSONB NOT NULL DEFAULT '{}',
    "before_data" JSONB NOT NULL DEFAULT '{}',
    "after_data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_follow_ups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "conversation_id" UUID,
    "recommendation_id" UUID,
    "owner_id" UUID,
    "created_by_membership_id" UUID,
    "idempotency_key" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "due_at" TIMESTAMP(3),
    "suggested_message" TEXT,
    "status" "LeadFollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "last_rescheduled_at" TIMESTAMP(3),
    "events" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_commercial_contexts_lead_id_key" ON "lead_commercial_contexts"("lead_id");

-- CreateIndex
CREATE INDEX "lead_commercial_contexts_tenant_id_conversation_id_idx" ON "lead_commercial_contexts"("tenant_id", "conversation_id");

-- CreateIndex
CREATE INDEX "lead_recommendations_tenant_id_lead_id_created_at_idx" ON "lead_recommendations"("tenant_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_recommendations_tenant_id_lead_id_analysis_version_idx" ON "lead_recommendations"("tenant_id", "lead_id", "analysis_version");

-- CreateIndex
CREATE INDEX "lead_recommendations_tenant_id_status_idx" ON "lead_recommendations"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lead_follow_ups_recommendation_id_key" ON "lead_follow_ups"("recommendation_id");

-- CreateIndex
CREATE INDEX "lead_follow_ups_tenant_id_lead_id_status_due_at_idx" ON "lead_follow_ups"("tenant_id", "lead_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_follow_ups_tenant_id_idempotency_key_key" ON "lead_follow_ups"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "lead_commercial_contexts" ADD CONSTRAINT "lead_commercial_contexts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_commercial_contexts" ADD CONSTRAINT "lead_commercial_contexts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_commercial_contexts" ADD CONSTRAINT "lead_commercial_contexts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_recommendations" ADD CONSTRAINT "lead_recommendations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_recommendations" ADD CONSTRAINT "lead_recommendations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_recommendations" ADD CONSTRAINT "lead_recommendations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_recommendations" ADD CONSTRAINT "lead_recommendations_context_id_fkey" FOREIGN KEY ("context_id") REFERENCES "lead_commercial_contexts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_recommendations" ADD CONSTRAINT "lead_recommendations_decided_by_membership_id_fkey" FOREIGN KEY ("decided_by_membership_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "lead_recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
