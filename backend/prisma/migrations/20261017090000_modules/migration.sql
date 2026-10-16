-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "controllable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "tenant_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modules_key_key" ON "modules"("key");

-- CreateIndex
CREATE INDEX "modules_sort_order_idx" ON "modules"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_modules_tenant_id_module_id_key" ON "tenant_modules"("tenant_id", "module_id");

-- CreateIndex
CREATE INDEX "tenant_modules_tenant_id_enabled_idx" ON "tenant_modules"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "tenant_modules_module_id_idx" ON "tenant_modules"("module_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_tenant_id_created_at_idx" ON "admin_audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actor_user_id_created_at_idx" ON "admin_audit_logs"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed module catalog. Idempotent: re-running never duplicates rows.
-- Availability defaults to enabled for every tenant without an explicit
-- tenant_modules row, so no business functionality is turned off by this
-- migration and existing organizations keep their current behavior.
INSERT INTO "modules" ("id", "key", "name", "description", "category", "icon", "sort_order", "controllable", "created_at", "updated_at") VALUES
    ('a0000000-0000-4000-8000-000000000001', 'attendance', 'Atendimento', 'Conversas e atendimento por WhatsApp.', 'CRM', 'Headset', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a0000000-0000-4000-8000-000000000002', 'contacts', 'Contatos', 'Cadastro e gestão de contatos.', 'CRM', 'Contact', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a0000000-0000-4000-8000-000000000003', 'billing.charges', 'Cobranças', 'Cadastro e controle de cobranças e recorrências.', 'Financeiro', 'Receipt', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a0000000-0000-4000-8000-000000000004', 'billing.collection', 'Régua de Cobrança', 'Configuração, lembretes automáticos e envios manuais de cobrança.', 'Financeiro', 'BellRing', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
