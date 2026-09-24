# Hardening & Production Readiness — OrderUp CRM

> Relatório da auditoria técnica (Prompt 08). Classificação usada apenas para orientar correções:
> **Critical / High / Medium / Low**. Nenhuma funcionalidade nova foi adicionada.

## Escopo e método

Revisão de código e configuração de: autenticação/autorização, multi-tenancy, banco, API, filas,
Socket.IO, storage, observabilidade, Docker e CI. Correções aplicadas quando o problema era
**Critical/High** ou de baixo risco e alto ganho; o restante ficou documentado como pendência.

## Resumo

| Área             | Críticos | Altos | Médios | Baixos |
| ---------------- | -------- | ----- | ------ | ------ |
| Segurança        | 0        | 3     | 2      | 1      |
| Performance      | 0        | 0     | 0      | 1      |
| Banco de dados   | 0        | 0     | 0      | 1      |
| Multi-tenancy    | 0        | 0     | 0      | 0      |
| API              | 0        | 0     | 1      | 1      |
| Filas            | 0        | 1     | 0      | 0      |
| Infraestrutura   | 0        | 0     | 1      | 1      |

Nenhum problema **Critical** encontrado.

## Correções aplicadas

### [High] Autenticação — semântica de membership inativa

Usuário com apenas membership inativa, ao informar `tenantId`, recebia `NO_ACTIVE_MEMBERSHIP`; deveria
receber `TENANT_ACCESS_DENIED` (ver `docs/authentication.md`). Corrigido em
`AuthService.selectMembership`: quando um tenant é solicitado, valida aquele tenant primeiro.
Isso também resolve o teste de integração que falhava desde o Prompt 03 (a suíte e2e ficou 131/131).

### [High] Rate limiting em endpoints sensíveis

`POST /auth/login`, `POST /auth/refresh` e `POST /webhooks/evolution` não tinham proteção contra
força bruta/abuso. Adicionado `RateLimitGuard` (janela deslizante em memória, chave por IP real do
socket — sem `X-Forwarded-For` spoofável):

- login: 10 req/min por IP; refresh: 30 req/min; webhook: 300 req/min.
- `RATE_LIMIT_ENABLED` (default `true`); desabilitado nos testes.
- Resposta `429 RATE_LIMITED` via filtro global.

Limitação conhecida: o contador é em memória (por instância). Para múltiplas instâncias, migrar para
Redis (pendência abaixo).

### [High] Filas — retry, backoff e dead-letter

`BullmqJobQueue.enqueue` usava `attempts` padrão (1), sem retry. Agora os jobs usam
`attempts: 3`, `backoff` exponencial (5s), `removeOnComplete` e `removeOnFail: 200` (retenção de
falhas para inspeção/dead-letter). Worker com `concurrency: 5` e logs de `completed`/`failed`.
Isso torna o reenvio de mensagens e o digest resilientes a falhas transitórias.

### [High] Configuração de produção

`env.validation.ts` agora falha no boot quando:

- `EVOLUTION_API_BASE_URL` definido sem `EVOLUTION_API_KEY` ou `EVOLUTION_WEBHOOK_SECRET`
  (webhook público ficaria aberto);
- `NODE_ENV=production` com WhatsApp habilitado sem `CREDENTIALS_ENCRYPTION_KEY`;
- `STORAGE_PROVIDER` definido sem endpoint/bucket/access/secret.

### [Medium/High] Logs — segredos

Redação ampliada (`req.body.password`, `req.body.refreshToken`, `*.tokenHash`, `*.credentials`,
`*.credentialsEncrypted`, `*.webhookSecret`, `*.secretKey`, etc.) e **query string removida do
`req.url`** dos logs — evita vazar o `?token=` do webhook. Headers sensíveis já eram redigidos.

### [Medium] Webhook — comparação de segredo em tempo constante

Troca de `!==` por `timingSafeEqual`, evitando timing attack na validação do segredo.

### [Medium] Docker

`Dockerfile` revisado: runtime roda como usuário **não-root** (`node`), `HEALTHCHECK` no
`/api/health`, cópia do Prisma Client gerado (`node_modules/.prisma` e `@prisma/client`) e build
multi-stage com dependências de produção. `.dockerignore` mantém `.env` fora da imagem.

