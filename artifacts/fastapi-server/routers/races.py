from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor
import json
import datetime

router = APIRouter(prefix="/fastapi")

# ── Status display mapping ──────────────────────────────────────────────────

# English DB code → (video_col_status, analysis_col_status, display_status)
STATUS_DISPLAY = {
    "PENDING":            ("未", "",       "未処理"),
    "ANALYZING":          ("完了", "解析中",   "解析中"),
    "ANALYSIS_FAILED":    ("完了", "解析失敗", "解析失敗"),
    "ANALYZED":           ("完了", "完了",     "待機中"),
    "MATCH_FAILED":       ("完了", "突合失敗", "突合失敗"),
    "CORRECTING":         ("完了", "完了",     "補正中"),
    "CORRECTED":          ("完了", "完了",     "レビュー待ち"),
    "REVISION_REQUESTED": ("完了", "完了",     "修正要請"),
    "CONFIRMED":          ("完了", "完了",     "データ確定"),
    "ANALYSIS_REQUESTED": ("完了", "再解析要請", "再解析要請"),
}


def compute_display_status(english_status: str, video_raw: str, prev_status: Optional[str]) -> tuple:
    """Return (video_status, analysis_status, display_status)."""
    vid, ana, ds = STATUS_DISPLAY.get(english_status, ("未", "", "未処理"))
    return vid, ana, ds


# ── Shared race query ───────────────────────────────────────────────────────

RACE_QUERY = """
SELECT
    r.id,
    re.event_date::text          AS race_date,
    re.venue_name                AS venue,
    re.venue_code                AS venue_code,
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
    r.confirmed_at::text         AS confirmed_at,
    r.confirmed_by::text         AS confirmed_by,
    r.updated_at::text,
    r.created_at::text,
    rv.vid_status                AS video_raw_status,
    cs.locked_by_name,
    cs.session_started_at,
    rsh_prev.prev_status,
    rsh_rev.correction_request_comment,
    rsh_rea.reanalysis_reason,
    rsh_rea.reanalysis_comment,
    rsh_fail.analysis_failure_reason,
    re.round        AS kaisai_round,
    re.kaisai_day   AS kaisai_day
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
    SELECT u.name AS locked_by_name, cs2.started_at AS session_started_at
    FROM correction_session cs2
    JOIN "user" u ON cs2.started_by = u.id
    WHERE cs2.race_id = r.id AND cs2.status = 'IN_PROGRESS'
    ORDER BY cs2.started_at DESC LIMIT 1
) cs ON true
LEFT JOIN LATERAL (
    SELECT status AS prev_status
    FROM race_status_history
    WHERE race_id = r.id AND status != 'CORRECTING'
    ORDER BY changed_at DESC LIMIT 1
) rsh_prev ON (r.status = 'CORRECTING')
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
    WHERE race_id = r.id AND status = 'ANALYSIS_REQUESTED'
    ORDER BY changed_at DESC LIMIT 1
) rsh_rea ON true
LEFT JOIN LATERAL (
    SELECT metadata->>'failure_reason' AS analysis_failure_reason
    FROM race_status_history
    WHERE race_id = r.id AND status = 'ANALYSIS_FAILED'
    ORDER BY changed_at DESC LIMIT 1
) rsh_fail ON true
LEFT JOIN LATERAL (
    SELECT ao.video_goal_time, vwp.name AS preset_name
    FROM analysis_option ao
    LEFT JOIN venue_weather_preset vwp ON vwp.id = ao.venue_weather_preset_id
    WHERE ao.race_id = r.id
    ORDER BY ao.updated_at DESC LIMIT 1
) ao ON true
"""

RACE_TYPE_MAP = {
    "中央競馬（JRA）": "中央競馬",
    "地方競馬": "地方競馬",
}

LOCK_TIMEOUT_SECONDS = 1800  # 30 minutes

# race_video.status → Japanese display label
VIDEO_STATUS_DISPLAY = {
    "INCOMPLETE":  "未完了",
    "NEEDS_SETUP": "解析未設定",
    "STANDBY":     "準備完了",
    "FINISHED":    "完了",
}

# Venue code → numeric (JRA standard + local)
VENUE_CODE_INT: dict = {
    "sapporo": 1, "hakodate": 2, "fukushima": 3, "niigata": 4,
    "tokyo": 5, "nakayama": 6, "chukyo": 7, "kyoto": 8,
    "hanshin": 9, "kokura": 10,
    "oi": 30, "kawasaki": 31, "funabashi": 32, "urawa": 33,
}


