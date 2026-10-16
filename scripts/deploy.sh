#!/usr/bin/env bash
#
# Deploy do OrderUp CRM no servidor (executado pelo GitHub Actions via SSH).
#
# Variáveis (com defaults):
#   APP_DIR        caminho do repositório no servidor   (default: /home/crm)
#   DEPLOY_BRANCH  branch a implantar                     (default: main)
#   GIT_REMOTE     remote do git                          (default: origin)
#   COMPOSE_FILE   arquivo compose de produção            (default: docker-compose.prod.yml)
#
# Evolution API (stack separado — NÃO é tocada por padrão):
#   UPDATE_EVOLUTION=1       baixa a nova imagem e recria a Evolution  (default: 0)
#   EVOLUTION_COMPOSE_FILE   compose da Evolution  (default: docker-compose.evolution.yml)
#   EVOLUTION_PROJECT        projeto compose da Evolution (default: detectado do container)
#   EVOLUTION_IMAGE          sobrescreve a tag da imagem (default: a do compose)
#
# Pré-requisitos no servidor: git, docker, docker compose (v2) e o repositório
# já clonado em APP_DIR com o remote configurado, além de backend/.env preenchido.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/crm}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
UPDATE_EVOLUTION="${UPDATE_EVOLUTION:-0}"
EVOLUTION_COMPOSE_FILE="${EVOLUTION_COMPOSE_FILE:-docker-compose.evolution.yml}"

log() { printf '\n\033[1;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[deploy:aviso]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[deploy:erro]\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git não encontrado no servidor."
command -v docker >/dev/null 2>&1 || fail "docker não encontrado no servidor."
docker compose version >/dev/null 2>&1 || fail "docker compose (v2) não encontrado."

[ -d "$APP_DIR/.git" ] || fail "Repositório não encontrado em $APP_DIR (clone o repositório primeiro)."

log "Repositório: $APP_DIR | branch: $DEPLOY_BRANCH | remote: $GIT_REMOTE"
cd "$APP_DIR"

log "Atualizando código"
git fetch --prune "$GIT_REMOTE" "$DEPLOY_BRANCH"
git checkout "$DEPLOY_BRANCH"
git reset --hard "$GIT_REMOTE/$DEPLOY_BRANCH"
log "HEAD em $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

[ -f backend/.env ] || fail "backend/.env ausente em $APP_DIR/backend/.env (crie a partir de backend/.env.example)."

log "Construindo imagens (backend, migrate, frontend)"
docker compose -f "$COMPOSE_FILE" build

log "Aplicando migrations do banco"
docker compose -f "$COMPOSE_FILE" run --rm migrate

log "Subindo serviços"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans postgres redis backend frontend

# --- Evolution API (opcional) -------------------------------------------------
# A Evolution é um stack separado do CRM e NÃO é atualizada por padrão. Defina
# UPDATE_EVOLUTION=1 (ex.: variável do repositório no GitHub Actions) para baixar
# a nova imagem e recriar apenas o serviço `evolution`, preservando os volumes.
# Reutiliza o MESMO projeto compose do container existente para não criar um
# volume novo (e vazio) nem colidir com o nome fixo `orderup-evolution`.
if [[ "$UPDATE_EVOLUTION" == "1" ]]; then
  [ -f "$EVOLUTION_COMPOSE_FILE" ] ||
    fail "UPDATE_EVOLUTION=1, mas $EVOLUTION_COMPOSE_FILE não foi encontrado em $APP_DIR."

  EVOLUTION_PROJECT="${EVOLUTION_PROJECT:-$(docker inspect \
    -f '{{ index .Config.Labels "com.docker.compose.project" }}' orderup-evolution 2>/dev/null || true)}"

  evolution_compose=(-f "$EVOLUTION_COMPOSE_FILE")
  if [[ -n "$EVOLUTION_PROJECT" ]]; then
    evolution_compose+=(-p "$EVOLUTION_PROJECT")
  fi

  log "Atualizando Evolution API ($EVOLUTION_COMPOSE_FILE${EVOLUTION_PROJECT:+ | projeto: $EVOLUTION_PROJECT})"

  # Backup do banco da Evolution antes de migrar (best-effort).
  mkdir -p backups
  backup="backups/evolution-$(date +%F-%H%M%S).sql"
  if docker exec orderup-evolution-postgres pg_dump \
    -U "${EVOLUTION_POSTGRES_USER:-evolution}" \
    "${EVOLUTION_POSTGRES_DB:-evolution}" > "$backup" 2>/dev/null; then
    log "Backup da Evolution gravado em $backup"
  else
    warn "Backup da Evolution ignorado (container/DB indisponível); seguindo."
  fi

  docker compose "${evolution_compose[@]}" pull evolution
  docker compose "${evolution_compose[@]}" up -d evolution

  warn "Evolution atualizada. Passos manuais: ativar a licença em http://<host>:8080/manager/login e re-parear o número no CRM."
fi

log "Removendo imagens órfãs"
docker image prune -f >/dev/null

log "Status dos serviços"
docker compose -f "$COMPOSE_FILE" ps

log "Deploy concluído com sucesso (commit $(git rev-parse --short HEAD))."
