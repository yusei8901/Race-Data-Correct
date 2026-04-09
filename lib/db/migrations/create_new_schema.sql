-- Furlong CUBE normalized schema migration
-- 24 tables total:
--   1-19: core tables (race_category through csv_export_job)
--   20: analysis_venue_config (per-venue analysis parameters)
--   21: batch_job (processing management)
--   22: analysis_option (per-race analysis parameters)
--   23: analysis_passing_point (200m lap-time point data for CSV/visualization)
--   24: analysis_straight_section (straight-section data for CSV/visualization)
-- csv_export_job.dataset: passing_points / straight_sections / all

-- 1. user (no FK deps)
CREATE TABLE IF NOT EXISTS "user" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject_id VARCHAR(255) NOT NULL UNIQUE,
  auth_provider VARCHAR(50),
  email VARCHAR(255),
  name VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. race_category (no FK deps)
CREATE TABLE IF NOT EXISTS race_category (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. correction_memo_master (no FK deps)
CREATE TABLE IF NOT EXISTS correction_memo_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_text VARCHAR(200) NOT NULL,
  display_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. venue_weather_preset (no FK deps)
CREATE TABLE IF NOT EXISTS venue_weather_preset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_code VARCHAR(20) NOT NULL,
  weather_preset_code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  surface_type VARCHAR(20),
  preset_parameters JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. jra_race_reference (no FK deps)
CREATE TABLE IF NOT EXISTS jra_race_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_race_id VARCHAR(100) NOT NULL,
  event_date DATE NOT NULL,
  venue_code VARCHAR(20) NOT NULL,
  race_number INTEGER NOT NULL,
  weather VARCHAR(50),
  course_distance INTEGER,
  surface_type VARCHAR(20),
  course_direction VARCHAR(20),
  course_position VARCHAR(20),
  start_time VARCHAR(10),
  raw_data JSONB NOT NULL DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. official_horse_reference (no FK deps)
CREATE TABLE IF NOT EXISTS official_horse_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_race_id VARCHAR(100) NOT NULL,
  official_horse_id VARCHAR(100) NOT NULL,
  frame_number INTEGER NOT NULL,
  horse_number INTEGER NOT NULL,
  horse_name VARCHAR(100) NOT NULL,
  finishing_order INTEGER,
  corner_pass_order VARCHAR(50),
  jockey_name VARCHAR(50),
  trainer_name VARCHAR(50),
  carried_weight DECIMAL(4,1),
  sex_age VARCHAR(20),
  finishing_time DECIMAL(10,2),
  raw_data JSONB NOT NULL DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. race_event (FK → race_category)
CREATE TABLE IF NOT EXISTS race_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES race_category(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  venue_code VARCHAR(20) NOT NULL,
  venue_name VARCHAR(100) NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(category_id, event_date, venue_code, round)
);

-- 8. race (FK → race_event, "user"; no circular FKs on current_*_id)
CREATE TABLE IF NOT EXISTS race (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES race_event(id) ON DELETE CASCADE,
  race_number INTEGER NOT NULL,
  race_name VARCHAR(200),
  start_time VARCHAR(10),
  surface_type VARCHAR(20),
  distance INTEGER,
  direction VARCHAR(20),
  weather VARCHAR(20),
  track_condition VARCHAR(20),
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  current_analysis_result_id UUID,
  current_correction_session_id UUID,
  corrected_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
  corrected_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, race_number)
);

