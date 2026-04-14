"""Seed database with sample horse racing data (19-table schema)"""
import os
import uuid
import random
import math
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be set")


# ── Status maps ──────────────────────────────────────────────────────────────
STATUS_WITH_ANALYSIS = {"ANALYZED", "CORRECTING", "CORRECTED", "REVISION_REQUESTED",
                        "CONFIRMED", "MATCH_FAILED", "ANALYSIS_REQUESTED"}
STATUS_ANALYZING_JOB = {"ANALYZING"}    # Running job, no result yet
STATUS_FAILED_JOB = {"ANALYSIS_FAILED"} # Failed job, no result
# PENDING: no job at all

VENUE_CODE_MAP = {
    "中山": "nakayama", "阪神": "hanshin", "東京": "tokyo",
    "京都": "kyoto", "大井": "oi", "川崎": "kawasaki",
}
RACE_TYPE_MAP = {
    "中央競馬": "JRA", "地方競馬": "LOCAL",
}


def seed():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ── Truncate new tables in reverse dependency order ───────────────────────
    cur.execute("""
        TRUNCATE
          analysis_passing_point, analysis_straight_section,
          csv_export_job, audit_log, race_status_history, race_linkage_result,
          correction_result, correction_session,
          analysis_result_detail, analysis_result_header, analysis_job,
          race_video, race, race_event, race_category,
          official_horse_furlong_time, official_horse_reference,
          jra_race_reference, venue_weather_preset,
          correction_memo_master, "user",
          bbox_param_preset
        CASCADE
    """)

    # ── 1. "user" ─────────────────────────────────────────────────────────────
    user_ids = {}
    users_data = [
        ("iap_user1", "iap_google", "user1@example.com", "ユーザー1"),
        ("iap_user2", "iap_google", "user2@example.com", "ユーザー2"),
        ("iap_admin", "iap_google", "admin@example.com", "管理者"),
    ]
    for ext_id, provider, email, name in users_data:
        uid = str(uuid.uuid4())
        user_ids[name] = uid
        cur.execute(
            """INSERT INTO "user" (id, external_subject_id, auth_provider, email, name)
               VALUES (%s, %s, %s, %s, %s)""",
            (uid, ext_id, provider, email, name),
        )

    # ── 2. race_category ──────────────────────────────────────────────────────
    cat_ids = {}
    categories = [("JRA", "中央競馬（JRA）"), ("LOCAL", "地方競馬")]
    for code, name in categories:
        cid = str(uuid.uuid4())
        cat_ids[code] = cid
        cur.execute(
            "INSERT INTO race_category (id, code, name) VALUES (%s, %s, %s)",
            (cid, code, name),
        )

    # ── 3. correction_memo_master ─────────────────────────────────────────────
    memos = [
        ("出遅れ", 1), ("映像見切れ", 2), ("確認困難", 3),
        ("他馬と重複", 4), ("落馬", 5), ("失格", 6),
        ("接触", 7), ("外ラチ激突", 8), ("気性難（暴走）", 9), ("不透明馬体", 10),
    ]
    for memo_text, disp_order in memos:
        cur.execute(
            "INSERT INTO correction_memo_master (id, memo_text, display_order, is_active) VALUES (%s, %s, %s, %s)",
            (str(uuid.uuid4()), memo_text, disp_order, True),
        )

    # ── 4. venue_weather_preset ───────────────────────────────────────────────
    weather_presets = ["CLEAR", "BACKLIGHT", "CLOUDY", "RAIN"]
    preset_names = {
        "CLEAR": "晴天（標準）", "BACKLIGHT": "逆光", "CLOUDY": "曇天", "RAIN": "雨天",
    }
    VENUE_NAME_JP = {
        "nakayama": "中山", "hanshin": "阪神", "tokyo": "東京",
        "kyoto": "京都", "oi": "大井", "kawasaki": "川崎",
    }
    SURFACE_JP = {"TURF": "芝", "DIRT": "ダート"}
    for vc in list(VENUE_CODE_MAP.values()):
        for wp in weather_presets:
            for st in ["TURF", "DIRT"]:
                preset_label = f"{VENUE_NAME_JP[vc]}・{SURFACE_JP[st]}・{preset_names[wp]}"
                cur.execute(
                    """INSERT INTO venue_weather_preset
                       (id, venue_code, weather_preset_code, name, surface_type, preset_parameters, is_active)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (str(uuid.uuid4()), vc, wp, preset_label, st, '{}', True),
                )

    # ── race / horse constants ─────────────────────────────────────────────────
    horse_names = [
        "ドウデュース", "イクイノックス", "リバティアイランド", "タスティエーラ",
        "スターズオンアース", "ソールオリエンス", "ジャスティンパレス", "シャフリヤール",
        "エフフォーリア", "ジオグリフ", "デアリングタクト", "バンドラッサ",
        "タイトルホルダー", "ジャックドール",
    ]
    colors = ["黒", "鹿", "青鹿", "芦", "栗", "白"]
    CAP_COLOR_EXPECTED = {1: '白', 2: '黒', 3: '赤', 4: '青', 5: '黄', 6: '緑', 7: '橙', 8: '桃'}
    ALL_CAP_COLORS = ['白', '黒', '赤', '青', '黄', '緑', '橙', '桃']
    LANE_OPTIONS = ['内', '中', '外']
    jockeys = ["川田将雅", "武豊", "戸崎圭太", "横山武史", "松山弘平", "福永祐一"]
    MARGINS = [None, 0.1, 0.3, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.5, 5.0, 7.0]

    # ── 4/4 race definitions ──────────────────────────────────────────────────
    race_date_1 = "2026-04-04"
    # (venue, race_type, race_num, race_name, surface, dist, direction, weather, cond, start_time, new_status)
    races_0404 = [
        ("中山","中央競馬",1,"3歳未勝利","芝",1400,"右回り","晴","良","09:35","CONFIRMED"),
        ("阪神","中央競馬",1,"3歳未勝利","芝",1400,"右回り","晴","良","09:35","CONFIRMED"),
        ("中山","中央競馬",2,"4歳未勝利","芝",1600,"右回り","晴","良","10:10","CORRECTED"),
        ("阪神","中央競馬",2,"4歳未勝利","芝",1600,"右回り","晴","良","10:10","CORRECTED"),
        ("中山","中央競馬",3,"5歳未勝利","ダート",1800,"右回り","晴","良","10:45","REVISION_REQUESTED"),
        ("阪神","中央競馬",3,"5歳未勝利","ダート",1800,"右回り","晴","良","10:45","REVISION_REQUESTED"),
        ("中山","中央競馬",4,"6歳未勝利","芝",2000,"右回り","晴","良","11:20","CORRECTING"),
        ("阪神","中央競馬",4,"6歳未勝利","芝",2000,"右回り","晴","良","11:20","CORRECTING"),
        ("中山","中央競馬",5,"5歳以上2勝クラス","芝",2200,"右回り","曇","稍重","11:55","ANALYZED"),
        ("阪神","中央競馬",5,"5歳以上2勝クラス","芝",2200,"右回り","曇","稍重","11:55","ANALYZED"),
        # index 10,11: PENDING + video COMPLETED (未処理)
        ("中山","中央競馬",6,"3歳1勝クラス","芝",1800,"右回り","曇","稍重","12:30","PENDING"),
        ("阪神","中央競馬",6,"3歳1勝クラス","芝",1800,"右回り","曇","稍重","12:30","PENDING"),
        # index 12,13: PENDING + video INCOMPLETE (未処理)
        ("中山","中央競馬",7,"4歳2勝クラス","ダート",1200,"右回り","晴","良","13:05","PENDING"),
        ("阪神","中央競馬",7,"4歳2勝クラス","ダート",1200,"右回り","晴","良","13:05","PENDING"),
        ("中山","中央競馬",8,"3歳オープン","芝",1600,"右回り","晴","良","13:40","ANALYZING"),
        ("阪神","中央競馬",8,"3歳オープン","芝",1600,"右回り","晴","良","13:40","ANALYZING"),
        ("中山","中央競馬",9,"4歳以上オープン","ダート",1800,"右回り","曇","稍重","14:15","ANALYSIS_REQUESTED"),
        ("阪神","中央競馬",9,"4歳以上オープン","ダート",1800,"右回り","曇","稍重","14:15","ANALYSIS_REQUESTED"),
        ("中山","中央競馬",10,"5歳以上3勝クラス","芝",2000,"右回り","曇","重","14:50","ANALYSIS_FAILED"),
        ("阪神","中央競馬",10,"5歳以上3勝クラス","芝",2000,"右回り","曇","重","14:50","ANALYSIS_FAILED"),
        ("中山","中央競馬",11,"3歳重賞","芝",2400,"右回り","晴","良","15:25","ANALYSIS_REQUESTED"),
        ("阪神","中央競馬",11,"3歳重賞","芝",2400,"右回り","晴","良","15:25","ANALYSIS_REQUESTED"),
        ("中山","中央競馬",12,"4歳以上重賞","ダート",2500,"右回り","晴","良","16:00","MATCH_FAILED"),
        ("阪神","中央競馬",12,"4歳以上重賞","ダート",2500,"右回り","晴","良","16:00","MATCH_FAILED"),
        ("大井","地方競馬",1,"3歳未勝利","ダート",1200,"左回り","晴","良","15:00","ANALYZED"),
        # index 25: PENDING + video INCOMPLETE (未処理)
        ("川崎","地方競馬",1,"3歳未勝利","ダート",1400,"左回り","晴","良","15:30","PENDING"),
    ]
    # Indices where video should be INCOMPLETE (未処理)
    incomplete_video_idxs_04 = {12, 13, 25}
    # Index 10 (中山R6, PENDING): video FILE_RACE_LINK_FAILED (動画ファイル名とレースの紐付け失敗)
    file_race_link_failed_idxs_04 = {10}

    # ── 4/5 race definitions ──────────────────────────────────────────────────
    race_date_2 = "2026-04-05"
    race_names_pool = [
        "3歳未勝利","3歳1勝クラス","4歳未勝利","4歳1勝クラス",
        "5歳以上2勝クラス","3歳オープン","4歳以上オープン",
        "5歳以上3勝クラス","3歳重賞","4歳以上重賞","天皇賞(春)","NHKマイルC",
    ]
    distances_turf = [1200,1400,1600,1800,2000,2200,2400,1600,2000,1800,3200,1600]
    distances_dirt = [1200,1400,1600,1800,2000,1400,1600,1800,1200,2100,1400,1600]

    statuses_tokyo = [
        "ANALYZED","ANALYZED","CORRECTING","CORRECTED","CONFIRMED",
        "REVISION_REQUESTED","ANALYZED","CORRECTING","ANALYSIS_REQUESTED",
        "MATCH_FAILED","ANALYZING","ANALYZED",
    ]
    statuses_kyoto = [
        "ANALYZED","CORRECTING","CORRECTED","CONFIRMED","REVISION_REQUESTED",
        "ANALYSIS_FAILED","ANALYZED","MATCH_FAILED","ANALYSIS_REQUESTED",
        "CORRECTING","PENDING","ANALYZED",
    ]
    start_times = [
        "09:35","10:10","10:45","11:20","11:55","12:30",
        "13:05","13:40","14:15","14:50","15:25","16:00",
    ]

    races_0405 = []
    for i in range(12):
        surface = "芝" if i % 3 != 2 else "ダート"
        dist = distances_turf[i] if surface == "芝" else distances_dirt[i]
        races_0405.append(("東京","中央競馬",i+1,race_names_pool[i],surface,dist,"左回り","晴","良",start_times[i],statuses_tokyo[i]))
    for i in range(12):
        surface = "芝" if i % 3 != 1 else "ダート"
        dist = distances_turf[i] if surface == "芝" else distances_dirt[i]
        cond = "稍重" if i >= 8 else "良"
        races_0405.append(("京都","中央競馬",i+1,race_names_pool[i],surface,dist,"右回り","曇",cond,start_times[i],statuses_kyoto[i]))
    # Index 22 in races_0405 = Kyoto R11 = PENDING + INCOMPLETE video (未処理)
    incomplete_video_idxs_05 = {22}
    # Additional NEEDS_SETUP races for 2026-04-05 (indices 24-27)
    races_0405.extend([
        ("東京", "中央競馬", 13, "解析設定待ち②", "ダート", 1400, "左回り", "晴", "良", "16:30", "PENDING"),
        ("東京", "中央競馬", 14, "解析設定待ち③", "芝",    2000, "左回り", "晴", "良", "16:50", "PENDING"),
        ("京都", "中央競馬", 13, "解析設定待ち④", "芝",    1800, "右回り", "曇", "良", "16:30", "PENDING"),
        ("京都", "中央競馬", 14, "解析設定待ち⑤", "ダート", 1200, "右回り", "曇", "稍重", "16:50", "PENDING"),
    ])
    file_race_link_failed_idxs_05 = {24, 25, 26, 27}

    # ── Helper: race_event cache ──────────────────────────────────────────────
    event_cache = {}  # (date, venue_code, cat_code) → event_id

    def get_or_create_event(race_date, venue_name, race_type_jp):
        venue_code = VENUE_CODE_MAP[venue_name]
        cat_code = RACE_TYPE_MAP[race_type_jp]
        key = (race_date, venue_code, cat_code)
        if key in event_cache:
            return event_cache[key]
        eid = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO race_event (id, category_id, event_date, venue_code, venue_name, round, kaisai_day)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (eid, cat_ids[cat_code], race_date, venue_code, venue_name, 1, 1),
        )
        event_cache[key] = eid
        return eid

    # ── Straight length per venue/surface ─────────────────────────────────────
    STRAIGHT_MAP_SEED = {
        ("中山", "芝"): 310, ("中山", "ダート"): 310,
        ("阪神", "芝"): 356, ("阪神", "ダート"): 352,
        ("東京", "芝"): 502, ("東京", "ダート"): 502,
        ("京都", "芝"): 404, ("京都", "ダート"): 329,
        ("大井", "ダート"): 386, ("川崎", "ダート"): 300,
    }

    # ── Helper: analysis chain ────────────────────────────────────────────────
    def insert_analysis_chain(race_id, video_id, race_idx, inject_bad_data,
                              venue="東京", surface="芝", dist=1600):
        job_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_job
               (id, video_id, status, analysis_mode, started_at, completed_at)
               VALUES (%s, %s, 'SUCCESS', '200m',
                       NOW() - INTERVAL '2 hours',
                       NOW() - INTERVAL '1 hour 55 minutes')""",
            (job_id, video_id),
        )
        header_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_result_header (id, job_id, race_id, is_current, horse_count)
               VALUES (%s, %s, %s, TRUE, 14)""",
            (header_id, job_id, race_id),
        )
        entry_gate_numbers = {hn: ((hn - 1) // 2) + 1 for hn in range(1, 15)}

        if inject_bad_data:
            # Compute proper checkpoints from race distance + venue straight
            straight = STRAIGHT_MAP_SEED.get((venue, surface), 300)
            straight_start = dist - straight
            pts_200m = ["5m"] + [f"{m}m" for m in range(200, int(straight_start), 200)]
            first_str = int(math.ceil(straight_start / 50) * 50)
            pts_str = [f"{m}m" for m in range(first_str, int(dist), 50)] + ["ゴール"]
            all_checkpoints = [(cp, True) for cp in pts_200m] + [(cp, False) for cp in pts_str]
        else:
            # Simple 6-checkpoint set for 4/4 data (kept for backwards compat)
            all_checkpoints = [(cp, True) for cp in ["200m", "400m", "600m", "800m", "1000m", "1200m"]]

        MISS_PROB = 0.03    # 3% missing rate per field
        ANOMALY_PROB = 0.015  # 1.5% anomaly rate per field

        for cp_idx, (cp, is_200m_type) in enumerate(all_checkpoints):
            position = 0
            for hn in range(1, 15):
                position += 1
                horse_idx = (hn + race_idx) % 14
                correct_gn = entry_gate_numbers[hn]
                name = horse_names[horse_idx]
                base_time = round(12.0 + position * 0.2, 2)

                if inject_bad_data:
                    rnd_row = random.Random(hash(f"row{race_id}{cp_idx}{hn}") & 0x7FFFFFFF)

                    # Start with good values
                    horse_number_val = hn
                    color_val = CAP_COLOR_EXPECTED.get(correct_gn)
                    time_val = base_time
                    gn = correct_gn
                    acc = max(70, 100 - position * 2)
                    lane_val = rnd_row.choice(LANE_OPTIONS) if is_200m_type else None
                    running_pos_val = position
                    speed_val = round(rnd_row.uniform(55, 72), 1) if not is_200m_type else None
                    speed_change_val = round(rnd_row.uniform(-3, 3), 1) if not is_200m_type else None

                    # Apply missing probability (0-5% per field)
                    if rnd_row.random() < MISS_PROB:
                        horse_number_val = None
                    if rnd_row.random() < MISS_PROB:
                        color_val = None
                    if rnd_row.random() < MISS_PROB:
                        time_val = None
                    if is_200m_type and rnd_row.random() < MISS_PROB:
                        lane_val = None
                    if not is_200m_type:
                        if rnd_row.random() < MISS_PROB:
                            speed_val = None
                        if rnd_row.random() < MISS_PROB:
                            speed_change_val = None
                        if rnd_row.random() < MISS_PROB:
                            running_pos_val = None

                    # Apply anomaly probability
                    if color_val is not None and rnd_row.random() < ANOMALY_PROB:
                        wrong_colors = [c for c in ALL_CAP_COLORS if c != CAP_COLOR_EXPECTED.get(correct_gn)]
                        color_val = rnd_row.choice(wrong_colors)
                    if time_val is not None and rnd_row.random() < ANOMALY_PROB:
                        # >60s diff from base → anomalous
                        time_val = round(base_time + rnd_row.uniform(62, 90), 2)
                    if not is_200m_type and speed_val is not None and rnd_row.random() < ANOMALY_PROB:
                        # speed <=30 or >=80
                        speed_val = round(
                            rnd_row.choice([rnd_row.uniform(82, 95), rnd_row.uniform(1, 28)]), 1
                        )
                    if not is_200m_type and running_pos_val is not None and rnd_row.random() < ANOMALY_PROB:
                        running_pos_val = rnd_row.randint(17, 25)  # >=16 → anomaly
                else:
                    # 4/4 data: coat colors, fully populated
                    horse_number_val = hn
                    color_val = colors[horse_idx % len(colors)]
                    time_val = base_time
                    lane_val = '中'
                    running_pos_val = position
                    speed_val = None
                    speed_change_val = None
                    acc = max(60, 100 - position * 2 - race_idx * 3)
                    gn = correct_gn

                cur.execute(
                    """INSERT INTO analysis_result_detail
                       (id, header_id, time_sec, marker_type, class_name, course_position,
                        rank, race_time, data_type, horse_number, horse_name, gate_number,
                        color, lane, accuracy, position, running_position, is_corrected,
                        absolute_speed, speed_change, special_note)
                       VALUES (%s,%s,%s,%s,%s,'中',%s,%s,'200m',%s,%s,%s,%s,%s,%s,%s,%s,FALSE,%s,%s,NULL)""",
                    (str(uuid.uuid4()), header_id, time_val, cp, f"det_{hn}",
                     position, base_time, horse_number_val, name, gn, color_val, lane_val, acc,
                     position, running_pos_val, speed_val, speed_change_val),
                )
        return job_id, header_id

    def insert_analyzing_job(video_id):
        job_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_job (id, video_id, status, analysis_mode, started_at)
               VALUES (%s, %s, 'RUNNING', '200m', NOW() - INTERVAL '10 minutes')""",
            (job_id, video_id),
        )
        return job_id

    def insert_failed_job(video_id):
        job_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_job
               (id, video_id, status, analysis_mode, started_at, completed_at, error_message)
               VALUES (%s, %s, 'FAILED', '200m',
                       NOW() - INTERVAL '3 hours',
                       NOW() - INTERVAL '2 hours 55 minutes',
                       '解析処理中にエラーが発生しました')""",
            (job_id, video_id),
        )
        return job_id

    # ── Helper: official horse data ───────────────────────────────────────────
    def insert_official_horse_data(race_date, venue_code, race_num):
        official_race_id = f"JRA_{race_date.replace('-', '')}_{venue_code}_{race_num}"
        for hn in range(1, 15):
            horse_idx = (hn - 1) % len(horse_names)
            name = horse_names[horse_idx]
            gn = ((hn - 1) // 2) + 1
            jockey = jockeys[hn % len(jockeys)]
            finish_time = round(88.0 + (hn * 0.3), 2)
            ohr_id = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO official_horse_reference
                   (id, official_race_id, official_horse_id, frame_number, horse_number,
                    horse_name, finishing_order, corner_pass_order, jockey_name, finishing_time, raw_data)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}')""",
                (ohr_id, official_race_id, f"H{hn:03d}", gn, hn,
                 name, hn, f"{hn} {hn}", jockey, finish_time),
            )
            for fn, ft in enumerate([12.4, 11.2, 11.8, 12.1, 12.3, 12.5], start=9):
                cur.execute(
                    """INSERT INTO official_horse_furlong_time
                       (id, official_horse_reference_id, furlong_no, time_sec)
                       VALUES (%s,%s,%s,%s)""",
                    (str(uuid.uuid4()), ohr_id, fn, round(ft + hn * 0.05, 2)),
                )
        return official_race_id

    # ── Helper: jra_race_reference ────────────────────────────────────────────
    def insert_jra_reference(race_date, venue_code, race_num, weather, dist, surface, direction):
        official_race_id = f"JRA_{race_date.replace('-', '')}_{venue_code}_{race_num}"
        cur.execute(
            """INSERT INTO jra_race_reference
               (id, official_race_id, event_date, venue_code, race_number, weather,
                course_distance, surface_type, course_direction, raw_data, fetched_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}',NOW())""",
            (str(uuid.uuid4()), official_race_id, race_date, venue_code, race_num,
             weather, dist, surface, direction),
        )
        return official_race_id

    # ── Helper: race_linkage_result (every race gets one) ────────────────────
    def insert_linkage_result(race_id, official_race_id, status):
        cur.execute(
            """INSERT INTO race_linkage_result
               (id, race_id, official_race_id, linkage_status, diff_summary)
               VALUES (%s,%s,%s,%s,'{}')""",
            (str(uuid.uuid4()), race_id, official_race_id, status),
        )

    # ── Helper: status history ────────────────────────────────────────────────
    def insert_status_history(race_id, status, user_id, metadata=None):
        cur.execute(
            """INSERT INTO race_status_history (id, race_id, status, changed_by, changed_at, metadata)
               VALUES (%s,%s,%s,%s,NOW(),%s)""",
            (str(uuid.uuid4()), race_id, status, user_id,
             psycopg2.extras.Json(metadata) if metadata else None),
        )

    # ── Helper: correction_session ────────────────────────────────────────────
    def insert_correction_session(race_id, header_id, user_id):
        sess_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO correction_session
               (id, race_id, analysis_result_id, started_by, status)
               VALUES (%s,%s,%s,%s,'IN_PROGRESS')""",
            (sess_id, race_id, header_id, user_id),
        )
        return sess_id

    # ── Process a list of races ───────────────────────────────────────────────
    def process_races(race_date, races_list, inject_bad_data=False,
                      incomplete_video_idxs=None, file_race_link_failed_idxs=None):
        if incomplete_video_idxs is None:
            incomplete_video_idxs = set()
        if file_race_link_failed_idxs is None:
            file_race_link_failed_idxs = set()
        sys_user = user_ids["管理者"]

        for race_idx, row in enumerate(races_list):
            venue, rtype, rnum, rname, surface, dist, direction, weather, cond, stime, status = row
            venue_code = VENUE_CODE_MAP[venue]
            event_id = get_or_create_event(race_date, venue, rtype)

            race_id = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO race
                   (id, event_id, race_number, race_name, start_time, surface_type,
                    distance, direction, weather, track_condition, status)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (race_id, event_id, rnum, rname, stime, surface,
                 dist, direction, weather, cond, status),
            )

            # race_video: INCOMPLETE, NEEDS_SETUP, or FINISHED
            if race_idx in incomplete_video_idxs:
                video_status = "INCOMPLETE"
            elif race_idx in file_race_link_failed_idxs:
                video_status = "NEEDS_SETUP"
            else:
                video_status = "FINISHED"
            video_id = str(uuid.uuid4())
            storage_path = f"gs://furlong-bucket/{race_date.replace('-', '')}/{venue_code}_{rnum:02d}.mp4"
            cur.execute(
                """INSERT INTO race_video (id, race_id, storage_path, status)
                   VALUES (%s,%s,%s,%s)""",
                (video_id, race_id, storage_path, video_status),
            )

            # Analysis chain based on status
            header_id = None
            if status in STATUS_WITH_ANALYSIS:
                _, header_id = insert_analysis_chain(race_id, video_id, race_idx, inject_bad_data,
                                                     venue, surface, dist)
                cur.execute(
                    "UPDATE race SET current_analysis_result_id = %s WHERE id = %s",
                    (header_id, race_id),
                )
            elif status in STATUS_ANALYZING_JOB:
                insert_analyzing_job(video_id)
            elif status in STATUS_FAILED_JOB:
                insert_failed_job(video_id)

            # Official horse reference + furlong times (all races get this as JRA BigQuery stub)
            official_race_id = insert_official_horse_data(race_date, venue_code, rnum)

            # JRA race reference (all races)
            insert_jra_reference(race_date, venue_code, rnum, weather, dist, surface, direction)

            # race_linkage_result: every race gets a dummy row
            if status == "MATCH_FAILED":
                linkage_status = "FAILED"
            elif status in STATUS_WITH_ANALYSIS and status != "MATCH_FAILED":
                linkage_status = "SUCCESS"
            else:
                # PENDING / ANALYZING / ANALYSIS_FAILED → not yet matched
                linkage_status = "FAILED"
            insert_linkage_result(race_id, official_race_id, linkage_status)

            # race_status_history: PENDING initial + intermediate + current
            insert_status_history(race_id, "PENDING", sys_user)
            if status != "PENDING":
                # Add ANALYZED before statuses that follow it in the workflow
                if status in {"CORRECTING", "CORRECTED", "REVISION_REQUESTED", "CONFIRMED", "MATCH_FAILED"}:
                    insert_status_history(race_id, "ANALYZED", sys_user)
                # Add CORRECTED before REVISION_REQUESTED / CONFIRMED for richer history
                if status in {"REVISION_REQUESTED"}:
                    insert_status_history(race_id, "CORRECTED", sys_user)
                metadata = None
                if status == "ANALYSIS_REQUESTED":
                    metadata = {
                        "reanalysis_reason": "逆光",
                        "reanalysis_comment": "午後の時間帯で逆光が厳しく正確な解析が困難",
                    }
                elif status == "ANALYSIS_FAILED":
                    metadata = {
                        "failure_reason": "ゴールタイム読み取り不可",
                    }
                elif status == "REVISION_REQUESTED":
                    metadata = {
                        "correction_request_comment": "ゴール前の順位が実際と異なる可能性があります。再確認をお願いします。",
                    }
                insert_status_history(race_id, status, sys_user, metadata)

            # correction_session for CORRECTING races
            if status == "CORRECTING" and header_id:
                sess_id = insert_correction_session(race_id, header_id, sys_user)
                cur.execute(
                    """UPDATE race
                       SET current_correction_session_id = %s,
                           corrected_by = %s,
                           corrected_at = NOW()
                       WHERE id = %s""",
                    (sess_id, sys_user, race_id),
                )

            # confirmed fields for CONFIRMED races
            if status == "CONFIRMED":
                cur.execute(
                    "UPDATE race SET confirmed_at = NOW(), confirmed_by = %s WHERE id = %s",
                    (sys_user, race_id),
                )

    # ── Run seeds ─────────────────────────────────────────────────────────────
    process_races(race_date_1, races_0404, inject_bad_data=False,
                  incomplete_video_idxs=incomplete_video_idxs_04,
                  file_race_link_failed_idxs=file_race_link_failed_idxs_04)
    process_races(race_date_2, races_0405, inject_bad_data=True,
                  incomplete_video_idxs=incomplete_video_idxs_05,
                  file_race_link_failed_idxs=file_race_link_failed_idxs_05)

    # ── Test patterns A-E (2026-04-06) — UI verification data ────────────────
    race_date_test = "2026-04-06"
    admin_user = user_ids["管理者"]

    def get_preset_id_by(venue_code, surface_type, weather_code="CLEAR"):
        cur.execute(
            """SELECT id FROM venue_weather_preset
               WHERE venue_code=%s AND surface_type=%s AND weather_preset_code=%s LIMIT 1""",
            (venue_code, surface_type, weather_code),
        )
        row = cur.fetchone()
        return row["id"] if row else None

    # (venue, rtype, rnum, rname, surface, dist, dir, weather, cond, stime,
    #  race_status, video_status, goal_time_sec, preset_weather, preset_surface)
    test_patterns = [
        ("中山", "中央競馬", 1, "[A] 動画未アップロード",
         "芝",    1600, "右回り", "晴", "良", "10:00",
         "PENDING",         "INCOMPLETE",  None,  None,   None),
        ("阪神", "中央競馬", 1, "[B] 解析設定待ち（入力不足）",
         "芝",    1600, "右回り", "晴", "良", "10:30",
         "PENDING",         "NEEDS_SETUP", None,  None,   None),
        ("東京", "中央競馬", 1, "[C] 準備完了（設定済み）",
         "芝",    1600, "左回り", "晴", "良", "11:00",
         "PENDING",         "STANDBY",     83.40, "CLEAR", "TURF"),
        ("京都", "中央競馬", 1, "[D] 解析失敗（エラーあり）",
         "芝",    1600, "右回り", "曇", "良", "11:30",
         "ANALYSIS_FAILED", "STANDBY",     None,  None,   None),
        ("大井", "地方競馬", 1, "[E] 解析完了（待機中）",
         "ダート", 1600, "左回り", "晴", "良", "12:00",
         "ANALYZED",        "FINISHED",    None,  None,   None),
        # Additional NEEDS_SETUP patterns (F-I)
        ("中山", "中央競馬", 2, "[F] 解析設定待ち②",
         "ダート", 1200, "右回り", "晴", "良", "10:50",
         "PENDING",         "NEEDS_SETUP", None,  None,   None),
        ("東京", "中央競馬", 2, "[G] 解析設定待ち③",
         "芝",    1400, "左回り", "晴", "良", "11:20",
         "PENDING",         "NEEDS_SETUP", None,  None,   None),
        ("京都", "中央競馬", 2, "[H] 解析設定待ち④",
         "ダート", 1800, "右回り", "曇", "稍重", "11:50",
         "PENDING",         "NEEDS_SETUP", None,  None,   None),
        ("阪神", "中央競馬", 2, "[I] 解析設定待ち⑤",
         "芝",    2000, "右回り", "晴", "良", "12:20",
         "PENDING",         "NEEDS_SETUP", None,  None,   None),
    ]

    for (venue, rtype, rnum, rname, surface, dist, direction,
         weather, cond, stime, race_status, video_status,
         goal_time_sec, preset_weather, preset_surface) in test_patterns:
        vc = VENUE_CODE_MAP[venue]
        eid = get_or_create_event(race_date_test, venue, rtype)
        race_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO race
               (id, event_id, race_number, race_name, start_time, surface_type,
                distance, direction, weather, track_condition, status)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (race_id, eid, rnum, rname, stime, surface,
             dist, direction, weather, cond, race_status),
        )
        video_id = str(uuid.uuid4())
        sp = f"gs://furlong-bucket/{race_date_test.replace('-','')}/{vc}_{rnum:02d}.mp4"
        cur.execute(
            "INSERT INTO race_video (id, race_id, storage_path, status) VALUES (%s,%s,%s,%s)",
            (video_id, race_id, sp, video_status),
        )
        # status history
        insert_status_history(race_id, "PENDING", admin_user)
        if race_status == "ANALYSIS_FAILED":
            insert_failed_job(video_id)
            insert_status_history(race_id, "ANALYSIS_FAILED", admin_user,
                                  {"failure_reason": "ゴールタイム読み取り不可"})
        elif race_status == "ANALYZED":
            _, hdr = insert_analysis_chain(race_id, video_id, 0, True, venue, surface, dist)
            cur.execute("UPDATE race SET current_analysis_result_id=%s WHERE id=%s", (hdr, race_id))
            insert_status_history(race_id, "ANALYZED", admin_user)
        # analysis_option for pattern C (STANDBY + goal_time set)
        if video_status == "STANDBY" and goal_time_sec is not None:
            pid = get_preset_id_by(vc, preset_surface or "TURF", preset_weather or "CLEAR")
            if pid:
                cur.execute(
                    """INSERT INTO analysis_option
                       (id, race_id, video_id, venue_weather_preset_id,
                        video_goal_time, comment, created_at, updated_at)
                       VALUES (%s,%s,%s,%s,%s,NULL,NOW(),NOW())""",
                    (str(uuid.uuid4()), race_id, video_id, pid, goal_time_sec),
                )
        # official + jra reference
        off_id = insert_official_horse_data(race_date_test, vc, rnum)
        insert_jra_reference(race_date_test, vc, rnum, weather, dist, surface, direction)
        insert_linkage_result(race_id, off_id, "FAILED")

    # ── analysis_venue_config (per-venue analysis parameters) ─────────────────
    import json as _json
    _default_params = {
        "brightness_threshold": 128,
        "contrast_boost": 1.2,
        "noise_reduction": 0.5,
        "tracking_sensitivity": 0.8,
    }
    for _vid, _vname, _rtype in [
        ("nakayama", "中山", "中央競馬"),
        ("hanshin",  "阪神", "中央競馬"),
        ("kyoto",    "京都", "中央競馬"),
        ("tokyo",    "東京", "中央競馬"),
        ("oi",       "大井", "地方競馬"),
        ("kawasaki", "川崎", "地方競馬"),
    ]:
        cur.execute(
            """INSERT INTO analysis_venue_config (venue_id, venue_name, race_type, params)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (venue_id) DO NOTHING""",
            (_vid, _vname, _rtype, _json.dumps(_default_params)),
        )

    # ── csv_export_job (sample export jobs per race_event) ────────────────────
    admin_id = user_ids["管理者"]
    cur.execute("SELECT id FROM race_event LIMIT 3")
    export_event_rows = cur.fetchall()
    _dataset_cycle = ["all", "passing_points", "straight_sections"]
    for _i, _erow in enumerate(export_event_rows):
        _ds = _dataset_cycle[_i % len(_dataset_cycle)]
        cur.execute(
            """INSERT INTO csv_export_job
               (id, event_id, dataset, status, storage_path, requested_by, race_count,
                created_at, started_at, completed_at)
               VALUES (%s, %s, %s, 'SUCCESS',
                       %s, %s, 12, NOW() - INTERVAL '2 hours',
                       NOW() - INTERVAL '2 hours',
                       NOW() - INTERVAL '1 hour 59 minutes')""",
            (str(uuid.uuid4()), _erow["id"], _ds,
             f"gs://furlong-bucket/export/event_{_i+1}_{_ds}.zip",
             admin_id),
        )

    # ── analysis_passing_point & analysis_straight_section (sample data) ──────
    # Seed 2 races that have analysis results with passing points and straight sections
    cur.execute("""
        SELECT arh.race_id, arh.id AS header_id
        FROM analysis_result_header arh
        WHERE arh.is_current = TRUE
        LIMIT 2
    """)
    _sample_headers = cur.fetchall()

    _marker_distances = [1200, 1000, 800, 600, 400, 200, 0]
    _marker_type_map = {
        1200: "ハロン14", 1000: "ハロン12", 800: "ハロン10",
        600: "ハロン8",  400: "ハロン6",  200: "ハロン4",  0: "ゴール",
    }
    _lane_options_seed = ["内", "中", "外"]
    _ai_colors = ["cap_orange_1", "cap_blue_2", "cap_red_3", "cap_green_4",
                  "cap_yellow_5", "cap_white_6", "cap_black_7", "cap_pink_8"]

    for _sh in _sample_headers:
        _race_id = _sh["race_id"]
        _header_id = _sh["header_id"]

        for _hn in range(1, 9):  # 8 horses as sample
            _fname = ((_hn - 1) // 2) + 1
            _hname = horse_names[(_hn - 1) % len(horse_names)]
            _ai_cls = _ai_colors[(_hn - 1) % len(_ai_colors)]
            _base_pt = round(12.0 + _hn * 0.15, 2)

            # passing points (200m checkpoints)
            for _md in _marker_distances:
                _rank = _hn if _md > 0 else max(1, _hn - 1)
                _vtime = round(45.0 + (_hn * 0.3) + (1200 - _md) * 0.08, 2)
                _ptime = round(_base_pt + (_hn * 0.05), 2)
                _offtime = round(_ptime + 0.05, 2)
                cur.execute(
                    """INSERT INTO analysis_passing_point
                       (race_id, header_id, horse_number, frame_number, horse_name,
                        marker_distance, marker_type, rank, video_time_sec,
                        passing_time, official_time_sec, lane_position,
                        ai_class_name, special_note, is_manually_corrected)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NULL,FALSE)
                       ON CONFLICT (race_id, horse_number, marker_distance) DO NOTHING""",
                    (_race_id, _header_id, _hn, _fname, _hname,
                     _md, _marker_type_map.get(_md), _rank,
                     _vtime, _ptime, _offtime,
                     _lane_options_seed[_hn % len(_lane_options_seed)], _ai_cls),
                )

            # straight sections (50m segments from 400m to 0m)
            for _sec_no, (_ssd, _sed) in enumerate([(400, 350), (350, 300), (300, 250),
                                                     (250, 200), (200, 150), (150, 100),
                                                     (100, 50),  (50, 0)], start=1):
                _avg_spd = round(58.0 + _hn * 0.5 + _sec_no * 0.3, 2)
                _diff = round(random.uniform(-2.0, 2.0), 2)
                _lat = round(random.uniform(-0.05, 0.05), 4)
                _evtime = round(60.0 + _sec_no * 1.2 + _hn * 0.1, 2)
                _eptime = round(55.0 + _sec_no * 1.1 + _hn * 0.1, 2)
                _eofftime = round(_eptime + 0.1, 2)
                cur.execute(
                    """INSERT INTO analysis_straight_section
                       (race_id, header_id, horse_number, frame_number, horse_name,
                        section_start_dist, section_end_dist, section_no,
                        est_video_time_sec, est_passing_time, est_official_time_sec,
                        section_avg_speed, speed_diff, lateral_position,
                        ai_class_name, is_manually_corrected)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,FALSE)
                       ON CONFLICT (race_id, horse_number, section_start_dist, section_end_dist) DO NOTHING""",
                    (_race_id, _header_id, _hn, _fname, _hname,
                     _ssd, _sed, _sec_no,
                     _evtime, _eptime, _eofftime,
                     _avg_spd, _diff, _lat, _ai_cls),
                )

    # ── BBOX param presets ────────────────────────────────────────────────────
    bbox_presets = [
        {
            "name": "小倉Bコース_カーブ_芝",
            "venue_code": "kokura",
            "section_type": "curve",
            "course_variant": "B",
            "surface_type": "芝",
            "parameters": {
                "furlong_distance": 200,
                "direction_multiplier": -1,
                "rail_spacing_m": 3.0,
                "distance_scale_factor": 0.98,
                "position_mode": "curve",
                "lane_width_px": 45,
                "track_hand": "right",
                "lane_inner_threshold_m": 4,
                "lane_outer_threshold_m": 8,
            },
        },
        {
            "name": "小倉Bコース_直線_芝",
            "venue_code": "kokura",
            "section_type": "straight",
            "course_variant": "B",
            "surface_type": "芝",
            "parameters": {
                "furlong_distance": 200,
                "direction_multiplier": 1,
                "rail_spacing_m": 3.0,
                "distance_scale_factor": 1.0,
                "position_mode": "straight",
                "lane_width_px": 60,
                "track_hand": "left",
                "lane_inner_threshold_m": 5,
                "lane_outer_threshold_m": 10,
            },
        },
        {
            "name": "中山_カーブ_芝",
            "venue_code": "nakayama",
            "section_type": "curve",
            "course_variant": "A",
            "surface_type": "芝",
            "parameters": {
                "furlong_distance": 200,
                "direction_multiplier": -1,
                "rail_spacing_m": 2.8,
                "distance_scale_factor": 0.97,
                "position_mode": "curve",
                "lane_width_px": 42,
                "track_hand": "right",
                "lane_inner_threshold_m": 4,
                "lane_outer_threshold_m": 8,
            },
        },
    ]
    for bp in bbox_presets:
        cur.execute(
            """INSERT INTO bbox_param_preset
               (id, name, venue_code, section_type, course_variant, surface_type, parameters)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (str(uuid.uuid4()), bp["name"], bp.get("venue_code"), bp.get("section_type"),
             bp.get("course_variant"), bp.get("surface_type"),
             psycopg2.extras.Json(bp["parameters"])),
        )

    # ── BBOX annotations (sample data for CORRECTING races) ───────────────────
    cur.execute("""
        SELECT id, distance, surface_type FROM race
        WHERE status IN ('CORRECTING', 'CORRECTED')
        LIMIT 2
    """)
    _bbox_races = cur.fetchall()

    # Sample bboxes for a 200m-interval checkpoint (curve scene)
    _sample_bboxes_curve = [
        {"id": str(uuid.uuid4()), "x": 0.52, "y": 0.30, "w": 0.046, "h": 0.072,
         "cap_class": "class_red_1", "cap_color_key": 3},
        {"id": str(uuid.uuid4()), "x": 0.58, "y": 0.32, "w": 0.042, "h": 0.068,
         "cap_class": "class_blue_1", "cap_color_key": 4},
        {"id": str(uuid.uuid4()), "x": 0.65, "y": 0.28, "w": 0.044, "h": 0.070,
         "cap_class": "class_yellow_1", "cap_color_key": 5},
        {"id": str(uuid.uuid4()), "x": 0.71, "y": 0.34, "w": 0.040, "h": 0.066,
         "cap_class": "class_green_1", "cap_color_key": 6},
        {"id": str(uuid.uuid4()), "x": 0.44, "y": 0.38, "w": 0.043, "h": 0.069,
         "cap_class": "class_white_1", "cap_color_key": 1},
        {"id": str(uuid.uuid4()), "x": 0.77, "y": 0.26, "w": 0.041, "h": 0.065,
         "cap_class": "class_orange_1", "cap_color_key": 7},
        {"id": str(uuid.uuid4()), "x": 0.60, "y": 0.44, "w": 0.044, "h": 0.070,
         "cap_class": "class_pink_1", "cap_color_key": 8},
        {"id": str(uuid.uuid4()), "x": 0.48, "y": 0.24, "w": 0.043, "h": 0.068,
         "cap_class": "class_red_2", "cap_color_key": 3},
    ]
    # Reference line (horizontal across the curve)
    _ref_line_curve = {"x1": 0.30, "y1": 0.42, "x2": 0.85, "y2": 0.18}
    # Fence markers along the rail
    _fence_markers_curve = [
        {"x": 0.32, "y": 0.68}, {"x": 0.40, "y": 0.60},
        {"x": 0.50, "y": 0.54}, {"x": 0.60, "y": 0.50},
        {"x": 0.70, "y": 0.47},
    ]
    _params_curve = {
        "furlong_distance": 200, "direction_multiplier": -1,
        "rail_spacing_m": 3.0, "distance_scale_factor": 0.98,
        "position_mode": "curve", "lane_width_px": 45,
        "track_hand": "right", "lane_inner_threshold_m": 4,
        "lane_outer_threshold_m": 8, "leader_official_time": "1:10.50",
        "furlong_interval_time": "12.30",
    }

    # Sample bboxes for straight section
    _sample_bboxes_straight = [
        {"id": str(uuid.uuid4()), "x": 0.10, "y": 0.38, "w": 0.048, "h": 0.074,
         "cap_class": "class_red_1", "cap_color_key": 3},
        {"id": str(uuid.uuid4()), "x": 0.22, "y": 0.35, "w": 0.044, "h": 0.070,
         "cap_class": "class_yellow_1", "cap_color_key": 5},
        {"id": str(uuid.uuid4()), "x": 0.34, "y": 0.36, "w": 0.043, "h": 0.068,
         "cap_class": "class_blue_1", "cap_color_key": 4},
        {"id": str(uuid.uuid4()), "x": 0.46, "y": 0.34, "w": 0.042, "h": 0.067,
         "cap_class": "class_white_1", "cap_color_key": 1},
        {"id": str(uuid.uuid4()), "x": 0.57, "y": 0.37, "w": 0.042, "h": 0.067,
         "cap_class": "class_green_1", "cap_color_key": 6},
        {"id": str(uuid.uuid4()), "x": 0.67, "y": 0.36, "w": 0.041, "h": 0.066,
         "cap_class": "class_pink_1", "cap_color_key": 8},
    ]
    _ref_line_straight = {"x1": 0.05, "y1": 0.52, "x2": 0.95, "y2": 0.48}
    _fence_markers_straight = [
        {"x": 0.08, "y": 0.72}, {"x": 0.24, "y": 0.70},
        {"x": 0.40, "y": 0.69}, {"x": 0.56, "y": 0.68},
    ]
    _params_straight = {
        "furlong_distance": 200, "direction_multiplier": 1,
        "rail_spacing_m": 3.0, "distance_scale_factor": 1.0,
        "position_mode": "straight", "lane_width_px": 60,
        "track_hand": "left", "lane_inner_threshold_m": 5,
        "lane_outer_threshold_m": 10, "leader_official_time": "",
        "furlong_interval_time": "11.80",
    }

    for _br in _bbox_races:
        _br_id = _br["id"]
        _br_dist = _br["distance"]
        # Determine a curve checkpoint (first 200m-interval point after start)
        _curve_cp = "400m" if _br_dist >= 600 else "200m"
        # Determine a straight checkpoint (last ~50m before goal)
        _str_cp = f"{_br_dist - 50}m"

        # Curve checkpoint annotation
        cur.execute(
            """INSERT INTO bbox_annotation
               (id, race_id, checkpoint, bboxes, reference_line, fence_markers, parameters)
               VALUES (%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (race_id, checkpoint) DO UPDATE
               SET bboxes=EXCLUDED.bboxes, reference_line=EXCLUDED.reference_line,
                   fence_markers=EXCLUDED.fence_markers, parameters=EXCLUDED.parameters,
                   updated_at=NOW()""",
            (str(uuid.uuid4()), _br_id, _curve_cp,
             psycopg2.extras.Json(_sample_bboxes_curve),
             psycopg2.extras.Json(_ref_line_curve),
             psycopg2.extras.Json(_fence_markers_curve),
             psycopg2.extras.Json(_params_curve)),
        )

        # Straight checkpoint annotation
        cur.execute(
            """INSERT INTO bbox_annotation
               (id, race_id, checkpoint, bboxes, reference_line, fence_markers, parameters)
               VALUES (%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (race_id, checkpoint) DO UPDATE
               SET bboxes=EXCLUDED.bboxes, reference_line=EXCLUDED.reference_line,
                   fence_markers=EXCLUDED.fence_markers, parameters=EXCLUDED.parameters,
                   updated_at=NOW()""",
            (str(uuid.uuid4()), _br_id, _str_cp,
             psycopg2.extras.Json(_sample_bboxes_straight),
             psycopg2.extras.Json(_ref_line_straight),
             psycopg2.extras.Json(_fence_markers_straight),
             psycopg2.extras.Json(_params_straight)),
        )

    conn.commit()
    conn.close()
    print("Seeding completed successfully!")


if __name__ == "__main__":
    seed()
