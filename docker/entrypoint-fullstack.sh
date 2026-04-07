#!/bin/sh
set -e

PORT="${PORT:-8080}"
sed "s/__PORT__/${PORT}/g" /etc/nginx/templates/nginx-fullstack.conf > /etc/nginx/conf.d/default.conf

if [ "${RUN_DB_MIGRATIONS:-}" = "true" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "Applying schema (optional)..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/create_new_schema.sql || echo "WARN: migration step failed (continuing)"
fi

cd /app/artifacts/fastapi-server
uvicorn main:app --host 127.0.0.1 --port 8000 &
UVICORN_PID=$!

cleanup() {
  kill -TERM "$UVICORN_PID" 2>/dev/null || true
  nginx -s quit 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

set +e
nginx -g "daemon off;"
NGINX_EXIT=$?
set -e
kill -TERM "$UVICORN_PID" 2>/dev/null || true
exit "$NGINX_EXIT"
