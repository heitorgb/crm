# Cobranças — OrderUp CRM

Módulo de **controle manual de cobranças** e **lembretes automáticos por WhatsApp**. O sistema
**não processa pagamentos**: apenas registra cobranças, acompanha status (pendente/vencida/paga/
cancelada) e envia lembretes aos clientes pela Evolution API.

## Visão geral

```text
Cliente (Customer) ─┬─ Cobrança (BillingCharge) ── Lembrete (BillingReminder) ── Evolution API
                    └─ Recorrência (BillingRecurrence) ── gera novas cobranças
Configuração de lembretes (BillingSettings) por tenant
```

Tudo pertence a um tenant (`tenantId`) e é filtrado pelo contexto autenticado. Nenhum `tenantId`
vindo do cliente é aceito.

## Modelagem

### `BillingCharge`

| Campo          | Tipo                    | Observações                                             |
| -------------- | ----------------------- | ------------------------------------------------------- |
| `tenantId`     | `uuid`                  | escopo multi-tenant                                     |
| `customerId`   | `uuid?` FK              | cliente (`Customer`) quando existir; nunca cria duplicado |
| `contactId`    | `uuid?` FK              | contato cobrado (usado também como destinatário)         |
| `recurrenceId` | `uuid?` FK              | preenchido quando gerada por recorrência                |
| `description`  | `text`                  |                                                         |
| `amountCents`  | `int`                   | valor em centavos — evita ponto flutuante               |
| `dueDate`      | `date`                  | data de vencimento (sem hora)                           |
| `status`       | `BillingChargeStatus`   | `PENDING` \| `PAID` \| `CANCELED`                       |
| `paidAt`       | `timestamp?`            | data/hora da baixa manual                               |
| `paidByUserId` | `uuid?`                 | usuário responsável pela baixa (sem FK — auditoria)     |
| `canceledAt`   | `timestamp?`            |                                                         |

A cobrança referencia **ao menos uma parte**: um `Contact` (o cliente no uso real do CRM, já que
contatos são importados da agenda do WhatsApp) e/ou um `Customer`. Se o contato estiver ligado a um
`Customer`, esse vínculo é reaproveitado automaticamente; nenhum `Customer` é criado
automaticamente. Essa foi a correção do bug em que o seletor de clientes ficava vazio: o formulário
agora lista os `Contact` existentes em vez de exigir um `Customer` inexistente.

**Vencida** não é armazenada: é derivada (`PENDING` + `dueDate < hoje`). A exposição da API retorna
`status` efetivo (`PENDING`/`OVERDUE`/`PAID`/`CANCELED`), calculado no fuso `BILLING_TIMEZONE`.

Constraint único `(recurrenceId, dueDate)` garante que uma recorrência nunca gere duas cobranças
para o mesmo vencimento (a nulidade do `recurrenceId` não afeta cobranças avulsas).

### `BillingRecurrence`

Mensal (`MONTHLY`). Guarda `startDate`, `nextRunDate`, `endDate?`, `active`, valor, cliente e
contato. O `nextRunDate` avança mês a mês (com *clamp* do dia para o último dia válido do mês, ex.:
31/01 → 28/02).

### `BillingSettings` (uma por tenant)

| Campo                  | Padrão            | Observações                                                 |
| ---------------------- | ----------------- | ----------------------------------------------------------- |
| `remindersEnabled`     | `true`            |                                                             |
| `reminderOffsets`      | `[-3, 0, 3]`      | dias relativos ao vencimento (negativo = antes; 0 = no dia) |
| `messageTemplate`      | ver abaixo        | aceita `{cliente} {descricao} {valor} {vencimento}`         |
| `whatsappInstanceId`   | `null`            | `null` = primeira instância conectada do tenant             |
| `sendWindowStartHour`  | `9`               | janela de envio (hora local)                                |
| `sendWindowEndHour`    | `18`              | janela de envio (hora local)                                |

A API também expõe, somente leitura, `timeZone` (`BILLING_TIMEZONE`) e `scanIntervalMinutes`
(derivado de `BILLING_SCAN_INTERVAL_MS`) para que a interface descreva o comportamento real.