def compute_race_id_num(race_date: Optional[str], venue_code: Optional[str],
                        kaisai_round: Optional[int], kaisai_day: Optional[int],
                        race_number: Optional[int]) -> Optional[int]:
    """Compute 10-digit race ID: YYYY RR DD VV NN (year4 + round1 + day1 + venue2 + racenum2)."""
    try:
        year4 = int(race_date[:4]) if race_date else 0
        rnd = int(kaisai_round or 1)
        day = int(kaisai_day or 1)
        vc = VENUE_CODE_INT.get(venue_code or "", 0)
        rnum = int(race_number or 0)
        return int(f"{year4:04d}{rnd:01d}{day:01d}{vc:02d}{rnum:02d}")
    except Exception:
        return None


def fmt_race(row: dict) -> dict:
    english_status = row.get("english_status") or "PENDING"
    video_raw = row.get("video_raw_status") or ""
    prev_status = row.get("prev_status")

    vid, ana, ds = compute_display_status(english_status, video_raw, prev_status)

    # 30-minute auto-release: if locked but session > 30min old, treat as unlocked
    locked_by = row.get("locked_by_name")
    session_started_at = row.get("session_started_at")
    if locked_by and session_started_at:
        if isinstance(session_started_at, str):
            try:
                session_started_at = datetime.datetime.fromisoformat(session_started_at)
            except Exception:
                session_started_at = None
        if session_started_at:
            elapsed = datetime.datetime.now(datetime.timezone.utc) - session_started_at.replace(
                tzinfo=datetime.timezone.utc if session_started_at.tzinfo is None else session_started_at.tzinfo
            )
            if elapsed.total_seconds() > LOCK_TIMEOUT_SECONDS:
                locked_by = None

    raw_type = row.get("race_type_raw") or ""
    race_type = RACE_TYPE_MAP.get(raw_type, raw_type)

    race_id_num = compute_race_id_num(
        row.get("race_date"),
        row.get("venue_code"),
        row.get("kaisai_round"),
        row.get("kaisai_day"),
        row.get("race_number"),
    )

    return {
        "id": row["id"],
        "race_date": row["race_date"],
        "venue": row["venue"],
        "venue_code": row.get("venue_code"),
        "race_type": race_type,
        "race_number": row["race_number"],
        "race_name": row["race_name"],
        "surface_type": row["surface_type"],
        "distance": row["distance"],
        "direction": row.get("direction"),
        "weather": row.get("weather"),
        "condition": row.get("condition"),
        "start_time": row.get("start_time"),
        "race_id_num": race_id_num,
        # English status for API logic
        "status": english_status,
        # Japanese display label for UI
        "display_status": ds,
        "video_status": vid,
        "video_url": None,
        "analysis_status": ana,
        "assigned_user": locked_by,
        "locked_by": locked_by,
        "locked_at": None,
        "confirmed_at": row.get("confirmed_at"),
        "confirmed_by": row.get("confirmed_by"),
        "correction_request_comment": row.get("correction_request_comment"),
        "reanalysis_reason": row.get("reanalysis_reason"),
        "reanalysis_comment": row.get("reanalysis_comment"),
        "analysis_failure_reason": row.get("analysis_failure_reason"),
        "video_raw_status": row.get("video_raw_status"),
        "video_display_status": VIDEO_STATUS_DISPLAY.get(row.get("video_raw_status") or "", "未完了"),
        "video_goal_time_raw": float(row["video_goal_time"]) if row.get("video_goal_time") is not None else None,
        "preset_name": row.get("preset_name"),
        "updated_at": row["updated_at"],
        "created_at": row["created_at"],
    }


def _write_history(cur, race_id: str, status: str, user_id: Optional[str], metadata: Optional[dict] = None):
    cur.execute(
        """INSERT INTO race_status_history (id, race_id, status, changed_by, changed_at, metadata)
           VALUES (gen_random_uuid(), %s, %s, %s, NOW(), %s)""",
        (race_id, status, user_id, json.dumps(metadata or {})),
    )


def _write_audit(cur, user_id: Optional[str], action: str, target_table: str, target_id: str,
                 old_value: Optional[dict] = None, new_value: Optional[dict] = None):
    cur.execute(
        """INSERT INTO audit_log (id, user_id, action, target_table, target_id, old_value, new_value, created_at)
           VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, NOW())""",
        (user_id, action, target_table, target_id,
         json.dumps(old_value) if old_value else None,
         json.dumps(new_value) if new_value else None),
    )


