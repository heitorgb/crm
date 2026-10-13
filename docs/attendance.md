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
  dedupe por instância), `leadId?`, `customerId?`, `contactId?`, `status`, `subject?`, `isGroup`,
  `groupName?` (assunto do grupo), `avatarUrl?` (foto do grupo), `lastMessageAt?`, `closedAt?`.
- `Message`: `conversationId`, `direction`, `type`, `content?`, `externalMessageId?`
  (`UNIQUE (tenantId, externalMessageId)` = idempotência), `status`, `senderId?` (JID do
  participante em grupos **ou** `userId` do atendente em `OUTBOUND`), `senderName?` (pushName em
  grupos **ou** nome do atendente em `OUTBOUND`), `metadata` (guarda `remoteJid`, `viewOnce`,
  `showAgentName`, `contacts` e `quoted`), `occurredAt`.
- `WhatsAppAvatar`: cache de foto de perfil por instância/JID (`tenantId`, `whatsappInstanceId`,
  `jid`, `url?`, `fetchedAt`), `UNIQUE (whatsappInstanceId, jid)`.
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
- O webhook valida o token (`?token=` ou header `x-webhook-secret`) contra o
  `EVOLUTION_WEBHOOK_SECRET` global **ou** o `webhookSecret` da instância.
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
GET    /group/findGroupInfos/{instanceName}?groupJid={jid}
POST   /chat/fetchProfilePictureUrl/{instanceName}   body { number }
POST   /chat/findContacts/{instanceName}             agenda do número (importação de contatos)
```

`number` aceita tanto telefone (dígitos) quanto JID completo de grupo (`...@g.us`). O envio
humano para grupos usa o JID completo; para contatos, apenas os dígitos.

### Grupos

- Mensagens de grupo são identificadas por `remoteJid` terminando em `@g.us`. O grupo é
  armazenado na mesma `Conversation` (chave `externalContactId`), com `isGroup = true` e **sem**
  `Contact`.
- O remetente de cada mensagem é persistido em `senderId` (JID de `key.participant`) e
  `senderName` (pushName), permitindo exibir nome e foto por mensagem.
- Nome e foto do grupo: na primeira mensagem (`GET /group/findGroupInfos`) e via evento
  `GROUPS_UPSERT` (atualizações). A foto do grupo fica em `Conversation.avatarUrl`.
- Fotos de participantes são resolvidas sob demanda e cacheadas em `WhatsAppAvatar`
  (`POST /chat/fetchProfilePictureUrl`). A Evolution pode retornar `null` por privacidade; nesse
  caso a UI usa as iniciais.
- Conversas de grupo criadas antes desta funcionalidade não têm nome/foto no banco. Elas são
  atualizadas automaticamente no boot (`backfill` limitado, best-effort) e podem ser forçadas
  pela ação **Atualizar dados do grupo** (`POST /api/conversations/:id/refresh-group`).
- Instâncias existentes precisam de **Reconfigurar webhook** para receber `GROUPS_UPSERT`.

### Conectar um número (UI)

Em **Atendimento → WhatsApp** (`/atendimento/whatsapp`):

1. **Nova instância** (nome, `instanceName`, telefone, credenciais opcionais).
2. **Conectar** → o backend cria a instância na Evolution (`POST /instance/create`) ou, se já
   existir, usa `GET /instance/connect`; retorna o **QR code** (base64) e/ou o **código de
   pareamento**.
3. A tela exibe o QR, permite **gerar novo QR** e faz *poll* de status até **Conectado**.
4. O **webhook é configurado automaticamente** (eventos `MESSAGES_UPSERT`, `MESSAGES_UPDATE`,
   `GROUPS_UPSERT` e `PRESENCE_UPDATE`) com o token do segredo (da instância ou
   `EVOLUTION_WEBHOOK_SECRET`); há também a ação **Reconfigurar webhook**. No boot do backend o
   webhook é **reconciliado** para todas as instâncias conectadas/ativas, de modo que mudar
   `PUBLIC_API_URL` se autocorrige no próximo restart sem depender de reconfiguração manual.
5. Desconectar/excluir a instância permanecem disponíveis.

### Importação automática de contatos

Ao conectar um número, o backend importa a **agenda do WhatsApp** para `Contact`, sem cadastro
manual:

- gatilho automático na primeira transição da instância para `CONNECTED` (via polling de status da
  UI) e, no boot, para todas as instâncias já conectadas (reconciliação best-effort);
- a importação roda como job de fila (`whatsapp.contacts.sync`) carregando `tenantId` explícito;
- `POST /chat/findContacts/{instanceName}` retorna a agenda; apenas números individuais e discáveis
  são importados (grupos, `status@broadcast` e identificadores `@lid` são ignorados);
- a dedupe é por `(tenantId, phone)`. Contato novo recebe `name` (pushName) e `avatarUrl`; contato
  existente é preservado — o nome só é substituído quando ainda é o telefone (placeholder) e a foto
  só é preenchida quando vazia, nunca sobrescrevendo edição manual;
- falhas na Evolution são registradas e ignoradas, sem interromper a conexão.
- A foto fica em `Contact.avatarUrl` e aparece na lista e no detalhe de contatos (fallback: iniciais).
- Instâncias já conectadas antes desta funcionalidade são importadas no próximo boot, sem ação manual.

### Requisitos de configuração

- `PUBLIC_API_URL`: URL pública do backend usada para montar o webhook
  (`{PUBLIC_API_URL}/api/webhooks/evolution?token=...`). Em **dev local** a Evolution precisa
  alcançar o backend, então use um túnel (ngrok/cloudflared) apontando para `http://localhost:3000`
  e defina `PUBLIC_API_URL` com a URL do túnel. Sem ele, a configuração de webhook falha com
  `PUBLIC_API_URL_MISSING`.
