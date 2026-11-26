ALTER TABLE "stores" ADD COLUMN "separation_reminder_minutes" INTEGER;
ALTER TABLE "store_orders" ADD COLUMN "separation_reminder_sent_at" TIMESTAMP(3);
