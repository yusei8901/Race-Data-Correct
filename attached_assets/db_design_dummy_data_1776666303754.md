# ダミーデータ一覧

## 3.1 race_category

| id | code | name | created_at | updated_at |
|----|------|------|------------|------------|
| 1 | JRA | 中央競馬（JRA） | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |
| 2 | LOCAL | 地方競馬 | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |

---

## 3.2 race_venue

| id | category_id | code | name | short_name_1 | short_name_2 | short_name_3 | venue_name_en |
|----|-------------|------|------|-------------|-------------|-------------|---------------|
| 1 | 1 | 01 | 札幌競馬場 | 札 | 札幌 | 札幌 | SAPPORO |
| 2 | 1 | 02 | 函館競馬場 | 函 | 函館 | 函館 | HAKODATE |

---

## 3.3 race_official

| id | race_id | holding_date | place_code | holding_time | holding_day | race_number | race_type_code |
|----|---------|-------------|------------|-------------|-------------|-------------|----------------|
| 1 | 2601010501 | 20260411 | 05 | 01 | 01 | 1 | 12 |
| 2 | 2601010601 | 20260412 | 06 | 01 | 02 | 11 | 13 |

---

## 3.4 race_status_history

| id | race_id | from_status | from_sub_status | to_status | to_sub_status | reason | changed_by |
|----|---------|-------------|-----------------|-----------|---------------|--------|-----------|
| 1 | 2601010501 | NULL | NULL | WAITING | NULL | 初期登録 | 1 |
| 2 | 2501010501 | ANALYZING | NULL | ANALYZED | NULL | 解析完了 | NULL |
| 3 | 2601010503 | ANALYZED | NULL | ANALYZED | EDITING | 補正開始 | 10 |

---

## 3.5 race_comment

| id | race_id | status_history_id | comment_type | comment | created_by | created_at |
|----|---------|------------------|-------------|---------|-----------|------------|
| 1 | 2601010501 | 3 | REANALYSIS_REQUEST | 4コーナー付近の映像に揺れあり | 10 | 2026-04-13 16:02:00 |
| 2 | 2501010501 | NULL | REVISION_REQUEST | 直線区間の順位付けを再確認すること | 20 | 2026-04-13 18:00:00 |

---

## 3.6 race_video

| id | race_id | storage_path | status | uploaded_at | created_at |
|----|---------|-------------|--------|-------------|------------|
| 1 | 2601010501 | gs://bucket/videos/20260411/tokyo/2601010501.mp4 | LINKED | 2026-04-13 11:30:00 | 2026-04-13 11:30:00 |
| 2 | NULL | gs://bucket/videos/20260412/nakayama/unknown.mp4 | LINK_FAILED | 2026-04-13 15:00:00 | 2026-04-13 15:00:00 |

---

## 3.7 venue_weather_preset

| id | venue_id | weather_preset_code | name | surface_type | preset_parameters | is_active |
|----|----------|--------------------|----- |-------------|-------------------|-----------|
| 1 | 7 | CLEAR | 中京・晴（標準） | DIRT | {} | true |
| 2 | 5 | RAIN | 東京・雨（芝） | TURF | {} | true |

---

## 3.8 analysis_job

| id | video_id | status | analysis_mode | started_at | completed_at | error_message | parameters |
|----|----------|--------|--------------|------------|-------------|---------------|-----------|
| 1 | 1 | SUCCESS | 200m | 2024-03-15 12:00:00 | 2024-03-15 12:05:30 | NULL | NULL |
| 2 | 1 | SUCCESS | STRAIGHT | 2024-03-15 12:06:00 | 2024-03-15 12:08:00 | NULL | {} |

---

## 3.9 analysis_result_header

| id | job_id | race_id | is_current | horse_count | created_at | updated_at |
|----|--------|---------|-----------|------------|------------|------------|
| 1 | 1 | 2601010501 | true | 16 | 2024-03-15 12:05:30 | 2024-03-15 12:05:30 |
| 501 | 2 | 2501010501 | true | 18 | 2026-04-13 15:55:00 | 2026-04-13 15:55:00 |

---

## 3.10 analysis_result_detail

| id | header_id | time_sec | marker_type | class_name | course_position | passing_time | rank |
|----|-----------|----------|------------|------------|----------------|-------------|------|
| 1 | 1 | 45.20 | ハロン14 | cap_orange_1 | 中 | 12.50 | 2 |
| 2 | 1 | 72.40 | ゴール | cap_orange_1 | 中 | 72.40 | 1 |
| 3 | 501 | 64.20 | 直線50m | cap_blue_2 | 外 | 59.40 | 1 |