**Janela de envio** (`isWithinWindow`): os limites são **inclusivos**. Se início `<` fim, vale
`[início, fim]`; se início `>` fim, a janela atravessa a meia-noite (`[início, 23] ∪ [0, fim]`);
se início `=` fim, a janela fica aberta **o dia inteiro**. A hora avaliada é a do fuso
`BILLING_TIMEZONE`.

Template padrão:
`Olá {cliente}! Passando para lembrar da cobrança "{descricao}" no valor de {valor}, com vencimento em {vencimento}.`

### `BillingReminder` (histórico + idempotência)

| Campo               | Observações                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `chargeId`          | cobrança relacionada (cascade)                                    |
| `offsetDays`        | etapa do lembrete (`0` para manuais)                              |
| `origin`            | `AUTOMATIC` \| `MANUAL`                                           |
| `createdByUserId`   | usuário que disparou o envio manual (sem FK — auditoria)          |
| `dedupeKey`         | chave de idempotência automática (`auto:<offset>`), nula em manuais |
| `idempotencyKey`    | chave da operação manual (nula em automáticos)                    |
| `scheduledFor`      | data em que o lembrete venceu                                     |
| `status`            | `PENDING` \| `PROCESSING` \| `SENT` \| `FAILED` \| `SKIPPED`      |
| `attempts`          | tentativas realizadas                                             |
| `nextAttemptAt`     | agendamento da próxima tentativa (backoff)                        |
| `destination`       | telefone usado                                                    |
| `whatsappInstanceId`| instância usada                                                   |
| `externalMessageId` | id retornado pela Evolution quando aceito                         |
| `errorMessage`      | motivo da falha (código seguro, sem segredos)                     |
| `processedAt`       | data/hora de conclusão                                            |

Constraints únicos: `(chargeId, dedupeKey)` — idempotência do automático (um lembrete por
cobrança+etapa, criação com `skipDuplicates`); `(chargeId, idempotencyKey)` — idempotência do envio
manual. Chaves nulas (Postgres) não colidem, então várias linhas manuais e automáticas convivem.

## Envio manual

A ação **Enviar lembrete** (ícone + `aria-label`, na linha da cobrança) permite disparar um lembrete
explicitamente, **independente dos dias/horários da automação** e mesmo com a automação global
desabilitada (`remindersEnabled=false`). Regras:

- `POST /billing/charges/:id/reminders` com `{ idempotencyKey }` (OWNER/ADMIN).
- Bloqueia cobranças `PAID`/`CANCELED` (`409 BILLING_CHARGE_NOT_SENDABLE`).
- Usa o mesmo modelo de mensagem e variáveis do envio automático.
- Usa a instância configurada; sem configuração, cai no comportamento automático (primeira
  `CONNECTED`).
- Sem telefone → registra `SKIPPED (missing_phone)`; sem instância → `FAILED (no_instance)`; erro da
  Evolution → `FAILED (evolution_http_*)`. A tentativa manual é única (sem retentativas em background),
  para dar retorno imediato ao usuário.
- O `idempotencyKey` (gerado pelo frontend por confirmação) impede duplicação por duplo clique ou
  reenvio da mesma requisição; novas confirmações geram nova chave e são permitidas.
- `SENT` significa **solicitação aceita** pela Evolution, não entrega confirmada.

O histórico (`GET /billing/charges/:id/reminders`) diferencia `MANUAL` de `AUTOMATIC` e registra
destinatário, instância, tentativas, resultado e erro. O envio manual **não** altera vencimento,
valor ou status financeiro.

## Recorrência

- Ao criar uma cobrança marcada como recorrente (ou via `POST /billing/recurrences`) cria-se a
  recorrência **e a primeira cobrança** na data inicial.
- A cada varredura (`billing.scan`), `generateDue(today)` cria as ocorrências pendentes cuja data já
  chegou (`nextRunDate <= hoje`) e avança `nextRunDate`. **Nunca gera cobranças futuras
  indefinidamente**: só cria as que já venceram/chegaram.
- O índice único `(recurrenceId, dueDate)` + `catch P2002` tornam a geração idempotente mesmo com
  o job executado mais de uma vez.
