# Mensagens agendadas — OrderUp CRM

> Status: **Implementado**. Campanhas e lembretes agendados por WhatsApp, com recorrência,
> anexo opcional, seleção de conversas, logs por destinatário e retry.

Complementa [`attendance.md`](./attendance.md), [`media.md`](./media.md) e [`billing.md`](./billing.md).

## Visão geral

- **Tipos:** `CAMPAIGN` (campanha) e `REMINDER` (lembrete).
- **Recorrência:** `ONCE`, `DAILY`, `WEEKLY`, `MONTHLY`.
- **Dias da semana:** `DAILY` e `WEEKLY` usam `weekdays` (ISO-8601, `1` = segunda ... `7` =
  domingo).
- **Dia do mês:** `MONTHLY` usa `dayOfMonth` (`1..31`).
- **Horário recorrente:** `recurringTime` (`HH:mm`) separa o horário das recorrências da data da
  primeira execução.
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
`attachmentSize`), `recurrence`, `weekdays` (`INTEGER[]`, padrão `[]`), `dayOfMonth` (`INTEGER?`),
`recurringTime` (`VARCHAR(5)?`), `timeZone`, `scheduledAt`, `nextRunAt?`, `lastRunAt?`,
`recipientCount`, `status`, `canceledAt?`.

- `scheduledAt` é sempre a **primeira execução** (ou a próxima execução recalculada após uma
  edição). Para recorrências, o backend calcula esse instante a partir de `recurringTime`,
  `weekdays`/`dayOfMonth`, do fuso configurado e do momento atual.
- `recurringTime` guarda apenas o horário local (`HH:mm`) das recorrências. `ONCE` mantém `null`.
- `dayOfMonth` só é usado por `MONTHLY`. As demais recorrências mantêm `null`.
- `weekdays` só é usado por `DAILY` e `WEEKLY`. As demais recorrências mantêm `[]`.

### `ScheduledMessageRecipient`

Uma linha por destinatário **por ocorrência** (`scheduledFor`), funcionando como log e como fila:

`tenantId`, `scheduledMessageId`, `scheduledFor`, `recipientKey`, `conversationId?`, `contactId?`,
`recipientName`, `destination`, `whatsappInstanceId?`, `status`, `attempts`, `nextAttemptAt?`,
`externalMessageId?`, `messageId?`, `errorCode?`, `errorMessage?`, `processedAt?`.

Constraints: `UNIQUE (scheduledMessageId, scheduledFor, recipientKey)`. A recorrência clona as
definições para a próxima ocorrência, preservando o histórico das anteriores.

## Configuração por recorrência

| Recorrência | Campos exibidos e aceitos                              | Regra da próxima execução |
| ----------- | ------------------------------------------------------ | ------------------------- |
| `ONCE`      | Data e hora completas (`scheduledAt`).                 | Exatamente a data/hora informada, que precisa estar no futuro. |
| `DAILY`     | Dias da semana (`weekdays`) e horário (`recurringTime`). | Próximo dia selecionado a partir de agora, no horário recorrente. |
| `WEEKLY`    | Dias da semana (`weekdays`) e horário (`recurringTime`). | Mesma regra da diária: respeita **todos** os dias selecionados. |
| `MONTHLY`   | Dia do mês (`dayOfMonth`, 1–31) e horário (`recurringTime`). | O dia configurado no mês atual (se ainda futuro) ou no próximo mês. |

### Dias da semana (`DAILY` e `WEEKLY`)

A lista usa a convenção ISO-8601:

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
- `DAILY` e `WEEKLY` exigem ao menos um dia válido. O backend rejeita lista vazia, valores fora de
  `1..7`, valores não inteiros e dias repetidos.
- No frontend, uma **nova** programação começa com todos os dias desmarcados e exige seleção
  explícita.
- Ao editar, os dias salvos são carregados. Um `PATCH` sem `weekdays` preserva a seleção atual.
- `WEEKLY` não é mais "um dia fixo por semana": com `weekdays = [1, 4]`, a mensagem é enviada na
  segunda e na quinta, indefinidamente.
