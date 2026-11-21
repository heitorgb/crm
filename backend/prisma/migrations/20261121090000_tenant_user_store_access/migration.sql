CREATE UNIQUE INDEX "tenant_users_tenant_id_id_key" ON "tenant_users"("tenant_id", "id");

CREATE TABLE "tenant_user_stores" (
    "tenant_id" UUID NOT NULL,
    "tenant_user_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_user_stores_pkey" PRIMARY KEY ("tenant_user_id","store_id")
);

CREATE INDEX "tenant_user_stores_tenant_id_store_id_idx" ON "tenant_user_stores"("tenant_id", "store_id");

ALTER TABLE "tenant_user_stores" ADD CONSTRAINT "tenant_user_stores_tenant_id_tenant_user_id_fkey" FOREIGN KEY ("tenant_id", "tenant_user_id") REFERENCES "tenant_users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_user_stores" ADD CONSTRAINT "tenant_user_stores_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
