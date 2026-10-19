-- CreateTable
CREATE TABLE "link_previews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "url_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "title" TEXT,
    "description" TEXT,
    "image_url" TEXT,
    "site_name" TEXT,
    "domain" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_previews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "link_previews_tenant_id_url_key_key" ON "link_previews"("tenant_id", "url_key");

-- CreateIndex
CREATE INDEX "link_previews_tenant_id_expires_at_idx" ON "link_previews"("tenant_id", "expires_at");

-- AddForeignKey
ALTER TABLE "link_previews" ADD CONSTRAINT "link_previews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
