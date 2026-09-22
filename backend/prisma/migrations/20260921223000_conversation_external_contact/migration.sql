-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "external_contact_id" TEXT;

-- DropIndex
DROP INDEX "conversations_whatsapp_instance_id_lead_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "conversations_whatsapp_instance_id_external_contact_id_key" ON "conversations"("whatsapp_instance_id", "external_contact_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_lead_id_idx" ON "conversations"("tenant_id", "lead_id");