- `EVOLUTION_WEBHOOK_SECRET` (ou o `webhookSecret` por instância) é o token validado no webhook.
- A URL retornada pela API nunca inclui o token (segredo não vaza para o frontend nem para logs).

## Tela de atendimento (UI)

`/atendimento/conversas` reproduz a experiência do WhatsApp Web usando os tokens e componentes do
CRM (sem dependências novas). A tela é **full-bleed**: `MainContent` deixa de aplicar
`max-width`/padding para essa rota, então ela ocupa 100% da largura e da altura da área de conteúdo
(sem card externo nem *page header*), com rolagem independente na lista e no histórico.

- **Lista (esquerda)**: busca, filtros por instância e status, avatar, prévia da última mensagem
  (com remetente em grupos e rótulo "Mídia" quando não há texto), horário relativo (Hoje/Ontem/data)
  e indicadores de status/grupo/instância. Estados de carregamento (skeleton), erro (com retry) e
  lista vazia (convite para conectar o WhatsApp).
- **Fixar conversas**: cada item expõe um menu de ações que **fixa** ou **desafixa** a conversa
  (exclusivo do CRM — nada é enviado à Evolution). O estado persiste em
  `Conversation.isPinned` (`POST /api/conversations/:id/pin` e `/unpin`, idempotentes e escopados
  por tenant) e é compartilhado entre os usuários da empresa via evento `conversation.updated`.
  Conversas fixadas aparecem **primeiro** na lista, com um ícone discreto; dentro de cada grupo a
  ordenação continua pela atividade mais recente (`lastMessageAt` desc, com nulos por último e
  `createdAt`/`id` como desempate).
- **Arquivar conversas**: cada item expõe a ação de **arquivar** (e **desarquivar** na listagem de
  arquivadas), exclusiva do CRM. O estado persiste em `Conversation.isArchived` (coluna
  `is_archived`, padrão `false`; migração `add_conversation_archived`), `POST
  /api/conversations/:id/archive` e `/unarchive`, idempotentes e escopados por tenant. A caixa de
  entrada (aba padrão) mostra apenas conversas **não arquivadas**; a aba **Arquivadas** consulta
  `GET /api/conversations?archived=true` (busca, filtros, paginação e fixação continuam valendo em
  cada listagem). Arquivar não exclui a conversa nem o histórico. Uma **nova mensagem recebida**
  remove automaticamente o estado de arquivamento (o webhook zera `isArchived` apenas quando a
  mensagem é de fato persistida, preservando a idempotência de eventos repetidos), devolvendo a
  conversa à caixa de entrada e emitindo `conversation.updated`. O tempo real usa o evento e a room
  existentes (`tenant:{tenantId}`).
