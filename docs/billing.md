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

Template padrão:
`Olá {cliente}! Passando para lembrar da cobrança "{descricao}" no valor de {valor}, com vencimento em {vencimento}.`

### `BillingReminder` (histórico + idempotência)

| Campo               | Observações                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `chargeId`          | cobrança relacionada (cascade)                                    |
| `offsetDays`        | etapa do lembrete                                                 |
| `scheduledFor`      | data em que o lembrete venceu                                     |
| `status`            | `PENDING` \| `PROCESSING` \| `SENT` \| `FAILED` \| `SKIPPED`      |
| `attempts`          | tentativas realizadas                                             |
| `nextAttemptAt`     | agendamento da próxima tentativa (backoff)                        |
| `destination`       | telefone usado                                                    |
| `whatsappInstanceId`| instância usada                                                   |
| `externalMessageId` | id retornado pela Evolution quando aceito                         |
| `errorMessage`      | motivo da falha (código seguro, sem segredos)                     |
| `processedAt`       | data/hora de conclusão                                            |

Constraint único `(chargeId, offsetDays)`: **é a chave de idempotência** — um mesmo par
cobrança+etapa existe uma única vez, e a criação usa `skipDuplicates`.

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

A varredura `billing.scan` roda periodicamente (a cada 5 minutos) pela fila já existente
(`JobQueue`/BullMQ; inline em testes) e executa:

1. `generateDue(today)` — gera cobranças recorrentes vencidas.
2. `generateReminders(today)` — para cada tenant, para cada offset configurado, cria o lembrete
   (via `createMany ... skipDuplicates`) quando `dueDate == hoje - offset`.
3. `resetStaleProcessing()` — volta lembretes travados em `PROCESSING` (mais de 15 min) para
   `PENDING`.
4. `dispatch(today)` — enfileira `billing.reminder.send` para cada lembrete `PENDING` com
   `nextAttemptAt <= agora`.

Antes de enviar, o processador valida:

- a cobrança continua `PENDING` (paga/cancelada → `SKIPPED charge_closed`);
- o contato tem telefone utilizável (senão `SKIPPED missing_phone`);
- existe instância ativa autorizada (configurada ou a primeira `CONNECTED`);
- o horário atual está dentro da janela de envio (fora dela, mantém pendente);
- o lembrete ainda está `PENDING` (guarda de idempotência — `SENT`/`FAILED`/`SKIPPED` são ignorados).

Falhas de envio (Evolution indisponível/erro HTTP/instância ausente) **não marcam como enviado**:
incrementam `attempts`, guardam `errorMessage` e reagendam com *backoff* exponencial (5 → 10 → 20
min, teto de 60 min). Após 3 tentativas o lembrete vira `FAILED` (visível no dashboard), evitando
ciclo infinito. Envio aceito pela Evolution vira `SENT` com `externalMessageId`.

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
- Listagem com filtros, baixa manual, cancelamento, edição e histórico de lembretes.
- Formulário único de cobrança (avulsa ou recorrente mensal).
- Diálogo de recorrências e diálogo de configuração de lembretes.
- Estados de carregamento, vazio, erro e confirmações de ação.

## Migração

Migration `20261016132814_billing_module` (versionada em `backend/prisma/migrations`) e, para
permitir cobrar contatos, `20261016141533_billing_contact_party` (torna `customer_id` opcional e
adiciona índices por `contact_id`). Aplicar com `npm run prisma:deploy` (ambientes não interativos)
ou `npm run prisma:migrate` (dev).

## Testes

- Unit: `test/unit/billing/billing-utils.spec.ts` (datas, moeda, template, offsets).
- Integração: `test/integration/billing.integration-spec.ts` cobre CRUD, validação, baixa manual,
  vencimento, permissões, isolamento entre tenants, recorrência sem duplicação, idempotência dos
  lembretes, falha da Evolution com retentativas, ausência de telefone/instância e interrupção
  após pagamento. Usa `FakeEvolution`, sem chamadas reais.
- Frontend: `billing-utils.test.ts` e `billing-page.test.tsx` (renderização e estados principais).
