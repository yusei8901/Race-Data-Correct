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
          correction_memo_master, users
        CASCADE
    """)

    # ── 1. users ──────────────────────────────────────────────────────────────
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
            """INSERT INTO users (id, external_subject_id, auth_provider, email, name)
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
    all_venue_codes = list(VENUE_CODE_MAP.values())
    for vc in all_venue_codes:
        for wp in weather_presets:
            for st in ["TURF", "DIRT"]:
                cur.execute(
                    """INSERT INTO venue_weather_preset
                       (id, venue_code, weather_preset_code, name, surface_type, preset_parameters, is_active)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (str(uuid.uuid4()), vc, wp, f"{vc}・{preset_names[wp]}", st, '{}', True),
                )

    # ── race data definitions ─────────────────────────────────────────────────
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
        ("中山","中央競馬",6,"3歳1勝クラス","芝",1800,"右回り","曇","稍重","12:30","PENDING"),
        ("阪神","中央競馬",6,"3歳1勝クラス","芝",1800,"右回り","曇","稍重","12:30","PENDING"),
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
        ("川崎","地方競馬",1,"3歳未勝利","ダート",1400,"左回り","晴","良","15:30","PENDING"),
    ]
    # R6,7 中山/阪神: PENDING + video COMPLETED (未解析)
    # R7 (index 12,13): PENDING + video INCOMPLETE (未処理)
    pending_completed_idxs = {10, 11}   # R6 中山/阪神 → PENDING with video COMPLETED
    pending_incomplete_idxs = {12, 13, 25}  # R7 中山/阪神, 川崎R1 → PENDING with no video

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

    # Kyoto R11 (index 22 in races_0405 = offset 10 in kyoto loop) is PENDING + INCOMPLETE
    kyoto_pending_incomplete_idxs = {22}  # kyoto R11 = index 22 in races_0405

    # ── Helper: get user_id by old name ───────────────────────────────────────
    def get_user(name):
        if name in ("ユーザー1",):
            return user_ids["ユーザー1"]
        if name in ("ユーザー2", "ユーザー3"):
            return user_ids["ユーザー2"]
        return user_ids["管理者"]

    # ── Helper: insert race_event (or fetch existing) ─────────────────────────
    event_cache = {}  # (date, venue_code, race_type) → event_id

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

    # ── Helper: insert analysis chain ─────────────────────────────────────────
    def insert_analysis_chain(race_id, video_id, race_idx, race_date, inject_bad_data):
        # analysis_job (SUCCESS)
        job_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_job
               (id, video_id, status, analysis_mode, started_at, completed_at)
               VALUES (%s, %s, %s, %s, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 55 minutes')""",
            (job_id, video_id, "SUCCESS", "200m"),
        )
        # analysis_result_header
        header_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_result_header (id, job_id, race_id, is_current, horse_count)
               VALUES (%s, %s, %s, %s, %s)""",
            (header_id, job_id, race_id, True, 14),
        )
        # analysis_result_detail (per checkpoint)
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
                        time_val = round(time_val + 75.0, 2)
                        acc = max(20, acc - 30)
                    elif err_type == 2:
                        speed_val = round(random.uniform(10.0, 27.0), 1)
                        acc = max(25, acc - 35)
                    else:
                        speed_val = round(random.uniform(82.0, 96.0), 1)
                        acc = max(25, acc - 35)
                detail_id = str(uuid.uuid4())
                class_name_val = f"cap_{color_val}_{hn}"
                cur.execute(
                    """INSERT INTO analysis_result_detail
                       (id, header_id, time_sec, marker_type, class_name, course_position,
                        rank, race_time, data_type, horse_number, horse_name, gate_number,
                        color, lane, accuracy, position, is_corrected, absolute_speed,
                        speed_change, special_note)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (detail_id, header_id, time_val, cp, class_name_val, "中",
                     pos, time_val, "200m", hn, name, gn,
                     color_val, "中", acc, pos, False, speed_val,
                     speed_change_val, None),
                )
        return job_id, header_id

    def insert_analyzing_job(video_id):
        job_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_job
               (id, video_id, status, analysis_mode, started_at)
               VALUES (%s, %s, %s, %s, NOW() - INTERVAL '10 minutes')""",
            (job_id, video_id, "RUNNING", "200m"),
        )
        return job_id

    def insert_failed_job(video_id):
        job_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_job
               (id, video_id, status, analysis_mode, started_at, completed_at, error_message)
               VALUES (%s, %s, %s, %s, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours 55 minutes', %s)""",
            (job_id, video_id, "FAILED", "200m", "解析処理中にエラーが発生しました"),
        )
        return job_id

    # ── Helper: insert official horse data ────────────────────────────────────
    def insert_official_horse_data(race_id, race_date, venue_code, race_num):
        official_race_id = f"JRA_{race_date.replace('-', '')}_{venue_code}_{race_num}"
        horse_ref_ids = []
        for hn in range(1, 15):
            horse_idx = (hn - 1) % len(horse_names)
            name = horse_names[horse_idx]
            gn = ((hn - 1) // 2) + 1
            jockey = jockeys[hn % len(jockeys)]
            finish_time = round(88.0 + (hn * 0.3), 2)
            margin_val = MARGINS[hn - 1] if hn <= len(MARGINS) else round((hn - 1) * 0.5, 1)
            ohr_id = str(uuid.uuid4())
            horse_ref_ids.append(ohr_id)
            cur.execute(
                """INSERT INTO official_horse_reference
                   (id, official_race_id, official_horse_id, frame_number, horse_number,
                    horse_name, finishing_order, corner_pass_order, jockey_name, finishing_time, raw_data)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (ohr_id, official_race_id, f"H{hn:03d}", gn, hn,
                 name, hn, f"{hn} {hn}", jockey, finish_time, '{}'),
            )
            # furlong times: 6 checkpoints
            for fn, ft in enumerate([12.4, 11.2, 11.8, 12.1, 12.3, 12.5], start=9):
                cur.execute(
                    """INSERT INTO official_horse_furlong_time
                       (id, official_horse_reference_id, furlong_no, time_sec)
                       VALUES (%s,%s,%s,%s)""",
                    (str(uuid.uuid4()), ohr_id, fn, round(ft + hn * 0.05, 2)),
                )
        return official_race_id, horse_ref_ids

    def insert_jra_reference(race_date, venue_code, race_num, weather, dist, surface, direction):
        official_race_id = f"JRA_{race_date.replace('-', '')}_{venue_code}_{race_num}"
        cur.execute(
            """INSERT INTO jra_race_reference
               (id, official_race_id, event_date, venue_code, race_number, weather,
                course_distance, surface_type, course_direction, raw_data, fetched_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())""",
            (str(uuid.uuid4()), official_race_id, race_date, venue_code, race_num,
             weather, dist, surface, direction, '{}'),
        )

    def insert_linkage_result(race_id, official_race_id, status):
        cur.execute(
            """INSERT INTO race_linkage_result
               (id, race_id, official_race_id, linkage_status, diff_summary)
               VALUES (%s,%s,%s,%s,%s)""",
            (str(uuid.uuid4()), race_id, official_race_id, status, '{}'),
        )

    def insert_status_history(race_id, status, user_id, metadata=None):
        cur.execute(
            """INSERT INTO race_status_history (id, race_id, status, changed_by, changed_at, metadata)
               VALUES (%s,%s,%s,%s,NOW(),%s)""",
            (str(uuid.uuid4()), race_id, status, user_id,
             psycopg2.extras.Json(metadata) if metadata else None),
        )

    def insert_correction_session(race_id, header_id, user_id):
        sess_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO correction_session
               (id, race_id, analysis_result_id, started_by, status)
               VALUES (%s,%s,%s,%s,%s)""",
            (sess_id, race_id, header_id, user_id, "IN_PROGRESS"),
        )
        return sess_id

    # ── Process a race list ───────────────────────────────────────────────────
    def process_races(race_date, races_list, inject_bad_data=False, pending_completed_set=None, pending_incomplete_set=None):
        if pending_completed_set is None:
            pending_completed_set = set()
        if pending_incomplete_set is None:
            pending_incomplete_set = set()

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

            # Determine video status
            if race_idx in pending_incomplete_set:
                video_status = "INCOMPLETE"
            else:
                video_status = "COMPLETED"

            # race_video
            video_id = str(uuid.uuid4())
            storage_path = f"gs://furlong-bucket/{race_date.replace('-', '')}/{venue_code}_{rnum:02d}.mp4"
            cur.execute(
                """INSERT INTO race_video (id, race_id, storage_path, status)
                   VALUES (%s,%s,%s,%s)""",
                (video_id, race_id, storage_path, video_status),
            )

            # Analysis chain
            header_id = None
            if status in STATUS_WITH_ANALYSIS:
                _, header_id = insert_analysis_chain(race_id, video_id, race_idx, race_date, inject_bad_data)
                # Update race.current_analysis_result_id
                cur.execute(
                    "UPDATE race SET current_analysis_result_id = %s WHERE id = %s",
                    (header_id, race_id),
                )
            elif status in STATUS_ANALYZING_JOB:
                insert_analyzing_job(video_id)
            elif status in STATUS_FAILED_JOB:
                insert_failed_job(video_id)

            # official_horse_reference + furlong times
            official_race_id, _ = insert_official_horse_data(race_id, race_date, venue_code, rnum)

            # jra_race_reference
            insert_jra_reference(race_date, venue_code, rnum, weather, dist, surface, direction)

            # race_linkage_result
            if status in STATUS_WITH_ANALYSIS:
                link_status = "FAILED" if status == "MATCH_FAILED" else "SUCCESS"
                insert_linkage_result(race_id, official_race_id, link_status)

            # race_status_history: initial PENDING + current
            sys_user = user_ids["管理者"]
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
                    "UPDATE race SET current_correction_session_id = %s, corrected_by = %s, corrected_at = NOW() WHERE id = %s",
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
                  pending_completed_set=pending_completed_idxs,
                  pending_incomplete_set=pending_incomplete_idxs)
    process_races(race_date_2, races_0405, inject_bad_data=True,
                  pending_incomplete_set=kyoto_pending_incomplete_idxs)

    conn.commit()
    conn.close()
    print("Seeding completed successfully!")


if __name__ == "__main__":
    seed()
