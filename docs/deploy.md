# Deploy — OrderUp CRM

Deploy contínuo para a branch **`desenvolvimento`** via GitHub Actions + SSH.

## Visão geral

```text
git push origin desenvolvimento
        │
        ▼
GitHub Actions (.github/workflows/deploy.yml)
        │  SSH (appleboy/ssh-action)
        ▼
Servidor: /home/crm
  scripts/deploy.sh
    ├─ git fetch/reset origin/desenvolvimento
    ├─ docker compose -f docker-compose.prod.yml -f docker-compose.evolution.yml build
    ├─ docker compose ... run --rm migrate   (prisma migrate deploy)
    └─ docker compose ... up -d postgres redis backend frontend evolution-postgres evolution-redis evolution
```

Arquivos envolvidos:

- `.github/workflows/deploy.yml` — workflow do GitHub Actions.
- `scripts/deploy.sh` — script executado **no servidor**.
- `docker-compose.prod.yml` — stack de produção (Postgres, Redis, `migrate`, `backend`, `frontend`).
- `docker-compose.evolution.yml` — Evolution API + Postgres/Redis próprios (WhatsApp), sobrepostos ao
  compose de produção pelo `deploy.sh`.
- `backend/Dockerfile` — imagem da API.
- `frontend/Dockerfile` + `frontend/nginx.conf` — build do Vite servido por nginx com proxy de
  `/api` e `/socket.io` para o backend.

## Segredos e variáveis (GitHub)

Configure em **Settings → Secrets and variables → Actions**:

| Nome              | Tipo     | Obrigatório | Descrição                                            |
| ----------------- | -------- | ----------- | ---------------------------------------------------- |
| `DEPLOY_HOST`     | secret   | sim         | Host/IP do servidor.                                 |
| `DEPLOY_USER`     | secret   | sim         | Usuário SSH.                                         |
| `DEPLOY_SSH_KEY`  | secret   | sim         | Chave privada SSH (com a pública no `authorized_keys`). |
| `DEPLOY_PORT`     | secret   | não         | Porta SSH (default `22`).                            |
| `DEPLOY_PATH`     | variable | não         | Caminho do repositório no servidor (default `/home/crm`). |

> A chave deve ser dedicada ao deploy e, de preferência, restrita no servidor.

## Pré-requisitos no servidor

1. `git`, `docker` e `docker compose` (v2) instalados.
2. Repositório clonado em `APP_DIR` (default `/home/crm`) com o remote `origin` apontando para o
   GitHub:

   ```bash
   git clone <url-do-repo> /home/crm
   cd /home/crm
   git checkout desenvolvimento
   ```

3. `backend/.env` preenchido (não versionado). Use `backend/.env.example` como base. Para produção,
   atenção a:

   ```env
   AUTH_COOKIE_SECURE=true
   AUTH_COOKIE_SAMESITE=lax        # ou none + domínio com HTTPS
   CORS_ORIGINS=https://<seu-dominio>
   API_PREFIX=api
   JWT_ACCESS_SECRET=<32+ chars>
   CREDENTIALS_ENCRYPTION_KEY=<32+ chars>
   PUBLIC_API_URL=https://<seu-dominio>   # alcançável PELA Evolution API
   ```

   `DATABASE_URL` e `REDIS_URL` são sobrescritos pelo compose (`postgres`/`redis` internos) — não
   precisa ajustá-los para o deploy.

4. `.env` na raiz do repositório (não versionado) com as variáveis do compose. Use
   `.env.example` como base:

   ```bash
   cd /home/crm
   cp .env.example .env
   # edite POSTGRES_PASSWORD, HTTP_PORT e BACKEND_PORT
   ```

   | Variável            | Descrição                                                          |
   | ------------------- | ------------------------------------------------------------------ |
   | `POSTGRES_USER`     | Usuário do banco (default `orderup`).                              |
   | `POSTGRES_PASSWORD` | Senha do banco — **altere em produção**.                           |
   | `POSTGRES_DB`       | Nome do banco (default `orderup`).                                 |
   | `HTTP_PORT`         | Porta pública do frontend/nginx (default `80`).                    |
   | `BACKEND_PORT`      | Porta **no host** para a API (default `4100`; a API escuta em `3000` dentro do container). |

   O compose lê esse `.env` automaticamente (mesmo diretório do `docker-compose.prod.yml`).
   Sem ele, valem os defaults do compose.

