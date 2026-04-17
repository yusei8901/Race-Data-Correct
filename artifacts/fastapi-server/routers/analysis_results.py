from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor
from routers.races import get_race, _get_sys_user, _write_history, _get_status_state, _write_audit

router = APIRouter(prefix="/fastapi")

CAP_COLOR_MAP = {1: '白', 2: '黒', 3: '赤', 4: '青', 5: '黄', 6: '緑', 7: '橙', 8: '桃'}


def _is_pts200_type(marker_type: str) -> bool:
    if marker_type == '5m':
        return True
    if not marker_type.endswith('m'):
        return False
    try:
        val = int(marker_type[:-1])
        return val > 0 and val % 200 == 0
    except ValueError:
        return False


def fmt_detail(row: dict, race_id: str) -> dict:
    return {
        "id": row["id"],
        "race_id": race_id,
        "checkpoint": row["marker_type"],
        "horse_number": row["horse_number"],
        "horse_name": row["horse_name"] or "",
        "gate_number": row.get("gate_number"),
        "color": row.get("color"),
        "lane": row.get("lane"),
        "time_seconds": row.get("time_sec"),
        "accuracy": row.get("accuracy"),
        "position": row.get("position") or row.get("rank") or 0,
        "is_corrected": row.get("is_corrected") or False,
        "original_position": None,
        "absolute_speed": row.get("absolute_speed"),
        "speed_change": row.get("speed_change"),
        "running_position": row.get("running_position"),
        "special_note": row.get("special_note"),
    }


def _get_current_header(cur, race_id: str) -> Optional[dict]:
    cur.execute(
        "SELECT id, horse_count FROM analysis_result_header WHERE race_id = %s AND is_current = TRUE LIMIT 1",
        (race_id,),
    )
    return cur.fetchone()


