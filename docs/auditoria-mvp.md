# Auditoria do CRM — Preparação para definição do MVP

> **Status desta tarefa:** análise read-only.
> Nenhum código, schema, rota, componente ou migration foi alterado.
> Objetivo: diagnosticar o estado atual para decidir, em conjunto, o que permanece no MVP.

---

## 1. Mapeamento geral / visão de arquitetura

### Visão de repositório

```text
crm/
├── backend/          # API NestJS + Fastify + Prisma + PostgreSQL + Redis
├── frontend/         # React + Vite + Tailwind + shadcn/ui
├── docs/             # documentação funcional por fase
├── docker-compose.yml
├── AGENTS.md
└── README.md
```

### Stack

| Camada        | Tecnologia                                      | Status       |
| ------------- | ----------------------------------------------- | ------------ |
| Aplicação     | NestJS 12 (ESM)                                 | Implementado |
| HTTP adapter  | Fastify (`@nestjs/platform-fastify`)            | Implementado |
| ORM           | Prisma 7 + `@prisma/adapter-pg`                 | Implementado |
| Banco         | PostgreSQL 16                                   | Implementado |
| Cache/filas   | Redis + BullMQ (fallback `inline` em teste)     | Implementado |
| Realtime      | Socket.IO (namespace `/realtime`)               | Implementado |
| Crypto        | AES-256-GCM para credenciais de instância       | Implementado |
| Frontend      | React 19 + Vite + Tailwind + shadcn/ui          | Implementado |
| Dados no front| TanStack Query + Zustand + React Router         | Implementado |
| Testes        | Vitest (unit + integração/e2e)                  | Implementado |

### Backend (`backend/src`)

```text
src/
├── common/                 # cross-cutting
│   ├── errors/             # filtro global + AppException + códigos Prisma
│   ├── http/               # paginação, adapter, plugins, rate-limit
│   ├── logging/            # logger estruturado + requestId
│   └── tenant-context/     # AsyncLocalStorage + middleware + service
├── config/                 # validação de ambiente (Zod)
├── infrastructure/         # prisma, redis, crypto, queue, realtime
├── modules/                # 19 módulos de negócio
├── app.module.ts
└── main.ts
```

**Multi-tenancy:** toda entidade de negócio possui `tenantId`; o tenant é derivado do token + validação de membership (`TenantUser`) via `AsyncLocalStorage`, nunca de body/query/params/header.

### Frontend (`frontend/src`)

```text
src/
├── components/
│   ├── ui/                 # shadcn/ui customizado
│   ├── layout/             # AppLayout, Sidebar, Header, MainContent, NotificationsMenu
│   ├── common/             # PageHeader, SearchInput, StatusBadge, EmptyState, ...
│   ├── qualification/      # componentes de qualificação/IA
│   └── digest/             # DigestScheduleForm, DigestPreview
├── config/navigation.ts
├── features/               # auth, dashboard, customers, contacts, tags, leads,
│                           # deals, pipelines, tasks, tickets, attendance,
│                           # whatsapp, digest, settings, placeholder, not-found
├── lib/                    # api-client, query-client, format, utils
├── mocks/crm.ts            # dados fictícios (dashboard)
├── providers/
├── router/
├── stores/                 # auth, theme, ui (Zustand)
└── types/
```

### APIs, autenticação, jobs, realtime, WhatsApp

- **APIs:** REST sob prefixo `/api`; webhook público `POST /api/webhooks/evolution`.
- **Autenticação:** JWT de acesso + refresh token rotativo (Argon2id, cookie HttpOnly), guards globais `JwtAuthGuard` + `RolesGuard`, rotas `@Public()` liberadas.
- **Jobs/background:** `whatsapp.message.process`, `whatsapp.message.send`, `digest.tick`, `digest.deliver`, `compliance.retention.tick`, `compliance.retention.expunge`.
- **WebSocket:** Socket.IO autenticado por JWT + membership no handshake; rooms por tenant, usuário e conversa.
- **WhatsApp:** Evolution API v2 via `EvolutionClient`; instâncias por tenant; webhook com segredo.
- **Modelos centrais:** `WhatsAppInstance`, `Conversation`, `Message`, `MessageAttachment`, `Lead`, `Customer`, `Contact`.

---

## 2. Inventário de módulos

### Health
- **Objetivo:** liveness/readiness (API + PostgreSQL + Redis).
- **Funcionalidades:** verificação com timeout curto, sem vazar detalhes internos.
- **Rotas/páginas:** nenhuma no frontend.
- **APIs:** `GET /api/health` (público).
- **Tabelas/modelos:** —
- **Dependências:** Prisma, Redis.
- **Status:** completo.
- **Observações:** apropriado para liveness/readiness; não usa `@nestjs/terminus`.

### Auth
- **Objetivo:** autenticação e ciclo de sessão multi-tenant.
- **Funcionalidades:** login, refresh com rotação/revogação de família, logout, sessão atual (`me`), troca de tenant.
- **Rotas/páginas:** `/login`.
- **APIs:** `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/switch-tenant`.
- **Tabelas/modelos:** `User`, `TenantUser`, `RefreshToken`.
- **Dependências:** Memberships.
- **Status:** completo.
- **Observações:** senha nunca é logada; refresh opaco com hash SHA-256.

