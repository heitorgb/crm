ALTER TABLE "stores" ADD COLUMN "whatsapp_instance_id" UUID;
ALTER TABLE "stores" ADD CONSTRAINT "stores_whatsapp_instance_id_fkey" FOREIGN KEY ("whatsapp_instance_id") REFERENCES "whatsapp_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