@router.get("/races/{race_id}/analysis-result")
def get_analysis_result(
    race_id: str,
    checkpoint: Optional[str] = Query(None),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        header = _get_current_header(cur, race_id)
        if not header:
            return {"header": None, "details": []}

        header_id = header["id"]
        extra_where = "AND ard.marker_type = %s" if checkpoint else ""
        params = [header_id] + ([checkpoint] if checkpoint else [])

        cur.execute(
            f"""SELECT ard.*
                FROM analysis_result_detail ard
                WHERE ard.header_id = %s {extra_where}
                ORDER BY ard.position, ard.rank""",
            params,
        )
        details = [fmt_detail(r, race_id) for r in cur.fetchall()]
        return {
            "header": {
                "id": str(header["id"]),
                "horse_count": header["horse_count"],
            },
            "details": details,
        }


# Legacy alias — keeps old passing-orders URLs working for the frontend
@router.get("/races/{race_id}/passing-orders")
def get_passing_orders(
    race_id: str,
    checkpoint: Optional[str] = Query(None),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        header = _get_current_header(cur, race_id)
        if not header:
            return []
        header_id = header["id"]
        extra_where = "AND ard.marker_type = %s" if checkpoint else ""
        params = [header_id] + ([checkpoint] if checkpoint else [])
        cur.execute(
            f"""SELECT ard.*
                FROM analysis_result_detail ard
                WHERE ard.header_id = %s {extra_where}
                ORDER BY ard.position, ard.rank""",
            params,
        )
        return [fmt_detail(r, race_id) for r in cur.fetchall()]


@router.get("/races/{race_id}/checkpoint-errors")
def get_checkpoint_errors(race_id: str):
    from collections import defaultdict
    with get_db() as conn:
        cur = dict_cursor(conn)
        header = _get_current_header(cur, race_id)
        if not header:
            return {}
        expected = header["horse_count"] or 14
        cur.execute(
            """SELECT marker_type, horse_number, gate_number, color, time_sec, lane,
                      absolute_speed, speed_change, running_position
               FROM analysis_result_detail
               WHERE header_id = %s""",
            (header["id"],),
        )
        rows = cur.fetchall()

        cp_rows: dict = defaultdict(list)
        for row in rows:
            cp_rows[row["marker_type"]].append(row)

        result = {}
        for cp, cp_row_list in cp_rows.items():
            row_count = len(cp_row_list)
            absent = max(0, expected - row_count)
            # Data-driven type detection: straight type if any row has speed/running_position
            has_speed = any(r["absolute_speed"] is not None or r["running_position"] is not None
                            for r in cp_row_list)
            has_lane = any(r["lane"] is not None for r in cp_row_list)
            if has_speed and not has_lane:
                is_200m = False
            elif has_lane and not has_speed:
                is_200m = True
            else:
                is_200m = _is_pts200_type(cp)

            times = [r["time_sec"] for r in cp_row_list if r["time_sec"] is not None]
            if times:
                s = sorted(times)
                n = len(s)
                median_time = (s[n // 2] + s[(n - 1) // 2]) / 2
            else:
                median_time = None

            missing_count = 0
            anomaly_count = 0
            for row in cp_row_list:
                is_missing = (
                    row["horse_number"] is None
                    or row["color"] is None
                    or row["time_sec"] is None
                    or (is_200m and row["lane"] is None)
                    or (not is_200m and (
                        row["absolute_speed"] is None
                        or row["speed_change"] is None
                        or row["running_position"] is None
                    ))
                )
                is_anomaly = False
                if row["gate_number"] is not None and row["color"] is not None:
                    if CAP_COLOR_MAP.get(row["gate_number"]) != row["color"]:
                        is_anomaly = True
                if row["time_sec"] is not None:
                    if row["time_sec"] > 300 or row["time_sec"] < 0.05:
                        is_anomaly = True
                    elif median_time is not None and abs(row["time_sec"] - median_time) >= 60:
                        is_anomaly = True
                if row["absolute_speed"] is not None:
                    if row["absolute_speed"] <= 30 or row["absolute_speed"] >= 80:
                        is_anomaly = True
                if row["running_position"] is not None:
                    if row["running_position"] <= 0 or row["running_position"] >= 16:
                        is_anomaly = True
                if is_missing:
                    missing_count += 1
                if is_anomaly:
                    anomaly_count += 1

            result[cp] = {"missing": missing_count + absent, "anomalies": anomaly_count}
        return result


@router.patch("/races/{race_id}/analysis-result/{detail_id}")
def update_analysis_detail(race_id: str, detail_id: str, body: dict):
    allowed = {"position", "lane", "time_seconds", "horse_number", "special_note",
               "accuracy", "absolute_speed", "speed_change", "running_position", "is_corrected"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    field_map = {"time_seconds": "time_sec"}
    set_clauses, params = [], []
    for field, value in updates.items():
        db_field = field_map.get(field, field)
        set_clauses.append(f"{db_field} = %s")
        params.append(value)
    params.append(detail_id)
    with get_db() as conn:
        cur = dict_cursor(conn)
        # Verify detail belongs to this race (via header → race ownership)
        cur.execute(
            """SELECT ard.id FROM analysis_result_detail ard
               JOIN analysis_result_header arh ON ard.header_id = arh.id
               WHERE ard.id = %s AND arh.race_id = %s""",
            (detail_id, race_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Detail row not found or does not belong to this race")
        cur.execute(
            f"UPDATE analysis_result_detail SET {', '.join(set_clauses)} WHERE id = %s RETURNING id",
            params,
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Detail row not found")
        conn.commit()
        cur.execute("SELECT * FROM analysis_result_detail WHERE id = %s", (detail_id,))
        updated = cur.fetchone()
        return fmt_detail(updated, race_id)


# Legacy alias — keeps old /passing-orders/{id} PATCH working
@router.patch("/passing-orders/{order_id}")
def update_passing_order(order_id: str, body: dict):
    allowed = {"position", "lane", "time_seconds", "horse_number", "special_note"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    field_map = {"time_seconds": "time_sec"}
    set_clauses, params = [], []
    for field, value in updates.items():
        db_field = field_map.get(field, field)
        set_clauses.append(f"{db_field} = %s")
        params.append(value)
    params.append(order_id)
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"UPDATE analysis_result_detail SET {', '.join(set_clauses)} WHERE id = %s RETURNING id",
            params,
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="PassingOrder not found")
        conn.commit()
        cur.execute("SELECT * FROM analysis_result_detail WHERE id = %s", (order_id,))
        updated = cur.fetchone()
        cur.execute("SELECT race_id FROM analysis_result_header WHERE id = %s", (updated["header_id"],))
        h = cur.fetchone()
        race_id = h["race_id"] if h else order_id
        return fmt_detail(updated, str(race_id))


# ── Bind analysis endpoints ───────────────────────────────────────────────────

@router.get("/races/{race_id}/available-analysis")
def get_available_analysis(race_id: str):
    """Return analysis result headers from OTHER races that are in ANALYZED status."""
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT
                   h.id,
                   h.created_at::text,
                   h.horse_count,
                   r.id AS source_race_id,
                   re.venue_name AS venue,
                   r.race_number,
                   r.race_name,
                   re.event_date::text AS race_date,
                   j.status AS job_status,
                   j.analysis_mode
               FROM analysis_result_header h
               JOIN race r ON h.race_id = r.id
               JOIN race_event re ON r.event_id = re.id
               JOIN analysis_job j ON h.job_id = j.id
               JOIN race_statuses rs ON rs.id = r.status_id
               WHERE rs.status_code = 'ANALYZED'
                 AND r.id != %s
                 AND h.is_current = TRUE
               ORDER BY h.created_at DESC""",
            (race_id,),
        )
        return cur.fetchall()


@router.post("/races/{race_id}/bind-analysis")
def bind_analysis(race_id: str, body: dict):
    """Copy analysis result header + details from a source header (another race) to this race."""
    source_header_id = body.get("source_header_id") or body.get("header_id")
    if not source_header_id:
        raise HTTPException(status_code=400, detail="source_header_id is required")
    with get_db() as conn:
        cur = dict_cursor(conn)

        cur.execute(
            "SELECT id, job_id, horse_count FROM analysis_result_header WHERE id = %s",
            (source_header_id,),
        )
        src_header = cur.fetchone()
        if not src_header:
            raise HTTPException(status_code=404, detail="Source analysis header not found")

        cur.execute(
            "UPDATE analysis_result_header SET is_current = FALSE WHERE race_id = %s",
            (race_id,),
        )
        cur.execute(
            """INSERT INTO analysis_result_header (id, job_id, race_id, is_current, horse_count, created_at, updated_at)
               VALUES (gen_random_uuid(), %s, %s, TRUE, %s, NOW(), NOW())
               RETURNING id""",
            (src_header["job_id"], race_id, src_header["horse_count"]),
        )
        new_header_id = cur.fetchone()["id"]

        cur.execute(
            """INSERT INTO analysis_result_detail (
                   id, header_id, time_sec, marker_type, class_name, course_position,
                   rank, race_time, corrected_time, data_type, section_no, centerline_dy,
                   corrected_speed, speed_kmh, horse_number, horse_name, gate_number, color,
                   lane, accuracy, position, is_corrected, original_position, absolute_speed,
                   speed_change, running_position, special_note, created_at
               )
               SELECT
                   gen_random_uuid(), %s, time_sec, marker_type, class_name, course_position,
                   rank, race_time, corrected_time, data_type, section_no, centerline_dy,
                   corrected_speed, speed_kmh, horse_number, horse_name, gate_number, color,
                   lane, accuracy, position, is_corrected, original_position, absolute_speed,
                   speed_change, running_position, special_note, NOW()
               FROM analysis_result_detail
               WHERE header_id = %s""",
            (new_header_id, source_header_id),
        )

        old = _get_status_state(cur, race_id) or {"status_code": None, "event": None}
        cur.execute(
            """UPDATE race
               SET status_id = (SELECT id FROM race_statuses WHERE status_code = 'ANALYZED'),
                   event = NULL,
                   updated_at = NOW()
               WHERE id = %s""",
            (race_id,),
        )

        user_id = _get_sys_user(cur)
        _write_history(cur, race_id,
                       from_status=old["status_code"], from_sub_status=old["event"],
                       to_status="ANALYZED", to_sub_status=None,
                       user_id=user_id, reason="解析結果バインド",
                       metadata={"bound_from_header": str(source_header_id),
                                 "new_header_id": str(new_header_id)})
        _write_audit(cur, user_id, "BIND_ANALYSIS", "race", race_id,
                     {"status_code": old["status_code"], "event": old["event"]},
                     {"status_code": "ANALYZED", "event": None,
                      "source_header_id": str(source_header_id),
                      "new_header_id": str(new_header_id)})
        conn.commit()

    return get_race(race_id)
