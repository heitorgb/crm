# Arquitetura — OrderUp CRM

Documento objetivo da arquitetura vigente. Diferencia claramente **Implementado**, **Planejado** e
**Futuro**. Não descreve funcionalidades que ainda não existem.

## Visão geral

O OrderUp CRM é um **monólito modular multi-tenant**. Um único deploy, com fronteiras internas
claras entre módulos. A decisão está registrada em
[`decisions/ADR-001-modular-monolith.md`](./decisions/ADR-001-modular-monolith.md).

### Stack

| Camada        | Tecnologia                                  | Status       |
| ------------- | ------------------------------------------- | ------------ |
| Aplicação     | NestJS 12 (ESM)                             | Implementado |
| HTTP adapter  | Fastify (`@nestjs/platform-fastify`)        | Implementado |
| ORM           | Prisma 7 + `@prisma/adapter-pg`             | Implementado |
| Banco         | PostgreSQL 16                               | Implementado |
| Cache/filas   | Redis (cliente lazy)                        | Implementado |
| Infra local   | Docker / Docker Compose                     | Implementado |
| Linguagem     | TypeScript `strict` (módulos NodeNext)      | Implementado |
| Testes        | Vitest (unit + e2e/integração)              | Implementado |
| CI            | GitHub Actions                              | Implementado |
| Frontend      | React 19 + Vite + Tailwind + shadcn/ui (TanStack Query, Zustand) | Implementado (fundação) |

## Estrutura do backend

```text
backend/src/
├── common/                 # cross-cutting
│   ├── errors/             # filtro global + AppException + erros conhecidos do Prisma
│   ├── logging/            # logger estruturado + normalização de requestId
│   └── tenant-context/     # AsyncLocalStorage (fundação)
├── config/                 # validação e tipagem de ambiente (APP/DATABASE/REDIS/LOGGING/AI)
├── infrastructure/         # Prisma e Redis
│   ├── prisma/
│   └── redis/
├── modules/                # módulos de negócio (por domínio)
│   ├── auth/               # login, tokens, guards (autenticação/autorização)
│   ├── health/
│   └── memberships/        # membership multi-tenant / resolução de contexto
├── app.module.ts
└── main.ts
```

Regra de dependência: **dependências apontam para dentro**. Módulos de negócio não se importam de
forma cíclica; `infrastructure/` não contém regra de negócio; `common/` não depende de módulos.

## Ciclo de vida de uma requisição (implementado)

1. Fastify recebe a requisição; `nestjs-pino` gera/propaga `requestId`.
2. O middleware de tenant-context cria um `RequestStore` vazio em `AsyncLocalStorage` para toda a
   requisição (`src/common/tenant-context/`).
3. `JwtAuthGuard` (global) valida o access token e a membership e preenche o `TenantContext` via
   `TenantContextService`. `RolesGuard` aplica `@Roles(...)`. Rotas `@Public()` (health, login,
   refresh, logout) são liberadas. Ver [`authentication.md`](./authentication.md).
4. Erros são normalizados pelo filtro global (`statusCode`, `code`, `message`, `details`).

## Health check

`GET /api/health` verifica **API, PostgreSQL e Redis**:

```json
{
  "status": "ok",
  "uptime": 12.34,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": { "api": "up", "database": "up", "redis": "up" }
}
```

Retorna `200` quando tudo está `up` e `503` quando alguma dependência está `down`. Cada verificação
tem timeout curto e **não expõe detalhes internos** (stack/mensagem do driver). É apropriado para
liveness/readiness; não usa `@nestjs/terminus` nesta fase.

## Pontos considerados corretos

- Monólito modular com NestJS + Fastify: simplicidade operacional e bom desempenho.
- PostgreSQL como fonte de verdade relacional.
- `AsyncLocalStorage` para o tenant context, evitando providers `REQUEST`-scoped.
- Separação explícita entre `common`, `config`, `infrastructure` e `modules`.
- Validação de ambiente na inicialização.
- Redis desacoplado (cliente lazy) para uso futuro em cache/filas/realtime.

## Ajustes e decisões tomadas nesta fundação

1. **Prisma 7 exige driver adapter.** Foi adicionado `@prisma/adapter-pg` e o client é instanciado
   com `connectionString` vindo da config validada.
2. **NestJS 12 é ESM-only.** O projeto adota `"type": "module"` e TypeScript com
   `module`/`moduleResolution` em `nodenext`. Imports relativos usam extensão `.js` (padrão ESM).
3. **Vitest no lugar de Jest.** Como o Nest 12 é ESM, o caminho de Jest + `ts-jest` para ESM é
   frágil. O scaffold canônico do Nest 12 usa Vitest, que roda TypeScript/ESM nativamente. ESLint +
   Prettier foram mantidos conforme especificado.
4. **Generator `prisma-client-js` (legacy).** O generator novo (`prisma-client`) emite ESM com
   imports de extensão `.ts` e `import.meta`, exigindo configuração extra de build/TypeScript. O
   legacy funciona corretamente via interop ESM do Node e é o caminho estável adotado.
5. **TypeScript 6.0.x (não 7.x).** É a maior versão suportada por `typescript-eslint` (`<6.1.0`) e
   alinhada ao `@nestjs/cli` 12. Subir para TS 7 só quando toda a cadeia suportar.
6. **Redis não conecta no boot.** O cliente usa `lazyConnect` e é criado sem abrir conexão,
   evitando acoplar o boot (e os testes) à disponibilidade do Redis enquanto não há uso funcional.
7. **Wildcard de middleware no Nest 12 / path-to-regexp v8.** O middleware de tenant-context é
   registrado com rota wildcard nomeada (`{ path: '*splat', method: RequestMethod.ALL }`), conforme
   exigido pela versão atual.
8. **UUID gerado pelo Prisma Client.** Os `id` usam `@default(uuid())` (geração client-side).
   Se houver necessidade de default no banco para inserts fora do Prisma, avaliar
   `dbgenerated("gen_random_uuid()")` em fase própria.
9. **Config agrupada por domínio.** As variáveis são validadas por grupos (APP, DATABASE, REDIS,
   LOGGING, AI). `AUTH` fica reservado para a fase de autenticação — nenhuma variável JWT é
   validada antes de existir consumidor.
10. **Segurança básica no bootstrap.** `@fastify/helmet`, CORS por origem (`CORS_ORIGINS`, sem `*`
    em produção), `ValidationPipe` global (`whitelist`/`forbidNonWhitelisted`) e `bodyLimit` de 1 MB.
11. **requestId seguro.** Entrada `x-request-id` só é aceita se casar com um padrão restrito; caso
    contrário, um UUID é gerado. O id é devolvido no header `x-request-id` e propaga nos logs.
12. **Erros conhecidos do Prisma** (ex.: `P2002`, `P2025`) são traduzidos para códigos estáveis; o
    erro bruto do driver nunca chega ao cliente e stack trace não é exposta.

## Planejado

- Módulos de CRM (Customer, Contact, Lead, Pipeline, Deal, Task) — um por vez, em fases.
- Multi-tenancy com RLS como defesa em profundidade.
- Filas (BullMQ sobre Redis), realtime (Socket.IO) e IA — quando houver requisito.

## Futuro

- Integração WhatsApp (Evolution API), dashboards e relatórios.
- Telas de CRM no frontend (Leads, Funil, Negócios, Clientes, Conversas) sobre a fundação já criada.

> A identidade visual do frontend é derivada de https://orderup.com.br/ (tokens, tipografia e logo
> oficiais). Ver [`frontend.md`](./frontend.md).
