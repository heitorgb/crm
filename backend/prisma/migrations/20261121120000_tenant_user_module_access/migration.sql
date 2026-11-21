CREATE TABLE "tenant_user_modules" (
    "tenant_id" UUID NOT NULL,
    "tenant_user_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_user_modules_pkey" PRIMARY KEY ("tenant_user_id","module_id")
);

CREATE INDEX "tenant_user_modules_tenant_id_module_id_idx" ON "tenant_user_modules"("tenant_id", "module_id");

ALTER TABLE "tenant_user_modules" ADD CONSTRAINT "tenant_user_modules_tenant_id_tenant_user_id_fkey" FOREIGN KEY ("tenant_id", "tenant_user_id") REFERENCES "tenant_users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_user_modules" ADD CONSTRAINT "tenant_user_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
