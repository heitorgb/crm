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
  O número de instâncias por organização é limitado por `Tenant.whatsappInstanceLimit`
  (default `3`, configurável pelo admin da plataforma; `0` bloqueia novas instâncias).
- `Conversation`: `tenantId`, `whatsappInstanceId`, `externalContactId?` (JID/número, chave de
  dedupe por instância), `leadId?`, `customerId?`, `contactId?`, `status`, `subject?`, `isGroup`,
  `groupName?` (assunto do grupo), `avatarUrl?` (foto do grupo), `lastMessageAt?`, `closedAt?`.
- `ConversationTag`: vínculo N:N entre conversa e o catálogo compartilhado de etiquetas, sempre
  validado no tenant atual.
- `Message`: `conversationId`, `direction`, `type`, `content?`, `externalMessageId?`
  (`UNIQUE (tenantId, externalMessageId)` = idempotência), `status`, `senderId?` (JID do
  participante em grupos **ou** `userId` do atendente em `OUTBOUND`), `senderName?` (pushName em
  grupos **ou** nome do atendente em `OUTBOUND`), `metadata` (guarda `remoteJid`, `viewOnce`,
  `showAgentName`, `contacts` e `quoted`), `occurredAt`.
- `MessageReaction`: reação a uma mensagem (`tenantId`, `conversationId`, `targetExternalId`,
  `targetFromMe`, `reactorId`, `reactorName?`, `fromMe`, `emoji`, `occurredAt`), com
  `UNIQUE (tenantId, conversationId, targetExternalId, reactorId)` = idempotência por autor/alvo.
  Reações **não** são `Message`: não entram no histórico, no contador de não lidas nem no preview da
  conversa. O alvo é referenciado pelo id externo do WhatsApp, então uma reação que chega antes da
  mensagem original fica pendente e aparece quando a mensagem for sincronizada.
- `WhatsAppAvatar`: cache de foto de perfil por instância/JID (`tenantId`, `whatsappInstanceId`,
  `jid`, `url?`, `fetchedAt`), `UNIQUE (whatsappInstanceId, jid)`.
- `MessageAttachment`: **metadados** de mídia (`storageKey`, `fileName`, `mimeType`, `size`,
  `metadata`). Nenhum binário é gravado no PostgreSQL.
- `Ticket`: `subject`, `status`, `priority`, `assigneeId?`, `conversationId?`, `leadId?`,
  `customerId?`.
- `LeadDigestPreference` (1 por membership) e `LeadDigestDelivery` (`UNIQUE (tenantUserId,
  periodStart)` = idempotência).
- `LinkPreview`: cache **por tenant** de metadados de link (`tenantId`, `url`, `urlKey`,
  `status` OK/EMPTY/FAILED, `title?`, `description?`, `imageUrl?`, `siteName?`, `domain?`,
  `fetchedAt`, `expiresAt`), `UNIQUE (tenantId, urlKey)`. O `urlKey` é o SHA-256 da URL
  normalizada; o cache evita buscar a mesma página repetidamente e também registra falhas.
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
- A criação valida `Tenant.whatsappInstanceLimit` no backend, em transação com lock da linha do
  tenant. Instâncias desconectadas também ocupam vaga; excluir libera a vaga. Limite reduzido abaixo
  do uso atual não remove instâncias, apenas bloqueia novos cadastros
  (`WHATSAPP_INSTANCE_LIMIT_REACHED`, 409). A UI consulta `GET /api/whatsapp/instances/quota` antes
  de abrir o formulário e mostra um aviso amigável quando não há vagas.
- A resolução de metadados de link roda no backend com proteção contra SSRF: somente HTTP/HTTPS,
  portas 80/443, bloqueio de loopback/redes privadas/link-local/metadata de nuvem e validação de
  cada redirecionamento (DNS fixado no IP validado, no máximo 3 redirects). Há limite de tempo,
  tamanho da resposta, quantidade de URLs por mensagem e *rate limit* por IP. O HTML externo nunca é
  renderizado: apenas `og:*`/`twitter:*`/`title` são extraídos, sanitizados e devolvidos como texto.
- Logs não incluem conteúdo sensível nem credenciais.

## Evolution API

Serviço centralizado em `WhatsAppModule` (`EvolutionClient`), configurado por
`EVOLUTION_API_BASE_URL` + `EVOLUTION_API_KEY` (header `apikey`). Endpoints usados (v2):

```text
POST   /instance/create                   body { instanceName, qrcode, integration }
GET    /instance/connect/{instanceName}
GET    /instance/fetchInstances           lista instâncias persistidas (checagem de existência)
DELETE /instance/logout/{instanceName}
DELETE /instance/delete/{instanceName}
GET    /instance/connectionState/{instanceName}
POST   /message/sendText/{instanceName}   body { number, text, linkPreview? }
POST   /webhook/set/{instanceName}        body { webhook: { enabled, url, events, base64 } }
GET    /group/findGroupInfos/{instanceName}?groupJid={jid}
GET    /group/fetchAllGroups/{instanceName}?getParticipants=false
GET    /group/participants/{instanceName}?groupJid={jid}
POST   /chat/fetchProfilePictureUrl/{instanceName}   body { number }
POST   /chat/findContacts/{instanceName}             agenda do número (importação de contatos)
POST   /chat/findChats/{instanceName}                conversas persistidas na Evolution
POST   /chat/findMessages/{instanceName}             histórico paginado por período
```

`number` aceita tanto telefone (dígitos) quanto JID completo de grupo (`...@g.us`). O envio
humano para grupos usa o JID completo; para contatos, apenas os dígitos.

### Grupos

- Mensagens de grupo são identificadas por `remoteJid` terminando em `@g.us`. O grupo é
  armazenado na mesma `Conversation` (chave `externalContactId`), com `isGroup = true` e **sem**
  `Contact`.
- O remetente de cada mensagem é persistido em `senderId` (JID de `key.participant`) e
  `senderName` (pushName), permitindo exibir nome e foto por mensagem.
- Nome e foto do grupo: na primeira mensagem (`GET /group/findGroupInfos`) e via eventos
  `GROUPS_UPSERT`/`GROUP_UPDATE` (quando emitidos). A foto do grupo fica em `Conversation.avatarUrl`.
