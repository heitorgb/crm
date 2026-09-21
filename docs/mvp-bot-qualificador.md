# MVP — Bot qualificador (WhatsApp)

> Status: **Planejado**. Este documento registra o desenho e a ordem de implementação do fluxo
> mínimo do bot de qualificação. Nada aqui foi implementado; nenhum código de fase futura deve ser
> antecipado sem decisão explícita.

## 1. Objetivo

Qualificar leads automaticamente no primeiro atendimento via WhatsApp, sem clique manual, e entregar
os leads concluídos ao humano em um **digest diário** no horário/timezone configurados.

### Fluxo alvo

```text
Lead entra pelo WhatsApp
  → Evolution API
  → Webhook NestJS
  → Conversation + Message
  → LeadQualificationSession
  → QualificationEngine + IA
  → Bot faz a próxima pergunta → Lead responde (repete)
  → LeadAnalysis (QUALIFIED / DISQUALIFIED / NEEDS_HUMAN)
  → QUALIFIED_WAITING_DIGEST
  → Digest no horário configurado (janela)
  → humano assume os contatos
```

### Princípios

1. O bot é o primeiro atendimento e o principal mecanismo de qualificação.
2. A IA não depende de clique manual para iniciar a análise.
3. A IA é chamada durante a conversa para interpretar cada resposta e escolher a próxima pergunta.
4. Contexto, critérios, tom, dados necessários e regras de conclusão são **editáveis por tenant**.
5. O humano recebe os leads no fluxo normal **somente depois** da qualificação.
6. O repasse é agrupado em **digest diário** (horário/timezone do responsável/membership).
7. Não existe notificação individual por lead no fluxo normal.
8. Handoff antecipado é exceção: pedido explícito de humano, falha persistente ou exceção
   configurada.
9. Todo fluxo respeita isolamento multi-tenant (`AGENTS.md` §3 e `multi-tenancy.md`).

## 2. Lacunas em relação ao estado atual

| Necessidade do fluxo              | Estado hoje                                   | Bloqueia |
| --------------------------------- | --------------------------------------------- | -------- |
| Auth + membership → TenantContext | Planejado (`authentication.md`)               | Fases 3+ |
| Entidades CRM (Lead/Conversation/Message) | Planejado (`database.md`)             | Fase 2   |
| Integração Evolution API          | Futuro (`architecture.md`)                    | Fase 2   |
| Filas (BullMQ)                    | Planejado                                     | Fases 4+ |
| IA                                | Planejado                                     | Fase 4   |
| Digest agendado                   | Futuro                                        | Fase 6   |

Conclusão: o fluxo é maior que uma tarefa. Ele deve ser implementado em **fatias verticais**, cada
uma entregável e testável isoladamente, **sem antecipar** a seguinte.

## 3. Modelo de dados proposto

Todas as entidades abaixo pertencem a um tenant e carregam `tenantId` + índice. Nomes finais e
enums serão fixados na migration da respectiva fase (não criar campos especulativos).

### Identidade (existente)

`Tenant`, `User` (global), `TenantUser` (membership). Além disso, para o digest:

- `TenantUser.digestEnabled` (bool) — se o membro recebe digest.
- `TenantUser.digestTime` (time) — horário local no fuso abaixo.
- `TenantUser.timezone` (IANA, ex.: `America/Sao_Paulo`) — fuso do membro.

> Decisão pendente: preferência no `TenantUser` vs. tabela `DigestPreference` própria caso surjam
> múltiplos canais. Começar no `TenantUser` é suficiente para o MVP.

### CRM / atendimento

- **`Lead`** — `tenantId`, `name?`, `phone` (E.164), `externalContactId` (id do contato no WhatsApp),
  `status` (ver estado), timestamps.
  - `@@unique([tenantId, phone])`.
- **`Conversation`** — `tenantId`, `leadId`, `channel` (`WHATSAPP`), `status`
  (`OPEN`/`CLOSED`), `lastMessageAt`.
