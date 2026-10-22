# IA no atendimento — OrderUp CRM

> Status: **Implementado**. Configuração por organização em **Configurações → IA**, botão de
> formalização no compositor do chat, Copiloto comercial persistente no detalhe da oportunidade e
> transcrição assíncrona de áudios recebidos no WhatsApp. Nenhuma mensagem é enviada
> automaticamente ao WhatsApp.

Complementa [`settings.md`](./settings.md), [`attendance.md`](./attendance.md) e
[`multi-tenancy.md`](./multi-tenancy.md).

## Visão geral

Cada organização escolhe um provedor, um modelo recomendado, o nível de formalidade e cadastra suas
próprias credenciais. O atendente digita a mensagem normalmente e pode usar o botão **Formalizar
mensagem com IA** para reescrever o conteúdo completo do compositor. O texto retornado fica no
campo para revisão, edição e envio posterior; o envio continua sendo uma ação manual.

O botão só aparece quando o backend informa que a configuração daquele tenant está ativa e
utilizável (provedor, modelo e credencial). A validação definitiva é
sempre feita no backend no momento da formalização.

## Aba IA (Configurações)

A aba IA é dividida em três sub-abas, com o conteúdo e os indicadores de status preservados em cada
recurso:

- **Copiloto IA** — provedor (**OpenAI**, **DeepSeek**, **Anthropic** ou **OpenRouter**), modelo
  (três opções recomendadas por provedor), nível de formalidade (**Profissional**, **Formal** ou
  **Muito formal**) e chave **Ativar IA no atendimento**. A credencial do provedor selecionado é
  gerenciada nesta sub-aba.
- **Transcrição** — **Ativar transcrição de áudio** controla o recurso inteiro (automático e
  manual), além de provedor, modelo e **Transcrever automaticamente**. Esta opção aparece somente
  com o recurso ativado e começa desmarcada: marcada, transcreve cada áudio recebido; desmarcada, o
  áudio exibe a ação manual **Transcrever este áudio** no atendimento.
- **Credenciais** — visão centralizada do status por provedor e dos recursos que utilizam cada
  chave, com atalho para gerenciar a credencial do Copiloto ou da transcrição. A transcrição
  reutiliza a credencial OpenAI já salva; as demais credenciais permanecem independentes por
  provedor.

**Testar conexão** usa as credenciais digitadas ou as já armazenadas, sem salvar alterações.
**Salvar configurações** e **Salvar transcrição** persistem cada seção de forma independente.
Credenciais existentes nunca são exibidas; deixar o campo vazio mantém a credencial atual. A remoção
exige a ação explícita **Remover credencial** seguida de salvar. Alterações ainda não salvas são
preservadas ao alternar entre as sub-abas.

Leitura disponível para todos os membros; escrita e teste restritos a `OWNER`/`ADMIN`.

## Modelos recomendados

Os identificadores ficam centralizados em `backend/src/modules/ai/ai.models.ts`. A lista foi
validada contra a documentação oficial vigente dos provedores (outubro/2026).

| Provedor   | Modelos                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| OpenAI     | `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra`                              |
| DeepSeek   | `deepseek-flash`, `deepseek-v4-pro`, `deepseek-v4-flash` (alias legado) |
| Anthropic  | `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`              |
| OpenRouter | `anthropic/claude-haiku-5-5`, `openai/gpt-5.4-mini`, `google/gemini-3.1-flash-lite` |

Os IDs do OpenRouter são prefixados pelo desenvolvedor do modelo. O OpenRouter é o provedor de
acesso; Anthropic, OpenAI e Google são os fabricantes dos modelos escolhidos.

Cada adaptador usa o endpoint e o formato próprios:

- OpenAI: `POST https://api.openai.com/v1/chat/completions`.
- DeepSeek: `POST https://api.deepseek.com/chat/completions` (thinking desativado para reduzir
  latência e custo).
- Anthropic: `POST https://api.anthropic.com/v1/messages`, com `x-api-key` e
  `anthropic-version: 2023-06-01`; a resposta é lida dos blocos `content[].type = "text"`.