- **Chat (centro)**: cabeçalho com avatar, nome, telefone/instância e menu de ações (encerrar/reabrir,
  atualizar grupo, ver contato). Histórico com papel de parede em padrão de *doodles* (estilo
  WhatsApp, `public/chat-doodle.svg`), separadores de dia (Hoje/Ontem)
  e balões assimétricos — enviados em verde da marca com *ticks* de status
  (`PENDING`/`SENT`/`DELIVERED`/`READ`/`FAILED`) e recebidos em card. Nome e foto por remetente em
  grupos. URLs no texto (e em legendas de mídia) são exibidas como links clicáveis que abrem em
  nova aba. Compositor com anexo (imagem/vídeo/áudio/PDF), texto autoexpansível, gravação de áudio e
  envio por `Enter`. Colar com **Ctrl+V** uma imagem/vídeo do clipboard (ex.: print de tela) abre a
  prévia de mídia — igual ao anexo — com campo de legenda e botões **Enviar**/**Cancelar** antes do
  envio (`MediaPreviewDialog`).
- **Nome do atendente**: o compositor traz a opção **Exibir nome do atendente** (marcada por padrão),
  alternável a cada mensagem e lembrada por navegador. Quando ligada, o nome do atendente é enviado
  ao cliente como prefixo em negrito (`*Nome:*` seguido de quebra de linha) no texto e nas legendas
  de mídia — o cliente vê quem respondeu quando vários atendentes usam o mesmo número. O
  comportamento é aplicado no servidor a partir do usuário autenticado (o nome nunca vem do cliente),
  inclusive no reenvio de mensagens com falha. No CRM, as mensagens enviadas mostram o nome do
  atendente no topo do balão e guardam `senderId`/`senderName` para rastreabilidade. O padrão é
  configurável em Configurações → Atendimento (ver [`settings.md`](./settings.md)).
- **Contatos compartilhados**: mensagens do tipo `CONTACT` (`contactMessage`/`contactsArrayMessage`)
  são renderizadas como cartão, no estilo do WhatsApp Web: avatar, nome e telefone, com as ações
  **Conversar** (resolve/cria o contato por telefone e inicia um atendimento 1:1 na mesma instância)
  e **Salvar contato** (`POST /api/contacts/resolve`, find-or-create idempotente por telefone). O
  webhook faz o parse do vCard (`FN`/`TEL`) e guarda `metadata.contacts = [{ name, phone }]`.
- **Respostas citadas (menções)**: mensagens que citam outra exibem, no topo do balão, um bloco com
  barra lateral colorida (cor por remetente, ou cor da marca quando a citada é nossa), o autor citado
  (**Você** quando foi enviada por nós) e um resumo com ícone do tipo de mídia (ex.: microfone para
  áudio), no estilo do WhatsApp Web. Ao passar o mouse sobre uma mensagem aparece o botão
  **Responder**; ao responder, o compositor mostra a prévia da citação (com botão de cancelar) e
  a mensagem é enviada com a referência à original (`quoted` na Evolution, no formato
  `{ key: { id, remoteJid, fromMe, participant }, message }`; em grupos o `participant` com o JID de
  quem escreveu a citada é obrigatório). O backend persiste o
  contexto em `Message.metadata.quoted` (`externalId`, `authorName`, `authorJid`, `fromMe`, `content`,
  `type` e `messageId` local quando resolvido): no inbound, lendo `contextInfo.quotedMessage` do
  webhook e enriquecendo com o histórico local para descobrir autor e direção; no outbound, a partir
  da mensagem referenciada (sempre escopada por tenant/conversa). No reenvio de falha a citação é
  reconstruída do metadata.
- **Painel de contato (direita)**: dados do contato/grupo, cliente, assunto e ações. Em telas menores
  vira um `Sheet`; no mobile a lista e o chat se alternam (botão voltar no cabeçalho do chat).
- **Tempo real**: eventos Socket.IO invalidam as queries; um aviso "Reconectando ao servidor…" é
  exibido quando o socket cai. `refetchInterval` segue como fallback.
- **Notificações**: mensagens recebidas (`message.created` com `direction = INBOUND`, publicado na
  sala `tenant:{tenantId}`) marcam a
  conversa como não lida. O título da aba mostra `(N) OrderUp CRM` com o total de conversas não
  lidas e um som curto é tocado; abrir a conversa em `/atendimento/conversas?conversation=…` zera o
  contador. As preferências (**Contador de não lidas na aba** e **Som de notificação**) ficam em
  Configurações → Notificações e são persistidas por navegador (`localStorage`). O socket é
  compartilhado por toda a aplicação via `RealtimeProvider`. O contador é do navegador: cobre
  mensagens recebidas com a aplicação aberta (não há marcação de lida no servidor).

Reabrir usa `POST /api/conversations/:id/takeover` (já existente).

### Iniciar atendimento a partir de um contato

O operador pode iniciar uma conversa sem esperar que o contato escreva primeiro, a partir da lista ou
do detalhe do contato (**Iniciar atendimento** → escolhe o WhatsApp de envio).

`POST /api/conversations/start` (autenticado) com `{ contactId, whatsappInstanceId }`:

- valida contato e instância **no tenant atual** (404 se não pertencerem);
- contato sem telefone → `CONTACT_PHONE_REQUIRED` (400);
- procura uma conversa existente daquele contato/instância (por `contactId` ou `externalContactId`
  em `phone`, `phone@s.whatsapp.net`, `phone@c.us`) e, se achar, reaproveita (reabre se estava
  `CLOSED` e vincula o `contactId` ausente);
- senão cria a conversa com `externalContactId = <phone>@s.whatsapp.net` (mesma chave do webhook, o
  que evita conversas duplicadas quando a resposta chegar) e `status = OPEN`;
- é idempotente (chamar de novo devolve a mesma conversa).

O frontend então abre `/atendimento/conversas?conversation=<id>`, onde o envio já funciona pelo
fluxo humano existente.

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
| POST   | `/api/conversations/start`                       | autenticado      |
| PATCH  | `/api/conversations/:id`                         | autenticado      |
| POST   | `/api/conversations/:id/takeover`                | autenticado      |
| POST   | `/api/conversations/:id/close`                   | autenticado      |
| POST   | `/api/conversations/:id/pin`                     | autenticado      |
| POST   | `/api/conversations/:id/unpin`                   | autenticado      |
| POST   | `/api/conversations/:id/archive`                 | autenticado      |
| POST   | `/api/conversations/:id/unarchive`               | autenticado      |
| POST   | `/api/conversations/:id/refresh-group`           | autenticado      |
| GET    | `/api/conversations/:id/messages`                | autenticado      |
| POST   | `/api/conversations/:id/messages`                | autenticado      |
| GET    | `/api/conversations/:id/participant-avatar`      | autenticado      |
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

`GET /api/conversations/:id/messages` é paginado das **mais recentes para as mais antigas**: a
`page=1` traz as últimas mensagens (retornadas em ordem cronológica crescente para renderização).

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

### Presença e apresentação do chat

- **Visualização única**: o webhook desembrulha `viewOnceMessage`/`viewOnceMessageV2`
  (`unwrapViewOnce`), registrando o tipo e a legenda internos e marcando `metadata.viewOnce`; o chat
  exibe o rótulo "Visualização única". Sem isso a mensagem cairia como `UNKNOWN`.
- **JIDs `@lid`**: conversas endereçadas por LID (`<lid>@lid`) são aceitas e o envio usa o JID
  completo (`deliveryDestination`), sem reduzi-lo a dígitos.
- O webhook é resiliente: qualquer erro inesperado ao processar um evento é registrado em log e a
  Evolution recebe `200` (`ignored: processing_error`), evitando *retry storm* que trava o
  processamento da instância.
- O webhook aceita `presence.update` da Evolution e publica `conversation.presence` somente na
  sala do tenant da instância, após localizar a conversa por tenant, instância e JID.
- Presença é transitória: não grava `WebhookEvent` nem passa pela deduplicação de mensagens.
  Assim, sequências repetidas de digitação continuam aparecendo. A interface mostra
  “digitando…”/“gravando áudio…” na lista e no cabeçalho, limpa ao desconectar e expira em 10 segundos.
- Instâncias novas assinam `PRESENCE_UPDATE`. Nas já conectadas, executar **Reconfigurar webhook**
  em Atendimento → WhatsApp para ativar esse evento. O indicador depende de a Evolution emitir
  a presença do contato.
- Fotos dos contatos são buscadas na lista e no cabeçalho pelo endpoint autenticado
  `participant-avatar`, reutilizando o cache de 6 horas e a validação de vínculo com a conversa.
  Se o WhatsApp não disponibilizar a foto, permanecem as iniciais.
- O chat ocupa a largura disponível e altura baseada na janela; o painel de detalhes começa
  recolhido. Os balões limitam a largura no contêiner externo e acomodam textos longos e mídias.
- Não há dependências ou migrations novas. Testes: `npm test` e
  `npm run test:e2e -- test/integration/whatsapp.integration-spec.ts` no backend com PostgreSQL e
  Redis configurados. Execução local: `npm run start:dev` no backend e `npm run dev` no frontend.

Referência do evento: [implementação da Evolution](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts).

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

### Status de entrega e leitura

- A Evolution envia recibos pelo evento `messages.update` (status `SERVER_ACK`, `DELIVERY_ACK`,
  `READ`, `PLAYED`, `PENDING`, `ERROR`). O webhook mapeia: `SERVER_ACK` → `SENT`,
  `DELIVERY_ACK` → `DELIVERED`, `READ`/`PLAYED` → `READ`, `ERROR` → `FAILED`.
- O recibo é casado pelo `externalMessageId` da mensagem **dentro do tenant** e apenas mensagens
  `OUTBOUND` são atualizadas. A progressão é monotônica: um recibo atrasado nunca regride um status
  já avançado (ex.: `READ` não volta para `DELIVERED`).
- Ao mudar, o backend emite `message.updated` na room da conversa e `conversation.updated` no
  tenant, e o frontend invalida as queries exibindo o segundo *check* (entregue) ou azul (lido).
- Instâncias novas assinam `MESSAGES_UPDATE`; nas já conectadas o evento entra pela
  reconciliação de webhook no boot (ou por **Reconfigurar webhook**). O *tick* só avança se a
  Evolution emitir o recibo — se o destinatário tiver desativado confirmações de leitura, o azul
  pode nunca aparecer.

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
