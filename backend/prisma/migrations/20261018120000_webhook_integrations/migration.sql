-- CreateEnum
CREATE TYPE "WebhookExecutionStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "webhook_integrations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp_instance_id" UUID NOT NULL,
    "group_jid" TEXT NOT NULL,
    "group_name" TEXT,
    "secret_hash" TEXT NOT NULL,
    "secret_hint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_executions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "status" "WebhookExecutionStatus" NOT NULL DEFAULT 'PROCESSING',
    "idempotency_key" TEXT,
    "external_message_id" TEXT,
    "message_id" UUID,
    "conversation_id" UUID,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_integrations_tenant_id_deleted_at_idx" ON "webhook_integrations"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "webhook_integrations_tenant_id_active_idx" ON "webhook_integrations"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_executions_webhook_id_idempotency_key_key" ON "webhook_executions"("webhook_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "webhook_executions_tenant_id_created_at_idx" ON "webhook_executions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_executions_webhook_id_created_at_idx" ON "webhook_executions"("webhook_id", "created_at");

-- AddForeignKey
ALTER TABLE "webhook_integrations" ADD CONSTRAINT "webhook_integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_integrations" ADD CONSTRAINT "webhook_integrations_whatsapp_instance_id_fkey" FOREIGN KEY ("whatsapp_instance_id") REFERENCES "whatsapp_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_executions" ADD CONSTRAINT "webhook_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_executions" ADD CONSTRAINT "webhook_executions_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhook_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the webhooks module in the catalog. Idempotent: existing rows are kept
-- untouched and no tenant is disabled by this migration.
INSERT INTO "modules" ("id", "key", "name", "description", "category", "icon", "sort_order", "controllable", "created_at", "updated_at") VALUES
    ('a0000000-0000-4000-8000-000000000005', 'webhooks', 'Webhooks', 'Integrações externas para envio de mensagens em grupos do WhatsApp.', 'Integrações', 'Webhook', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
