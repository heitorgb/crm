# Provisionamento de tenants e usuários — OrderUp CRM

> Status: **Implementado**. Área administrativa da plataforma para criar organizações (tenants) e
> seus usuários, sem alterar o modelo de autenticação nem os contratos existentes.

Complementa [`authentication.md`](./authentication.md) e [`multi-tenancy.md`](./multi-tenancy.md).

## Conceito

O **admin de plataforma** é um usuário comum do CRM (com membership ativa em algum tenant) cujo
e-mail está na allowlist `PLATFORM_ADMIN_EMAILS`. Ele acessa a área `/admin` para provisionar novas
organizações e gerenciar seus membros. Não há um papel `SUPERADMIN` no banco.

## Configuração

```env
# backend/.env — e-mails separados por vírgula (normalizados para minúsculas)
PLATFORM_ADMIN_EMAILS=admin@orderup.com.br,ops@empresa.com.br
```

- Sem valor → allowlist vazia → **ninguém** acessa a área administrativa.
- O e-mail precisa pertencer a um `User` **ativo** com **membership ativa** (o `JwtAuthGuard`
  global exige autenticação). O admin não fica fora do isolamento de tenant: ele apenas ganha uma
  permissão extra via guard.
- Reinicie o backend após alterar a variável.

### Bootstrap do primeiro admin

O seed cria `admin@orderup.com.br` (OWNER do tenant `OrderUp Demo`). Basta colocá-lo em
`PLATFORM_ADMIN_EMAILS` para habilitar a área:

```bash
cd backend
npm run prisma:seed
# .env: PLATFORM_ADMIN_EMAILS=admin@orderup.com.br
```

## Autorização

`PlatformAdminGuard` (aplicado em `AdminController`) verifica:

1. existe `TenantContext` (token válido + membership ativa — via `JwtAuthGuard` global);
2. o e-mail do usuário pertence a `PLATFORM_ADMIN_EMAILS`.

Caso contrário → `PLATFORM_ADMIN_REQUIRED` (403). O frontend apenas **esconde** o item de navegação;
a fonte de verdade é sempre o backend.

## Endpoints

| Método | Rota                                                       | Descrição                                   |
| ------ | ---------------------------------------------------------- | ------------------------------------------- |
| GET    | `/api/admin/tenants`                                       | Lista organizações (busca/paginação).       |
| POST   | `/api/admin/tenants`                                       | Cria organização + primeiro OWNER.          |
| GET    | `/api/admin/tenants/:id`                                   | Detalhe da organização + membros.           |
| POST   | `/api/admin/tenants/:id/members`                           | Adiciona usuário (cria ou vincula).         |
| PATCH  | `/api/admin/tenants/:id/members/:membershipId`             | Altera papel e/ou ativo.                    |
| DELETE | `/api/admin/tenants/:id/members/:membershipId`             | Remove o vínculo (não apaga o `User`).      |
| GET    | `/api/admin/users`                                         | Lista usuários globais (busca/paginação).   |

### Criar organização (`POST /api/admin/tenants`)

```json
{
  "name": "Minha Empresa",
  "ownerName": "Ana Souza",
  "ownerEmail": "ana@empresa.com.br",
  "ownerPassword": "senha-forte-123"
}
```

- `User` é **global**: se o e-mail já existir, ele é reutilizado (a senha **não** é alterada; o
  usuário é reativado) e apenas um novo vínculo é criado. Se não existir, a senha é gravada com
  **Argon2id**.
- Cria `Tenant` + `TenantUser` (role `OWNER`) em uma transação.

### Adicionar membro (`POST /api/admin/tenants/:id/members`)

```json
{ "name": "Bruno", "email": "bruno@empresa.com.br", "password": "senha-opcional", "role": "ADMIN" }
```

- `password` é obrigatório apenas quando o e-mail ainda não existe (`PASSWORD_REQUIRED`).
- Usuário já vinculado → `MEMBERSHIP_ALREADY_EXISTS` (409).

## Regras

- `role` ∈ `OWNER | ADMIN | USER`.
- É impossível **desativar/remover o último OWNER ativo** de um tenant → `LAST_OWNER_REQUIRED` (409).
- Todas as operações são escopadas por `tenantId` de parâmetro validado (`ParseUUIDPipe`); a
  autorização vem do guard de plataforma.
- Erros tipados: `PLATFORM_ADMIN_REQUIRED` (403), `TENANT_NOT_FOUND` (404),
  `MEMBERSHIP_NOT_FOUND` (404), `MEMBERSHIP_ALREADY_EXISTS` (409), `LAST_OWNER_REQUIRED` (409),
  `PASSWORD_REQUIRED` (400).

## Frontend

- `/admin/tenants` — lista de organizações + busca + "Nova organização" (dialog com dados do owner).
- `/admin/tenants/:id` — membros: adicionar, alterar papel, ativar/desativar e remover.
- Item de navegação **Administração → Organizações** visível apenas quando
  `isPlatformAdmin` (retornado por `GET /api/auth/me`).

## Fora de escopo

- Convite por token/e-mail e recuperação de senha (não há infra de e-mail).
- UI para gerenciar a allowlist de admins (definida por deploy).
- Impersonação / "entrar como" um usuário do tenant.
- Billing/assinatura.
