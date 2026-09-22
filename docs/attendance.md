# Atendimento, WhatsApp e digest — OrderUp CRM

> Status: **Implementado** (Prompt 07). Instâncias WhatsApp, webhook da Evolution, conversas,
> mensagens, tickets, realtime e digest agendado. O motor de qualificação do Prompt 06 é reutilizado
> sem duplicar lógica.

Complementa [`sales.md`](./sales.md) e [`multi-tenancy.md`](./multi-tenancy.md).

## Arquitetura do fluxo

```text
Lead no WhatsApp
  → Evolution API
  → POST /api/webhooks/evolution (valida segredo, resolve instância → tenant)
  → WebhookEvent (idempotência) + Conversation + Message
  → fila (BullMQ; inline em testes)
  → Lead (localiza/cria) + LeadQualificationSession
  → QualificationEngine (Prompt 06)
  → ASK | COMPLETE | NEEDS_HUMAN
  → Evolution sendText (mensagem persistida como OUTBOUND)
  → Socket.IO (rooms por tenant/conversa)
```

## Entidades

- `WhatsAppInstance`: `tenantId`, `name`, `instanceName` (único global, chave de resolução do
  webhook), `externalInstanceId?`, `phone?`, `status`, `credentialsEncrypted?`, `active`.
- `Conversation`: `tenantId`, `whatsappInstanceId`, `externalContactId?` (JID/número, chave de
  dedupe por instância), `leadId?`, `customerId?`, `contactId?`, `status`, `subject?`,
  `lastMessageAt?`, `closedAt?`.
- `Message`: `conversationId`, `direction`, `type`, `content?`, `externalMessageId?`
  (`UNIQUE (tenantId, externalMessageId)` = idempotência), `status`, `metadata`, `occurredAt`.
- `MessageAttachment`: **metadados** de mídia (`storageKey`, `fileName`, `mimeType`, `size`,
  `metadata`). Nenhum binário é gravado no PostgreSQL.
- `Ticket`: `subject`, `status`, `priority`, `assigneeId?`, `conversationId?`, `leadId?`,
  `customerId?`.
- `LeadDigestPreference` (1 por membership) e `LeadDigestDelivery` (`UNIQUE (tenantUserId,
  periodStart)` = idempotência).
- `WebhookEvent`: `provider`, `externalEventId`, `eventType`, `payload`, `processedAt`
  (`UNIQUE (provider, externalEventId)` = idempotência de webhook).

### Retenção (LGPD — planejado para o Prompt 09)

`Conversation`/`Message` armazenam dado pessoal de Lead. O prazo esperado de retenção é
**12 meses** após o encerramento da conversa, seguido de anonimização/expurgo. A rotina fica para o
Prompt 09; `MessageAttachment.metadata`, `Message.metadata` e `LeadAnalysis` seguem a mesma política.

## Segurança

- Credenciais de instância são criptografadas (AES-256-GCM) com `CREDENTIALS_ENCRYPTION_KEY` e
  **nunca** retornam na API (`hasCredentials: true|false` apenas).
- O webhook valida `EVOLUTION_WEBHOOK_SECRET` via `?token=` ou header `x-webhook-secret`.
- O tenant **nunca** vem do payload: é resolvido por `instanceName` → `WhatsAppInstance`.
- Endpoints autenticados exigem membership; escrita de instância restrita a OWNER/ADMIN.
- Logs não incluem conteúdo sensível nem credenciais.

## Evolution API

Serviço centralizado em `WhatsAppModule` (`EvolutionClient`), configurado por
`EVOLUTION_API_BASE_URL` + `EVOLUTION_API_KEY` (header `apikey`). Endpoints usados (v2):

```text
POST   /instance/create                   body { instanceName, qrcode, integration }
GET    /instance/connect/{instanceName}
DELETE /instance/logout/{instanceName}
GET    /instance/connectionState/{instanceName}
POST   /message/sendText/{instanceName}   body { number, text }
POST   /webhook/set/{instanceName}        body { webhook: { enabled, url, events, base64 } }
```

### Conectar um número (UI)

Em **Atendimento → WhatsApp** (`/atendimento/whatsapp`):

