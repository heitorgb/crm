-- AlterEnum
BEGIN;
CREATE TYPE "ConversationStatus_new" AS ENUM ('OPEN', 'CLOSED');
ALTER TABLE "public"."conversations" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "conversations" ALTER COLUMN "status" TYPE "ConversationStatus_new" USING ("status"::text::"ConversationStatus_new");
ALTER TYPE "ConversationStatus" RENAME TO "ConversationStatus_old";
ALTER TYPE "ConversationStatus_new" RENAME TO "ConversationStatus";
DROP TYPE "public"."ConversationStatus_old";
ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "data_subject_requests" DROP CONSTRAINT "data_subject_requests_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "data_subject_requests" DROP CONSTRAINT "data_subject_requests_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_pipeline_id_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_stage_id_fkey";

-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_analyses" DROP CONSTRAINT "lead_analyses_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_analyses" DROP CONSTRAINT "lead_analyses_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_analyses" DROP CONSTRAINT "lead_analyses_session_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_analyses" DROP CONSTRAINT "lead_analyses_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_digest_deliveries" DROP CONSTRAINT "lead_digest_deliveries_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_digest_deliveries" DROP CONSTRAINT "lead_digest_deliveries_tenant_user_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_digest_preferences" DROP CONSTRAINT "lead_digest_preferences_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_digest_preferences" DROP CONSTRAINT "lead_digest_preferences_tenant_user_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_qualification_sessions" DROP CONSTRAINT "lead_qualification_sessions_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_qualification_sessions" DROP CONSTRAINT "lead_qualification_sessions_profile_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_qualification_sessions" DROP CONSTRAINT "lead_qualification_sessions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_tags" DROP CONSTRAINT "lead_tags_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_tags" DROP CONSTRAINT "lead_tags_tag_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_tags" DROP CONSTRAINT "lead_tags_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_stages" DROP CONSTRAINT "pipeline_stages_pipeline_id_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_stages" DROP CONSTRAINT "pipeline_stages_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "pipelines" DROP CONSTRAINT "pipelines_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "qualification_profiles" DROP CONSTRAINT "qualification_profiles_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_deal_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_assignee_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_lead_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_tenant_id_fkey";

-- DropIndex
DROP INDEX "conversations_tenant_id_lead_id_idx";

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "lead_id",
DROP COLUMN "legal_hold";

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "dpa_accepted_at",
DROP COLUMN "dpa_version",
DROP COLUMN "dpo_email",
DROP COLUMN "dpo_name",
DROP COLUMN "retention_conversation_days",
DROP COLUMN "retention_lead_days",
DROP COLUMN "terms_accepted_at",
DROP COLUMN "terms_version";

-- DropTable
DROP TABLE "activities";

-- DropTable
DROP TABLE "data_subject_requests";

-- DropTable
DROP TABLE "deals";

-- DropTable
DROP TABLE "lead_analyses";

-- DropTable
DROP TABLE "lead_digest_deliveries";

-- DropTable
DROP TABLE "lead_digest_preferences";

-- DropTable
DROP TABLE "lead_qualification_sessions";

-- DropTable
DROP TABLE "lead_tags";

-- DropTable
DROP TABLE "leads";

-- DropTable
DROP TABLE "pipeline_stages";

-- DropTable
DROP TABLE "pipelines";

-- DropTable
DROP TABLE "qualification_profiles";

-- DropTable
DROP TABLE "tasks";

-- DropTable
DROP TABLE "tickets";

-- DropEnum
DROP TYPE "AutomatedReviewOutcome";

-- DropEnum
DROP TYPE "DataSensitivityLevel";

-- DropEnum
DROP TYPE "DataSubjectRequestStatus";

-- DropEnum
DROP TYPE "DataSubjectRequestType";

-- DropEnum
DROP TYPE "DealStatus";

-- DropEnum
DROP TYPE "DigestChannel";

-- DropEnum
DROP TYPE "DigestFrequency";

-- DropEnum
DROP TYPE "DigestStatus";

-- DropEnum
DROP TYPE "LeadStatus";

-- DropEnum
DROP TYPE "QualificationOutcome";

-- DropEnum
DROP TYPE "QualificationSessionStatus";

-- DropEnum
DROP TYPE "TaskPriority";

-- DropEnum
DROP TYPE "TaskStatus";

-- DropEnum
DROP TYPE "TicketPriority";

-- DropEnum
DROP TYPE "TicketStatus";
