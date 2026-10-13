#!/usr/bin/env bash
#
# Deploy do OrderUp CRM no servidor (executado pelo GitHub Actions via SSH).
#
# Variáveis (com defaults):
#   APP_DIR        caminho do repositório no servidor   (default: /home/crm)
#   DEPLOY_BRANCH  branch a implantar                     (default: desenvolvimento)
#   GIT_REMOTE     remote do git                          (default: origin)
#   COMPOSE_FILE   arquivo compose de produção            (default: docker-compose.prod.yml)
#   EVOLUTION_COMPOSE_FILE  compose da Evolution API      (default: docker-compose.evolution.yml)
#
# Pré-requisitos no servidor: git, docker, docker compose (v2) e o repositório
# já clonado em APP_DIR com o remote configurado, além de backend/.env preenchido.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/crm}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-desenvolvimento}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
EVOLUTION_COMPOSE_FILE="${EVOLUTION_COMPOSE_FILE:-docker-compose.evolution.yml}"
COMPOSE_FILES=(-f "$COMPOSE_FILE" -f "$EVOLUTION_COMPOSE_FILE")

log() { printf '\n\033[1;32m[deploy]\033[0m %s\n' "$*"; }
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
docker compose "${COMPOSE_FILES[@]}" build

log "Aplicando migrations do banco"
docker compose "${COMPOSE_FILES[@]}" run --rm migrate

log "Subindo serviços (CRM + Evolution)"
docker compose "${COMPOSE_FILES[@]}" up -d --remove-orphans \
  postgres redis backend frontend \
  evolution-postgres evolution-redis evolution

log "Removendo imagens órfãs"
docker image prune -f >/dev/null

log "Status dos serviços"
docker compose "${COMPOSE_FILES[@]}" ps

log "Deploy concluído com sucesso (commit $(git rev-parse --short HEAD))."
