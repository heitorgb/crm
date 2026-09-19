# AGENTS.md — OrderUp CRM

Este documento é a **principal referência para agentes de IA e desenvolvedores** trabalhando no
OrderUp CRM. Ele descreve o que já existe, o que está planejado e as regras obrigatórias do projeto.

Leia também `docs/` antes de implementar qualquer coisa. Em caso de conflito entre um pedido pontual
e este documento, **pare e peça esclarecimento** — não altere decisões arquiteturais silenciosamente.

---

## 1. Objetivo do projeto

CRM multi-tenant para prestação de serviço, com atendimento (WhatsApp), pipeline comercial,
tarefas e automações. O produto evolui em fases; **nada de fases futuras deve ser implementado
antecipadamente**.

Status atual (ver `docs/architecture.md` para detalhes):

- **Implementado:** fundação do backend (NestJS + Fastify, config validada, Prisma, Redis, logging,
  tratamento de erros, TenantContext, health check, testes e CI).
- **Planejado:** autenticação/autorização, módulos de CRM, multi-tenancy com RLS, filas, realtime, IA.
- **Futuro:** frontend (React + Vite), integrações (WhatsApp/Evolution API), dashboards, relatórios.

---

## 2. Arquitetura

- **Monólito modular** — um único deploy, com fronteiras claras entre módulos. Não usar
  microserviços nesta fase. Ver `docs/decisions/ADR-001-modular-monolith.md`.
- **NestJS** como framework de aplicação.
- **Fastify** como HTTP adapter (`@nestjs/platform-fastify`). Não usar Express.
- **Prisma** como ORM, com `@prisma/adapter-pg` (Prisma 7 exige driver adapter).
- **PostgreSQL** como banco relacional.
- **Redis** como infraestrutura para cache/filas/realtime (ainda sem uso funcional).
- **Docker / Docker Compose** para infraestrutura local.
- **TypeScript em modo `strict`** — obrigatório.
- Estrutura de pastas do backend:
  - `src/common/` — cross-cutting (erros, tenant context).
  - `src/config/` — carregamento e validação de ambiente.
  - `src/infrastructure/` — Prisma, Redis, integrações de infraestrutura.
  - `src/modules/` — módulos de negócio (um por domínio).
  - `src/app.module.ts`, `src/main.ts` — composição e bootstrap.

Regra: dependências apontam para dentro. Módulos de negócio não importam uns aos outros de forma
cíclica. Infraestrutura não contém regra de negócio.

---

## 3. Multi-tenancy (regras obrigatórias)

1. **Toda entidade pertencente a um tenant deve possuir `tenantId`.**
2. **Toda operação deve respeitar o tenant atual.** Nenhuma query de negócio roda sem escopo de tenant.
3. **Nunca confiar cegamente em `tenantId` enviado pelo cliente** (body, query, params ou header).
   O tenant é derivado do token verificado + validação de membership.
4. **Membership deve ser validada**: todo acesso exige um `TenantUser` ativo ligando `userId` e
   `tenantId`. Sem membership, sem acesso.
5. **Jobs assíncronos futuros devem carregar `tenantId`** de forma explícita e reestabelecer o
   `TenantContext` no início da execução (via `TenantContextService.run(...)`).
6. **Cache futuro deve ter namespace por tenant** (ex.: `tenant:{tenantId}:...`). Nunca reutilizar
   chave de cache entre tenants.
7. **Eventos realtime futuros devem respeitar o tenant** — salas/canais isolados por tenant.
8. **Testes devem garantir isolamento entre tenants** (um tenant nunca lê/escreve dados de outro).
9. PostgreSQL RLS é **defesa em profundidade**, não substitui o escopo na aplicação. Ver
   `docs/multi-tenancy.md`.

`User` é global (uma pessoa pode pertencer a vários tenants). O vínculo `User ↔ Tenant` é feito por
`TenantUser`, e `membershipId` corresponde ao `id` de `TenantUser`.

---

## 4. Código

- **TypeScript `strict`** sempre. Não reduzir o nível de strict para "resolver" um erro.
- O backend é **ESM** (`"type": "module"`, TypeScript `nodenext`). Imports relativos usam extensão
  `.js`.
- **Evitar `any`.** Se for inevitável, isolar, comentar o motivo e tipar o retorno o quanto antes.
- **Controllers finos** — apenas transporte HTTP (parse, chamada, resposta). Sem regra de negócio.
- **Regras de negócio em services/use cases**, não em controllers nem em entidades de banco.
- **Evitar abstrações prematuras.** Não criar repositórios genéricos, bases ou helpers "para o futuro".
- **Evitar duplicação**, mas preferir duplicação local a uma abstração errada.
- **Nomes claros**; evitar abreviações obscuras.
- **Funções pequenas quando fizer sentido** — coesão acima de tamanho arbitrário.
- **Dependências somente quando justificadas.** Toda dependência nova precisa de motivo explícito.
- **Não adicionar comentários** no código, exceto quando necessários para explicar uma decisão
  não óbvia (e nunca para descrever o óbvio).

---

## 5. Segurança

Nunca:

- expor secrets, chaves ou credenciais (em código, logs, respostas ou commits);
- logar `password`, `access token`, `refresh token`, API keys ou secrets;
- confiar em IDs externos sem verificar autorização/membership;
- retornar stack trace ao cliente em produção;
- ignorar o isolamento de tenant;
- desabilitar validação de ambiente para "fazer rodar".

Sempre:

- validar e tipar variáveis de ambiente na inicialização;
- usar o filtro global de exceções para respostas de erro padronizadas;
- tratar erros sem vazar detalhes internos.

---

## 6. Desenvolvimento incremental

**Nunca implementar fases futuras antecipadamente.** O ciclo obrigatório para cada tarefa é:

```text
analisar
→ planejar
→ implementar
→ testar
→ validar
→ documentar
```

Antes de alterar arquivos:

1. entender o problema;
2. verificar os arquivos existentes (nunca editar às cegas);
3. explicar brevemente a decisão;
4. implementar;
5. testar (`npm test`, e testes de integração quando tocar banco);
6. verificar TypeScript (`npm run typecheck`);
7. verificar lint (`npm run lint`);
8. verificar build (`npm run build`);
9. documentar se a decisão for relevante.

**Não modificar arquivos não relacionados à tarefa.**

---

## 7. Git

- **Não fazer commits automaticamente.** Commits são uma ação explícita do usuário.
- Não fazer `push`.
- Não alterar branches.
- Não apagar arquivos existentes sem necessidade; leia antes de modificar.
- Nunca commitar `.env`, secrets ou credenciais.

---

## 8. Comandos úteis

Todos os comandos de backend rodam dentro de `backend/`:

```bash
cd backend
npm install
docker compose -f ../docker-compose.yml up -d   # ou: docker compose up -d na raiz
cp .env.example .env
npm run prisma:migrate      # aplica/cria migrations em desenvolvimento
npm run start:dev           # sobe a API em watch mode
npm run lint
npm run typecheck
npm test                    # testes unitários
npm run test:e2e            # testes de integração/e2e (exige Postgres + Redis)
npm run build
```

---

## 9. Ao concluir uma tarefa

Ao terminar uma tarefa relevante, informe:

- **Análise** — pontos corretos, pontos ajustados, decisões futuras.
- **Arquivos criados** e **arquivos alterados** (listas completas).
- **Como executar** (infra, migrations, testes).
- **Validações** — lint, typecheck, testes, build (com resultado real).
- **Próximo passo** — apenas um próximo passo lógico, sem implementá-lo.
