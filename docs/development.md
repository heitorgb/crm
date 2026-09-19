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

Para derrubar (mantendo volumes): `docker compose down`. Para remover volumes:
`docker compose down -v`.

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

| Variável       | Obrigatória | Default       |
| -------------- | ----------- | ------------- |
| `NODE_ENV`     | não         | `development` |
| `PORT`         | não         | `3000`        |
| `API_PREFIX`   | não         | `api`         |
| `DATABASE_URL` | sim         | —             |
| `REDIS_URL`    | sim         | —             |
| `LOG_LEVEL`    | não         | `info`        |

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
