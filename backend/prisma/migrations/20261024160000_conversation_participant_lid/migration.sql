-- Alternate LID captured from WhatsApp group metadata. Participant addresses
-- may arrive as either `@lid` or `@s.whatsapp.net`; the preferred JID remains in
-- `jid` and this column keeps the other address for exact identity resolution.
ALTER TABLE "conversation_participants" ADD COLUMN "lid" TEXT;

CREATE INDEX "conversation_participants_tenant_id_conversation_id_lid_idx"
  ON "conversation_participants"("tenant_id", "conversation_id", "lid");
