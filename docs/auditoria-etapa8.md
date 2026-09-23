# Auditoria de Impacto — Etapa 8 (Limpeza)

> **Natureza desta etapa:** exclusivamente análise.
> Nenhum arquivo de código, schema ou migration foi alterado.
> Base: estado atual verificado do banco (PostgreSQL local) + código (`backend/src`, `frontend/src`) + testes.
> Data de referência: Fase 1 já executada (WhatsApp → Contact → Conversation → Message; Chat desacoplado de Lead; envio humano sem bot; `Contact.customerId` opcional; migration aditiva; 87 unit + 153 integração, lint/typecheck/build OK).

---

## Sumário executivo

O novo núcleo (`WhatsAppInstance → Conversation → Message` + `Contact`) **já não depende de Lead, Bot, Qualification, Pipeline, Deals, Tasks, Digest, Tickets ou Compliance**. Restam apenas dependências residuais:

- `Deal` e `Task` validam `leadId` opcional (`deals.service.ts:365`, `tasks.service.ts:188`).
- `Compliance` depende de `Qualification` e `Tickets` (`automated-review.service.ts`).
- `Digest` usa `ConversationStatus.NEEDS_HUMAN` e `Lead`.
- `Customers` usa `Activities`.

Dados atuais relevantes: 1 Lead (`alan`, sem telefone), 1 Deal (sem lead), 1 Customer, 1 QualificationProfile, 5 Activities. Conversas, mensagens, contatos e tickets = 0.

---

## 1. LEADS

**Registro existente:** 1 linha — `alan`, `phone = NULL`, `email = NULL`, `customer_id = NULL`, `contact_id = NULL`, status `NEW`, criada em 2026-09-22.

**Função no novo fluxo:** nenhuma.
- O webhook não cria nem lê Lead (`webhook.service.ts`).
- `ConversationProcessingService` não referencia Lead.
- Únicos usos de `Lead` fora dos módulos comerciais: `deals.service.ts:365` e `tasks.service.ts:188` (validação de `leadId` opcional em Deal/Task).

**Tabelas que dependem de Lead (FKs reais):**

| Tabela dependente | Coluna | ON DELETE |
|---|---|---|
| conversations | lead_id | SET NULL |
| deals | lead_id | SET NULL |
| tasks | lead_id | SET NULL |
| tickets | lead_id | SET NULL |
| data_subject_requests | lead_id | SET NULL |
| lead_analyses | lead_id | CASCADE |
| lead_qualification_sessions | lead_id | CASCADE |
| lead_tags | lead_id | CASCADE |

Lead também referencia `customers.id` e `contacts.id` (ambos SET NULL).

**Testes que dependem:** `crm-sales`, `qualification`, `digest`, `compliance`, `crm-qualification-profiles` (integração); `qualification-engine`, `digest-window` (unit). O `whatsapp.integration-spec` apenas garante `conversation.leadId === null`.

**APIs que dependem:** CRUD `/leads`; `POST /leads/:leadId/qualification-sessions`; `/lead-analyses`; `/settings/lead-digest`; endpoints `/compliance/subjects/leads/:leadId/*`. Nenhuma está na navegação do MVP.

**Páginas que dependem:** `/vendas/leads`, Dashboard (mock), `/settings/lead-digest`, `/settings/qualification-bot`, `/atendimento/tickets` (exibe `leadName`). Todas sem referência no roteador ativo.

**Pode migrar para Contact/Conversation sem perda?** Não faz sentido.
- O lead não tem telefone (identidade do novo fluxo).
- Não possui derivados: 0 sessões, 0 análises, 0 tags, 0 conversas, 0 tickets.
- Migrar geraria um `Contact` vazio (`phone = null`, nome "alan"), que nunca seria casado por telefone no webhook.
- Único vínculo: 1 `Activity` (`entity=lead`, `entity_id=<id>`, `action=created`).

**Impacto de abandonar o registro:** perda da linha + 1 `Activity`. Nenhuma funcionalidade de WhatsApp/Chat/Contatos quebra (conversations = 0; o único Deal existente tem `lead_id = NULL`).

**Recomendação técnica:** manter a tabela temporariamente (Categoria B/C) e **não migrar** este registro — ele não tem identidade de contato. Opcionalmente, se o nome importar, criar `Contact { name: "alan", phone: null }` apenas para preservação histórica, sem dependência funcional.

---

## 2. TICKETS

**Dados:** 0 tickets.

**Fluxo funcional atual:** nenhum no WhatsApp/Chat. O único criador automático era `TicketsService.ensureHandoffTicket`, chamado por `ConversationProcessingService` (bot). A Fase 1 removeu essa chamada — confirmado: `ConversationsModule` não importa mais `TicketsModule` e o processing não injeta `TicketsService`.

