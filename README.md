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
- [docs/billing.md](./docs/billing.md) — cobranças e lembretes por WhatsApp.
- [docs/multi-tenancy.md](./docs/multi-tenancy.md) — isolamento entre tenants.
- [docs/authentication.md](./docs/authentication.md) — autenticação/autorização.
- [docs/como-executar.md](./docs/como-executar.md) — guia passo a passo para executar (infra, backend, frontend, Evolution).
- [docs/media.md](./docs/media.md) — envio/recebimento de imagens no Chat (otimização e storage).
- [docs/scheduled-messages.md](./docs/scheduled-messages.md) — campanhas e lembretes agendados.
- [docs/quick-replies.md](./docs/quick-replies.md) — respostas rápidas reutilizáveis no atendimento.
- [docs/custom-menu.md](./docs/custom-menu.md) — grupos e atalhos externos no menu personalizado.
- [docs/development.md](./docs/development.md) — como rodar, testar e validar.
- [docs/frontend.md](./docs/frontend.md) — frontend e design system.
- [docs/design.md](./docs/design.md) — identidade visual, tokens e diretrizes de UI.
- [docs/deploy.md](./docs/deploy.md) — deploy contínuo (GitHub Actions + Docker Compose).
- [docs/store-orders.md](./docs/store-orders.md) — integração das lojas e fluxo de Entregas.
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
npm run prisma:seed                  # cria usuário de dev (admin@orderup.com.br / admin12345)
npm run start:dev                    # http://localhost:3003/api/health
```

## Quickstart (frontend)

```bash
cd frontend
cp .env.example .env                 # opcional
npm install
npm run dev                          # http://localhost:5173 (proxy de /api para :3003)
```

Acesse `http://localhost:5173` e faça login com `admin@orderup.com.br` / `admin12345`. O app abre em
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

A porta `8080` fica exposta no host. A imagem padrão é `evoapicloud/evolution-api:2.4.0-rc2` e a chave
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
PUBLIC_API_URL=http://host.docker.internal:3003
```

Alternativas: um túnel (`ngrok http 3003` → `PUBLIC_API_URL=https://...`) ou, se backend e Evolution
estiverem no mesmo Docker network, `PUBLIC_API_URL=http://<host-do-backend>:3000`. Sem uma URL
alcançável, a configuração automática do webhook falha (`PUBLIC_API_URL_MISSING`).

### 4. Conectar um número

Em **Atendimento → WhatsApp**:

1. **Nova instância** (nome amigável, `instanceName` único, telefone e credenciais opcionais).
2. **Conectar** → exibe o QR code / código de pareamento.
3. Escaneie no aplicativo; o webhook (`MESSAGES_UPSERT`) é configurado automaticamente.
4. As mensagens recebidas criam o **Contato** (por telefone) e a **Conversa** vinculada à instância.

Detalhes técnicos em [docs/development.md](./docs/development.md).

## Deploy

O deploy é contínuo: cada `push` na branch `desenvolvimento` dispara o GitHub Actions, que conecta
por SSH no servidor e executa `scripts/deploy.sh` (build das imagens, migrations e `up -d` via
`docker-compose.prod.yml`).

Configure os segredos `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (e, opcionalmente,
`DEPLOY_PORT`/`DEPLOY_PATH`) e garanta o repositório clonado em `/home/crm` com `backend/.env` e um
`.env` na raiz (copiado de `.env.example`) para portas/credenciais do compose. Passo a passo em
[docs/deploy.md](./docs/deploy.md).

### Portas e URL da API no servidor

No desenvolvimento local, `backend/.env` define `PORT=3003` e o Vite encaminha `/api` e
`/socket.io` para `http://localhost:3003`. No deploy com `docker-compose.prod.yml`, o Compose
define `PORT=3000` **dentro do contêiner** e o nginx do frontend encaminha as chamadas para
`backend:3000`. Portanto, mudar `PORT` em `backend/.env` não altera a porta publicada pelo Docker.

No servidor, configure as portas no `.env` **da raiz do repositório** (copie de `.env.example`):

```env
HTTP_PORT=80
BACKEND_PORT=4100
```

