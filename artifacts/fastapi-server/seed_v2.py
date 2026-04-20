"""
DB v2 Seed Script
- Executes v2_schema.sql (drops all tables + recreates)
- Inserts dummy data from db_design_dummy_data
"""
import os, sys
import psycopg2
import psycopg2.extras
from pathlib import Path

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set", file=sys.stderr)
    sys.exit(1)

conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = False
cur = conn.cursor()

# ──────────────────────────────────────────
# 1. Run schema SQL
# ──────────────────────────────────────────
schema_path = Path(__file__).parent / "migrations" / "v2_schema.sql"
print(f"Running schema: {schema_path}")
sql = schema_path.read_text()
cur.execute(sql)
print("Schema applied.")

# ──────────────────────────────────────────
# 2. Seed data
# ──────────────────────────────────────────

# race_category
cur.execute("""
INSERT INTO race_category (id, code, name, created_at, updated_at) VALUES
  (1, 'JRA',   '中央競馬（JRA）', '2024-01-01', '2024-01-01'),
  (2, 'LOCAL', '地方競馬',         '2024-01-01', '2024-01-01')
ON CONFLICT DO NOTHING
""")

# race_venue
cur.execute("""
INSERT INTO race_venue (id, category_id, code, name, short_name_1, short_name_2, short_name_3, venue_name_en) VALUES
  (1,  1, '01', '札幌競馬場', '札', '札幌', '札幌', 'SAPPORO'),
  (2,  1, '02', '函館競馬場', '函', '函館', '函館', 'HAKODATE'),
  (3,  1, '03', '福島競馬場', '福', '福島', '福島', 'FUKUSHIMA'),
  (4,  1, '04', '新潟競馬場', '新', '新潟', '新潟', 'NIIGATA'),
  (5,  1, '05', '東京競馬場', '東', '東京', '東京', 'TOKYO'),
  (6,  1, '06', '中山競馬場', '中', '中山', '中山', 'NAKAYAMA'),
  (7,  1, '07', '中京競馬場', '中', '中京', '中京', 'CHUKYO'),
  (8,  1, '08', '京都競馬場', '京', '京都', '京都', 'KYOTO'),
  (9,  1, '09', '阪神競馬場', '阪', '阪神', '阪神', 'HANSHIN'),
  (10, 1, '10', '小倉競馬場', '小', '小倉', '小倉', 'KOKURA')
ON CONFLICT DO NOTHING
""")

# user
cur.execute("""
INSERT INTO "user" (id, external_subject_id, auth_provider, email, name, created_at, updated_at) VALUES
  (1,  '108012345678901234567', 'iap_google', 'user@example.com',  '補正担当者A', '2024-01-01', '2024-01-01'),
  (10, '108099999999999999999', 'iap_google', 'admin@example.com', '管理者A',     '2026-04-01', '2026-04-01')
ON CONFLICT DO NOTHING
""")

# race_type
cur.execute("""
INSERT INTO race_type (id, code, name, name_sub1, name_sub2, is_active) VALUES
  (1, '00', '海外・地方成績時の既定値', NULL,      NULL,      TRUE),
  (2, '11', '2歳',                       'サラ系2歳','サラ系3歳', TRUE),
  (3, '12', '3歳',                       'サラ系3歳',NULL,      TRUE),
  (4, '13', '3歳以上',                   'サラ系3歳上',NULL,    TRUE)
ON CONFLICT DO NOTHING
""")

# race_symbol
cur.execute("""
INSERT INTO race_symbol (id, code, name, short_name, is_active) VALUES
  (1, '000', '記号無し', 'DSN', TRUE),
  (2, '001', '[指定]',   'DSN', TRUE),
  (3, '002', '[混合]',   'DSN', TRUE)
ON CONFLICT DO NOTHING
""")

# race_condition
cur.execute("""
INSERT INTO race_condition (id, code, name, name_sub1, is_active) VALUES
  (1, '001', '新馬',       NULL,         TRUE),
  (2, '003', '未勝利',     NULL,         TRUE),
  (3, '005', '1勝クラス',  '500万円以下', TRUE),
  (4, '010', '2勝クラス',  '1000万円以下',TRUE),
  (5, '016', '3勝クラス',  '1600万円以下',TRUE),
  (6, '999', 'オープン',   NULL,         TRUE)
ON CONFLICT DO NOTHING
""")

