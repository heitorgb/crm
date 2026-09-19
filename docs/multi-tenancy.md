# Multi-tenancy — OrderUp CRM

## Modelo

- `Tenant` representa a organização.
- `User` é **global** (uma pessoa, potencialmente em vários tenants).
- `TenantUser` é a **membership**: liga `User` e `Tenant`, e carrega o `role`.
- `membershipId` no contexto corresponde ao `id` de `TenantUser`.

## Regras obrigatórias

1. Toda entidade pertencente a um tenant possui `tenantId`.
2. Toda operação de negócio roda com escopo de tenant.
3. Nunca confiar em `tenantId` vindo do cliente (body, query, params, header).
4. Sempre validar membership ativa (`TenantUser`) do usuário autenticado no tenant.
5. Jobs assíncronos carregam `tenantId` explícito e reestabelecem o contexto no início.
6. Cache tem namespace por tenant: `tenant:{tenantId}:...`.
7. Eventos realtime são isolados por tenant (salas/canais).
8. Testes garantem isolamento (um tenant nunca lê/escreve dados de outro).

O tenant só é derivado de **token verificado + validação de membership**. Nunca do payload livre.

## TenantContext (implementado)

Fundação em `backend/src/common/tenant-context/`, baseada em `AsyncLocalStorage`.

```ts
export interface TenantContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: string;
}
```

- `TenantContextService.run(store, fn)` — executa `fn` dentro de um novo store.
- `getContext()` — retorna o `TenantContext` atual (ou `undefined`).
- `requireContext()` — retorna o contexto ou lança erro se ausente.
- `setContext(ctx)` — preenchido pelo guard de autenticação (fase planejada).
- `getRequestId()` — identificador da requisição para logs.

Decisões:

- **`AsyncLocalStorage`**, não provider `REQUEST`-scoped: evita propagar escopo de request por toda
  a árvore de DI.
- **Sem variável global mutável** para armazenar tenant.
- O contexto é criado por um middleware para **toda** requisição; fica vazio até a autenticação
  existir.

## Onde o contexto se perde (atenção)

`AsyncLocalStorage` propaga por continuidades assíncronas disparadas dentro de `run(...)`. Ele
**não** propaga automaticamente para:

- timers/intervalos criados fora do escopo;
- `EventEmitter` que entrega em outro tick sem binding;
- callbacks executados por libs nativas;
- **workers de fila** (BullMQ), que rodam em outro request/processo.

Por isso, o item 5: todo job deve carregar `tenantId` e chamar
`tenantContextService.run({ tenant: ... }, ...)` no início da execução.

## RLS (planejado — defesa em profundidade)

PostgreSQL Row Level Security será adicionado **depois** do escopo na aplicação. Pontos críticos:

- A aplicação acessa o banco com um **role sem `BYPASSRLS` e que não seja owner** das tabelas
  (owner e superuser ignoram RLS por padrão). Criação de role e policies entra em migration própria.
- A variável de sessão (ex.: `app.current_tenant`) deve ser definida com `SET LOCAL` **dentro da
  mesma transação** das queries, pois o Prisma usa pool de conexões e `SET` sem `LOCAL` vazaria
  entre requisições.
- Com `@prisma/adapter-pg`, implementar via `$transaction` + `SET LOCAL` em uma extensão do client.
- Se for usado PgBouncer em modo transaction, o uso de GUCs de sessão precisa de cuidado adicional.

RLS **não substitui** o filtro no application layer. A ausência de RLS nesta fase é consciente e
não autoriza consultas sem escopo de tenant.

## Planejado / Futuro

- Guard de autenticação que preenche o `TenantContext` após validar membership.
- Helper de transação com escopo de tenant quando RLS entrar.
- Testes de isolamento entre dois tenants.