- OpenRouter: `POST https://openrouter.ai/api/v1/chat/completions`, com Bearer token e formato
  compatível com Chat Completions.

Nenhuma URL é escolhida pelo cliente. O frontend só envia provedor/modelo da lista centralizada.

## Transcrição de áudio (Speech-to-Text)

A transcrição é uma configuração **independente** do provedor/modelo de texto. Uma organização pode
usar DeepSeek no Copiloto e OpenAI para transcrever áudios, sem alterar o provedor principal.

### Compatibilidade real dos provedores

| Provedor   | Transcrição | Observação                                                                 |
| ---------- | ----------- | -------------------------------------------------------------------------- |
| OpenAI     | Sim         | API oficial `POST https://api.openai.com/v1/audio/transcriptions`.          |
| DeepSeek   | Não         | A integração disponível no CRM só oferece modelos de texto.                 |
| Anthropic  | Não         | A integração disponível no CRM só oferece modelos de texto.                 |
| OpenRouter | Não         | O CRM o utiliza como acesso a modelos de texto; não há endpoint de STT.     |

Provedores sem suporte aparecem na interface com o motivo e não podem ser salvos como configuração
de transcrição. O backend valida novamente e responde `AI_TRANSCRIPTION_PROVIDER_UNSUPPORTED`.

Modelos OpenAI aceitos (lista centralizada em
`backend/src/modules/transcription/transcription.models.ts`):

- `whisper-1` — modelo consolidado e econômico;
- `gpt-4o-mini-transcribe` — melhor custo-benefício para áudios curtos;
- `gpt-4o-transcribe` — maior precisão em áudios com ruído/sotaques.

O identificador enviado à API é sempre o `id` do catálogo, nunca o rótulo da interface. A OpenAI
aceita oficialmente `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav` e `webm`; os áudios de voz do
WhatsApp chegam como **OGG/Opus** e são convertidos para **WAV mono 16 kHz** com `ffmpeg` antes do
envio. Sem essa conversão, `gpt-4o-transcribe`/`gpt-4o-mini-transcribe` respondem
`400 Unsupported file format oga`. `whisper-1` ainda aceita OGG na prática, mas passa pela mesma
normalização para manter o comportamento previsível entre modelos.

O binário `ffmpeg` é instalado na imagem Docker do backend e pode ser apontado por `FFMPEG_PATH`.
Se ele não estiver disponível, o estado é `FAILED` com
`AI_TRANSCRIPTION_CONVERSION_UNAVAILABLE` (recuperável após corrigir o servidor), nunca
“modelo indisponível”.

### Reutilização de credencial

A transcrição reutiliza `ai_settings.openai_api_key_encrypted`, a mesma credencial OpenAI já usada
pela IA de texto. Não existe segunda cópia da chave. Se a organização usa outro provedor de texto e
ainda não possui chave OpenAI, a própria seção de transcrição permite cadastrá-la; a chave é gravada
no mesmo campo criptografado. Outra empresa nunca acessa essa credencial (escopo por `tenantId`).

### Configuração e endpoints

- `GET /api/ai/transcription/catalog` — provedores, suporte e modelos oficiais.
- `GET /api/ai/transcription/settings` — estado sem segredos (`available`, `reason`, `hasCredentials`).
- `PUT /api/ai/transcription/settings` — ativa/desativa, define a transcrição automática e escolhe
  provedor/modelo (`OWNER`/`ADMIN`).
- `POST /api/ai/transcription/test` — valida credencial/modelo via `GET /v1/models/{model}`, sem
  enviar áudio (`OWNER`/`ADMIN`, 8 req/min).
- `POST /api/ai/transcription/messages/:conversationId/:messageId/retry` — nova tentativa manual
  idempotente para falha recuperável (10 req/min, módulo `atendimento`).

Estados expostos: `NOT_APPLICABLE`, `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`. `FAILED` inclui
`retryable`/`canRetry`; falhas definitivas (formato, tamanho, duração, autenticação, modelo) não
oferecem nova tentativa. Registros antigos em `NOT_APPLICABLE` por configuração continuam
oferecendo **Transcrever este áudio** depois que a configuração fica disponível; o backend revalida
a configuração antes de enfileirar. Com a configuração principal desativada, nem a transcrição
automática nem a ação manual ficam disponíveis.