# race_official (with WAITING status)
cur.execute("""
INSERT INTO race_official (id, race_id, holding_date, place_code, holding_time, holding_day, race_number,
  race_type_code, race_title, distance, status, sub_status, created_at, updated_at) VALUES
  (1,  2601010501, 20260411, '05', '01', '01',  1, '13', '第1レース',   1600, 'ANALYZED',  NULL,              '2026-04-11 06:00:00', '2026-04-11 06:00:00'),
  (2,  2601010601, 20260411, '06', '01', '02', 11, '12', '第11レース',  2000, 'ANALYZED',  'REVISION_REQUESTED','2026-04-11 06:00:00','2026-04-11 06:00:00'),
  (3,  2601010503, 20260411, '05', '01', '01',  3, '13', NULL,          1800, 'ANALYZED',  'EDITING',          '2026-04-11 06:00:00', '2026-04-11 06:00:00'),
  (4,  2601020304, 20260412, '05', '01', '02',  4, '12', '春の特別戦',  2400, 'IN_REVIEW', NULL,               '2026-04-12 06:00:00', '2026-04-12 06:00:00'),
  (5,  2501020304, 20250412, '05', '01', '02',  4, '13', '過去レース',  1200, 'CONFIRMED', NULL,               '2025-04-12 06:00:00', '2025-04-12 06:00:00'),
  (6,  2601010502, 20260411, '05', '01', '01',  2, '12', '第2レース',   1400, 'WAITING',   NULL,               '2026-04-11 06:00:00', '2026-04-11 06:00:00'),
  (7,  2601010701, 20260411, '07', '01', '01',  1, '13', '要対応レース', 1200, 'NEEDS_ATTENTION','ANALYSIS_FAILED','2026-04-11 06:00:00','2026-04-11 06:00:00')
ON CONFLICT DO NOTHING
""")

# race_video
cur.execute("""
INSERT INTO race_video (id, race_id, storage_path, status, uploaded_at, created_at, updated_at) VALUES
  (1, 2601010501, 'gs://bucket/videos/20260411/tokyo/2601010501.mp4',    'LINKED',      '2026-04-13 11:30:00', '2026-04-13 11:30:00', '2026-04-13 11:30:00'),
  (2, NULL,       'gs://bucket/videos/20260412/nakayama/unknown.mp4',     'LINK_FAILED', '2026-04-13 15:00:00', '2026-04-13 15:00:00', '2026-04-13 15:00:00'),
  (3, 2601010601, 'gs://bucket/videos/20260411/nakayama/2601010601.mp4', 'LINKED',      '2026-04-13 12:00:00', '2026-04-13 12:00:00', '2026-04-13 12:00:00')
ON CONFLICT DO NOTHING
""")

# venue_weather_preset
cur.execute("""
INSERT INTO venue_weather_preset (id, venue_id, weather_preset_code, name, surface_type, preset_parameters, is_active) VALUES
  (1, 7, 'CLEAR', '中京・晴（標準）',  'DIRT', '{}', TRUE),
  (2, 5, 'RAIN',  '東京・雨（芝）',    'TURF', '{}', TRUE)
ON CONFLICT DO NOTHING
""")

# race_status_history
cur.execute("""
INSERT INTO race_status_history (id, race_id, from_status, from_sub_status, to_status, to_sub_status, reason, changed_by, created_at) VALUES
  (1, 2601010501, NULL,        NULL,   'WAITING',   NULL,      '初期登録',   1,    '2026-04-11 06:00:00'),
  (2, 2601010501, 'WAITING',   NULL,   'ANALYZING', NULL,      '解析開始',   NULL, '2026-04-11 07:00:00'),
  (3, 2601010501, 'ANALYZING', NULL,   'ANALYZED',  NULL,      '解析完了',   NULL, '2026-04-11 08:00:00'),
  (4, 2601010601, NULL,        NULL,   'WAITING',   NULL,      '初期登録',   1,    '2026-04-11 06:00:00'),
  (5, 2601010601, 'WAITING',   NULL,   'ANALYZING', NULL,      '解析開始',   NULL, '2026-04-11 07:00:00'),
  (6, 2601010601, 'ANALYZING', NULL,   'ANALYZED',  NULL,      '解析完了',   NULL, '2026-04-11 08:00:00'),
  (7, 2601010601, 'ANALYZED',  NULL,   'ANALYZED',  'EDITING', '補正開始',   1,    '2026-04-11 09:00:00'),
  (8, 2601010601, 'ANALYZED',  'EDITING','IN_REVIEW',NULL,     '補正完了',   1,    '2026-04-11 10:00:00'),
  (9, 2601010601, 'IN_REVIEW', NULL,   'ANALYZED',  'REVISION_REQUESTED','修正要請',10,'2026-04-11 11:00:00'),
  (10,2601010503, NULL,        NULL,   'WAITING',   NULL,      '初期登録',   1,    '2026-04-11 06:00:00'),
  (11,2601010503, 'WAITING',   NULL,   'ANALYZING', NULL,      '解析開始',   NULL, '2026-04-11 07:00:00'),
  (12,2601010503, 'ANALYZING', NULL,   'ANALYZED',  NULL,      '解析完了',   NULL, '2026-04-11 08:00:00'),
  (13,2601010503, 'ANALYZED',  NULL,   'ANALYZED',  'EDITING', '補正開始',   1,    '2026-04-11 09:00:00')
ON CONFLICT DO NOTHING
""")

