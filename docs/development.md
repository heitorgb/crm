# Desenvolvimento — OrderUp CRM

## Pré-requisitos

- Node.js 24+ e npm 11+
- Docker + Docker Compose

## Infra local

Na raiz do repositório:

```bash
docker compose up -d
docker compose ps
```

Sobe apenas o necessário para a fundação:

- PostgreSQL 16 em `localhost:5432`
- Redis 7 em `localhost:6379`

Comandos úteis (na raiz):

| Ação                         | Comando                                        |
| ---------------------------- | ---------------------------------------------- |
| Subir                        | `docker compose up -d`                          |
| Parar (mantendo volumes)     | `docker compose down`                           |
| Ver logs                     | `docker compose logs -f`                        |
| Logs de um serviço           | `docker compose logs -f postgres`               |
| Resetar ambiente (apaga dados) | `docker compose down -v`                      |
| Aplicar migrations           | `cd backend && npm run prisma:migrate`          |
| Aplicar migrations (CI/prod) | `cd backend && npm run prisma:deploy`           |

## Backend

Todos os comandos rodam em `backend/`:

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:generate     # gera o Prisma Client
npm run prisma:migrate      # aplica as migrations
npm run start:dev           # watch mode: http://localhost:3000/api/health
```

### Variáveis de ambiente

Validadas na inicialização (`src/config/`). O boot falha com mensagem clara se algo estiver
ausente/ inválido. Nunca commitar `.env`.

| Variável        | Obrigatória                   | Default                  |
| --------------- | ----------------------------- | ------------------------ |
| `NODE_ENV`      | não                           | `development`            |
| `PORT`          | não                           | `3000`                   |
| `API_PREFIX`    | não                           | `api`                    |
| `CORS_ORIGINS`  | sim em produção               | `http://localhost:5173`  |
| `DATABASE_URL`  | sim                           | —                        |
| `REDIS_URL`     | sim                           | —                        |
| `JWT_ACCESS_SECRET` | sim                       | —                        |
| `JWT_ACCESS_TTL_SECONDS` | não                   | `900`                    |
| `REFRESH_TOKEN_TTL_DAYS` | não                   | `30`                     |
| `AUTH_COOKIE_SECURE` | não                      | `true` em produção       |
| `AUTH_COOKIE_SAMESITE` | não                    | `lax`                    |
| `AUTH_COOKIE_DOMAIN` | não                      | —                        |
| `LOG_LEVEL`     | não                           | `info`                   |
| `AI_PROVIDER`   | não                           | —                        |
| `AI_MODEL`      | quando `AI_PROVIDER`          | —                        |
| `AI_API_KEY`    | quando `AI_PROVIDER`          | —                        |
| `AI_BASE_URL`   | não                           | —                        |
| `AI_TIMEOUT_MS` | não                           | `30000`                  |
| `AI_MAX_RETRIES`| não                           | `2`                      |

`CORS_ORIGINS` é uma lista separada por vírgulas. `*` não é aceito em produção. As variáveis de IA
são apenas configuração nesta fase (ver [`ai.md`](./ai.md)); nenhuma chamada é feita.

## Scripts

| Script                  | Descrição                                            |
| ----------------------- | ---------------------------------------------------- |
| `npm run start:dev`     | API em watch mode                                    |
| `npm run build`         | `prisma generate` + build (`nest build`)             |
| `npm run start:prod`    | executa `dist/main`                                  |
| `npm run lint`          | ESLint                                               |
| `npm run lint:fix`      | ESLint com correção automática                       |
| `npm run format`        | Prettier `--write`                                   |
| `npm run format:check`  | Prettier `--check`                                   |
| `npm run typecheck`     | `tsc --noEmit`                                       |
| `npm test`              | testes unitários (não exigem banco)                  |
| `npm run test:e2e`      | testes e2e/integração (exigem Postgres + Redis)      |
| `npm run prisma:migrate`| cria/aplica migrations (dev)                         |
| `npm run prisma:deploy` | aplica migrations (CI/produção)                      |

## Testes

Runner: **Vitest** (o projeto é ESM; ver `docs/architecture.md`).

- **Unitários** (`src/**/*.spec.ts`, `test/unit/**/*.spec.ts`): config e tenant context. Não exigem
  infra. Config: `vitest.config.ts`.
- **Integração/e2e** (`test/integration/**/*.integration-spec.ts`, `test/e2e/**/*.e2e-spec.ts`):
  exigem Postgres e Redis. Config: `vitest.config.e2e.ts`.

```bash
npm test
npm run test:e2e
```

## Validação completa (antes de concluir uma tarefa)

```bash
cd backend
npm run lint
npm run typecheck
npm test
npm run test:e2e    # com a infra no ar
npm run build
```

## CI

`.github/workflows/ci.yml` roda em push/PR: instala dependências, gera o Prisma Client, aplica
migrations, e executa `lint`, `typecheck`, `test`, `test:e2e` e `build`. Não há etapa de deploy.

## Estrutura de pastas

```text
backend/
├── prisma/                 # schema e migrations
├── src/
│   ├── common/errors/      # filtro global e AppException
│   ├── common/tenant-context/
│   ├── config/
│   ├── infrastructure/prisma/
│   ├── infrastructure/redis/
│   ├── modules/health/
│   ├── app.module.ts
│   └── main.ts
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── prisma7.config.ts
├── eslint.config.mjs
└── ...
```

## Convenções

- O projeto é **ESM** (`"type": "module"`). Imports relativos usam extensão `.js`.
- TypeScript `strict`; evitar `any`.
- Sem comentários no código, exceto para decisões não óbvias.
- Controllers finos; regra de negócio em services.
- Não implementar fases futuras antecipadamente.

## Frontend

O frontend fica em `frontend/` (React + Vite + Tailwind + shadcn/ui). Detalhes completos em
[`frontend.md`](./frontend.md).

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxy de /api para :3000)
npm run lint
npm run typecheck
npm run build
```