- Encerrar a recorrência (`DELETE /billing/recurrences/:id` → `active=false`) interrompe a geração
  futura; as cobranças já geradas permanecem.

## Agendamento, idempotência e retentativas

A varredura `billing.scan` roda **a cada 5 minutos** (`BILLING_SCAN_INTERVAL_MS = 5 * 60 * 1000`),
agendada por `BillingSchedulerService` via `queue.scheduleRepeatable` → BullMQ
`upsertJobScheduler({ every })` (nos testes, `InlineJobQueue` com `setInterval`). O intervalo é
**fixo** (constante), não configurável, e é exposto à interface em `scanIntervalMinutes`. A cada
varredura:

1. `generateDue(today)` — gera cobranças recorrentes vencidas.
2. `generateReminders(today)` — cria lembretes automáticos. O lembrete de uma cobrança/offset fica
   elegível em `dueDate + offset`; além do dia exato, há **catch-up** de alvos perdidos nos últimos
   `BILLING_REMINDER_CATCHUP_DAYS` (2) dias, então uma indisponibilidade curta do scan não perde o
   lembrete. A criação usa `createMany ... skipDuplicates` com `dedupeKey = auto:<offset>`.
3. `resetStaleProcessing()` — volta lembretes travados em `PROCESSING` (mais de 15 min) para
   `PENDING`.
4. `dispatch(today)` — enfileira `billing.reminder.send` **apenas** para lembretes `PENDING` de
   tenants com automação habilitada e **com a janela aberta** (evita criar jobs que seriam
   recusados fora do horário).

Antes de enviar, o processador revalida:

- a automação do tenant está habilitada (senão mantém `PENDING`, sem enviar);
- a cobrança continua `PENDING` (paga/cancelada → `SKIPPED charge_closed`);
- o contato tem telefone utilizável (senão `SKIPPED missing_phone`);
- existe instância ativa autorizada (configurada ou a primeira `CONNECTED`);
- o horário atual está dentro da janela de envio (fora dela, mantém pendente e será reavaliado);
- o lembrete ainda está `PENDING` (guarda de idempotência — `SENT`/`FAILED`/`SKIPPED` são ignorados).

Um lembrete elegível fora da janela **não é perdido**: permanece `PENDING` e é reenviado na próxima
verificação dentro do horário. Um envio não ocorre necessariamente no início da janela, pois passa
pela fila.

Falhas de envio (Evolution indisponível/erro HTTP/instância ausente) **não marcam como enviado**:
incrementam `attempts`, guardam `errorMessage` e reagendam com *backoff* exponencial (5 → 10 → 20
min, teto de 60 min). Após 3 tentativas o lembrete vira `FAILED` (visível no dashboard), evitando
ciclo infinito. Envio aceito pela Evolution vira `SENT` com `externalMessageId`.

Desabilitar `remindersEnabled` interrompe **novas execuções automáticas** (nada é criado nem
disparado) sem afetar o envio manual; ao reabilitar, lembretes `PENDING` voltam a ser processados.

Pagamento (`POST /billing/charges/:id/pay`) e cancelamento interrompem os lembretes pendentes
(`SKIPPED`), preservando o histórico dos já enviados.

### Integração com a Evolution API

Reutiliza o `EvolutionClient` já existente (`POST /message/sendText/{instance}`). Nenhuma chamada
real é feita nos testes — o `EvolutionClient` é substituído por um fake.

Os lembretes **não** criam linhas em `Message` manualmente: quando a Evolution envia a mensagem,
ela emite o webhook `MESSAGES_UPSERT` (`fromMe`), que o fluxo atual já reconcilia como mensagem
`OUTBOUND`. O histórico confiável do lembrete vive em `BillingReminder`.

## Fuso horário

`BILLING_TIMEZONE` (IANA, padrão `America/Sao_Paulo`) define o "hoje" usado para vencidos,
geração de recorrências, geração de lembretes e a janela de envio. Evita envios em horários
inesperados e mantém o comportamento previsível.

## Endpoints

