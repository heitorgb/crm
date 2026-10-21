-- CreateTable
CREATE TABLE "custom_menu_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_menu_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_menu_buttons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_menu_buttons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_menu_groups_tenant_id_active_position_idx" ON "custom_menu_groups"("tenant_id", "active", "position");

-- CreateIndex
CREATE INDEX "custom_menu_buttons_tenant_id_group_id_active_position_idx" ON "custom_menu_buttons"("tenant_id", "group_id", "active", "position");

-- AddForeignKey
ALTER TABLE "custom_menu_groups" ADD CONSTRAINT "custom_menu_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_menu_buttons" ADD CONSTRAINT "custom_menu_buttons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_menu_buttons" ADD CONSTRAINT "custom_menu_buttons_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "custom_menu_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
