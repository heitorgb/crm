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

Sobe o necessário para o CRM:

- PostgreSQL 16 em `localhost:5432`
- Redis 7 em `localhost:6379`

Para o WhatsApp, a **Evolution API** roda em um compose separado (opcional):

```bash
# junto com a infra do CRM (mesma rede)
docker compose -f docker-compose.yml -f docker-compose.evolution.yml up -d

# ou isolada
docker compose -f docker-compose.evolution.yml up -d
```

Sobe `evolution` (porta `8080`), `evolution-postgres` e `evolution-redis`, isolados dos serviços do
CRM. Ver a seção [Evolution API (WhatsApp)](#evolution-api-whatsapp).

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
| Criar usuário de desenvolvimento | `cd backend && npm run prisma:seed`         |

## Backend

Todos os comandos rodam em `backend/`:

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:generate     # gera o Prisma Client
npm run prisma:migrate      # aplica as migrations
npm run prisma:seed         # cria tenant/usuário de desenvolvimento (idempotente)
npm run start:dev           # watch mode: http://localhost:3000/api/health
```

### Usuário de desenvolvimento (seed)

`npm run prisma:seed` cria, de forma **idempotente**, um tenant e um usuário `OWNER`. Credenciais:

```text
Tenant: OrderUp Demo
E-mail: admin@orderup.local
Senha:  admin12345
```

Pode rodar quantas vezes quiser: os registros são atualizados, não duplicados. Use **apenas em
desenvolvimento** e não reutilize essas credenciais em produção.

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
| `CREDENTIALS_ENCRYPTION_KEY` | sim com WhatsApp   | —                        |
| `QUEUE_DRIVER`  | não                           | `bullmq`                 |
| `RATE_LIMIT_ENABLED` | não                      | `true`                   |
| `EVOLUTION_API_BASE_URL` | sim com WhatsApp      | —                        |
| `EVOLUTION_API_KEY` | quando há `EVOLUTION_API_BASE_URL` | —              |
| `EVOLUTION_WEBHOOK_SECRET` | quando há `EVOLUTION_API_BASE_URL` | —      |
| `PUBLIC_API_URL`| sim em produção com WhatsApp  | —                        |
| `AI_*`          | não (legado)                  | —                        |

`CORS_ORIGINS` é uma lista separada por vírgulas. `*` não é aceito em produção. As variáveis de IA
são legado do módulo de qualificação removido: continuam sendo validadas, mas podem ficar vazias e
nenhum módulo as consome.

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

## Evolution API (WhatsApp)

A Evolution API é um **serviço externo** que intermediia a conexão com o WhatsApp. Não faz parte do
`docker-compose.yml` principal — use `docker-compose.evolution.yml`.

### Subir

```bash
docker compose -f docker-compose.yml -f docker-compose.evolution.yml up -d
docker compose logs -f evolution
```

Variáveis aceitas pelo compose: `EVOLUTION_IMAGE` (default
`evoapicloud/evolution-api:v2.3.7`), `EVOLUTION_PORT` (default `8080`), `EVOLUTION_API_KEY`,
`EVOLUTION_POSTGRES_*`.

### Configurar o backend (`backend/.env`)

```env
EVOLUTION_API_BASE_URL=http://localhost:8080
EVOLUTION_API_KEY=change-me-evolution-api-key
EVOLUTION_WEBHOOK_SECRET=change-me-webhook-secret
CREDENTIALS_ENCRYPTION_KEY=<segredo com 32+ caracteres>
PUBLIC_API_URL=https://<url-publica-do-backend>
```

- `EVOLUTION_API_KEY` deve ser igual ao `AUTHENTICATION_API_KEY` da Evolution.
- `PUBLIC_API_URL` precisa ser alcançável **pela Evolution**. O compose da Evolution já inclui
  `host.docker.internal`; com o backend no host, use
  `PUBLIC_API_URL=http://host.docker.internal:3000`. Alternativas: túnel (`ngrok http 3000`) ou,
  se backend e Evolution estiverem no mesmo Docker network, `http://<host-do-backend>:3000`. Sem uma
  URL alcançável, o webhook falha com `PUBLIC_API_URL_MISSING`.
- Se backend e Evolution estiverem no mesmo Docker network, use
  `EVOLUTION_API_BASE_URL=http://evolution:8080`.
- Credenciais por instância (`apiKey`/`webhookSecret`) são opcionais e ficam cifradas em repouso
  (AES-256-GCM); a API nunca as devolve.

### Usar

1. **Atendimento → WhatsApp → Nova instância** (nome, `instanceName` único, telefone opcional).
2. **Conectar** → a API cria a instância na Evolution (`POST /instance/create`) ou reaproveita
   (`GET /instance/connect`) e retorna QR/pairing.
3. O webhook (`MESSAGES_UPSERT`) é configurado automaticamente.
4. Mensagens recebidas criam/reutilizam o **Contact** por telefone e a **Conversation** da instância.

Endpoints da Evolution usados por `EvolutionClient` (`src/modules/whatsapp/evolution/`):
`/instance/create`, `/instance/connect/{name}`, `/instance/logout/{name}`,
`/instance/connectionState/{name}`, `/message/sendText/{name}`, `/webhook/set/{name}`.

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
