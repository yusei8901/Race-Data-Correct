"""Seed database with sample horse racing data (19-table schema)"""
import os
import uuid
import random
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be set")


# ── Status maps ──────────────────────────────────────────────────────────────
STATUS_WITH_ANALYSIS = {"ANALYZED", "CORRECTING", "CORRECTED", "REVISION_REQUESTED",
                        "CONFIRMED", "MATCH_FAILED", "REANALYZING"}
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
          csv_export_job, audit_log, race_status_history, race_linkage_result,
          correction_result, correction_session,
          analysis_result_detail, analysis_result_header, analysis_job,
          race_video, race, race_event, race_category,
          official_horse_furlong_time, official_horse_reference,
          jra_race_reference, venue_weather_preset,
          correction_memo_master, "user"
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
    for vc in list(VENUE_CODE_MAP.values()):
        for wp in weather_presets:
            for st in ["TURF", "DIRT"]:
                cur.execute(
                    """INSERT INTO venue_weather_preset
                       (id, venue_code, weather_preset_code, name, surface_type, preset_parameters, is_active)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (str(uuid.uuid4()), vc, wp, f"{vc}・{preset_names[wp]}", st, '{}', True),
                )

    # ── race / horse constants ─────────────────────────────────────────────────
    horse_names = [
        "ドウデュース", "イクイノックス", "リバティアイランド", "タスティエーラ",
        "スターズオンアース", "ソールオリエンス", "ジャスティンパレス", "シャフリヤール",
        "エフフォーリア", "ジオグリフ", "デアリングタクト", "バンドラッサ",
        "タイトルホルダー", "ジャックドール",
    ]
    colors = ["黒", "鹿", "青鹿", "芦", "栗", "白"]
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
        # index 10,11: PENDING + video COMPLETED (未解析)
        ("中山","中央競馬",6,"3歳1勝クラス","芝",1800,"右回り","曇","稍重","12:30","PENDING"),
        ("阪神","中央競馬",6,"3歳1勝クラス","芝",1800,"右回り","曇","稍重","12:30","PENDING"),
        # index 12,13: PENDING + video INCOMPLETE (未処理)
        ("中山","中央競馬",7,"4歳2勝クラス","ダート",1200,"右回り","晴","良","13:05","PENDING"),
        ("阪神","中央競馬",7,"4歳2勝クラス","ダート",1200,"右回り","晴","良","13:05","PENDING"),
        ("中山","中央競馬",8,"3歳オープン","芝",1600,"右回り","晴","良","13:40","ANALYZING"),
        ("阪神","中央競馬",8,"3歳オープン","芝",1600,"右回り","晴","良","13:40","ANALYZING"),
        ("中山","中央競馬",9,"4歳以上オープン","ダート",1800,"右回り","曇","稍重","14:15","REANALYZING"),
        ("阪神","中央競馬",9,"4歳以上オープン","ダート",1800,"右回り","曇","稍重","14:15","REANALYZING"),
        ("中山","中央競馬",10,"5歳以上3勝クラス","芝",2000,"右回り","曇","重","14:50","ANALYSIS_FAILED"),
        ("阪神","中央競馬",10,"5歳以上3勝クラス","芝",2000,"右回り","曇","重","14:50","ANALYSIS_FAILED"),
        ("中山","中央競馬",11,"3歳重賞","芝",2400,"右回り","晴","良","15:25","REANALYZING"),
        ("阪神","中央競馬",11,"3歳重賞","芝",2400,"右回り","晴","良","15:25","REANALYZING"),
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
        "REVISION_REQUESTED","ANALYZED","CORRECTING","REANALYZING",
        "MATCH_FAILED","ANALYZING","ANALYZED",
    ]
    statuses_kyoto = [
        "ANALYZED","CORRECTING","CORRECTED","CONFIRMED","REVISION_REQUESTED",
        "ANALYSIS_FAILED","ANALYZED","MATCH_FAILED","REANALYZING",
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
            """INSERT INTO race_event (id, category_id, event_date, venue_code, venue_name, round)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (eid, cat_ids[cat_code], race_date, venue_code, venue_name, 1),
        )
        event_cache[key] = eid
        return eid

    # ── Helper: analysis chain ────────────────────────────────────────────────
    def insert_analysis_chain(race_id, video_id, race_idx, inject_bad_data):
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
        checkpoints = ["200m", "400m", "600m", "800m", "1000m", "1200m"]
        for cp_idx, cp in enumerate(checkpoints):
            phantom_horses = set()
            error_horses = {}
            if inject_bad_data:
                rnd_local = random.Random(hash(f"bad{race_id}{cp_idx}") & 0x7FFFFFFF)
                if rnd_local.random() < 0.65:
                    total_bad = rnd_local.randint(1, 4)
                    all_horse_nums = list(range(1, 15))
                    rnd_local.shuffle(all_horse_nums)
                    bad_horse_list = all_horse_nums[:total_bad]
                    n_phantom = rnd_local.randint(0, min(2, len(bad_horse_list)))
                    for j, bhn in enumerate(bad_horse_list):
                        if j < n_phantom:
                            phantom_horses.add(bhn)
                        else:
                            error_horses[bhn] = rnd_local.randint(0, 3)
            for pos in range(1, 15):
                horse_idx = (pos + race_idx) % 14
                hn = horse_idx + 1
                if hn in phantom_horses:
                    continue
                correct_gn = entry_gate_numbers[hn]
                gn = correct_gn
                name = horse_names[horse_idx]
                color_val = colors[horse_idx % len(colors)]
                acc = max(60, 100 - (pos * 2) - (race_idx * 3))
                time_val = round(12.0 + (pos * 0.2), 2)
                speed_val = None
                speed_change_val = None
                if hn in error_horses:
                    err_type = error_horses[hn]
                    if err_type == 0:
                        gn = (correct_gn % 8) + 1
                        acc = max(40, acc - 20)
                    elif err_type == 1:
                        time_val = 9999.0
                        acc = max(20, acc - 30)
                    elif err_type == 2:
                        speed_change_val = round(random.uniform(35.0, 55.0), 1)
                        acc = max(25, acc - 35)
                    else:
                        speed_val = round(random.uniform(82.0, 96.0), 1)
                        acc = max(25, acc - 35)
                cur.execute(
                    """INSERT INTO analysis_result_detail
                       (id, header_id, time_sec, marker_type, class_name, course_position,
                        rank, race_time, data_type, horse_number, horse_name, gate_number,
                        color, lane, accuracy, position, running_position, is_corrected,
                        absolute_speed, speed_change, special_note)
                       VALUES (%s,%s,%s,%s,%s,'中',%s,%s,'200m',%s,%s,%s,%s,'中',%s,%s,%s,FALSE,%s,%s,NULL)""",
                    (str(uuid.uuid4()), header_id, time_val, cp, f"cap_{color_val}_{hn}",
                     pos, time_val, hn, name, gn, color_val, acc, pos, pos, speed_val, speed_change_val),
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

            # race_video: INCOMPLETE, FILE_RACE_LINK_FAILED, or COMPLETED
            if race_idx in incomplete_video_idxs:
                video_status = "INCOMPLETE"
            elif race_idx in file_race_link_failed_idxs:
                video_status = "FILE_RACE_LINK_FAILED"
            else:
                video_status = "COMPLETED"
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
                _, header_id = insert_analysis_chain(race_id, video_id, race_idx, inject_bad_data)
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

            # race_status_history: PENDING initial + current
            insert_status_history(race_id, "PENDING", sys_user)
            if status != "PENDING":
                metadata = None
                if status == "REANALYZING":
                    metadata = {
                        "reanalysis_reason": "逆光",
                        "reanalysis_comment": "午後の時間帯で逆光が厳しく正確な解析が困難",
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
                  incomplete_video_idxs=incomplete_video_idxs_05)

    conn.commit()
    conn.close()
    print("Seeding completed successfully!")


if __name__ == "__main__":
    seed()
