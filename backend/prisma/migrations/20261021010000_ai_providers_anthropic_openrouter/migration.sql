-- Add provider-specific credential columns
ALTER TABLE "ai_settings" ADD COLUMN "anthropic_api_key_encrypted" TEXT;
ALTER TABLE "ai_settings" ADD COLUMN "openrouter_api_key_encrypted" TEXT;

-- Legacy Cloudflare rows become an incomplete Anthropic configuration.
-- The Cloudflare token is cleared so it can never be reused by another provider.
UPDATE "ai_settings"
SET "model" = 'claude-haiku-5-5',
    "cloudflare_api_token_encrypted" = NULL,
    "cloudflare_account_id" = NULL
WHERE "provider" = 'CLOUDFLARE';

-- Replace the provider enum, mapping legacy rows to ANTHROPIC.
ALTER TABLE "ai_settings" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TYPE "AiProvider" RENAME TO "AiProvider_old";
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'DEEPSEEK', 'ANTHROPIC', 'OPENROUTER');
ALTER TABLE "ai_settings"
    ALTER COLUMN "provider" TYPE "AiProvider"
    USING (
        CASE
            WHEN "provider"::text = 'CLOUDFLARE' THEN 'ANTHROPIC'
            ELSE "provider"::text
        END
    )::"AiProvider";
ALTER TABLE "ai_settings" ALTER COLUMN "provider" SET DEFAULT 'OPENAI';
DROP TYPE "AiProvider_old";

-- Cloudflare-only columns are no longer part of the product.
ALTER TABLE "ai_settings" DROP COLUMN "cloudflare_api_token_encrypted";
ALTER TABLE "ai_settings" DROP COLUMN "cloudflare_account_id";
