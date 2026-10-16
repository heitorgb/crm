-- AlterTable
ALTER TABLE "billing_charges" ALTER COLUMN "customer_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "billing_recurrences" ALTER COLUMN "customer_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "billing_charges_tenant_id_contact_id_idx" ON "billing_charges"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "billing_recurrences_tenant_id_contact_id_idx" ON "billing_recurrences"("tenant_id", "contact_id");