Com **Transcrever automaticamente** desmarcada, o áudio recebido não cria registro nem job. A UI
mostra “Transcrição não realizada para este áudio” e oferece **Transcrever este áudio**; o clique
usa o mesmo endpoint de retry, exibe carregamento e atualiza o balão com o resultado ou o erro.
Áudios recebidos **antes da existência do registro** de transcrição seguem o mesmo caminho. O
endpoint de retry cria o registro `PENDING` com a configuração atual do tenant e enfileira o job
determinístico; mensagens já concluídas não são repetidas. Não existe varredura automática de todo
o histórico — a recuperação é manual, por mensagem, e continua sujeita aos limites, idempotência e
à disponibilidade da mídia original.

O evento `message.updated` é emitido também em falha e em `NOT_APPLICABLE`, para que o balão saia de
“aguardando” mesmo quando a transcrição não puder ser concluída.

### Fluxo assíncrono

1. O webhook da Evolution persiste a mensagem pelo fluxo existente e, somente com a transcrição
   automática ativa, cria o registro `PENDING` para áudio recebido (não view-once). O processamento
   principal do webhook não espera a transcrição.
2. O job `media.process` baixa a mídia pela Evolution (`getBase64FromMediaMessage`), grava no storage
   e, se a transcrição automática estiver ativa, enfileira `transcription.process`. Não há
   requisição a URL arbitrária do webhook.
3. O worker valida configuração, estado, formato, tamanho e duração, lê o arquivo do storage,
   converte OGG/Opus para WAV quando necessário e chama a API externa com timeout.
4. O resultado é normalizado, limitado a 20.000 caracteres e salvo em `message_transcriptions`,
   associado à mensagem original. O áudio original permanece intacto.
5. A conclusão emite `message.updated`/`conversation.updated`, e o chat aberto atualiza via realtime
   existente, sem polling agressivo.

O job usa `jobId` estável por mensagem, transição atômica de estado e verificação de `COMPLETED`
para impedir chamadas duplicadas — inclusive em atualizações realtime e re-renderizações do chat. Se
o anexo ainda não estiver disponível, o worker tenta o download pela mesma rotina de mídia; sem
sucesso, grava falha recuperável. A transcrição manual reutiliza esse mesmo job e fluxo.

### Limites, retry e custos

- `TRANSCRIPTION_MAX_BYTES` (padrão 25 MB) e `TRANSCRIPTION_MAX_DURATION_SECONDS` (padrão 600 s).
- `TRANSCRIPTION_CONCURRENCY` (2) e `TRANSCRIPTION_TENANT_CONCURRENCY` (1) limitam chamadas
  simultâneas, isolando custo por organização.
- `TRANSCRIPTION_TIMEOUT_MS` (60 s), `TRANSCRIPTION_MAX_ATTEMPTS` (3) com backoff linear
  (`TRANSCRIPTION_RETRY_DELAY_MS`, padrão 1 s). Apenas timeout, conexão, 429 e 5xx são repetidos.
- `TRANSCRIPTION_LANGUAGE` é opcional; quando ausente, o provedor detecta o idioma.
- `TRANSCRIPTION_CONVERSION_TIMEOUT_MS` (30 s) e `FFMPEG_PATH` controlam a normalização do áudio.
- Métricas em log incluem tenant, mensagem, estágio (`conversion`, `provider`, `validation`,
  `media_download`, `configuration`), provedor/modelo, duração, tentativas e código de erro.
  Áudio, texto transcrito, credenciais e dados pessoais não são registrados.
- Erros do provedor são classificados pelo motivo real: formato/conteúdo recusado
  (`AI_TRANSCRIPTION_FILE_REJECTED`), requisição inválida (`AI_TRANSCRIPTION_INVALID_REQUEST`),
  autenticação, cota, rate limit, timeout, indisponibilidade e somente
  `AI_TRANSCRIPTION_MODEL_UNAVAILABLE` quando a própria OpenAI informa que o modelo não existe ou
  não está acessível.
