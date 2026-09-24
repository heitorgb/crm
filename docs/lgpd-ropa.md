# ROPA e RIPD — OrderUp CRM

> **Rascunho técnico.** Registro das Operações de Tratamento (ROPA) e Relatório de Impacto (RIPD)
> simplificado. Depende de revisão jurídica antes de produção.

## ROPA — Registro das Operações de Tratamento

### 1. Qualificação de Lead (bot + IA)

| Campo | Conteúdo |
| ----- | -------- |
| Finalidade | Pré-atendimento, coleta de contexto e qualificação de leads |
| Base legal | Execução de contrato / procedimentos preliminares (art. 7º, V) ou legítimo interesse (art. 7º, IX); consentimento quando exigido |
| Titulares | Leads (potenciais clientes) |
| Dados | Nome/telefone/e-mail, `collectedData`, `transcript`, `qualificationReasons`, `score`, `qualificationLevel` |
| Sub-processadores | Provedor de IA (`AI_PROVIDER`), Evolution API, hospedagem |
| Retenção | Ver `docs/lgpd-retencao.md` |
| Segurança | Isolamento por tenant, minimização por whitelist, handoff humano em dados sensíveis, criptografia de credenciais, logs redigidos |

### 2. Atendimento humano (WhatsApp)

| Campo | Conteúdo |
| ----- | -------- |
| Finalidade | Continuidade do atendimento por pessoa do time |
| Base legal | Execução de contrato / legítimo interesse |
| Titulares | Leads/clientes |
| Dados | Mensagens, identificadores de contato, estado da conversa, tickets |
| Sub-processadores | Evolution API, hospedagem |
| Retenção | Conversas/mensagens: ver `docs/lgpd-retencao.md` |
| Segurança | Isolamento por tenant, takeover explícito (bot para de responder), logs redigidos |

### 3. Digest de leads qualificados

| Campo | Conteúdo |
| ----- | -------- |
| Finalidade | Entregar leads qualificados em lote ao responsável |
| Base legal | Execução de contrato / legítimo interesse |
| Titulares | Leads; usuários do tenant (responsáveis) |
| Dados | Resumo da análise, score, nível, próxima ação; preferência de horário/timezone |
| Sub-processadores | Evolution API (quando canal WhatsApp), hospedagem |
| Retenção | `LeadDigestDelivery` conforme `docs/lgpd-retencao.md` |
| Segurança | Destino explícito do responsável (nunca o número do Lead), idempotência por janela |

### 4. Autenticação de usuário

| Campo | Conteúdo |
| ----- | -------- |
| Finalidade | Autenticar e autorizar acesso ao CRM |
| Base legal | Execução de contrato |
| Titulares | Usuários do tenant |
| Dados | E-mail, hash de senha (Argon2id), role, tokens de refresh (hash) |
| Sub-processadores | Hospedagem |
| Retenção | Tokens até expiração/revogação; cadastro enquanto ativo |
| Segurança | Sem senha em claro, tokens opacos com rotação, cookie HttpOnly, RBAC, rate limit |

## RIPD simplificado — perfis com `dataSensitivityLevel = high`

Quando um tenant usa perfil de qualificação `high`, o tratamento pode envolver dados de maior risco
(ou decisões automatizadas com impacto). Riscos e medidas:

| Risco | Medida implementada |
| ----- | ------------------- |
| Coleta de dado sensível por texto livre | Termos sensíveis detectados → `NEEDS_HUMAN`; conteúdo sensível **nunca** estruturado em `collectedData` |
| Decisão automatizada negativa | Desqualificação automática **bloqueada** para `high`; vira `NEEDS_HUMAN` |
| Falta de explicação | `qualificationReasons` objetivos + `disqualifiedMessage` com motivo e opção de contestar |
| Direito de revisão (art. 20) | `reviewRequested` + handoff imediato + registro de desfecho (`UPHELD`/`REVERSED`) |
| Excesso de retenção | Expurgo/anonimização por tenant (`docs/lgpd-retencao.md`) |
| Vazamento entre tenants | Isolamento por `tenantId` em queries, jobs, cache e realtime |

Recomenda-se RIPD específico por tenant `high` quando houver dado sensível real (saúde etc.),
envolvendo o Encarregado do tenant.