**Dependência remanescente e real:** `ComplianceModule` importa `TicketsModule`; `automated-review.service.ts:36` chama `tickets.ensureHandoffTicket(...)` no fluxo de revisão do art. 20 da LGPD. Fora disso, `/tickets` é apenas CRUD sem UI.

**Respostas diretas:**
- Existe fluxo funcional usando Ticket? Sim, apenas o `automated-review` do Compliance.
- Ticket é necessário para WhatsApp/Chat? **Não.**
- Existe só por causa do handoff do bot? No MVP, sim; funcionalmente sobrevive apenas via Compliance.
- Pode ser removido? Sim, **desde que Compliance também saia ou seja adaptado** para não usar `ensureHandoffTicket`.
- Manter temporariamente? Alternativa segura: manter backend sem UI e sem uso no MVP.

---

## 3. COMPLIANCE

**Dados:** 0 `data_subject_requests`.

**Dependências:** `ComplianceModule` importa `ActivitiesModule`, `QualificationModule` e `TicketsModule`.
- `personal-data.service.ts` opera sobre `Lead`, `LeadQualificationSession`, `LeadAnalysis` (direitos do titular).
- `automated-review.service.ts` injeta `QualificationSessionsService` e `TicketsService`.
- `retention.service.ts` — único ponto que toca entidades do MVP: expurgo/anonimização de `Conversation` e `Message` (usa `ConversationStatus.CLOSED` e `closedAt`).
- `ConversationStatus` legado aparece em `retention.service.ts` (CLOSED) e `automated-review.service.ts` (CLOSED).

**Função no novo MVP:** nenhuma exposta (não há UI). É quase todo acoplado ao fluxo antigo Lead/Bot, exceto a retenção de conversas/mensagens.

**Recomendação:** Categoria B/D — manter temporariamente no backend (por LGPD/retenção de conversas), fora da navegação; remover apenas junto com a decisão sobre retenção. Se removido agora, perde-se a rotina de retenção sobre `Conversation`/`Message` (conformidade, não produto).

---

## 4. CONVERSATION STATUS

**Estado atual:** enum `ConversationStatus` = `OPEN` + legados (`BOT_QUALIFYING`, `QUALIFIED_WAITING_DIGEST`, `DISQUALIFIED`, `NEEDS_HUMAN`, `HUMAN`, `CLOSED`). Default `OPEN`. Dados: 0 conversas.

**Usos reais do MVP (todos OPEN/CLOSED):**
- `conversations.service.ts`: `OPEN` (takeover, reabertura no envio), `CLOSED` (close, `closedAt`).
- `webhook.service.ts`: `OPEN` (criação) e `CLOSED` (reabertura).
- `conversation.dto.ts`: `@IsEnum(ConversationStatus)`.
- Frontend: `types/attendance.ts` = `'OPEN' | 'CLOSED'`; `attendance-page` e `contact-detail-page`.

**Usos legados (fora do MVP):**
- `compliance/retention.service.ts:90,118`: `CLOSED` (mantém-se).
- `compliance/automated-review.service.ts:166`: `not CLOSED` (compatível).
- `digest/lead-digest.service.ts:186`: `NEEDS_HUMAN` (seria afetado).

**Pode simplificar para OPEN/CLOSED?** Sim, sem quebrar Chat/webhook/envio/recebimento/realtime/histórico/filtros/reabertura, pois tudo já usa apenas esses dois valores. Requisitos:
1. Remover `NEEDS_HUMAN` de `digest/lead-digest.service.ts` — ou remover o Digest antes.
2. `@IsEnum` continua válido após reduzir o enum.
3. A alteração de enum no Postgres exige recriar o tipo (`CREATE TYPE novo; ALTER COLUMN ... USING; DROP TYPE antigo`). Com **0 conversas**, não há risco de perda.
4. Nenhum teste cria conversa com status legado (os testes usam `QUALIFIED_WAITING_DIGEST`/`DISQUALIFIED`/`NEEDS_HUMAN` como **LeadStatus**).

**Recomendação:** simplificar apenas **depois** de remover Digest e Compliance, numa migration dedicada. No curto prazo, manter o enum atual é inofensivo (o MVP não usa os legados).

---

## 5. MÓDULOS ANTIGOS — classificação

