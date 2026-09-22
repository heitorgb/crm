# CRM Core — OrderUp CRM

> Status: **Implementado** (Prompt 05). Customer, Contact, Tag e QualificationProfile, com REST
> multi-tenant, autorização e frontend.

Este documento lista os endpoints, as decisões de schema e o que ficou deliberadamente fora de
escopo. Regras gerais de isolamento estão em [`multi-tenancy.md`](./multi-tenancy.md).

## Entidades

Todas possuem `tenantId` e são sempre escopadas pelo contexto derivado do token + membership. Nenhum
endpoint aceita `tenantId` do cliente.

### `Customer`

| Campo       | Tipo             | Observações                          |
| ----------- | ---------------- | ------------------------------------ |
| `id`        | `uuid` PK        |                                      |
| `tenantId`  | `uuid` FK        | `ON DELETE CASCADE`                  |
| `name`      | `text`           | obrigatório                          |
| `document`  | `text?`          | CPF/CNPJ; `UNIQUE (tenantId, document)` |
| `status`    | `CustomerStatus` | `ACTIVE` \| `INACTIVE` \| `ARCHIVED` |
| timestamps  |                  | `createdAt`, `updatedAt`             |

Índices: `(tenantId, status)` e `(tenantId, createdAt)`; o índice único cobre `(tenantId, document)`.

### `Contact`

Pertence a um `Customer` do mesmo tenant. `UNIQUE` não existe: um cliente tem vários contatos.
Campos: `name` (obrigatório), `email?`, `phone?`, `position?`, `isPrimary`, timestamps.
Índices: `(tenantId, customerId)` e `(tenantId, createdAt)`.

### `Tag` e `CustomerTag`

- `Tag`: `name` (obrigatório) e `color?` (hex). `UNIQUE (tenantId, name)`.
- `CustomerTag`: associação N:N (`PK (customerId, tagId)`) com `tenantId` denormalizado para o
  escopo de tenant e índice `(tenantId, tagId)`. A associação só é aceita se cliente e tag
  pertencerem ao mesmo tenant (validado no service).

### `QualificationProfile`

Perfil editável do bot de qualificação. Campos escalares: `name`, `description`, `businessContext`,
`botName`, `initialMessage`, `privacyNoticeText`, `tone`, `objective`, `customInstructions`,
`qualifiedMessage`, `disqualifiedMessage`, `needsHumanMessage`, `dataSensitivityLevel`
(`low` | `medium` | `high`, default `low`), `isDefault`, `active`, `version`, timestamps.

Campos JSON validados (estruturas genéricas, sem nicho): `requiredInformation` (`{key,label,description?,required?}`),
`qualificationCriteria`/`disqualificationCriteria` (`{key,label,description?,weight?}`),
`completionCriteria`, `humanHandoffRules` e `qualificationLevels` (`{key,label,description?}`).

Decisões:

- **Um único perfil padrão ativo por tenant** é garantido por índice único parcial:
  `UNIQUE (tenant_id) WHERE is_default AND active`. Ao definir um novo padrão, o service desmarca os
  demais na mesma transação.
- **Versão incrementa** apenas quando campos de conteúdo mudam. Ativar/desativar ou marcar/desmarcar
  padrão não incrementa. Futuras sessões/análises devem guardar `profileVersion`.
- **`privacyNoticeText`** não fica vazio com o perfil ativo: se o tenant não preencher, é aplicado
  um texto padrão genérico (`DEFAULT_PRIVACY_NOTICE`). Perfil inativo pode ficar sem aviso.
- **`dataSensitivityLevel`** é consultado pelo motor de qualificação (Prompt 06) para decidir se uma
  desqualificação pode ser automática.
- **`qualifiedMessage`/`disqualifiedMessage`/`needsHumanMessage`** substituem um campo único de
  conclusão e aceitam interpolação (ex.: `{{criterioNaoAtendido}}`), viabilizando o direito de
  explicação (art. 20 da LGPD).
- **Nada de API key/secret** na entidade. Instruções são configuração de negócio do tenant.

## Endpoints

Prefixo global `API_PREFIX` (default `api`). Todos exigem autenticação e membership; o tenant vem do
token. Formato de listagem: `{ data, meta: { page, perPage, total, totalPages } }`.

| Método | Rota                              | Papéis             |
| ------ | --------------------------------- | ------------------ |
| GET    | `/api/customers`                  | autenticado        |
| GET    | `/api/customers/:id`              | autenticado        |
| POST   | `/api/customers`                  | autenticado        |
| PATCH  | `/api/customers/:id`              | autenticado        |
| DELETE | `/api/customers/:id`              | `OWNER`, `ADMIN`   |
| GET    | `/api/contacts`                   | autenticado        |
| GET    | `/api/contacts/:id`               | autenticado        |
| POST   | `/api/contacts`                   | autenticado        |
| PATCH  | `/api/contacts/:id`               | autenticado        |
| DELETE | `/api/contacts/:id`               | `OWNER`, `ADMIN`   |
| GET    | `/api/tags`                       | autenticado        |
| GET    | `/api/tags/:id`                   | autenticado        |
| POST   | `/api/tags`                       | autenticado        |
| PATCH  | `/api/tags/:id`                   | autenticado        |
| DELETE | `/api/tags/:id`                   | `OWNER`, `ADMIN`   |
| GET    | `/api/qualification-profiles`     | autenticado        |
| GET    | `/api/qualification-profiles/:id` | autenticado        |
| POST   | `/api/qualification-profiles`     | `OWNER`, `ADMIN`   |
| PATCH  | `/api/qualification-profiles/:id` | `OWNER`, `ADMIN`   |
| DELETE | `/api/qualification-profiles/:id` | `OWNER`, `ADMIN`   |

### Query params de listagem

`page` (default 1), `perPage` (default 20, máx 100), `search`, `sort`, `order` (`asc`/`desc`).
Filtros específicos: `customers?status=&tagId=`, `contacts?customerId=`,
`qualification-profiles?active=&isDefault=`. Tags ordenam por `name` por padrão.

### Erros relevantes

- `CUSTOMER_DOCUMENT_CONFLICT` (409), `CUSTOMER_TAG_NOT_FOUND` (404).
- `CONTACT_CUSTOMER_NOT_FOUND` (404).
- `TAG_NAME_CONFLICT` (409).
- `QUALIFICATION_PROFILE_NOT_FOUND` (404).
- Cross-tenant: sempre `404` (leitura/escrita não encontram a linha do outro tenant).

## Frontend

Telas ligadas à API via TanStack Query (sem duplicar dados no Zustand):

- `/clientes/clientes` — lista com busca, filtro de status, paginação, estados de loading/empty/error.
- `/clientes/clientes/:id` — detalhe com dados, tags e contatos (CRUD de contato).
- `/clientes/contatos` — lista global com busca, filtro por cliente e paginação.
- `/clientes/tags` — gestão de tags (cor, contagem de clientes).
- `/settings/qualification-bot` — CRUD de perfis de qualificação com abas orientadas a negócio,
  aviso de privacidade, sensibilidade e perfil padrão.

Mutações invalidam as queries relacionadas; mensagens de erro usam o `message` padronizado da API.

## Fora de escopo (não implementado)

Leads, Pipeline, Deals, WhatsApp/Evolution API, filas, IA e expurgo LGPD (Prompt 09).
