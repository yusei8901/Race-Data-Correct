"""Seed database with sample horse racing data"""
import os
import uuid
import random
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be set")


def seed():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    venues_data = [
        ("nakayama", "中山", "中央競馬"),
        ("hanshin", "阪神", "中央競馬"),
        ("kyoto", "京都", "中央競馬"),
        ("tokyo", "東京", "中央競馬"),
        ("oi", "大井", "地方競馬"),
        ("kawasaki", "川崎", "地方競馬"),
    ]

    for vid, name, rtype in venues_data:
        vuid = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO venues (id, venue_id, name, race_type) VALUES (%s, %s, %s, %s) ON CONFLICT (venue_id) DO NOTHING",
            (vuid, vid, name, rtype),
        )
        cur.execute(
            "INSERT INTO analysis_params (id, venue_id, venue_name, race_type, params) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (venue_id) DO NOTHING",
            (str(uuid.uuid4()), vid, name, rtype, '{}'),
        )

    # ── 4/4 races (existing) ──
    race_date_1 = "2026-04-04"
    races_0404 = [
        ("中山", "中央競馬", 1, "3歳未勝利", "芝", 1400, "右回り", "晴", "良", "09:35", "データ確定", "完了", "完了", "ユーザー1"),
        ("阪神", "中央競馬", 1, "3歳未勝利", "芝", 1400, "右回り", "晴", "良", "09:35", "データ確定", "完了", "完了", "ユーザー1"),
        ("中山", "中央競馬", 2, "4歳未勝利", "芝", 1600, "右回り", "晴", "良", "10:10", "レビュー待ち", "完了", "完了", "ユーザー2"),
        ("阪神", "中央競馬", 2, "4歳未勝利", "芝", 1600, "右回り", "晴", "良", "10:10", "レビュー待ち", "完了", "完了", "ユーザー2"),
        ("中山", "中央競馬", 3, "5歳未勝利", "ダート", 1800, "右回り", "晴", "良", "10:45", "修正要請", "完了", "完了", "管理者"),
        ("阪神", "中央競馬", 3, "5歳未勝利", "ダート", 1800, "右回り", "晴", "良", "10:45", "修正要請", "完了", "完了", "管理者"),
        ("中山", "中央競馬", 4, "6歳未勝利", "芝", 2000, "右回り", "晴", "良", "11:20", "補正中", "完了", "完了", "管理者"),
        ("阪神", "中央競馬", 4, "6歳未勝利", "芝", 2000, "右回り", "晴", "良", "11:20", "補正中", "完了", "完了", "管理者"),
        ("中山", "中央競馬", 5, "5歳以上2勝クラス", "芝", 2200, "右回り", "曇", "稍重", "11:55", "待機中", "完了", "完了", "ユーザー2"),
        ("阪神", "中央競馬", 5, "5歳以上2勝クラス", "芝", 2200, "右回り", "曇", "稍重", "11:55", "待機中", "完了", "完了", "ユーザー2"),
        ("中山", "中央競馬", 6, "3歳1勝クラス", "芝", 1800, "右回り", "曇", "稍重", "12:30", "未解析", "完了", "未", "ユーザー1"),
        ("阪神", "中央競馬", 6, "3歳1勝クラス", "芝", 1800, "右回り", "曇", "稍重", "12:30", "未解析", "完了", "未", "ユーザー1"),
        ("中山", "中央競馬", 7, "4歳2勝クラス", "ダート", 1200, "右回り", "晴", "良", "13:05", "未処理", "未完了", "未", None),
        ("阪神", "中央競馬", 7, "4歳2勝クラス", "ダート", 1200, "右回り", "晴", "良", "13:05", "未処理", "未完了", "未", None),
        ("中山", "中央競馬", 8, "3歳オープン", "芝", 1600, "右回り", "晴", "良", "13:40", "解析中", "完了", "解析中", None),
        ("阪神", "中央競馬", 8, "3歳オープン", "芝", 1600, "右回り", "晴", "良", "13:40", "解析中", "完了", "解析中", None),
        ("中山", "中央競馬", 9, "4歳以上オープン", "ダート", 1800, "右回り", "曇", "稍重", "14:15", "再解析中", "完了", "再解析中", "ユーザー3"),
        ("阪神", "中央競馬", 9, "4歳以上オープン", "ダート", 1800, "右回り", "曇", "稍重", "14:15", "再解析中", "完了", "再解析中", "ユーザー3"),
        ("中山", "中央競馬", 10, "5歳以上3勝クラス", "芝", 2000, "右回り", "曇", "重", "14:50", "解析失敗", "完了", "解析失敗", "ユーザー2"),
        ("阪神", "中央競馬", 10, "5歳以上3勝クラス", "芝", 2000, "右回り", "曇", "重", "14:50", "解析失敗", "完了", "解析失敗", "ユーザー2"),
        ("中山", "中央競馬", 11, "3歳重賞", "芝", 2400, "右回り", "晴", "良", "15:25", "再解析要請", "完了", "解析失敗", "管理者"),
        ("阪神", "中央競馬", 11, "3歳重賞", "芝", 2400, "右回り", "晴", "良", "15:25", "再解析要請", "完了", "解析失敗", "管理者"),
        ("中山", "中央競馬", 12, "4歳以上重賞", "ダート", 2500, "右回り", "晴", "良", "16:00", "突合失敗", "完了", "突合失敗", "ユーザー1"),
        ("阪神", "中央競馬", 12, "4歳以上重賞", "ダート", 2500, "右回り", "晴", "良", "16:00", "突合失敗", "完了", "突合失敗", "ユーザー1"),
        ("大井", "地方競馬", 1, "3歳未勝利", "ダート", 1200, "左回り", "晴", "良", "15:00", "待機中", "完了", "完了", "ユーザー3"),
        ("川崎", "地方競馬", 1, "3歳未勝利", "ダート", 1400, "左回り", "晴", "良", "15:30", "未処理", "未完了", "未", None),
    ]

    # ── 4/5 races (12 Tokyo + 12 Kyoto) ──
    race_date_2 = "2026-04-05"
    race_names_pool = [
        "3歳未勝利", "3歳1勝クラス", "4歳未勝利", "4歳1勝クラス",
        "5歳以上2勝クラス", "3歳オープン", "4歳以上オープン",
        "5歳以上3勝クラス", "3歳重賞", "4歳以上重賞",
        "天皇賞(春)", "NHKマイルC",
    ]
    distances_turf = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 1600, 2000, 1800, 3200, 1600]
    distances_dirt = [1200, 1400, 1600, 1800, 2000, 1400, 1600, 1800, 1200, 2100, 1400, 1600]

    statuses_tokyo = [
        ("待機中", "完了", "完了", "ユーザー1"),
        ("待機中", "完了", "完了", "ユーザー2"),
        ("補正中", "完了", "完了", "ユーザー1"),
        ("レビュー待ち", "完了", "完了", "ユーザー2"),
        ("データ確定", "完了", "完了", "管理者"),
        ("修正要請", "完了", "完了", "ユーザー1"),
        ("待機中", "完了", "完了", "ユーザー3"),
        ("補正中", "完了", "完了", "管理者"),
        ("再解析要請", "完了", "解析失敗", "ユーザー2"),
        ("突合失敗", "完了", "突合失敗", "ユーザー1"),
        ("解析中", "完了", "解析中", None),
        ("待機中", "完了", "完了", "ユーザー3"),
    ]
    statuses_kyoto = [
        ("待機中", "完了", "完了", "ユーザー2"),
        ("補正中", "完了", "完了", "ユーザー3"),
        ("レビュー待ち", "完了", "完了", "管理者"),
        ("データ確定", "完了", "完了", "ユーザー1"),
        ("修正要請", "完了", "完了", "ユーザー2"),
        ("解析失敗", "完了", "解析失敗", "ユーザー3"),
        ("待機中", "完了", "完了", "ユーザー1"),
        ("突合失敗", "完了", "突合失敗", "管理者"),
        ("再解析要請", "完了", "解析失敗", "ユーザー1"),
        ("補正中", "完了", "完了", "ユーザー2"),
        ("未処理", "未完了", "未", None),
        ("待機中", "完了", "完了", "ユーザー3"),
    ]

    start_times = [
        "09:35", "10:10", "10:45", "11:20", "11:55", "12:30",
        "13:05", "13:40", "14:15", "14:50", "15:25", "16:00",
    ]

    races_0405 = []
    for i in range(12):
        st, vs, as_, user = statuses_tokyo[i]
        surface = "芝" if i % 3 != 2 else "ダート"
        dist = distances_turf[i] if surface == "芝" else distances_dirt[i]
        races_0405.append(("東京", "中央競馬", i + 1, race_names_pool[i], surface, dist, "左回り", "晴", "良", start_times[i], st, vs, as_, user))

    for i in range(12):
        st, vs, as_, user = statuses_kyoto[i]
        surface = "芝" if i % 3 != 1 else "ダート"
        dist = distances_turf[i] if surface == "芝" else distances_dirt[i]
        cond = "稍重" if i >= 8 else "良"
        races_0405.append(("京都", "中央競馬", i + 1, race_names_pool[i], surface, dist, "右回り", "曇", cond, start_times[i], st, vs, as_, user))

    horse_names = [
        "ドウデュース", "イクイノックス", "リバティアイランド", "タスティエーラ",
        "スターズオンアース", "ソールオリエンス", "ジャスティンパレス", "シャフリヤール",
        "エフフォーリア", "ジオグリフ", "デアリングタクト", "バンドラッサ",
        "タイトルホルダー", "ジャックドール",
    ]
    colors = ["黒", "鹿", "青鹿", "芦", "栗", "白"]
    jockeys = ["川田将雅", "武豊", "戸崎圭太", "横山武史", "松山弘平", "福永祐一"]

    # Realistic JRA margin values (in horse lengths)
    MARGINS = [None, 0.1, 0.3, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.5, 5.0, 7.0]

    def upsert_races(race_date, races_list):
        race_ids = []
        race_is_new = []
        for venue, rtype, rnum, rname, surface, dist, direction, weather, cond, stime, status, vstatus, astatus, user in races_list:
            cur.execute(
                "SELECT id FROM races WHERE race_date = %s AND venue = %s AND race_number = %s AND race_type = %s",
                (race_date, venue, rnum, rtype),
            )
            existing = cur.fetchone()
            if existing:
                rid = existing["id"]
                cur.execute(
                    """UPDATE races SET race_name = %s, surface_type = %s, distance = %s,
                       direction = %s, weather = %s, condition = %s, start_time = %s,
                       status = %s, video_status = %s, analysis_status = %s,
                       assigned_user = %s, updated_at = NOW()
                       WHERE id = %s""",
                    (rname, surface, dist, direction, weather, cond, stime, status, vstatus, astatus, user, rid),
                )
                race_ids.append(rid)
                race_is_new.append(False)
            else:
                rid = str(uuid.uuid4())
                race_ids.append(rid)
                race_is_new.append(True)
                cur.execute(
                    """INSERT INTO races (id, race_date, venue, race_type, race_number, race_name,
                       surface_type, distance, direction, weather, condition, start_time,
                       status, video_status, analysis_status, assigned_user)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (rid, race_date, venue, rtype, rnum, rname, surface, dist, direction, weather, cond, stime, status, vstatus, astatus, user),
                )
        return race_ids, race_is_new

    race_ids_04, race_new_04 = upsert_races(race_date_1, races_0404)
    race_ids_05, race_new_05 = upsert_races(race_date_2, races_0405)

    EXEMPT_NOTES = ["映像見切れ", "確認困難", "他馬と重複", "落馬", "失格"]

    def seed_entries_and_orders(race_ids, race_is_new, race_date, inject_bad_data=False):
        for i, (rid, is_new) in enumerate(zip(race_ids, race_is_new)):
            if not is_new:
                continue

            # Track gate numbers per horse_number for this race
            entry_gate_numbers = {}  # horse_number -> gate_number

            for hn in range(1, 15):
                eid = str(uuid.uuid4())
                gn = ((hn - 1) // 2) + 1
                entry_gate_numbers[hn] = gn
                name = horse_names[(hn - 1) % len(horse_names)]
                last3f = round(33.5 + (hn * 0.15), 1)
                ftime = round(88.0 + (hn * 0.3), 1)
                margin_val = MARGINS[hn - 1] if hn <= len(MARGINS) else round((hn - 1) * 0.5, 1)
                color = colors[hn % len(colors)]
                jockey = jockeys[hn % len(jockeys)]
                cur.execute(
                    """INSERT INTO race_entries (id, race_id, horse_number, gate_number, horse_name,
                       jockey_name, last_3f, finish_time, finish_position, margin, color, lane)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (eid, rid, hn, gn, name, jockey, last3f, ftime, hn, margin_val, color, "中"),
                )

            checkpoints = ["200m", "400m", "600m", "800m", "1000m", "1200m"]
            for cp_idx, cp in enumerate(checkpoints):
                # Pre-determine bad horses for this checkpoint
                phantom_horses = set()      # horses that will be missing (no row)
                error_horses = {}           # horse_number -> error_type

                if inject_bad_data:
                    rnd_local = random.Random(hash(f"bad{rid}{cp_idx}") & 0x7FFFFFFF)
                    # ~65% of checkpoints get some issues, 1-4 total bad horses
                    if rnd_local.random() < 0.65:
                        total_bad = rnd_local.randint(1, 4)
                        all_horse_nums = list(range(1, 15))
                        rnd_local.shuffle(all_horse_nums)
                        bad_horse_list = all_horse_nums[:total_bad]

                        # Split: roughly half phantom (missing), half error data
                        n_phantom = rnd_local.randint(0, min(2, len(bad_horse_list)))
                        for j, bhn in enumerate(bad_horse_list):
                            if j < n_phantom:
                                phantom_horses.add(bhn)
                            else:
                                # Error type: 0=gate mismatch, 1=time >1min off, 2=speed<30, 3=speed>80
                                error_horses[bhn] = rnd_local.randint(0, 3)

                for pos in range(1, 15):
                    horse_idx = (pos + i) % 14
                    hn = horse_idx + 1

                    # Skip phantom horses — they'll appear as missing rows in the UI
                    if hn in phantom_horses:
                        continue

                    correct_gn = entry_gate_numbers[hn]
                    gn = correct_gn
                    name = horse_names[horse_idx]
                    color = colors[horse_idx % len(colors)]
                    acc = max(60, 100 - (pos * 2) - (i * 3))
                    time_val = round(12.0 + (pos * 0.2), 2)
                    lane_val = "中"
                    speed_val = None
                    speed_change_val = None
                    special = None

                    if hn in error_horses:
                        err_type = error_horses[hn]
                        if err_type == 0:
                            # Gate number mismatch (帽色 differs from 枠)
                            gn = (correct_gn % 8) + 1   # shift to different gate
                            acc = max(40, acc - 20)
                        elif err_type == 1:
                            # Passing time > 1 minute off from peers
                            time_val = round(time_val + 75.0, 2)
                            acc = max(20, acc - 30)
                        elif err_type == 2:
                            # Speed too slow (< 30 km/h)
                            speed_val = round(random.uniform(10.0, 27.0), 1)
                            acc = max(25, acc - 35)
                        else:
                            # Speed too fast (> 80 km/h)
                            speed_val = round(random.uniform(82.0, 96.0), 1)
                            acc = max(25, acc - 35)

                    po_id = str(uuid.uuid4())
                    cur.execute(
                        """INSERT INTO passing_orders (id, race_id, checkpoint, horse_number, horse_name,
                           gate_number, color, lane, time_seconds, accuracy, position, is_corrected,
                           absolute_speed, speed_change, special_note)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (po_id, rid, cp, hn, name, gn, color, lane_val, time_val, acc, pos, False,
                         speed_val, speed_change_val, special),
                    )

    seed_entries_and_orders(race_ids_04, race_new_04, race_date_1, inject_bad_data=False)
    seed_entries_and_orders(race_ids_05, race_new_05, race_date_2, inject_bad_data=True)

    # Batch jobs
    batch_jobs_data = [
        ("毎日深夜バッチ", "0 2 * * *", "有効", True, "2026-03-16 02:00:00+09"),
        ("週末処理", "0 0 * * 0", "実行中", False, "2026-03-17 00:00:00+09"),
        ("緊急処理バッチ", "*/30 * * * *", "有効", True, "2026-03-15 12:00:00+09"),
        ("アーカイブ処理", "0 6 * * 1", "停止中", False, "2026-03-18 06:00:00+09"),
    ]
    for name, cron, status, enabled, next_run in batch_jobs_data:
        cur.execute("SELECT id FROM batch_jobs WHERE name = %s", (name,))
        if not cur.fetchone():
            cur.execute(
                """INSERT INTO batch_jobs (id, name, cron_expression, status, is_enabled, next_run_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (str(uuid.uuid4()), name, cron, status, enabled, next_run),
            )

    cur.execute("UPDATE races SET locked_by = '管理者', locked_at = NOW() WHERE status = '補正中'")
    cur.execute("UPDATE races SET reanalysis_reason = '逆光', reanalysis_comment = '午後の時間帯で逆光が厳しく正確な解析が困難' WHERE status = '再解析要請'")
    cur.execute("UPDATE races SET correction_request_comment = 'ゴール前の順位が実際と異なる可能性があります。再確認をお願いします。' WHERE status = '修正要請'")

    conn.commit()
    conn.close()
    print("Seeding completed successfully!")


if __name__ == "__main__":
    seed()
