-- Days of week (ISO-8601: 1 = Monday ... 7 = Sunday) used by DAILY schedules.
-- An empty array preserves the legacy behavior: send every day.
ALTER TABLE "scheduled_messages" ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