- Participantes: `GROUPS_UPSERT` (snapshot completo) e `GROUP_PARTICIPANTS_UPDATE`
  (`add`/`remove`/`promote`/`demote`) alimentam `ConversationParticipant` de forma idempotente
  (`UNIQUE (conversationId, jid)`), incluindo o LID alternativo quando a Evolution o envia
  (`jid` mantém o endereço preferido e `lid` guarda o outro identificador). Saídas são marcadas
  `active = false`/`leftAt`, sem apagar a
  linha nem as mensagens; reentradas reativam a mesma linha. Nenhum contato é criado
  automaticamente para participantes.
- Fotos de participantes são resolvidas sob demanda e cacheadas em `WhatsAppAvatar`
  (`POST /chat/fetchProfilePictureUrl`). A Evolution pode retornar `null` por privacidade; nesse
  caso a UI usa as iniciais.
- Limitação confirmada na Evolution `2.4.0-rc2`: o evento interno `groups.update` é emitido, mas o
  schema de webhook só aceita `GROUP_UPDATE`, cuja comparação não casa com `GROUPS_UPDATE`.
  Por isso mudanças de assunto podem não chegar por evento; o botão **Atualizar dados do grupo**
  continua sendo o caminho determinístico para reconciliar nome/foto e, via
  `GET /group/participants`, a lista de participantes (falha dessa consulta não bloqueia
  nome/foto).
- Conversas de grupo criadas antes desta funcionalidade não têm nome/foto no banco. Elas são
  atualizadas automaticamente no boot (`backfill` limitado, best-effort) e podem ser forçadas
  pela ação **Atualizar dados do grupo** (`POST /api/conversations/:id/refresh-group`).
- Instâncias existentes precisam de **Reconfigurar webhook** (ou de um restart do backend, que reconcilia os webhooks) para receber eventos adicionados posteriormente, como `GROUPS_UPSERT` e `MESSAGES_SET`.

### Conectar um número (UI)

Em **Configurações → WhatsApp** (`/configuracoes?tab=whatsapp`):

1. **Nova instância** (nome, `instanceName`, telefone, credenciais opcionais).
2. **Conectar** → o backend consulta `GET /instance/fetchInstances` e o estado atual.
   - Se a instância **não existe**, cria com `POST /instance/create`.
   - Se **já existe e está `open`**, reutiliza: grava `CONNECTED` e não gera QR nem recria.
   - Se **já existe e está `close`/`connecting`**, reutiliza via `GET /instance/connect` e devolve
     o QR/ticket atual. Não há remoção nem recriação.
   - Só recria (`DELETE /instance/delete` + `POST /instance/create`) quando a tentativa de reuso
     não devolve ticket utilizável (sessão em memória quebrada ou resposta de erro).
   - O CRM só grava `CONNECTING` quando recebe um **ticket válido** (QR base64, pairing code ou
     código). Respostas `{ error: true }` da Evolution são tratadas como falha.
3. A tela exibe o QR, permite **gerar novo QR** e faz *poll* de status até **Conectado**.
4. O **webhook é configurado automaticamente** (eventos `MESSAGES_UPSERT`, `MESSAGES_UPDATE`,
   `MESSAGES_EDITED`, `CONTACTS_UPSERT`, `CONTACTS_UPDATE`, `CHATS_SET`, `CHATS_UPSERT`,
   `CHATS_UPDATE`, `GROUPS_UPSERT`, `GROUP_UPDATE`, `GROUP_PARTICIPANTS_UPDATE`,
   `PRESENCE_UPDATE` e `CONNECTION_UPDATE`; `MESSAGES_SET` e `MESSAGING_HISTORY_SET` somente quando
   a importação automática de histórico está habilitada) com o token do segredo (da instância ou
   `EVOLUTION_WEBHOOK_SECRET`); há também a ação **Reconfigurar webhook**.
   No boot do backend o webhook é **reconciliado** para todas as instâncias conectadas/ativas, de
   modo que mudar `PUBLIC_API_URL` se autocorrige no próximo restart sem depender de reconfiguração
   manual.
5. **Desconectar** usa `DELETE /instance/logout` e só grava `DISCONNECTED` após
   `GET /instance/connectionState` confirmar `close`/`disconnected` (com algumas tentativas
   curtas para absorver a latência do provedor). Se o logout responder erro/timeout mas o estado
   confirmar `close`, a desconexão é considerada concluída; se o estado não confirmar, a API
   responde erro e o CRM **não** declara sucesso. Cada chamada HTTP à Evolution tem timeout
   (`EVOLUTION_REQUEST_TIMEOUT_MS`, padrão 20 s). Eventos `connection.update` atrasados de uma
   sessão anterior não reativam uma instância explicitamente desconectada.
6. **Excluir** remove a instância na Evolution com `DELETE /instance/delete` antes de apagar a
   linha local; falhas de rede mantêm a linha local para permitir nova tentativa.

### Histórico e recuperação de mensagens

- Por padrão, a importação automática de `MESSAGES_SET` fica **desligada**
  (`WHATSAPP_HISTORY_IMPORT_ENABLED=false`). O CRM recebe mensagens novas por `MESSAGES_UPSERT` e
  recupera lacunas pelo backfill. Isso evita a "chuva" de histórico a cada reconexão.
- Se habilitada (`WHATSAPP_HISTORY_IMPORT_ENABLED=true`), o `MESSAGES_SET` é assinado e processado
  com o mesmo pipeline de `MESSAGES_UPSERT`, importando apenas mensagens dentro de
  `WHATSAPP_HISTORY_IMPORT_DAYS` (padrão 30 dias). Mensagens mais antigas são ignoradas.
- O CRM persiste o estado da sincronização em `WhatsAppInstance` (`history_sync_status`,
  `history_sync_progress`, `history_sync_started_at`, `history_sync_completed_at`,
  `history_sync_error`) e o expõe em `GET /api/whatsapp/instances[/:id]` como `historySync`.
  Os estados são `IDLE`, `SYNCING`, `COMPLETED` e `FAILED`.
- `progress` é copiado apenas quando a Evolution o envia (0–100). `isLatest` **não** significa
  conclusão (é apenas um indicador de lote do Baileys) e nunca é usado para declarar o histórico
  completo. A conclusão vem de `progress === 100` no `MESSAGES_SET` ou do
  evento `MESSAGING_HISTORY_SET` (`progress: 100`), ambos confirmados na Evolution 2.4.0.
