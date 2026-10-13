# Perfil e configurações — OrderUp CRM

> Status: **Implementado**. Telas de **Meu perfil** (`/perfil`) e **Configurações** (`/configuracoes`)
> com organização, equipe e aparência.

Complementa [`authentication.md`](./authentication.md) e [`multi-tenancy.md`](./multi-tenancy.md).

## Meu perfil — `/perfil`

- **Dados pessoais**: nome editável (`PATCH /api/auth/me`); e-mail de login **não** editável; papel e
  organização atuais em leitura.
- **Senha**: senha atual + nova + confirmação (`POST /api/auth/change-password`). Ao trocar, os
  refresh tokens das **outras sessões** são revogados (`RefreshTokenService.revokeAllForUser`),
  mantendo a sessão atual (cookie `orderup_refresh`). Senha atual incorreta → `INVALID_CURRENT_PASSWORD`
  (400).

## Configurações — `/configuracoes` (abas)

| Aba          | Endpoints                                     | Papéis        |
| ------------ | --------------------------------------------- | ------------- |
| Organização  | `GET/PATCH /api/tenants/current`              | leitura: todos; PATCH: `OWNER`, `ADMIN` |
| Equipe       | `GET/POST/PATCH/DELETE /api/members`          | leitura: todos; escrita: `OWNER`, `ADMIN` |
| Aparência    | (frontend) tema claro/escuro/sistema          | todos         |
| Notificações | (frontend) contador de não lidas e som        | todos         |

### Organização

`PATCH /api/tenants/current` com `{ name }` renomeia o tenant do contexto (escopado por
`TenantContext`). O frontend reflete o novo nome no header (`auth-store.updateTenantName`) e invalida
`/auth/me`.

### Equipe

- `GET /api/members` — lista membros ativos (nome, e-mail, papel, ativo).
- `POST /api/members` — `{ name, email, password?, role }`. `User` é **global**: se o e-mail já
  existir, apenas cria o vínculo (senha não é alterada); se for novo usuário, `password` é
  obrigatório (`PASSWORD_REQUIRED`, 400). Usuário já vinculado → `MEMBERSHIP_ALREADY_EXISTS` (409).
- `PATCH /api/members/:id` — `{ role?, active? }`.
- `DELETE /api/members/:id` — remove o vínculo (não apaga o `User`).
- **Proteção**: nunca permite remover/desativar o **último `OWNER` ativo** → `LAST_OWNER_REQUIRED`
  (409).

`role` ∈ `OWNER | ADMIN | USER`.

### Aparência

Seletor de tema reutilizando o `theme-store` (o mesmo do header). Sem persistência no backend.

### Notificações

Preferências do navegador persistidas em `localStorage` (`orderup-notifications`), sem backend:

- **Contador de não lidas na aba** — título da aba `(N) OrderUp CRM` com o total de conversas não
  lidas.
- **Som de notificação** — toca um som curto ao receber mensagem (Web Audio), com botão **Ouvir**
  para testar.

O estado de não lidas e a detecção de mensagens recebidas vêm do socket compartilhado
(`RealtimeProvider`) e do evento `message.created` com `direction = INBOUND` — ver
[`attendance.md`](./attendance.md).

## Segurança e isolamento

- Todas as rotas exigem membership ativa; o tenant vem de `RequireContext()` — nunca do cliente.
- Escritas de organização/equipe restritas a `OWNER`/`ADMIN` via `@Roles` + `RolesGuard`.
- Nenhuma senha ou hash é retornado pela API.

## Fora de escopo

- Alteração de e-mail, convite por token/e-mail e recuperação de senha (sem infra de e-mail).
- Avatar/upload de imagem de perfil.
