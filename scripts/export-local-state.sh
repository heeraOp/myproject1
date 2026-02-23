#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
ENV_FILE="${ENV_FILE:-.env.dev}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${1:-artifacts/state-${TIMESTAMP}}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "Exporting PostgreSQL dump to $OUTPUT_DIR/postgres.dump ..."
"${COMPOSE[@]}" exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUTPUT_DIR/postgres.dump"

echo "Exporting media volume to $OUTPUT_DIR/media.tar.gz ..."
"${COMPOSE[@]}" exec -T backend sh -lc 'mkdir -p /app/media && tar -C /app -czf - media' > "$OUTPUT_DIR/media.tar.gz"

cat > "$OUTPUT_DIR/manifest.txt" <<EOF
exported_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
compose_file=${COMPOSE_FILE}
env_file=${ENV_FILE}
files=postgres.dump,media.tar.gz
EOF

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$OUTPUT_DIR/postgres.dump" "$OUTPUT_DIR/media.tar.gz" > "$OUTPUT_DIR/sha256.txt"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$OUTPUT_DIR/postgres.dump" "$OUTPUT_DIR/media.tar.gz" > "$OUTPUT_DIR/sha256.txt"
fi

echo "Local state export completed: $OUTPUT_DIR"
