# Mensagens agendadas — OrderUp CRM

> Status: **Implementado**. Campanhas e lembretes agendados por WhatsApp, com recorrência,
> anexo opcional, seleção de conversas, logs por destinatário e retry.

Complementa [`attendance.md`](./attendance.md), [`media.md`](./media.md) e [`billing.md`](./billing.md).

## Visão geral

- **Tipos:** `CAMPAIGN` (campanha) e `REMINDER` (lembrete).
- **Recorrência:** `ONCE`, `DAILY`, `WEEKLY`, `MONTHLY`.
- **Dias da semana:** em `DAILY`, a recorrência pode ser limitada a dias específicos (ISO-8601,
  `1` = segunda ... `7` = domingo).
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
`attachmentSize`), `recurrence`, `weekdays` (`INTEGER[]`, padrão `[]`), `timeZone`, `scheduledAt`,
`nextRunAt?`, `lastRunAt?`, `recipientCount`, `status`, `canceledAt?`.

### `ScheduledMessageRecipient`

Uma linha por destinatário **por ocorrência** (`scheduledFor`), funcionando como log e como fila:

`tenantId`, `scheduledMessageId`, `scheduledFor`, `recipientKey`, `conversationId?`, `contactId?`,
`recipientName`, `destination`, `whatsappInstanceId?`, `status`, `attempts`, `nextAttemptAt?`,
`externalMessageId?`, `messageId?`, `errorCode?`, `errorMessage?`, `processedAt?`.

Constraints: `UNIQUE (scheduledMessageId, scheduledFor, recipientKey)`. A recorrência clona as
definições para a próxima ocorrência, preservando o histórico das anteriores.

## Dias da semana (`DAILY`)

A recorrência `DAILY` aceita uma lista de dias da semana em `weekdays`, usando a convenção
ISO-8601:

| Dia            | Valor |
| -------------- | ----- |
| Segunda-feira  | 1     |
| Terça-feira    | 2     |
| Quarta-feira   | 3     |
| Quinta-feira   | 4     |
| Sexta-feira    | 5     |
| Sábado         | 6     |
| Domingo        | 7     |

- A lista é persistida ordenada e sem duplicatas.
- Para `DAILY`, a seleção precisa ter ao menos um dia válido. O backend rejeita lista vazia,
  valores fora de `1..7`, valores não inteiros e dias repetidos.
- O frontend inicia uma nova recorrência diária com os sete dias marcados e permite desmarcar.
- Ao editar, os dias salvos são carregados; um `PATCH` sem `weekdays` preserva a seleção atual.
- `weekdays` só é considerado em `DAILY`. `ONCE`, `WEEKLY` e `MONTHLY` ignoram o campo e o
  persistem como `[]`.
- **Compatibilidade:** agendamentos `DAILY` antigos possuem `weekdays = []`. Uma lista vazia
  significa "todos os dias" e continua funcionando assim até que o agendamento seja editado e
  salvo com uma seleção explícita. A interface carrega os sete dias marcados nesse caso.
- A primeira ocorrência respeita a data/hora informadas. As seguintes mantêm o mesmo horário
  local e avançam para o próximo dia selecionado, inclusive na semana seguinte. A repetição é
  indefinida; não existe data final automática.

Exemplo: `weekdays = [1, 3, 5]` às `09:00` envia segunda, quarta e sexta às `09:00` em
`America/Sao_Paulo`, indefinidamente, até ser finalizado por um usuário autorizado.

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
   `nextRunAt` no fuso configurado (respeitando `weekdays` em `DAILY`) e clonam os destinatários
   para a próxima ocorrência.
8. `cancel` (ação **Finalizar recorrência** na interface) marca o agendamento como `CANCELED`,
   limpa `nextRunAt` e marca os destinatários pendentes/em processamento como `SKIPPED`. O
   histórico e os envios anteriores são preservados. `CANCELED` é terminal e suficiente para
   representar o encerramento; não há novo status.

### Concorrência e encerramento

- O envio só reivindica um destinatário se o agendamento ainda não estiver `CANCELED`
  (verificação condicional na própria atualização), impedindo novos envios evitáveis depois do
  encerramento.
