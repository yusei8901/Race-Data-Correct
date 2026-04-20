-- ============================================================
-- Furlong CUBE v2: Complete Schema Migration
-- Drops all existing tables and recreates from DB design doc
-- ============================================================

-- Drop all existing tables (CASCADE removes dependent FKs)
DROP TABLE IF EXISTS
  bbox_annotation, bbox_param_preset,
  analysis_venue_config,
  jra_race_reference,
  official_horse_furlong_time,
  race_event, race_statuses,
  batch_job_video, batch_job_run,
  race_sync_job,
  audit_log,
  csv_export_job,
  correction_memo_master,
  analysis_straight_section, analysis_passing_point,
  correction_result, correction_session,
  race_linkage_mapping, race_linkage_result,
  official_lead_furlong_time, official_race_result,
  official_horse_reference,
  analysis_option,
  analysis_result_detail, analysis_result_header,
  analysis_job,
  venue_weather_preset,
  race_comment, race_status_history,
  race_video,
  race,
  race_official,
  race_condition, race_symbol, race_type,
  race_venue, race_category,
  "user",
  batch_job
  CASCADE;

-- ============================================================
-- INDEPENDENT MASTER TABLES
-- ============================================================

CREATE TABLE race_category (
  id         BIGSERIAL PRIMARY KEY,
  code       VARCHAR(20)  NOT NULL,
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_race_category_code UNIQUE (code)
);

CREATE TABLE "user" (
  id                   BIGSERIAL    PRIMARY KEY,
  external_subject_id  VARCHAR(255) NOT NULL,
  auth_provider        VARCHAR(50),
  email                VARCHAR(255),
  name                 VARCHAR(100),
  created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_external_subject_id UNIQUE (external_subject_id)
);

CREATE TABLE race_type (
  id         BIGSERIAL   PRIMARY KEY,
  code       VARCHAR(2)  NOT NULL,
  name       VARCHAR(50),
  name_sub1  VARCHAR(50),
  name_sub2  VARCHAR(50),
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_race_type_code UNIQUE (code)
);

CREATE TABLE race_symbol (
  id         BIGSERIAL    PRIMARY KEY,
  code       VARCHAR(3)   NOT NULL,
  name       VARCHAR(100) NOT NULL,
  short_name VARCHAR(20),
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_race_symbol_code UNIQUE (code)
);

CREATE TABLE race_condition (
  id         BIGSERIAL   PRIMARY KEY,
  code       VARCHAR(3)  NOT NULL,
  name       VARCHAR(50),
  name_sub1  VARCHAR(50),
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_race_condition_code UNIQUE (code)
);