- Se um lote tiver mensagens que falharam, o estado fica `FAILED` e o webhook responde `5xx` para a
  Evolution reenviar o lote. Mensagens já importadas são ignoradas por idempotência no retry.
  Reconexão/queda de conexão durante um sync também marca `FAILED`. O frontend só mostra
  “Histórico sincronizado” quando o estado persistido é `COMPLETED`.
- O progresso é publicado em tempo real por `whatsapp.history.updated` na sala do tenant.
- A ingestão é deduplicada por `(tenantId, externalMessageId)` e pelo contexto da instância.
  Webhook e backfill podem rodar simultaneamente sem duplicar mensagens.
- Mensagens recentes recuperadas do histórico emitem eventos realtime; mensagens antigas são
  persistidas silenciosamente e emitem apenas `conversation.updated`. A importação histórica não
  move `Conversation.lastMessageAt` para trás.
- Mídia e transcrição automática são processadas apenas para mensagens recentes do histórico, para
  não enfileirar milhares de downloads/transcrições antigas.
- Mensagens individuais e de grupos usam o mesmo fluxo; grupos mantêm `isGroup`, participante e
  nome do remetente.
- **Backfill manual:** `POST /api/whatsapp/instances/:id/backfill` (OWNER/ADMIN), body opcional
  `{ "days": 30, "maxMessages": 1000 }`. A rotina consulta `POST /chat/findMessages` paginado,
  importa o que falta e retorna `{ scanned, imported, skipped, failed, pages }`.
- Logs: `whatsapp.history.batch`, `whatsapp.history.import`, `whatsapp.history.backfill`,
  `whatsapp.message.persisted` e `whatsapp.history.message.failed` (sem conteúdo sensível).
- Instâncias existentes recebem `MESSAGES_SET` na reconciliação de webhook do boot ou pela ação
  **Reconfigurar webhook**.

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
- **Atualização incremental:** `CONTACTS_UPSERT`/`CONTACTS_UPDATE` (v2.4.0) atualizam o contato por
  `(tenantId, phone)` sem recriar. Nome só substitui placeholder (telefone/vazio); foto só substitui
  vazio ou uma URL anterior do WhatsApp (`pps.whatsapp.net`) — avatar manual é preservado. Eventos
  sem foto mantêm a anterior. Grupos, `status@broadcast`, bots, newsletters e identificadores
  `@lid` sem telefone convencional não viram `Contact`; o JID original permanece na conversa.
- Mudanças de contato publicam `contact.updated` (e `conversation.updated` para cada conversa
  vinculada), sem invalidar mensagens/mídias.

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
- **Layout mobile**: abaixo de `lg`, o cabeçalho do atendimento mostra o avatar do usuário à
  esquerda e, à direita, os botões de câmera e menu. O título "Conversas"/contador e os filtros de
  instância/status saem da tela inicial; a busca fica logo abaixo do cabeçalho e as abas logo abaixo
  da busca. Tema e filtros ficam dentro do menu hambúrguer (com a navegação), continuam valendo após
  fechar o menu e são compartilhados pela store `attendance-view-store`. No desktop o layout e os
  filtros permanecem como antes.
- **Foto pela câmera**: o botão de câmera abre um `<input type="file" accept="image/*"
  capture="environment">` (com fallback para a galeria). A imagem é comprimida no navegador (até
  1600 px, JPEG) e o backend revalida/otimiza com `sharp`. Depois da prévia com legenda, o operador
  seleciona uma ou mais conversas (busca, checkbox e contador) e dispara um batch assíncrono
  (`POST /api/conversations/bulk-media`). O processamento usa a fila
  (`bulk-media.send`), envia com intervalo (`BULK_MEDIA_INTERVAL_MS`, padrão 1,5 s) e registra
  status por destinatário; a tela acompanha por polling, permite reenviar falhas e usa
  `idempotencyKey` para evitar duplicidade. Detalhes em [`media.md`](./media.md).
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
- **Excluir conversas**: cada item expõe a ação **Excluir conversa** (em vermelho, separada de
  fixar/arquivar) que abre um diálogo de confirmação informando que a conversa sai da listagem do
  CRM. A exclusão é **lógica**: grava `Conversation.deletedAt` (coluna `deleted_at`; migração
  `add_conversation_deleted`) e a conversa (com mensagens e anexos) é filtrada de todas as
  listagens — caixa de entrada, arquivadas, detalhe e contador de não lidas. Nada é excluído no
  WhatsApp e o histórico é preservado. A operação é escopada por tenant (um usuário nunca exclui
  conversa de outra empresa) e publica `conversation.deleted` na sala `tenant:{tenantId}`; a
  interface remove a conversa da lista e, se ela estiver aberta, limpa a seleção. Diferente do
  arquivamento, a exclusão **não é revertida** por eventos de atualização nem por novas mensagens
  recebidas; ela só é restaurada quando o operador **inicia um atendimento** com o mesmo contato
  (`POST /api/conversations/start`, que reabre e limpa `deletedAt`). Arquivar, desarquivar, fixar,
  marcar como lida, encerrar e reabrir continuam funcionando de forma independente.
