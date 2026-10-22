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
    ├─ docker compose -f docker-compose.prod.yml build
    ├─ docker compose ... run --rm migrate   (prisma migrate deploy)
    └─ docker compose ... up -d postgres redis backend frontend
```

Arquivos envolvidos:

- `.github/workflows/deploy.yml` — workflow do GitHub Actions.
- `scripts/deploy.sh` — script executado **no servidor**.
- `docker-compose.prod.yml` — stack de produção (Postgres, Redis, `migrate`, `backend`, `frontend`).
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
   REFRESH_TOKEN_TTL_DAYS=1        # 24h de sessão desde o login
   CREDENTIALS_ENCRYPTION_KEY=<32+ chars>
   PUBLIC_API_URL=https://<seu-dominio>   # alcançável PELA Evolution API
   RESEND_API_KEY=<chave do Resend>
   RESEND_FROM_EMAIL=OrderUp CRM <noreply@mail.<seu-dominio>>
   APP_URL=https://<url-publica-do-frontend>   # usada no link de recuperação de senha
   ```

   O domínio de `RESEND_FROM_EMAIL` precisa estar verificado no Resend. Sem essas três variáveis, a
   recuperação de senha responde `503 EMAIL_NOT_CONFIGURED` e nenhum e-mail é enviado.

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
2. constrói as imagens (`docker compose -f docker-compose.prod.yml build`);
3. aplica migrations (`docker compose ... run --rm migrate` → `prisma migrate deploy`);
4. sobe/atualiza os serviços (`up -d postgres redis backend frontend`);
5. limpa imagens órfãs e imprime o status.

Serviços e portas do `docker-compose.prod.yml`:

| Serviço    | Descrição                         | Porta no host              |
| ---------- | --------------------------------- | -------------------------- |
| `frontend` | nginx servindo o SPA + proxy API  | `${HTTP_PORT:-80}`         |
| `backend`  | API NestJS + Fastify              | `${BACKEND_PORT:-4100}`    |
| `postgres` | Banco do CRM                      | interna                    |
| `redis`    | Fila/realtime                     | interna                    |
| `migrate`  | aplica migrations e encerra       | —                          |

> A API escuta na porta **3000 dentro do container** (rede interna do compose). No host, publica-se
> `${BACKEND_PORT:-4100}`, evitando conflito com serviços que já usam a 3000 no servidor. Ajuste com
> `BACKEND_PORT` (ex.: `.env` na raiz) se precisar.

O frontend é servido na mesma origem do backend (proxy nginx), então `VITE_API_BASE_URL` deve ficar
**vazio** (default) no build.

## HTTPS

O compose publica o nginx em HTTP (`:80`). Termine TLS à frente (ex.: um proxy reverso no host,
Cloudflare, ou certbot no próprio servidor) e ajuste `AUTH_COOKIE_SECURE=true`, `CORS_ORIGINS` e
`PUBLIC_API_URL` para o domínio HTTPS.

### WebSocket (Socket.IO) no proxy externo

O realtime usa Socket.IO no namespace `/realtime` e caminho HTTP `/socket.io/`, com os transportes
`polling` e `websocket` (o cliente negocia via `polling` e faz upgrade para `websocket`). O nginx do
container (`frontend/nginx.conf`) já encaminha `Upgrade`/`Connection` para `/socket.io/`.

**Todo proxy reverso à frente do frontend** (o terminador TLS — no deploy atual, o Apache na 443)
precisa, para o caminho `/socket.io/`:

- encaminhar os cabeçalhos de upgrade `Upgrade` e `Connection`;
- preservar o caminho `/socket.io/` e a query string (`EIO`, `transport`) **sem reescrevê-la**;
- falar HTTP/1.1 com o upstream (o frontend/nginx), sem buffering de WebSocket.

Sem esse encaminhamento, o handshake chega ao Engine.IO sem transporte/upgrade válido e o backend
responde **HTTP 400**; o realtime fica restrito ao fallback de `refetchInterval` (polling periódico).

Exemplo canônico em Apache 2.4 (adaptar ao vhost existente; o destino é o frontend/nginx do compose,
na porta publicada por `HTTP_PORT`; validar a sintaxe e obter autorização antes de recarregar o
serviço):

```apache
ProxyPass        /socket.io/  http://127.0.0.1:PORTA_FRONTEND/socket.io/  upgrade=websocket
ProxyPassReverse /socket.io/  http://127.0.0.1:PORTA_FRONTEND/socket.io/
```

### Uploads no proxy externo

O nginx do container define `client_max_body_size 52m` para aceitar foto de perfil (até 5 MB), mídia
do atendimento e envios em massa. Qualquer proxy à frente (Apache, Cloudflare etc.) também precisa
permitir esse tamanho. No Apache, verifique `LimitRequestBody`; se estiver limitado a 1 MB, uploads
maiores falham com **413** antes de chegar ao backend.

## Arquivos enviados (storage)

Em produção os arquivos (mídia do atendimento e fotos de perfil) ficam no volume nomeado
`storage_data`, montado em `/app/storage` pelo `docker-compose.prod.yml`. **Não é necessário criar
`backend/storage` no host** — essa pasta é usada apenas no desenvolvimento local e não é montada no
container.

Confirme o mount e a permissão de escrita:

```bash
docker inspect orderup-backend --format '{{range .Mounts}}{{println .Type .Name .Destination}}{{end}}'
docker compose -f docker-compose.prod.yml exec backend sh -c \
  'echo "$STORAGE_LOCAL_DIR"; ls -ld /app/storage; touch /app/storage/.write-test && rm /app/storage/.write-test'
```

`STORAGE_LOCAL_DIR` deve ser `./storage` (padrão, resolvido para `/app/storage`) ou `/app/storage`.
Se apontar para outro caminho fora do volume, os arquivos serão perdidos ao recriar o container.
Backup do volume:

```bash
docker run --rm -v orderup-crm_storage_data:/data -v "$PWD/backups:/backup" alpine \
  tar czf /backup/storage-$(date +%F).tar.gz -C /data .
```

## Evolution API (WhatsApp)

A Evolution roda em compose separado (`docker-compose.evolution.yml`) e **não** faz parte deste
deploy. Para o webhook funcionar, `PUBLIC_API_URL` deve ser uma URL pública que **a Evolution
consiga alcançar** (ex.: `https://<seu-dominio>`), apontando para `POST /api/webhooks/evolution`.

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
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis backend frontend
```

> Migrations não são revertidas automaticamente; reverter schema exige uma migration específica.
