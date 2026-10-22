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
| GET    | `/api/auth/me`         | não     | Retorna usuário, tenant ativo, role, memberships e `isPlatformAdmin`. |
| PATCH  | `/api/auth/me`         | não     | Atualiza o **nome** do usuário.                    |
| POST   | `/api/auth/change-password` | não | Troca a senha (valida a atual) e revoga as outras sessões. |
| POST   | `/api/auth/switch-tenant` | não  | Troca o tenant ativo, validando membership.        |
| POST   | `/api/auth/forgot-password` | sim | Solicita link de recuperação; resposta sempre genérica. |
| POST   | `/api/auth/reset-password` | sim | Consome o token e redefine a senha. |

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

## Gerenciador de senhas do navegador

A tela de login usa os mecanismos nativos do navegador, sem armazenar credenciais na aplicação:

- E-mail: `autocomplete="username"`.
- Senha: `autocomplete="current-password"`.
- Formulário: `name="login"`, `method="post"`, `action="/api/auth/login"` e `autocomplete="on"`.

A opção **"Lembrar senha"** vale para o login atual e não é persistida entre visitas. Quando
marcada, após uma autenticação bem-sucedida o frontend entrega as credenciais ao gerenciador nativo
via Credential Management API (`navigator.credentials.store` com `PasswordCredential`), quando a
API está disponível em contexto seguro (Chromium/Edge). Quando desmarcada, essa chamada não é
feita. Em navegadores sem a API (por exemplo, Firefox e Safari), o salvamento depende das
heurísticas nativas do próprio navegador.

A aplicação não armazena e-mail ou senha em `localStorage`, `sessionStorage` ou cookies próprios, e
o checkbox não altera a sessão, os cookies ou a validade dos tokens. O preenchimento automático de
credenciais já salvas continua permitido nos dois estados.

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
- **Expiração:** `REFRESH_TOKEN_EXPIRED` (401). A sessão dura `REFRESH_TOKEN_TTL_DAYS` (default 1 = 24h). A rotação **não** estende esse prazo: o novo token herda a expiração absoluta do token original, então a sessão nunca passa de 24h após o login.
- O access token emitido na rotação é limitado ao tempo restante da sessão (nunca sobrevive ao refresh token).

## Cookie

- Nome `orderup_refresh`, `HttpOnly`, `Secure` (default `true` em produção), `SameSite` configurável
  (`lax`/`strict`/`none`), `path=/{API_PREFIX}/auth`.
- Persistente: `Expires`/`Max-Age` iguais à expiração do refresh token (24h por padrão), portanto o
  cookie sobrevive ao fechamento da aba e do navegador.
- `SameSite=none` exige `AUTH_COOKIE_SECURE=true` (validado no boot).
- `logout` revoga o refresh token e limpa o cookie com os mesmos atributos de criação.

## Guards e autorização

- **`JwtAuthGuard`** (autenticação, global): rotas marcadas com `@Public()` são liberadas; as demais
  exigem access token válido e membership ativa, preenchendo o `TenantContext`.
- **`RolesGuard`** (autorização, global): aplica `@Roles(...)`. Sem `@Roles`, apenas exige
  autenticação. A role vem do `TenantContext` (banco), nunca do cliente.
- **`PlatformAdminGuard`** (autorização administrativa, por controller): exige que o e-mail do
  usuário autenticado esteja em `PLATFORM_ADMIN_EMAILS`; usado apenas em `AdminController`
  (`/api/admin/*`). Não concede acesso cross-tenant a nenhuma outra rota. Ver
  [`tenant-provisioning.md`](./tenant-provisioning.md).
- **`ModuleEnabledGuard`** (autorização por módulo, global): aplica `@RequireModule('<key>')` e
  bloqueia a operação com `403 MODULE_DISABLED` quando o módulo está desabilitado para a
  organização do `TenantContext`. É ortogonal às permissões por papel; ver
  [`modules.md`](./modules.md).
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

## Recuperação de senha

Fluxo independente dos tokens de autenticação normais:

```text
POST /auth/forgot-password { email }
  → normaliza o e-mail e busca o User global pelo e-mail único
  → invalida tokens de recuperação pendentes do usuário
  → gera token opaco (32 bytes) e persiste somente SHA-256
  → envia link {APP_URL}/redefinir-senha?token=... pelo Resend (validade 30 min)
  → responde sempre: "Se existir uma conta associada a esse e-mail, ..."

POST /auth/reset-password { token, newPassword }
  → busca pelo hash do token, valida expiração/uso/usuário ativo
  → em transação: consome o token, atualiza o hash Argon2id e revoga os refresh tokens do usuário
  → responde 204 (sem autenticar automaticamente)
```

- Respostas de solicitação são genéricas para e-mails existentes, inexistentes e inativos
  (anti-enumeração).
- Tokens são de uso único; solicitar um novo invalida os anteriores. O consumo concorrente é
  protegido por `updateMany` condicional dentro da transação.
- A senha é global ao `User` (e-mail único), então o reset não recebe `tenantId` e não permite
  redefinir a conta de outro usuário/organização. As sessões de todos os tenants daquele usuário
  têm os refresh tokens revogados; JWTs de acesso já emitidos expiram no TTL normal.
- Rate limit: 5 req/min por IP na solicitação, 10 req/min por IP no reset, além de 3 solicitações
  por e-mail a cada 15 minutos.
- Falhas do Resend retornam `502 EMAIL_DELIVERY_FAILED` sem detalhes internos. Configuração ausente
  retorna `503 EMAIL_NOT_CONFIGURED`.
- O token nunca é logado (o logger remove query string e redige `*.token`).

Variáveis necessárias para o envio:

```text
RESEND_API_KEY         # chave do Resend (backend)
RESEND_FROM_EMAIL      # remetente verificado, ex.: OrderUp CRM <noreply@...>
APP_URL                # URL pública do frontend, usada no link
```

## Troca de tenant

- `POST /auth/switch-tenant` recebe `tenantId`, valida membership ativa do usuário autenticado e
  emite um novo access token + novo refresh (a família anterior do cookie é revogada).
- Usuário sem membership no tenant alvo recebe `TENANT_ACCESS_DENIED` (403).

## Variáveis de ambiente

```text
JWT_ACCESS_SECRET        # obrigatório, >= 32 chars
JWT_ACCESS_TTL_SECONDS   # default 900 (curto; a sessão é mantida pelo refresh)
REFRESH_TOKEN_TTL_DAYS   # default 1 (24h de sessão desde o login)
AUTH_COOKIE_SECURE       # default: true em produção, false fora
AUTH_COOKIE_SAMESITE     # lax | strict | none (default lax)
AUTH_COOKIE_DOMAIN       # opcional
RESEND_API_KEY           # opcional no boot; necessário para recuperação de senha
RESEND_FROM_EMAIL        # remetente verificado no Resend
APP_URL                  # URL pública do frontend usada no link
```

## Segurança

- `password`/`passwordHash` nunca são retornados nem logados; tokens são redigidos no logger.
- Senhas com **Argon2id** (`@node-rs/argon2`).
- `tenantId` e `role` do cliente nunca são confiados.
- Sem membership ativa não há acesso.
- Erros não vazam stack trace (filtro global).

## Fora de escopo

- Alteração de e-mail, MFA e convites.
- RBAC granular por recurso (apenas roles base + endpoint-level).
- Rate limiting distribuído (o atual é em memória por instância).
- Identidade do bot via webhook (entra na fase de bot/WhatsApp).
