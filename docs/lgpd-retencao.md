# Política de Retenção e Descarte de Dados — OrderUp CRM

> **Rascunho técnico.** Os prazos abaixo são referências iniciais e **dependem de revisão jurídica**
> antes de produção. O tenant é o Controlador; a OrderUp atua como Operadora.

## Princípios

1. **Minimização:** manter apenas o necessário para a finalidade.
2. **Anonimização preferida à exclusão física** quando há valor analítico agregado.
3. **Legal hold:** registros sob obrigação legal/processual ativa **não** são expurgados.
4. **Isolamento por tenant:** o job roda sempre com `tenantId` explícito.
5. **Rastreável:** cada execução registra contagens e tenant, **nunca** o conteúdo eliminado.

## Prazos (iniciais)

| Dado | Entidade | Prazo | Ação |
| ---- | -------- | ----- | ---- |
| Dados cadastrais do Lead | `Lead` | 730 dias (`retentionLeadDays`) sem interação | Anonimização (nome/telefone/e-mail) |
| Conversa encerrada | `Conversation` | 365 dias (`retentionConversationDays`) após encerramento | Anonimização do contato/subject |
| Mensagens | `Message` | 365 dias após encerramento da conversa | Anonimização do conteúdo e metadados |
| Sessão de qualificação | `LeadQualificationSession` | 365 dias | `collectedData`/`transcript` limpos |
| Análise | `LeadAnalysis` | 365 dias | Conteúdo textual anonimizado; score/nível mantidos para métrica |
| Tarefas/Negócios do Lead | `Task`/`Deal` | 730 dias | Título/descrição anonimizados |
| Registro de direitos (ROPA de solicitações) | `DataSubjectRequest` | 5 anos | Guarda para comprovação |
| Histórico comercial | `Activity` | 5 anos | Guarda para auditoria |
| Eventos de webhook | `WebhookEvent` | 90 dias | Expurgo |
| Tokens de refresh | `RefreshToken` | TTL de emissão | Expurgo após expiração/revogação |

Os prazos são **configuráveis por tenant** (`retentionConversationDays`, `retentionLeadDays`) via
`PUT /api/compliance/settings/retention`.

## Como o expurgo é executado

- Job BullMQ `compliance.retention.expunge`, agendado diariamente por `compliance.retention.tick`.
- O tick enfileira **um job por tenant** com `{ tenantId }`; o processamento reestabelece o
  `TenantContext` (`TenantContextService.run`).
- Anonimização em transação: `Lead`, `Conversation`, `Message`, `LeadQualificationSession`,
  `LeadAnalysis`, `Task`, `Deal`.
- Idempotência: `Lead.anonymizedAt` marca o que já foi anonimizado.
- `legalHold = true` em `Lead`/`Conversation` suspende o expurgo daquele registro.
- Log: `Retention run tenant=... conversations=... messages=... leads=...` (sem conteúdo) + `Activity`
  `tenant.retention_expunged`.
- Execução manual/operacional: `POST /api/compliance/retention/run` (OWNER/ADMIN) ou
  `RetentionService.expunge(tenantId)`.

## Direito de eliminação do titular

Preferimos **anonimizar** (ver `docs/lgpd.md`). A eliminação física só é feita por decisão explícita
fora do fluxo automático, respeitando obrigações legais de guarda.
