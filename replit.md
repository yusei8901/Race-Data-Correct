# Furlong CUBE — 競馬データ補正アプリ

## Overview

SPA horse racing data correction app. React+Vite frontend, FastAPI (Python) backend, PostgreSQL DB. PC-only. Dark terminal UI with orange dragon theme.

## Architecture

- **Monorepo**: pnpm workspaces
- **Frontend**: `artifacts/horse-racing` — React + Vite + Tailwind + shadcn/ui
- **Backend**: `artifacts/fastapi-server` — Python FastAPI, psycopg2, PostgreSQL
- **API Client**: `lib/api-client-react` — auto-generated from OpenAPI (Orval)
- **DB**: PostgreSQL via `DATABASE_URL`

## Key Files

- `artifacts/horse-racing/src/pages/race-list.tsx` — Race list (3-screen nav)
- `artifacts/horse-racing/src/pages/data-correction.tsx` — 3-column data correction
- `artifacts/horse-racing/src/pages/processing.tsx` — Processing management
- `artifacts/horse-racing/src/components/layout.tsx` — Sidebar + top header (role switcher)
- `artifacts/horse-racing/src/contexts/user-role.tsx` — 管理者/一般ユーザー role context
- `artifacts/fastapi-server/main.py` — FastAPI app + router mounts
- `artifacts/fastapi-server/routers/` — races, entries, passing_orders, history, batch_jobs, analysis
- `artifacts/fastapi-server/seed.py` — DB seed (run with `python seed.py`)

## DB Tables

- `races` — Race master
- `race_entries` — Horse entries per race (includes `furlong_splits float[]`)
- `passing_orders` — Per-checkpoint analysis results (includes `special_note`, `running_position`, `absolute_speed`, `speed_change`)
- `correction_history` — Correction audit log
- `batch_jobs`, `analysis_params`, `venues`

## FastAPI Routes (all prefixed `/fastapi`)

- `GET /races` — list races (filter by date, venue, race_type)
- `GET /races/summary` — status summary
- `GET /races/{id}` — single race
- `PATCH /races/{id}` — update race fields
- `GET /races/{id}/entries` — horse entries with furlong_splits
- `GET /races/{id}/passing-orders?checkpoint=` — analysis results
- `PATCH /passing-orders/{id}` — update passing order (horse_number, lane, special_note, running_position)
- `POST /races/{id}/corrections/start` — set status=補正中
- `POST /races/{id}/corrections/complete` — set status=レビュー待ち
- `GET /races/{id}/history` — correction history
- `POST /races/{id}/history` — add history entry

## User Roles

- 管理者: full access (all buttons, 処理管理, checkboxes)
- 一般ユーザー: no 処理管理, no checkboxes, no レビュー/再補正/再解析 buttons, no /processing route

## Status Matrix

video_status≠完了 → 未処理; analysis_status drives: 未解析/解析中/再解析中/解析失敗/突合失敗; analysis_status=完了 uses status field for: 未補正/補正中/レビュー待ち/データ確定/修正要請/再解析要請

## Key Dev Notes

- `lib/api-client-react/dist/` is gitignored — rebuild with `cd lib/api-client-react && npx tsc -p tsconfig.json` after codegen
- All FastAPI routes use `APIRouter(prefix="/fastapi")`
- Dark theme: `class="dark"` on `<html>` in `index.html`
- Orange primary: hsl(20 90% 56%)
- Sidebar defaults collapsed; top header bar has role switcher (デモ用)
