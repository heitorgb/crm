-- CreateTable
CREATE TABLE "message_reactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "target_external_id" TEXT NOT NULL,
    "target_from_me" BOOLEAN NOT NULL DEFAULT false,
    "reactor_id" TEXT NOT NULL,
    "reactor_name" TEXT,
    "from_me" BOOLEAN NOT NULL DEFAULT false,
    "emoji" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_target_reactor_key" ON "message_reactions"("tenant_id", "conversation_id", "target_external_id", "reactor_id");

-- CreateIndex
CREATE INDEX "message_reactions_tenant_conversation_idx" ON "message_reactions"("tenant_id", "conversation_id");

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate reactions previously stored as standalone Message rows.
INSERT INTO "message_reactions" (
    "id",
    "tenant_id",
    "conversation_id",
    "target_external_id",
    "target_from_me",
    "reactor_id",
    "reactor_name",
    "from_me",
    "emoji",
    "occurred_at",
    "updated_at"
)
SELECT
    m."id",
    m."tenant_id",
    m."conversation_id",
    m."metadata" -> 'reaction' ->> 'targetMessageId',
    CASE
        WHEN m."metadata" -> 'reaction' ->> 'targetFromMe' IN ('true', 'false')
            THEN (m."metadata" -> 'reaction' ->> 'targetFromMe')::boolean
        ELSE false
    END,
    CASE
        WHEN m."direction" = 'OUTBOUND' THEN 'self'
        ELSE COALESCE(m."sender_id", 'unknown:' || m."id"::text)
    END,
    m."sender_name",
    m."direction" = 'OUTBOUND',
    m."content",
    m."occurred_at",
    CURRENT_TIMESTAMP
FROM "messages" m
WHERE m."type" = 'REACTION'
  AND m."metadata" -> 'reaction' ->> 'targetMessageId' IS NOT NULL
  AND m."content" IS NOT NULL
  AND m."content" <> ''
ON CONFLICT ("tenant_id", "conversation_id", "target_external_id", "reactor_id") DO UPDATE SET
    "target_from_me" = EXCLUDED."target_from_me",
    "reactor_name" = EXCLUDED."reactor_name",
    "from_me" = EXCLUDED."from_me",
    "emoji" = EXCLUDED."emoji",
    "occurred_at" = EXCLUDED."occurred_at",
    "updated_at" = CURRENT_TIMESTAMP
WHERE EXCLUDED."occurred_at" >= "message_reactions"."occurred_at";

-- Recompute the conversation preview without the reaction rows that are removed below.
UPDATE "conversations" c
SET "last_message_at" = (
    SELECT MAX(m."occurred_at")
    FROM "messages" m
    WHERE m."conversation_id" = c."id"
      AND m."type" <> 'REACTION'
)
WHERE c."id" IN (
    SELECT "conversation_id" FROM "messages" WHERE "type" = 'REACTION'
);

DELETE FROM "messages" WHERE "type" = 'REACTION';