`HTTP_PORT` publica o frontend/nginx; escolha outra porta livre se `80` já estiver ocupada e
aponte o proxy HTTPS para ela. `BACKEND_PORT` publica a API diretamente no host; escolha
outra porta livre, por exemplo `BACKEND_PORT=3003`, se `4100` não servir. Se o acesso externo
passa pelo proxy HTTPS, mantenha a porta direta da API restrita à rede de administração.
Não altere a porta interna `3000` do Compose nem o `frontend/nginx.conf` para essa troca.
Após editar o `.env`,
recrie o backend para aplicar o mapeamento:

```bash
cd /home/crm
docker compose -f docker-compose.prod.yml up -d backend
docker compose -f docker-compose.prod.yml ps
curl -i http://127.0.0.1:4100/api/health  # troque 4100 pela sua BACKEND_PORT
```

Com um domínio HTTPS apontando para o frontend/nginx, a URL pública da API é a **mesma origem**
do CRM, por exemplo `https://crm.seudominio.com/api/health`. O frontend deve manter
`VITE_API_BASE_URL` vazio: o nginx já encaminha `/api` e `/socket.io`. O proxy HTTPS externo
também precisa permitir o upgrade de WebSocket em `/socket.io/` para atualizar Entregas sem
recarregar a página. Veja a configuração do proxy em [docs/deploy.md](./docs/deploy.md).

No `backend/.env` do servidor, configure pelo menos o domínio da aplicação, a URL alcançável
pela Evolution e os e-mails autorizados a administrar organizações:

```env
APP_URL=https://crm.seudominio.com
PUBLIC_API_URL=https://crm.seudominio.com
CORS_ORIGINS=https://crm.seudominio.com
AUTH_COOKIE_SECURE=true
PLATFORM_ADMIN_EMAILS=admin@seudominio.com
```

Use um usuário existente e ativo em `PLATFORM_ADMIN_EMAILS`. As demais variáveis e segredos
obrigatórios estão em `backend/.env.example` e [docs/deploy.md](./docs/deploy.md). Reinicie o
backend após alterar `backend/.env`. Não coloque credenciais reais no README ou no Git.

### Conectar cada sistema de pedidos ao CRM

Em **Administração → Organizações → Módulos**, mantenha **Entregas** habilitado para a organização.
Depois, em **Configurações → Lojas**, cadastre cada instalação da loja e copie o **ID da loja**
(UUID) e a **credencial** (`whk_...`). O código da loja não substitui o ID. Se perdeu a credencial,
use **Renovar credencial**; a anterior deixa de funcionar imediatamente.

No `.env` **da raiz de cada instalação** do sistema de pedidos, configure valores próprios:

```env
CRM_API_BASE_URL=https://crm.seudominio.com
CRM_STORE_ID=<UUID exibido em Configurações → Lojas>
CRM_STORE_SECRET=<credencial whk_ exibida no cadastro ou renovação>
```

`CRM_API_BASE_URL` é a origem da API, sem `/api` no fim. Em produção, a integração exige HTTPS;
`http://localhost` só é aceito para testes na mesma máquina. Dentro de um contêiner,
`localhost` aponta para o próprio contêiner, então use o domínio HTTPS alcançável pela loja.
Reinicie cada sistema de pedidos após editar seu `.env`.

Para validar, aprove **um pedido novo** na loja. Ele deve entrar em **Entregas → Pendentes**
como `PENDENTE_SEPARACAO`. O envio ocorre em segundo plano; se falhar, a aprovação permanece
na fila local e é repetida. Consulte o estado da fila no banco **da loja**:

```sql
SELECT pvcod, approved_at, delivered_at, attempts, next_attempt_at, last_error
FROM crm_order_approval_outbox
ORDER BY approved_at DESC
LIMIT 20;
```

`delivered_at` preenchido indica que o CRM recebeu o pedido. Consulte
[docs/store-orders.md](./docs/store-orders.md) para o contrato da integração. A movimentação
de status feita no CRM ainda não é enviada de volta ao sistema de pedidos; isso será uma etapa
separada.