### Memberships
- **Objetivo:** resolver/validar membership e contexto de tenant.
- **Funcionalidades:** listagem de membros (`membershipId`, role, nome).
- **APIs:** `GET /api/members`.
- **Tabelas/modelos:** `TenantUser`.
- **Dependências:** Auth.
- **Status:** completo.
- **Observações:** usado apenas para popular selects de responsável (deals/tasks).

### Customers
- **Objetivo:** cadastro de clientes (empresas) do tenant.
- **Funcionalidades:** CRUD, status `ACTIVE/INACTIVE/ARCHIVED`, documento único por tenant, tags, lista/contagem de contatos.
- **Rotas/páginas:** `/clientes/clientes`, `/clientes/clientes/:id`.
- **APIs:** `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`.
- **Tabelas/modelos:** `Customer`, `CustomerTag`.
- **Dependências:** Tags, Activities.
- **Status:** completo.
- **Observações:** `document` é `UNIQUE (tenantId, document)`.

### Contacts
- **Objetivo:** contatos de uma empresa cliente.
- **Funcionalidades:** CRUD, `isPrimary`, e-mail/telefone/cargo. **Sempre exige `customerId`.**
- **Rotas/páginas:** `/clientes/contatos` (lista global) + aba dentro do detalhe do cliente.
- **APIs:** `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/:id`.
- **Tabelas/modelos:** `Contact`.
- **Dependências:** Customers.
- **Status:** completo, porém **desacoplado do atendimento WhatsApp**.
- **Observações:** `phone` é opcional e sem unicidade — não é a identidade usada pelo chat.

### Tags
- **Objetivo:** etiquetas para clientes e leads.
- **Funcionalidades:** CRUD, cor, contagens.
- **Rotas/páginas:** `/clientes/tags`.
- **APIs:** `GET/POST /tags`, `GET/PATCH/DELETE /tags/:id`.
- **Tabelas/modelos:** `Tag`, `CustomerTag`, `LeadTag`.
- **Dependências:** Customers, Leads.
- **Status:** completo.
- **Observações:** `UNIQUE (tenantId, name)`.

### Leads
- **Objetivo:** núcleo comercial (cadastro de leads, classificação e scoring).
- **Funcionalidades:** CRUD, status, tags, filtros, vínculo opcional com Customer/Contact.
- **Rotas/páginas:** `/vendas/leads`.
- **APIs:** `GET/POST /leads`, `GET/PATCH/DELETE /leads/:id`.
- **Tabelas/modelos:** `Lead`, `LeadTag`.
- **Dependências:** Customers, Contacts, Tags, Qualification, Tickets, Deals, Tasks, Digest, Compliance.
- **Status:** completo, **fortemente acoplado à qualificação por IA**.
- **Observações:** `phone` é `UNIQUE (tenantId, phone)`; é a identidade atual do contato de WhatsApp.

### Pipelines / Deals / Kanban
- **Objetivo:** funil de vendas e negócios.
- **Funcionalidades:** CRUD de pipelines/etapas (ordenação), CRUD de deals, board (kanban), movimentação de etapa persistida com `Activity`.
- **Rotas/páginas:** `/vendas/funil`, `/vendas/negocios`, `/settings/pipelines`.
- **APIs:** CRUD `/pipelines` (+stages), CRUD `/deals`, `GET /deals/board`, `PATCH /deals/:id/stage`.
- **Tabelas/modelos:** `Pipeline`, `PipelineStage`, `Deal`.
- **Dependências:** Leads, Customers, Contacts, Memberships.
- **Status:** completo.
- **Observações:** nenhuma movimentação automática por IA.

### Tasks
- **Objetivo:** tarefas comerciais.
- **Funcionalidades:** CRUD, status, prioridade, prazo, responsável; vínculo opcional com Lead/Deal/Customer.
- **Rotas/páginas:** `/tarefas`.
- **APIs:** `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`.
- **Tabelas/modelos:** `Task`.
- **Dependências:** Leads, Deals, Customers, Memberships.
- **Status:** completo.

### Activities
- **Objetivo:** histórico comercial/auditoria (`entity`, `entityId`, `action`, `metadata`).
- **Funcionalidades:** registro automático em mutações de Customer/Lead/Deal; consulta com filtros.
- **Rotas/páginas:** **nenhuma**.
- **APIs:** `GET /activities`.
- **Tabelas/modelos:** `Activity`.
- **Dependências:** —.
- **Status:** completo no backend, **sem tela** → aparentemente pouco utilizado.
- **Observações:** `userId` sem FK para preservar auditoria.

