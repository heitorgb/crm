CREATE TYPE "LeadStatus" AS ENUM ('OPEN', 'WON', 'LOST');
CREATE TYPE "LeadStageKind" AS ENUM ('OPEN', 'WON', 'LOST');

CREATE TABLE "lead_pipelines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_stages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL,
    "kind" "LeadStageKind" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "owner_id" UUID,
    "title" TEXT NOT NULL,
    "source" TEXT,
    "value_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "LeadStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "next_follow_up_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_pipelines_tenant_id_name_key" ON "lead_pipelines"("tenant_id", "name");
CREATE INDEX "lead_pipelines_tenant_id_active_idx" ON "lead_pipelines"("tenant_id", "active");
CREATE UNIQUE INDEX "lead_stages_pipeline_id_position_key" ON "lead_stages"("pipeline_id", "position");
CREATE INDEX "lead_stages_tenant_id_pipeline_id_idx" ON "lead_stages"("tenant_id", "pipeline_id");
CREATE INDEX "leads_tenant_id_pipeline_id_stage_id_idx" ON "leads"("tenant_id", "pipeline_id", "stage_id");
CREATE INDEX "leads_tenant_id_status_idx" ON "leads"("tenant_id", "status");
CREATE INDEX "leads_tenant_id_contact_id_idx" ON "leads"("tenant_id", "contact_id");
CREATE INDEX "leads_tenant_id_owner_id_idx" ON "leads"("tenant_id", "owner_id");
CREATE INDEX "leads_tenant_id_next_follow_up_at_idx" ON "leads"("tenant_id", "next_follow_up_at");

ALTER TABLE "lead_pipelines" ADD CONSTRAINT "lead_pipelines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_stages" ADD CONSTRAINT "lead_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_stages" ADD CONSTRAINT "lead_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "lead_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "lead_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "lead_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "modules" ("id", "key", "name", "description", "category", "icon", "sort_order", "controllable", "created_at", "updated_at")
VALUES ('a0000000-0000-4000-8000-000000000006', 'leads', 'Painel de Leads', 'Funil comercial e acompanhamento de leads.', 'CRM', 'KanbanSquare', 25, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "lead_pipelines" ("id", "tenant_id", "name", "description", "active", "created_at", "updated_at")
SELECT md5('lead-pipeline:' || "id"::text)::uuid, "id", 'Pipeline comercial', 'Fluxo comercial padrão', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants"
ON CONFLICT ("tenant_id", "name") DO NOTHING;

INSERT INTO "lead_stages" ("id", "tenant_id", "pipeline_id", "name", "color", "position", "kind", "created_at", "updated_at")
SELECT md5('lead-stage:' || p."id"::text || ':' || stage."position"::text)::uuid, p."tenant_id", p."id", stage."name", stage."color", stage."position", stage."kind"::"LeadStageKind", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "lead_pipelines" p
CROSS JOIN (VALUES
  ('Novo lead', '#3b82f6', 1, 'OPEN'),
  ('Entrou em contato', '#06b6d4', 2, 'OPEN'),
  ('Qualificado', '#8b5cf6', 3, 'OPEN'),
  ('Proposta enviada', '#f59e0b', 4, 'OPEN'),
  ('Pagamento', '#f97316', 5, 'OPEN'),
  ('Venda ganha', '#22c55e', 6, 'WON'),
  ('Perdido', '#ef4444', 7, 'LOST')
) AS stage("name", "color", "position", "kind")
WHERE p."name" = 'Pipeline comercial'
ON CONFLICT ("pipeline_id", "position") DO NOTHING;