1. **Nova instância** (nome, `instanceName`, telefone, credenciais opcionais).
2. **Conectar** → o backend cria a instância na Evolution (`POST /instance/create`) ou, se já
   existir, usa `GET /instance/connect`; retorna o **QR code** (base64) e/ou o **código de
   pareamento**.
3. A tela exibe o QR, permite **gerar novo QR** e faz *poll* de status até **Conectado**.
4. O **webhook é configurado automaticamente** (evento `MESSAGES_UPSERT`) com o token do segredo
   (da instância ou `EVOLUTION_WEBHOOK_SECRET`); há também a ação **Reconfigurar webhook**.
5. Desconectar/excluir a instância permanecem disponíveis.

### Requisitos de configuração

- `PUBLIC_API_URL`: URL pública do backend usada para montar o webhook
  (`{PUBLIC_API_URL}/api/webhooks/evolution?token=...`). Em **dev local** a Evolution precisa
  alcançar o backend, então use um túnel (ngrok/cloudflared) apontando para `http://localhost:3000`
  e defina `PUBLIC_API_URL` com a URL do túnel. Sem ele, a configuração de webhook falha com
  `PUBLIC_API_URL_MISSING`.
- `EVOLUTION_WEBHOOK_SECRET` (ou o `webhookSecret` por instância) é o token validado no webhook.
- A URL retornada pela API nunca inclui o token (segredo não vaza para o frontend nem para logs).

## Endpoints

| Método | Rota                                             | Papéis           |
| ------ | ------------------------------------------------ | ---------------- |
| GET    | `/api/whatsapp/instances`                        | autenticado      |
| GET    | `/api/whatsapp/instances/:id`                    | autenticado      |
| POST   | `/api/whatsapp/instances`                        | `OWNER`, `ADMIN` |
| PATCH  | `/api/whatsapp/instances/:id`                    | `OWNER`, `ADMIN` |
| DELETE | `/api/whatsapp/instances/:id`                    | `OWNER`, `ADMIN` |
| POST   | `/api/whatsapp/instances/:id/connect`            | `OWNER`, `ADMIN` |
| POST   | `/api/whatsapp/instances/:id/disconnect`         | `OWNER`, `ADMIN` |
| POST   | `/api/whatsapp/instances/:id/webhook`            | `OWNER`, `ADMIN` |
| GET    | `/api/whatsapp/instances/:id/status`             | autenticado      |
| POST   | `/api/webhooks/evolution`                         | público (segredo)|
| GET    | `/api/conversations`                             | autenticado      |
| GET    | `/api/conversations/:id`                         | autenticado      |
| POST   | `/api/conversations`                             | autenticado      |
| PATCH  | `/api/conversations/:id`                         | autenticado      |
| POST   | `/api/conversations/:id/takeover`                | autenticado      |
| POST   | `/api/conversations/:id/close`                   | autenticado      |
| GET    | `/api/conversations/:id/messages`                | autenticado      |
| POST   | `/api/conversations/:id/messages`                | autenticado      |
| GET    | `/api/tickets`                                   | autenticado      |
| GET    | `/api/tickets/:id`                               | autenticado      |
| POST   | `/api/tickets`                                   | autenticado      |
| PATCH  | `/api/tickets/:id`                               | autenticado      |
| DELETE | `/api/tickets/:id`                               | `OWNER`, `ADMIN` |
| GET    | `/api/settings/lead-digest/preference`           | autenticado      |
| PUT    | `/api/settings/lead-digest/preference`           | autenticado      |
| GET    | `/api/settings/lead-digest/deliveries`           | autenticado      |
| GET    | `/api/settings/lead-digest/overview`             | autenticado      |
| POST   | `/api/settings/lead-digest/run`                  | `OWNER`, `ADMIN` |

O envio humano (`POST /api/conversations/:id/messages`) exige `status = HUMAN`; sem takeover
responde `409 CONVERSATION_NOT_HUMAN_OWNED`. O bot só responde enquanto a conversa estiver em
`BOT_QUALIFYING` — após handoff ele fica silencioso.

## Bot de qualificação

- Primeira interação: envia `privacyNoticeText` (nunca omitido em perfil ativo) e `initialMessage`
  antes da primeira pergunta.
- Cada resposta do Lead é avaliada pelo `QualificationEngine` (Prompt 06): não repete informação já
  coletada, respeita `requiredInformation`/critérios e trata linguagem natural.