- Áudios são enviados ao provedor externo configurado (OpenAI). Esse é o único compartilhamento
  necessário para o recurso; sem configuração/autorização a transcrição não ocorre.

### Persistência

Migration `20261021190000_audio_transcription`:

- `ai_settings.transcription_enabled`, `transcription_provider`, `transcription_model`;
- tabela `message_transcriptions` com `message_id` único, estado, texto, idioma, provedor, modelo,
  tentativas, `retryable`, erro seguro e data da transcrição;
- índices por `(tenant_id, status)` e `(tenant_id, updated_at)`; exclusão em cascata com mensagem e
  tenant.

O registro nunca substitui a mensagem, o anexo ou seus metadados.

A migration `20261021200000_transcription_retry_misclassified_model_error` reabre para nova tentativa
apenas os registros antigos de `FAILED`/`AI_TRANSCRIPTION_MODEL_UNAVAILABLE` produzidos pela
classificação incorreta de erros de formato. Nenhuma estrutura de tabela é alterada.

A migration `20261021210000_transcription_auto_settings` adiciona
`ai_settings.transcription_auto_enabled`, com padrão `false`. Ela é independente da chave principal:
o valor só produz efeito quando `transcription_enabled` também está ativo.

## Persistência e isolamento

Tabela `ai_settings`, criada pela migration `20261021000000_ai_settings`:

- `tenant_id` é **único** (uma configuração por organização).
- Provedor, modelo, formalidade e ativação.
- Transcrição: ativação principal, preferência de transcrição automática, provedor e modelo.
- Credenciais separadas por provedor, sempre criptografadas:
  `openai_api_key_encrypted`, `deepseek_api_key_encrypted`,
  `anthropic_api_key_encrypted`, `openrouter_api_key_encrypted`.
- Nenhuma credencial de um provedor é reutilizada como fallback em outro.
- A migration `20261021010000_ai_providers_anthropic_openrouter` adiciona as novas credenciais e
  substitui o enum de provedores. Configurações antigas de Cloudflare viram uma configuração
  Anthropic incompleta, com o token antigo removido para impedir reutilização entre provedores.
  Configurações de OpenAI e DeepSeek são preservadas.

Todas as leituras e escritas usam o `tenantId` do `TenantContext` derivado do token verificado; o
cliente nunca informa o tenant. O `upsert` usa a unique constraint por tenant, evitando duplicidade
e mantendo a última escrita consistente.

## Endpoints

| Método | Rota                | Papéis            | Descrição                                      |
| ------ | ------------------- | ----------------- | ---------------------------------------------- |
| GET    | `/api/ai/catalog`   | membros           | Provedores, modelos e níveis de formalidade    |
| GET    | `/api/ai/settings`  | membros           | Estado da configuração, sem segredos           |
| PUT    | `/api/ai/settings`  | `OWNER`, `ADMIN`  | Cria/atualiza a configuração do tenant         |
| POST   | `/api/ai/test`      | `OWNER`, `ADMIN`  | Testa a conexão com as credenciais informadas  |
| GET    | `/api/ai/transcription/catalog` | membros | Provedores, suporte e modelos de STT        |
| GET    | `/api/ai/transcription/settings` | membros | Estado da transcrição, sem segredos        |
| PUT    | `/api/ai/transcription/settings` | `OWNER`, `ADMIN` | Salva a configuração de transcrição |
| POST   | `/api/ai/transcription/test` | `OWNER`, `ADMIN` | Valida credencial e modelo de STT    |
| POST   | `/api/ai/transcription/messages/:conversationId/:messageId/retry` | membros | Reprocessa falha recuperável |
| POST   | `/api/ai/formalize` | membros           | Reformula o texto do compositor                |
| POST   | `/api/ai/sales/analyze` | membros      | Analisa, persiste o contexto e gera recomendações |
| POST   | `/api/ai/sales/suggest-reply` | membros | Gera uma resposta contextual para o WhatsApp |
| GET    | `/api/ai/sales/context` | membros | Recupera contexto, recomendações e follow-ups |
| PATCH  | `/api/ai/sales/recommendations/:id` | membros | Aceita, rejeita ou cancela uma recomendação |
| POST   | `/api/ai/sales/follow-ups` | membros | Cria um acompanhamento com idempotência |
| PATCH  | `/api/ai/sales/follow-ups/:id` | membros | Conclui, cancela ou reagenda um acompanhamento |

