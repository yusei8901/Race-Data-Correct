from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor
import json
import datetime

router = APIRouter(prefix="/fastapi")

# ── Status display helpers ───────────────────────────────────────

EVENT_DISPLAY: dict = {
    "EDITING":            "補正中",
    "REVISION_REQUESTED": "修正要請",
    "ANALYSIS_FAILED":    "解析失敗",
    "MATCH_FAILED":       "突合失敗",
    "ANALYSIS_REQUESTED": "再解析要請",
}

STATUS_CODE_DISPLAY: dict = {
    "WAITING":         "解析待機中",
    "ANALYZING":       "解析中",
    "ANALYZED":        "要補正",
    "IN_REVIEW":       "レビュー待ち",
    "NEEDS_ATTENTION": "管理者対応",
    "CONFIRMED":       "データ確定",
}


def get_display_status(status_code: str, event: Optional[str]) -> str:
    if event and event in EVENT_DISPLAY:
        return EVENT_DISPLAY[event]
    return STATUS_CODE_DISPLAY.get(status_code, status_code)


def get_compat_status(status_code: str, event: Optional[str]) -> str:
    """Old-style status string for backward compat."""
    if status_code == "WAITING":         return "PENDING"
    if status_code == "ANALYZING":       return "ANALYZING"
    if status_code == "ANALYZED":
        if event == "EDITING":            return "CORRECTING"
        if event == "REVISION_REQUESTED": return "REVISION_REQUESTED"
        return "ANALYZED"
    if status_code == "IN_REVIEW":       return "CORRECTED"
    if status_code == "NEEDS_ATTENTION":
        if event == "ANALYSIS_FAILED":    return "ANALYSIS_FAILED"
        if event == "MATCH_FAILED":       return "MATCH_FAILED"
        if event == "ANALYSIS_REQUESTED": return "ANALYSIS_REQUESTED"
        return "ANALYSIS_FAILED"
    if status_code == "CONFIRMED":       return "CONFIRMED"
    return "PENDING"


def _set_status(cur, race_id: str, status_code: str, event: Optional[str] = None,
                detail: Optional[str] = None) -> Optional[dict]:
    cur.execute(
        """UPDATE race
           SET status_id = (SELECT id FROM race_statuses WHERE status_code = %s),
               event = %s,
               detail = %s,
               updated_at = NOW()
           WHERE id = %s
           RETURNING id""",
        (status_code, event, detail, race_id),
    )
    return cur.fetchone()


# ── Shared race query ───────────────────────────────────────

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
    rs.status_code,
    rs.display_name              AS status_display_name,
    rs.tab_group,
    r.status_id,
    r.event,
    r.detail,
    r.confirmed_at::text         AS confirmed_at,
    r.confirmed_by::text         AS confirmed_by,
    r.updated_at::text,
    r.created_at::text,
    rv.vid_status                AS video_raw_status,
    cs.locked_by_name,
    cs.session_started_at,
    rsh_rev.correction_request_comment,
    rsh_rea.reanalysis_reason,
    rsh_rea.reanalysis_comment,
    rsh_fail.analysis_failure_reason,
    re.round        AS kaisai_round,
    re.kaisai_day   AS kaisai_day,
    ao.video_goal_time,
    ao.preset_id,
    ao.preset_name
FROM race r
JOIN race_event re ON r.event_id = re.id
JOIN race_category rc ON re.category_id = rc.id
JOIN race_statuses rs ON rs.id = r.status_id
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
    SELECT ao.video_goal_time,
           ao.venue_weather_preset_id::text AS preset_id,
           vwp.name AS preset_name
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
    "UNLINKED": "未連携",
    "LINKED":   "連携済み",
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
    status_code = row.get("status_code") or "WAITING"
    event = row.get("event")
    video_raw = row.get("video_raw_status") or ""

    ds = get_display_status(status_code, event)
    compat_status = get_compat_status(status_code, event)

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
        # New status fields
        "status_code": status_code,
        "status_id": row.get("status_id"),
        "tab_group": row.get("tab_group"),
        "display_name": row.get("status_display_name"),
        "event": event,
        "detail": row.get("detail"),
        # Backward-compat status (maps new model back to old codes)
        "status": compat_status,
        "display_status": ds,
        "video_url": None,
        "assigned_user": locked_by,
        "locked_by": locked_by,
        "locked_at": None,
        "confirmed_at": row.get("confirmed_at"),
        "confirmed_by": row.get("confirmed_by"),
        "correction_request_comment": row.get("correction_request_comment"),
        "reanalysis_reason": row.get("reanalysis_reason"),
        "reanalysis_comment": row.get("reanalysis_comment"),
        "analysis_failure_reason": row.get("analysis_failure_reason"),
        "video_raw_status": video_raw,
        "video_display_status": VIDEO_STATUS_DISPLAY.get(video_raw, "未連携"),
        "video_goal_time_raw": float(row["video_goal_time"]) if row.get("video_goal_time") is not None else None,
        "preset_name": row.get("preset_name"),
        "preset_id": row.get("preset_id"),
        "updated_at": row["updated_at"],
        "created_at": row["created_at"],
    }