- `weekdays` é ignorado e persistido como `[]` em `ONCE` e `MONTHLY`.

### Dia do mês (`MONTHLY`)

- `dayOfMonth` deve ser um inteiro de `1` a `31`.
- Se o mês não tiver o dia escolhido (por exemplo, 31 em fevereiro ou abril), a ocorrência usa o
  **último dia disponível do mês**. A configuração original é preservada, então o mês seguinte
  volta a usar o dia 31 quando ele existir.
- `MONTHLY` não exibe nem aceita o seletor de dias da semana.

### Primeira execução

- `ONCE`: usa a data/hora completa informada, validada como futura no fuso configurado.
- `DAILY`/`WEEKLY`: o backend calcula a próxima ocorrência estritamente futura a partir de agora,
  considerando os dias selecionados e o horário recorrente. Não existe campo de "data completa" na
  interface e a data de criação não provoca envio em um dia não selecionado.
- `MONTHLY`: o backend calcula a próxima ocorrência futura com base em `dayOfMonth` e
  `recurringTime`, aplicando a regra do último dia em meses curtos.
- Ao editar uma recorrência sem alterar horário, dias ou dia do mês, o `nextRunAt` atual é
  preservado. Ao alterar qualquer um desses parâmetros, a próxima ocorrência é recalculada.

## Compatibilidade com registros antigos

A migration `20261024180000_scheduled_message_recurrence_config` adiciona `recurring_time` e
`day_of_month` e faz backfill sem descartar nem alterar o histórico:

- `recurring_time` é derivado de `scheduled_at` no fuso configurado em cada registro.
- `day_of_month` é derivado de `scheduled_at` para `MONTHLY` existentes.
- `DAILY` com `weekdays = []` (comportamento antigo: todos os dias) recebe `[1,2,3,4,5,6,7]`.
- `WEEKLY` com `weekdays = []` (comportamento antigo: mesmo dia toda semana) recebe o dia da semana
  da primeira execução, no fuso de cada registro.

Em runtime, caso exista algum registro legado não normalizado, o backend ainda trata:

- `DAILY` com `weekdays = []` como todos os dias;
- `WEEKLY` com `weekdays = []` como o mesmo dia da semana da ocorrência atual;
- `MONTHLY` com `dayOfMonth = null` usando o dia local de `scheduledAt`.

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
   `nextRunAt` no fuso configurado (respeitando `weekdays`/`dayOfMonth` e `recurringTime`) e clonam
   os destinatários para a próxima ocorrência.
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

- `ONCE`: data/hora completa futura no fuso `America/Sao_Paulo`.
- `DAILY`/`WEEKLY`: ao menos um dia em `weekdays` e horário `HH:mm` válido.
- `MONTHLY`: `dayOfMonth` inteiro de `1` a `31` e horário `HH:mm` válido.
- Título e texto obrigatórios.
- Ao menos um destinatário e no máximo `SCHEDULED_MESSAGE_MAX_RECIPIENTS` (100).
- Destinatários precisam pertencer ao tenant e ter destino WhatsApp válido.
- Anexo deve ser imagem decodificável ou PDF e respeitar `MEDIA_MAX_BYTES`.
- Edição permitida apenas em `SCHEDULED`.
- O backend valida independentemente do frontend e retorna erros padronizados:
  `SCHEDULED_MESSAGE_INVALID_WEEKDAYS`, `SCHEDULED_MESSAGE_INVALID_TIME`,
  `SCHEDULED_MESSAGE_INVALID_DAY_OF_MONTH` e `SCHEDULED_MESSAGE_INVALID_DATE`.

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

`POST`/`PATCH` usam `multipart/form-data` com:

- `type`, `title`, `content`, `valor`;
- `recurrence`;
- `scheduledAt` (`YYYY-MM-DDTHH:mm`) **somente para `ONCE`**;
- `recurringTime` (`HH:mm`) para `DAILY`, `WEEKLY` e `MONTHLY`;
- `weekdays` (JSON array, ex.: `[1,3,5]`) para `DAILY` e `WEEKLY`;
- `dayOfMonth` (`1..31`) para `MONTHLY`;
- `recipientConversationIds` (JSON array), `file?` e `removeAttachment?`.

