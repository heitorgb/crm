-- AlterEnum
ALTER TYPE "ConversationStatus" ADD VALUE 'OPEN';

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_customer_id_fkey";

-- AlterTable
ALTER TABLE "contacts" ALTER COLUMN "customer_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_phone_key" ON "contacts"("tenant_id", "phone");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
