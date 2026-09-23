# OrderUp CRM

CRM multi-tenant enxuto focado em **Multi WhatsApp + Chat centralizado + Contatos**, com
autenticação, multi-tenancy e configurações essenciais.

O produto está consolidado no seguinte núcleo:

```text
WhatsApp (múltiplas instâncias)
        ↓
Chat (todas as conversas, filtro por WhatsApp)
        ↓
Contatos (histórico de conversas por contato)
```

## Documentação

- [AGENTS.md](./AGENTS.md) — regras obrigatórias para agentes de IA e desenvolvedores.
- [docs/architecture.md](./docs/architecture.md) — visão geral da arquitetura.
- [docs/database.md](./docs/database.md) — banco, modelagem e migrations.
- [docs/multi-tenancy.md](./docs/multi-tenancy.md) — isolamento entre tenants.
- [docs/authentication.md](./docs/authentication.md) — autenticação/autorização.
- [docs/como-executar.md](./docs/como-executar.md) — guia passo a passo para executar (infra, backend, frontend, Evolution).
- [docs/development.md](./docs/development.md) — como rodar, testar e validar.
- [docs/frontend.md](./docs/frontend.md) — frontend e design system.
- [docs/hardening.md](./docs/hardening.md) — auditoria de segurança/performance.
- [docs/auditoria-mvp.md](./docs/auditoria-mvp.md) — auditoria do CRM e definição do MVP.
- [docs/auditoria-etapa8.md](./docs/auditoria-etapa8.md) — análise de impacto da limpeza.
- [docs/decisions/](./docs/decisions/) — decisões arquiteturais (ADRs).

> Documentos de fases antigas (`sales.md`, `crm-core.md`, `ai.md`, `qualification-bot.md`,
> `mvp-bot-qualificador.md`, `lgpd*.md`) são **históricos**: descrevem funcionalidades removidas na
> limpeza do legado.

## Estrutura

```text
.
├── AGENTS.md
├── README.md
├── docker-compose.yml            # Postgres + Redis (infra local do CRM)
├── docker-compose.evolution.yml  # Evolution API + Postgres/Redis próprios (WhatsApp)
├── docs/
├── backend/                      # API NestJS + Fastify
└── frontend/                     # React + Vite + Tailwind + shadcn/ui
```

## Quickstart (infra)

```bash
docker compose up -d                 # Postgres e Redis do CRM
docker compose ps
```

## Quickstart (backend)

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:deploy                # aplica as migrations (ou prisma:migrate em dev)
npm run prisma:seed                  # cria usuário de dev (admin@orderup.local / admin12345)
npm run start:dev                    # http://localhost:3000/api/health
```

## Quickstart (frontend)

```bash
cd frontend
cp .env.example .env                 # opcional
npm install
npm run dev                          # http://localhost:5173 (proxy de /api para :3000)
```

Acesse `http://localhost:5173` e faça login com `admin@orderup.local` / `admin12345`. O app abre em
**Atendimento → Conversas**.

## WhatsApp (Evolution API)

A Evolution API é um **serviço externo**, executado por um compose separado.

### 1. Subir a Evolution

```bash
# junto com a infra do CRM (mesma rede)
docker compose -f docker-compose.yml -f docker-compose.evolution.yml up -d

# ou isolada
docker compose -f docker-compose.evolution.yml up -d
```

A porta `8080` fica exposta no host. A imagem padrão é `evoapicloud/evolution-api:v2.3.7` e a chave
padrão é `change-me-evolution-api-key` (mude em produção).

### 2. Configurar o backend (`backend/.env`)

```env
EVOLUTION_API_BASE_URL=http://localhost:8080
EVOLUTION_API_KEY=change-me-evolution-api-key          # igual ao AUTHENTICATION_API_KEY
EVOLUTION_WEBHOOK_SECRET=change-me-webhook-secret
CREDENTIALS_ENCRYPTION_KEY=<segredo com 32+ caracteres>
PUBLIC_API_URL=https://<url-publica-do-backend>        # precisa ser alcançável PELA Evolution
```

Reinicie o backend após editar o `.env`.

### 3. Webhook (dev)

A Evolution precisa **alcançar o backend** para entregar mensagens. O compose da Evolution já inclui
`host.docker.internal`, então, com o backend rodando no host, use:

```env
PUBLIC_API_URL=http://host.docker.internal:3000
```

Alternativas: um túnel (`ngrok http 3000` → `PUBLIC_API_URL=https://...`) ou, se backend e Evolution
estiverem no mesmo Docker network, `PUBLIC_API_URL=http://<host-do-backend>:3000`. Sem uma URL
alcançável, a configuração automática do webhook falha (`PUBLIC_API_URL_MISSING`).

### 4. Conectar um número

Em **Atendimento → WhatsApp**:

1. **Nova instância** (nome amigável, `instanceName` único, telefone e credenciais opcionais).
2. **Conectar** → exibe o QR code / código de pareamento.
3. Escaneie no aplicativo; o webhook (`MESSAGES_UPSERT`) é configurado automaticamente.
4. As mensagens recebidas criam o **Contato** (por telefone) e a **Conversa** vinculada à instância.

Detalhes técnicos em [docs/development.md](./docs/development.md).
