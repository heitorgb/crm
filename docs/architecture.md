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
| Frontend      | React + Vite (TanStack Query, Zustand, shadcn/ui) | Futuro |

## Estrutura do backend

```text
backend/src/
├── common/                 # cross-cutting
│   ├── errors/             # filtro global + AppException
│   └── tenant-context/     # AsyncLocalStorage (fundação)
├── config/                 # validação e tipagem de ambiente
├── infrastructure/         # Prisma e Redis
│   ├── prisma/
│   └── redis/
├── modules/                # módulos de negócio (por domínio)
│   └── health/
├── app.module.ts
└── main.ts
```

Regra de dependência: **dependências apontam para dentro**. Módulos de negócio não se importam de
forma cíclica; `infrastructure/` não contém regra de negócio; `common/` não depende de módulos.

## Ciclo de vida de uma requisição (implementado)

1. Fastify recebe a requisição; `nestjs-pino` gera/propaga `requestId`.
2. O middleware de tenant-context cria um `RequestStore` vazio em `AsyncLocalStorage` para toda a
   requisição (`src/common/tenant-context/`).
3. Guards/serviços acessam o contexto via `TenantContextService`. **Ainda não há autenticação**, então
   o contexto permanece vazio; o `TenantContext` será preenchido pelo guard de auth na fase de
   autenticação (ver [`authentication.md`](./authentication.md)).
4. Erros são normalizados pelo filtro global (`statusCode`, `code`, `message`, `details`).

## Health check

`GET /api/health` retorna `{ status: "ok", uptime, timestamp }`. É um **liveness** simples.
Health check profundo (banco/Redis) está planejado e poderá usar `@nestjs/terminus` quando houver
consumidor real.

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

## Planejado

- Autenticação/autorização JWT + refresh token com validação de membership.
- Módulos de CRM (Customer, Contact, Lead, Pipeline, Deal, Task) — um por vez, em fases.
- Multi-tenancy com RLS como defesa em profundidade.
- Filas (BullMQ sobre Redis), realtime (Socket.IO) e IA — quando houver requisito.

## Futuro

- Frontend React + Vite com TanStack Query, Zustand e shadcn/ui.
- Integração WhatsApp (Evolution API), dashboards e relatórios.

> A identidade visual do frontend será definida a partir de https://orderup.com.br/ quando a fase
> de frontend começar. Nenhuma cor/asset deve ser inventado antes da análise visual oficial.