def _get_sys_user(cur) -> Optional[str]:
    cur.execute('SELECT id FROM "user" WHERE name = %s LIMIT 1', ("管理者",))
    row = cur.fetchone()
    return row["id"] if row else None


def _get_user_by_name(cur, name: str) -> Optional[str]:
    cur.execute('SELECT id FROM "user" WHERE name = %s LIMIT 1', (name,))
    row = cur.fetchone()
    return row["id"] if row else None


# ── Race retrieval endpoints ────────────────────────────────────────────────

@router.get("/races/latest-date")
def get_latest_race_date():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT MAX(event_date)::text AS latest_date FROM race_event")
        row = cur.fetchone()
        return {"date": row["latest_date"] if row else None}


@router.get("/races/summary")
def get_race_summary(date: Optional[str] = Query(None)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where_sql = "WHERE re.event_date = %s" if date else ""
        params = [date] if date else []
        cur.execute(
            f"""SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE r.status = 'CONFIRMED')           AS completed,
                    COUNT(*) FILTER (WHERE r.status = 'CORRECTING')          AS in_progress,
                    COUNT(*) FILTER (WHERE r.status = 'REVISION_REQUESTED')  AS needs_correction,
                    COUNT(*) FILTER (WHERE r.status = 'CORRECTED')           AS review
                FROM race r
                JOIN race_event re ON r.event_id = re.id
                JOIN race_category rc ON re.category_id = rc.id
                {where_sql}""",
            params,
        )
        row = cur.fetchone()
        cur.execute(
            f"""SELECT re.venue_name AS venue, COUNT(*) AS count
                FROM race r
                JOIN race_event re ON r.event_id = re.id
                JOIN race_category rc ON re.category_id = rc.id
                {where_sql}
                GROUP BY re.venue_name
                ORDER BY re.venue_name""",
            params,
        )
        by_venue = cur.fetchall()
        return {
            "total": row["total"] if row else 0,
            "completed": row["completed"] if row else 0,
            "in_progress": row["in_progress"] if row else 0,
            "needs_correction": row["needs_correction"] if row else 0,
            "review": row["review"] if row else 0,
            "by_venue": by_venue,
        }


@router.get("/races")
def get_races(
    date: Optional[str] = Query(None),
    venue: Optional[str] = Query(None),
    race_type: Optional[str] = Query(None),
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


DISPLAY_TO_DB_STATUS = {
    "待機中": "ANALYZED",
    "補正中": "CORRECTING",
    "レビュー待ち": "CORRECTED",
    "修正要請": "REVISION_REQUESTED",
    "データ確定": "CONFIRMED",
    "再解析要請": "ANALYSIS_REQUESTED",
}


@router.patch("/races/batch-update")
def batch_update_races(body: dict):
    race_ids = body.get("race_ids", [])
    if not race_ids:
        return {"updated": 0}
    ALLOWED_STATUSES = {"ANALYZED", "CORRECTING", "CORRECTED", "REVISION_REQUESTED", "CONFIRMED", "ANALYSIS_REQUESTED"}
    new_status = body.get("status")
    if new_status and new_status in DISPLAY_TO_DB_STATUS:
        new_status = DISPLAY_TO_DB_STATUS[new_status]
    if new_status and new_status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status '{new_status}' is not allowed for batch update")
    set_parts = ["updated_at = NOW()"]
    params: list = []
    if new_status:
        set_parts.append("status = %s")
        params.append(new_status)
    params.append(race_ids)
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"UPDATE race SET {', '.join(set_parts)} WHERE id = ANY(%s::uuid[]) RETURNING id::text",
            params,
        )
        updated_rows = [r["id"] for r in cur.fetchall()]
        if new_status and updated_rows:
            user_id = _get_sys_user(cur)
            for race_id in updated_rows:
                _write_history(cur, race_id, new_status, user_id, {"batch_update": True})
                _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                             None, {"status": new_status, "batch": True})
        conn.commit()
        return {"updated": len(updated_rows)}


VIDEO_ALLOWED_STATUSES = {"NEEDS_SETUP", "STANDBY"}


@router.patch("/races/batch-update-video")
def batch_update_video(body: dict):
    """Batch update race_video.status for latest video of given races."""
    race_ids = body.get("race_ids", [])
    if not race_ids:
        return {"updated": 0}
    new_status = body.get("status")
    if new_status not in VIDEO_ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail=f"Video status '{new_status}' not allowed")
    with get_db() as conn:
        cur = dict_cursor(conn)
        updated = 0
        for race_id in race_ids:
            cur.execute(
                """UPDATE race_video SET status = %s, updated_at = NOW()
                   WHERE id = (
                       SELECT id FROM race_video WHERE race_id = %s::uuid
                       ORDER BY created_at DESC LIMIT 1
                   ) AND status = ANY(ARRAY['NEEDS_SETUP','STANDBY'])
                   RETURNING id""",
                (new_status, race_id),
            )
            if cur.fetchone():
                updated += 1
        conn.commit()
        return {"updated": updated}