def _write_history(cur, race_id: str, *,
                   from_status: Optional[str] = None,
                   from_sub_status: Optional[str] = None,
                   to_status: Optional[str] = None,
                   to_sub_status: Optional[str] = None,
                   user_id: Optional[str] = None,
                   reason: Optional[str] = None,
                   metadata: Optional[dict] = None):
    """全ステータス遷移を race_status_history に記録（PDF設計準拠）。
    legacy `status` カラムには to_status を二重書きして既存クエリとの互換を保つ。"""
    legacy_status = to_status or ""
    cur.execute(
        """INSERT INTO race_status_history
             (id, race_id, status, from_status, from_sub_status,
              to_status, to_sub_status, reason, changed_by, changed_at, metadata)
           VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)""",
        (race_id, legacy_status, from_status, from_sub_status,
         to_status, to_sub_status, reason,
         user_id, json.dumps(metadata or {})),
    )


def _get_status_state(cur, race_id: str) -> Optional[dict]:
    """現在の (status_id, status_code, event) を返す。存在しなければ None。"""
    cur.execute(
        """SELECT r.status_id, rs.status_code, r.event
           FROM race r LEFT JOIN race_statuses rs ON rs.id = r.status_id
           WHERE r.id = %s""",
        (race_id,),
    )
    return cur.fetchone()