# race_comment
cur.execute("""
INSERT INTO race_comment (id, race_id, status_history_id, comment_type, comment, created_by, created_at) VALUES
  (1, 2601010501, 3,    'REANALYSIS_REQUEST', '4コーナー付近の映像に揺れあり',     10, '2026-04-13 16:02:00'),
  (2, 2601010601, NULL, 'REVISION_REQUEST',   '直線区間の順位付けを再確認すること', 10, '2026-04-13 18:00:00')
ON CONFLICT DO NOTHING
""")

# analysis_job
cur.execute("""
INSERT INTO analysis_job (id, video_id, status, analysis_mode, started_at, completed_at, error_message, parameters, created_at, updated_at) VALUES
  (1, 1, 'SUCCESS', '200m',     '2026-04-11 08:00:00', '2026-04-11 08:05:30', NULL, NULL, '2026-04-11 08:00:00', '2026-04-11 08:05:30'),
  (2, 1, 'SUCCESS', 'STRAIGHT', '2026-04-11 08:06:00', '2026-04-11 08:08:00', NULL, '{}', '2026-04-11 08:06:00', '2026-04-11 08:08:00')
ON CONFLICT DO NOTHING
""")

# analysis_result_header
cur.execute("""
INSERT INTO analysis_result_header (id, job_id, race_id, is_current, horse_count, created_at, updated_at) VALUES
  (1,   1, 2601010501, TRUE, 16, '2026-04-11 08:05:30', '2026-04-11 08:05:30'),
  (501, 2, 2601010501, TRUE, 18, '2026-04-13 15:55:00', '2026-04-13 15:55:00')
ON CONFLICT DO NOTHING
""")

# Update race_official with current_analysis_result_id
cur.execute("""
UPDATE race_official SET current_analysis_result_id = 1 WHERE race_id = 2601010501
""")

# analysis_result_detail
cur.execute("""
INSERT INTO analysis_result_detail (id, header_id, time_sec, marker_type, class_name, reliability, course_position, passing_time, rank, data_type, created_at) VALUES
  (1,   1,   45.20, 'ハロン14', 'cap_orange_1', 80, '中', 12.50, 2, '200m',     '2026-04-11 08:05:30'),
  (2,   1,   72.40, 'ゴール',   'cap_orange_1', 90, '中', 72.40, 1, '200m',     '2026-04-11 08:05:30'),
  (3,   501, 64.20, '直線50m',  'cap_blue_2',   85, '外', 59.40, 1, 'STRAIGHT', '2026-04-13 15:55:00')
ON CONFLICT DO NOTHING
""")

# official_horse_reference
cur.execute("""
INSERT INTO official_horse_reference (id, horse_id, horse_delete_type, horse_name, horse_name_en, sex_code, raw_data, fetched_at) VALUES
  (1, 1995190012, 1, 'ドーン',         'Daun',         1, '{}', '2024-03-01 15:00:00'),
  (2, 2022104567, 0, 'サンプルホースA', 'Sample Horse A',1, '{}', '2026-04-01 16:00:00'),
  (3, 2022101234, 0, 'サンプルホースB', 'Sample Horse B',2, '{}', '2026-04-01 16:00:00')
ON CONFLICT DO NOTHING
""")

# analysis_option
cur.execute("""
INSERT INTO analysis_option (id, race_id, video_id, venue_weather_preset_id, video_goal_time, created_at, updated_at) VALUES
  (1, 2601010501, 1, 1, 104.70, '2026-04-11 08:05:31', '2026-04-11 08:10:00')
ON CONFLICT DO NOTHING
""")

# correction_memo_master
cur.execute("""
INSERT INTO correction_memo_master (id, memo_text, display_order, is_active) VALUES
  (1, '出遅れ',                  1, TRUE),
  (2, '大幅遅れ',                2, TRUE),
  (3, '映像見切れ',              3, TRUE),
  (4, '確認困難(ブレが大きい)',  4, TRUE),
  (5, '途中棄権',                5, TRUE),
  (6, 'その他',                  6, TRUE)
ON CONFLICT DO NOTHING
""")

# correction_session
cur.execute("""
INSERT INTO correction_session (id, race_id, analysis_result_id, analysis_job_id, started_by,
  started_from_status, started_from_sub_status, status, started_at, completed_at, last_heartbeat_at, created_at, updated_at) VALUES
  (1, 2601010503, 1, 1, 1,  'ANALYZED', NULL,              'ACTIVE',    '2026-04-18 09:00:00', NULL,                '2026-04-18 09:30:00', '2026-04-18 09:00:00', '2026-04-18 09:30:00'),
  (2, 2601020304, 1, 2, 10, 'IN_REVIEW',NULL,              'COMPLETED', '2026-04-16 10:00:00', '2026-04-16 11:00:00', NULL,                '2026-04-16 10:00:00', '2026-04-16 11:00:00')
ON CONFLICT DO NOTHING
""")

