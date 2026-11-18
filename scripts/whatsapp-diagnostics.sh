#!/usr/bin/env bash
#
# Diagnóstico da conexão WhatsApp (CRM + Evolution API), somente leitura.
#
# Executar no servidor, na pasta do repositório:
#   bash scripts/whatsapp-diagnostics.sh > /tmp/whatsapp-diagnostico.txt 2>&1
#
# Variáveis (com defaults):
#   APP_DIR       caminho do repositório                (default: /home/crm)
#   COMPOSE_FILE  compose de produção do CRM            (default: docker-compose.prod.yml)
#   DAYS          janela do histórico de eventos (dias) (default: 7)
#   HOURS         janela dos logs dos containers (h)    (default: 48)
#
# Não altera nada: apenas SELECT, leitura de logs, `docker inspect` e
# `redis-cli HEXISTS`. Números com 8+ dígitos (telefones) são mascarados e nenhum
# segredo (API key, token, senha) é impresso.

set -uo pipefail

APP_DIR="${APP_DIR:-/home/crm}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DAYS="${DAYS:-7}"
HOURS="${HOURS:-48}"

[[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "DAYS deve ser numérico" >&2; exit 1; }
[[ "$HOURS" =~ ^[0-9]+$ ]] || { echo "HOURS deve ser numérico" >&2; exit 1; }

mask() {
  sed -E \
    -e 's/(token|apikey|api_key|password|secret)=[^&" ]+/\1=<oculto>/Ig' \
    -e 's/[0-9]{8,}/<numero>/g'
}
section() { printf '\n==================== %s ====================\n' "$*"; }

cd "$APP_DIR" || { echo "Repositório não encontrado em $APP_DIR" >&2; exit 1; }

find_container() {
  docker ps -a --format '{{.Names}}' | grep -iE "$1" | head -n 1
}

CRM_DB="$(find_container '^orderup-postgres$')"
CRM_BACKEND="$(find_container 'backend')"
EVO="$(find_container '^orderup-evolution$')"
[[ -n "$EVO" ]] || EVO="$(docker ps -a --filter 'ancestor=evoapicloud/evolution-api' --format '{{.Names}}' | head -n 1)"
[[ -n "$EVO" ]] || EVO="$(find_container 'evolution' | grep -viE 'postgres|redis' | head -n 1)"
EVO_DB="$(find_container 'evolution.*postgres')"
EVO_REDIS="$(find_container 'evolution.*redis')"

crm_sql() {
  docker exec -i "$CRM_DB" sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -P pager=off -P footer=off' 2>&1 | mask
}

evo_sql() {
  docker exec -i "$EVO_DB" sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -P pager=off -P footer=off' 2>&1 | mask
}

section "Versões e containers"
echo "CRM HEAD: $(git rev-parse --short HEAD 2>/dev/null) — $(git log -1 --pretty=%s 2>/dev/null | mask)"
echo "Agora (UTC): $(date -u '+%Y-%m-%d %H:%M:%S')"
uptime 2>/dev/null
for container in "$CRM_BACKEND" "$CRM_DB" "$EVO" "$EVO_DB" "$EVO_REDIS"; do
  [[ -n "$container" ]] || continue
  docker inspect -f '{{.Name}} | imagem={{.Config.Image}} | estado={{.State.Status}} | iniciado={{.State.StartedAt}} | reinícios={{.RestartCount}} | OOMKilled={{.State.OOMKilled}}' "$container" 2>&1
done
docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' $EVO $CRM_BACKEND 2>/dev/null
echo
echo "Todos os containers da Evolution (mais de um com a mesma base derruba a sessão):"
docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}}' | grep -i 'evolution' | grep -viE 'postgres|redis'

section "Configuração da Evolution (sem segredos)"
if [[ -n "$EVO" ]]; then
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$EVO" 2>/dev/null |
    grep -E '^(CACHE_REDIS_ENABLED|CACHE_REDIS_SAVE_INSTANCES|CACHE_LOCAL_ENABLED|DATABASE_SAVE_DATA_INSTANCE|CONFIG_SESSION_PHONE_VERSION|CONFIG_SESSION_PHONE_CLIENT|CONFIG_SESSION_PHONE_NAME|QRCODE_LIMIT|LOG_LEVEL|LOG_BAILEYS|DEL_INSTANCE|WEBHOOK_GLOBAL_ENABLED)='
else
  echo "Container da Evolution não encontrado."
