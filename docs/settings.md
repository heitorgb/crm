# Perfil e configurações — OrderUp CRM

> Status: **Implementado**. Telas de **Meu perfil** (`/perfil`) e **Configurações** (`/configuracoes`)
> com organização, equipe, aparência, atendimento, notificações, WhatsApp, menu personalizado e IA.

Complementa [`authentication.md`](./authentication.md) e [`multi-tenancy.md`](./multi-tenancy.md).

## Meu perfil — `/perfil`

- **Dados pessoais**: nome editável (`PATCH /api/auth/me`); e-mail de login **não** editável; papel e
  organização atuais em leitura.
- **Foto de perfil**: avatar circular com fallback de iniciais. Seleção de JPEG/PNG/WebP (até 5 MB),
  prévia antes de confirmar, envio (`POST /api/auth/me/avatar`, multipart), substituição e remoção
  (`DELETE /api/auth/me/avatar`). O backend valida o conteúdo real com `sharp`, recorta em quadrado,
  redimensiona para `AVATAR_DIMENSION` (padrão 512 px), reencoda em JPEG e grava no storage. A URL
  pública (`/api/members/:membershipId/avatar?v=...`) é autenticada e escopada pelo tenant; o
  `?v=` funciona como cache busting. A troca atualiza o `auth-store` e aparece imediatamente no
  header, menu da conta, perfil e equipe, sem novo login.
- **Senha**: senha atual + nova + confirmação (`POST /api/auth/change-password`). Ao trocar, os
  refresh tokens das **outras sessões** são revogados (`RefreshTokenService.revokeAllForUser`),
  mantendo a sessão atual (cookie `orderup_refresh`). Senha atual incorreta → `INVALID_CURRENT_PASSWORD`
  (400).

## Configurações — `/configuracoes` (abas)

A aba ativa é sincronizada com o parâmetro `?tab=` da URL (`organization`, `team`, `appearance`,
`attendance`, `notifications`, `whatsapp`, `menu`, `ai`); sem parâmetro, abre em **Organização**. A rota
antiga `/atendimento/whatsapp` redireciona para `/configuracoes?tab=whatsapp`.

| Aba          | Endpoints                                     | Papéis        |
| ------------ | --------------------------------------------- | ------------- |
| Organização  | `GET/PATCH /api/tenants/current`              | leitura: todos; PATCH: `OWNER`, `ADMIN` |
| Equipe       | `GET/POST/PATCH/DELETE /api/members`          | leitura: todos; escrita: `OWNER`, `ADMIN` |
| Aparência    | (frontend) tema e posição do menu mobile      | todos         |
| Atendimento  | (frontend) exibir nome do atendente           | todos         |
| Notificações | (frontend) contador de não lidas e som        | todos         |
| WhatsApp     | `GET/POST/PATCH/DELETE /api/whatsapp/instances` + `connect`/`disconnect`/`status`/`webhook` | todos |
| Menu Personalizado | `GET/PUT /api/custom-menu`, `GET /api/custom-menu/navigation` + CRUD de grupos/botões | leitura: todos; escrita: `OWNER`, `ADMIN` |
| IA           | `GET /api/ai/catalog`, `GET/PUT /api/ai/settings`, `POST /api/ai/test`, `POST /api/ai/formalize` | leitura: todos; escrita/teste: `OWNER`, `ADMIN`; formalização: todos |

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

Seletor de tema reutilizando o `theme-store` (o mesmo do header) e seletor de **posição do menu
lateral** no mobile (`Esquerda` ou `Direita`), persistido em `localStorage` (`orderup-ui`) com padrão
`left`. A posição é aplicada somente ao drawer mobile; o menu fixo do desktop permanece à esquerda.
Sem persistência no backend.

O estado de expansão de cada grupo do menu lateral também é persistido em `orderup-ui`
(`expandedNavGroups`), usando identificadores estáveis por grupo. Grupos sem preferência salva
iniciam minimizados; a expansão é independente entre grupos e não depende da abertura do drawer
mobile nem do recolhimento visual do menu.

