# Mensagens agendadas — OrderUp CRM

> Status: **Implementado**. Campanhas e lembretes agendados por WhatsApp, com recorrência,
> anexo opcional, seleção de conversas, logs por destinatário e retry.

Complementa [`attendance.md`](./attendance.md), [`media.md`](./media.md) e [`billing.md`](./billing.md).

## Visão geral

- **Tipos:** `CAMPAIGN` (campanha) e `REMINDER` (lembrete).
- **Recorrência:** `ONCE`, `DAILY`, `WEEKLY`, `MONTHLY`.
- **Status:** `SCHEDULED`, `PROCESSING`, `SENT`, `FAILED`, `CANCELED`.
- **Fuso:** `America/Sao_Paulo` (`SCHEDULED_MESSAGE_TIMEZONE`).
- **Destinatários:** conversas existentes (contato ou grupo), escolhidas por busca e filtro de
  instância WhatsApp.
- **Variáveis:** `{nome}` (nome do destinatário), `{empresa}` (nome do tenant) e `{valor}` (campo
  opcional do agendamento).
- **Anexo:** imagem (otimizada com `sharp`) ou PDF.
- **Permissões:** leitura autenticada; criar/editar/cancelar/duplicar/reenviar exige `OWNER`/`ADMIN`.

## Modelagem

### `ScheduledMessage`

`tenantId`, `createdByUserId`, `type`, `title`, `content`, `valor?`, dados do anexo
(`attachmentStorageKey`, `attachmentThumbnailKey`, `attachmentFileName`, `attachmentMimeType`,
`attachmentSize`), `recurrence`, `timeZone`, `scheduledAt`, `nextRunAt?`, `lastRunAt?`,
`recipientCount`, `status`, `canceledAt?`.

### `ScheduledMessageRecipient`

Uma linha por destinatário **por ocorrência** (`scheduledFor`), funcionando como log e como fila:

`tenantId`, `scheduledMessageId`, `scheduledFor`, `recipientKey`, `conversationId?`, `contactId?`,
`recipientName`, `destination`, `whatsappInstanceId?`, `status`, `attempts`, `nextAttemptAt?`,
`externalMessageId?`, `messageId?`, `errorCode?`, `errorMessage?`, `processedAt?`.

Constraints: `UNIQUE (scheduledMessageId, scheduledFor, recipientKey)`. A recorrência clona as
definições para a próxima ocorrência, preservando o histórico das anteriores.

## Agendamento e envio

1. O scan (`scheduled-message.scan`) roda a cada `SCHEDULED_MESSAGE_SCAN_INTERVAL_MS` (60 s) usando
   a fila existente (BullMQ; inline em testes).
2. Agendamentos `SCHEDULED` com `nextRunAt <= agora` são reivindicados atomicamente
   (`SCHEDULED → PROCESSING`) e o job `scheduled-message.send` é enfileirado.
3. O envio percorre os destinatários daquela ocorrência, com intervalo
   `SCHEDULED_MESSAGE_INTERVAL_MS` (padrão 1,5 s).
4. Cada destinatário é reivindicado atomicamente (`PENDING/FAILED → PROCESSING`) antes do envio,
   evitando duplicidade quando o job roda mais de uma vez.
5. Texto é enviado por `sendStoredTextToConversation`; imagem/PDF por
   `sendStoredMediaToConversation`. Ambos persistem a mensagem na conversa (Atendimento) e emitem
   realtime.
6. Falhas definitivas geram `FAILED` e `nextAttemptAt` com backoff exponencial (5 → 10 → 20 min,
   teto de 60 min). Após `SCHEDULED_MESSAGE_MAX_ATTEMPTS` (3), o destinatário fica `FAILED` e pode
   ser reenviado manualmente.
7. `ONCE` termina em `SENT` ou `FAILED`. Recorrentes voltam para `SCHEDULED`, calculam o próximo
   `nextRunAt` no fuso configurado e clonam os destinatários para a próxima ocorrência.
8. `cancel` marca o agendamento como `CANCELED` e os destinatários pendentes como `SKIPPED`.

O scan também recupera destinatários/agendamentos travados em `PROCESSING` por mais de 15 minutos e
reenfileira falhas vencidas.

## Validações

- Data/hora deve estar no futuro no fuso `America/Sao_Paulo`.
- Título e texto obrigatórios.
- Ao menos um destinatário e no máximo `SCHEDULED_MESSAGE_MAX_RECIPIENTS` (100).
- Destinatários precisam pertencer ao tenant e ter destino WhatsApp válido.
- Anexo deve ser imagem decodificável ou PDF e respeitar `MEDIA_MAX_BYTES`.
- Edição permitida apenas em `SCHEDULED`.

## Endpoints

| Método | Rota                                        | Acesso        |
| ------ | ------------------------------------------- | ------------- |
| GET    | `/api/scheduled-messages`                   | autenticado   |
| POST   | `/api/scheduled-messages`                   | OWNER/ADMIN   |
| GET    | `/api/scheduled-messages/:id`               | autenticado   |
| PATCH  | `/api/scheduled-messages/:id`               | OWNER/ADMIN   |
| POST   | `/api/scheduled-messages/:id/cancel`        | OWNER/ADMIN   |
| POST   | `/api/scheduled-messages/:id/duplicate`     | OWNER/ADMIN   |
| POST   | `/api/scheduled-messages/:id/retry`         | OWNER/ADMIN   |
| GET    | `/api/scheduled-messages/:id/logs`          | autenticado   |
| GET    | `/api/scheduled-messages/:id/recipients`    | autenticado   |
| GET    | `/api/scheduled-messages/:id/attachment`    | autenticado   |

`POST`/`PATCH` usam `multipart/form-data` com `type`, `title`, `content`, `valor`, `recurrence`,
`scheduledAt` (`YYYY-MM-DDTHH:mm`), `recipientConversationIds` (JSON array), `file?` e
`removeAttachment?`.

## Frontend

- Rota `/mensagens-agendadas` (Ferramentas → Mensagens agendadas), com atalho em Cobranças.
- Listagem mobile-first com filtros por texto/tipo/status, status, próximo envio e quantidade de
  destinatários.
- Formulário com tipo, título, texto, variáveis, valor opcional, anexo, destinatários com busca,
  seleção múltipla, selecionar todos e filtro por instância WhatsApp, data/hora e recorrência.
- Prévia da mensagem com variáveis preenchidas antes de confirmar.
- Ações de editar, cancelar, duplicar e histórico por ocorrência/destinatário, com reenvio de falhas.

## Testes

- `test/unit/scheduled-messages/scheduled-message-time.spec.ts` cobre conversão de fuso,
  data futura, recorrência diária/mensal e renderização de variáveis.
- A validação completa (CRUD, permissões, isolamento por tenant, anexos, logs, retry e recorrência)
  deve ser exercitada com PostgreSQL/Redis via `npm run test:e2e`.
