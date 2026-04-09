# Furlong CUBE — 競馬データ補正アプリ

## Overview

SPA horse racing data correction app. React+Vite frontend, FastAPI (Python) backend, PostgreSQL DB. PC-only. Dark terminal UI with orange dragon theme.

## Architecture

- **Monorepo**: pnpm workspaces
- **Frontend**: `artifacts/horse-racing` — React + Vite + Tailwind + shadcn/ui
- **Backend**: `artifacts/fastapi-server` — Python FastAPI, psycopg2, PostgreSQL
- **API Client**: `lib/api-client-react` — auto-generated from OpenAPI (Orval)
- **DB Schema**: `lib/db/src/schema/` — Drizzle ORM TypeScript files (UUID PKs)
- **DB Migrations**: `lib/db/migrations/create_new_schema.sql` — 22 tables
- **DB**: PostgreSQL via `DATABASE_URL`

## Key Files

- `artifacts/horse-racing/src/pages/race-list.tsx` — Race list (3-screen nav)
- `artifacts/horse-racing/src/pages/data-correction.tsx` — 3-column data correction (2250+ lines)
- `artifacts/horse-racing/src/pages/processing.tsx` — Processing management
- `artifacts/horse-racing/src/components/layout.tsx` — Sidebar + top header (role switcher)
- `artifacts/horse-racing/src/contexts/user-role.tsx` — 管理者/一般ユーザー role context
- `artifacts/fastapi-server/main.py` — FastAPI app + router mounts
- `artifacts/fastapi-server/routers/` — races, entries, passing_orders, history, batch_jobs, analysis
- `artifacts/fastapi-server/seed.py` — DB seed for new 19-table schema (run with `python seed.py`)
## DB Tables (22-table schema, all UUID PKs)

### Core hierarchy
- `race_category` — JRA / LOCAL
- `race_event` — 開催 (date × venue × round). FK → race_category
- `race` — Race. English status codes. FK → race_event, users. Soft FK to analysis_result_header & correction_session
- `race_video` — GCS video metadata. FK → race
- `race_status_history` — Status transition audit trail. FK → race, users

### Analysis pipeline
- `analysis_job` — Analysis queue job. FK → race_video
- `analysis_result_header` — Per-job result header. FK → analysis_job, race
- `analysis_result_detail` — Per-checkpoint detail rows. FK → analysis_result_header
  - Includes both spec fields (time_sec, marker_type, class_name, course_position, rank, race_time, corrected_time, data_type, speed_kmh) AND passing_orders compat fields (horse_number, horse_name, gate_number, color, lane, accuracy, position, is_corrected, original_position, absolute_speed, speed_change, running_position, special_note)

### Official data (JRA BigQuery stubs)
- `jra_race_reference` — JRA official race reference
- `official_horse_reference` — JRA official horse data
- `official_horse_furlong_time` — Official 200m split times. FK → official_horse_reference

### Matching & linkage
- `race_linkage_result` — Analysis↔official linkage result (SUCCESS/FAILED). FK → race

### Correction workflow
- `correction_session` — Who is correcting which race/analysis. FK → race, users
- `correction_result` — Versioned correction data snapshots. FK → correction_session, users

### Presets & masters
- `venue_weather_preset` — Analysis parameter presets by venue×weather×surface
- `correction_memo_master` — Special note dropdown options (~10 items)

### Infra
- `users` — App users. external_subject_id (IdP sub). UUID PK
- `audit_log` — Operation audit log. FK → users
- `csv_export_job` — CSV export jobs. FK → race_event, users

### Analysis options
- `analysis_option` — Per-race analysis params (race×video unique). FK → race, race_video, venue_weather_preset

## English Status Codes (race.status) — 10 display statuses

