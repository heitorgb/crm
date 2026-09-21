# Multi-tenancy — OrderUp CRM

## Modelo

- `Tenant` representa a organização.
- `User` é **global** (uma pessoa, potencialmente em vários tenants).
- `TenantUser` é a **membership**: liga `User` e `Tenant`, e carrega `role` e `active`.
- `membershipId` no contexto corresponde ao `id` de `TenantUser`.
- Apenas membership **ativa** (`active = true`) concede acesso. Inativar é o soft delete do vínculo.

### Membership (implementado)

`TenantUser`: `id` (uuid), `tenantId`, `userId`, `role`, `active` (default `true`), timestamps.
Constraints: `UNIQUE (tenantId, userId)` e índice em `userId`. `Tenant`/`User` usam `ON DELETE CASCADE`.

`MembershipsService` (`src/modules/memberships/`) concentra as operações de vínculo:

- `resolveContext(userId, tenantId)` — valida a membership ativa e produz o `TenantContext` (base do
  futuro guard de autenticação). Sem membership ativa → `TENANT_ACCESS_DENIED` (403).
- `listActiveMembers()` / `findMember(id)` — leituras **sempre** escopadas pelo `tenantId` do
  contexto (nunca por parâmetro do cliente).
- `deactivateMember(id)` / `removeMember(id)` — mutações escopadas; afetam **0 linhas** de outro
  tenant e resultam em `MEMBERSHIP_NOT_FOUND` (404).

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
- `setContext(ctx)` — preenchido pelo guard de autenticação; rejeita contexto **incompleto**
  (`INVALID_TENANT_CONTEXT`) e exige store ativo.
- `requireContext()` — retorna o contexto ou lança `TENANT_CONTEXT_UNAVAILABLE`.
- `clearContext()` — remove o contexto do store atual de forma segura (não lança sem store).
- `getRequestId()` — identificador da requisição para logs.

Decisões:

- **`AsyncLocalStorage`**, não provider `REQUEST`-scoped: evita propagar escopo de request por toda
  a árvore de DI.
- **Sem variável global mutável** para armazenar tenant.
- O contexto é criado por um middleware para **toda** requisição; é preenchido pelo `JwtAuthGuard`
  (implementado) após validar o access token e a membership ativa. Ver
  [`authentication.md`](./authentication.md).
- O contexto nunca é **parcial**: operações autenticadas usam `requireContext()`, que só retorna com
  os quatro campos preenchidos.

## Onde o contexto se perde (atenção)

`AsyncLocalStorage` propaga por continuidades assíncronas disparadas dentro de `run(...)`. Ele
**não** propaga automaticamente para:

- timers/intervalos criados fora do escopo;
- `EventEmitter` que entrega em outro tick sem binding;
- callbacks executados por libs nativas;
- **workers de fila** (BullMQ), que rodam em outro request/processo.

Por isso, o item 5: todo job deve carregar `tenantId` e chamar
`tenantContextService.run({ tenant: ... }, ...)` no início da execução.

## Isolamento em duas camadas

1. **Application-level isolation (implementado).** Toda query de negócio inclui `tenantId` derivado
   do `TenantContext` (`requireContext()`), nunca de entrada do cliente. É a barreira principal e
   existe desde agora, mesmo sem RLS.
2. **PostgreSQL RLS (defesa em profundidade — planejado).** Adicionada por entidade quando ela
   existir, não em massa. RLS **não substitui** a camada de aplicação.

## Como novos módulos devem respeitar multi-tenancy

- Toda entidade de tenant possui `tenantId` (uuid) e é criada dentro do mesmo domínio do módulo.
- Services leem o tenant de `TenantContextService.requireContext()`. **Proibido** aceitar
  `tenantId` de body, query, params ou header — inclusive `X-Tenant-Id`.
- Toda leitura usa `where: { tenantId }`; atualizações/exclusões usam o filtro composto
  (`where: { id, tenantId }`) e tratam `count === 0` como não encontrado.