### Qualification / IA
- **Objetivo:** motor de qualificação por IA.
- **Funcionalidades:** perfis de qualificação, sessões, mensagens de avaliação, análise final (score, nível, outcome), revisão/reanálise, handoff humano.
- **Rotas/páginas:** `/settings/qualification-bot` (perfis); badges/análise no dashboard (mock).
- **APIs:** `POST /leads/:leadId/qualification-sessions`, `GET /qualification-sessions`, `GET /:id`, `POST /:id/messages`, `POST /:id/review`, `POST /:id/reanalyze`; `GET /lead-analyses`, `/:id`; CRUD `/qualification-profiles`.
- **Tabelas/modelos:** `QualificationProfile`, `LeadQualificationSession`, `LeadAnalysis`.
- **Dependências:** Leads, AI provider.
- **Status:** completo.
- **Observações:** `AiProvider` abstrai o provedor; `UnavailableAiProvider` faz handoff se não configurado; regras de LGPD no motor (sensibilidade, motivo objetivo).

### WhatsApp
- **Objetivo:** gerenciar instâncias e integração com Evolution API.
- **Funcionalidades:** CRUD de instâncias, conexão por QR/pairing, status, webhook, credenciais cifradas.
- **Rotas/páginas:** `/atendimento/whatsapp`.
- **APIs:** `/whatsapp/instances` (CRUD + connect/disconnect/webhook/status) + `POST /webhooks/evolution`.
- **Tabelas/modelos:** `WhatsAppInstance`, `WebhookEvent`, `Conversation`, `Message`.
- **Dependências:** Crypto, Config, Queue, Conversations.
- **Status:** completo para o fluxo atual.
- **Observações:** suporta múltiplas instâncias por tenant.

### Conversations / Messages
- **Objetivo:** atendimento (conversas e mensagens de WhatsApp).
- **Funcionalidades:** listagem, detalhe, takeover, close, mensagens paginadas, envio humano, processamento do bot, realtime.
- **Rotas/páginas:** `/atendimento/conversas`.
- **APIs:** `GET/POST /conversations`, `GET/PATCH /conversations/:id`, `POST /:id/takeover`, `POST /:id/close`, `GET/POST /:id/messages`.
- **Tabelas/modelos:** `Conversation`, `Message`, `MessageAttachment`.
- **Dependências:** WhatsApp, Leads, Qualification, Tickets, Realtime, Queue.
- **Status:** completo.
- **Observações:** conversa sempre isolada por `whatsappInstanceId + externalContactId`.

### Tickets
- **Objetivo:** chamados de atendimento.
- **Funcionalidades:** CRUD, status, prioridade, responsável; criado automaticamente no handoff do bot (um por conversa).
- **Rotas/páginas:** `/atendimento/tickets`.
- **APIs:** `GET/POST /tickets`, `GET/PATCH/DELETE /tickets/:id`.
- **Tabelas/modelos:** `Ticket`.
- **Dependências:** Conversations, Leads, Customers, Memberships.
- **Status:** completo.
- **Observações:** hoje só nasce via handoff do bot.

### Digest
- **Objetivo:** resumo diário de leads qualificados.
- **Funcionalidades:** preferência por membership, agendamento (`DAILY`), entrega `INTERNAL`/`WHATSAPP` (EMAIL não suportado), histórico idempotente, overview.
- **Rotas/páginas:** `/settings/lead-digest`.
- **APIs:** `GET/PUT /settings/lead-digest/preference`, `GET /deliveries`, `GET /overview`, `POST /run`.
- **Tabelas/modelos:** `LeadDigestPreference`, `LeadDigestDelivery`.
- **Dependências:** Leads, Qualification, WhatsApp, Queue, Realtime.
- **Status:** completo, **100% dependente de Lead**.

### Compliance (LGPD)
- **Objetivo:** DPO, retenção, direitos do titular e revisão de decisão automatizada.
- **Funcionalidades:** configurações de DPO/retenção, aceite legal, requisições do titular, acesso/exportação/retificação/erase, revisão, expurgo.
- **Rotas/páginas:** **nenhuma**.
- **APIs:** `/compliance/*` + público `GET /compliance/tenants/:tenantId/dpo`.
- **Tabelas/modelos:** `DataSubjectRequest`, campos de conformidade em `Tenant`/`Lead`/`Conversation`.
- **Dependências:** Leads, Qualification, Conversations, Queue.
- **Status:** implementado no backend, **sem tela** → aparentemente pouco utilizado.

### Webhooks
- **Objetivo:** ingestão de eventos da Evolution API.
- **Funcionalidades:** validação de segredo (`?token=` ou `x-webhook-secret`), idempotência por evento, resolução de instância → tenant, persistência de conversa/mensagem, enfileiramento.
- **APIs:** `POST /api/webhooks/evolution` (público).
- **Tabelas/modelos:** `WebhookEvent`.
- **Dependências:** WhatsApp, Conversations, Queue.
- **Status:** completo.

### Infra (não é módulo de negócio)
- `PrismaModule`, `RedisModule`, `CryptoModule`, `QueueModule`, `RealtimeModule`, `RateLimitModule`, `TenantContextModule`.

---

## 3. Análise específica do WhatsApp