### [High] Testes de regressão

- `test/unit/config/env.validation.spec.ts`: +4 casos (Evolution, produção, storage, rate limit).
- `test/unit/common/rate-limit.guard.spec.ts`: serviço e guard (limite, janela, isolamento por IP,
  no-op quando desabilitado).
- E2E: corrigido o caso de membership inativa.

## Multi-tenancy — auditoria

Todas as entidades de negócio possuem `tenantId` e todas as queries/mutações usam
`requireContext()` com filtro composto (`{ id, tenantId }`). Verificações pontuais:

- **Cache:** não há cache de dados de tenant (Redis usado só por BullMQ). Ao introduzir, usar
  `tenant:{tenantId}:...` (já previsto nos docs).
- **Jobs:** todos carregam `tenantId`; o processamento reestabelece o `TenantContext` no início.
- **Websocket:** rooms `tenant:{tenantId}`, `tenant:{tenantId}:user:{userId}`,
  `tenant:{tenantId}:conversation:{id}`; emissão sempre por room (nunca `server.emit`).
- **Integração WhatsApp:** tenant resolvido por `instanceName` validado; nunca do payload.
- **Testes de isolamento:** CRM core, vendas, qualificação e WhatsApp cobrem A≠B (leitura, escrita e
  movimentação de Deal entre tenants).

Sem achados de tenant escape.

## Performance e banco

- Paginação com `perPage` máximo 100 em todas as listagens; nenhum endpoint devolve “tudo”.
- Sem `select *` relevante: services usam `select`/`include` específicos.
- Sem N+1 por linha. O quadro Kanban faz uma query por etapa (bounded), não por negócio.
- Índices cobrem as consultas reais (tenant+status, tenant+createdAt, chaves únicas de idempotência).
- `deprecation warning` do driver `pg` (client.query concorrente) observado nos logs de teste — não
  afeta produção nem os fluxos; acompanhar em atualização futura do Prisma/pg (Low).

## API

- DTOs com `class-validator`, `whitelist` e `forbidNonWhitelisted` globais — sem mass assignment.
- Status HTTP coerentes (201/204/404/409/422).
- Erros padronizados e sem stack trace.
- **Pendente (Medium):** documentação OpenAPI/Swagger não existe. Adicionar quando virar requisito de
  API pública.
- Mutações de CRM permitidas a qualquer membro autenticado (deleção restrita a OWNER/ADMIN) — decisão
  de produto atual (Low); revisar quando houver RBAC granular.

## Pendências (não corrigidas neste prompt)

| Severidade | Item | Observação |
| ---------- | ---- | ---------- |
| Medium | Rate limit distribuído | Hoje em memória; migrar para Redis com múltiplas instâncias. |
| Medium | Socket.IO Redis adapter | Necessário para broadcast entre múltiplas instâncias. |
| Medium | OpenAPI/Swagger | Documentação interativa da API. |
| Low | CSRF explícito | Mitigado por `SameSite` + `HttpOnly` + JSON; token CSRF não implementado. |
| Low | Housekeeping de refresh tokens | Rotina de expurgo de tokens expirados. |
| Low | `Activity` fora da transação | Registro de histórico não é transacional com a mutação principal. |
| Low | Storage | Sem endpoint de upload ainda; validação MIME/tamanho/URL assinada a implementar junto. |

## Testes executados

| Comando | Resultado |
| ------- | --------- |
| `npm run lint` (backend) | ok |
| `npm run typecheck` (backend) | ok |
| `npm test` (backend) | **87/87** |
| `npm run test:e2e` (backend) | **131/131** |
| `npm run build` (backend) | ok |
| `npm run lint` / `typecheck` / `build` (frontend) | ok (2 warnings pré-existentes de fast-refresh) |
| Rate limit (verificação manual) | 10×401 → 429 |

## Próximo passo recomendado

Rate limit e Socket.IO com Redis (preparação para múltiplas instâncias), seguido de OpenAPI. Essas
pendências não bloqueiam as próximas fases (automações, IA, relatórios).
