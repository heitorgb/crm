# Vendas e qualificação — OrderUp CRM

> Status: **Implementado** (Prompt 06). Lead, Pipeline, PipelineStage, Deal, Task, Activity e o
> motor de qualificação (`LeadQualificationSession`, `LeadAnalysis`) com uma abstração `AiProvider`.
> A integração com WhatsApp fica para o Prompt 07.

Complementa [`crm-core.md`](./crm-core.md). Regras de isolamento em [`multi-tenancy.md`](./multi-tenancy.md).

## Entidades

Todas com `tenantId`, escopadas pelo contexto (token + membership). Nenhum endpoint aceita `tenantId`.

### `Lead`

`name?`, `phone?`, `email?`, `source?`, `status` (`LeadStatus`), `customerId?`, `contactId?`, timestamps.
Ao menos `name` ou `phone` é obrigatório. `phone` é único por tenant (`@@unique([tenantId, phone])`).
Tags via `LeadTag` (N:N, `PK (leadId, tagId)`, `tenantId` denormalizado).

### `Pipeline` e `PipelineStage`

`Pipeline`: `name` (único por tenant), `description?`, `active`. Um tenant tem vários pipelines.
`PipelineStage`: `pipelineId`, `name`, `position` (único por pipeline). Etapas são sempre ordenadas
por `position`; criar sem posição usa `max(position) + 1`.

### `Deal`

`pipelineId`, `stageId`, `title`, `value` (Decimal 14,2), `currency`, `status`
(`OPEN` | `WON` | `LOST`), `customerId?`, `contactId?`, `leadId?`, `ownerId?` (membership),
`expectedCloseAt?`, `closedAt?`. Fechar (`WON`/`LOST`) preenche `closedAt`.

### `Task`

`title`, `description?`, `status` (`PENDING` | `IN_PROGRESS` | `DONE` | `CANCELED`), `priority`,
`dueAt?`, `completedAt?`, `ownerId?` (membership), `leadId?`, `dealId?`, `customerId?`.

### `Activity`

`entity`, `entityId?`, `action`, `metadata` (JSON), `userId?` (ator), `createdAt`. É o histórico
comercial; `userId` **não** tem FK para preservar auditoria mesmo se o usuário global for removido.

### `LeadQualificationSession`

`leadId`, `profileId`, `profileVersion`, `status` (`PENDING` | `BOT_QUALIFYING` | `QUALIFIED` |
`DISQUALIFIED` | `NEEDS_HUMAN` | `ABANDONED`), `collectedData`, `missingInformation`, `transcript`
(adicionado além do mínimo para sobreviver a restart), `questionCount`, `reviewRequested`,
`reviewRequestedAt`, `handoffReason`, `startedAt`, `lastInteractionAt`, `completedAt?`.

### `LeadAnalysis`

Resultado final: `sessionId`, `profileId`, `profileVersion`, `provider`, `model`, `outcome`
(`QUALIFIED` | `DISQUALIFIED` | `NEEDS_HUMAN`), `score?`, `qualificationLevel?`, `summary`,
`collectedData`, `strengths`, `risks`, `missingInformation`, `recommendedNextStep?`,
`qualificationReasons`. `qualificationReasons` são justificativas objetivas, nunca chain-of-thought.

## Endpoints

| Método | Rota                                          | Papéis           |
| ------ | --------------------------------------------- | ---------------- |
| GET    | `/api/leads`                                  | autenticado      |
| GET    | `/api/leads/:id`                              | autenticado      |
| POST   | `/api/leads`                                  | autenticado      |
| PATCH  | `/api/leads/:id`                              | autenticado      |
| DELETE | `/api/leads/:id`                              | `OWNER`, `ADMIN` |
| GET    | `/api/pipelines`                              | autenticado      |
| GET    | `/api/pipelines/:id`                          | autenticado      |
| POST   | `/api/pipelines`                              | autenticado      |
| PATCH  | `/api/pipelines/:id`                          | autenticado      |
| DELETE | `/api/pipelines/:id`                          | `OWNER`, `ADMIN` |
| GET    | `/api/pipelines/:id/stages`                   | autenticado      |
| POST   | `/api/pipelines/:id/stages`                   | autenticado      |
| PATCH  | `/api/pipelines/:id/stages/:stageId`          | autenticado      |
| DELETE | `/api/pipelines/:id/stages/:stageId`          | `OWNER`, `ADMIN` |
| GET    | `/api/deals`                                  | autenticado      |
| GET    | `/api/deals/board`                            | autenticado      |
| GET    | `/api/deals/:id`                              | autenticado      |
| POST   | `/api/deals`                                  | autenticado      |
| PATCH  | `/api/deals/:id`                              | autenticado      |
| PATCH  | `/api/deals/:id/stage`                        | autenticado      |
| DELETE | `/api/deals/:id`                              | `OWNER`, `ADMIN` |
| GET    | `/api/tasks`                                  | autenticado      |
| GET    | `/api/tasks/:id`                              | autenticado      |
| POST   | `/api/tasks`                                  | autenticado      |
| PATCH  | `/api/tasks/:id`                              | autenticado      |
| DELETE | `/api/tasks/:id`                              | `OWNER`, `ADMIN` |
| GET    | `/api/activities`                             | autenticado      |
| GET    | `/api/members`                                | autenticado      |
| POST   | `/api/leads/:leadId/qualification-sessions`   | autenticado      |
| GET    | `/api/qualification-sessions`                 | autenticado      |
| GET    | `/api/qualification-sessions/:id`             | autenticado      |
| POST   | `/api/qualification-sessions/:id/messages`    | autenticado      |
| POST   | `/api/qualification-sessions/:id/review`      | autenticado      |
| POST   | `/api/qualification-sessions/:id/reanalyze`   | `OWNER`, `ADMIN` |
| GET    | `/api/lead-analyses`                          | autenticado      |
| GET    | `/api/lead-analyses/:id`                      | autenticado      |