`/api/ai/formalize` exige o módulo de atendimento habilitado e aplica rate limit de 20 req/min por
IP. As rotas do copiloto exigem o módulo `crm` (e `attendance` quando uma conversa é usada) e
aplicam limites entre 10 e 30 req/min por IP. `/api/ai/test` aplica 8 req/min. O backend também
evita chamadas concorrentes do mesmo usuário.

## Copiloto comercial

O detalhe da oportunidade em `/leads` exibe o painel **Copiloto comercial**. Ele analisa a
oportunidade e a conversa atualmente selecionada, sem criar uma página isolada e sem substituir o
atendimento existente.

### Operações

- **Analisar oportunidade / Reanalisar:** retorna resumo, necessidade, informações conhecidas,
  informações pendentes, próxima pergunta, resposta sugerida e justificativa.
- **Sugerir resposta / Gerar outra:** gera uma resposta para o estágio atual da negociação. A
  sugestão anterior é preservada até o usuário escolher substituí-la.
- **Usar resposta:** insere o texto no compositor da conversa selecionada para revisão e edição.
  Nunca envia a mensagem. Se já houver rascunho, o compositor pede confirmação e oferece substituir
  ou inserir ao final.

A análise é persistida por oportunidade e vinculada à última conversa analisada. Ao abrir o painel,
o contexto salvo, as recomendações e os acompanhamentos são recuperados pelo backend. O contexto é
marcado como desatualizado quando a conversa selecionada muda, quando chega uma mensagem mais
recente (`latestMessageId`) ou quando `lead.updatedAt` muda; nesse caso o usuário precisa acionar
**Reanalisar**.

### Contexto e contratos

Os endpoints recebem apenas `leadId` e, opcionalmente, `conversationId`. A análise de resposta aceita
também `previousAnalysis` (limite de 4.000 caracteres), tratado como referência não confiável e
nunca como substituto dos dados oficiais.

O backend sempre carrega do banco:

- oportunidade, etapa, pipeline, valor, responsável, origem, etiquetas, observações e follow-up;
- contato vinculado à oportunidade;
- conversa do mesmo tenant e do mesmo contato da oportunidade;
- mensagens reais da conversa, em ordem cronológica.

Limites: até 80 mensagens e 24.000 caracteres de histórico. As mensagens mais recentes têm
prioridade; quando o limite é atingido, `historyTruncated` é verdadeiro. Áudios com transcrição
`COMPLETED` entram com o campo `transcription` (texto derivado) separado do campo `text` (conteúdo
digitado), além de `transcriptionStatus`. Áudios pendentes/falhos entram com o estado e a instrução
de que não foram transcritos; documentos, imagens e figurinhas continuam apenas como tipo. O prompt
marca `TRANSCRICOES_DE_AUDIO_PENDENTES` e `MIDIAS_SEM_TEXTO`, e o conteúdo derivado é tratado como
dado não confiável, nunca como instrução de sistema. O backend não aceita histórico arbitrário
enviado pelo frontend.

A conclusão de uma transcrição é uma mudança relevante de contexto: o `latestTranscriptionAt`
persistido é comparado ao maior `transcribedAt` concluído da conversa e, se mudou, o estado retorna
`new_transcription` em `staleReasons`. A análise só é refeita quando o usuário aciona
**Reanalisar**; não há nova chamada automática (controle de custo/concorrência).

Resposta estruturada da análise (além dos campos da Fase 1, inclui `objective`, `hypotheses`,
`nextAction` e `leadUpdateSuggestions`):

