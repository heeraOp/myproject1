#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <state-directory>"
  echo "Example: $0 /opt/tambola/state-20260223-120000"
  exit 1
fi

STATE_DIR="$1"
DUMP_FILE="$STATE_DIR/postgres.dump"
MEDIA_FILE="$STATE_DIR/media.tar.gz"

if [ ! -f "$DUMP_FILE" ]; then
  echo "Missing file: $DUMP_FILE"
  exit 1
fi

if [ ! -f "$MEDIA_FILE" ]; then
  echo "Missing file: $MEDIA_FILE"
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "Starting postgres/redis ..."
"${COMPOSE[@]}" up -d postgres redis

echo "Waiting for postgres health ..."
until "${COMPOSE[@]}" exec -T postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  sleep 2
done

echo "Stopping app services before restore ..."
"${COMPOSE[@]}" stop backend celery frontend || true

echo "Restoring PostgreSQL from $DUMP_FILE ..."
cat "$DUMP_FILE" | "${COMPOSE[@]}" exec -T postgres sh -lc 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges'

echo "Restoring media files from $MEDIA_FILE ..."
cat "$MEDIA_FILE" | "${COMPOSE[@]}" run --rm -T --entrypoint sh backend -lc 'mkdir -p /app/media && tar -xzf - -C /app'

echo "Starting full production stack ..."
"${COMPOSE[@]}" up -d backend celery frontend

echo "VPS state restore completed."