| Elemento | Sem função no MVP? | Categoria |
|---|---|---|
| Leads | Sim | B — manter tabela até decidir dado; API/UI removíveis |
| LeadTag | Sim | A (junto com Leads) |
| LeadQualificationSession | Sim | A |
| LeadAnalysis | Sim | A |
| QualificationProfile | Sim | A |
| Qualification (engine/IA) | Sim | A |
| Pipeline / PipelineStage | Sim | A |
| Deal | Sim | A (há 1 registro, `lead_id = null`) |
| Task | Sim | A |
| Activity | Parcial — usado por Customers (C) e pelos módulos antigos | C |
| Digest | Sim | A |
| Tickets | Não no MVP; usado só por Compliance | A (após desacoplar Compliance) |
| Compliance | Fora da UI; retenção toca Conversation/Message | B/D |
| DataSubjectRequest | Sim (0 registros) | A (junto com Compliance) |
| Dashboard antigo | Sim (mock) | A |
| Telas de IA (`components/qualification/*`) | Sim | A |
| Telas comerciais (leads/deals/pipelines/tasks/tickets/settings/digest) | Sim | A |
| Tags | Usado por Customers (`CustomerTag`) e Leads | C |
| Customer | Ainda referenciado por `Contact.customerId` (opcional) | D |

> `Activity` só é usado por `CustomersService` depois que os módulos comerciais saírem. Se `Customer` também sair, `Activity` vira Categoria A.

### Categorias
- **A) Remover completamente**
- **B) Ocultar da interface, manter temporariamente**
- **C) Manter por dependência existente**
- **D) Precisa de análise adicional**

---

## 6. DOCUMENTAÇÃO

Documentos que ainda descrevem o CRM antigo (Lead/Bot/Qualification/Pipeline/Sales/Ticket/Handoff):

| Documento | Precisa atualizar? | Motivo |
|---|---|---|
| `docs/sales.md` | Sim | Lead/Pipeline/Deal/Task/Qualification |
| `docs/attendance.md` | Sim | Fluxo do bot, handoff, Ticket, digest, status de conversa |
| `docs/mvp-bot-qualificador.md` | Sim/obsoleto | Plano do bot |
| `docs/qualification-bot.md` | Sim/obsoleto | Bot |
| `docs/ai.md` | Sim | Configuração de IA |
| `docs/frontend.md` | Sim | Navegação/rotas antigas |
| `docs/database.md` | Sim | Entidades/relacionamentos |
| `docs/crm-core.md` | Sim | Contact com `customerId` obrigatório, endpoints |
| `docs/architecture.md` | Sim | "Planejado/Futuro" desatualizados |
| `docs/lgpd.md`, `docs/lgpd-ropa.md`, `docs/lgpd-retencao.md` | Revisar | Conforme decisão do Compliance |
| `README.md` | Sim | Status "fase de fundação" |
| `docs/auditoria-mvp.md` | Manter | Histórico da auditoria |
| `docs/multi-tenancy.md`, `docs/hardening.md`, `docs/development.md`, `docs/authentication.md` | Ajustes pontuais | Referências indiretas |
| `AGENTS.md` | Revisar | Status/fases |

---

## 7. BANCO — mapa de limpeza (não executar)

**ANTES (tabelas comerciais/IA):**
`leads`, `lead_tags`, `lead_qualification_sessions`, `lead_analyses`, `qualification_profiles`, `pipelines`, `pipeline_stages`, `deals`, `tasks`, `tickets`, `data_subject_requests`, `activities`, `customers`, `contacts`, `conversations`, `messages`, `whatsapp_instances`, `webhook_events`

**DEPOIS (núcleo MVP):**
`tenants`, `users`, `tenant_users`, `refresh_tokens`, `whatsapp_instances`, `contacts`, `conversations`, `messages`, `message_attachments`, `webhook_events` (+ `customers`, `tags`, `customer_tags`, `activities` se mantidos)

**Foreign Keys e colunas a remover (ordem segura):**

1. Desacoplar código primeiro (Leads, Qualification, Digest; adaptar/remover Compliance e os `leadId` de Deal/Task).
2. Remover colunas que apontam para `leads` em tabelas mantidas:
   - `conversations.lead_id` (FK `conversations_lead_id_fkey`)
   - `deals.lead_id`, `tasks.lead_id`, `tickets.lead_id`, `data_subject_requests.lead_id` (se as tabelas ficarem)
3. Remover tabelas satélites de Lead (CASCADE): `lead_analyses`, `lead_qualification_sessions`, `lead_tags`.
4. Remover `qualification_profiles` (após 3).
5. Remover `tickets` (após desacoplar `automated-review`).
6. Remover `deals`, `tasks`, `pipeline_stages`, `pipelines` (ordem: `tasks.deal_id` → `deals` → `pipeline_stages` → `pipelines`).
7. Remover `leads`.
8. Opcional: `activities`, `customers`, `tags`, `customer_tags`, `data_subject_requests`.
9. Enum `ConversationStatus`: recriar apenas com `OPEN`,`CLOSED` (0 conversas).
10. `deals.stage_id` é `RESTRICT` e `pipelines`/`pipeline_stages` são `CASCADE` — respeitar a ordem acima.