-- 9. race_video (FK → race)
CREATE TABLE IF NOT EXISTS race_video (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES race(id) ON DELETE CASCADE,
  storage_path VARCHAR(500) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'INCOMPLETE',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. analysis_job (FK → race_video)
CREATE TABLE IF NOT EXISTS analysis_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES race_video(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  analysis_mode VARCHAR(20) NOT NULL DEFAULT '200m',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  parameters JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. analysis_result_header (FK → analysis_job, race)
CREATE TABLE IF NOT EXISTS analysis_result_header (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES analysis_job(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES race(id) ON DELETE CASCADE,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  horse_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. analysis_result_detail (FK → analysis_result_header)
CREATE TABLE IF NOT EXISTS analysis_result_detail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES analysis_result_header(id) ON DELETE CASCADE,
  time_sec DECIMAL(10,2),
  marker_type VARCHAR(50),
  class_name VARCHAR(50),
  course_position VARCHAR(20),
  rank INTEGER,
  race_time DECIMAL(10,2),
  corrected_time DECIMAL(10,2),
  data_type VARCHAR(20),
  section_no INTEGER,
  centerline_dy DECIMAL(10,4),
  corrected_speed DECIMAL(10,2),
  speed_kmh DECIMAL(10,2),
  horse_number INTEGER,
  horse_name VARCHAR(100),
  gate_number INTEGER,
  color VARCHAR(10),
  lane VARCHAR(10),
  accuracy INTEGER,
  position INTEGER,
  is_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  original_position INTEGER,
  absolute_speed DECIMAL(8,2),
  speed_change DECIMAL(8,2),
  running_position INTEGER,
  special_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. official_horse_furlong_time (FK → official_horse_reference)
CREATE TABLE IF NOT EXISTS official_horse_furlong_time (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_horse_reference_id UUID NOT NULL REFERENCES official_horse_reference(id) ON DELETE CASCADE,
  furlong_no INTEGER NOT NULL,
  time_sec DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. race_linkage_result (FK → race)
CREATE TABLE IF NOT EXISTS race_linkage_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES race(id) ON DELETE CASCADE,
  official_race_id VARCHAR(100) NOT NULL,
  linkage_status VARCHAR(30) NOT NULL DEFAULT 'SUCCESS',
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  diff_summary JSONB NOT NULL DEFAULT '{}',
  horse_mapping JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. correction_session (FK → race, "user"; no FK on analysis_result_id to avoid circular)
CREATE TABLE IF NOT EXISTS correction_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES race(id) ON DELETE CASCADE,
  analysis_result_id UUID,
  analysis_job_id UUID,
  started_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. correction_result (FK → correction_session, "user")
CREATE TABLE IF NOT EXISTS correction_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES correction_session(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  corrected_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correction_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. audit_log (FK → "user")
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  target_table VARCHAR(100) NOT NULL,
  target_id VARCHAR(36) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. race_status_history (FK → race, "user")
CREATE TABLE IF NOT EXISTS race_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES race(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL,
  changed_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. csv_export_job (FK → race_event, "user")
CREATE TABLE IF NOT EXISTS csv_export_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES race_event(id) ON DELETE CASCADE,
  dataset VARCHAR(30) NOT NULL DEFAULT 'all',
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  storage_path VARCHAR(500),
  requested_by UUID REFERENCES "user"(id) ON DELETE SET NULL,
  error_message TEXT,
  race_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
-- dataset values: passing_points / straight_sections / all

-- 20. analysis_venue_config (analysis parameters per venue, no FK)
CREATE TABLE IF NOT EXISTS analysis_venue_config (
  venue_id   VARCHAR(20) PRIMARY KEY,
  venue_name VARCHAR(100) NOT NULL,
  race_type  VARCHAR(50)  NOT NULL,
  params     JSONB        NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 21. batch_job (processing management batch jobs, no FK)
CREATE TABLE IF NOT EXISTS batch_job (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  cron_expression VARCHAR(50)  NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT '停止中',
  is_enabled      BOOLEAN      NOT NULL DEFAULT false,
  next_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 22. analysis_option (解析オプション: per-race analysis parameters)
CREATE TABLE IF NOT EXISTS analysis_option (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id                   UUID NOT NULL REFERENCES race(id) ON DELETE CASCADE,
  video_id                  UUID NOT NULL REFERENCES race_video(id) ON DELETE CASCADE,
  venue_weather_preset_id   UUID REFERENCES venue_weather_preset(id) ON DELETE SET NULL,
  video_goal_time           DECIMAL(10,2),
  comment                   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_id, video_id)
);

-- 23. analysis_passing_point (解析通過地点（点）: 200m lap-time points for CSV/visualization)
CREATE TABLE IF NOT EXISTS analysis_passing_point (
  id                    BIGSERIAL PRIMARY KEY,
  race_id               UUID NOT NULL REFERENCES race(id) ON DELETE CASCADE,
  header_id             UUID NOT NULL REFERENCES analysis_result_header(id) ON DELETE CASCADE,
  horse_number          INT NOT NULL,
  frame_number          INT,
  horse_name            VARCHAR(100),
  marker_distance       INT NOT NULL,
  marker_type           VARCHAR(50),
  rank                  INT,
  video_time_sec        DECIMAL(10,2),
  passing_time          DECIMAL(10,2) NOT NULL,
  official_time_sec     DECIMAL(10,2),
  lane_position         VARCHAR(20),
  ai_class_name         VARCHAR(50),
  special_note          VARCHAR(200),
  is_manually_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_id, horse_number, marker_distance)
);

-- 24. analysis_straight_section (解析直線区間（線）: straight section data for CSV/visualization)
CREATE TABLE IF NOT EXISTS analysis_straight_section (
  id                    BIGSERIAL PRIMARY KEY,
  race_id               UUID NOT NULL REFERENCES race(id) ON DELETE CASCADE,
  header_id             UUID NOT NULL REFERENCES analysis_result_header(id) ON DELETE CASCADE,
  horse_number          INT NOT NULL,
  frame_number          INT,
  horse_name            VARCHAR(100),
  section_start_dist    INT NOT NULL,
  section_end_dist      INT NOT NULL,
  section_no            INT,
  est_video_time_sec    DECIMAL(10,2),
  est_passing_time      DECIMAL(10,2),
  est_official_time_sec DECIMAL(10,2),
  section_avg_speed     DECIMAL(10,2),
  speed_diff            DECIMAL(10,2),
  lateral_position      DECIMAL(10,4),
  ai_class_name         VARCHAR(50),
  is_manually_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(race_id, horse_number, section_start_dist, section_end_dist)
);

