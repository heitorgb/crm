-- CreateEnum
CREATE TYPE "BillingChargeStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingRecurrenceFrequency" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "BillingReminderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "billing_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contact_id" UUID,
    "recurrence_id" UUID,
    "description" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "BillingChargeStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "paid_by_user_id" UUID,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_recurrences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contact_id" UUID,
    "description" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "frequency" "BillingRecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "start_date" DATE NOT NULL,
    "next_run_date" DATE NOT NULL,
    "end_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_offsets" JSONB NOT NULL DEFAULT '[-3, 0, 3]',
    "message_template" TEXT NOT NULL DEFAULT 'Olá {cliente}! Lembrete da cobrança "{descricao}" no valor de {valor}, com vencimento em {vencimento}.',
    "whatsapp_instance_id" UUID,
    "send_window_start_hour" INTEGER NOT NULL DEFAULT 9,
    "send_window_end_hour" INTEGER NOT NULL DEFAULT 18,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_reminders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "scheduled_for" DATE NOT NULL,
    "status" "BillingReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "destination" TEXT,
    "whatsapp_instance_id" UUID,
    "external_message_id" TEXT,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_charges_tenant_id_status_idx" ON "billing_charges"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "billing_charges_tenant_id_due_date_idx" ON "billing_charges"("tenant_id", "due_date");

-- CreateIndex
CREATE INDEX "billing_charges_tenant_id_customer_id_idx" ON "billing_charges"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_charges_recurrence_id_due_date_key" ON "billing_charges"("recurrence_id", "due_date");

-- CreateIndex
CREATE INDEX "billing_recurrences_tenant_id_active_idx" ON "billing_recurrences"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "billing_recurrences_tenant_id_customer_id_idx" ON "billing_recurrences"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_settings_tenant_id_key" ON "billing_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "billing_reminders_tenant_id_status_idx" ON "billing_reminders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "billing_reminders_tenant_id_created_at_idx" ON "billing_reminders"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_reminders_charge_id_offset_days_key" ON "billing_reminders"("charge_id", "offset_days");

-- AddForeignKey
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_recurrence_id_fkey" FOREIGN KEY ("recurrence_id") REFERENCES "billing_recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_recurrences" ADD CONSTRAINT "billing_recurrences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_recurrences" ADD CONSTRAINT "billing_recurrences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_recurrences" ADD CONSTRAINT "billing_recurrences_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_whatsapp_instance_id_fkey" FOREIGN KEY ("whatsapp_instance_id") REFERENCES "whatsapp_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_reminders" ADD CONSTRAINT "billing_reminders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_reminders" ADD CONSTRAINT "billing_reminders_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "billing_charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
