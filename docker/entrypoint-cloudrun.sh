#!/bin/sh
set -e
# 任意: Cloud SQL 等の DATABASE_URL が設定されていて RUN_DB_MIGRATIONS=true のときだけスキーマ適用
if [ "${RUN_DB_MIGRATIONS:-}" = "true" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "Applying schema..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/create_new_schema.sql
fi
cd /app/artifacts/fastapi-server
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8080}"
