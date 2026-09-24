-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "group_name" TEXT,
ADD COLUMN     "is_group" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "sender_id" TEXT,
ADD COLUMN     "sender_name" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_avatars" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "whatsapp_instance_id" UUID NOT NULL,
    "jid" TEXT NOT NULL,
    "url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_avatars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_avatars_tenant_id_idx" ON "whatsapp_avatars"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_avatars_whatsapp_instance_id_jid_key" ON "whatsapp_avatars"("whatsapp_instance_id", "jid");

-- AddForeignKey
ALTER TABLE "whatsapp_avatars" ADD CONSTRAINT "whatsapp_avatars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_avatars" ADD CONSTRAINT "whatsapp_avatars_whatsapp_instance_id_fkey" FOREIGN KEY ("whatsapp_instance_id") REFERENCES "whatsapp_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
