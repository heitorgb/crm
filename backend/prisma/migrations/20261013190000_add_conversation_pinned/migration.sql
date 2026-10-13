-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "conversations_tenant_id_is_pinned_last_message_at_idx" ON "conversations"("tenant_id", "is_pinned", "last_message_at");
