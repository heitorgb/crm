# Autenticação e autorização — OrderUp CRM

> Status: **Implementado** (Prompt 03). Este documento descreve o fluxo real de autenticação,
> os endpoints, os tokens e as regras de autorização.

## Fluxo

```text
User → POST /auth/login (email, senha, tenantId opcional)
  → valida credenciais + usuário ativo + membership ativa
  → Access Token (JWT curto) no corpo + Refresh Token (opaco) em cookie HttpOnly
  → Requisição autenticada (Authorization: Bearer <access token>)
  → Guard valida assinatura + membership no banco
  → TenantContext preenchido → Authorization (roles)
```

## Endpoints

| Método | Rota                   | Público | Descrição                                          |
| ------ | ---------------------- | ------- | -------------------------------------------------- |
| POST   | `/api/auth/login`      | sim     | Autentica e emite access + refresh.                |
| POST   | `/api/auth/refresh`    | sim     | Rotaciona o refresh token e emite novo access.     |
| POST   | `/api/auth/logout`     | sim     | Revoga o refresh token e limpa o cookie.           |
| GET    | `/api/auth/me`         | não     | Retorna usuário, tenant ativo, role e memberships. |
| POST   | `/api/auth/switch-tenant` | não  | Troca o tenant ativo, validando membership.        |

O `refreshToken` **não** vai no corpo das respostas; trafega em cookie HttpOnly. Clientes de API
podem enviar `{ "refreshToken": "..." }` no corpo de `refresh`/`logout` (fallback).

## Login

- `email`, `password` e `tenantId` opcional.
- Erro genérico `INVALID_CREDENTIALS` (401) para senha errada **e** email inexistente (sem
  enumeração). Usuário inexistente executa um hash fictício para equalizar o tempo.
- `USER_INACTIVE` (403) quando o usuário está inativo.
- `TENANT_ACCESS_DENIED` (403) quando não há membership ativa no tenant pedido.
- `NO_ACTIVE_MEMBERSHIP` (403) quando o usuário não tem nenhuma membership ativa.
- `TENANT_REQUIRED` (400) quando o usuário tem múltiplas memberships e não informou `tenantId`.

## Access token (JWT)

Claims mínimas:

```json
{ "sub": "user-id", "tenantId": "tenant-id", "membershipId": "membership-id", "role": "OWNER" }
```

- Assinado com `JWT_ACCESS_SECRET`, TTL `JWT_ACCESS_TTL_SECONDS` (default 900s).
- Enviado em `Authorization: Bearer <token>`.
- **O token nunca é a fonte de verdade**: a cada requisição o guard recarrega a membership ativa em
  `(userId, tenantId)` e usa os dados do banco. `role` e `membershipId` adulterados no token são
  ignorados; usuário/membership inativos perdem acesso imediatamente.

## Refresh token

- **Opaco** (`randomBytes(48)`), não é JWT.
- Persistido apenas como **hash SHA-256** em `refresh_tokens` (nunca em texto puro).
- Campos: `userId`, `tenantId`, `tokenHash`, `familyId`, `expiresAt`, `revokedAt`,
  `replacedByTokenId`, `userAgent`, `ipAddress`, `createdAt`.
- **Rotação:** ao usar, o token antigo é revogado e um novo é emitido na mesma `familyId`.
- **Reutilização:** apresentar um token já revogado revoga a família inteira e responde
  `REFRESH_TOKEN_REUSE` (401). A revogação do antigo é atômica (`updateMany` condicional) para
  evitar corrida.
- **Expiração:** `REFRESH_TOKEN_EXPIRED` (401). TTL em `REFRESH_TOKEN_TTL_DAYS` (default 30).

## Cookie

- Nome `orderup_refresh`, `HttpOnly`, `Secure` (default `true` em produção), `SameSite` configurável
  (`lax`/`strict`/`none`), `path=/{API_PREFIX}/auth`.
- `SameSite=none` exige `AUTH_COOKIE_SECURE=true` (validado no boot).
- `logout` limpa o cookie.

## Guards e autorização

- **`JwtAuthGuard`** (autenticação, global): rotas marcadas com `@Public()` são liberadas; as demais
  exigem access token válido e membership ativa, preenchendo o `TenantContext`.
- **`RolesGuard`** (autorização, global): aplica `@Roles(...)`. Sem `@Roles`, apenas exige
  autenticação. A role vem do `TenantContext` (banco), nunca do cliente.
- Decorators: `@Public()`, `@Roles(OWNER, ADMIN)`, `@CurrentTenant()`.

### Roles (enum `Role`)

`OWNER`, `ADMIN`, `USER`. Para o MVP do bot de qualificação:

- `OWNER` e `ADMIN` podem criar/editar perfil do bot, contexto de negócio, critérios, tom,
  regras de conclusão e handoff.
- Cada membership autorizada configura sua própria preferência de recebimento do resumo
  (habilitado, horário, timezone, canal suportado).
- `USER` visualiza leads/análises conforme as regras do CRM.

Permissões **nunca** são derivadas do frontend. Editar contexto do bot exige membership válida no
mesmo tenant; trocar de tenant troca perfil, sessões e preferências.

## Troca de tenant

- `POST /auth/switch-tenant` recebe `tenantId`, valida membership ativa do usuário autenticado e
  emite um novo access token + novo refresh (a família anterior do cookie é revogada).
- Usuário sem membership no tenant alvo recebe `TENANT_ACCESS_DENIED` (403).

## Variáveis de ambiente

```text
JWT_ACCESS_SECRET        # obrigatório, >= 32 chars
JWT_ACCESS_TTL_SECONDS   # default 900
REFRESH_TOKEN_TTL_DAYS   # default 30
AUTH_COOKIE_SECURE       # default: true em produção, false fora
AUTH_COOKIE_SAMESITE     # lax | strict | none (default lax)
AUTH_COOKIE_DOMAIN       # opcional
```

## Segurança

- `password`/`passwordHash` nunca são retornados nem logados; tokens são redigidos no logger.
- Senhas com **Argon2id** (`@node-rs/argon2`).
- `tenantId` e `role` do cliente nunca são confiados.
- Sem membership ativa não há acesso.
- Erros não vazam stack trace (filtro global).

## Fora de escopo

- Recuperação de senha, MFA e convites.
- RBAC granular por recurso (apenas roles base + endpoint-level).
- Rate limiting de autenticação.
- Identidade do bot via webhook (entra na fase de bot/WhatsApp).
