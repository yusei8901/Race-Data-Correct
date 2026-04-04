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

    # Check if data already exists
    cur.execute("SELECT COUNT(*) as cnt FROM races")
    if cur.fetchone()["cnt"] > 0:
        print("Data already seeded, skipping.")
        conn.close()
        return

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
        ("中山", "中央競馬", 1, "3歳未勝利", "芝", 1400, "右回り", "晴", "良", "09:35", "補正完了", "完了", "完了", "ユーザー1"),
        ("阪神", "中央競馬", 1, "3歳未勝利", "芝", 1400, "右回り", "晴", "良", "09:35", "補正完了", "完了", "完了", "ユーザー1"),
        ("中山", "中央競馬", 2, "4歳未勝利", "芝", 1600, "右回り", "晴", "良", "10:10", "補正完了", "完了", "完了", "ユーザー2"),
        ("阪神", "中央競馬", 2, "4歳未勝利", "芝", 1600, "右回り", "晴", "良", "10:10", "補正完了", "完了", "完了", "ユーザー2"),
        ("中山", "中央競馬", 3, "5歳未勝利", "ダート", 1800, "右回り", "晴", "良", "10:45", "レビュー", "完了", "補正完了", "管理者"),
        ("阪神", "中央競馬", 3, "5歳未勝利", "ダート", 1800, "右回り", "晴", "良", "10:45", "レビュー", "完了", "補正完了", "管理者"),
        ("中山", "中央競馬", 4, "6歳未勝利", "芝", 2000, "右回り", "晴", "良", "11:20", "修正要求", "完了", "完了", "管理者"),
        ("阪神", "中央競馬", 4, "6歳未勝利", "芝", 2000, "右回り", "晴", "良", "11:20", "修正要求", "完了", "完了", "管理者"),
        ("中山", "中央競馬", 5, "5歳以上2勝クラス", "芝", 2200, "右回り", "曇", "稍重", "11:55", "補正中", "完了", "完了", "ユーザー2"),
        ("阪神", "中央競馬", 5, "5歳以上2勝クラス", "芝", 2200, "右回り", "曇", "稍重", "11:55", "補正中", "完了", "完了", "ユーザー2"),
        ("中山", "中央競馬", 6, "3歳1勝クラス", "芝", 1800, "右回り", "曇", "稍重", "12:30", "データ補正", "完了", "完了", "ユーザー1"),
        ("阪神", "中央競馬", 6, "3歳1勝クラス", "芝", 1800, "右回り", "曇", "稍重", "12:30", "データ補正", "完了", "完了", "ユーザー1"),
        ("大井", "地方競馬", 1, "3歳未勝利", "ダート", 1200, "左回り", "晴", "良", "15:00", "データ補正", "完了", "完了", "ユーザー3"),
        ("川崎", "地方競馬", 1, "3歳未勝利", "ダート", 1400, "左回り", "晴", "良", "15:30", "未処理", "未", "未", None),
    ]

    race_ids = []
    for venue, rtype, rnum, rname, surface, dist, direction, weather, cond, stime, status, vstatus, astatus, user in races_seed:
        rid = str(uuid.uuid4())
        race_ids.append(rid)
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

    for i, race_id in enumerate(race_ids[:6]):
        entries = []
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
        cur.execute(
            """INSERT INTO batch_jobs (id, name, cron_expression, status, is_enabled, next_run_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (str(uuid.uuid4()), name, cron, status, enabled, next_run),
        )

    conn.commit()
    conn.close()
    print("Seeding completed successfully!")


if __name__ == "__main__":
    seed()