- **Integração utilizada:** Evolution API v2 (`WHATSAPP-BAILEYS`). `EvolutionClient` centraliza as chamadas; `EVOLUTION_API_BASE_URL` + `EVOLUTION_API_KEY` (header `apikey`). Credenciais por instância (`apiKey`, `webhookSecret`) são opcionais e cifradas em AES-256-GCM — nunca retornam na API (`hasCredentials`).
- **Processo de conexão:** `POST /instance/create` (ou `GET /instance/connect` se já existir) → retorna **QR base64** e/ou **pairing code**. A UI exibe o QR, permite regenerar e faz *poll* de status a cada 3s. Desconectar = `DELETE /instance/logout`. Status = `GET /instance/connectionState`.
- **Armazenamento das conexões:** `whatsapp_instances` (`tenantId`, `name`, `instanceName` único global, `externalInstanceId?`, `phone?`, `status`, `credentialsEncrypted?`, `active`).
- **Múltiplos WhatsApps:** **SIM — já suportado.** N instâncias por tenant; `instanceName` é a chave global de resolução do webhook → tenant.
- **Identificação de cada WhatsApp:** `name`, `instanceName`, `phone`, `externalInstanceId`; as conversas guardam `whatsappInstanceId` e expõem `instanceName`.
- **Gerenciamento das conexões:** CRUD + connect/disconnect/webhook/status; escrita restrita a OWNER/ADMIN.
- **Recebimento de mensagens:** webhook valida segredo → `WebhookEvent` (idempotência `provider+externalEventId`) → resolve instância → trata apenas `messages.upsert` → `findOrCreateConversation(instance, externalContactId)` → persiste `Message` inbound (idempotente) → enfileira job.
- **Envio de mensagens:** `POST /message/sendText/{instanceName}`. Persistido como OUTBOUND; falha vira `FAILED` e reenfileira (`whatsapp.message.send`, com retry).
- **Webhooks:** configurados por instância (`POST /webhook/set`), **apenas evento `MESSAGES_UPSERT`**.
- **Eventos:** `messages.upsert` (entrada); eventos internos realtime `message.created`, `conversation.updated`.
- **Status da conexão:** enum `CONNECTED/CONNECTING/DISCONNECTED/ERROR`, atualizado na conexão e via `GET /:id/status`.
- **Reconexão:** **não há** varredura automática de status nem reconexão automática de sessão. "Conectar" reemite o QR. O retry existe apenas para envio de mensagens.
- **Contatos:** `Conversation.externalContactId` (JID/número) + `metadata.pushName`. **Não há vínculo com a entidade `Contact`.**
- **Conversas:** `findOrCreate` por `(whatsappInstanceId, externalContactId)`; conversa `CLOSED` reabre ao receber nova mensagem.
- **Mensagens:** `direction`, `type`, `content`, `externalMessageId` (idempotente), `status`, `metadata`, `occurredAt`.
- **Anexos/mídias:** `MessageAttachment` guarda **apenas metadados** (`storageKey`, `fileName`, `mimeType`, `size`). Nenhum binário no PostgreSQL. **Sem upload/download** — download/expurgo ficaram para fase futura.
- **Histórico:** persistido no banco; listagem paginada.
- **Notificações:** nenhuma (apenas eventos realtime).
- **WebSocket/SSE:** Socket.IO (namespace `/realtime`).
- **Filas:** BullMQ (ou `inline` em teste) para processamento e reenvio.

### O que já está pronto e pode ser reaproveitado para um MVP de Multi WhatsApp

- CRUD de instâncias, QR/pairing, webhook por instância, status.
- Criptografia de credenciais por instância.
- Ingestão idempotente de webhook e resolução instância → tenant.
- Criação de conversa por `(instância, contato)`, mensagens e histórico.
- Envio, persistência e retry.
- Realtime por tenant/conversa.

### O que falta para Multi WhatsApp "de verdade"

- Filtro/agrupamento por instância no chat (a API já filtra por `whatsappInstanceId`; **a UI não expõe**).
- Varredura automática de status, auto-reconexão e monitoramento contínuo das sessões.
- Envio em qualquer estado (hoje só `HUMAN`).
- Mídia (download/upload) e notificações.

---

## 4. Análise do módulo de Chat

- **Lista de conversas:** sim, com busca (subject/nome/telefone) e filtro por status; ordena por `lastMessageAt`.
- **Conversa individual:** sim, layout de 3 colunas (lista, thread, painel do "Cliente").
- **Mensagens:** paginadas, com direção, status (exibe "falha no envio") e placeholder `[tipo]` para não-texto.
- **Envio:** apenas quando `status = HUMAN` (exige takeover). Fora disso, `409 CONVERSATION_NOT_HUMAN_OWNED`.
- **Recebimento:** webhook → persistência → job.
- **Atualização em tempo real:** Socket.IO (`message.created`, `conversation.updated`) + fallback `refetchInterval` (15s lista / 10s mensagens).
- **Identificação do contato:** `leadName/leadPhone` ou `externalContactId`.
- **Identificação do WhatsApp utilizado:** `instanceName` exibido na conversa; **sem filtro por instância na UI**.
- **Busca:** por subject/nome/telefone.
- **Filtros:** status (frontend); `whatsappInstanceId`, `leadId`, `customerId` (API apenas).
- **Histórico:** completo e paginado.
- **Status das mensagens:** `RECEIVED/PENDING/SENT/DELIVERED/READ/FAILED` (UI destaca falha).
- **Mídias:** apenas placeholder de tipo; sem renderização real.
- **Notificações:** nenhuma (sem contadores de não-lidas).
- **Arquivamento:** não existe — apenas status `CLOSED`.
- **Outras:** takeover e close.