- **Chat (centro)**: cabeçalho com avatar, nome, telefone/instância e menu de ações (encerrar/reabrir,
  atualizar grupo, ver contato). Histórico com papel de parede em padrão de *doodles* (estilo
  WhatsApp, `public/chat-doodle.svg`) com baixo contraste — o *doodle* é atenuado por uma camada do
  `background` do tema atual, funcionando nos temas claro e escuro sem preto absoluto —, separadores
  de dia (Hoje/Ontem) e balões assimétricos — enviados em verde da marca com *ticks* de status
  (`PENDING`/`SENT`/`DELIVERED`/`READ`/`FAILED`) e recebidos em card. Mensagens consecutivas do mesmo
  participante (mesma direção, mesma identidade de remetente, mesmo dia e intervalo curto) são
  agrupadas com espaçamento reduzido, exibindo nome e foto apenas no primeiro balão do grupo. A
  identidade em grupos usa `senderId` e, como fallback, `senderName`; mensagens sem identificação
  não são agrupadas entre si, evitando confundir remetentes diferentes. Reações são exibidas como
  selos sobre o balão da mensagem original (e não como balões próprios); a rolagem é automática somente quando o
  usuário está no fim do histórico, e um botão flutuante ("Ir para as últimas mensagens") aparece ao
  navegar por mensagens antigas. Ao abrir ou trocar de conversa (individual ou grupo), o histórico
  carregado é posicionado no fim mesmo depois da renderização de mídias e pré-visualizações; ao
  carregar páginas antigas, a posição visual do usuário é preservada. URLs no texto (e em legendas
  de mídia) são exibidas como links clicáveis que abrem em nova aba. Quando a mensagem contém uma
  URL, o chat exibe também um
  **cartão de pré-visualização** no estilo do WhatsApp Web (imagem, título, descrição e domínio),
  integrado à bolha enviada ou recebida. Previews entregues pela Evolution/WhatsApp em
  `extendedTextMessage` (incluindo `contextInfo.externalAdReply`) são lidos pelo webhook e guardados
  em `Message.metadata.linkPreview` (título, descrição, thumbnail e URL canônica); mensagens antigas
  ou sem esses dados consultam `POST /api/link-previews/resolve` de forma assíncrona (skeleton
  enquanto carrega, sem bloquear o histórico). A URL original permanece clicável, o cartão não é
  renderizado quando não há metadados úteis e textos longos quebram dentro da bolha. O compositor
  também mostra, acima do campo de texto, o **preview da primeira URL do rascunho** (obtido no
  backend por `POST /api/link-previews/resolve` e cacheado por tenant), com botão para removê-lo
  antes do envio; a remoção não altera o texto. Ao enviar, o backend resolve os metadados da URL
  (quando o preview está habilitado), persiste-os em `metadata.linkPreview` e pede à Evolution
  `linkPreview: true`; se o operador removeu o cartão, envia `linkPreview: false` para suprimir o
  preview. Na versão instalada (Evolution 2.4.0) o único recurso oficial de preview em
  `/message/sendText` é esse booleano — a Evolution gera o cartão `externalAdReply`; não há
  parâmetros para enviar título/descrição/imagem explícitos. Por isso o preview no WhatsApp do
  destinatário continua dependendo da geração da Evolution/WhatsApp.
- **Configuração global de preview**: o administrador da plataforma controla em
  Administração → Configurações da plataforma se os envios podem gerar preview. O padrão é
  **desativado**. Com a opção desativada, o backend não resolve metadados e envia todo texto com
  `linkPreview: false` para a Evolution, independentemente do fluxo (manual, lembretes, mensagens
  agendadas, webhooks) e da organização. Com a opção ativada, o comportamento por mensagem descrito
  acima volta a valer. A leitura é feita no banco a cada envio, então a mudança vale imediatamente,
  sem reiniciar o CRM (ver [`settings.md`](./settings.md)).
