-- Add the per-tenant WhatsApp instance limit. Existing organizations receive
-- the default value of 3, matching new organizations.
ALTER TABLE "tenants" ADD COLUMN "whatsapp_instance_limit" INTEGER NOT NULL DEFAULT 3;
