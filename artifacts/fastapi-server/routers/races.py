from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor
import json

router = APIRouter(prefix="/fastapi")

STATUS_DISPLAY = {
    "ANALYZING":          ("完了", "解析中",   "解析中"),
    "REANALYZING":        ("完了", "解析失敗", "再解析要請"),
    "ANALYSIS_FAILED":    ("完了", "解析失敗", "解析失敗"),
    "ANALYZED":           ("完了", "完了",     "待機中"),
    "MATCH_FAILED":       ("完了", "突合失敗", "突合失敗"),
    "CORRECTING":         ("完了", "完了",     "補正中"),
    "CORRECTED":          ("完了", "完了",     "レビュー待ち"),
    "REVISION_REQUESTED": ("完了", "完了",     "修正要請"),
    "CONFIRMED":          ("完了", "完了",     "データ確定"),
}


def translate_status(english_status: str, video_raw: str):
    if english_status == "PENDING":
        if video_raw == "COMPLETED":
            return "完了", "未", "未解析"
        return "未", "", "未処理"
    return STATUS_DISPLAY.get(english_status, ("未", "", "未処理"))


RACE_QUERY = """
SELECT
    r.id,
    re.event_date::text          AS race_date,
    re.venue_name                AS venue,
    rc.name                      AS race_type_raw,
    r.race_number,
    r.race_name,
    r.surface_type,
    r.distance,
    r.direction,
    r.weather,
    r.track_condition            AS condition,
    r.start_time::text           AS start_time,
    r.status                     AS english_status,
    r.updated_at::text,
    r.created_at::text,
    rv.vid_status                AS video_raw_status,
    cs.locked_by_name,
    rsh_rev.correction_request_comment,
    rsh_rea.reanalysis_reason,
    rsh_rea.reanalysis_comment
FROM race r
JOIN race_event re ON r.event_id = re.id
JOIN race_category rc ON re.category_id = rc.id
LEFT JOIN LATERAL (
    SELECT status AS vid_status
    FROM race_video
    WHERE race_id = r.id
    ORDER BY created_at DESC LIMIT 1
) rv ON true
LEFT JOIN LATERAL (
    SELECT u.name AS locked_by_name
    FROM correction_session cs2
    JOIN "user" u ON cs2.started_by = u.id
    WHERE cs2.race_id = r.id AND cs2.status = 'IN_PROGRESS'
    ORDER BY cs2.started_at DESC LIMIT 1
) cs ON true
LEFT JOIN LATERAL (
    SELECT metadata->>'correction_request_comment' AS correction_request_comment
    FROM race_status_history
    WHERE race_id = r.id AND status = 'REVISION_REQUESTED'
    ORDER BY changed_at DESC LIMIT 1
) rsh_rev ON true
LEFT JOIN LATERAL (
    SELECT
        metadata->>'reanalysis_reason'  AS reanalysis_reason,
        metadata->>'reanalysis_comment' AS reanalysis_comment
    FROM race_status_history
    WHERE race_id = r.id AND status = 'REANALYZING'
    ORDER BY changed_at DESC LIMIT 1
) rsh_rea ON true
"""


RACE_TYPE_MAP = {
    "中央競馬（JRA）": "中央競馬",
    "地方競馬": "地方競馬",
}


def fmt_race(row: dict) -> dict:
    vid, ana, st = translate_status(
        row.get("english_status") or "PENDING",
        row.get("video_raw_status") or "",
    )
    raw_type = row.get("race_type_raw") or ""
    race_type = RACE_TYPE_MAP.get(raw_type, raw_type)
    return {
        "id": row["id"],
        "race_date": row["race_date"],
        "venue": row["venue"],
        "race_type": race_type,
        "race_number": row["race_number"],
        "race_name": row["race_name"],
        "surface_type": row["surface_type"],
        "distance": row["distance"],
        "direction": row.get("direction"),
        "weather": row.get("weather"),
        "condition": row.get("condition"),
        "start_time": row.get("start_time"),
        "status": st,
        "video_status": vid,
        "video_url": None,
        "analysis_status": ana,
        "assigned_user": row.get("locked_by_name"),
        "locked_by": row.get("locked_by_name"),
        "locked_at": None,
        "correction_request_comment": row.get("correction_request_comment"),
        "reanalysis_reason": row.get("reanalysis_reason"),
        "reanalysis_comment": row.get("reanalysis_comment"),
        "updated_at": row["updated_at"],
        "created_at": row["created_at"],
    }


@router.get("/races/latest-date")
def get_latest_race_date():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT MAX(event_date)::text AS latest_date FROM race_event")
        row = cur.fetchone()
        return {"date": row["latest_date"] if row else None}


