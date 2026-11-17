CREATE TABLE "message_hidden_for_users" (
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_hidden_for_users_pkey" PRIMARY KEY ("user_id", "message_id")
);

CREATE INDEX "message_hidden_for_users_tenant_id_message_id_idx"
  ON "message_hidden_for_users"("tenant_id", "message_id");

ALTER TABLE "message_hidden_for_users"
  ADD CONSTRAINT "message_hidden_for_users_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