@router.get("/races/{race_id}")
def get_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"{RACE_QUERY} WHERE r.id = %s", (race_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Race not found")
        return fmt_race(row)


@router.get("/races/{race_id}/entries")
def get_race_entries(race_id: str):
    """Return horse entries for a race via race_linkage_result → official_horse_reference."""
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT
                   ohr.id::text,
                   %s AS race_id,
                   ohr.horse_number,
                   ohr.frame_number       AS gate_number,
                   ohr.horse_name,
                   ohr.jockey_name,
                   ohr.trainer_name,
                   ohr.finishing_time     AS finish_time,
                   ohr.finishing_order    AS finish_position,
                   NULL::numeric          AS last_3f,
                   NULL::numeric          AS margin,
                   NULL::varchar          AS color
               FROM race_linkage_result rlr
               JOIN official_horse_reference ohr ON ohr.official_race_id = rlr.official_race_id
               WHERE rlr.race_id = %s
               ORDER BY ohr.horse_number""",
            (race_id, race_id),
        )
        rows = cur.fetchall()
        if not rows:
            # Fallback: return synthetic entries for 14 horses if no linkage exists
            return [
                {
                    "id": str(i),
                    "race_id": race_id,
                    "horse_number": i,
                    "gate_number": i,
                    "horse_name": f"馬{i}",
                    "jockey_name": None,
                    "trainer_name": None,
                    "finish_time": None,
                    "finish_position": None,
                    "last_3f": None,
                    "margin": None,
                    "color": None,
                }
                for i in range(1, 15)
            ]
        return rows


@router.get("/races/{race_id}/history")
def get_race_history(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT
                   rsh.id,
                   COALESCE(u.name, '管理者') AS user_name,
                   rsh.status                 AS action_type,
                   rsh.metadata               AS metadata,
                   rsh.changed_at::text       AS created_at
               FROM race_status_history rsh
               LEFT JOIN "user" u ON rsh.changed_by = u.id
               WHERE rsh.race_id = %s
               ORDER BY rsh.changed_at DESC""",
            (race_id,),
        )
        rows = cur.fetchall()
        result = []
        for r in rows:
            meta = r.get("metadata") or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}
            desc = " / ".join(f"{k}: {v}" for k, v in meta.items() if v) if meta else None
            result.append({
                "id": r["id"],
                "user_name": r["user_name"],
                "action_type": r["action_type"],
                "description": desc,
                "created_at": r["created_at"],
            })
        return result


@router.post("/races/{race_id}/history")
def add_race_history(race_id: str, body: dict):
    user_name = body.get("user_name", "システム")
    action_type = body.get("action_type", "")
    description = body.get("description", "")
    with get_db() as conn:
        cur = dict_cursor(conn)
        user_id = _get_user_by_name(cur, user_name)
        _write_history(cur, race_id, action_type, user_id, {"description": description} if description else None)
        conn.commit()
        return {"message": "OK"}


# ── Status transition endpoints ─────────────────────────────────────────────

@router.patch("/races/{race_id}")
def update_race(race_id: str, body: dict):
    allowed = {"status", "race_number", "event_id"}
    updates = {k: v for k, v in body.items() if k in allowed and v is not None}
    set_parts = ["updated_at = NOW()"]
    params: list = []
    for col, val in updates.items():
        set_parts.append(f"{col} = %s")
        params.append(val)
    params.append(race_id)
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"UPDATE race SET {', '.join(set_parts)} WHERE id = %s RETURNING id", params)
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Race not found")
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/complete-analysis")
def complete_analysis(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE race SET status = 'ANALYZED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, "ANALYZED", user_id)
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": "ANALYZED"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/reanalyze")
def reanalyze_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE race SET status = 'ANALYZING', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, "ANALYZING", user_id)
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": "ANALYZING"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/reanalysis-request")
def reanalysis_request(race_id: str, body: dict):
    reason = body.get("reason", "")
    comment = body.get("comment")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE race SET status = 'ANALYSIS_REQUESTED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, "ANALYSIS_REQUESTED", user_id,
                       {"reanalysis_reason": reason, "reanalysis_comment": comment})
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": "ANALYSIS_REQUESTED", "reason": reason})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/matching-failure")
def matching_failure(race_id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE race SET status = 'MATCH_FAILED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, "MATCH_FAILED", user_id)
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": "MATCH_FAILED"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/correction-request")
def correction_request(race_id: str, body: dict):
    comment = body.get("comment", "")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE race SET status = 'REVISION_REQUESTED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, "REVISION_REQUESTED", user_id,
                       {"correction_request_comment": comment})
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": "REVISION_REQUESTED"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/confirm")
def confirm_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        user_id = _get_sys_user(cur)
        cur.execute(
            """UPDATE race
               SET status = 'CONFIRMED', confirmed_at = NOW(), confirmed_by = %s, updated_at = NOW()
               WHERE id = %s""",
            (user_id, race_id),
        )
        _write_history(cur, race_id, "CONFIRMED", user_id)
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": "CONFIRMED"})
        conn.commit()
    return get_race(race_id)


