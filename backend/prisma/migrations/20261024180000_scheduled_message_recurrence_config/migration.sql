-- Recurring clock time ("HH:mm") and configured day of month, separated from the
-- first execution instant stored in "scheduled_at".
ALTER TABLE "scheduled_messages" ADD COLUMN "day_of_month" INTEGER;
ALTER TABLE "scheduled_messages" ADD COLUMN "recurring_time" VARCHAR(5);

-- Backfill the explicit recurring time for existing recurring schedules. The
-- value is preserved in each schedule timezone.
UPDATE "scheduled_messages"
SET "recurring_time" = to_char("scheduled_at" AT TIME ZONE 'UTC' AT TIME ZONE "time_zone", 'HH24:MI')
WHERE "recurrence" <> 'ONCE';

-- Backfill the configured day of month for existing MONTHLY schedules.
UPDATE "scheduled_messages"
SET "day_of_month" = EXTRACT(DAY FROM ("scheduled_at" AT TIME ZONE 'UTC' AT TIME ZONE "time_zone"))::int
WHERE "recurrence" = 'MONTHLY';

-- Legacy DAILY schedules with an empty selection meant "every day". Persist the
-- same behavior explicitly so future edits do not change the effective days.
UPDATE "scheduled_messages"
SET "weekdays" = ARRAY[1, 2, 3, 4, 5, 6, 7]
WHERE "recurrence" = 'DAILY' AND cardinality("weekdays") = 0;

-- Legacy WEEKLY schedules always repeated on the weekday of the first
-- execution. Persist that weekday explicitly, preserving the old behavior.
UPDATE "scheduled_messages"
SET "weekdays" = ARRAY[
  EXTRACT(ISODOW FROM ("scheduled_at" AT TIME ZONE 'UTC' AT TIME ZONE "time_zone"))::int
]
WHERE "recurrence" = 'WEEKLY' AND cardinality("weekdays") = 0;