```json
{
  "summary": "...",
  "objective": "...",
  "need": "...",
  "knownInformation": ["fatos confirmados"],
  "hypotheses": ["Hipótese: ..."],
  "pendingInformation": ["..."],
  "nextQuestion": "...",
  "suggestedReply": "...",
  "rationale": "...",
  "nextAction": {
    "action": "...",
    "reason": "...",
    "priority": "LOW | MEDIUM | HIGH",
    "expectedOutcome": "...",
    "missingInformation": ["..."],
    "suggestedDueAt": null,
    "suggestedMessage": "..."
  },
  "leadUpdateSuggestions": [
    {
      "field": "NEED | PRODUCT | BUDGET | DEADLINE | USERS | REQUIREMENTS | OBJECTION | STAGE | LOSS_REASON | NOTES",
      "proposedValue": "...",
      "evidence": "..."
    }
  ],
  "provider": "OPENAI",
  "model": "gpt-6-luna",
  "generatedAt": "2026-10-21T12:00:00.000Z",
  "promptVersion": "sales-copilot-v2",
  "context": {
    "leadId": "...",
    "conversationId": "...",
    "messageCount": 12,
    "latestMessageId": "...",
    "latestMessageAt": "...",
    "leadUpdatedAt": "...",
    "historyTruncated": false,
    "mediaWithoutText": 0
  },
  "state": {
    "context": { "...": "contexto persistido" },
    "stale": false,
    "staleReasons": [],
    "nextAction": { "...": "recomendação atual" },
    "leadUpdateSuggestions": [],
    "recommendations": [],
    "followUps": []
  }
}
```

Sem conversa selecionada, a análise usa apenas os dados comerciais e informa a ausência de
histórico. A resposta sugerida usa o mesmo idioma das últimas mensagens do cliente.

### Reutilização e segurança

- A configuração de provedor, modelo, formalidade e credencial é a mesma da formalização, carregada
  por tenant. Não existe cadastro paralelo nem fallback entre provedores.
- Provedores são chamados pelo serviço compartilhado `AiExecutionService`; a formalização mantém o
  comportamento e o contrato anteriores.
- Prompts do copiloto são separados do prompt de formalização.
- Conversa, mensagens, observações e análise anterior são delimitadas como conteúdo não confiável.
  Instruções dentro das mensagens do cliente não alteram regras, permissões ou ações.
- A IA apenas sugere; não move etapas, não envia mensagens e não executa ações administrativas.
- Respostas do provedor são validadas por schema. Conteúdo inválido retorna
  `AI_SALES_INVALID_RESPONSE`; erros de provedor usam os mesmos códigos seguros da formalização.
- Prompts, mensagens e credenciais não são registrados em logs.

### Persistência do contexto

A migration `20261021184237_lead_copilot_phase2` adiciona:

- `lead_commercial_contexts`: um registro por oportunidade (`lead_id` único), com resumo, objetivo,
  necessidade, fatos confirmados, hipóteses, informações pendentes, próxima pergunta, resposta
  sugerida, justificativa, provedor/modelo, versão do prompt, versão da análise, mensagem/data do
  contexto, `lead_updated_at` e datas de criação/atualização.
- `lead_recommendations`: ciclo de vida das recomendações (`NEXT_ACTION` e `LEAD_UPDATE`) com
  status, prioridade, motivo, resultado esperado, informações faltantes, prazo/mensagem sugeridos,
  campo/valor/evidência de atualização, decisão, usuário decisor e snapshots `beforeData`/`afterData`.
- `lead_follow_ups`: acompanhamento comercial com ação, motivo, prazo, responsável, mensagem
  preparada, status (`PENDING`, `COMPLETED`, `CANCELED`), histórico de eventos, contador de
  reagendamentos, vínculo opcional com a recomendação e chave de idempotência.

Todas as consultas usam `tenantId` do `TenantContext`. O `upsert` por `leadId` evita duplicidade de
contexto; `analysisVersion` protege contra concorrência e permite identificar a versão vigente. A
criação de follow-up usa chave de idempotência e vínculo único com a recomendação.

### Próxima melhor ação

