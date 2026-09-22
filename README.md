# OrderUp CRM

CRM multi-tenant para prestação de serviço (atendimento, pipeline comercial, tarefas e automações).

Este repositório está na **fase de fundação**: backend (auth, multi-tenancy, fundação técnica) e
frontend (design system, layout e telas iniciais) já existem. Módulos de negócio de CRM (Customer,
Lead, Pipeline, WhatsApp, IA) ainda não foram implementados.

## Documentação

- [AGENTS.md](./AGENTS.md) — regras obrigatórias para agentes de IA e desenvolvedores.
- [docs/architecture.md](./docs/architecture.md) — visão geral da arquitetura.
- [docs/database.md](./docs/database.md) — banco, modelagem e migrations.
- [docs/multi-tenancy.md](./docs/multi-tenancy.md) — isolamento entre tenants.
- [docs/authentication.md](./docs/authentication.md) — plano de autenticação/autorização.
- [docs/ai.md](./docs/ai.md) — fundação de configuração de IA.
- [docs/qualification-bot.md](./docs/qualification-bot.md) — fundação e limites do bot de qualificação.
- [docs/development.md](./docs/development.md) — como rodar, testar e validar.
- [docs/hardening.md](./docs/hardening.md) — auditoria de segurança/performance e pendências.
- [docs/lgpd.md](./docs/lgpd.md) — LGPD: DPO, direitos do titular, retenção e conformidade.
- [docs/frontend.md](./docs/frontend.md) — fundação do frontend e design system.
- [docs/mvp-bot-qualificador.md](./docs/mvp-bot-qualificador.md) — plano incremental do bot qualificador.
- [docs/decisions/](./docs/decisions/) — decisões arquiteturais (ADRs).

## Estrutura

```text
.
├── AGENTS.md
├── README.md
├── docker-compose.yml        # Postgres + Redis (somente infra local)
├── docs/
├── backend/                  # API NestJS + Fastify
└── frontend/                 # React + Vite + Tailwind + shadcn/ui
```

## Quickstart (backend)

```bash
docker compose up -d                 # sobe Postgres e Redis
cd backend
cp .env.example .env
npm install
npm run prisma:migrate               # aplica as migrations
npm run prisma:seed                  # cria usuário de dev (admin@orderup.local / admin12345)
npm run start:dev                    # http://localhost:3000/api/health
```

Detalhes em [docs/development.md](./docs/development.md).

## Quickstart (frontend)

```bash
cd frontend
cp .env.example .env                 # opcional
npm install
npm run dev                          # http://localhost:5173 (proxy de /api para :3000)
```

Detalhes em [docs/frontend.md](./docs/frontend.md).
