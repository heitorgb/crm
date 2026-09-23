# Como executar o OrderUp CRM

Guia prático para rodar o CRM (Multi WhatsApp + Chat + Contatos) localmente.

## Visão geral

| Serviço            | Porta  | Onde roda            |
| ------------------ | ------ | -------------------- |
| Frontend (Vite)    | `5173` | host (npm)           |
| Backend (NestJS)   | `3000` | host (npm)           |
| PostgreSQL (CRM)   | `5432` | Docker               |
| Redis (CRM)        | `6379` | Docker               |
| Evolution API      | `8080` | Docker (opcional)    |
| Evolution Postgres | —      | Docker (interno)     |
| Evolution Redis    | —      | Docker (interno)     |

O WhatsApp só funciona com a **Evolution API** no ar (serviço externo, opcional para o restante).

## Pré-requisitos

- Node.js 24+ e npm 11+
- Docker + Docker Compose

---

## 1. Infra do CRM (Postgres + Redis)

Na **raiz do repositório**:

```bash
cd /home/caio/Documentos/Dev/crm
docker compose up -d
docker compose ps
```

## 2. Backend

```bash
cd backend
cp .env.example .env      # se ainda não existir .env
npm install
npm run prisma:deploy     # aplica as migrations (ou: npm run prisma:migrate em dev)
npm run prisma:seed       # cria usuário de dev
npm run start:dev         # http://localhost:3000/api/health
```

Credenciais do seed:

```text
E-mail: admin@orderup.local
Senha:  admin12345
```

## 3. Frontend

```bash
cd frontend
cp .env.example .env      # opcional (Vite faz proxy de /api → :3000)
npm install
npm run dev               # http://localhost:5173
```

Acesse `http://localhost:5173` e faça login. O app abre em **Atendimento → Conversas**.

---

## 4. Evolution API (WhatsApp)

### 4.1 Subir

Na raiz do repositório:

```bash
docker compose -f docker-compose.yml -f docker-compose.evolution.yml up -d
docker compose -f docker-compose.yml -f docker-compose.evolution.yml ps
```

- Imagem: `evoapicloud/evolution-api:v2.3.7` (namespace oficial atual; `atendai/...` foi descontinuado).
- Porta: `8080`.
- Chave padrão: `change-me-evolution-api-key`.

Verificar se está no ar:

```bash
curl http://localhost:8080/
curl -H "apikey: change-me-evolution-api-key" http://localhost:8080/instance/fetchInstances
```

Esperado: `HTTP 200` com `{"version":"2.3.7",...}` e `[]`, respectivamente.

### 4.2 Configurar o backend (`backend/.env`)

```env
EVOLUTION_API_BASE_URL=http://localhost:8080
EVOLUTION_API_KEY=change-me-evolution-api-key
EVOLUTION_WEBHOOK_SECRET=local-dev-webhook-secret
CREDENTIALS_ENCRYPTION_KEY=<segredo com 32+ caracteres>
PUBLIC_API_URL=http://host.docker.internal:3000
```

- `EVOLUTION_API_KEY` deve ser igual ao `AUTHENTICATION_API_KEY` da Evolution.
- Reinicie o backend após editar o `.env`.

### 4.3 Webhook

A Evolution precisa **alcançar o backend**. O compose já inclui `host.docker.internal`, então, com o
backend rodando no host, use `PUBLIC_API_URL=http://host.docker.internal:3000`.

Alternativas:

- Túnel: `ngrok http 3000` → `PUBLIC_API_URL=https://<url-do-tunel>`.
- Mesmo Docker network: `PUBLIC_API_URL=http://<host-do-backend>:3000`.

Sem uma URL alcançável, a configuração automática do webhook falha (`PUBLIC_API_URL_MISSING`).

### 4.4 Conectar um número no CRM

1. **Atendimento → WhatsApp → Nova instância** (nome amigável, `instanceName` único, telefone opcional).
2. **Conectar** → exibe o QR code / código de pareamento.
3. Escaneie no WhatsApp; o webhook (`MESSAGES_UPSERT`) é configurado automaticamente.
4. Mensagens recebidas criam/reutilizam o **Contato** (por telefone) e a **Conversa** da instância.

Painel da Evolution (opcional): `http://localhost:8080/manager`.

---

## 5. Validação completa

Backend:

```bash
cd backend
npm run lint
npm run typecheck
npm test             # unit (não exige infra)
npm run test:e2e     # integração (exige Postgres + Redis)
npm run build
```

Frontend:

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```

---

## 6. Parar / limpar

```bash
# parar mantendo dados
docker compose -f docker-compose.yml -f docker-compose.evolution.yml down

# parar e apagar volumes (reset total)
docker compose -f docker-compose.yml -f docker-compose.evolution.yml down -v
```

---

## 7. Troubleshooting

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| `open .../backend/docker-compose.yml: no such file or directory` | comando rodado dentro de `backend/` | rode da raiz ou use `-f ../docker-compose.yml` |
| `pull access denied for atendai/evolution-api` | namespace antigo da imagem | use `evoapicloud/evolution-api:v2.3.7` (já configurado) |
| `PUBLIC_API_URL_MISSING` ao conectar | webhook inalcançável | defina `PUBLIC_API_URL=http://host.docker.internal:3000` (ou túnel) e reinicie o backend |
| `EVOLUTION_UNAVAILABLE` ao conectar | `EVOLUTION_API_BASE_URL`/`EVOLUTION_API_KEY` vazios ou Evolution fora do ar | suba a Evolution e preencha o `.env` |
| "Página não encontrada" após login | rota antiga `/dashboard` | já corrigido: redireciona para `/atendimento/conversas` |
| `port is already allocated` | porta 3000/5173/8080/5432/6379 em uso | pare o processo conflitante ou ajuste a porta |
| Auth do webhook falhando | `EVOLUTION_WEBHOOK_SECRET` divergente | alinhe o segredo entre Evolution e backend |

---

## 8. Acessos rápidos

| Recurso            | URL                                      |
| ------------------ | ---------------------------------------- |
| Frontend           | http://localhost:5173                    |
| API (health)       | http://localhost:3000/api/health         |
| Evolution API      | http://localhost:8080                    |
| Evolution Manager  | http://localhost:8080/manager            |