Todos exigem autenticação. Escritas financeiras exigem `OWNER`/`ADMIN` (mesma regra dos demais
módulos: clientes, contatos e WhatsApp). A regra é aplicada no backend pelo `RolesGuard`; o
frontend apenas espelha essa regra nos pontos de entrada de gestão (não a substitui).

| Método | Rota                                  | Permissão     |
| ------ | ------------------------------------- | ------------- |
| GET    | `/billing/overview`                   | autenticado   |
| GET    | `/billing/charges`                    | autenticado   |
| GET    | `/billing/charges/:id`                | autenticado   |
| GET    | `/billing/charges/:id/reminders`      | autenticado   |
| POST   | `/billing/charges/:id/reminders`      | OWNER/ADMIN   |
| POST   | `/billing/charges`                    | OWNER/ADMIN   |
| PATCH  | `/billing/charges/:id`                | OWNER/ADMIN   |
| POST   | `/billing/charges/:id/pay`            | OWNER/ADMIN   |
| POST   | `/billing/charges/:id/cancel`         | OWNER/ADMIN   |
| GET    | `/billing/reminders`                  | autenticado   |
| GET    | `/billing/recurrences`                | autenticado   |
| POST   | `/billing/recurrences`                | OWNER/ADMIN   |
| PATCH  | `/billing/recurrences/:id`            | OWNER/ADMIN   |
| DELETE | `/billing/recurrences/:id`            | OWNER/ADMIN   |
| GET    | `/billing/settings`                   | autenticado   |
| PATCH  | `/billing/settings`                   | OWNER/ADMIN   |

Filtros de `/billing/charges`: `status` (`PENDING`/`OVERDUE`/`PAID`/`CANCELED`), `customerId`,
`recurrenceId`, `dueFrom`, `dueTo`, `search` (descrição/cliente) e paginação padrão.

## Frontend

- Rota `/cobrancas` (menu **Financeiro → Cobranças**).
- Dashboard com cartões (pendente, vencido, pago no período, lembretes com falha) e próximos
  vencimentos.
- Listagem com filtros, baixa manual, cancelamento, edição, envio manual de lembrete e histórico de
  lembretes.
- Formulário único de cobrança (avulsa ou recorrente mensal).
- Diálogo de recorrências, de configuração de lembretes e de confirmação do envio manual (com
  estado de carregamento e resultado real da operação).
- O diálogo de lembretes mostra uma explicação contextual gerada a partir dos valores reais do
  backend (frequência em minutos, janela de envio e fuso), sem valores fixos no código.
- Estados de carregamento, vazio, erro e confirmações de ação.

## Migração

Migrations versionadas em `backend/prisma/migrations`: `20261016132814_billing_module`,
`20261016141533_billing_contact_party` (torna `customer_id` opcional e indexa `contact_id`) e
`20261016150000_billing_manual_reminders` (adiciona `origin`, `created_by_user_id`, `dedupe_key`,
`idempotency_key` e backfill da idempotência automática). Aplicar com `npm run prisma:deploy`
(ambientes não interativos) ou `npm run prisma:migrate` (dev).

## Testes

- Unit: `test/unit/billing/billing-utils.spec.ts` (datas, moeda, template, offsets, janela de envio
  `isWithinWindow` — normal, meia-noite, início=fim — e fuso horário via `localHour`/`localDateString`).
- Integração: `test/integration/billing.integration-spec.ts` cobre CRUD, validação, baixa manual,
  vencimento, permissões, isolamento entre tenants, recorrência sem duplicação, idempotência dos
  lembretes, falha da Evolution com retentativas, ausência de telefone/instância, interrupção após
  pagamento, **envio manual** e **agendamento/janela** (catch-up de lembrete perdido, não envio fora
  da janela com reavaliação posterior, supressão com automação desabilitada, offsets negativo/zero/
  positivo e exposição de `scanIntervalMinutes`/`timeZone`). Usa `FakeEvolution`, sem chamadas reais.
- Frontend: `billing-utils.test.ts` (inclui `reminderScheduleExplanation`/`describeSendWindow`),
  `billing-page.test.tsx` e `send-reminder-dialog.test.tsx`.