# ── Correction session endpoints ────────────────────────────────────────────

@router.post("/races/{race_id}/corrections/start")
def start_correction(race_id: str, body: dict):
    user_name = body.get("user_name", "ユーザー1")
    with get_db() as conn:
        cur = dict_cursor(conn)

        # Auto-expire stale IN_PROGRESS sessions (> 30 min) before conflict check
        cur.execute(
            """UPDATE correction_session
               SET completed_at = NOW(), status = 'REVERTED'
               WHERE race_id = %s AND status = 'IN_PROGRESS'
                 AND started_at < NOW() - INTERVAL '30 minutes'""",
            (race_id,),
        )

        # Conflict check: reject if another LIVE session is still IN_PROGRESS
        cur.execute(
            """SELECT cs.id, u.name AS locked_by_name
               FROM correction_session cs
               LEFT JOIN "user" u ON u.id = cs.started_by
               WHERE cs.race_id = %s AND cs.status = 'IN_PROGRESS'
               LIMIT 1""",
            (race_id,),
        )
        active = cur.fetchone()
        if active:
            raise HTTPException(
                status_code=409,
                detail=f"Race is already being corrected by {active['locked_by_name'] or '別のユーザー'}",
            )

        user_id = _get_user_by_name(cur, user_name)

        # Check race exists
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        race_row = cur.fetchone()
        if not race_row:
            raise HTTPException(status_code=404, detail="Race not found")

        old_status = race_row["status"]

        # Write CORRECTING history
        cur.execute(
            "UPDATE race SET status = 'CORRECTING', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        _write_history(cur, race_id, "CORRECTING", user_id,
                       {"prev_status": old_status, "started_by": user_name})
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old_status}, {"status": "CORRECTING", "started_by": user_name})

        # Create correction session
        cur.execute(
            """INSERT INTO correction_session (id, race_id, started_by, started_at, status)
               VALUES (gen_random_uuid(), %s, %s, NOW(), 'IN_PROGRESS')
               RETURNING id""",
            (race_id, user_id),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/corrections/complete")
def complete_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE correction_session SET completed_at = NOW(), status = 'COMPLETED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
            (race_id,),
        )
        cur.execute(
            "UPDATE race SET status = 'CORRECTED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, "CORRECTED", user_id)
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": "CORRECTED"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/corrections/temp-save")
def temp_save_correction(race_id: str, body: dict):
    exit_editing = body.get("exit_editing", False)
    correction_data = body.get("correction_data", {})
    with get_db() as conn:
        cur = dict_cursor(conn)

        # Get active session
        cur.execute(
            "SELECT id FROM correction_session WHERE race_id = %s AND status = 'IN_PROGRESS' ORDER BY started_at DESC LIMIT 1",
            (race_id,),
        )
        session = cur.fetchone()

        if session:
            # Compute next version number
            cur.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM correction_result WHERE session_id = %s",
                (session["id"],),
            )
            ver_row = cur.fetchone()
            next_ver = ver_row["next_ver"] if ver_row else 1

            user_id = _get_sys_user(cur)
            cur.execute(
                """INSERT INTO correction_result (id, session_id, version, corrected_by, corrected_at, correction_data)
                   VALUES (gen_random_uuid(), %s, %s, %s, NOW(), %s)""",
                (session["id"], next_ver, user_id, json.dumps(correction_data)),
            )

        if exit_editing:
            cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
            race_now = cur.fetchone()
            cur.execute(
                "UPDATE correction_session SET completed_at = NOW(), status = 'REVERTED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
                (race_id,),
            )
            prev_status = _get_previous_status(cur, race_id, "CORRECTING")
            cur.execute(
                "UPDATE race SET status = %s, updated_at = NOW() WHERE id = %s",
                (prev_status, race_id),
            )
            user_id = _get_sys_user(cur)
            _write_history(cur, race_id, prev_status, user_id, {"reason": "temp-save exit"})
            _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                         {"status": race_now["status"] if race_now else None},
                         {"status": prev_status, "reason": "temp-save exit"})
        else:
            cur.execute("UPDATE race SET updated_at = NOW() WHERE id = %s", (race_id,))

        conn.commit()
    return get_race(race_id)


