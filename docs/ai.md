# IA — OrderUp CRM

> Status: **Fundação**. Nenhuma chamada a provedor de IA é feita nesta fase. Este documento
> registra apenas a configuração, as responsabilidades e os limites atuais.

## Objetivo

Preparar a configuração técnica para o futuro uso de IA (interpretação de respostas e escolha da
próxima pergunta do bot de qualificação), **sem** acoplar o projeto a um provedor.

## Configuração (validada em `src/config/env.validation.ts`)

| Variável         | Obrigatória                    | Default | Observações                       |
| ---------------- | ------------------------------ | ------- | --------------------------------- |
| `AI_PROVIDER`    | não                            | —       | Ex.: `openai`, `anthropic`, ...   |
| `AI_MODEL`       | quando `AI_PROVIDER` definido  | —       | Modelo a usar                     |
| `AI_API_KEY`     | quando `AI_PROVIDER` definido  | —       | **Nunca** logada                  |
| `AI_BASE_URL`    | não                            | —       | Para provedores self-hosted/proxy |
| `AI_TIMEOUT_MS`  | não                            | `30000` | Timeout de chamada                |
| `AI_MAX_RETRIES` | não                            | `2`     | Tentativas em falha transitória   |

Regras aplicadas na validação:

- valores vazios são tratados como ausentes;
- definir `AI_PROVIDER` exige `AI_MODEL` **e** `AI_API_KEY`;
- `AI_BASE_URL`, quando presente, precisa ser uma URL válida.

## Responsabilidades desta fase

- Validar e tipar as variáveis de IA na inicialização.
- Permitir trocar provedor/modelo por configuração, sem espalhar condicionais pelo código.
- Nunca registrar `AI_API_KEY` (ver redaction em `src/common/logging/logger.config.ts`).

## Limites / não implementado

- Nenhum SDK de IA instalado e nenhuma chamada de rede.
- Nenhum provider/adapter concreto: a interface `AiProvider` será criada quando houver consumidor
  real (fase do motor de qualificação).
- **Contexto de negócio, critérios, perguntas, tom e regras de qualificação são dados do tenant**,
  editáveis em banco — não ficam em variáveis de ambiente nem em código.
- O bot **não** possui contexto global compartilhado entre tenants.
- Execução assíncrona futura usará Redis/BullMQ, reestabelecendo `tenantId` no início do job.
- Entrega de leads qualificados terá horário/timezone por usuário/membership.

## Segurança

- A chave nunca é devolvida em respostas nem escrita em logs.
- Prompts e respostas não devem expor dados de outro tenant; todo contexto é escopado por tenant.

Ver também [`qualification-bot.md`](./qualification-bot.md) e
[`mvp-bot-qualificador.md`](./mvp-bot-qualificador.md).