- **`Message`** — `tenantId`, `conversationId`, `direction` (`INBOUND`/`OUTBOUND`), `type`,
  `content`, `externalMessageId` (id na Evolution), `rawPayload` (json), `occurredAt`.
  - `@@unique([tenantId, externalMessageId])` — base da idempotência do webhook.

### Qualificação

- **`QualificationConfig`** — versionável e por tenant: `criteria`, `tone`, `requiredFields` (json),
  `completionRules` (json), `handoffRules` (json), `isActive`, `version`.
  - Só uma config ativa por tenant por vez; sessões guardam a `configId` usada.
- **`LeadQualificationSession`** — `tenantId`, `leadId`, `conversationId`, `configId`, `status`
  (`ACTIVE`/`COMPLETED`/`ABORTED`/`NEEDS_HUMAN`), `collectedData` (json), `turnCount`, `startedAt`,
  `completedAt`.
- **`LeadAnalysis`** — `tenantId`, `sessionId`, `leadId`, `outcome`
  (`QUALIFIED`/`DISQUALIFIED`/`NEEDS_HUMAN`), `score?`, `summary`, `reasons`, `missingData` (json),
  `createdAt`.
- **`AiInteraction`** (observabilidade/custo) — `tenantId`, `sessionId?`, `purpose`, `model`,
  `inputSummary`, `outputSummary`, `tokensIn/Out?`, `latencyMs`, `status`, `errorCode?`.
  - Nunca persistir secrets; evitar armazenar PII além do necessário.

### Entrega / digest

- **`DigestRun`** — `tenantId`, `membershipId`, `windowStart`, `windowEnd`, `status`
  (`PENDING`/`SENT`/`FAILED`), `sentAt`, `leadCount`.
  - `@@unique([membershipId, windowStart])` — idempotência do agendamento.

### Estados do lead (máquina de estados)

```text
NEW
  → QUALIFYING
      → QUALIFIED_WAITING_DIGEST
          → ASSIGNED (após digest entregue)
      → DISQUALIFIED
      → NEEDS_HUMAN
```

`Lead.status` governa o ciclo; `LeadAnalysis.outcome` registra o resultado da análise. O digest
seleciona leads em `QUALIFIED_WAITING_DIGEST` dentro da janela.

## 4. Ingestão do webhook (Evolution API)

- Endpoint **público** (sem JWT) em `POST /api/webhooks/evolution`.
- **O tenant não vem do payload.** A Evolution envia o identificador da instância; resolve-se o
  tenant por um mapeamento `tenantId ↔ instanceId` (campo/tabela de configuração de canal). Isso
  respeita a regra de nunca confiar em `tenantId` do cliente.
- Validar assinatura/segredo do webhook no header antes de processar.
- Persistir `Message` com idempotência por `externalMessageId`; reprocessamento não duplica.
- Responder `2xx` rápido e processar de forma assíncrona (fila) para não travar a Evolution.
- Reestabelecer contexto em jobs: `tenantContextService.run({ tenant }, fn)` ou escopo explícito por
  `tenantId` no worker.

## 5. Motor de qualificação + IA

- **Provider de IA atrás de uma interface** (`AiProvider`) para permitir troca de fornecedor;
  adapter concreto escolhido na fase 4 (decisão pendente no §9).
- Entrada do prompt: config do tenant (critérios, tom, dados necessários, regras de conclusão) +
  histórico relevante da conversa + `collectedData` atual.
- Saída estruturada (JSON/tool call) contendo:
  1. `interpretation` da última resposta;
  2. campos coletados/atualizados;
  3. `nextQuestion` (ou sinal de conclusão);
  4. `completion` (se já há contexto suficiente) e eventual `outcome` provisório.
- **Regras de conclusão** (config por tenant, com defaults do sistema): todos os `requiredFields`
  preenchidos; nº máximo de turnos; timeout de inatividade; pedido explícito de humano; falha
  persistente do provedor.
