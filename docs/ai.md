# IA no atendimento — OrderUp CRM

> Status: **Implementado**. Configuração por organização em **Configurações → IA**, botão de
> formalização no compositor do chat e Copiloto comercial no detalhe da oportunidade. Nenhuma
> mensagem é enviada automaticamente ao WhatsApp.

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

- Provedor: **OpenAI**, **DeepSeek**, **Anthropic** ou **OpenRouter**.
- Modelo: três opções recomendadas por provedor.
- Credenciais: chave da API específica do provedor selecionado.
- Nível de formalidade: **Profissional**, **Formal** ou **Muito formal**.
- Chave **Ativar IA no atendimento**.
- **Testar conexão** usa as credenciais digitadas ou as já armazenadas, sem salvar alterações.
- **Salvar configurações** persiste a configuração do tenant.
- Credenciais existentes nunca são exibidas; deixar o campo vazio mantém a credencial atual.
  A remoção exige a ação explícita **Remover credencial** seguida de salvar.

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

## Persistência e isolamento

Tabela `ai_settings`, criada pela migration `20261021000000_ai_settings`:

- `tenant_id` é **único** (uma configuração por organização).
- Provedor, modelo, formalidade e ativação.
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
| POST   | `/api/ai/formalize` | membros           | Reformula o texto do compositor                |
| POST   | `/api/ai/sales/analyze` | membros      | Analisa a oportunidade e a conversa selecionada |
| POST   | `/api/ai/sales/suggest-reply` | membros | Gera uma resposta contextual para o WhatsApp |

`/api/ai/formalize` exige o módulo de atendimento habilitado e aplica rate limit de 20 req/min por
IP. `/api/ai/sales/analyze` e `/api/ai/sales/suggest-reply` exigem o módulo `crm` (e o módulo
`attendance` quando uma conversa é informada) e aplicam, respectivamente, 10 e 15 req/min por IP.
`/api/ai/test` aplica 8 req/min. O backend também evita chamadas concorrentes do mesmo usuário.

## Copiloto comercial (Fase 1)

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

A análise é mantida apenas no estado do painel (sem persistência nesta fase). O painel é reiniciado
quando a oportunidade ou a conversa muda, evitando misturar contextos. A análise é marcada como
desatualizada quando chega uma mensagem mais recente (`latestMessageId`) ou quando `lead.updatedAt`
muda; nesse caso o usuário precisa acionar **Reanalisar**.

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
prioridade; quando o limite é atingido, `historyTruncated` é verdadeiro. Mensagens sem texto (mídia,
áudio, documento, imagem) entram apenas como tipo + indicação de que o conteúdo não foi transcrito;
o modelo é instruído a não presumir que compreendeu essas mídias. O backend não aceita histórico
arbitrário enviado pelo frontend.

Resposta estruturada da análise:

```json
{
  "summary": "...",
  "need": "...",
  "knownInformation": ["..."],
  "pendingInformation": ["..."],
  "nextQuestion": "...",
  "suggestedReply": "...",
  "rationale": "...",
  "provider": "OPENAI",
  "model": "gpt-6-luna",
  "generatedAt": "2026-10-21T12:00:00.000Z",
  "promptVersion": "sales-copilot-v1",
  "context": {
    "leadId": "...",
    "conversationId": "...",
    "messageCount": 12,
    "latestMessageId": "...",
    "latestMessageAt": "...",
    "leadUpdatedAt": "...",
    "historyTruncated": false,
    "mediaWithoutText": 0
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

### Persistência

Não há migration nesta fase. A decisão evita um sistema de memória/histórico de IA prematuro e
mantém a análise no cliente. A consequência é que a análise não é compartilhada entre usuários nem
sobrevive ao recarregamento da página; o painel oferece **Reanalisar** quando necessário.

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
- Frontend: `message-composer.test.tsx` (visibilidade, formalização sem envio, undo, falha e
  inserção de sugestão sem envio), `ai-settings-tab.test.tsx` (formulário e credenciais),
  `sales-copilot-panel.test.tsx` (configuração, análise, atualização, sugestão, erro, histórico
  ausente e troca de conversa) e `lead-detail-sheet.test.tsx` (integração do painel).
- Copiloto: unitários de prompt/parser em `backend/test/unit/ai/`; integração em
  `backend/test/integration/sales-copilot.integration-spec.ts` (contexto real, isolamento por
  tenant, conversa de outro contato, IA desativada, timeout/erros, limite de histórico, resposta
  inválida, injeção de instruções e geração sem envio).
