# Módulos por organização — OrderUp CRM

> Status: **Implementado**. Gestão centralizada da disponibilidade de módulos por organização
> (`Tenant`), exclusiva do administrador da plataforma ERP.

## Objetivo

Permitir que o administrador da plataforma habilite ou desabilite módulos para cada organização,
sem afetar as demais. Exemplo: desativar a **Régua de Cobrança** da Empresa A; a funcionalidade
deixa de aparecer e de operar na Empresa A, mas continua funcionando nas Empresas B e C.

A disponibilidade do módulo é **ortogonal** às permissões por papel (`Role`) e ao status de
assinatura comercial. Ela não concede nem remove autorização: apenas controla se o módulo está
ligado para a organização. Os guards de autenticação/autorização permanecem intactos.

## Modelagem

### `Module` (catálogo)

| Campo          | Descrição                                                        |
| -------------- | ---------------------------------------------------------------- |
| `key`          | identificador estável, independente do nome exibido (`unique`)   |
| `name`         | nome exibido na interface                                        |
| `description`  | texto auxiliar                                                   |
| `category`     | agrupamento visual (ex.: `Financeiro`)                           |
| `icon`         | nome de ícone (metadado de UI)                                   |
| `sortOrder`    | ordenação na interface                                           |
| `controllable` | se `false`, o módulo é sempre ativo e não pode ser controlado    |

### `TenantModule` (associação)

`tenantId` + `moduleId` (`UNIQUE (tenant_id, module_id)`), `enabled` (`boolean`), timestamps,
índices em `(tenant_id, enabled)` e `(module_id)`. FKs com `ON DELETE CASCADE` para `Tenant`/`Module`.

### Semântica

- **Ausência de linha `TenantModule` = módulo habilitado.** Organizações sem configuração explícita
  mantêm o comportamento anterior; a migration não desativa nada.
- Um módulo só fica desabilitado se houver uma linha explícita com `enabled = false`.
- `controllable = false` força ativo (defesa para módulos internos).

### Auditoria

Cada habilitação/desabilitação grava uma linha em `admin_audit_logs`
(`actorUserId`, `tenantId`, `action` = `MODULE_ENABLED`/`MODULE_DISABLED`, `entity = module`,
`entityId = key`, `metadata`). A tabela é isolada e não afeta dados de negócio.

## Catálogo inicial (seed da migration)

| key                  | nome               | categoria  |
| -------------------- | ------------------ | ---------- |
| `attendance`         | Atendimento        | CRM        |
| `contacts`           | Contatos           | CRM        |
| `billing.charges`    | Cobranças          | Financeiro |
| `billing.collection` | Régua de Cobrança  | Financeiro |

`billing.charges` e `billing.collection` são módulos **independentes**: é possível desativar a
Régua de Cobrança sem desativar o restante do Financeiro.

## Backend

Módulo NestJS `src/modules/modules/`:

- `ModulesService` — catálogo, estado por tenant, `isEnabled(tenantId, key)`, `listEnabledKeys` e
  `setModuleEnabledForTenant` (upsert + auditoria).
- `ModuleEnabledGuard` (global, `APP_GUARD`) — lê o metadado `@RequireModule('<key>')` do handler/
  controller e bloqueia com `403 MODULE_DISABLED` quando desabilitado. Usa o tenant do
  `TenantContext` (token verificado + membership), nunca do cliente.
- `ModulesController` — `GET /api/modules/enabled` (módulos habilitados da organização autenticada).

### Endpoints

| Método | Rota                                                | Acesso                      |
| ------ | --------------------------------------------------- | --------------------------- |
| GET    | `/api/modules/enabled`                              | autenticado                 |
| GET    | `/api/admin/modules`                                | administrador da plataforma |
| GET    | `/api/admin/tenants/:id/modules`                    | administrador da plataforma |
| PATCH  | `/api/admin/tenants/:id/modules/:moduleKey`         | administrador da plataforma |

`PATCH` recebe `{ "enabled": boolean }`. O administrador é identificado pelo mecanismo vigente
(`PlatformAdminGuard` + allowlist `PLATFORM_ADMIN_EMAILS`), reutilizado sem atalhos.

### Proteção de operações (não apenas da UI)

- `conversations` → `attendance`; `contacts` → `contacts`.
- `billing` (cobranças/recorrências) → `billing.charges`.
- `billing` (settings, lembretes, envio manual) → `billing.collection`.
- Jobs automáticos revalidam o módulo por tenant:
  - `BillingRemindersService.runScan/generateReminders/dispatch/processReminder` e
    `sendManual` checam `billing.collection`.
  - `BillingRecurrencesService.generateDue` checa `billing.charges`.
  - Um módulo desabilitado não gera novos lembretes nem envia; lembretes `PENDING` permanecem e
    voltam a fluir na reativação (sem reconstrução de dados).

Endpoints de saúde, autenticação e administração nunca são bloqueados.

## Frontend

- `GET /api/modules/enabled` alimenta a montagem do menu (`visibleNavigation`) e o guard de rotas
  (`ModuleRoute`). O frontend **não** usa lista fixa como fonte de verdade.
- Rotas de módulos desativados redirecionam para `/indisponivel`.
- A navegação administrativa (`/admin/*`) permanece disponível e é protegida por
  `PlatformAdminRoute` (espelho do `PlatformAdminGuard`).
- Em Administração → Organizações → organização → aba **Módulos**, o administrador da plataforma
  vê o catálogo, o estado de cada módulo e ativa/desativa com confirmação e feedback.
- Na tela de Cobranças, os controles da Régua de Cobrança (configuração, envio manual e histórico)
  são ocultados quando `billing.collection` está desabilitado.

## Cache e consistência

Não há camada de cache de permissões/navegação no backend: a leitura é sempre do PostgreSQL. No
frontend, o TanStack Query usa chave por tenant (`['modules','enabled',tenantId]`); a mutação
administrativa invalida `['modules']`. Sessões abertas são bloqueadas imediatamente pela API pelo
`ModuleEnabledGuard`; o menu é atualizado no próximo refetch (foco da janela/revalidação).

## Migrations

`20261017090000_modules` cria `modules`, `tenant_modules` e `admin_audit_logs` e insere o catálogo
de forma idempotente (`ON CONFLICT (key) DO NOTHING`). Nenhum dado de negócio é alterado e nenhuma
funcionalidade é desativada. Aplicar com `npm run prisma:deploy` (ou `npm run prisma:migrate` em dev).
