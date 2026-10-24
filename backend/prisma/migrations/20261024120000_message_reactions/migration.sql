-- CreateTable
CREATE TABLE IF NOT EXISTS "message_reactions" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_target_reactor_key" ON "message_reactions"("tenant_id", "conversation_id", "target_external_id", "reactor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_reactions_tenant_conversation_idx" ON "message_reactions"("tenant_id", "conversation_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "pg_constraint"
        WHERE "conname" = 'message_reactions_tenant_id_fkey'
          AND "conrelid" = to_regclass('message_reactions')
    ) THEN
        ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "pg_constraint"
        WHERE "conname" = 'message_reactions_conversation_id_fkey'
          AND "conrelid" = to_regclass('message_reactions')
    ) THEN
        ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Migrate reactions previously stored as standalone Message rows.
-- Keep only the latest reaction per (tenant, conversation, target, reactor), since
-- multiple REACTION rows may map to the same unique key and ON CONFLICT cannot
-- update the same row twice within a single statement.
-- The migration must be retryable: rows written by a previous failed attempt are
-- updated in place instead of aborting with a unique constraint violation.
WITH "reaction_rows" AS (
    SELECT
        m."id",
        m."tenant_id",
        m."conversation_id",
        m."metadata" -> 'reaction' ->> 'targetMessageId' AS "target_external_id",
        m."metadata" -> 'reaction' ->> 'targetFromMe' AS "target_from_me_raw",
        CASE
            WHEN m."direction" = 'OUTBOUND' THEN 'self'
            ELSE COALESCE(m."sender_id", 'unknown:' || m."id"::text)
        END AS "reactor_id",
        m."sender_name",
        m."direction" = 'OUTBOUND' AS "from_me",
        m."content",
        m."occurred_at",
        ROW_NUMBER() OVER (
            PARTITION BY
                m."tenant_id",
                m."conversation_id",
                m."metadata" -> 'reaction' ->> 'targetMessageId',
                CASE
                    WHEN m."direction" = 'OUTBOUND' THEN 'self'
                    ELSE COALESCE(m."sender_id", 'unknown:' || m."id"::text)
                END
            ORDER BY m."occurred_at" DESC, m."id" DESC
        ) AS "position"
    FROM "messages" m
    WHERE m."type" = 'REACTION'
      AND m."metadata" -> 'reaction' ->> 'targetMessageId' IS NOT NULL
      AND m."content" IS NOT NULL
      AND m."content" <> ''
)
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
    m."target_external_id",
    CASE
        WHEN m."target_from_me_raw" IN ('true', 'false')
            THEN m."target_from_me_raw"::boolean
        ELSE false
    END,
    m."reactor_id",
    m."sender_name",
    m."from_me",
    m."content",
    m."occurred_at",
    CURRENT_TIMESTAMP
FROM "reaction_rows" m
WHERE m."position" = 1
ON CONFLICT ("tenant_id", "conversation_id", "target_external_id", "reactor_id") DO UPDATE
SET
    "target_from_me" = EXCLUDED."target_from_me",
    "reactor_name" = EXCLUDED."reactor_name",
    "from_me" = EXCLUDED."from_me",
    "emoji" = EXCLUDED."emoji",
    "occurred_at" = EXCLUDED."occurred_at",
    "updated_at" = CURRENT_TIMESTAMP;

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