- Toda chamada gera `AiInteraction`. Falhas transitórias têm retry com backoff; após N falhas
  consecutivas (configurável) → `NEEDS_HUMAN` (handoff antecipado).
- A resposta do bot é enviada pela Evolution API e persistida como `Message` `OUTBOUND`.

## 6. Digest

- Job diário por membership, no `digestTime` + `timezone` do responsável.
- Seleciona `Lead` em `QUALIFIED_WAITING_DIGEST` cujo `LeadAnalysis.createdAt` caiu na janela desde o
  último digest bem-sucedido.
- Agrupa em uma única mensagem/entregável; cria `DigestRun` para idempotência e auditoria.
- Ao entregar, os leads passam a `ASSIGNED`.
- Sem notificação individual no fluxo normal.
- Decisão pendente: canal do digest (WhatsApp do responsável vs. in-app) e definição de "responsável"
  quando há múltiplos membros.

## 7. Multi-tenancy e segurança

- Toda query de negócio escopada por `tenantId`; `requireContext()` nos endpoints autenticados.
- Endpoint de webhook resolve tenant por instância + valida assinatura (não confia no payload).
- Jobs e digest carregam `tenantId`/`membershipId` explícitos e reestabelecem contexto.
- Cache (quando existir) com namespace `tenant:{tenantId}:...`.
- Nunca logar tokens, API keys da Evolution/IA, nem conteúdo sensível além do necessário.
- Testes de isolamento: um tenant nunca lê/escreve dados de outro (webhook, sessão, digest).

## 8. Plano incremental

Cada fase é uma entrega independente, com migration própria, testes e validação (`lint`, `typecheck`,
`test`, `test:e2e`, `build`).

| Fase | Entrega                                                                 | Depende de |
| ---- | ----------------------------------------------------------------------- | ---------- |
| 1    | **Auth + membership guard** preenchendo `TenantContext`; papéis base.  | —          |
| 2    | **Ingestão**: `Lead`/`Conversation`/`Message` + webhook Evolution (sem IA), idempotência, mapeamento instância↔tenant. | 1 |
| 3    | **QualificationConfig**: modelagem + CRUD autenticado (critérios, tom, campos, regras). | 1, 2 |
| 4    | **Motor + IA**: sessão, `AiProvider`, chamada por mensagem, próxima pergunta, envio via Evolution, `AiInteraction`. | 2, 3 |
| 5    | **Análise e handoff**: `LeadAnalysis`, outcomes, transições de estado, gatilhos de `NEEDS_HUMAN`. | 4          |
| 6    | **Digest**: preferências de horário/timezone, job agendado, `DigestRun`, entrega e `ASSIGNED`. | 5          |
| 7    | **Operação**: métricas, retries/dead-letter, tuning de prompts e observabilidade. | 6          |

Ordem de leitura sugerida: `authentication.md` → `database.md` → `multi-tenancy.md` antes das
fases 1–2.

## 9. Decisões pendentes (não implementar sem definir)

1. Provedor de IA e modelo (custo, latência, suporte a tool/JSON).
2. Canal de entrega do digest (WhatsApp do responsável vs. in-app) e regra de "responsável".
3. Scheduler do digest: BullMQ repeatable jobs vs. `@nestjs/schedule`.
4. Formato das regras de qualificação (JSON estruturado vs. texto de prompt versionado).
5. Estratégia de resposta quando o lead envia áudio/imagem (transcrição/visão no MVP?).
6. Papéis RBAC mínimos (quem edita config, quem recebe digest).
7. Retenção de `rawPayload`/`AiInteraction` e política de PII.

## 10. Fora de escopo do MVP

- Frontend React.
- Pipeline comercial, tarefas e automações.
- Progressão de deal / relatórios.
- Múltiplos canais além do WhatsApp.
- Notificação individual por lead.