CREATE TABLE correction_memo_master (
  id            BIGSERIAL    PRIMARY KEY,
  memo_text     VARCHAR(200) NOT NULL,
  display_order INT          NOT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ============================================================
-- VENUE
-- ============================================================

CREATE TABLE race_venue (
  id            BIGSERIAL    PRIMARY KEY,
  category_id   BIGINT       NOT NULL REFERENCES race_category(id),
  code          VARCHAR(2)   NOT NULL,
  name          VARCHAR(100) NOT NULL,
  short_name_1  VARCHAR(1),
  short_name_2  VARCHAR(2),
  short_name_3  VARCHAR(3),
  venue_name_en VARCHAR(50),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_race_venue_code UNIQUE (code)
);

-- ============================================================
-- RACE OFFICIAL (no circular FKs yet)
-- ============================================================

CREATE TABLE race_official (
  id                          BIGSERIAL    PRIMARY KEY,
  race_id                     BIGINT       NOT NULL,
  holding_date                BIGINT,
  place_code                  VARCHAR(2)   REFERENCES race_venue(code),
  holding_time                VARCHAR(2),
  holding_day                 VARCHAR(2),
  race_number                 INT,
  race_type_code              VARCHAR(2)   REFERENCES race_type(code),
  race_symbol_code            VARCHAR(3)   REFERENCES race_symbol(code),
  race_condition_code1        VARCHAR(3)   REFERENCES race_condition(code),
  race_condition_code2        VARCHAR(3)   REFERENCES race_condition(code),
  race_condition_code3        VARCHAR(3)   REFERENCES race_condition(code),
  race_condition_code4        VARCHAR(3)   REFERENCES race_condition(code),
  start_time                  TIME,
  change_start_time           TIME,
  race_title                  VARCHAR(200),
  distance                    INT,
  track_code                  INT,
  fence_type                  SMALLINT,
  weather_code                SMALLINT,
  turf_condition_code         SMALLINT,
  dirt_condition_code         SMALLINT,
  start_head_number           INT,
  raw_data                    JSONB,
  status                      VARCHAR(30)  NOT NULL DEFAULT 'WAITING',
  sub_status                  VARCHAR(50),
  current_analysis_result_id  BIGINT,
  current_correction_session_id BIGINT,
  corrected_by                BIGINT       REFERENCES "user"(id),
  corrected_at                TIMESTAMP,
  confirmed_at                TIMESTAMP,
  confirmed_by                BIGINT       REFERENCES "user"(id),
  created_at                  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_race_official_race_id UNIQUE (race_id)
);

-- ============================================================
-- RACE VIDEO
-- ============================================================

CREATE TABLE race_video (
  id           BIGSERIAL    PRIMARY KEY,
  race_id      BIGINT       REFERENCES race_official(race_id),
  storage_path VARCHAR(500) NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'UNLINK',
  uploaded_at  TIMESTAMP,
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- VENUE WEATHER PRESET
-- ============================================================

CREATE TABLE venue_weather_preset (
  id                   BIGSERIAL    PRIMARY KEY,
  venue_id             BIGINT       NOT NULL REFERENCES race_venue(id),
  weather_preset_code  VARCHAR(50)  NOT NULL,
  name                 VARCHAR(100) NOT NULL,
  surface_type         VARCHAR(20),
  preset_parameters    JSONB        NOT NULL DEFAULT '{}',
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RACE STATUS HISTORY
-- ============================================================

CREATE TABLE race_status_history (
  id              BIGSERIAL    PRIMARY KEY,
  race_id         BIGINT       NOT NULL REFERENCES race_official(race_id),
  from_status     VARCHAR(30),
  from_sub_status VARCHAR(50),
  to_status       VARCHAR(30)  NOT NULL,
  to_sub_status   VARCHAR(50),
  reason          VARCHAR(200),
  changed_by      BIGINT       REFERENCES "user"(id),
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RACE COMMENT
-- ============================================================

CREATE TABLE race_comment (
  id                BIGSERIAL   PRIMARY KEY,
  race_id           BIGINT      NOT NULL REFERENCES race_official(race_id),
  status_history_id BIGINT      REFERENCES race_status_history(id),
  comment_type      VARCHAR(30) NOT NULL,
  comment           TEXT        NOT NULL,
  created_by        BIGINT      NOT NULL REFERENCES "user"(id),
  created_at        TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_race_comment_type CHECK (comment_type IN ('REVISION_REQUEST','REANALYSIS_REQUEST'))
);

-- ============================================================
-- ANALYSIS JOB
-- ============================================================

CREATE TABLE analysis_job (
  id            BIGSERIAL   PRIMARY KEY,
  video_id      BIGINT      NOT NULL REFERENCES race_video(id),
  status        VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  analysis_mode VARCHAR(20) NOT NULL,
  started_at    TIMESTAMP,
  completed_at  TIMESTAMP,
  error_message TEXT,
  parameters    JSONB,
  created_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ANALYSIS RESULT HEADER
-- ============================================================

CREATE TABLE analysis_result_header (
  id          BIGSERIAL PRIMARY KEY,
  job_id      BIGINT    NOT NULL REFERENCES analysis_job(id),
  race_id     BIGINT    NOT NULL REFERENCES race_official(race_id),
  is_current  BOOLEAN   NOT NULL DEFAULT TRUE,
  horse_count INT       NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ANALYSIS RESULT DETAIL
-- ============================================================

CREATE TABLE analysis_result_detail (
  id              BIGSERIAL      PRIMARY KEY,
  header_id       BIGINT         NOT NULL REFERENCES analysis_result_header(id),
  time_sec        DECIMAL(10,2)  NOT NULL,
  marker_type     VARCHAR(50)    NOT NULL,
  class_name      VARCHAR(50)    NOT NULL,
  reliability     INT            NOT NULL DEFAULT 0,
  course_position VARCHAR(20),
  passing_time    DECIMAL(10,2),
  rank            INT,
  data_type       VARCHAR(20),
  section_no      INT,
  centerline_dy   DECIMAL(10,4),
  corrected_speed DECIMAL(10,2),
  speed_kmh       DECIMAL(10,2),
  speed_change    DECIMAL(10,2),
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ANALYSIS OPTION
-- ============================================================

CREATE TABLE analysis_option (
  id                      BIGSERIAL     PRIMARY KEY,
  race_id                 BIGINT        NOT NULL REFERENCES race_official(race_id),
  video_id                BIGINT        NOT NULL REFERENCES race_video(id),
  venue_weather_preset_id BIGINT        REFERENCES venue_weather_preset(id),
  video_goal_time         DECIMAL(10,2),
  created_at              TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_analysis_option_video_id UNIQUE (video_id)
);

-- ============================================================
-- OFFICIAL HORSE REFERENCE
-- ============================================================

CREATE TABLE official_horse_reference (
  horse_delete_type SMALLINT     NOT NULL DEFAULT 0,
  id                BIGSERIAL    PRIMARY KEY,
  horse_id          BIGINT       NOT NULL,
  horse_name        VARCHAR(36)  NOT NULL,
  horse_name_en     VARCHAR(80),
  sex_code          SMALLINT     NOT NULL,
  raw_data          JSONB        NOT NULL DEFAULT '{}',
  fetched_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_official_horse_reference_horse_id UNIQUE (horse_id)
);

-- ============================================================
-- OFFICIAL RACE RESULT
-- ============================================================

CREATE TABLE official_race_result (
  id                    BIGSERIAL   PRIMARY KEY,
  race_id               BIGINT      NOT NULL REFERENCES race_official(race_id),
  horse_number          INT         NOT NULL,
  border_number         INT         NOT NULL,
  horse_id              BIGINT      NOT NULL REFERENCES official_horse_reference(horse_id),
  line_entry_rank       VARCHAR(3),
  final_arrival_order   VARCHAR(3),
  gap_code              VARCHAR(3),
  arrival_time          VARCHAR(5),
  error_code            SMALLINT    NOT NULL DEFAULT 0,
  first_corner_ranking  INT,
  second_corner_ranking INT,
  third_corner_ranking  INT,
  fourth_corner_ranking INT,
  furlong_type          SMALLINT    NOT NULL DEFAULT 0,
  furlong_time          VARCHAR(4),
  raw_data              JSONB       NOT NULL DEFAULT '{}',
  fetched_at            TIMESTAMP   NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_official_race_result_race_horse UNIQUE (race_id, horse_number)
);

-- ============================================================
-- OFFICIAL LEAD FURLONG TIME
-- ============================================================

CREATE TABLE official_lead_furlong_time (
  id             BIGSERIAL     PRIMARY KEY,
  race_id        BIGINT        NOT NULL REFERENCES race_official(race_id),
  raptime1       DECIMAL(4,1),
  raptime2       DECIMAL(4,1),
  raptime3       DECIMAL(4,1),
  raptime4       DECIMAL(4,1),
  raptime5       DECIMAL(4,1),
  raptime6       DECIMAL(4,1),
  raptime7       DECIMAL(4,1),
  raptime8       DECIMAL(4,1),
  raptime9       DECIMAL(4,1),
  raptime10      DECIMAL(4,1),
  raptime11      DECIMAL(4,1),
  raptime12      DECIMAL(4,1),
  raptime13      DECIMAL(4,1),
  raptime14      DECIMAL(4,1),
  raptime15      DECIMAL(4,1),
  raptime16      DECIMAL(4,1),
  raptime17      DECIMAL(4,1),
  raptime18      DECIMAL(4,1),
  raptime19      DECIMAL(4,1),
  raptime20      DECIMAL(4,1),
  front_furlong3 DECIMAL(4,1),
  front_furlong4 DECIMAL(4,1),
  rear_furlong4  DECIMAL(4,1),
  rear_furlong3  DECIMAL(4,1),
  raw_data       JSONB         NOT NULL DEFAULT '{}',
  fetched_at     TIMESTAMP     NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_official_lead_furlong_time_race_id UNIQUE (race_id)
);

-- ============================================================
-- RACE LINKAGE RESULT
-- ============================================================

CREATE TABLE race_linkage_result (
  id                  BIGSERIAL   PRIMARY KEY,
  race_id             BIGINT      NOT NULL REFERENCES race_official(race_id),
  analysis_result_id  BIGINT      NOT NULL REFERENCES analysis_result_header(id),
  section_key         VARCHAR(50),
  linkage_status      VARCHAR(30) NOT NULL,
  mapping_count       INT         NOT NULL DEFAULT 0,
  auto_mapped_count   INT         NOT NULL DEFAULT 0,
  manual_mapped_count INT         NOT NULL DEFAULT 0,
  failed_count        INT         NOT NULL DEFAULT 0,
  diff_summary        JSONB,
  executed_by         BIGINT      REFERENCES "user"(id),
  linked_at           TIMESTAMP   NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RACE LINKAGE MAPPING
-- ============================================================

CREATE TABLE race_linkage_mapping (
  id                  BIGSERIAL     PRIMARY KEY,
  linkage_result_id   BIGINT        NOT NULL REFERENCES race_linkage_result(id),
  race_id             BIGINT        NOT NULL REFERENCES race_official(race_id),
  section_key         VARCHAR(50)   NOT NULL,
  analysis_detail_id  BIGINT        REFERENCES analysis_result_detail(id),
  detected_object_key VARCHAR(100)  NOT NULL,
  horse_number        INT,
  horse_id            BIGINT        REFERENCES official_horse_reference(horse_id),
  official_result_id  BIGINT        REFERENCES official_race_result(id),
  confidence          DECIMAL(5,4),
  mapping_source      VARCHAR(20)   NOT NULL DEFAULT 'AUTO',
  mapping_status      VARCHAR(20)   NOT NULL DEFAULT 'UNMATCHED',
  linked_by           BIGINT        REFERENCES "user"(id),
  linked_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CORRECTION SESSION
-- ============================================================

CREATE TABLE correction_session (
  id                       BIGSERIAL   PRIMARY KEY,
  race_id                  BIGINT      NOT NULL REFERENCES race_official(race_id),
  analysis_result_id       BIGINT      NOT NULL REFERENCES analysis_result_header(id),
  analysis_job_id          BIGINT      REFERENCES analysis_job(id) ON DELETE SET NULL,
  started_by               BIGINT      NOT NULL REFERENCES "user"(id),
  started_from_status      VARCHAR(30) NOT NULL,
  started_from_sub_status  VARCHAR(50),
  status                   VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  started_at               TIMESTAMP   NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMP,
  last_heartbeat_at        TIMESTAMP,
  base_correction_result_id BIGINT,
  created_at               TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CORRECTION RESULT
-- ============================================================

CREATE TABLE correction_result (
  id              BIGSERIAL    PRIMARY KEY,
  session_id      BIGINT       NOT NULL REFERENCES correction_session(id),
  version         INT          NOT NULL,
  result_type     VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  corrected_by    BIGINT       NOT NULL REFERENCES "user"(id),
  corrected_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  summary_text    VARCHAR(255),
  correction_data JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_correction_result_session_version UNIQUE (session_id, version)
);

-- Add circular FK backref to correction_session
ALTER TABLE correction_session
  ADD CONSTRAINT fk_correction_session_base_result
  FOREIGN KEY (base_correction_result_id) REFERENCES correction_result(id);

-- ============================================================
-- Add circular FKs to race_official
-- ============================================================

ALTER TABLE race_official
  ADD CONSTRAINT fk_race_official_analysis_result
  FOREIGN KEY (current_analysis_result_id) REFERENCES analysis_result_header(id);

ALTER TABLE race_official
  ADD CONSTRAINT fk_race_official_correction_session
  FOREIGN KEY (current_correction_session_id) REFERENCES correction_session(id);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_log (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      BIGINT       REFERENCES "user"(id),
  action       VARCHAR(50)  NOT NULL,
  target_table VARCHAR(100) NOT NULL,
  target_id    BIGINT       NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  ip_address   VARCHAR(45),
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CSV EXPORT JOB
-- ============================================================

CREATE TABLE csv_export_job (
  id            BIGSERIAL    PRIMARY KEY,
  event_id      BIGINT       NOT NULL,
  dataset       VARCHAR(30)  NOT NULL,
  status        VARCHAR(30)  NOT NULL DEFAULT 'PENDING',
  storage_path  VARCHAR(500),
  requested_by  BIGINT       NOT NULL REFERENCES "user"(id),
  error_message TEXT,
  error_details JSONB        NOT NULL DEFAULT '{}',
  race_count    INT,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMP,
  completed_at  TIMESTAMP
);

-- ============================================================
-- ANALYSIS PASSING POINT
-- ============================================================

CREATE TABLE analysis_passing_point (
  id                   BIGSERIAL     PRIMARY KEY,
  race_id              BIGINT        NOT NULL REFERENCES race_official(race_id),
  header_id            BIGINT        NOT NULL REFERENCES analysis_result_header(id),
  horse_number         INT           NOT NULL,
  border_number        INT,
  horse_id             BIGINT        REFERENCES official_horse_reference(horse_id),
  horse_name           VARCHAR(100),
  marker_distance      INT           NOT NULL,
  marker_type          VARCHAR(50),
  rank                 INT,
  video_time_sec       DECIMAL(10,2),
  passing_time         DECIMAL(10,2) NOT NULL,
  official_time_sec    DECIMAL(10,2),
  lane_position        VARCHAR(20),
  ai_class_name        VARCHAR(50),
  special_note         VARCHAR(200),
  is_manually_corrected BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_analysis_passing_point UNIQUE (race_id, horse_number, marker_distance)
);

-- ============================================================
-- ANALYSIS STRAIGHT SECTION
-- ============================================================

CREATE TABLE analysis_straight_section (
  id                    BIGSERIAL     PRIMARY KEY,
  race_id               BIGINT        NOT NULL REFERENCES race_official(race_id),
  header_id             BIGINT        NOT NULL REFERENCES analysis_result_header(id),
  horse_number          INT           NOT NULL,
  border_number         INT,
  horse_id              BIGINT        REFERENCES official_horse_reference(horse_id),
  horse_name            VARCHAR(100),
  section_start_dist    INT           NOT NULL,
  section_end_dist      INT           NOT NULL,
  section_no            INT,
  est_video_time_sec    DECIMAL(10,2),
  est_passing_time      DECIMAL(10,2),
  est_official_time_sec DECIMAL(10,2),
  section_avg_speed     DECIMAL(10,2),
  speed_diff            DECIMAL(10,2),
  lateral_position      DECIMAL(10,4),
  ai_class_name         VARCHAR(50),
  is_manually_corrected BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_analysis_straight_section UNIQUE (race_id, horse_number, section_start_dist, section_end_dist)
);

-- ============================================================
-- SYNC & BATCH TABLES
-- ============================================================

CREATE TABLE race_sync_job (
  id                       BIGSERIAL   PRIMARY KEY,
  requested_by             BIGINT      REFERENCES "user"(id),
  status                   VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  filter_conditions        JSONB       NOT NULL DEFAULT '{}',
  target_count             INT,
  success_count            INT,
  failure_count            INT,
  video_link_success_count INT,
  video_link_failure_count INT,
  status_changed_count     INT,
  error_summary            JSONB,
  created_at               TIMESTAMP   NOT NULL DEFAULT NOW(),
  started_at               TIMESTAMP,
  completed_at             TIMESTAMP
);

CREATE TABLE batch_job (
  id                     BIGSERIAL    PRIMARY KEY,
  name                   VARCHAR(100) NOT NULL,
  target_type            VARCHAR(20)  NOT NULL DEFAULT 'FOLDER',
  target_folder          VARCHAR(500),
  schedule_type          VARCHAR(20)  NOT NULL DEFAULT 'DAILY',
  schedule_time          CHAR(5)      NOT NULL,
  enabled                BOOLEAN      NOT NULL DEFAULT TRUE,
  scheduler_external_id  VARCHAR(200),
  description            VARCHAR(255),
  created_by             BIGINT       REFERENCES "user"(id),
  updated_by             BIGINT       REFERENCES "user"(id),
  created_at             TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_batch_job_name UNIQUE (name)
);

CREATE TABLE batch_job_run (
  id              BIGSERIAL    PRIMARY KEY,
  batch_job_id    BIGINT       NOT NULL REFERENCES batch_job(id),
  trigger_type    VARCHAR(20)  NOT NULL,
  status          VARCHAR(30)  NOT NULL DEFAULT 'PENDING',
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  pending_count   INT          NOT NULL DEFAULT 0,
  processed_count INT          NOT NULL DEFAULT 0,
  error_count     INT          NOT NULL DEFAULT 0,
  summary         VARCHAR(255),
  error_details   JSONB,
  created_by      BIGINT       REFERENCES "user"(id),
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE batch_job_video (
  id                   BIGSERIAL   PRIMARY KEY,
  batch_job_id         BIGINT      NOT NULL REFERENCES batch_job(id),
  race_video_id        BIGINT      NOT NULL REFERENCES race_video(id),
  status               VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  last_run_id          BIGINT      REFERENCES batch_job_run(id),
  last_analysis_job_id BIGINT      REFERENCES analysis_job(id),
  error_message        VARCHAR(500),
  queued_at            TIMESTAMP,
  processed_at         TIMESTAMP,
  created_at           TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_batch_job_video UNIQUE (batch_job_id, race_video_id)
);
