# OrderUp CRM

CRM multi-tenant para prestação de serviço (atendimento, pipeline comercial, tarefas e automações).

Este repositório está na **fase de fundação**: apenas a base técnica do backend existe. Nenhuma
funcionalidade de negócio (Customer, Lead, Pipeline, WhatsApp, IA etc.) foi implementada ainda.

## Documentação

- [AGENTS.md](./AGENTS.md) — regras obrigatórias para agentes de IA e desenvolvedores.
- [docs/architecture.md](./docs/architecture.md) — visão geral da arquitetura.
- [docs/database.md](./docs/database.md) — banco, modelagem e migrations.
- [docs/multi-tenancy.md](./docs/multi-tenancy.md) — isolamento entre tenants.
- [docs/authentication.md](./docs/authentication.md) — plano de autenticação/autorização.
- [docs/development.md](./docs/development.md) — como rodar, testar e validar.
- [docs/decisions/](./docs/decisions/) — decisões arquiteturais (ADRs).

## Estrutura

```text
.
├── AGENTS.md
├── README.md
├── docker-compose.yml        # Postgres + Redis (somente infra local)
├── docs/
└── backend/                  # API NestJS + Fastify
```

## Quickstart (backend)

```bash
docker compose up -d                 # sobe Postgres e Redis
cd backend
cp .env.example .env
npm install
npm run prisma:migrate               # aplica as migrations
npm run start:dev                    # http://localhost:3000/api/health
```

Detalhes em [docs/development.md](./docs/development.md).