| Code | Display (JP) | Note |
|---|---|---|
| PENDING | 未処理 | GCSに動画配置済み、解析未実行 |
| ANALYZING | 解析中 | 解析ジョブ実行中 |
| ANALYSIS_FAILED | 解析失敗 | 解析ジョブがエラー終了 |
| ANALYZED | 待機中 | 解析完了、補正未実施 |
| MATCH_FAILED | 突合失敗 | 公式データ突合に失敗 |
| CORRECTING | 補正中 | データ補正画面で編集中 |
| CORRECTED | レビュー待ち | 補正完了、データ確定待ち（提出） |
| REVISION_REQUESTED | 修正要請 | 管理者差し戻し |
| CONFIRMED | データ確定 | 確定済み（confirmed_by=user.id, confirmed_at） |
| ANALYSIS_REQUESTED | 再解析要請 | 再解析要請がされた状態 |

## FastAPI Routes (all prefixed `/fastapi`) — PENDING migration to new schema (Task #5)

- `GET /races` — list races (filter by date, venue, race_type)
- `GET /races/latest-date` — latest race date
- `GET /races/summary` — status summary counts
- `GET /races/{id}` — single race
- `PATCH /races/{id}` — update race fields
- `GET /races/{id}/entries` — horse entries
- `GET /races/{id}/passing-orders?checkpoint=` — analysis results
- `GET /races/{id}/available-analysis` — available analysis for bind
- `GET /races/{id}/history` — correction history
- `POST /races/{id}/history` — add history entry
- `PATCH /passing-orders/{id}` — update passing order
- `POST /races/{id}/corrections/start` — start correction session
- `POST /races/{id}/corrections/complete` — complete correction
- `POST /races/{id}/corrections/temp-save` — temp save
- `POST /races/{id}/corrections/cancel` — cancel correction
- `POST /races/{id}/force-unlock` — admin force unlock
- `POST /races/{id}/reanalysis-request` — request reanalysis
- `POST /races/{id}/matching-failure` — flag match failure
- `POST /races/{id}/correction-request` — admin correction request
- `POST /races/{id}/confirm` — admin confirm race
- `POST /races/{id}/bind-analysis` — re-bind analysis data
- `POST /races/{id}/reanalyze` — trigger re-analysis
- `PATCH /races/batch-status` — bulk status update

## Data Correction Page Dialogs

- **TempSaveDialog** — 3 options: save & continue, save & exit, discard & exit
- **ReanalysisRequestDialog** — reason dropdown + optional comment
- **CorrectionRequestDialog** — admin comment for correction request
- **StatusDetailPopup** — shows reason/comment for 再解析待ち/修正要請 statuses
- **BindAnalysisDialog** — select analysis data to re-bind for 突合失敗 races
- **HistoryModal** — correction history with comment tab + restoration stub

## Conditional Buttons by Status/Role

- 待機中: 補正開始 (all users)
- 補正中 (own lock): 一時保存, 補正完了, キャンセル; 突合申請/再解析申請 (editing mode only)
- 補正中 (other lock): 強制ロック解除 (admin only)
- レビュー待ち: データ確定 (admin, green), 修正要請 (admin)
- 突合失敗: 解析データ再紐付け (admin only)
- 修正要請: 補正再開 (corrector)

## User Roles

- 管理者: full access (all buttons, 処理管理, checkboxes, データ確定, 修正要請, 強制ロック解除)
- 一般ユーザー: no 処理管理, no checkboxes, no admin-only buttons, no /processing route
- currentUserName = isAdmin ? "管理者" : "ユーザー"

## Key Dev Notes

- `lib/api-client-react/dist/` is gitignored — rebuild with `cd lib/api-client-react && npx tsc -p tsconfig.json` after codegen
- All FastAPI routes use `APIRouter(prefix="/fastapi")`
- DB schema changes: use `psql "$DATABASE_URL" -f <sql_file>` directly (drizzle-kit push requires interactive input for new tables alongside old ones)
- Dark theme: `class="dark"` on `<html>` in `index.html`
- Orange primary: hsl(20 90% 56%)
- Sidebar defaults collapsed; top header bar has role switcher (デモ用)
- `handleRestore` is a stub (toast only) — backend restore endpoint not yet implemented
- correction_request_comment / reanalysis_reason / reanalysis_comment → now stored in race_status_history.metadata
- locked_by / locked_at / assigned_user → now modeled via correction_session + corrected_by on race
