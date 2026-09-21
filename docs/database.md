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
| `passwordHash` | `text`      | hash Argon2id; nunca a senha |
| `name`         | `text`      |                         |
| `active`       | `boolean`   | default `true`; usuário inativo perde acesso |
| `createdAt`    | `timestamp` |                         |
| `updatedAt`    | `timestamp` |                         |

`User` é global: uma pessoa pode pertencer a vários tenants.

### `TenantUser` (membership)

| Campo       | Tipo        | Observações                          |
| ----------- | ----------- | ------------------------------------ |
| `id`        | `uuid` PK   | é o `membershipId` do tenant context |
| `tenantId`  | `uuid` FK   | `ON DELETE CASCADE`                  |
| `userId`    | `uuid` FK   | `ON DELETE CASCADE`                  |
| `role`      | enum `Role` | `OWNER` \| `ADMIN` \| `USER`         |
| `active`    | `boolean`   | default `true`; soft delete do vínculo |
| `createdAt` | `timestamp` |                                      |
| `updatedAt` | `timestamp` |                                      |

Constraints e índices:

- `UNIQUE (tenantId, userId)` — um vínculo por par.
- índice em `userId` (o índice único já cobre buscas por `tenantId`).
- Apenas membership `active = true` concede acesso (ver `MembershipsService`).

### `RefreshToken`

| Campo               | Tipo          | Observações                                      |
| ------------------- | ------------- | ------------------------------------------------ |
| `id`                | `uuid` PK     |                                                  |
| `userId`            | `uuid` FK     | `ON DELETE CASCADE`                              |
| `tenantId`          | `uuid` FK     | tenant ativo na emissão; `ON DELETE CASCADE`     |
| `tokenHash`         | `text` UNIQUE | SHA-256 do token opaco (nunca o token puro)      |
| `familyId`          | `uuid`        | agrupa a rotação; reuso revoga a família         |
| `expiresAt`         | `timestamp`   |                                                  |
| `revokedAt`         | `timestamp?`  | nulo enquanto válido                             |
| `replacedByTokenId` | `uuid?`       | token que substituiu este na rotação             |
| `userAgent`         | `text?`       | auditoria básica                                 |
| `ipAddress`         | `text?`       | auditoria básica                                 |
| `createdAt`         | `timestamp`   |                                                  |

Índices: `UNIQUE (tokenHash)`, `userId`, `familyId`. Rotação/reuso detalhados em
[`authentication.md`](./authentication.md).

## Retenção e sensibilidade (LGPD — planejado)

Padrões de schema para as próximas entidades de tenant (sem rotina de expurgo nesta fase):

- Toda entidade que armazene dado pessoal de Lead/Customer/Contact deverá registrar, na
  documentação do schema, um **prazo de retenção esperado**. O job de expurgo fica para o Prompt 09.
- `dataSensitivityLevel` (`low` | `medium` | `high`) é um padrão que perfis/configurações de tenant
  (ex.: futuro `QualificationProfile`) poderão carregar. Ele habilita controles proporcionais ao
  risco — por exemplo, exigir revisão humana antes de decisão automatizada negativa em `high`.
- Decisões automatizadas sobre um lead devem manter o **motivo objetivo** da decisão, legível ao
  titular (viabiliza o art. 20 da LGPD).
- `dataSensitivityLevel` é ortogonal a `tenantId`; não o substitui.

## Migrations

```bash
cd backend
cp .env.example .env
npm run prisma:migrate      # dev: cria/aplica migrations
npm run prisma:deploy       # ambientes não interativos (CI/produção)
npm run prisma:studio       # inspeção visual (opcional)
```

As migrations ficam em `backend/prisma/migrations/` e **devem ser versionadas** (inclui
`20260921120000_add_active_to_tenant_users` e `20260921130000_auth_tokens_and_roles`).

## Planejado

- RLS (Row Level Security) como defesa em profundidade, tabela a tabela. Ver
  [`multi-tenancy.md`](./multi-tenancy.md).
- Entidades de CRM por fase (Customer, Contact, Lead, Pipeline, Deal, Task...).
- Estratégia de soft delete por entidade, quando necessária (membership já usa `active`).

## Regras

- Toda entidade pertencente a um tenant terá `tenantId` e índice apropriado.
- Não criar campos especulativos sem justificativa.
- Não criar abstrações de repositório genéricas sem necessidade real.