Listagens: `page`, `perPage` (máx 100), `search`, `sort`, `order`. Filtros reais: `leads` por
`status`/`customerId`/`tagId`; `pipelines` por `active`; `deals` por `pipelineId`/`stageId`/`status`/
`ownerId`/`customerId`/`leadId`; `tasks` por `status`/`priority`/`ownerId`/`leadId`/`dealId`/
`customerId`/`dueBefore`/`dueAfter`; `activities` por `entity`/`entityId`/`action`.

## Movimentação de Deal

`PATCH /api/deals/:id/stage` valida: deal no tenant, stage no tenant, **stage pertence ao pipeline
do deal**. Caso contrário: `404` (outro tenant) ou `400 DEAL_STAGE_PIPELINE_MISMATCH`. A mudança
gera `Activity` `deal.stage_moved` com etapa de origem/destino. Não há movimentação automática por IA.

## Kanban e performance

- `GET /api/deals/board?pipelineId=&limitPerStage=` retorna as etapas com `dealCount` total e os
  primeiros negócios de cada etapa (default 25, máx 100) — evita carregar todos os deals.
- O quadro faz *drag and drop* nativo; **toda** movimentação chama o backend e invalida as queries.
- Nenhuma coluna atualiza o estado localmente sem resposta do servidor.

## Motor de qualificação

Fluxo: `Lead + QualificationProfile + contexto → QualificationEngine → IA → ASK | COMPLETE |
NEEDS_HUMAN`.

- `AiProvider` é a abstração (`evaluate(input) => raw`). Implementação concreta
  `HttpAiProvider` (OpenAI-compatible, `fetch`, timeout/retries via `AI_*`). Se `AI_PROVIDER` não
  estiver configurado, `UnavailableAiProvider` sinaliza indisponibilidade e o motor faz handoff.
- O **engine valida** a saída estruturada: ação conhecida, pergunta não vazia, score inteiro 0–100,
  `qualificationLevel` existente no perfil, `summary`, e motivo objetivo em desqualificação.
- Regras de conversa: não repetir dado já coletado, uma pergunta principal por vez, usar
  `requiredInformation`, respeitar critérios/pesos, completar só com contexto suficiente, e
  `NEEDS_HUMAN` em handoff configurado ou pedido explícito.
- **Conclusão obrigatória por informações**: se a IA retornar `COMPLETE` com item obrigatório
  ausente, o motor converte para `ASK` da próxima informação faltante.

### LGPD no motor

- `collectedData` só aceita chaves definidas em `requiredInformation` (minimização por whitelist).
- Menção a categorias sensíveis (saúde, raça/etnia, religião, política, orientação sexual,
  biometria/genética) **não** é estruturada; o motor sinaliza internamente e converte para
  `NEEDS_HUMAN`.
- Desqualificação sem motivo objetivo → `NEEDS_HUMAN` (`missing_disqualification_reason`).
- Perfil com `dataSensitivityLevel = high` **nunca** desqualifica automaticamente: vira
  `NEEDS_HUMAN` (`high_sensitivity_requires_human`).
- Saída inválida ou falha do provedor → `NEEDS_HUMAN` (`invalid_ai_response` / `provider_error`).
- `LeadAnalysis` guarda `provider`, `model`, `profileVersion` e `qualificationReasons`.
- `POST /:id/review` reabre sessão concluída para a fila humana (`reviewRequested`), operacionalizando
  a revisão do art. 20 da LGPD sem fluxo novo.
- `POST /:id/reanalyze` (OWNER/ADMIN) gera nova análise sem criar nova sessão.

Ao concluir, o `Lead` passa a `QUALIFIED_WAITING_DIGEST` ou `DISQUALIFIED` (ou `NEEDS_HUMAN`).
Não há notificação individual nesta etapa.

## Frontend

- `/vendas/funil` — Kanban (colunas = etapas, cards = negócios) com drag and drop persistido.
- `/vendas/negocios` — lista de negócios com filtros/ paginação.
- `/vendas/leads` — lista e formulário de leads.
- `/tarefas` — lista e formulário de tarefas.
- `/settings/pipelines` — CRUD de pipelines e etapas (ordenação).

## Fora de escopo

WhatsApp/Evolution API, automações, digest agendado, notificações e expurgo LGPD.