- `ASK` → envia a próxima pergunta. `COMPLETE` → persiste `LeadAnalysis`, marca a conversa como
  `QUALIFIED_WAITING_DIGEST`/`DISQUALIFIED`, envia `qualifiedMessage`/`disqualifiedMessage`. A
  mensagem de desqualificação sempre cita o motivo objetivo e oferece revisão ("falar com
  atendente").
- `NEEDS_HUMAN` → envia `needsHumanMessage`, marca `NEEDS_HUMAN` e cria um `Ticket` (uma vez por
  conversa).
- Mensagens não-texto recebem um aviso para enviar texto.
- Entrada tratada como conteúdo não confiável; o prompt do provedor reafirma resistência a injeção e
  proibição de revelar prompt/configuração/secrets.
- A sessão persiste `collectedData`, `transcript` e `questionCount` no banco (sobrevive a restart).

## Filas e realtime

- `QUEUE_DRIVER=bullmq` (produção/dev) usa BullMQ sobre `REDIS_URL`; `inline` processa no próprio
  request e é o padrão em `NODE_ENV=test`, mantendo os testes determinísticos.
- Jobs carregam `tenantId` explícito: `whatsapp.message.process`, `whatsapp.message.send`,
  `digest.tick`, `digest.deliver`. O processamento reestabelece o `TenantContext` no início.
- Envio com falha é persistido como `FAILED` e reenfileirado (`whatsapp.message.send`) com retry.
- Realtime: gateway Socket.IO no namespace `/realtime`, autenticado por JWT + membership no
  handshake. Rooms: `tenant:{tenantId}`, `tenant:{tenantId}:user:{userId}`,
  `tenant:{tenantId}:conversation:{conversationId}`. Eventos são emitidos por room — nunca
  `server.emit`.
- O frontend usa Socket.IO como caminho principal e `refetchInterval` apenas como fallback.

## Digest agendado

- `LeadDigestPreference` por membership: `frequency = DAILY` (MVP), `deliveryTime` (`HH:mm`),
  `timeZone` (IANA), `channel` (`INTERNAL` | `WHATSAPP` | `EMAIL`), `whatsappDestination?`,
  `includeOnlyAssigned`.
- Um tick (`digest.tick`, a cada 15 min) identifica preferências vencidas pela janela diária no
  timezone configurado e enfileira `digest.deliver` com `{ tenantId, tenantUserId, periodStart,
  periodEnd }`.
- `LeadDigestDelivery` é idempotente por `(tenantUserId, periodStart)`. Enquanto a entrega não tem
  sucesso, os leads **não** são marcados como entregues; falha preserva as pendências e permite
  retry. Janela sem leads gera entrega `SKIPPED` (sem mensagem).
- Ao entregar: leads em `QUALIFIED_WAITING_DIGEST` da janela viram `ASSIGNED`, a preferência
  atualiza `lastDeliveredAt` e uma `Activity` é registrada. O digest é **um** resumo agrupado, nunca
  uma notificação por lead.
- `INTERNAL` está sempre disponível (visão "Leads aguardando resumo"). `WHATSAPP` envia pelo
  `whatsappDestination` (jamais pelo número do Lead). `EMAIL` ainda não é suportado
  (`CHANNEL_UNSUPPORTED`).

## Mídia e storage

Binários (imagem/áudio/vídeo/PDF) não vão para o PostgreSQL. A tabela `MessageAttachment` guarda
`storageKey`, `fileName`, `mimeType`, `size` e `metadata`, pronta para MinIO/S3 (`STORAGE_*` no
`.env.example`). O download/upload e a rotina de expurgo ficam para fases seguintes.

## Testes

`test/unit/digest/digest-window.spec.ts` cobre janela/timezone; `test/integration/whatsapp.integration-spec.ts`
cobre instâncias, webhook (válido/inválido/duplicado/instância inexistente), bot (pergunta, handoff,
injeção, falha do provedor) e conversas/tickets; `test/integration/digest.integration-spec.ts` cobre
entrega, janela, isolamento de tenant, zero leads, falha+retry, validação e overview. Evolution e IA
são dublês nos testes; a integração real só é testada com ambiente configurado.

## Fora de escopo

Automações gerais, upload/expurgo de mídia, e-mail de digest, notificação individual por lead e
múltiplos canais além de WhatsApp.