### Estrutura suficiente para múltiplos WhatsApps?

O **modelo de dados já suporta** (conversa sempre isolada por `whatsappInstanceId`, `instanceName` disponível e filtro na API). O que falta é **adaptação de frontend** para visualizar/filtrar/agrupar por WhatsApp. No backend, o bot busca **um único** `QualificationProfile` do tenant (`findFirst`), não um perfil por instância.

---

## 5. Análise de Contatos

- **Cadastro/edição/exclusão:** completos (`/contacts`), lista global e por cliente.
- **Telefone:** opcional, **sem unicidade/deduplicação por telefone**.
- **Nome:** obrigatório.
- **Histórico:** não há tela de histórico de conversas por contato.
- **Relacionamento com conversas:** existe `Conversation.contactId`, mas **nunca é preenchido pelo fluxo de WhatsApp** (só via API manual).
- **Relacionamento com WhatsApp:** inexistente na entidade `Contact`. A identidade real do atendimento é `Lead.phone` + `Conversation.externalContactId`.
- **Duplicidade:** sem proteção; `Lead` tem `UNIQUE (tenantId, phone)`, mas `Contact` não.
- **Identificação pelo telefone:** feita por `Lead.phone` no fluxo do bot.
- **Banco:** `Contact` (com `customerId` obrigatório) e `Lead` (identidade de WhatsApp) são entidades separadas e sem ligação.
- **APIs:** `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/:id`.

### Um mesmo contato pode ter conversas por WhatsApps diferentes?

- No banco, o `Lead` é único por `(tenantId, phone)` → o **mesmo lead** aparece independente da instância, e as **conversas** são separadas por instância.
- Porém **`Contact` e `Lead` não se conversam**: o contato do atendimento não é o `Contact` do CRM.
- **Conclusão:** a estrutura atual **não permite** que a entidade `Contact` (que exige `Customer`) represente essa identidade. Essa é a principal decisão estrutural do MVP.

---

## 6. Análise do módulo de Leads

- **Telas:** `/vendas/leads` (lista + formulário); badges de qualificação no Dashboard (dados mock).
- **APIs:** CRUD `/leads`; filtros `status`, `customerId`, `tagId`, `search`; `GET /activities`.
- **Tabelas:** `Lead`, `LeadTag`.
- **Classificações/status:** `NEW`, `QUALIFYING`, `QUALIFIED_WAITING_DIGEST`, `DISQUALIFIED`, `NEEDS_HUMAN`, `ASSIGNED`.
- **Scoring:** via `LeadAnalysis` (`score` 0–100, `qualificationLevel`, strengths/risks/reasons).
- **Etapas/automações:** sessão de qualificação (`LeadQualificationSession`), digest diário, handoff → `Ticket`.
- **Relacionamentos:** `Lead` ↔ Customer/Contact (opcionais), Tags, Deals, Tasks, Sessions, Analyses, Conversations, Tickets, DataSubjectRequests.
- **Componentes:** badges/score/progresso de qualificação, `AiAnalysisCard`, formulário/lista de leads.
- **Filtros:** status, customerId, tagId, search.
- **Dashboards:** `DashboardPage` (métricas/leads/análise) usa **dados mock**.
- **Funcionalidades dependentes:**
  - `QualificationModule` (sessões, análises, engine, IA) — **depende integralmente**.
  - `DigestModule` — depende de leads `QUALIFIED_WAITING_DIGEST` e `LeadAnalysis`.
  - `ConversationProcessingService` — **cria Lead** e dirige o bot; em `NEEDS_HUMAN` cria Ticket.
  - `Deals` / `Tasks` — vínculo opcional (`leadId`).
  - `Compliance` (`DataSubjectRequest` por `leadId`) e `Activities`.

### Impacto da retirada

**Alto.** O atendimento WhatsApp hoje **pressupõe** Lead + perfil de qualificação. Remover exige:
1. Reescrever o `ConversationProcessingService` (ou desligar o bot).
2. Realocar a identidade do contato de WhatsApp.
3. Reavaliar Contacts, Deals, Tasks, Tickets, Digest e Compliance.

---

## 7. Dependências entre módulos

```text
Auth/Memberships ──> (todos os módulos, via TenantContext)

WhatsAppInstance
   └─> Conversation ──> Message ──> MessageAttachment
          ├─(opcional)─> Lead ──> LeadQualificationSession ──> LeadAnalysis
          │                 │
          │                 ├─> LeadTag / Digest
          │                 ├─> Ticket
          │                 └─> Compliance (DataSubjectRequest)
          ├─(opcional)─> Customer ──> Contact
          └─(opcional)─> Ticket

QualificationProfile ──> LeadQualificationSession ──> LeadAnalysis

Pipeline ──> PipelineStage ──> Deal ──(opcional: Lead/Customer/Contact)
Task ──(opcional: Lead/Deal/Customer)

Tags ──> CustomerTag | LeadTag
```