Cada análise gera uma recomendação específica com ação, motivo, prioridade (`LOW`, `MEDIUM`, `HIGH`),
resultado esperado, informações faltantes, prazo sugerido apenas quando fundamentado e mensagem
opcional. O prompt recebe o estágio atual, o contexto persistido e as recomendações/follow-ups
anteriores para evitar sugestões genéricas ou repetidas. Quando não há contexto suficiente, o modelo
deve declarar a limitação e recomendar uma pergunta de esclarecimento.

### Follow-ups assistidos

O painel permite criar um acompanhamento a partir de uma recomendação ou manualmente, com data/hora,
responsável ativo do tenant, motivo e mensagem preparada. A criação exige confirmação no diálogo e
nunca envia mensagem. O acompanhamento pode ser concluído, cancelado ou reagendado; a conclusão
aceita um resultado opcional informado pelo usuário, o reagendamento mantém o status pendente,
incrementa o contador e registra o evento. Nenhuma estrutura paralela de tarefas foi criada porque
o CRM não possuía módulo de tarefas adequado.

### Atualizações do lead

Sugestões de atualização usam uma lista fechada de campos (`NEED`, `PRODUCT`, `BUDGET`, `DEADLINE`,
`USERS`, `REQUIREMENTS`, `OBJECTION`, `STAGE`, `LOSS_REASON`, `NOTES`) e sempre apresentam evidência.
O usuário pode editar, aplicar ou rejeitar. A aplicação só ocorre após ação explícita:

- campos informativos são anexados às observações da oportunidade;
- `STAGE` é validado contra as etapas reais do pipeline antes de mover a oportunidade;
- a decisão registra `beforeData`, `afterData`, usuário e resultado na recomendação.

A IA não altera cadastro, etapa ou status por conta própria. Aplicações repetidas são idempotentes
por status `EXECUTED`.

### Histórico e limitações

O histórico retorna recomendações com status (`RECOMMENDED`, `ACCEPTED`, `REJECTED`, `EXECUTED`,
`CANCELED`), decisão, usuário e snapshots. Uma nova análise cancela recomendações ainda pendentes da
versão anterior como `superseded_by_new_analysis`, preservando o histórico. A Fase 2 não calcula
conversão, causalidade, dashboards ou métricas agregadas; esses itens permanecem para a Fase 3.

## Segurança

- Credenciais são criptografadas em repouso com AES-256-GCM via `EncryptionService`, usando
  `CREDENTIALS_ENCRYPTION_KEY` do ambiente. Sem essa variável, salvar credenciais retorna erro e
  não grava nada.
- A API nunca devolve a credencial; apenas `hasCredentials` e `configuredProviders`.
- Logs não incluem prompts, respostas, tokens ou cabeçalhos de autorização. O logger já redige as
  variáveis de credencial.
- Erros do provedor são traduzidos para códigos seguros (`AI_PROVIDER_AUTH_FAILED`,
  `AI_PROVIDER_RATE_LIMITED`, `AI_PROVIDER_QUOTA_EXCEEDED`, `AI_PROVIDER_TIMEOUT`,
  `AI_MODEL_UNAVAILABLE`, `AI_PROVIDER_INVALID_RESPONSE`, etc.) sem repassar corpo bruto da resposta.
- O texto do usuário é enviado como conteúdo a reformular; o prompt de sistema instrui o modelo a
  ignorar comandos contidos nele.
- Limite de 4.000 caracteres por formalização e timeout configurável por `AI_TIMEOUT_MS`.

## Variáveis de ambiente

