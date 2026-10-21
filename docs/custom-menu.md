# Menu personalizado — OrderUp CRM

> Status: **Implementado**. Configuração em **Configurações → Menu Personalizado**
> (`/configuracoes?tab=menu`) e integração com o menu lateral desktop e mobile.

## Visão geral

A funcionalidade é um catálogo de atalhos externos por organização. Cada grupo possui nome, ícone
opcional, status e ordem; cada botão possui nome, URL http(s), ícone opcional, status e ordem.

- Menus são **compartilhados dentro da organização** (não são preferências individuais).
- Apenas `OWNER` e `ADMIN` alteram a configuração; `USER` pode ler e usar os atalhos.
- Grupos inativos, botões inativos e grupos sem botões ativos não aparecem no menu lateral.
- Os atalhos **não criam rotas internas**: ao clicar, a URL é aberta em nova aba com
  `rel="noopener noreferrer"`.

## Modelo de dados

`CustomMenuGroup`

| Campo       | Tipo        | Observações                                  |
| ----------- | ----------- | -------------------------------------------- |
| `id`        | `uuid` PK   |                                              |
| `tenantId`  | `uuid` FK   | `ON DELETE CASCADE` em `Tenant`               |
| `name`      | `text`      | obrigatório                                   |
| `icon`      | `text?`     | chave de ícone da lista suportada             |
| `active`    | `boolean`   | default `true`                                |
| `position`  | `integer`   | ordem do grupo                                |
| `createdAt` | `timestamp` |                                              |
| `updatedAt` | `timestamp` |                                              |

`CustomMenuButton`

| Campo       | Tipo        | Observações                                  |
| ----------- | ----------- | -------------------------------------------- |
| `id`        | `uuid` PK   |                                              |
| `tenantId`  | `uuid` FK   | `ON DELETE CASCADE` em `Tenant`               |
| `groupId`   | `uuid` FK   | `ON DELETE CASCADE` em `CustomMenuGroup`      |
| `name`      | `text`      | obrigatório                                   |
| `url`       | `text`      | validada como `http` ou `https`              |
| `icon`      | `text?`     | chave de ícone da lista suportada             |
| `active`    | `boolean`   | default `true`                                |
| `position`  | `integer`   | ordem dentro do grupo                         |
| `createdAt` | `timestamp` |                                              |
| `updatedAt` | `timestamp` |                                              |

Migration: `20261020230000_custom_menu` (apenas criação de tabelas, índices e FKs).

## Endpoints

Todos exigem membership ativa. O tenant vem do token verificado (`TenantContext`), nunca do cliente.

| Método   | Rota                                   | Papel              | Descrição                                  |
| -------- | -------------------------------------- | ------------------ | ------------------------------------------ |
| `GET`    | `/api/custom-menu`                     | todos              | Lista grupos e botões (configuração)       |
| `GET`    | `/api/custom-menu/navigation`          | todos              | Grupos ativos com botões ativos            |
| `PUT`    | `/api/custom-menu`                     | `OWNER`, `ADMIN`   | Salva a configuração completa em transação |
| `POST`   | `/api/custom-menu/groups`              | `OWNER`, `ADMIN`   | Cria grupo (com botões opcionais)          |
| `PATCH`  | `/api/custom-menu/groups/:id`          | `OWNER`, `ADMIN`   | Edita nome, ícone, status e ordem          |
| `DELETE` | `/api/custom-menu/groups/:id`          | `OWNER`, `ADMIN`   | Exclui grupo e botões em cascata           |
| `POST`   | `/api/custom-menu/groups/:id/buttons`  | `OWNER`, `ADMIN`   | Cria botão no grupo                        |
| `PATCH`  | `/api/custom-menu/buttons/:id`         | `OWNER`, `ADMIN`   | Edita botão                                |
| `DELETE` | `/api/custom-menu/buttons/:id`         | `OWNER`, `ADMIN`   | Exclui botão                               |

O `PUT` substitui a configuração do tenant: grupos/botões ausentes são removidos, existentes com
`id` são atualizados e itens sem `id` são criados. A ordem enviada define `position`.

## Validação e segurança

- Nome de grupo/botão: obrigatório, não vazio, até 80 caracteres.
- URL: obrigatória, até 2048 caracteres, somente `http://` ou `https://`.
  `javascript:`, `data:`, `file:`, `ftp:` e URLs sem protocolo são rejeitadas no backend e no
  frontend.
- Ícone: apenas chaves da lista suportada pelo frontend.
- O backend não confia em `tenantId` enviado no corpo; campos desconhecidos são rejeitados pelo
  `ValidationPipe` global.
- IDs de grupos/botões de outro tenant resultam em `404`; não há leitura ou escrita cruzada.
- O frontend renderiza a URL apenas como atributo `href` de um link validado, nunca como HTML, e
  filtra URLs inseguras como defesa em profundidade.
- Não são usados iframes nem envio de cookies/tokens do CRM para os destinos externos.

## Frontend

- Aba `menu` em Configurações. O diálogo de grupo permite montar vários botões antes de persistir; ao
  clicar em **Salvar grupo**, a configuração é persistida e o menu lateral é atualizado.
- **Salvar alterações** persiste ajustes feitos fora do diálogo, como reordenar, ativar/desativar e
  excluir grupos ou botões.
- Botões para criar/editar/excluir/reordenar grupos e adicionar/editar/reordenar/excluir botões.
- O menu lateral consome `GET /api/custom-menu/navigation` com cache do TanStack Query por tenant.
  Salvar invalida/atualiza o cache, refletindo imediatamente no desktop e no mobile.
- Os grupos personalizados aparecem antes da entrada nativa **Configurações**.
- No menu recolhido, os botões aparecem como ícones com tooltip; no mobile, o drawer fecha ao clicar
  em um atalho, preservando o comportamento existente.

## Testes

- `backend/test/integration/custom-menu.integration-spec.ts`: CRUD, ordenação, validação de URL,
  autorização, cascata e isolamento entre tenants.
- `frontend/src/features/custom-menu/custom-menu-utils.test.ts`: validação e payload de salvamento.
- `frontend/src/components/layout/sidebar.test.tsx`: renderização de links externos seguros,
  `target="_blank"`/`rel` e filtragem de URLs inseguras.