**Removíveis sem quebrar Chat/Contatos/WhatsApp:** Deals/Pipelines, Tasks, Digest, Qualification/Perfis, Activities, (Tickets a decidir), Compliance (a decidir).

**Nó mais central do fluxo do bot:** `Leads`. Removê-lo obriga a mexer no processamento de conversas.

---

## 8. Banco de dados

| Modelo | Finalidade | Campos-chave | Relações | Útil no MVP? |
| --- | --- | --- | --- | --- |
| `Tenant` | Organização | name, DPO, retenção, termos | raiz do isolamento | Sim |
| `User` / `TenantUser` | Identidade global / membership | role, active | N:N | Sim |
| `RefreshToken` | Sessão | tokenHash, familyId | User/Tenant | Sim |
| `Customer` | Cliente (empresa) | name, document, status | contacts, leads, deals, conversations, tickets | A decidir |
| `Contact` | Contato do cliente | name, phone, isPrimary | **customerId obrigatório** | A decidir/repensar |
| `Tag` / `CustomerTag` / `LeadTag` | Etiquetas | name, color | Customer/Lead | A decidir |
| `QualificationProfile` | Config do bot | JSONs de critérios | sessions/analyses | Candidato a remoção |
| `Lead` | Lead / contato de WhatsApp | phone único/tenant, status | sessions, deals, tasks, conversations, tickets | Candidato a remoção (mas é a identidade atual do chat) |
| `Pipeline` / `PipelineStage` / `Deal` | Funil | stage, value, status | lead/customer/owner | Candidato a remoção |
| `Task` | Tarefas | dueAt, owner | lead/deal/customer | Candidato a remoção |
| `Activity` | Auditoria comercial | entity, action | — | A decidir |
| `LeadQualificationSession` / `LeadAnalysis` | Qualificação IA | transcript, score, outcome | Lead/Profile | Candidato a remoção |
| `WhatsAppInstance` | Instância WhatsApp | instanceName único, status, credentialsEncrypted | conversations | **Sim (núcleo)** |
| `Conversation` | Conversa | whatsappInstanceId, externalContactId, status | instance, messages, lead/customer/contact | **Sim (núcleo)** |
| `Message` | Mensagem | direction, type, externalMessageId, status | conversation, attachments | **Sim (núcleo)** |
| `MessageAttachment` | Metadados de mídia | storageKey, mimeType, size | message | Sim (se mídia) |
| `Ticket` | Chamado | status, priority, assignee | conversation/lead/customer | A decidir |
| `LeadDigestPreference` / `LeadDigestDelivery` | Resumo diário | timeZone, channel | TenantUser | Candidato a remoção |
| `WebhookEvent` | Idempotência | provider, externalEventId | — | **Sim** |
| `DataSubjectRequest` | LGPD | type, status | lead | A decidir |

**Observação crítica:** `Conversation` tem `leadId`, `customerId`, `contactId` opcionais e `externalContactId`. A identidade real do atendimento é `externalContactId` / `Lead.phone`.

---

## 9. Frontend — telas e navegação

| Tela | Rota | Módulo | Objetivo | Relação |
| --- | --- | --- | --- | --- |
| Dashboard | `/dashboard` | dashboard | Visão geral comercial | **Mock** (`mocks/crm.ts`), Leads/qualificação |
| Leads | `/vendas/leads` | leads | Lista/form de leads | Leads |
| Funil (Kanban) | `/vendas/funil` | deals | Board drag and drop | Deals |
| Negócios | `/vendas/negocios` | deals | Lista de negócios | Deals |
| Clientes | `/clientes/clientes` | customers | Lista de clientes | Contatos/Clientes |
| Cliente (detalhe) | `/clientes/clientes/:id` | customers | Dados + contatos | Contatos/Clientes |
| Contatos | `/clientes/contatos` | contacts | Lista global | Contatos |
| Tags | `/clientes/tags` | tags | Gestão de tags | Clientes/Leads |
| Conversas | `/atendimento/conversas` | attendance | Chat 3 colunas + realtime | **WhatsApp/Chat** |
| Tickets | `/atendimento/tickets` | tickets | Chamados | Chat/Leads |
| WhatsApp | `/atendimento/whatsapp` | whatsapp | Instâncias/QR/webhook | **WhatsApp** |
| Tarefas | `/tarefas` | tasks | Tarefas | Leads/Deals |
| Relatórios | `/relatorios` | placeholder | — | **Placeholder, não funciona** |
| Bot e Qualificação | `/settings/qualification-bot` | qualification | Perfis do bot | Leads/IA |
| Resumo de Leads | `/settings/lead-digest` | digest | Digest diário | Leads |
| Pipelines | `/settings/pipelines` | pipelines | CRUD de etapas | Deals |