| Variável                     | Obrigatória | Default | Observações                                      |
| ---------------------------- | ----------- | ------- | ------------------------------------------------ |
| `CREDENTIALS_ENCRYPTION_KEY` | para salvar | —       | >= 32 caracteres; protege WhatsApp e IA          |
| `AI_TIMEOUT_MS`              | não         | `30000` | Timeout das chamadas aos provedores              |
| `TRANSCRIPTION_TIMEOUT_MS`   | não         | `60000` | Timeout da chamada de transcrição                |
| `TRANSCRIPTION_MAX_BYTES`    | não         | `26214400` | Tamanho máximo do áudio enviado               |
| `TRANSCRIPTION_MAX_DURATION_SECONDS` | não | `600` | Duração máxima quando informada pelo WhatsApp   |
| `TRANSCRIPTION_CONCURRENCY`  | não         | `2`     | Transcrições simultâneas por processo            |
| `TRANSCRIPTION_TENANT_CONCURRENCY` | não   | `1`     | Transcrições simultâneas por organização         |
| `TRANSCRIPTION_MAX_ATTEMPTS` | não         | `3`     | Tentativas por erro transitório                  |
| `TRANSCRIPTION_RETRY_DELAY_MS` | não       | `1000`  | Base do backoff linear                           |
| `TRANSCRIPTION_LANGUAGE`     | não         | —       | Idioma ISO opcional; vazio = detecção automática |
| `TRANSCRIPTION_CONVERSION_TIMEOUT_MS` | não | `30000` | Timeout da conversão OGG/Opus → WAV          |
| `FFMPEG_PATH`                | não         | `ffmpeg` | Binário usado na conversão de áudio            |
| `RATE_LIMIT_ENABLED`         | não         | `true`  | Desativa rate limits em testes                   |

As antigas `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` e `AI_BASE_URL` permanecem validadas por
compatibilidade, mas **não** configuram a IA por organização. A configuração efetiva é a da tabela
`ai_settings`.

## Fluxo de formalização

1. O atendente clica em **Formalizar mensagem com IA**.
2. O frontend guarda uma cópia exata do texto e envia o conteúdo completo ao backend.
3. O backend resolve o tenant, carrega a configuração, descriptografa a credencial e monta o prompt
   com o nível de formalidade salvo.
4. O provedor selecionado é chamado com timeout.
5. A resposta é validada (não vazia) e devolvida.
6. O compositor substitui o texto, mantendo a mensagem sem envio.
7. **Desfazer reformulação** restaura exatamente o texto anterior enquanto o compositor não for
   enviado ou limpo.

Em caso de erro, o texto original permanece intacto, o botão é reabilitado e o atendente pode
tentar novamente ou enviar a mensagem original.

## Custos e desempenho

- Nenhuma chamada automática por digitação; só após ação explícita.
- Botão bloqueado durante a requisição e lock no backend contra chamadas concorrentes.
- Texto limitado a 4.000 caracteres, timeout padrão de 30 s e sem retries automáticos que possam
  gerar custos.
- O teste de conexão usa uma solicitação mínima e não envia mensagens a contatos.

## Testes

- Unitários: `backend/test/unit/ai/` (persistência, criptografia, modelo x provedor, prompt,
  erros e concorrência).
- Integração: `backend/test/integration/ai.integration-spec.ts` (isolamento por tenant, papéis,
  credencial oculta, teste de conexão sem persistência e formalização com provedor mockado).
- Frontend: `message-composer.test.tsx` (formalização e inserção sem envio), `ai-settings-tab.test.tsx`,
  `sales-copilot-panel.test.tsx` (contexto salvo, desatualização, recomendação, atualização do lead,
  follow-ups, histórico, erros e inserção sem envio) e `lead-detail-sheet.test.tsx`.
- Copiloto: unitários de prompt/parser em `backend/test/unit/ai/`; integração em
  `backend/test/integration/sales-copilot.integration-spec.ts` (persistência e recarga, isolamento
  por tenant, conversa de outro contato, IA desativada, timeout/rate limit, limite de histórico,
  resposta inválida, concorrência, decisões de recomendação, atualização de etapa/observações,
  follow-ups idempotentes, conclusão/cancelamento/reagendamento e ausência de envio automático).
- Transcrição: unitários em `backend/test/unit/transcription/` (catálogo, três modelos oficiais,
  conversão OGG/Opus, classificação de formato versus modelo, adapter OpenAI, timeout,
  autenticação, resposta inválida, sucesso, idempotência, concorrência, limites, falha transitória
  com retry e falha definitiva); integração em `backend/test/integration/ai.integration-spec.ts`
  (configuração, provedor sem suporte, modelo inválido, reutilização da credencial, isolamento e
  teste sem áudio); frontend em `message-transcription.test.tsx` (estados, texto derivado, retry e
  ausência de retry permanente) e `ai-settings-tab.test.tsx` (configuração independente).