# Update race_official with correction sessions
cur.execute("""
UPDATE race_official SET current_correction_session_id = 1, corrected_by = 1, corrected_at = '2026-04-18 09:00:00'
WHERE race_id = 2601010503
""")

# correction_result
cur.execute("""
INSERT INTO correction_result (id, session_id, version, result_type, corrected_by, corrected_at, summary_text, correction_data, created_at) VALUES
  (1, 1, 1, 'DRAFT',     1,  '2026-04-18 14:45:00', '200m地点を補正',          '{}', '2026-04-18 14:45:00'),
  (2, 1, 2, 'DRAFT',     1,  '2026-04-18 14:52:00', '200m地点・400m地点を補正', '{}', '2026-04-18 14:52:00'),
  (3, 2, 1, 'COMPLETED', 10, '2026-04-16 11:00:00', '補正完了',                '{}', '2026-04-16 11:00:00')
ON CONFLICT DO NOTHING
""")

# audit_log
cur.execute("""
INSERT INTO audit_log (id, user_id, action, target_table, target_id, old_value, new_value, created_at) VALUES
  (1, 1,  'UPDATE', 'race_official',    1, '{"status":"WAITING"}',    '{"status":"ANALYZING"}', '2026-04-11 07:00:00'),
  (2, 10, 'UPDATE', 'correction_session',2, '{"status":"ACTIVE"}',   '{"status":"COMPLETED"}', '2026-04-16 11:00:00')
ON CONFLICT DO NOTHING
""")

# batch_job
cur.execute("""
INSERT INTO batch_job (id, name, target_type, target_folder, schedule_type, schedule_time, enabled, created_at, updated_at) VALUES
  (1, '深夜解析',   'FOLDER', '/videos/daily',   'DAILY', '02:00', TRUE,  '2024-01-01 00:00:00', '2024-01-01 00:00:00'),
  (2, '週末解析',   'FOLDER', '/videos/weekend', 'DAILY', '03:00', FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00')
ON CONFLICT DO NOTHING
""")

# batch_job_run
cur.execute("""
INSERT INTO batch_job_run (id, batch_job_id, trigger_type, status, started_at, completed_at, pending_count, processed_count, error_count, created_at, updated_at) VALUES
  (1, 1, 'SCHEDULED',      'SUCCESS',        '2024-03-15 02:00:00', '2024-03-15 02:25:00', 20, 20, 0, '2024-03-15 02:00:00', '2024-03-15 02:25:00'),
  (2, 1, 'MANUAL_REFRESH', 'PARTIAL_SUCCESS', '2024-03-15 10:00:00', '2024-03-15 10:01:00', 3,   2, 1, '2024-03-15 10:00:00', '2024-03-15 10:01:00')
ON CONFLICT DO NOTHING
""")

# batch_job_video
cur.execute("""
INSERT INTO batch_job_video (id, batch_job_id, race_video_id, status, last_run_id, last_analysis_job_id, created_at, updated_at) VALUES
  (1, 1, 1, 'SUCCESS', 1, 1, '2024-03-15 02:00:00', '2024-03-15 02:25:00'),
  (2, 1, 3, 'PENDING', NULL, NULL, '2024-04-11 00:00:00', '2024-04-11 00:00:00')
ON CONFLICT DO NOTHING
""")

# Fix sequences so next inserts don't conflict
for table, col in [
    ('race_category', 'id'), ('race_venue', 'id'), ('"user"', 'id'),
    ('race_type', 'id'), ('race_symbol', 'id'), ('race_condition', 'id'),
    ('race_official', 'id'), ('race_video', 'id'), ('venue_weather_preset', 'id'),
    ('race_status_history', 'id'), ('race_comment', 'id'),
    ('analysis_job', 'id'), ('analysis_result_header', 'id'), ('analysis_result_detail', 'id'),
    ('analysis_option', 'id'), ('official_horse_reference', 'id'),
    ('correction_memo_master', 'id'), ('correction_session', 'id'), ('correction_result', 'id'),
    ('audit_log', 'id'), ('batch_job', 'id'), ('batch_job_run', 'id'), ('batch_job_video', 'id'),
]:
    physical = table.strip('"')
    cur.execute(f"""
        SELECT setval(
            pg_get_serial_sequence('{table}', '{col}'),
            COALESCE((SELECT MAX({col}) FROM {table}), 1),
            true
        )
    """)

conn.commit()
cur.close()
conn.close()
print("✓ Seed complete: schema + dummy data applied.")