- **Compositor com anexo** (imagem/vídeo/áudio/PDF), texto autoexpansível, gravação de áudio e envio
  por `Enter`, com anexo/emoji/campo/gravação integrados em um único campo arredondado. Colar com
  **Ctrl+V** uma imagem/vídeo do clipboard (ex.: print de tela) abre a prévia de mídia — igual ao
  anexo — com campo de legenda e botões **Enviar**/**Cancelar** antes do envio
  (`MediaPreviewDialog`).
- **Respostas rápidas no compositor**: digitar `/` abre a lista de respostas rápidas cadastradas; o
  texto após a barra filtra por título ou conteúdo. Clique ou `Enter` insere a resposta no campo,
  `↑`/`↓` navegam e `Esc` fecha. Ver [`quick-replies.md`](./quick-replies.md).
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
- **Reações**: eventos `messages.upsert` com `data.message.reactionMessage` são desviados do fluxo
  de mensagens e gravados em `MessageReaction`, associados ao `targetExternalId` da mensagem
  original. O autor é o remetente do evento (`key.participant`, com o telefone em
  `key.participantAlt` quando o JID é `@lid`) e o `pushName` vira `reactorName`; reações feitas no
  próprio dispositivo conectado (`key.fromMe = true`) usam `reactorId = self` e aparecem como
  **Você**. O mesmo autor/alvo faz upsert do emoji, e um `text` vazio remove a reação. Reações não
  criam `Message`, não movem `lastMessageAt`, não alteram não lidas/arquivamento e são publicadas no
  evento realtime `message.reaction`, que atualiza apenas o cache de mensagens da conversa. O chat
  mostra um selo compacto com o emoji (e a quantidade, quando mais de uma pessoa usa o mesmo emoji)
  no balão original.
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
- **Mensagens enviadas pelo celular / WhatsApp Web**: o webhook trata `messages.upsert` com
  `key.fromMe = true` como mensagem `OUTBOUND` enviada pela própria conta conectada, exibindo-a na
  conversa ao lado das mensagens enviadas pelo CRM. A instância, o contato e a conversa são
  resolvidos pelo `remoteJid` (com fallback de telefone em `participantAlt`/`remoteJidAlt` e suporte a
  `@lid`, sem inventar contato quando não há telefone). A mensagem é deduplicada por
  `(tenantId, externalMessageId)`: um evento do provedor para uma mensagem **já salva pelo envio do
  CRM** é reconciliado no registro existente (`metadata` enriquecido), sem criar duplicata nem emitir
  novo `message.created`; eventos repetidos são idempotentes. Mensagens externas de mídia também são
  baixadas (`getBase64FromMediaMessage` com `fromMe` correspondente) e anexadas. Mensagens `OUTBOUND`
  não alteram contadores de não lidas nem o estado de leitura.
- **Mensagens de cobrança**: os lembretes enviados pelo módulo Financeiro → Cobranças (manuais e
  automáticos) também aparecem na conversa, como mensagens enviadas (OUTBOUND, alinhadas à direita),
  com o conteúdo real, quebras de linha e o horário da confirmação do envio. A conversa é
  resolvida/criada pelo telefone e pela instância usados no disparo; a lista de conversas e o painel
  aberto se atualizam em tempo real (`message.created`/`conversation.updated`). A dedupe usa o
  `externalMessageId` da Evolution, então um webhook posterior do mesmo envio é reconciliado sem
  duplicar a bolha. Detalhes em [`billing.md`](./billing.md).
- **Painel de contato (direita)**: dados do contato/grupo, cliente, assunto e ações. Em telas menores
  vira um `Sheet`; no mobile a lista e o chat se alternam (botão voltar no cabeçalho do chat).
- **Tempo real**: os eventos Socket.IO são aplicados de forma direcionada pelo `conversationId`
  do payload. `message.created`/`message.updated` sempre atualizam a lista de conversas, mas só
  invalidam a conversa e as mensagens quando pertencem à conversa aberta. `conversation.updated`
  atualiza a lista e, na conversa ativa, invalida as mensagens apenas quando o evento traz
  `messageId` (processamento de mídia, transcrição e erros de mídia). `connect` ressincroniza
  lista, contador de não lidas, conversa e mensagens ativas. Um aviso "Reconectando ao servidor…"
  é exibido quando o socket cai. `refetchInterval` segue como fallback.
- **Cache de anexos**: blobs de áudio, vídeo, imagem e documentos usam o namespace próprio
  `['attendance-attachment', ...]`, fora de `['attendance']`. Invalidar a lista, conversas ou
  mensagens não refaz o download de anexos já carregados, então as URLs `blob:` permanecem
  estáveis e a reprodução de áudio/vídeo não é reiniciada por eventos de outras conversas.
- **Não lidas (persistido no servidor)**: o estado de leitura é **compartilhado entre os
  atendentes autorizados do mesmo tenant** e persistido em `Conversation.lastReadAt` (coluna
  `last_read_at`; migração `add_conversation_last_read`, com *backfill* para `last_message_at`/
  `created_at`, de modo que o histórico existente nunca reaparece como não lido). O contador de
  não lidas de cada conversa é **calculado** como o total de mensagens `INBOUND` com
  `occurred_at > last_read_at` (ou todas as `INBOUND`, quando o marcador é nulo) — não há contador
  denormalizado. Mensagens `OUTBOUND` nunca entram na contagem. Abrir a conversa
  (`/atendimento/conversas?conversation=…`) chama `POST /api/conversations/:id/read`, que avança o
  marcador até a última mensagem recebida já persistida (idempotente e escopado por tenant); uma
  mensagem recebida durante/depois da marcação permanece não lida. O total do tenant para o título
  da aba vem de `GET /api/conversations/unread-count` (soma das mensagens não lidas das conversas
  não arquivadas). A atualização propaga por `message.created`/`conversation.updated` na sala
  `tenant:{tenantId}`, então a leitura de um atendente aparece para os demais. O frontend usa o
  servidor como fonte de verdade e o `refetchInterval` como fallback.
- **Notificações**: mensagens recebidas (`message.created` com `direction = INBOUND`, publicado na
  sala `tenant:{tenantId}`) atualizam o contador do servidor e disparam um som curto (quando
  habilitado). O título da aba mostra `(N) OrderUp CRM` com o total de **mensagens** não lidas do
  tenant. As preferências (**Contador de não lidas na aba** e **Som de notificação**) ficam em
  Configurações → Notificações e são persistidas por navegador (`localStorage`); o contador em si
  **não** é mais local (dados antigos de `unreadCounts` são descartados na migração do store). O
  socket é compartilhado por toda a aplicação via `RealtimeProvider`.

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
| GET    | `/api/whatsapp/instances/quota`                  | autenticado      |
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
| GET    | `/api/conversations/unread-count`                | autenticado      |
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
| DELETE | `/api/conversations/:id`                         | autenticado      |
| POST   | `/api/conversations/:id/read`                    | autenticado      |
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

- **Visualização única**: o webhook desembrulha os envelopes `viewOnceMessage`/
  `viewOnceMessageV2`/`viewOnceMessageV2Extension` (`unwrapViewOnce`, recursivo, cobrindo também
  `ephemeralMessage`/`deviceSentMessage`/`documentWithCaptionMessage`) e ainda usa
  `data.messageType` da Evolution como pista, marcando `metadata.viewOnce = true` mesmo quando o
  conteúdo vem omitido. O tipo interno (imagem/vídeo) e a legenda são preservados, mas a mídia
  **não é baixada nem exibida** (o job `media.process` é ignorado para view-once) e a mensagem nunca
  aparece como `[unknown]`: o chat renderiza um bloco no estilo WhatsApp Web com ícone, texto em
  itálico ("Você recebeu uma mensagem de visualização única…"), link "Saiba mais" e horário,
  respeitando avatar/nome e o agrupamento existente. Sem esse tratamento a mensagem cairia como
  `UNKNOWN`.
- **JIDs `@lid` e contas migradas para LID**: parte das contas foi migrada pelo WhatsApp para
  endereçamento por **LID**. Qual endereço uma conta aceita para **envio** (PN ou LID) **varia por
  conta** e não pode ser inferido do `addressingMode` do inbound: há contas em que o envio ao PN é
  aceito e falha depois (`messages.update ERROR`, issue EvolutionAPI #2629) e contas em que o envio
  ao LID é que falha. Por isso o CRM mantém **os dois endereços** da conversa — o endereço do
  inbound em `externalContactId` e o LID capturado de
  `remoteJid`/`remoteJidAlt`/`participantAlt` em `Conversation.externalLid` — e o destino é
  **adaptativo** (`pickDestination`): por padrão envia ao LID (fallback aos dígitos do PN); se o
  provedor devolver `messages.update ERROR`, o webhook **reenvia a mesma mensagem uma vez para o
  endereço alternativo** (`alternateDestination`) e grava o endereço que funcionou em
  `Conversation.preferredAddress`, usado nos envios seguintes. A mensagem guarda
  `metadata.destinationType` e `metadata.fallbackAttempted`, que garante no máximo **um** fallback
  por mensagem (sem loops). O LID é capturado no mesmo evento em que o contato/telefone é resolvido,
  então um novo inbound popula conversas já existentes.
- O webhook usa `webhook_events` como caixa de entrada durável: o evento é reivindicado antes do
  processamento e só recebe `processedAt` após o sucesso. Eventos já processados são idempotentes;
  eventos reivindicados e não concluídos são reprocessados. Em falha de banco/processamento a API
  responde `503` (em vez de `200`), a Evolution reenvia e uma cópia é enfileirada em
  `webhook.evolution.process`; no boot, eventos pendentes das últimas 24 h são reenfileirados.
  Assim uma falha temporária não descarta silenciosamente a mensagem.
- `messages.update` só altera mensagens `OUTBOUND` da **mesma instância e tenant**, e a progressão
  de status é monotônica (`SENT → DELIVERED → READ`); `ERROR` não regride `DELIVERED`/`READ`.
- O webhook aceita `presence.update` da Evolution e publica `conversation.presence` somente na
  sala do tenant da instância, após localizar a conversa por tenant, instância e JID. O payload
  inclui `state` normalizado (`online`, `offline`, `composing`, `recording`), `participantName`/
  `participantPhone` (participantes de grupo vêm de `ConversationParticipant`), `lastSeenAt`,
  `occurredAt` (ordenação) e `receivedAt` (base do TTL no cliente).
- O identificador de presença de grupo pode chegar como `@lid` ou `@s.whatsapp.net`, às vezes com
  sufixo de dispositivo (`:NN`). A resolução remove o sufixo e procura o participante pelo JID
  principal, pelo LID alternativo (`ConversationParticipant.lid`) e pelo telefone normalizado,
  nessa ordem, sempre dentro da conversa/tenant/instância. O nome prioriza o contato CRM associado
  ao telefone (quando não é apenas o telefone), depois o nome sincronizado do participante e, por
  fim, o `senderName` da mensagem mais recente daquele remetente na conversa. Sem correspondência
  exata, o payload mantém `participantName`/`participantPhone` nulos e a UI mostra apenas
  “digitando…”/“gravando áudio…”, nunca o JID técnico.
- O diretório de participantes é mantido em memória por 30 s (chave tenant + instância + conversa)
  e os nomes de remetente por 15 s, limitado a 500 conversas. O cache é descartado ao receber
  `groups.upsert`, `groups.update` ou `group-participants.update`. Assim uma sequência de eventos
  de digitação/gravação não consulta o banco a cada evento, sem reutilizar identidade entre tenants
  ou instâncias.
- Presença é transitória: não grava `WebhookEvent`, não cria mensagem/conversa e não passa pela
  deduplicação de mensagens. A UI mantém o estado apenas em memória, por conversa.
- No cabeçalho, o indicador mostra `Online`, `Visto por último …` (somente com `lastSeen` válido e
  não futuro), `Offline` apenas após `unavailable`, ou `Status indisponível` quando não há evento
  confiável. A ausência de eventos **não** é tratada como offline.
- `composing`/`recording` expiram em 12 s na UI caso o evento de encerramento não chegue; `online`
  expira em 2 min para não apresentar estado antigo como atual. `offline`/última visualização
  permanecem até um evento mais novo. Eventos fora de ordem são descartados por `occurredAt`.
- Atividade de um participante não é encerrada por evento `available` de outro participante do
  grupo. O indicador fica isolado no componente do cabeçalho, sem invalidar queries nem remontar
  mensagens/players de áudio e vídeo.
- Instâncias novas assinam `PRESENCE_UPDATE`. Nas já conectadas, executar **Reconfigurar webhook**
  em Atendimento → WhatsApp para ativar esse evento. O indicador depende de a Evolution emitir
  a presença do contato; a v2.4.0 não expõe um endpoint de “apenas assinar presença”, então alguns
  contatos podem permanecer como `Status indisponível`.
- Fotos dos contatos são buscadas na lista e no cabeçalho pelo endpoint autenticado
  `participant-avatar`, reutilizando o cache de 6 horas e a validação de vínculo com a conversa.
  Se o WhatsApp não disponibilizar a foto, permanecem as iniciais.
- O chat ocupa a largura disponível e altura baseada na janela; o painel de detalhes começa
  recolhido. Os balões limitam a largura no contêiner externo e acomodam textos longos e mídias.
- As etiquetas da conversa podem ser alteradas diretamente pelo cabeçalho ou pelo menu de ações da
  lista, sem depender da abertura do painel de detalhes.
- A P2 adiciona a tabela `ConversationParticipant` (migration
  `20261024150000_conversation_participants`). Testes unitários: `webhook.service.spec.ts`,
  `contacts.service.sync.spec.ts`, `whatsapp-conversation-sync.service.spec.ts` (backend) e
  `conversation-presence.test.tsx`, `use-realtime.test.tsx` (frontend). Execução local:
  `npm run start:dev` no backend e `npm run dev` no frontend.

Referência do evento: [implementação da Evolution](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts).

- `QUEUE_DRIVER=bullmq` (produção/dev) usa BullMQ sobre `REDIS_URL`; `inline` processa no próprio
  request e é o padrão em `NODE_ENV=test`, mantendo os testes determinísticos.
- Jobs carregam `tenantId` explícito: `whatsapp.message.process`, `whatsapp.message.send`,
  `digest.tick`, `digest.deliver`. O processamento reestabelece o `TenantContext` no início.
- Envio com falha é persistido como `FAILED` com o motivo (`metadata.errorCode`) **mesclado** ao
  metadata existente (não descarta `showAgentName`/`quoted`). Apenas falhas **definitivas** do
  provedor (`HTTP 429`/`5xx`, resposta recebida e não aceita) são reenfileiradas
  (`whatsapp.message.send`) com o retry limitado do BullMQ. Falhas de rede/timeout têm resultado
  **incerto**: a mensagem fica `FAILED` e **não** é reenviada automaticamente; o operador decide
  reenviar. Isso evita duplicar uma mensagem que o provedor possa ter aceitado.
- `retrySend` só reenvia mensagem `OUTBOUND` em `PENDING`/`FAILED` **sem `externalMessageId`**. Uma
  mensagem que já foi aceita pelo provedor (tem id externo) ou que chegou a `SENT`/`DELIVERED`/`READ`
  nunca volta para a fila de envio — evita duplicatas. Não há reenvio automático em massa de
  pendentes após reconexão.
- **Guarda de conexão**: o envio humano (texto, mídia e edição) só ocorre quando a instância está
  `CONNECTED`. Caso contrário a API responde `409 WHATSAPP_INSTANCE_NOT_CONNECTED`, nada é persistido
  nem enviado. Isso impede enviar por uma instância órfã/desconectada mantida no CRM (aceite seguido
  de erro) e orienta o operador a reconectar. O processamento da fila `whatsapp.message.send` também
  é ignorado (com log `whatsapp.send.skipped`) enquanto a instância não estiver conectada.
- Realtime: gateway Socket.IO no namespace `/realtime`, autenticado por JWT + membership no
  handshake. Rooms: `tenant:{tenantId}`, `tenant:{tenantId}:user:{userId}`,
  `tenant:{tenantId}:conversation:{conversationId}`. Eventos são emitidos por room — nunca
  `server.emit`.
- O frontend usa Socket.IO como caminho principal e `refetchInterval` apenas como fallback.

### Status de entrega e leitura

- A Evolution envia recibos pelo evento `messages.update` (status `SERVER_ACK`, `DELIVERY_ACK`,
  `READ`, `PLAYED`, `PENDING`, `ERROR`). O webhook mapeia: `SERVER_ACK` → `SENT`,
  `DELIVERY_ACK` → `DELIVERED`, `READ`/`PLAYED` → `READ`, `ERROR` → `FAILED`.
- O recibo é casado pelo `externalMessageId` da mensagem **dentro do tenant** (a coluna é
  `UNIQUE (tenantId, externalMessageId)`) e apenas mensagens `OUTBOUND` são atualizadas. A
  progressão é monotônica: um recibo atrasado nunca regride um status já avançado (ex.: `READ` não
  volta para `DELIVERED`).
- **`ERROR` é terminal e corrige o falso sucesso**: uma mensagem `PENDING` ou `SENT` pode virar
  `FAILED` quando a Evolution reporta erro (ex.: sessão degradada ackou o envio mas falhou depois).
  `DELIVERED`/`READ` **nunca** regridem para `FAILED` por evento atrasado e uma mensagem já `FAILED`
  permanece `FAILED` (idempotente). Antes desta correção, `SENT → FAILED` era descartado e o CRM
  exibia como enviada uma mensagem que falhou.
- Ao mudar, o backend emite `message.updated` na room da conversa e `conversation.updated` no
  tenant, e o frontend invalida as queries exibindo o segundo *check* (entregue), azul (lido) ou o
  indicador de falha (**"Não enviada"** + ícone vermelho) para mensagens `FAILED`.
- Instâncias novas assinam `MESSAGES_UPDATE`; nas já conectadas o evento entra pela
  reconciliação de webhook no boot (ou por **Reconfigurar webhook**). O *tick* só avança se a
  Evolution emitir o recibo — se o destinatário tiver desativado confirmações de leitura, o azul
  pode nunca aparecer.

### Estado da conexão (CONNECTION_UPDATE)

- Instâncias novas assinam `CONNECTION_UPDATE`. O webhook trata `connection.update`
  (`data.state`: `open`/`connecting`/`close`, com `statusReason`) persistindo o novo estado da
  instância (`WhatsAppInstance.status`) e emitindo `whatsapp.instance.updated` na sala
  `tenant:{tenantId}` (somente quando o estado muda). A tela **Configurações → WhatsApp** reage ao
  evento invalidando a listagem.
- Um `connecting` atrasado de socket antigo **não** reativa uma instância marcada como
  `DISCONNECTED`; apenas uma nova solicitação de conexão ou um `open`/erro autoritativo altera o
  estado. A mesma guarda vale para o polling de `/status`.
- `connectionState: open` **não** é prova de que o envio funciona: sessões degradadas
  (`Stream Errored (conflict)`, `device_removed`, `Connection Closed`) podem continuar reportando
  `open`. O `connection.update` é a evidência autoritativa para rebaixar o status. A recuperação da
  sessão (reconectar o número) continua sendo uma ação manual do operador.

### Observabilidade do envio

- O envio inicial e o retry registram log estruturado (`whatsapp.send.succeeded`/`failed`) com
  `phase`, `messageId`, `tenantId`, `instance`, `endpoint`, `durationMs`, `externalMessageId` e o
  erro sanitizado (`name`, `message`, `httpStatus`). **Nunca** são registrados tokens, API keys,
  cookies, QR codes ou credenciais. A causa original da exceção é preservada (`Error.cause`) sem
  vazá-la ao cliente.

### Edição de mensagem

- A Evolution 2.4.0 (Baileys 7.0.0-rc.9) reporta edições de duas formas: `messages.edited`, cujo
  `data` **é** o `protocolMessage` (`key` = mensagem original + `editedMessage` = novo conteúdo), e
  `messages.update`, no formato real `{ keyId: <id original>, status: "SERVER_ACK",
  message: { editedMessage: { message: <novo conteúdo> } } }`. O webhook reconhece ambos, além de
  um `messages.upsert` com `protocolMessage`/`editedMessage` (fallback).
- **Envelopes de container**: uma edição feita no próprio celular chega ao dispositivo vinculado
  embrulhada em `deviceSentMessage`/`ephemeralMessage`. O detector da própria Evolution só olha
  `message.protocolMessage` e **não** desembrulha o container, então reenvia o evento como
  `messages.upsert`. O webhook desembrulha o container **antes** de checar edição (via
  `unwrapViewOnce`), aplicando a edição no lugar em vez de gravar um `[unknown]`. Esse era o
  sintoma de produção.
- Mensagens de controle que **não** são edição (`protocolMessage` de revoke, ephemeral setting,
  app-state sync, etc.) são reconhecidas e descartadas (`ignored: unsupported_message`); nunca
  viram balões `[unknown]`.
- A edição **atualiza a mensagem original no lugar** (casada por `externalMessageId` dentro do
  tenant e da instância), preservando `id`, conversa, direção e remetente. Nunca cria uma nova
  mensagem nem o registro `[unknown]`; o novo conteúdo vai para `content` e `metadata.edited`/
  `metadata.editedAt` marcam a edição (sem migração de schema).
- Processar o mesmo evento mais de uma vez é idempotente (dedupe por evento + update in-place),
  mas edições sucessivas da mesma mensagem são distintas. Se o original ainda não existir (edição
  antes da mensagem) ou não trouxer conteúdo utilizável, o evento é ignorado com segurança. Ao
  aplicar, emite `message.updated` na room da conversa e `conversation.updated` no tenant; o
  frontend exibe "editada" no balão.
- **Limitação da Evolution**: quando o original não está no banco da própria Evolution
  (`DATABASE_SAVE_DATA_NEW_MESSAGE` desligado) ou quando o evento chega sem o id da mensagem
  original, não há como associar a edição com segurança; esses casos são ignorados, sem adivinhar o
  registro.

### Edição pelo CRM

- Endpoint `PATCH /conversations/:id/messages/:messageId` (corpo `{ content }`). Antes de chamar o
  provedor ele valida, no escopo do tenant e da conversa, que a mensagem é **OUTBOUND**, tem
  `externalMessageId` e é de um tipo suportado. Mensagem recebida, sem id externo ou de tipo não
  suportado responde `422 MESSAGE_NOT_EDITABLE`; mensagem/conversa de outro tenant responde `404`.
- Tipos suportados (limite do contrato da Evolution): `TEXT` e a legenda de `IMAGE`/`VIDEO`. Áudio,
  documento, figurinha, localização, contato e reação não podem ser editados.
- `EvolutionClient.updateMessage` chama `POST /chat/updateMessage/{instance}` com
  `{ number, key: { id, remoteJid, fromMe: true }, text }`. O `number` é o destino
  (`pickDestination`) e o `key.remoteJid` é o `externalContactId` completo (funciona para
  `@s.whatsapp.net`, `@g.us` e `@lid`).
- O banco **só é atualizado após a confirmação** da Evolution. O registro mantém `id`, conversa,
  direção e `occurredAt`; muda apenas `content` (e `metadata.edited`/`metadata.editedAt`). Falha
  externa (`404`/`400`) vira `422 MESSAGE_NOT_EDITABLE` sem alterar a mensagem; demais falhas
  propagam `502`. Não há criação de linhas — a edição é idempotente.
- Após aplicar, emite `message.updated` na room da conversa e `conversation.updated` no tenant. A
  mesma mensagem vinda do webhook (celular) e a confirmada pela API são idempotentes, então a
  resposta HTTP e o evento em tempo real não duplicam a bolha.
- **Limitação da Evolution (CRM → WhatsApp)**: o `updateMessage` exige
  `DATABASE_SAVE_DATA_NEW_MESSAGE=true` (a Evolution precisa ter a mensagem original no próprio
  banco para validar `remoteJid`/`fromMe`); o compose já habilita. O WhatsApp aplica a janela de
  edição de ~15 minutos do lado do servidor — além dela a API externa recusa e o CRM responde
  `422`.
- No chat, a ação **Editar** aparece apenas em mensagens enviadas elegíveis (próprias, com id
  externo, não pendentes/falhas, tipo suportado). O editor abre com o texto atual, bloqueia
  reenvio enquanto salva, mostra erro claro e, ao salvar, atualiza a mensagem original no lugar
  (indicador "editada"), preservando horário e posição.

### Diagnóstico temporário do webhook

Para comprovar os eventos reais (ex.: ao investigar edições/`[unknown]`), o backend expõe duas
variáveis **desligadas por padrão**, de uso restrito e fácil remoção:

- `WEBHOOK_DEBUG=true`: registra em log (`debug`) um resumo por evento — nome do evento, instância,
  id da mensagem, id da original, `fromMe`, tipo, se foi detectada edição, resultado da
  normalização e a decisão (`insert`/`update`/`ignore`), sem conteúdo das conversas.
- `WEBHOOK_DEBUG_PAYLOAD=true`: inclui também o payload bruto **redigido** (tokens/senhas/segredos
  mascarados e textos longos truncados).

Ative apenas durante a investigação (`LOG_LEVEL=debug`), reproduza o fluxo e desative em seguida.
Esses dois flags e o método `traceWebhook` em `webhook.service.ts` devem ser removidos quando não
forem mais necessários.

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

### Transcrição de áudio

Com **Transcrever automaticamente** ativa, áudios recebidos (exceto view-once) recebem um registro em
`message_transcriptions` com estado `PENDING` no webhook. O `media.process` baixa e grava o áudio
pelo mecanismo autenticado da Evolution e enfileira `transcription.process`; o webhook nunca espera
a API externa. Com a opção desmarcada, nenhum registro/job é criado automaticamente e o balão oferece
**Transcrever este áudio** para a solicitação manual. A UI mostra a transcrição concluída, os estados
de espera/processamento, falhas recuperáveis com **Tentar transcrever novamente** e
indisponibilidade por configuração. Com a transcrição principal desativada, a ação manual também não
aparece. O texto é apresentado como conteúdo derivado do áudio, sem confundir com mensagem digitada,
e a mídia original continua reproduzível.

Configuração, provedores compatíveis, limites, privacidade e uso no Copiloto estão em
[`ai.md`](./ai.md). A transcrição não altera o fluxo de recebimento: se estiver pendente ou
desativada, a mensagem e o áudio continuam disponíveis normalmente.

## Testes

`test/unit/digest/digest-window.spec.ts` cobre janela/timezone; `test/integration/whatsapp.integration-spec.ts`
cobre instâncias, webhook (válido/inválido/duplicado/instância inexistente), bot (pergunta, handoff,
injeção, falha do provedor) e conversas/tickets; `test/integration/digest.integration-spec.ts` cobre
entrega, janela, isolamento de tenant, zero leads, falha+retry, validação e overview. Evolution e IA
são dublês nos testes; a integração real só é testada com ambiente configurado.

`test/integration/unread-conversations.integration-spec.ts` cobre a marcação de leitura
(idempotência, persistência, isolamento entre tenants, emissão de `conversation.updated`), o cálculo
das não lidas (exclui `OUTBOUND`, incrementa em nova mensagem, não duplica webhooks repetidos,
preserva mensagens recebidas após a leitura e exclui arquivadas do total do tenant).

`test/integration/conversation-delete.integration-spec.ts` cobre a exclusão lógica (some da caixa de
entrada e das arquivadas, detalhe 404, some do total de não lidas, é escopada por tenant, exige
autenticação, não é revertida por nova mensagem, publica `conversation.deleted` e preserva
fixar/arquivar/desarquivar/ler/encerrar/reabrir). A suíte de WhatsApp também cobre reações:
mensagem comum sem regressão, reação individual e em grupo, reação do próprio dispositivo, troca,
remoção, alvo ainda não sincronizado, reentrega idempotente, isolamento entre tenants e ausência de
nova mensagem/não lida. No frontend, `npm test` (Vitest) cobre o agrupamento visual em
`src/features/attendance/attendance-utils.test.ts` (mesmo participante, participantes diferentes,
sem identificação, direções, janela temporal, mudança de dia, reações e mídia) e a renderização das
reações sobre o balão em `message-bubble.test.tsx`.

## Fora de escopo

Automações gerais, upload/expurgo de mídia, e-mail de digest, notificação individual por lead e
múltiplos canais além de WhatsApp.
