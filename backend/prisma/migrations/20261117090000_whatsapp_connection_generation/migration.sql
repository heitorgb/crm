CREATE TYPE "WhatsAppConnectionIntent" AS ENUM ('NONE', 'CONNECT', 'DISCONNECT');

ALTER TABLE "whatsapp_instances"
  ADD COLUMN "connection_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "connection_intent" "WhatsAppConnectionIntent" NOT NULL DEFAULT 'NONE';