---

## 3.11 analysis_option

| id | race_id | video_id | venue_weather_preset_id | video_goal_time | created_at | updated_at |
|----|---------|----------|------------------------|----------------|------------|------------|
| 1 | 2501080202 | 1 | 1 | 104.70 | 2024-03-15 12:05:31 | 2024-03-15 12:10:00 |

---

## 3.12 official_horse_reference

| id | horse_id | horse_delete_type | horse_name | horse_name_en | sex_code | raw_data | fetched_at |
|----|----------|------------------|-----------|--------------|---------|---------|-----------|
| 1 | 1995190012 | 1 | ドーン | Daun | 1 | {} | 2024-XX-XX 15:00:00 |
| 2 | 2022104567 | 0 | サンプルホースA | Sample Horse A | 1 | {} | 2026-XX-XX 16:00:00 |

---

## 3.13 official_race_result

| id | race_id | horse_number | border_number | horse_id | line_entry_rank | final_arrival_order | gap_code |
|----|---------|-------------|--------------|----------|----------------|--------------------|---------| 
| 1 | 2601010501 | 3 | 2 | 2022104567 | 1 | 1 | NULL |
| 2 | 2601010501 | 12 | 7 | 2022101234 | 2 | 2 | 112 |
| 3 | 2601010501 | 8 | 5 | 2022109876 | NULL | NULL | NULL |

---

## 3.14 official_lead_furlong_time

| id | race_id | raptime1 | raptime2 | raptime3 | raptime4 | raptime5 | raptime6 |
|----|---------|---------|---------|---------|---------|---------|---------|
| 1 | 2601010501 | 12.5 | 11.8 | 12.0 | 12.3 | 12.1 | 12.4 |

---

## 3.15 race_linkage_result

| id | race_id | analysis_result_id | section_key | linkage_status | mapping_count | auto_mapped_count |
|----|---------|-------------------|------------|---------------|--------------|------------------|
| 1 | 2601010501 | 501 | PASSING_200 | SUCCESS | 16 | 16 |
| 2 | 2601010501 | 501 | STRAIGHT_700 | PARTIAL_SUCCESS | 16 | 14 |

---

## 3.15.1 race_linkage_mapping

| id | linkage_result_id | race_id | section_key | analysis_detail_id | detected_object_key | horse_number | horse_id |
|----|------------------|---------|------------|-------------------|--------------------|-----------| ---------|
| 1 | 1 | 2601010501 | PASSING_200 | 1001 | class_white_1 | 1 | 2022XXXXXX |
| 2 | 1 | 2601010501 | PASSING_200 | 1002 | class_black_1 | 4 | 2022XXXXXX |
| 3 | 2 | 2601010501 | STRAIGHT_700 | 1105 | class_red_1 | 5 | 2022XXXXXX |
| 4 | 2 | 2601010501 | STRAIGHT_700 | 1106 | class_orange_1 | NULL | NULL |

---

## 3.16 correction_session

| id | race_id | analysis_result_id | analysis_job_id | started_by | started_from_status | started_from_sub_status |
|----|---------|-------------------|----------------|-----------|--------------------|-----------------------|
| 1 | 2601020304 | 501 | 2 | 10 | ANALYZED | NULL |
| 2 | 2501020304 | 1 | 1 | 1 | ANALYZED | REVISION_REQUESTED |
| 3 | 2601010501 | 701 | 5 | 20 | IN_REVIEW | NULL |
| 4 | 2601010502 | 702 | 6 | 10 | CONFIRMED | NULL |

---

## 3.17 correction_result

| id | session_id | version | result_type | corrected_by | corrected_at | summary_text | correction_data |
|----|-----------|---------|------------|-------------|-------------|-------------|----------------|
| 1 | 1 | 1 | DRAFT | 10 | 2026-04-18 14:45:00 | 200m地点を補正 | {} |
| 2 | 1 | 2 | DRAFT | 10 | 2026-04-18 14:52:00 | 200m地点・400m地点を補正 | {} |
| 3 | 1 | 3 | COMPLETED | 10 | 2026-04-18 15:10:00 | 補正完了 | {} |
| 4 | 3 | 1 | DRAFT | 20 | 2026-04-18 09:18:00 | 直線区間の補正を保存 | {} |

---

## 3.18 user

