CREATE TABLE "contact_stores" (
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_stores_pkey" PRIMARY KEY ("contact_id","store_id")
);

CREATE INDEX "contact_stores_tenant_id_store_id_idx" ON "contact_stores"("tenant_id", "store_id");

ALTER TABLE "contact_stores" ADD CONSTRAINT "contact_stores_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_stores" ADD CONSTRAINT "contact_stores_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