- Derivação de tenant só por: token verificado + membership ativa (`MembershipsService.resolveContext`).
- Jobs assíncronos carregam `tenantId` explícito no payload e reestabelecem o contexto com
  `tenantContextService.run({ tenant }, fn)` no início da execução.
- Cache sempre com namespace: `tenant:{tenantId}:...`.
- Testes de isolamento (A→A permitido, A→B negado) são obrigatórios para novos módulos.

## RLS — decisões para a implementação futura

- **Role da aplicação:** sem `BYPASSRLS` e não owner das tabelas (owner/superuser ignoram RLS por
  padrão). Criação da role e das policies em migration própria.
- **GUC de sessão:** `app.current_tenant` definido com `SET LOCAL` **dentro da mesma transação** das
  queries. O Prisma usa pool de conexões; `SET` sem `LOCAL` vazaria entre requisições.
- **Prisma:** com `@prisma/adapter-pg`, implementar via `$transaction` + `SET LOCAL` em uma extensão
  do client (ou helper `withTenantTransaction`). A policy usa
  `current_setting('app.current_tenant', true)::uuid` comparado a `tenant_id`.
- **PgBouncer** em modo `transaction` exige cuidado extra com GUCs de sessão.
- **Rollout:** habilitar tabela a tabela, junto com seus testes de isolamento; sem RLS em tabelas
  inexistentes.

## Bot, IA e digests

O bot de qualificação obedece **exatamente** às mesmas regras de isolamento do restante do CRM.
Futuras entidades — `QualificationProfile`, `LeadQualificationSession`, `LeadAnalysis`,
`LeadDigestPreference`, `LeadDigestDelivery` — são dados de tenant e por isso **sempre** terão
`tenantId`.

Regras obrigatórias:

- Um tenant nunca pode ler, reutilizar ou inferir contexto de qualificação de outro tenant.
- O perfil/configuração do bot é carregado pelo tenant identificado de forma confiável.
- `tenantId` nunca é aceito cegamente do frontend.
- No WhatsApp, o tenant é identificado pela `WhatsAppInstance` **validada** (canal/instância), nunca
  pelo payload da mensagem.
- Jobs do bot, análise e digest carregam `tenantId` explícito e reestabelecem o contexto no início.
- Cache usa namespace por tenant (`tenant:{tenantId}:...`).
- Sessões de qualificação nunca atravessam tenants.
- Preferências de digest pertencem ao usuário/membership dentro de um tenant.
- Uma entrega agendada jamais pode incluir leads de outro tenant.
- Cada análise futura registra qual versão do perfil/contexto foi utilizada.

Ver também [`qualification-bot.md`](./qualification-bot.md), [`ai.md`](./ai.md) e
[`mvp-bot-qualificador.md`](./mvp-bot-qualificador.md).

## LGPD — retenção e sensibilidade (planejado)

Padrões que as futuras entidades de tenant devem seguir (sem rotina de expurgo nesta etapa):

- Toda entidade que armazene dado pessoal de Lead/Customer/Contact documenta um **prazo de retenção
  esperado** no schema; o job de expurgo vem em etapa própria (Prompt 09).
- O padrão `dataSensitivityLevel` (`low` | `medium` | `high`) poderá ser carregado por
  perfis/configurações de tenant (ex.: futuro `QualificationProfile`) para controles proporcionais ao
  risco — por exemplo, exigir revisão humana antes de uma decisão automatizada negativa em `high`.
- Toda decisão automatizada que afete um lead mantém **registro do motivo objetivo**, legível ao
  titular, viabilizando o direito de revisão do art. 20 da LGPD.
- `tenantId` é o limite de isolamento; `dataSensitivityLevel` é **ortogonal** e não o substitui.

Detalhes de schema em [`database.md`](./database.md).

## Planejado / Futuro

- Guard de autenticação que preenche o `TenantContext` após validar membership
  (`MembershipsService.resolveContext`).
- Helper de transação com escopo de tenant quando RLS entrar.
- RLS por entidade, junto com os testes de isolamento da tabela.
