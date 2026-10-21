# Respostas rápidas — OrderUp CRM

Modelos de mensagem reutilizáveis no atendimento, escopados por organização (tenant). A tela fica
em **Ferramentas → Respostas rápidas** (`/respostas-rapidas`) e usa o módulo `attendance`.

## Modelo

`QuickReply`: `id`, `tenantId`, `title`, `content`, `createdAt`, `updatedAt`.

- Título único por tenant (`UNIQUE (tenant_id, title)`).
- Índice `(tenant_id, created_at)` para listagem.
- Remoção em cascata junto com o tenant.

## Endpoints

| Método | Rota                        | Permissão       |
| ------ | --------------------------- | --------------- |
| GET    | `/api/quick-replies`        | autenticado     |
| GET    | `/api/quick-replies/:id`    | autenticado     |
| POST   | `/api/quick-replies`        | OWNER/ADMIN     |
| PATCH  | `/api/quick-replies/:id`    | OWNER/ADMIN     |
| DELETE | `/api/quick-replies/:id`    | OWNER/ADMIN     |

Todos os endpoints exigem o módulo `attendance` habilitado para o tenant. O `tenantId` é sempre
derivado do token verificado + membership ativa; nunca é aceito no corpo ou na query.

## Frontend

- Listagem com busca por título ou conteúdo e ações de criar, editar e excluir para OWNER/ADMIN.
- Usuários com papel `USER` podem consultar as respostas, mas não alterá-las.
- Rota protegida por `ProtectedRoute` + `ModuleRoute`, disponível no menu desktop e mobile.

## Testes

- `backend/test/integration/quick-replies.integration-spec.ts` cobre CRUD, validação, duplicidade por
  tenant, busca/paginação, permissões e isolamento entre tenants.
- `frontend/src/config/navigation.test.ts` garante que as ferramentas fiquem no grupo `Ferramentas`.
