-- Antes da correção, erros 400 de formato de áudio (OGG/Opus) eram
-- classificados como modelo indisponível. Esses registros continuam válidos,
-- mas precisam permitir nova tentativa com o fluxo corrigido.
UPDATE "message_transcriptions"
SET "retryable" = true,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'FAILED'
  AND "error_code" = 'AI_TRANSCRIPTION_MODEL_UNAVAILABLE';