CANONICAL_STATUSES = {
    "PENDING", "ANALYZING", "ANALYSIS_FAILED", "ANALYZED", "ANALYSIS_REQUESTED",
    "MATCH_FAILED", "CORRECTING", "CORRECTED", "REVISION_REQUESTED", "CONFIRMED",
}


def _get_previous_status(cur, race_id: str, current_status: str) -> str:
    """Look up the canonical status before current_status from race_status_history."""
    cur.execute(
        """SELECT status FROM race_status_history
           WHERE race_id = %s AND status != %s
           ORDER BY changed_at DESC""",
        (race_id, current_status),
    )
    for row in cur:
        if row["status"] in CANONICAL_STATUSES:
            return row["status"]
    return "ANALYZED"


@router.post("/races/{race_id}/corrections/cancel")
def cancel_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        prev_status = _get_previous_status(cur, race_id, old["status"])
        cur.execute(
            "UPDATE correction_session SET completed_at = NOW(), status = 'REVERTED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
            (race_id,),
        )
        cur.execute(
            "UPDATE race SET status = %s, updated_at = NOW() WHERE id = %s",
            (prev_status, race_id),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, prev_status, user_id, {"reason": "correction cancelled"})
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": prev_status, "reason": "correction cancelled"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/force-unlock")
def force_unlock(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE correction_session SET completed_at = NOW(), status = 'REVERTED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
            (race_id,),
        )
        cur.execute(
            "UPDATE race SET status = 'ANALYZED', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, "ANALYZED", user_id, {"reason": "force-unlock by admin"})
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]},
                     {"status": "ANALYZED", "reason": "force-unlock by admin"})
        conn.commit()
    return get_race(race_id)


# ── Analysis option endpoints ────────────────────────────────────────────────