| id | external_subject_id | auth_provider | email | name | created_at | updated_at |
|----|--------------------|--------------|----- |------|------------|------------|
| 1 | 108012345678901234567 | iap_google | user@example.com | 補正担当者A | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |
| 10 | 108099999999999999999 | iap_google | admin@example.com | 管理者A | 2026-04-01 00:00:00 | 2026-04-01 00:00:00 |

---

## 3.19 audit_log

| id | user_id | action | target_table | target_id | old_value | new_value |
|----|---------|--------|-------------|----------|-----------|-----------|
| 1 | 1 | UPDATE | race_official | 1 | {"status":"WAITING"} | {"status":"ANALYZING"} |
| 2 | 10 | UPDATE | correction_session | 1 | {"status":"ACTIVE"} | {"status":"COMPLETED"} |

---

## 3.20 csv_export_job

| id | event_id | dataset | status | storage_path | requested_by |
|----|----------|---------|--------|-------------|-------------|
| 1 | 202604110501 | all | SUCCESS | gs://bucket/export/20260411_tokyo_1.zip | 1 |
| 2 | 202604120601 | passing_points | RUNNING | NULL | 10 |

---

## 3.21 correction_memo_master

| id | memo_text | display_order | is_active |
|----|----------|--------------|-----------|
| 1 | 出遅れ | 1 | true |
| 2 | 映像見切れ | 2 | true |

---

## 3.22 analysis_passing_point

| id | race_id | header_id | horse_number | border_number | horse_id | horse_name | marker_distance |
|----|---------|----------|-------------|--------------|---------|-----------|----------------|
| 1 | 2601020304 | 1 | 1 | 1 | 1995190012 | ルンウィンディ | 1200 |
| 2 | 2501020304 | 501 | 12 | 7 | 2022101234 | サンプルホースB | 400 |

---

## 3.23 analysis_straight_section

| id | race_id | header_id | horse_number | border_number | horse_id | horse_name | section_start_dist |
|----|---------|----------|-------------|--------------|---------|-----------|-------------------|
| 1 | 2601020304 | 1 | 1 | 1 | 1995190012 | ルンウィンディ | 400 |
| 2 | 2501020304 | 501 | 12 | 7 | 2022101234 | サンプルホースB | 350 |

---

## 3.24 race_type

| id | code | name | name_sub1 | name_sub2 | is_active | created_at | updated_at |
|----|------|------|----------|----------|-----------|------------|------------|
| 1 | 00 | 海外・地方成績時の既定値 | NULL | NULL | true | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |
| 2 | 11 | 2歳 | サラ系2歳 | サラ系3歳 | true | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |

---

## 3.25 race_symbol

| id | code | name | short_name | is_active | created_at | updated_at |
|----|------|------|-----------|-----------|------------|------------|
| 1 | 000 | 記号無し | DSN | true | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |
| 2 | 001 | [指定] | DSN | true | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |

---

## 3.26 race_condition

| id | code | name | name_sub1 | is_active | created_at | updated_at |
|----|------|------|----------|-----------|------------|------------|
| 5 | 005 | 1勝クラス | 500万円以下 | true | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |
| 7 | 016 | 3勝クラス | 1600万円以下 | true | 2024-01-01 00:00:00 | 2024-01-01 00:00:00 |

---

## 3.28 batch_job

| id | name | target_type | target_folder | schedule_type | schedule_time | enabled |
|----|------|------------|--------------|--------------|--------------|---------|
| 1 | 深夜解析 | FOLDER | /videos/daily | DAILY | 02:00 | true |
| 2 | 週末解析 | FOLDER | /videos/weekend | DAILY | 03:00 | false |

---

## 3.29 batch_job_run

| id | batch_job_id | trigger_type | status | started_at | completed_at | pending_count | processed_count |
|----|-------------|-------------|--------|------------|-------------|--------------|----------------|
| 1 | 1 | SCHEDULED | SUCCESS | 2024-03-15 02:00:00 | 2024-03-15 02:25:00 | 20 | 20 |
| 2 | 1 | MANUAL_REFRESH | PARTIAL_SUCCESS | 2024-03-15 10:00:00 | 2024-03-15 10:01:00 | 3 | 2 |

---

## 3.30 batch_job_video

| id | batch_job_id | race_video_id | status | last_run_id | last_analysis_job_id | error_message |
|----|-------------|--------------|--------|------------|---------------------|--------------|
| 1 | 1 | 101 | PENDING | NULL | NULL | NULL |
| 2 | 1 | 102 | SUCCESS | 1 | 5001 | NULL |
| 3 | 1 | 103 | ERROR | 1 | 5002 | 解析コンテナ異常終了 |