fi

if [[ -n "$CRM_DB" ]]; then
  section "CRM: estado salvo das instâncias"
  crm_sql <<'SQL'
SELECT instance_name AS instancia,
       active AS ativa,
       status,
       connection_status_reason AS motivo,
       connection_intent AS intencao,
       to_char((connection_observed_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS ultima_leitura_brt,
       to_char((connection_requested_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS conexao_pedida_brt,
       connection_version AS versao,
       connection_state_version AS versao_aplicada
FROM whatsapp_instances
ORDER BY instance_name;
SQL

  section "CRM: eventos de conexão recebidos da Evolution (últimos ${DAYS} dias, mais recentes primeiro)"
  crm_sql <<SQL
SELECT to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS') AS quando_brt,
       payload->>'instance' AS instancia,
       event_type AS evento,
       COALESCE(payload->'data'->>'state', payload->'data'->>'status') AS estado,
       COALESCE(payload->'data'->>'statusReason', payload->'data'->>'disconnectionReasonCode') AS motivo,
       substring(COALESCE(payload->'data'->>'disconnectionObject', '') from 'message\\\\?":\\\\?"([^"\\\\]*)') AS detalhe
FROM webhook_events
WHERE event_type IN ('connection.update', 'status.instance', 'logout.instance')
  AND created_at > now() - interval '${DAYS} days'
ORDER BY created_at DESC
LIMIT 120;
SQL

  section "CRM: eventos de conexão por hora e instância (últimos ${DAYS} dias) — onde o loop começa"
  crm_sql <<SQL
SELECT to_char(date_trunc('hour', (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD HH24:00') AS hora_brt,
       payload->>'instance' AS instancia,
       count(*) FILTER (WHERE payload->'data'->>'state' = 'connecting') AS connecting,
       count(*) FILTER (WHERE payload->'data'->>'state' = 'open') AS open,
       count(*) FILTER (WHERE payload->'data'->>'state' = 'close') AS close,
       count(*) FILTER (WHERE payload->'data'->>'statusReason' = '440') AS conflito_440
FROM webhook_events
WHERE event_type = 'connection.update'
  AND created_at > now() - interval '${DAYS} days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
SQL

  section "CRM: origem dos eventos de conexão (mais de um servidor = outra Evolution com a mesma sessão)"
  crm_sql <<SQL
SELECT payload->>'server_url' AS servidor,
       payload->>'instance' AS instancia,
       count(*) AS eventos,
       to_char((min(created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS primeiro_brt,
       to_char((max(created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS ultimo_brt
FROM webhook_events
WHERE event_type IN ('connection.update', 'status.instance', 'logout.instance')
  AND created_at > now() - interval '${DAYS} days'
GROUP BY 1, 2
ORDER BY 2, 3 DESC;
SQL

  section "CRM: resumo dos eventos de conexão (últimos ${DAYS} dias)"
  crm_sql <<SQL
SELECT event_type AS evento,
       COALESCE(payload->'data'->>'state', payload->'data'->>'status') AS estado,
       COALESCE(payload->'data'->>'statusReason', payload->'data'->>'disconnectionReasonCode') AS motivo,
       count(*) AS total,
       to_char((max(created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS ultimo_brt
FROM webhook_events
WHERE event_type IN ('connection.update', 'status.instance', 'logout.instance')
  AND created_at > now() - interval '${DAYS} days'
GROUP BY 1, 2, 3
ORDER BY total DESC;
SQL

  section "CRM: mensagens por hora (últimas 72h) — recebidas continuam chegando durante a queda?"
  crm_sql <<'SQL'
SELECT to_char(date_trunc('hour', (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD HH24:00') AS hora_brt,
       count(*) FILTER (WHERE direction = 'INBOUND') AS recebidas,
       count(*) FILTER (WHERE direction = 'OUTBOUND' AND status <> 'FAILED') AS enviadas,
       count(*) FILTER (WHERE direction = 'OUTBOUND' AND status = 'FAILED') AS falhas
FROM messages
WHERE created_at > now() - interval '72 hours'
GROUP BY 1
ORDER BY 1 DESC;
SQL

  section "CRM: falhas de envio por código (últimos ${DAYS} dias)"
  crm_sql <<SQL
SELECT COALESCE(metadata->>'errorCode', '(sem código)') AS codigo,
       count(*) AS total,
       to_char((max(created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS ultima_brt
FROM messages
WHERE direction = 'OUTBOUND'
  AND status = 'FAILED'
  AND created_at > now() - interval '${DAYS} days'
GROUP BY 1
ORDER BY total DESC;
SQL
else
  section "CRM"
  echo "Container do Postgres do CRM não encontrado."
fi

EVO_IDS=""
if [[ -n "$EVO_DB" ]]; then
  section "Evolution: instâncias e última desconexão registrada"
  evo_sql <<'SQL'
SELECT name AS instancia,
       "connectionStatus" AS estado,
       ("ownerJid" IS NOT NULL) AS pareada,
       "disconnectionReasonCode" AS motivo,
       to_char("disconnectionAt", 'YYYY-MM-DD HH24:MI:SS') AS desconectou_utc,
       substring(COALESCE("disconnectionObject"::text, '') from 'message\\?":\\?"([^"\\]*)') AS detalhe,
       to_char("updatedAt", 'YYYY-MM-DD HH24:MI:SS') AS atualizada_utc,
       "clientName" AS cliente
FROM "Instance"
ORDER BY name;
SQL
  EVO_IDS="$(docker exec -i "$EVO_DB" sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -A -t -F "|" -c "SELECT id, name FROM \"Instance\" ORDER BY name;"' 2>/dev/null)"

  section "Evolution: sessão salva no banco (tabela Session)"
  evo_sql <<'SQL'
SELECT i.name AS instancia, (s.creds IS NOT NULL AND length(s.creds) > 0) AS sessao_no_banco
FROM "Instance" i
LEFT JOIN "Session" s ON s."sessionId" = i.id
ORDER BY i.name;
SQL
else
  section "Evolution (banco)"
  echo "Container do Postgres da Evolution não encontrado."
fi

if [[ -n "$EVO_REDIS" && -n "$EVO_IDS" && -n "$EVO" ]]; then
  section "Evolution: sessão salva no Redis (1 = existe, reconecta sem QR)"
  redis_uri="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$EVO" | sed -n 's/^CACHE_REDIS_URI=//p')"
  redis_db="$(printf '%s' "$redis_uri" | sed -nE 's#.*/([0-9]+)$#\1#p')"
  redis_prefix="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$EVO" | sed -n 's/^CACHE_REDIS_PREFIX_KEY=//p')"
  redis_db="${redis_db:-0}"
  redis_prefix="${redis_prefix:-evolution}"
  while IFS='|' read -r instance_id instance_name; do
    [[ -n "$instance_id" ]] || continue
    exists="$(docker exec "$EVO_REDIS" redis-cli -n "$redis_db" HEXISTS "${redis_prefix}:instance:${instance_id}" creds 2>&1)"
    echo "${instance_name}: ${exists}"
  done <<< "$EVO_IDS" | mask
fi

if [[ -n "$CRM_BACKEND" ]]; then
  section "Backend: logs de conexão/envio (últimas ${HOURS}h, até 400 linhas)"
  docker logs --timestamps --since "${HOURS}h" "$CRM_BACKEND" 2>&1 |
    grep -E 'whatsapp\.connection\.|whatsapp\.send\.(failed|skipped)|Connection reconciliation|Evolution request failed|reconcil' |
    grep -vE 'whatsapp\.connection\.(webhook\.received|snapshot\.confirmed)' |
    grep -vE 'whatsapp\.connection\.reconciled [{][\\]?"scanned[\\]?":[0-9]+,[\\]?"changed[\\]?":0,[\\]?"failed[\\]?":0[}]' |
    tail -n 400 | mask
fi

if [[ -n "$EVO" ]]; then
  section "Evolution: logs relevantes (últimas ${HOURS}h, até 300 linhas)"
  echo "Conflitos 'replaced' (duas conexões com a mesma sessão) por hora (UTC):"
  docker logs --timestamps --since "${HOURS}h" "$EVO" 2>&1 |
    grep '"conflict"' | grep -o '^[0-9-]*T[0-9][0-9]' | sort | uniq -c
  echo
  docker logs --timestamps --since "${HOURS}h" "$EVO" 2>&1 |
    grep -iE 'connection (update|closed)|reconnect|initial connection|skipping|logout|removed|stream:error|stream errored|connected to whatsapp|not connection|unhandled|error' |
    grep -viE 'apikey|authorization' |
    tail -n 300 | mask
fi

section "Fim"
echo "Envie este arquivo para análise. Ele não contém senhas, tokens nem números de telefone."