def _write_comment(cur, race_id: str, comment_type: str, comment: str, user_id: Optional[str] = None):
    """race_comment テーブルにコメントを保存（PDF Phase 2 設計準拠）。
    comment が空文字・None の場合は何もしない。"""
    if not comment:
        return
    cur.execute(
        """INSERT INTO race_comment (id, race_id, comment_type, comment, created_by, created_at)
           VALUES (gen_random_uuid(), %s, %s, %s, %s, NOW())""",
        (race_id, comment_type, comment, user_id),
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
                    COUNT(*) FILTER (WHERE rs.status_code = 'CONFIRMED')       AS confirmed,
                    COUNT(*) FILTER (WHERE rs.status_code = 'ANALYZED')        AS needs_correction,
                    COUNT(*) FILTER (WHERE rs.tab_group = '待機中')                 AS waiting,
                    COUNT(*) FILTER (WHERE rs.tab_group = '管理者対応待ち')         AS admin_pending,
                    COUNT(*) FILTER (WHERE r.event = 'EDITING')                AS editing,
                    COUNT(*) FILTER (WHERE r.event = 'REVISION_REQUESTED')     AS revision_requested,
                    COUNT(*) FILTER (WHERE r.event = 'ANALYSIS_FAILED')        AS analysis_failed,
                    COUNT(*) FILTER (WHERE r.event = 'MATCH_FAILED')           AS match_failed,
                    COUNT(*) FILTER (WHERE r.event = 'ANALYSIS_REQUESTED')     AS analysis_requested
                FROM race r
                JOIN race_event re ON r.event_id = re.id
                JOIN race_category rc ON re.category_id = rc.id
                JOIN race_statuses rs ON rs.id = r.status_id
                {where_sql}""",
            params,
        )
        row = cur.fetchone()
        cur.execute(
            f"""SELECT re.venue_name AS venue, COUNT(*) AS count
                FROM race r
                JOIN race_event re ON r.event_id = re.id
                JOIN race_category rc ON re.category_id = rc.id
                JOIN race_statuses rs ON rs.id = r.status_id
                {where_sql}
                GROUP BY re.venue_name
                ORDER BY re.venue_name""",
            params,
        )
        by_venue = cur.fetchall()
        return {
            "total": row["total"] if row else 0,
            "confirmed": row["confirmed"] if row else 0,
            "needs_correction": row["needs_correction"] if row else 0,
            "waiting": row["waiting"] if row else 0,
            "admin_pending": row["admin_pending"] if row else 0,
            "editing": row["editing"] if row else 0,
            "revision_requested": row["revision_requested"] if row else 0,
            "analysis_failed": row["analysis_failed"] if row else 0,
            "match_failed": row["match_failed"] if row else 0,
            "analysis_requested": row["analysis_requested"] if row else 0,
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


# status_code -> tab_group display (for batch update validation)
BATCH_ALLOWED_STATUS_CODES = {"WAITING", "ANALYZED", "IN_REVIEW", "CONFIRMED"}


@router.patch("/races/batch-update")
def batch_update_races(body: dict):
    race_ids = body.get("race_ids", [])
    if not race_ids:
        return {"updated": 0}
    new_status_code = body.get("status_code")
    new_event = body.get("event")
    if new_status_code and new_status_code not in BATCH_ALLOWED_STATUS_CODES:
        raise HTTPException(status_code=400, detail=f"status_code '{new_status_code}' is not allowed for batch update")
    if not new_status_code:
        return {"updated": 0}
    with get_db() as conn:
        cur = dict_cursor(conn)
        # Capture per-race old state before update so history records true from→to.
        cur.execute(
            """SELECT r.id::text AS id, rs.status_code AS status_code, r.event AS event
               FROM race r LEFT JOIN race_statuses rs ON rs.id = r.status_id
               WHERE r.id = ANY(%s::uuid[])""",
            (race_ids,),
        )
        old_by_id = {row["id"]: row for row in cur.fetchall()}

        cur.execute(
            """UPDATE race
               SET status_id = (SELECT id FROM race_statuses WHERE status_code = %s),
                   event = %s,
                   updated_at = NOW()
               WHERE id = ANY(%s::uuid[])
               RETURNING id::text""",
            (new_status_code, new_event, race_ids),
        )
        updated_rows = [r["id"] for r in cur.fetchall()]
        if updated_rows:
            user_id = _get_sys_user(cur)
            for race_id in updated_rows:
                old = old_by_id.get(race_id) or {"status_code": None, "event": None}
                _write_history(cur, race_id,
                               from_status=old["status_code"], from_sub_status=old["event"],
                               to_status=new_status_code, to_sub_status=new_event,
                               user_id=user_id, reason="一括ステータス更新",
                               metadata={"batch_update": True})
                _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                             {"status_code": old["status_code"], "event": old["event"]},
                             {"status_code": new_status_code, "event": new_event, "batch": True})
        conn.commit()
        return {"updated": len(updated_rows)}

VIDEO_ALLOWED_STATUSES = {"UNLINKED", "LINKED"}


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
                   )
                   RETURNING id""",
                (new_status, race_id),
            )
            if cur.fetchone():
                updated += 1
        conn.commit()
        return {"updated": updated}


@router.patch("/races/bulk-update-preset")
def bulk_update_preset(body: dict):
    """Batch-apply a venue_weather_preset to multiple races' analysis_option and auto-update video status."""
    race_ids = body.get("race_ids", [])
    preset_id = body.get("venue_weather_preset_id")
    if not race_ids or not preset_id:
        return {"updated": 0}
    updated = 0
    with get_db() as conn:
        cur = dict_cursor(conn)
        for race_id in race_ids:
            cur.execute(
                "SELECT id, status FROM race_video WHERE race_id = %s::uuid ORDER BY created_at DESC LIMIT 1",
                (race_id,),
            )
            video = cur.fetchone()
            if not video:
                continue
            video_id = video["id"]
            cur.execute(
                "SELECT video_goal_time, comment FROM analysis_option WHERE race_id = %s ORDER BY updated_at DESC LIMIT 1",
                (race_id,),
            )
            existing = cur.fetchone()
            goal_time = existing["video_goal_time"] if existing else None
            comment = existing["comment"] if existing else None
            cur.execute("DELETE FROM analysis_option WHERE race_id = %s", (race_id,))
            cur.execute(
                """INSERT INTO analysis_option
                   (id, race_id, video_id, venue_weather_preset_id, video_goal_time, comment, created_at, updated_at)
                   VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, NOW(), NOW())""",
                (race_id, video_id, preset_id, goal_time, comment),
            )
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