O backend normaliza campos incompatíveis (por exemplo, `weekdays` enviado em `MONTHLY` é
descartado) e calcula `scheduledAt` a partir da configuração recorrente. Em `PATCH`, omitir um
campo preserva o valor atual.

`POST /api/scheduled-messages/:id/cancel` finaliza a programação. Para recorrências, a interface
apresenta a ação como **Finalizar recorrência** e informa que não haverá novos envios; a ação
exige `OWNER`/`ADMIN`, pede confirmação e fica desabilitada durante a requisição.

## Frontend

- Rota `/mensagens-agendadas` (Ferramentas → Mensagens agendadas), com atalho em Cobranças.
- Listagem mobile-first com filtros por texto/tipo/status, status, próximo envio e quantidade de
  destinatários.
- Formulário com tipo, título, texto, variáveis, valor opcional, anexo, destinatários com busca,
  seleção múltipla, selecionar todos e filtro por instância WhatsApp.
- Os campos de agendamento mudam conforme a recorrência:
  - `ONCE`: data e hora completas;
  - `DAILY`/`WEEKLY`: seletor acessível com os sete dias (múltipla seleção, sem rolagem
    horizontal no mobile) e horário;
  - `MONTHLY`: dia do mês (1–31) e horário, sem seletor de dias da semana.
- Dias de uma nova recorrência começam desmarcados. Ao editar, os valores persistidos são
  carregados.
- Erros de validação aparecem ao lado do campo correspondente, com `aria-invalid`,
  `aria-describedby` e `role="alert"`; a submissão é bloqueada até corrigir.
- Ao trocar a recorrência, os campos visíveis são atualizados e apenas os campos da recorrência
  atual são enviados (sem valores residuais).
- Os cards mostram a recorrência configurada, os dias/dia do mês, o horário e o próximo envio.
- Ações de editar, finalizar recorrência/cancelar, duplicar e histórico por ocorrência/destinatário,
  com reenvio de falhas. A finalização só aparece para agendamentos ativos e o histórico é
  preservado.

## Testes

- `test/unit/scheduled-messages/scheduled-message-time.spec.ts` cobre conversão de fuso, data
  futura, horário recorrente, dia do mês, recorrência diária/semanal/mensal, múltiplos dias,
  meses de 28/29/30/31 dias, virada de ano, preservação de horário, seleção vazia, dias
  inválidos/duplicados e compatibilidade com agendamentos antigos.
- `test/unit/scheduled-messages/scheduled-messages.service.spec.ts` cobre validação e persistência
  dos dias/horário/dia do mês, cálculo da primeira execução, edição preservando ou recalculando a
  configuração, encerramento idempotente e transição atômica para `CANCELED`.
- `test/unit/scheduled-messages/scheduled-message-sender.service.spec.ts` cobre job antigo após
  encerramento, bloqueio de novos claims, `CANCELED` não revertido, recorrência semanal com vários
  dias, mensal após mês curto e clonagem da próxima ocorrência somente dentro da transação
  condicional.
- `test/unit/scheduled-messages/scheduled-messages.controller.spec.ts` garante `OWNER`/`ADMIN` nas
  ações de gerenciamento.
- `frontend/src/features/scheduled-messages/scheduled-message-form.test.tsx` cobre campos por
  recorrência, dias iniciando desmarcados, carregamento na edição, mensagens de validação, envio
  apenas dos campos relevantes e grid responsivo.
- `frontend/src/features/scheduled-messages/scheduled-message-utils.test.ts` cobre resumos de
  recorrência, horário/fuso, dia local, validação e conversão de data local.
- A validação completa (CRUD, permissões, isolamento por tenant, anexos, logs, retry e recorrência)
  deve ser exercitada com PostgreSQL/Redis via `npm run test:e2e`.
