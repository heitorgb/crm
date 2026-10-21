-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'DEEPSEEK', 'CLOUDFLARE');

-- CreateEnum
CREATE TYPE "AiFormality" AS ENUM ('PROFESSIONAL', 'FORMAL', 'VERY_FORMAL');

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL DEFAULT 'OPENAI',
    "model" TEXT NOT NULL,
    "formality" "AiFormality" NOT NULL DEFAULT 'PROFESSIONAL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "openai_api_key_encrypted" TEXT,
    "deepseek_api_key_encrypted" TEXT,
    "cloudflare_api_token_encrypted" TEXT,
    "cloudflare_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_tenant_id_key" ON "ai_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
