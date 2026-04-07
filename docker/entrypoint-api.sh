#!/bin/sh
set -e
echo "Waiting for PostgreSQL..."
until pg_isready -h db -U app -d race; do
  sleep 1
done
echo "Applying schema (CREATE TABLE IF NOT EXISTS)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /migrations/create_new_schema.sql
cd /app/artifacts/fastapi-server
exec uvicorn main:app --host 0.0.0.0 --port 8000
