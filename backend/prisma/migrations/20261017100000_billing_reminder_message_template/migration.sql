-- Richer default reminder message: WhatsApp formatting, BR date and the
-- organization name (`{nome_empresa}`). Tenants that still use the previous
-- default are migrated; custom templates are preserved untouched.
DO $migration$
DECLARE
  new_template text := $tpl$Olá, *{cliente}*! 👋

Passando para lembrar de uma cobrança que está próxima do vencimento.

📋 *Descrição:* {descricao}
💰 *Valor:* {valor}
📅 *Vencimento:* {vencimento}

Pedimos que se organize para realizar o pagamento até a data informada.

Se já realizou o pagamento, por favor, desconsidere esta mensagem.

Em caso de dúvidas, estamos à disposição!

*{nome_empresa}*$tpl$;
BEGIN
  EXECUTE format(
    'ALTER TABLE "billing_settings" ALTER COLUMN "message_template" SET DEFAULT %L',
    new_template
  );

  UPDATE "billing_settings"
    SET "message_template" = new_template
    WHERE "message_template" IN (
      'Olá {cliente}! Passando para lembrar da cobrança "{descricao}" no valor de {valor}, com vencimento em {vencimento}.',
      'Olá {cliente}! Lembrete da cobrança "{descricao}" no valor de {valor}, com vencimento em {vencimento}.'
    );
END
$migration$;