@router.get("/races/{race_id}/analysis-option")
def get_analysis_option(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT ao.id, ao.race_id, ao.video_id,
                      ao.venue_weather_preset_id, ao.video_goal_time, ao.comment,
                      vwp.name AS preset_name,
                      ao.created_at::text, ao.updated_at::text
               FROM analysis_option ao
               LEFT JOIN venue_weather_preset vwp ON ao.venue_weather_preset_id = vwp.id
               WHERE ao.race_id = %s
               ORDER BY ao.created_at DESC LIMIT 1""",
            (race_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return row


@router.post("/races/{race_id}/analysis-option")
def upsert_analysis_option(race_id: str, body: dict):
    video_goal_time = body.get("video_goal_time")
    preset_id = body.get("venue_weather_preset_id")
    comment = body.get("comment")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id FROM race_video WHERE race_id = %s ORDER BY created_at DESC LIMIT 1",
            (race_id,),
        )
        video = cur.fetchone()
        if not video:
            raise HTTPException(status_code=404, detail="No video found for this race")
        video_id = video["id"]
        cur.execute("DELETE FROM analysis_option WHERE race_id = %s", (race_id,))
        cur.execute(
            """INSERT INTO analysis_option (id, race_id, video_id, venue_weather_preset_id, video_goal_time, comment, created_at, updated_at)
               VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, NOW(), NOW())
               RETURNING id""",
            (race_id, video_id, preset_id, video_goal_time, comment),
        )
        conn.commit()
        return get_analysis_option(race_id)


@router.get("/venue-weather-presets")
def get_venue_weather_presets(
    active_only: bool = Query(True),
    venue_code: Optional[str] = Query(None),
    surface_type: Optional[str] = Query(None),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where = []
        params = []
        if active_only:
            where.append("is_active = TRUE")
        if venue_code:
            where.append("venue_code = %s")
            params.append(venue_code)
        if surface_type:
            where.append("surface_type = %s")
            params.append(surface_type)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        cur.execute(
            f"SELECT id, venue_code, weather_preset_code, name, surface_type, is_active FROM venue_weather_preset {where_sql} ORDER BY name",
            params,
        )
        return cur.fetchall()


@router.get("/venue-weather-presets/{preset_id}")
def get_venue_weather_preset(preset_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id, venue_code, weather_preset_code, name, surface_type, is_active, preset_parameters FROM venue_weather_preset WHERE id = %s",
            (preset_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Preset not found")
        return row


@router.post("/venue-weather-presets", status_code=201)
def create_venue_weather_preset(body: dict):
    required = ["venue_code", "weather_preset_code", "name", "surface_type"]
    for f in required:
        if f not in body:
            raise HTTPException(status_code=422, detail=f"Missing field: {f}")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id FROM venue_weather_preset WHERE venue_code = %s AND weather_preset_code = %s AND surface_type = %s",
            (body["venue_code"], body["weather_preset_code"], body["surface_type"]),
        )
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="Duplicate (venue_code, weather_preset_code, surface_type)")
        cur.execute(
            """INSERT INTO venue_weather_preset
                 (id, venue_code, weather_preset_code, name, surface_type, preset_parameters, is_active, created_at, updated_at)
               VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, TRUE, NOW(), NOW())
               RETURNING id, venue_code, weather_preset_code, name, surface_type, is_active""",
            (body["venue_code"], body["weather_preset_code"], body["name"],
             body["surface_type"], json.dumps(body.get("preset_parameters", {}))),
        )
        conn.commit()
        return cur.fetchone()


@router.put("/venue-weather-presets/{preset_id}")
def update_venue_weather_preset(preset_id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM venue_weather_preset WHERE id = %s", (preset_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Preset not found")
        fields = ["updated_at = NOW()"]
        params = []
        for f in ("venue_code", "weather_preset_code", "name", "surface_type"):
            if f in body:
                fields.append(f"{f} = %s")
                params.append(body[f])
        if "preset_parameters" in body:
            fields.append("preset_parameters = %s")
            params.append(json.dumps(body["preset_parameters"]))
        if "is_active" in body:
            fields.append("is_active = %s")
            params.append(body["is_active"])
        params.append(preset_id)
        cur.execute(
            f"UPDATE venue_weather_preset SET {', '.join(fields)} WHERE id = %s RETURNING id, venue_code, weather_preset_code, name, surface_type, is_active",
            params,
        )
        conn.commit()
        return cur.fetchone()


@router.delete("/venue-weather-presets/{preset_id}")
def delete_venue_weather_preset(preset_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE venue_weather_preset SET is_active = FALSE, updated_at = NOW() WHERE id = %s RETURNING id",
            (preset_id,),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Preset not found")
        conn.commit()
        return {"deleted": preset_id}


# ── API spec aligned endpoints ───────────────────────────────────────────────

@router.post("/races/bulk-status")
def bulk_status_update(body: dict):
    """POST /races/bulk-status — 仕様書準拠の一括ステータス変更。"""
    return batch_update_races(body)


@router.get("/races/{race_id}/comparison")
def get_race_comparison(race_id: str):
    """公式アンカー（official_horse_furlong_time）と解析結果の比較。"""
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT ohr.horse_number, ohr.horse_name,
                      ohft.furlong_distance, ohft.furlong_time_seconds AS official_time
               FROM official_horse_furlong_time ohft
               JOIN official_horse_reference ohr ON ohr.id = ohft.horse_reference_id
               JOIN race_linkage_result rlr ON rlr.race_id = %s::uuid AND rlr.official_reference_id IS NOT NULL
               ORDER BY ohr.horse_number, ohft.furlong_distance""",
            (race_id,),
        )
        official = cur.fetchall()

        cur.execute(
            """SELECT ard.horse_number, ard.marker_type AS checkpoint,
                      ard.time_sec AS analysis_time, ard.is_corrected
               FROM analysis_result_detail ard
               JOIN analysis_result_header arh ON arh.id = ard.header_id AND arh.is_current = TRUE
               WHERE arh.race_id = %s::uuid
               ORDER BY ard.horse_number, ard.marker_type""",
            (race_id,),
        )
        analysis = cur.fetchall()

        return {
            "race_id": race_id,
            "official_anchor": official,
            "analysis_results": analysis,
        }


