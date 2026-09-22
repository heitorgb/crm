# Frontend — OrderUp CRM

> Status: **Fundação (Prompt 04) + CRM Core (Prompt 05) + Vendas (Prompt 06) + Atendimento (Prompt 07)**.
> Design system, layout e tema, e as telas de Clientes/Contatos/Tags/Bot de Qualificação, Vendas
> (Leads, Kanban, Negócios, Pipelines, Tarefas) e Atendimento (Conversas com realtime, Tickets,
> Resumo de Leads) conectadas à API via TanStack Query. Relatórios segue como placeholder.

## Stack

| Camada       | Tecnologia                                   |
| ------------ | -------------------------------------------- |
| Base         | React 19 + Vite (TypeScript `strict`)        |
| Estilo       | Tailwind CSS 3 + shadcn/ui (Radix)           |
| Dados        | TanStack Query                                |
| UI state     | Zustand (sidebar, tema, preferências)        |
| Rotas        | React Router                                  |
| Ícones       | lucide-react                                  |
| Datas        | date-fns / Intl                               |

Sem Next.js.

## Como executar

```bash
cd frontend
cp .env.example .env      # opcional
npm install
npm run dev               # http://localhost:5173
npm run lint
npm run typecheck
npm run build
npm run preview
```

O Vite faz proxy de `/api` para `http://localhost:3000` (backend). Para apontar para outra API, use
`VITE_API_BASE_URL`.

Login real usa `POST /api/auth/login` (access token em memória/cookie HttpOnly do refresh). A opção
**Explorar demonstração** cria uma sessão fictícia em `sessionStorage` para navegar pela UI sem
backend — claramente rotulada e sem simular regras de negócio.

## Identidade visual (tokens)

Extraídos de https://orderup.com.br/ (CSS oficial) e adaptados para light/dark. O padrão é **Light**.

| Token                     | Light                    | Dark                      |
| ------------------------- | ------------------------ | ------------------------- |
| `background`              | `#F6F7FB`                | `#070A12`                 |
| `foreground`              | `#0B1020`                | `#E6E8F2`                 |
| `surface` / `surface-hover` | `#FFFFFF` / `#EEF0F7`  | `#0B1020` / `#121A2E`     |
| `border`                  | `#E3E6F0`                | `rgba(255,255,255,.08)`   |
| `muted` / `muted-foreground` | `#F1F3F9` / `#6B7280` | `#131A2B` / `#8A8FA6`     |
| `brand-primary`           | `#22C55E`                | `#22C55E`                 |
| `brand-primary-hover`     | `#16A34A`                | `#34D399`                 |
| `brand-primary-light`     | `#DCFCE7`                | `#123324`                 |
| `success` / `warning`     | `#16A34A` / `#D97706`    | `#22C55E` / `#FACC15`     |
| `danger` / `info`         | `#DC2626` / `#06B6D4`    | `#F87171` / `#22D3EE`     |

- Tipografia: **Inter** (sans) e **JetBrains Mono** (mono) — as mesmas do site oficial.
- Raios: `--radius-sm 8px`, `--radius-md 10px`, `--radius-lg 14px`, `--radius-xl 18px`.
- Gradiente de marca: `linear-gradient(135deg, #22C55E, #06B6D4, #A855F7)` (`.brand-gradient`).
- HEX nunca é espalhado nos componentes: tudo consome tokens em `src/index.css` + `tailwind.config.ts`.

### Assets

- Logo oficial: `frontend/public/images/logo-orderup.png` (baixado de `orderup.com.br/images/logo-orderup.png`).
  O logo **não** é recriado em texto; o rótulo "OrderUp CRM" é apenas a nomenclatura do produto.

## Tema

`light` (padrão), `dark` e `system`, controlados por `ThemeProvider` + `theme-store`. Um script inline
em `index.html` aplica o tema antes do primeiro paint (sem flash). Os mesmos componentes e tokens são
usados nos dois temas.

## Estrutura

