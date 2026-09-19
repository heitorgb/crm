# Banco de dados — OrderUp CRM

## Stack

- **PostgreSQL 16** (ver `docker-compose.yml`).
- **Prisma 7** com **driver adapter** `@prisma/adapter-pg`.

### Por que driver adapter?

A partir do Prisma 7 o engine Rust foi removido. O client precisa de um driver adapter. Usamos
`@prisma/adapter-pg` com o driver `pg`, passando a `connectionString` obtida da configuração
validada (`DATABASE_URL`).

### Por que o generator legacy (`prisma-client-js`)?

O generator novo (`prisma-client`) gera código **ESM** (usa `import.meta` e imports com extensão
`.ts`), incompatível com o build CommonJS do NestJS. O generator `prisma-client-js` continua
suportado no Prisma 7 e gera o client clássico em `node_modules/@prisma/client`. A migração para
ESM é uma decisão futura e não deve ser feita isoladamente.

O arquivo de configuração do CLI é `backend/prisma7.config.ts`, que lê `DATABASE_URL` do ambiente
(via `dotenv`). O datasource em `schema.prisma` não contém `url`.

## Modelagem atual (Implementado)

Apenas a base de identidade e multi-tenancy. **Nenhuma entidade de CRM foi criada.**

### `Tenant`

| Campo       | Tipo       | Observações        |
| ----------- | ---------- | ------------------ |
| `id`        | `uuid` PK  | `@default(uuid())` |
| `name`      | `text`     |                    |
| `createdAt` | `timestamp`| `@default(now())`  |
| `updatedAt` | `timestamp`| `@updatedAt`       |

### `User` (global)

| Campo          | Tipo        | Observações             |
| -------------- | ----------- | ----------------------- |
| `id`           | `uuid` PK   |                         |
| `email`        | `text` UNIQUE |                       |
| `passwordHash` | `text`      | hash; nunca a senha     |
| `name`         | `text`      |                         |
| `createdAt`    | `timestamp` |                         |
| `updatedAt`    | `timestamp` |                         |

`User` é global: uma pessoa pode pertencer a vários tenants.

### `TenantUser` (membership)

| Campo       | Tipo        | Observações                          |
| ----------- | ----------- | ------------------------------------ |
| `id`        | `uuid` PK   | é o `membershipId` do tenant context |
| `tenantId`  | `uuid` FK   | `ON DELETE CASCADE`                  |
| `userId`    | `uuid` FK   | `ON DELETE CASCADE`                  |
| `role`      | `text`      | papel do usuário no tenant           |
| `createdAt` | `timestamp` |                                      |
| `updatedAt` | `timestamp` |                                      |

Constraints e índices:

- `UNIQUE (tenantId, userId)` — um vínculo por par.
- índice em `userId` (o índice único já cobre buscas por `tenantId`).

`role` permanece `string` nesta fase. Transformá-lo em enum exigirá justificativa e uma migration
própria quando os papéis forem definidos.

## Migrations

```bash
cd backend
cp .env.example .env
npm run prisma:migrate      # dev: cria/aplica migrations
npm run prisma:deploy       # ambientes não interativos (CI/produção)
npm run prisma:studio       # inspeção visual (opcional)
```

As migrations ficam em `backend/prisma/migrations/` e **devem ser versionadas**.

## Planejado

- RLS (Row Level Security) como defesa em profundidade. Ver
  [`multi-tenancy.md`](./multi-tenancy.md).
- Entidades de CRM por fase (Customer, Contact, Lead, Pipeline, Deal, Task...).
- Estratégia de soft delete, se necessária.

## Regras

- Toda entidade pertencente a um tenant terá `tenantId` e índice apropriado.
- Não criar campos especulativos sem justificativa.
- Não criar abstrações de repositório genéricas sem necessidade real.
