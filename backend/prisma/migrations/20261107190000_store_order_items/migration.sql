ALTER TABLE "store_orders"
  ADD COLUMN "items" JSONB,
  ADD COLUMN "total_amount" DECIMAL(14,4);