@router.get("/races/{race_id}/official-results")
def get_official_results(race_id: str):
    """Return JRA official results for a race (公式データパネル用)."""
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT rlr.official_race_id
               FROM race_linkage_result rlr
               WHERE rlr.race_id = %s::uuid AND rlr.official_race_id IS NOT NULL
               LIMIT 1""",
            (race_id,),
        )
        linkage = cur.fetchone()
        if not linkage:
            return {"horses": [], "leader_furlong_times": [], "has_data": False}

        official_race_id = linkage["official_race_id"]

        cur.execute(
            """SELECT ohr.horse_number,
                      ohr.frame_number      AS gate_number,
                      ohr.horse_name,
                      ohr.finishing_order,
                      ohr.finishing_time,
                      ARRAY_AGG(ohft.furlong_no ORDER BY ohft.furlong_no) FILTER (WHERE ohft.furlong_no IS NOT NULL) AS furlong_nos,
                      ARRAY_AGG(ohft.time_sec  ORDER BY ohft.furlong_no) FILTER (WHERE ohft.furlong_no IS NOT NULL) AS furlong_times
               FROM official_horse_reference ohr
               LEFT JOIN official_horse_furlong_time ohft
                      ON ohft.official_horse_reference_id = ohr.id
               WHERE ohr.official_race_id = %s
               GROUP BY ohr.horse_number, ohr.frame_number, ohr.horse_name,
                        ohr.finishing_order, ohr.finishing_time
               ORDER BY ohr.finishing_order NULLS LAST, ohr.horse_number""",
            (official_race_id,),
        )
        rows = cur.fetchall()
        if not rows:
            return {"horses": [], "leader_furlong_times": [], "has_data": False}

        winner_time = None
        leader_furlong_nos = []
        leader_furlong_times_raw = []
        for row in rows:
            if row["finishing_order"] == 1:
                winner_time = row["finishing_time"]
                leader_furlong_nos = row["furlong_nos"] or []
                leader_furlong_times_raw = row["furlong_times"] or []
                break

        horses = []
        for row in rows:
            furt = [float(t) for t in (row["furlong_times"] or [])]
            last_3f = round(sum(furt[-3:]), 2) if len(furt) >= 3 else (round(sum(furt), 2) if furt else None)
            margin = None
            if winner_time is not None and row["finishing_time"] is not None and row["finishing_order"] != 1:
                margin = round(float(row["finishing_time"]) - float(winner_time), 2)
            horses.append({
                "finish_pos": row["finishing_order"],
                "horse_number": row["horse_number"],
                "gate_number": row["gate_number"],
                "horse_name": row["horse_name"],
                "finish_time": float(row["finishing_time"]) if row["finishing_time"] is not None else None,
                "last_3f": last_3f,
                "margin": margin,
            })

        leader_ft = [
            {"furlong_no": int(fn), "time_sec": float(t)}
            for fn, t in zip(leader_furlong_nos, leader_furlong_times_raw)
        ]
        return {"horses": horses, "leader_furlong_times": leader_ft, "has_data": True}


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
                   rsh.from_status,
                   rsh.from_sub_status,
                   rsh.to_status,
                   rsh.to_sub_status,
                   rsh.reason,
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
                "from_status": r.get("from_status"),
                "from_sub_status": r.get("from_sub_status"),
                "to_status": r.get("to_status"),
                "to_sub_status": r.get("to_sub_status"),
                "reason": r.get("reason"),
                "description": desc,
                "created_at": r["created_at"],
            })
        return result


@router.get("/races/{race_id}/comments")
def get_race_comments(race_id: str, comment_type: Optional[str] = None):
    """race_comment テーブルから修正要請・再解析要請コメントを返す（PDF Phase 2）。"""
    with get_db() as conn:
        cur = dict_cursor(conn)
        if comment_type:
            cur.execute(
                """SELECT
                       rc.id,
                       rc.comment_type,
                       rc.comment,
                       COALESCE(u.name, '管理者') AS created_by_name,
                       rc.created_at::text AS created_at
                   FROM race_comment rc
                   LEFT JOIN "user" u ON rc.created_by = u.id
                   WHERE rc.race_id = %s AND rc.comment_type = %s
                   ORDER BY rc.created_at DESC""",
                (race_id, comment_type),
            )
        else:
            cur.execute(
                """SELECT
                       rc.id,
                       rc.comment_type,
                       rc.comment,
                       COALESCE(u.name, '管理者') AS created_by_name,
                       rc.created_at::text AS created_at
                   FROM race_comment rc
                   LEFT JOIN "user" u ON rc.created_by = u.id
                   WHERE rc.race_id = %s
                   ORDER BY rc.created_at DESC""",
                (race_id,),
            )
        return cur.fetchall()


@router.post("/races/{race_id}/history")
def add_race_history(race_id: str, body: dict):
    """手動で操作ログを追記するエンドポイント（ユーザーアクションのフリー記録）。
    ステータス遷移を伴わない場合は to_status のみに action_type を入れる。"""
    user_name = body.get("user_name", "システム")
    action_type = body.get("action_type", "")
    description = body.get("description", "")
    with get_db() as conn:
        cur = dict_cursor(conn)
        user_id = _get_user_by_name(cur, user_name)
        _write_history(cur, race_id,
                       to_status=action_type,
                       user_id=user_id,
                       reason=description[:200] if description else None,
                       metadata={"description": description} if description else None)
        conn.commit()
        return {"message": "OK"}


# ── Status transition endpoints ─────────────────────────────────────────────

@router.patch("/races/{race_id}")
def update_race(race_id: str, body: dict):
    allowed = {"race_number", "event_id"}
    updates = {k: v for k, v in body.items() if k in allowed and v is not None}
    set_parts = ["updated_at = NOW()"]
    params: list = []
    for col, val in updates.items():
        set_parts.append(f"{col} = %s")
        params.append(val)
    # Support new-style status update
    new_status_code = body.get("status_code")
    new_event = body.get("event")
    if new_status_code:
        set_parts.append("status_id = (SELECT id FROM race_statuses WHERE status_code = %s)")
        params.append(new_status_code)
        set_parts.append("event = %s")
        params.append(new_event)
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
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        if not _set_status(cur, race_id, "ANALYZED"):
            raise HTTPException(status_code=404, detail="Race not found")
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="ANALYZED", to_sub_status=None,
                       user_id=user_id, reason="解析完了")
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "ANALYZED", "event": None})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/reanalyze")
def reanalyze_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        if not _set_status(cur, race_id, "ANALYZING"):
            raise HTTPException(status_code=404, detail="Race not found")
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="ANALYZING", to_sub_status=None,
                       user_id=user_id, reason="再解析開始")
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "ANALYZING", "event": None})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/reanalysis-request")
def reanalysis_request(race_id: str, body: dict):
    reason = body.get("reason", "")
    comment = body.get("comment")
    with get_db() as conn:
        cur = dict_cursor(conn)
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        if not _set_status(cur, race_id, "NEEDS_ATTENTION", "ANALYSIS_REQUESTED"):
            raise HTTPException(status_code=404, detail="Race not found")
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="NEEDS_ATTENTION", to_sub_status="ANALYSIS_REQUESTED",
                       user_id=user_id, reason=(reason or "再解析要請")[:200],
                       metadata={"reanalysis_reason": reason, "reanalysis_comment": comment})
        _write_comment(cur, race_id, "REANALYSIS_REQUEST", comment or reason or "", user_id)
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "NEEDS_ATTENTION", "event": "ANALYSIS_REQUESTED"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/matching-failure")
def matching_failure(race_id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        if not _set_status(cur, race_id, "NEEDS_ATTENTION", "MATCH_FAILED"):
            raise HTTPException(status_code=404, detail="Race not found")
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="NEEDS_ATTENTION", to_sub_status="MATCH_FAILED",
                       user_id=user_id, reason="突合失敗")
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "NEEDS_ATTENTION", "event": "MATCH_FAILED"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/correction-request")
def correction_request(race_id: str, body: dict):
    comment = body.get("comment", "")
    with get_db() as conn:
        cur = dict_cursor(conn)
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        if not _set_status(cur, race_id, "ANALYZED", "REVISION_REQUESTED"):
            raise HTTPException(status_code=404, detail="Race not found")
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="ANALYZED", to_sub_status="REVISION_REQUESTED",
                       user_id=user_id, reason=(comment or "修正要請")[:200],
                       metadata={"correction_request_comment": comment})
        _write_comment(cur, race_id, "REVISION_REQUEST", comment or "", user_id)
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "ANALYZED", "event": "REVISION_REQUESTED"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/confirm")
def confirm_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        user_id = _get_sys_user(cur)
        cur.execute(
            """UPDATE race
               SET status_id = (SELECT id FROM race_statuses WHERE status_code = 'CONFIRMED'),
                   event = NULL,
                   confirmed_at = NOW(), confirmed_by = %s, updated_at = NOW()
               WHERE id = %s""",
            (user_id, race_id),
        )
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="CONFIRMED", to_sub_status=None,
                       user_id=user_id, reason="データ確定")
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "CONFIRMED", "event": None})
        conn.commit()
    return get_race(race_id)


# ── Correction session endpoints ────────────────────────────────────────────────────────

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

        # Check race exists & fetch current state in one query
        old_state = _get_status_state(cur, race_id)
        if not old_state:
            raise HTTPException(status_code=404, detail="Race not found")

        # Set ANALYZED + EDITING
        _set_status(cur, race_id, "ANALYZED", "EDITING")
        _write_history(cur, race_id,
                       from_status=old_state["status_code"], from_sub_status=old_state["event"],
                       to_status="ANALYZED", to_sub_status="EDITING",
                       user_id=user_id, reason=f"{user_name} が補正開始",
                       metadata={"started_by": user_name})
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old_state["status_code"], "event": old_state["event"]},
                     {"status_code": "ANALYZED", "event": "EDITING", "started_by": user_name})

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
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE correction_session SET completed_at = NOW(), status = 'COMPLETED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
            (race_id,),
        )
        _set_status(cur, race_id, "IN_REVIEW")
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="IN_REVIEW", to_sub_status=None,
                       user_id=user_id, reason="補正完了・レビュー待ち")
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "IN_REVIEW", "event": None})
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
            old = _get_status_state(cur, race_id) or {"status_code": None, "event": None}
            cur.execute(
                "UPDATE correction_session SET completed_at = NOW(), status = 'REVERTED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
                (race_id,),
            )
            # Revert to ANALYZED (clean state, no event)
            _set_status(cur, race_id, "ANALYZED")
            user_id = _get_sys_user(cur)
            _write_history(cur, race_id,
                           from_status=old["status_code"], from_sub_status=old["event"],
                           to_status="ANALYZED", to_sub_status=None,
                           user_id=user_id, reason="一時保存して編集中断")
            _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                         {"status_code": old["status_code"], "event": old["event"]},
                         {"status_code": "ANALYZED", "event": None, "reason": "temp-save exit"})
        else:
            cur.execute("UPDATE race SET updated_at = NOW() WHERE id = %s", (race_id,))

        conn.commit()
    return get_race(race_id)


CANONICAL_STATUS_CODES = {
    "WAITING", "ANALYZING", "ANALYZED", "IN_REVIEW", "NEEDS_ATTENTION", "CONFIRMED",
}


@router.post("/races/{race_id}/corrections/cancel")
def cancel_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE correction_session SET completed_at = NOW(), status = 'REVERTED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
            (race_id,),
        )
        # Revert to ANALYZED (clean state)
        _set_status(cur, race_id, "ANALYZED")
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="ANALYZED", to_sub_status=None,
                       user_id=user_id, reason="補正キャンセル")
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "ANALYZED", "event": None, "reason": "correction cancelled"})
        conn.commit()
    return get_race(race_id)


@router.post("/races/{race_id}/force-unlock")
def force_unlock(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        old = _get_status_state(cur, race_id)
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE correction_session SET completed_at = NOW(), status = 'REVERTED' WHERE race_id = %s AND status = 'IN_PROGRESS'",
            (race_id,),
        )
        _set_status(cur, race_id, "ANALYZED")
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="ANALYZED", to_sub_status=None,
                       user_id=user_id, reason="管理者による強制ロック解除")
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "ANALYZED", "event": None, "reason": "force-unlock by admin"})
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


def _auto_update_video_status(cur, video_id: str, video_goal_time, preset_id) -> None:
    """No-op: video status (UNLINKED/LINKED) is managed manually, not auto-derived from analysis options."""
    pass


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
        _auto_update_video_status(cur, video_id, video_goal_time, preset_id)
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
        cur.execute("SELECT status_id FROM race WHERE id = %s::uuid", (race_id,))
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