@router.get("/races/{race_id}/corrections/history")
def get_corrections_history(race_id: str):
    """補正の版一覧。"""
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT cr.id::text, cs.id::text AS session_id,
                      cr.version, u.name AS corrected_by,
                      cr.corrected_at::text, cr.created_at::text
               FROM correction_result cr
               JOIN correction_session cs ON cs.id = cr.session_id
               LEFT JOIN "user" u ON u.id = cr.corrected_by
               WHERE cs.race_id = %s::uuid
               ORDER BY cr.corrected_at DESC""",
            (race_id,),
        )
        return cur.fetchall()


@router.put("/races/{race_id}/corrections/save")
def save_correction(race_id: str, body: dict):
    """PUT /races/{raceId}/corrections/save — version 必須の補正保存。"""
    return temp_save_correction(race_id, body)


@router.post("/races/{race_id}/corrections/recalculate")
def recalculate_correction(race_id: str, body: dict = None):
    """明示的再計算（現時点ではスタブ）。"""
    return {"race_id": race_id, "recalculated": True, "message": "Recalculation queued"}


@router.post("/races/{race_id}/corrections/revert")
def revert_correction(race_id: str):
    """補正破棄 → 前のステータスへ戻す。cancel と同等。"""
    return cancel_correction(race_id)


@router.post("/races/{race_id}/revision/reject")
def revision_reject(race_id: str, body: dict = None):
    """管理者差し戻し CORRECTED → REVISION_REQUESTED。"""
    return correction_request(race_id, body or {})


@router.post("/races/{race_id}/linkage")
def trigger_linkage(race_id: str, body: dict = None):
    """公式データ突合を実行（ANALYZED → MATCH_FAILED or 突合成功）。"""
    body = body or {}
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s::uuid", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "INSERT INTO race_linkage_result (id, race_id, linkage_status, created_at) VALUES (gen_random_uuid(), %s::uuid, 'PENDING', NOW()) ON CONFLICT (race_id) DO NOTHING",
            (race_id,),
        )
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/linkage/retry")
def retry_linkage(race_id: str, body: dict = None):
    """突合リトライ。"""
    return trigger_linkage(race_id, body)


@router.put("/races/{race_id}/videos/{video_id}")
def update_video(race_id: str, video_id: str, body: dict):
    """動画 DB 属性更新（storage_path, status 等）。"""
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id FROM race_video WHERE id = %s::uuid AND race_id = %s::uuid",
            (video_id, race_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Video not found")
        fields = ["updated_at = NOW()"]
        params = []
        for f in ("storage_path", "status"):
            if f in body:
                fields.append(f"{f} = %s")
                params.append(body[f])
        params += [video_id, race_id]
        cur.execute(
            f"""UPDATE race_video SET {', '.join(fields)}
               WHERE id = %s::uuid AND race_id = %s::uuid
               RETURNING id::text, race_id::text, storage_path, status, uploaded_at::text""",
            params,
        )
        result = cur.fetchone()
        conn.commit()
        return result


@router.get("/correction-memo-masters")
def get_correction_memo_masters(active_only: bool = Query(True)):
    """GET /correction-memo-masters — 仕様書準拠パス。"""
    with get_db() as conn:
        cur = dict_cursor(conn)
        where = "WHERE is_active = TRUE" if active_only else ""
        cur.execute(f"SELECT id, memo_text, display_order, is_active FROM correction_memo_master {where} ORDER BY display_order")
        return cur.fetchall()


@router.get("/videos")
def get_videos(
    race_id: Optional[str] = Query(None),
    event_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    """動画一覧（raceId, eventId, status でフィルタ可）。"""
    with get_db() as conn:
        cur = dict_cursor(conn)
        where = []
        params = []
        if race_id:
            where.append("rv.race_id = %s::uuid")
            params.append(race_id)
        if event_id:
            where.append("r.event_id = %s::uuid")
            params.append(event_id)
        if status:
            where.append("rv.status = %s")
            params.append(status)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        cur.execute(
            f"""SELECT rv.id::text, rv.race_id::text, rv.storage_path,
                       rv.status, rv.uploaded_at::text, rv.created_at::text,
                       r.race_name, r.race_number
                FROM race_video rv
                JOIN race r ON r.id = rv.race_id
                {where_sql}
                ORDER BY rv.created_at DESC""",
            params,
        )
        return cur.fetchall()


@router.get("/auth/me")
def auth_me():
    """自分の情報（IAP 認証はスキップ。開発用スタブ）。"""
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "name": "開発ユーザー",
        "email": "dev@example.com",
        "role": "admin",
    }


@router.get("/auth/permissions")
def auth_permissions():
    """権限一覧（開発用スタブ）。"""
    return {
        "canCorrect": True,
        "canConfirm": True,
        "canReanalyze": True,
        "canBulkUpdate": True,
    }
