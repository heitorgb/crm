-- Global platform settings. The singleton row starts with link previews
-- disabled, matching the safe default for new and existing installations.
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "link_previews_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_settings" ("id", "link_previews_enabled", "created_at", "updated_at")
VALUES ('global', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
