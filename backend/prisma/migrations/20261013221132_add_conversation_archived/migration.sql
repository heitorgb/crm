-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "conversations_tenant_id_is_archived_is_pinned_last_message__idx" ON "conversations"("tenant_id", "is_archived", "is_pinned", "last_message_at");