**Navegação (sidebar):** Dashboard; Vendas (Leads, Funil, Negócios); Clientes (Clientes, Contatos, Tags); Atendimento (Conversas, Tickets, WhatsApp); Tarefas; Relatórios; Configurações (Bot, Resumo de Leads, Pipelines).

**Itens mock/experimentais/não funcionais:** `DashboardPage` (dados fictícios), `NotificationsMenu` (3 notificações hardcoded), `Relatórios` (placeholder), `mocks/crm.ts`, `features/members` (só selects). **Sem telas para Activities e Compliance.**

---

## 10. Backend/API — mapa funcional

### Autenticação / Usuários
- `POST /auth/login` — autentica e emite acesso + refresh.
- `POST /auth/refresh` — rotaciona refresh.
- `POST /auth/logout` — encerra sessão.
- `GET /auth/me` — sessão atual.
- `POST /auth/switch-tenant` — troca tenant ativo.
- `GET /members` — lista memberships.

### WhatsApp
- `GET/POST /whatsapp/instances` — listar/criar instância.
- `GET/PATCH/DELETE /whatsapp/instances/:id` — detalhar/editar/remover.
- `POST /whatsapp/instances/:id/connect` — gera QR/pairing.
- `POST /whatsapp/instances/:id/disconnect` — desconecta.
- `POST /whatsapp/instances/:id/webhook` — configura webhook.
- `GET /whatsapp/instances/:id/status` — atualiza status.
- `POST /webhooks/evolution` — webhook público da Evolution.

### Chat
- `GET/POST /conversations` — listar/criar conversa.
- `GET/PATCH /conversations/:id` — detalhar/atualizar.
- `POST /conversations/:id/takeover` — assumir como humano.
- `POST /conversations/:id/close` — encerrar.
- `GET/POST /conversations/:id/messages` — listar/enviar mensagens.
- CRUD `/tickets` — chamados.

### Contatos
- CRUD `/customers`.
- CRUD `/contacts`.
- CRUD `/tags`.

### Leads
- CRUD `/leads`.
- `GET /activities`.

### Qualificação / IA
- `POST /leads/:leadId/qualification-sessions`.
- `GET /qualification-sessions`, `GET /:id`, `POST /:id/messages`, `POST /:id/review`, `POST /:id/reanalyze`.
- `GET /lead-analyses`, `GET /:id`.
- CRUD `/qualification-profiles`.

### Vendas
- CRUD `/pipelines` (+ `/:id/stages`).
- CRUD `/deals`, `GET /deals/board`, `PATCH /deals/:id/stage`.
- CRUD `/tasks`.

### Compliance
- `GET /compliance/settings`, `PUT /settings/dpo`, `PUT /settings/retention`, `POST /settings/legal-acceptance`.
- `GET /compliance/requests`, `GET /requests/:id`.
- `GET /subjects/leads/:leadId/access`, `GET /export`, `POST /rectify`, `POST /erase`, `POST /consent-revocation`, `POST /opposition`.
- `GET /reviews/sessions/:sessionId`, `POST /request`, `POST /resolve`.
- `POST /retention/run`.
- Público: `GET /compliance/tenants/:tenantId/dpo`.

### Outros
- `GET /health`.
- `/settings/lead-digest/*`.

---

## O que podemos reaproveitar

**Núcleo (alto valor, pronto):**
- Autenticação + autorização + multi-tenancy + memberships + TenantContext.
- **Infraestrutura de WhatsApp**: `WhatsAppInstance`, `EvolutionClient`, conexão por QR/pairing, webhook por instância, criptografia de credenciais, status.
- **Ingestão de webhook** idempotente e resolução instância → tenant.
- **Chat**: `Conversation` / `Message` / `MessageAttachment`, listagem, histórico, envio humano, takeover, close.
- **Realtime** Socket.IO com rooms por tenant/conversa e fallback de polling.
- **Filas** BullMQ com retry de envio.
- Banco/Prisma, paginação, rate-limit, filtro global de erros, validação de env.
- **Frontend**: design system completo, layout/sidebar, `api-client`, `query-client`, e as telas **Conversas** e **WhatsApp** já funcionais.
- **Customers / Contacts / Tags** (CRUD) — reaproveitáveis se o MVP mantiver cadastro.

---

## Candidatos a remoção

> Nada será removido agora — apenas listado.

- **Qualificação por IA**: `QualificationProfile`, `LeadQualificationSession`, `LeadAnalysis`, engine, providers de IA, tela "Bot e Qualificação".
- **Digest de leads**: `LeadDigestPreference/Delivery`, tela e jobs.
- **Leads**: módulo e classificação/scoring — **desde que** a identidade do contato de WhatsApp seja realocada.
- **Pipelines/Deals/Kanban** e **Tasks**.
- **Activities** (sem UI).
- **Tickets** (a decidir; hoje só existe via handoff do bot).
- **Compliance/LGPD** (decidir se sai do MVP ou é mantido como blindagem).
- **Dashboard mock**, **menu de notificações mock** e **placeholder de Relatórios**.
- **Tags** (se não houver Customer/Lead).

---

## 13. Proposta inicial de arquitetura do MVP

