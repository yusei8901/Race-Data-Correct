"""Seed database with sample horse racing data"""
import os
import uuid
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must be set")


def seed():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    race_date = "2026-04-04"
    venues_data = [
        ("nakayama", "中山", "中央競馬"),
        ("hanshin", "阪神", "中央競馬"),
        ("kyoto", "京都", "中央競馬"),
        ("oi", "大井", "地方競馬"),
        ("kawasaki", "川崎", "地方競馬"),
    ]

    # Insert venues
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

    races_seed = [
        # (venue, race_type, race_num, race_name, surface, distance, direction, weather, condition, start_time, status, video_status, analysis_status, assigned_user)
        # --- R1-6: original rows ---
        # status field meanings for new status matrix:
        # video_status: 完了 | 未完了
        # analysis_status: 完了 | 解析中 | 再解析中 | 解析失敗 | 突合失敗 | 未
        # status: 未処理 | 未解析 | 解析中 | 再解析中 | 未補正 | 補正中 | レビュー待ち | データ確定 | 修正要請 | 解析失敗 | 再解析要請 | 突合失敗
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
        # --- R7-12: new rows covering all remaining status combinations ---
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

    race_ids = []
    race_is_new = []
    for venue, rtype, rnum, rname, surface, dist, direction, weather, cond, stime, status, vstatus, astatus, user in races_seed:
        # Idempotent upsert: check by natural key (race_date, venue, race_number, race_type)
        cur.execute(
            "SELECT id FROM races WHERE race_date = %s AND venue = %s AND race_number = %s AND race_type = %s",
            (race_date, venue, rnum, rtype),
        )
        existing = cur.fetchone()
        if existing:
            rid = existing["id"]
            # Update to new status values
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

    horse_names = [
        "ドウデュース", "イクイノックス", "リバティアイランド", "タスティエーラ",
        "スターズオンアース", "ソールオリエンス", "ジャスティンパレス", "シャフリヤール",
        "エフフォーリア", "ジオグリフ", "デアリングタクト", "バンドラッサ",
        "タイトルホルダー", "ジャックドール",
    ]
    colors = ["黒", "鹿", "青鹿", "芦", "栗", "白"]
    jockeys = ["川田将雅", "武豊", "戸崎圭太", "横山武史", "松山弘平", "福永祐一"]

    for i, (race_id, is_new) in enumerate(zip(race_ids[:6], race_is_new[:6])):
        if not is_new:
            # Skip dependent inserts if race already existed (they are already seeded)
            continue
        for hn in range(1, 15):
            eid = str(uuid.uuid4())
            gn = ((hn - 1) // 2) + 1
            name = horse_names[(hn - 1) % len(horse_names)]
            last3f = round(33.5 + (hn * 0.15), 1)
            ftime = round(88.0 + (hn * 0.3), 1)
            color = colors[hn % len(colors)]
            jockey = jockeys[hn % len(jockeys)]
            cur.execute(
                """INSERT INTO race_entries (id, race_id, horse_number, gate_number, horse_name,
                   jockey_name, last_3f, finish_time, finish_position, color, lane)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (eid, race_id, hn, gn, name, jockey, last3f, ftime, hn, color, "中"),
            )

        checkpoints = ["200m", "400m", "600m", "800m", "1000m", "1200m", "1400m", "ゴール"]
        for cp in checkpoints[:6]:
            for pos in range(1, 15):
                po_id = str(uuid.uuid4())
                horse_idx = (pos + i) % 14
                hn = horse_idx + 1
                gn = (horse_idx // 2) + 1
                name = horse_names[horse_idx]
                color = colors[horse_idx % len(colors)]
                acc = max(60, 100 - (pos * 2) - (i * 3))
                cur.execute(
                    """INSERT INTO passing_orders (id, race_id, checkpoint, horse_number, horse_name,
                       gate_number, color, lane, time_seconds, accuracy, position, is_corrected)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (po_id, race_id, cp, hn, name, gn, color, "中", round(12.0 + (pos * 0.2), 2), acc, pos, False),
                )

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

    cur.execute("UPDATE races SET locked_by = '管理者', locked_at = NOW() WHERE status = '補正中' AND race_date = %s", (race_date,))
    cur.execute("UPDATE races SET reanalysis_reason = '逆光', reanalysis_comment = '午後の時間帯で逆光が厳しく正確な解析が困難' WHERE status = '再解析要請' AND race_date = %s", (race_date,))
    cur.execute("UPDATE races SET correction_request_comment = 'ゴール前の順位が実際と異なる可能性があります。再確認をお願いします。' WHERE status = '修正要請' AND race_date = %s", (race_date,))

    conn.commit()
    conn.close()
    print("Seeding completed successfully!")


if __name__ == "__main__":
    seed()
