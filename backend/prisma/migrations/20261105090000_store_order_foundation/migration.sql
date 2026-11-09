CREATE TYPE "StoreOrderStatus" AS ENUM ('PENDENTE_SEPARACAO', 'SEPARANDO', 'SEPARADO', 'EM_ROTA', 'OBSERVACAO', 'ENTREGUE');
CREATE TYPE "DeliveryConfirmationMode" AS ENUM ('AUTOMATIC', 'MANUAL');
CREATE TYPE "DeliveryConfirmationSource" AS ENUM ('AUTOMATIC', 'MANUAL');

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_id_key" UNIQUE ("tenant_id", "id");

CREATE TABLE "stores" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "external_code" TEXT NOT NULL,
  "delivery_confirmation_mode" "DeliveryConfirmationMode" NOT NULL DEFAULT 'AUTOMATIC',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stores_tenant_id_id_key" ON "stores"("tenant_id", "id");
CREATE UNIQUE INDEX "stores_tenant_id_external_code_key" ON "stores"("tenant_id", "external_code");
CREATE INDEX "stores_tenant_id_active_idx" ON "stores"("tenant_id", "active");
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "store_orders" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "external_order_id" TEXT NOT NULL,
  "contact_id" UUID,
  "customer_name" TEXT,
  "order_text" TEXT,
  "status" "StoreOrderStatus" NOT NULL DEFAULT 'PENDENTE_SEPARACAO',
  "delivery_confirmation_mode" "DeliveryConfirmationMode",
  "delivery_confirmation_source" "DeliveryConfirmationSource",
  "entered_route_at" TIMESTAMP(3),
  "delivery_due_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_orders_tenant_id_id_key" ON "store_orders"("tenant_id", "id");
CREATE UNIQUE INDEX "store_orders_store_id_external_order_id_key" ON "store_orders"("store_id", "external_order_id");
CREATE INDEX "store_orders_tenant_id_store_id_status_idx" ON "store_orders"("tenant_id", "store_id", "status");
CREATE INDEX "store_orders_tenant_id_status_delivery_due_at_idx" ON "store_orders"("tenant_id", "status", "delivery_due_at");
CREATE INDEX "store_orders_tenant_id_contact_id_idx" ON "store_orders"("tenant_id", "contact_id");
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "store_order_status_changes" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "previous_status" "StoreOrderStatus",
  "status" "StoreOrderStatus" NOT NULL,
  "actor_membership_id" UUID,
  "origin" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_order_status_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "store_order_status_changes_tenant_id_order_id_created_at_idx" ON "store_order_status_changes"("tenant_id", "order_id", "created_at");
ALTER TABLE "store_order_status_changes" ADD CONSTRAINT "store_order_status_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_order_status_changes" ADD CONSTRAINT "store_order_status_changes_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "store_orders"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