### Atendimento

Preferência do navegador persistida em `localStorage` (`orderup-attendance`), sem backend:

- **Exibir nome do atendente** — define o estado inicial do checkbox no compositor do atendimento.
  Quando ligado, o nome do atendente é prefixado nas mensagens enviadas ao cliente (`*Nome:*`). O
  checkbox do compositor altera a cada mensagem e atualiza essa preferência — ver
  [`attendance.md`](./attendance.md).

### Notificações

Preferências do navegador persistidas em `localStorage` (`orderup-notifications`), sem backend:

- **Contador de não lidas na aba** — título da aba `(N) OrderUp CRM` com o total de conversas não
  lidas.
- **Som de notificação** — toca um som curto ao receber mensagem (Web Audio), com botão **Ouvir**
  para testar.

O estado de não lidas e a detecção de mensagens recebidas vêm do socket compartilhado
(`RealtimeProvider`) e do evento `message.created` com `direction = INBOUND` — ver
[`attendance.md`](./attendance.md).

### Menu Personalizado

Grupos de atalhos externos compartilhados pela organização, exibidos no menu lateral. Cada grupo
tem nome, ícone opcional, status e ordem; cada botão tem nome, URL `http(s)`, ícone opcional, status
e ordem. Só grupos ativos com ao menos um botão ativo aparecem. Os links abrem em nova aba com
`noopener`/`noreferrer`, sem criar rotas internas. O backend valida as URLs e escopa todas as
operações pelo tenant do contexto. Fluxo completo em [`custom-menu.md`](./custom-menu.md).

### IA

Configuração de provedor, modelo, credenciais e nível de formalidade para o botão de IA no
compositor do atendimento, organizada nas sub-abas **Copiloto IA**, **Transcrição** e
**Credenciais**. A credencial é criptografada e nunca retornada pela API. O botão de formalização só
aparece quando a configuração do tenant está ativa e completa. Fluxo completo, provedores, modelos e
endpoints em [`ai.md`](./ai.md).

### WhatsApp

Administração das instâncias da integração com a Evolution API (endpoints `/api/whatsapp/instances`):
listagem (nome, `instanceName`, telefone, status de conexão e indicador de credenciais próprias),
criação, edição, exclusão, conexão/reconexão com **QR code** (`connect`, com *poll* de `status`) e
**reconfiguração de webhook**. O QR é atualizado em tempo real quando a Evolution o renova; o
diálogo diferencia conexão recusada/limite de QR, QR expirado e conexão confirmada. `GET /status` é
restrito a `OWNER`/`ADMIN`. A lógica de integração não muda; a interface foi movida de Atendimento
para Configurações. Fluxo completo em [`attendance.md`](./attendance.md). Nenhuma credencial é
exibida após ser salva.

## Configurações da plataforma (admin)

Disponível apenas para administradores da plataforma (`isPlatformAdmin`), em
**Administração → Configurações da plataforma** (`/admin/settings`):

- **Gerar preview de links nas mensagens** — configuração global, sem sobrescrita por organização.
  Padrão **desativado**. O backend persiste o valor no banco e o aplica a todos os envios de texto
  (manual, lembretes, mensagens agendadas e webhooks). Desativado, o envio usa `linkPreview: false`
  na Evolution e não resolve metadados de preview; ativado, o preview volta a ser permitido conforme
  o suporte da versão instalada da Evolution.
- Endpoints: `GET/PATCH /api/admin/settings` com `{ "linkPreviewsEnabled": boolean }`, protegidos por
  `PlatformAdminGuard`. A alteração não exige reiniciar o CRM.

## Segurança e isolamento

- Todas as rotas exigem membership ativa; o tenant vem de `RequireContext()` — nunca do cliente.
- Escritas de organização/equipe restritas a `OWNER`/`ADMIN` via `@Roles` + `RolesGuard`.
- Nenhuma senha ou hash é retornado pela API.

## Fora de escopo

- Alteração de e-mail, convite por token/e-mail e recuperação de senha (sem infra de e-mail).
