CREATE TABLE "lead_tags" (
    "lead_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("lead_id", "tag_id")
);

CREATE TABLE "conversation_tags" (
    "conversation_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("conversation_id", "tag_id")
);

CREATE INDEX "lead_tags_tenant_id_tag_id_idx" ON "lead_tags"("tenant_id", "tag_id");
CREATE INDEX "conversation_tags_tenant_id_tag_id_idx" ON "conversation_tags"("tenant_id", "tag_id");

ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