## Como funciona o deploy

O workflow é disparado a cada `push` em `desenvolvimento` (ou manualmente via *Run workflow*).
Ele conecta por SSH e executa `scripts/deploy.sh`, que:

1. `git fetch` + `git checkout` + `git reset --hard origin/desenvolvimento` (o `backend/.env` local é
   preservado, pois é ignorado pelo git);
2. constrói as imagens (`docker compose -f docker-compose.prod.yml -f docker-compose.evolution.yml build`);
3. aplica migrations (`docker compose ... run --rm migrate` → `prisma migrate deploy`);
4. sobe/atualiza os serviços (`up -d postgres redis backend frontend evolution-postgres evolution-redis evolution`);
5. limpa imagens órfãs e imprime o status.

Serviços e portas do `docker-compose.prod.yml`:

| Serviço    | Descrição                         | Porta no host              |
| ---------- | --------------------------------- | -------------------------- |
| `frontend` | nginx servindo o SPA + proxy API  | `${HTTP_PORT:-80}`         |
| `backend`  | API NestJS + Fastify              | `${BACKEND_PORT:-4100}`    |
| `postgres` | Banco do CRM                      | interna                    |
| `redis`    | Fila/realtime                     | interna                    |
| `migrate`  | aplica migrations e encerra       | —                          |

Serviços adicionais do `docker-compose.evolution.yml` (WhatsApp):

| Serviço             | Descrição                    | Porta no host              |
| ------------------- | ---------------------------- | -------------------------- |
| `evolution`         | Evolution API (WhatsApp)     | `${EVOLUTION_PORT:-8080}`  |
| `evolution-postgres`| Banco da Evolution           | interna                    |
| `evolution-redis`   | Redis da Evolution           | interna                    |

> A API escuta na porta **3000 dentro do container** (rede interna do compose). No host, publica-se
> `${BACKEND_PORT:-4100}`, evitando conflito com serviços que já usam a 3000 no servidor. Ajuste com
> `BACKEND_PORT` (ex.: `.env` na raiz) se precisar.

O frontend é servido na mesma origem do backend (proxy nginx), então `VITE_API_BASE_URL` deve ficar
**vazio** (default) no build.

## HTTPS

O compose publica o nginx em HTTP (`:80`). Termine TLS à frente (ex.: um proxy reverso no host,
Cloudflare, ou certbot no próprio servidor) e ajuste `AUTH_COOKIE_SECURE=true`, `CORS_ORIGINS` e
`PUBLIC_API_URL` para o domínio HTTPS.

## Evolution API (WhatsApp)

A Evolution (API + Postgres/Redis próprios) fica em `docker-compose.evolution.yml`, sobreposto ao
compose de produção pelo `deploy.sh` — ou seja, **sobe junto no deploy contínuo**. O `deploy.sh`
combina os dois arquivos (`-f docker-compose.prod.yml -f docker-compose.evolution.yml`), então os
serviços `evolution*` passam a pertencer ao mesmo projeto Compose (`orderup-crm`).

Para o webhook funcionar, `PUBLIC_API_URL` deve ser uma URL pública que **a Evolution consiga
alcançar** (ex.: `https://<seu-dominio>`), apontando para `POST /api/webhooks/evolution`.

> **Primeiro deploy com a Evolution integrada:** se os containers da Evolution já existiam no
> servidor subidos pelo compose isolado (projeto `crm`), os `container_name` fixos
> (`orderup-evolution*`) entram em conflito com o novo projeto. Antes do primeiro deploy, remova-os
> uma vez:
>
> ```bash
> cd /home/crm
> docker compose -f docker-compose.evolution.yml down
> ```

## Deploy manual (fallback)

No servidor:

```bash
cd /home/crm
APP_DIR=/home/crm DEPLOY_BRANCH=desenvolvimento bash scripts/deploy.sh
```

## Rollback

Reverter o commit na branch e deixar o deploy rodar, ou no servidor:

```bash
cd /home/crm
git reset --hard <commit-anterior>
docker compose -f docker-compose.prod.yml -f docker-compose.evolution.yml build
docker compose -f docker-compose.prod.yml -f docker-compose.evolution.yml up -d postgres redis backend frontend evolution-postgres evolution-redis evolution
```

> Migrations não são revertidas automaticamente; reverter schema exige uma migration específica.