- A transição da próxima ocorrência (`SCHEDULED`/`PROCESSING → SCHEDULED`) e a clonagem dos
  destinatários acontecem na mesma transação, com condições em `status` e
  `nextRunAt = scheduledFor`. Se o agendamento tiver sido encerrado ou já avançado, a atualização
  afeta zero linhas e nenhuma nova ocorrência é criada.
- `CANCELED` nunca é sobrescrito por `SCHEDULED`; um job antigo ou duplicado não reativa a
  recorrência. O retry automático também ignora destinatários de agendamentos cancelados.
- Destinatários que já estavam em `PROCESSING` podem concluir o envio externo em andamento e
  registrar `SENT`/`FAILED`. Não há cancelamento retroativo de uma mensagem já entregue ao
  WhatsApp.

O scan também recupera destinatários/agendamentos travados em `PROCESSING` por mais de 15 minutos e
reenfileira falhas vencidas.

## Validações

- Data/hora deve estar no futuro no fuso `America/Sao_Paulo`.
- Título e texto obrigatórios.
- Ao menos um destinatário e no máximo `SCHEDULED_MESSAGE_MAX_RECIPIENTS` (100).
- `DAILY` exige ao menos um dia em `weekdays`; valores devem ser inteiros de `1` a `7`, sem
  repetição. O backend valida independentemente do frontend.
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
`weekdays` (JSON array, ex.: `[1,3,5]`; em `DAILY`, quando enviado, precisa ter ao menos um dia),
`scheduledAt` (`YYYY-MM-DDTHH:mm`), `recipientConversationIds` (JSON array), `file?` e
`removeAttachment?`. Em `POST` `DAILY` sem `weekdays`, assume os sete dias (compatibilidade). Em
`PATCH`, omitir `weekdays` preserva a seleção atual.

`POST /api/scheduled-messages/:id/cancel` finaliza a programação. Para recorrências, a interface
apresenta a ação como **Finalizar recorrência** e informa que não haverá novos envios; a ação
exige `OWNER`/`ADMIN`, pede confirmação e fica desabilitada durante a requisição.

## Frontend

- Rota `/mensagens-agendadas` (Ferramentas → Mensagens agendadas), com atalho em Cobranças.
- Listagem mobile-first com filtros por texto/tipo/status, status, próximo envio e quantidade de
  destinatários.
- Formulário com tipo, título, texto, variáveis, valor opcional, anexo, destinatários com busca,
  seleção múltipla, selecionar todos e filtro por instância WhatsApp, data/hora e recorrência.
- Em `DAILY`, o formulário exibe um seletor acessível com os sete dias da semana (múltipla
  seleção, sem rolagem horizontal no mobile) e exige ao menos um dia.
- Os cards mostram a recorrência configurada, os dias selecionados, o horário e o próximo envio.
- Ações de editar, finalizar recorrência/cancelar, duplicar e histórico por ocorrência/destinatário,
  com reenvio de falhas. A finalização só aparece para agendamentos ativos e o histórico é
  preservado.

## Testes

- `test/unit/scheduled-messages/scheduled-message-time.spec.ts` cobre conversão de fuso,
  data futura, recorrência diária/mensal, todos os dias da semana, dia único, segunda/quarta/sexta,
  virada de domingo para segunda, preservação de horário, seleção vazia, dias inválidos/duplicados,
  compatibilidade com agendamentos antigos e renderização de variáveis.
- `test/unit/scheduled-messages/scheduled-messages.service.spec.ts` cobre validação e persistência
  dos dias, encerramento idempotente e transição atômica para `CANCELED`.
- `test/unit/scheduled-messages/scheduled-message-sender.service.spec.ts` cobre job antigo após
  encerramento, bloqueio de novos claims, `CANCELED` não revertido e clonagem da próxima ocorrência
  somente dentro da transação condicional.
- `test/unit/scheduled-messages/scheduled-messages.controller.spec.ts` garante `OWNER`/`ADMIN` nas
  ações de gerenciamento.
- A validação completa (CRUD, permissões, isolamento por tenant, anexos, logs, retry e recorrência)
  deve ser exercitada com PostgreSQL/Redis via `npm run test:e2e`.