@router.get("/races")
def get_races(
    date: Optional[str] = Query(None),
    venue: Optional[str] = Query(None),
    race_type: Optional[str] = Query(None),
    video_status: Optional[str] = Query(None),
    analysis_status: Optional[str] = Query(None),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where, params = [], []
        if date:
            where.append("re.event_date = %s")
            params.append(date)
        if venue:
            where.append("re.venue_name = %s")
            params.append(venue)
        if race_type:
            REVERSE_MAP = {"中央競馬": "中央競馬（JRA）"}
            where.append("rc.name = %s")
            params.append(REVERSE_MAP.get(race_type, race_type))

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        cur.execute(
            f"{RACE_QUERY} {where_sql} ORDER BY re.venue_name, r.race_number",
            params,
        )
        return [fmt_race(r) for r in cur.fetchall()]


@router.get("/races/summary")
def get_race_summary(date: Optional[str] = Query(None)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where_sql = "WHERE re.event_date = %s" if date else ""
        params = [date] if date else []
        cur.execute(
            f"""SELECT COUNT(*) AS total
                FROM race r
                JOIN race_event re ON r.event_id = re.id
                JOIN race_category rc ON re.category_id = rc.id
                {where_sql}""",
            params,
        )
        row = cur.fetchone()
        return {
            "total": row["total"] if row else 0,
            "completed": 0, "in_progress": 0,
            "needs_correction": 0, "review": 0, "by_venue": [],
        }


@router.patch("/races/batch-update")
def batch_update_races(body: dict):
    race_ids = body.get("race_ids", [])
    if not race_ids:
        return {"updated": 0}
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE race SET updated_at = NOW() WHERE id = ANY(%s::uuid[])",
            (race_ids,),
        )
        conn.commit()
        return {"updated": cur.rowcount}


@router.get("/races/{race_id}")
def get_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"{RACE_QUERY} WHERE r.id = %s", (race_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Race not found")
        return fmt_race(row)


@router.get("/races/{race_id}/available-analysis")
def get_available_analysis(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT h.id, h.created_at::text, h.horse_count,
                      j.status AS job_status, j.analysis_mode
               FROM analysis_result_header h
               JOIN analysis_job j ON h.job_id = j.id
               WHERE h.race_id = %s
               ORDER BY h.created_at DESC""",
            (race_id,),
        )
        return cur.fetchall()


@router.post("/races/{race_id}/complete-analysis")
def complete_analysis(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE race SET status = 'ANALYZED', updated_at = NOW() WHERE id = %s RETURNING id",
            (race_id,),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Race not found")
        conn.commit()
    return get_race(race_id)


@router.patch("/races/{race_id}")
def update_race(race_id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("UPDATE race SET updated_at = NOW() WHERE id = %s", (race_id,))
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/reanalyze")
def reanalyze_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE race SET status = 'ANALYZING', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/corrections/start")
def start_correction(race_id: str, body: dict):
    user_name = body.get("user_name", "ユーザー1")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute('SELECT id FROM "user" WHERE name = %s LIMIT 1', (user_name,))
        user_row = cur.fetchone()
        user_id = user_row["id"] if user_row else None

        cur.execute(
            "UPDATE race SET status = 'CORRECTING', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        if user_id:
            cur.execute(
                """INSERT INTO correction_session
                   (id, race_id, started_by, started_at)
                   VALUES (gen_random_uuid(), %s, %s, NOW())""",
                (race_id, user_id),
            )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/corrections/complete")
def complete_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE correction_session SET completed_at = NOW(), status = 'COMPLETED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
            (race_id,),
        )
        cur.execute(
            "UPDATE race SET status = 'CORRECTED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/corrections/temp-save")
def temp_save_correction(race_id: str, body: dict):
    exit_editing = body.get("exit_editing", False)
    with get_db() as conn:
        cur = dict_cursor(conn)
        if exit_editing:
            cur.execute(
                "UPDATE correction_session SET completed_at = NOW(), status = 'COMPLETED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
                (race_id,),
            )
        cur.execute("UPDATE race SET updated_at = NOW() WHERE id = %s", (race_id,))
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/corrections/cancel")
def cancel_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE correction_session SET ended_at = NOW() WHERE race_id = %s AND ended_at IS NULL",
            (race_id,),
        )
        cur.execute("UPDATE race SET updated_at = NOW() WHERE id = %s", (race_id,))
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/force-unlock")
def force_unlock(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE correction_session SET ended_at = NOW() WHERE race_id = %s AND ended_at IS NULL",
            (race_id,),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/reanalysis-request")
def reanalysis_request(race_id: str, body: dict):
    reason = body.get("reason", "")
    comment = body.get("comment")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE race SET status = 'REANALYZING', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        cur.execute(
            """INSERT INTO race_status_history (id, race_id, status, changed_at, metadata)
               VALUES (gen_random_uuid(), %s, 'REANALYZING', NOW(), %s)""",
            (race_id, json.dumps({"reanalysis_reason": reason, "reanalysis_comment": comment})),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/matching-failure")
def matching_failure(race_id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE race SET status = 'MATCH_FAILED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/correction-request")
def correction_request(race_id: str, body: dict):
    comment = body.get("comment", "")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE race SET status = 'REVISION_REQUESTED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        cur.execute(
            """INSERT INTO race_status_history (id, race_id, status, changed_at, metadata)
               VALUES (gen_random_uuid(), %s, 'REVISION_REQUESTED', NOW(), %s)""",
            (race_id, json.dumps({"correction_request_comment": comment})),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/confirm")
def confirm_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE race SET status = 'CONFIRMED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/bind-analysis")
def bind_analysis(race_id: str, body: dict):
    return get_race(race_id)