**Dados existentes que exigem decisão:** 1 Lead (`alan`, sem telefone), 1 Deal (`Nascimento montaveis`, sem lead), 1 Customer, 1 QualificationProfile, 5 Activities. Conversations/Messages/Contacts/Tickets = 0.

---

## 8. RESULTADO FINAL

| Módulo | Situação | Ação sugerida | Risco |
|---|---|---|---|
| Leads | Sem função; 1 registro sem telefone | B — remover código/rotas; manter tabela; **não migrar** o registro | Baixo |
| LeadTag | Sem uso (0 registros) | A — remover com Leads | Baixo |
| LeadQualificationSession | Sem uso (0) | A — remover | Baixo |
| LeadAnalysis | Sem uso (0) | A — remover | Baixo |
| QualificationProfile | Sem uso (1 seed) | A — remover após Qualification | Baixo |
| Qualification | Sem uso | A — remover (quebra Compliance) | Médio (Compliance) |
| Pipeline/PipelineStage | Sem uso (0) | A — remover | Baixo |
| Deals | 1 registro sem lead | A — confirmar descarte/arquivo do deal | Baixo |
| Tasks | Sem uso (0) | A — remover | Baixo |
| Activities | Usado por Customers e módulos antigos | C — manter enquanto Customers existir | Baixo |
| Digest | Sem uso | A — remover | Baixo |
| Tickets | Sem uso no MVP; usado por Compliance | A após desacoplar Compliance | Médio |
| Compliance | Sem UI; retenção de Conversation/Message | B/D — manter temporário, decidir retenção | Médio (LGPD) |
| DataSubjectRequest | Sem uso (0) | A — remover com Compliance | Baixo |
| Dashboard antigo (mock) | Sem uso | A — remover da UI | Baixo |
| Telas de IA (`components/qualification`) | Sem uso | A — remover | Baixo |
| Telas comerciais | Sem uso | A — remover | Baixo |
| Tags | Usado por Customers/Leads | C — manter; remover se Customers sair | Baixo |
| Customer | Dependência opcional de Contact | D — decidir manter vínculo opcional ou remover | Médio |

---

## PLANO DA ETAPA 8

### 1. Pode remover com segurança
- **Frontend:** remover páginas/features `dashboard`, `leads`, `deals`, `pipelines`, `tasks`, `tickets`, `digest`, `settings`, `customers` (se Customer não ficar) e `components/qualification`, `components/digest`, `mocks/`.
- **Backend:** `LeadsModule`, `QualificationProfilesModule`, `QualificationModule`, `PipelinesModule`, `DealsModule`, `TasksModule`, `DigestModule` (remover de `AppModule` + arquivos).
- **Tabelas:** `lead_tags`, `lead_qualification_sessions`, `lead_analyses`, `qualification_profiles`, `pipelines`, `pipeline_stages`, `leads` (0–1 registros triviais).
- **Testes:** correspondentes a esses módulos.

### 2. Deve permanecer temporariamente
- `TicketsModule` (até desacoplar `automated-review`).
- `ComplianceModule` + `DataSubjectRequest` (LGPD/retenção sobre Conversation/Message; sem UI).
- `ActivitiesModule` e `CustomersModule`/`TagsModule` enquanto `Contact.customerId` opcional existir.
- `ConversationStatus` com valores legados (inofensivo) até Digest/Compliance saírem.

### 3. Precisa de migração de dados
- **Lead `alan`**: sem telefone e sem vínculos; recomenda-se **não migrar** (arquivar/descartar mediante decisão).
- **Deal `Nascimento montaveis`**: sem lead/customer; decidir descartar ou manter.
- **ConversationStatus**: recriar enum para OPEN/CLOSED (0 conversas → sem perda).
- Colunas `*.lead_id` em tabelas mantidas.

### 4. Precisa de decisão nossa
1. O registro de Lead (`alan`) e o Deal legado são descartáveis?
2. `Customer` e `Tags` permanecem no MVP (vínculo opcional de `Contact`) ou saem?
3. `Compliance`/retenção de conversas permanece no backend (LGPD) ou sai do escopo?
4. `ConversationStatus` simplifica para `OPEN/CLOSED` agora ou junto da limpeza?
5. `Tickets` sai de vez (desacoplando Compliance) ou fica oculto?
6. Atualizar a documentação em qual ordem (junto da remoção ou depois)?

---

> **Regra cumprida:** etapa somente de análise. Nenhuma alteração de código, banco, rotas ou migrations foi executada.