A hipótese (`WhatsApp` → `Chat` → `Contatos`) é **coerente com o que já existe**. Ajustes sugeridos:

```text
CRM MVP
├── WhatsApp
│   ├── Instâncias (N por tenant)         [JÁ EXISTE]
│   ├── Conexão (QR/pairing) + status     [JÁ EXISTE, falta auto-status]
│   └── Webhook + envio                   [JÁ EXISTE]
│
├── Chat
│   ├── Todas as conversas                [JÁ EXISTE]
│   ├── Filtro por WhatsApp               [API ok, FALTA UI]
│   ├── Conversa + mensagens              [JÁ EXISTE]
│   └── Enviar/receber em tempo real      [JÁ EXISTE — hoje só após takeover]
│
└── Contatos
    ├── Contatos (identidade WhatsApp)    [NÃO EXISTE como entidade própria]
    └── Histórico de conversas            [NÃO EXISTE tela por contato]
```

**Ponto de decisão estrutural:** hoje a identidade do contato no WhatsApp é o `Lead` (auto-criado) e a entidade `Contact` é "contato de empresa" (exige `Customer`). Para o MVP "Contatos", o caminho natural é **criar/reaproveitar uma entidade de contato desacoplada de Customer** e vincular conversas por telefone (`externalContactId`), eventualmente ligando a `Customer` de forma opcional. Isso evita carregar `Lead` só para representar um número.

---

## 14. Relatório final

### 1. Módulos existentes
Auth, Memberships, Health, Customers, Contacts, Tags, Leads, Pipelines/Deals, Tasks, Activities, Qualification/IA, WhatsApp, Conversations/Messages, Tickets, Webhooks, Digest, Compliance.

### 2. Funcionalidades existentes
Descritas nas §§2–10. Quase tudo tem backend completo + testes. Lacunas de UI: `Activities` e `Compliance`; mocks: Dashboard/Notificações/Relatórios.

### 3. WhatsApp
Pronto para **múltiplas instâncias** (registro, QR, webhook, status, credenciais cifradas, ingestão idempotente, envio/retry, realtime). Falta: UI de filtro por instância, auto-reconexão/monitoramento, envio fora do estado `HUMAN`, mídia.

### 4. Chat
Completo e já modelado por instância; precisa adaptar a UI para **visualizar/filtrar por WhatsApp** e flexibilizar o envio.

### 5. Contatos
CRUD existe, mas **desconectado do WhatsApp**; precisa de entidade/estratégia de identidade por telefone e tela de histórico.

### 6. Leads
É o **nó central** do bot e da classificação; remoção impacta Qualificação, Digest, Tickets, Deals, Tasks, Compliance e o `ConversationProcessingService`. Deve ser a **última** peça a mexer.

### 7. Banco de dados
Núcleo reutilizável = `WhatsAppInstance`, `Conversation`, `Message`, `WebhookEvent`; a decidir = `Lead`/`Contact`/`Customer`/`Ticket`; candidatos = `QualificationProfile`, `LeadQualificationSession`, `LeadAnalysis`, `Pipeline*`, `Deal`, `Task`, `LeadDigest*`.

### 8. Funcionalidades candidatas ao MVP
WhatsApp (instâncias/conexão/webhook), Chat (conversas/mensagens/realtime), Contatos com histórico — reusando Auth, multi-tenancy, Crypto, Queue, Realtime e o design system.

### 9. Funcionalidades candidatas à remoção
Qualificação/IA, Digest, Leads (com realocação de identidade), Pipelines/Deals/Kanban, Tasks, Activities, mocks/placeholder, e (a decidir) Tickets e Compliance.

### 10. Riscos
- Acoplamento do pipeline WhatsApp ↔ Lead ↔ bot.
- Identidade de contato fragmentada (`Lead.phone` vs `Contact` vs `externalContactId`).
- Migrations destrutivas ao remover entidades.
- Testes atuais cobrem muito do que sairia (refatorar bateria de testes).
- Bot usa perfil global (`findFirst`), não por instância.
- Envio restrito ao estado `HUMAN` e ausência de mídia.
- Documentação desatualizada (ainda diz "WhatsApp futuro").

### 11. Perguntas/decisões
1. `Contact` do MVP = identidade de WhatsApp? Reaproveitar `Contact` (sem `Customer` obrigatório) ou nova entidade?
2. Manter `Customer`? Manter `Tags`?
3. Leads sai de vez ou fica reduzido (sem IA/scoring)?
4. O bot de qualificação fica no MVP? Se não, simplificar status de conversa (ex.: ABERTA/EM_ATENDIMENTO/FECHADA)?
5. Tickets fica para handoff ou sai?
6. Compliance/LGPD fica no MVP ou vira fase posterior?
7. Estratégia para dados existentes de Leads → Contatos (migração futura).
8. Chat por instância: filtro, badge e/ou agrupamento?
9. Agente pode responder sem "assumir" a conversa?
10. Mídia (imagem/áudio/documento) entra no MVP?

---

> **Regra cumprida:** etapa exclusivamente de análise. Nada foi implementado, removido, refatorado ou migrado.