```text
frontend/
├── public/images/logo-orderup.png
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn/ui customizado (button, input, select, dialog, drawer, …)
│   │   ├── layout/          # AppLayout, Sidebar, Header, MainContent
│   │   ├── common/          # PageHeader, SearchInput, StatusBadge, EmptyState, MetricCard, …
│   │   ├── qualification/   # componentes de qualificação/IA
│   │   └── digest/          # DigestScheduleForm, DigestPreview
│   ├── features/
│   │   ├── auth/            # login + queries (services, hooks)
│   │   ├── dashboard/       # tela inicial
│   │   ├── settings/        # bot e qualificação, resumo de leads
│   │   ├── placeholder/     # módulos futuros
│   │   └── not-found/
│   ├── stores/              # auth, theme, ui (Zustand)
│   ├── providers/           # AppProviders, ThemeProvider
│   ├── router/              # rotas + ProtectedRoute
│   ├── lib/                 # cn, api-client, query-client, format
│   ├── config/navigation.ts
│   ├── mocks/               # dados fictícios apenas para demonstração visual
│   ├── types/
│   └── index.css            # design tokens
└── tailwind.config.ts
```

## Design system

- **shadcn/ui**: `Button`, `Input`, `Textarea`, `Label`, `Select`, `Dialog`, `Sheet` (drawer),
  `DropdownMenu`, `Tabs`, `Badge`, `Tooltip`, `Card`, `Table`, `Popover`, `Separator`, `Avatar`,
  `Switch`, `Skeleton` — customizados com os tokens da marca (sem aparência genérica).
- **Componentes próprios**: `PageHeader`, `SearchInput`, `StatusBadge`, `EmptyState`,
  `ConfirmDialog`, `FormField`, `MetricCard`, `UserAvatar`, `TenantSelector`, `PageLoader`,
  `Pagination`, `DatePicker`.

## Qualificação e IA (visual)

`QualificationScore`, `QualificationBadge`, `QualificationStatusBadge`, `QualificationProgress`,
`AiAnalysisCard`, `AiAnalysisSkeleton`, `AiAnalysisEmptyState`, `DigestScheduleForm`, `DigestPreview`.

- Status representados: `BOT_QUALIFYING`, `QUALIFIED`, `DISQUALIFIED`, `NEEDS_HUMAN`,
  `WAITING_DIGEST`, `HANDED_OFF` — sempre com **ícone + texto**, nunca apenas cor.
- A análise mostra score, nível, resumo, dados coletados, pontos positivos, riscos, informações
  ausentes, próxima ação e data, com selo **"Gerado por IA"** e aviso de revisão humana.
- O frontend **nunca** chama provedor de IA nem recebe `AI_API_KEY`.

## Rotas

- `/login` (público), `/dashboard` (protegido).
- CRM Core (conectado à API): `/clientes/clientes`, `/clientes/clientes/:id`, `/clientes/contatos`,
  `/clientes/tags` e `/settings/qualification-bot`.
- Vendas (conectado à API): `/vendas/leads`, `/vendas/funil` (Kanban com drag and drop persistido),
  `/vendas/negocios`, `/tarefas` e `/settings/pipelines` (CRUD de pipelines/etapas).
- Atendimento (conectado à API + Socket.IO): `/atendimento/conversas` (3 colunas, painel do cliente
  recolhível), `/atendimento/tickets` e `/atendimento/whatsapp` (instâncias, conexão por QR code e
  webhook).
- Sidebar: Vendas, Clientes (Clientes, Contatos, Tags), Atendimento (Conversas, Tickets, WhatsApp),
  Tarefas, Relatórios e Configurações (Bot e Qualificação, Resumo de Leads, Pipelines). Relatórios
  ainda é placeholder.
- `/settings/qualification-bot` e `/settings/lead-digest` com formulários orientados a negócio (sem
  pedir prompts técnicos). O bot de qualificação persiste perfis reais por tenant.
- `ProtectedRoute` preparado para exigir sessão; a persistência real do refresh usa cookie HttpOnly.

## Responsividade e UX

- Layout testado para `1366x768` e menores (sidebar recolhível de `68px`, drawer no mobile).
- Estados de loading (skeletons), empty states, feedback de erro, foco visível e `aria-*` básicos.
- Sem gradientes/sombras exagerados, cards gigantes ou telas poluídas.

## O que é mock (e por quê)

`src/mocks/crm.ts` contém métricas, leads e uma análise de exemplo. São dados **fictícios** usados
apenas para compor a tela inicial, porque os módulos de Leads/qualificação ainda não existem no
backend. Clientes, Contatos, Tags e perfis do bot já usam a API real. Nenhuma regra de negócio é
simulada.
