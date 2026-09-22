# LGPD & Compliance — OrderUp CRM

> Status: **Fundação implementada** (Prompt 09). DPO, direitos do titular, revisão de decisão
> automatizada (art. 20), retenção/descarte, minimização e documentação de conformidade.

Documentos relacionados:

- [`lgpd-retencao.md`](./lgpd-retencao.md) — Política de Retenção e Descarte.
- [`lgpd-transferencia-internacional.md`](./lgpd-transferencia-internacional.md) — transferência internacional.
- [`lgpd-ropa.md`](./lgpd-ropa.md) — ROPA e RIPD simplificado.
- [`incident-response.md`](./incident-response.md) — runbook de incidentes.
- Adendos de LGPD em [`qualification-bot.md`](./qualification-bot.md), [`sales.md`](./sales.md) e
  [`attendance.md`](./attendance.md).

> Os documentos jurídicos (Termos de Uso, Política de Privacidade e DPA) e os prazos definitivos
> dependem de revisão de advogado(a). Ver "Pendências jurídicas" no relatório final.

## Encarregado (DPO) e canal do titular

- Configuração por tenant: `dpoName`, `dpoEmail` (`PUT /api/compliance/settings/dpo`, OWNER/ADMIN).
- Consulta pública (para responder a titulares): `GET /api/compliance/tenants/:tenantId/dpo`
  (`@Public`). Retorna o Encarregado do tenant ou, no fallback, o canal do Encarregado da OrderUp,
  deixando claro que **o tenant é o Controlador** e que a OrderUp é Operadora.

## Direitos do titular

Todos os endpoints exigem autenticação + membership e são restritos a `OWNER`/`ADMIN`. Cada operação
gera um registro em `DataSubjectRequest` (auditoria) e respeita o isolamento por tenant.

| Direito | Endpoint |
| ------- | -------- |
| Acesso | `GET /api/compliance/subjects/leads/:leadId/access` |
| Portabilidade (JSON) | `GET /api/compliance/subjects/leads/:leadId/export` |
| Correção | `POST /api/compliance/subjects/leads/:leadId/rectify` |
| Eliminação (anonimização) | `POST /api/compliance/subjects/leads/:leadId/erase` (`{ confirm: true }`) |
| Revogação de consentimento | `POST /api/compliance/subjects/leads/:leadId/consent-revocation` |
| Oposição | `POST /api/compliance/subjects/leads/:leadId/opposition` |
| Solicitações (histórico) | `GET /api/compliance/requests`, `GET /api/compliance/requests/:id` |

A eliminação **anonimiza** em cascata `Lead` → `Conversation`/`Message` → `LeadQualificationSession`
→ `LeadAnalysis` → `Task`/`Deal`. Registros sob **legal hold** (`legalHold`) retornam
`409 LEGAL_HOLD_ACTIVE`.

## Revisão de decisão automatizada (art. 20)

- `POST /api/compliance/reviews/sessions/:sessionId/request` — marca `reviewRequested`, coloca a
  sessão em `NEEDS_HUMAN` e cria **handoff imediato** (ticket), sem esperar o digest.
- `GET /api/compliance/reviews/sessions/:sessionId` — contexto para o atendente, incluindo
  `qualificationReasons` (critérios objetivos) da análise.
- `POST /api/compliance/reviews/sessions/:sessionId/resolve` — registra desfecho
  (`UPHELD`/`REVERSED`) e notas para auditoria; `REVERSED` devolve o Lead para
  `QUALIFIED_WAITING_DIGEST`.

O fluxo reaproveita o handoff já existente (Prompt 07), sem motor de apelação separado.

## Retenção e descarte

Job BullMQ `compliance.retention.expunge` (tick diário), com `tenantId` explícito, anonimização
preferida, `legal hold` respeitado e logs apenas com contagens. Prazos configuráveis por tenant
(`PUT /api/compliance/settings/retention`). Ver [`lgpd-retencao.md`](./lgpd-retencao.md).

## Minimização e dados sensíveis

- `collectedData` aceita **apenas** chaves de `requiredInformation` do perfil ativo (whitelist no
  `QualificationEngine`).
- Categorias sensíveis mencionadas espontaneamente **nunca** são estruturadas; o motor sinaliza e
  converte para `NEEDS_HUMAN`.
- Perfil `dataSensitivityLevel = high` **nunca** desqualifica automaticamente (vira `NEEDS_HUMAN`).
- Perfil ativo sempre possui `privacyNoticeText` (fallback padrão do sistema garante o invariante);
  a primeira interação envia o aviso, e a `disqualifiedMessage` cita o motivo objetivo + opção de
  contestar.

## Documentos legais (Termos / Política / DPA)

- Versões vigentes por ambiente: `LEGAL_TERMS_VERSION`, `LEGAL_DPA_VERSION`.
- Aceite registrado por tenant: `POST /api/compliance/settings/legal-acceptance` grava
  `termsVersion/termsAcceptedAt` e `dpaVersion/dpaAcceptedAt`.
- `GET /api/compliance/settings` expõe DPO, retenção e o estado do aceite.

> Pendente de produto: exibir os links (rodapé/onboarding) e a superfície de aceite no frontend.

## Variáveis de ambiente

```text
LEGAL_TERMS_VERSION / LEGAL_DPA_VERSION
ORDERUP_DPO_NAME / ORDERUP_DPO_EMAIL   # fallback do Encarregado da OrderUp
```
