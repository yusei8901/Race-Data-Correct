from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")

ERROR_FILTER = """(
    (ard.time_sec IS NOT NULL AND (ard.time_sec > 300 OR ard.time_sec < 0.05))
    OR (ard.absolute_speed IS NOT NULL AND ard.absolute_speed > 80)
    OR (ard.speed_change IS NOT NULL AND ABS(ard.speed_change) > 30)
    OR (ard.accuracy IS NOT NULL AND ard.accuracy < 30)
)"""


def fmt_detail(row: dict, race_id: str) -> dict:
    return {
        "id": row["id"],
        "race_id": race_id,
        "checkpoint": row["marker_type"],
        "horse_number": row["horse_number"],
        "horse_name": row["horse_name"] or "",
        "gate_number": row["gate_number"] or 1,
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
    with get_db() as conn:
        cur = dict_cursor(conn)
        header = _get_current_header(cur, race_id)
        if not header:
            return {}
        expected = header["horse_count"] or 14
        cur.execute(
            f"""SELECT
                    ard.marker_type          AS checkpoint,
                    COUNT(*)                 AS row_count,
                    COUNT(*) FILTER (WHERE {ERROR_FILTER}) AS error_count
                FROM analysis_result_detail ard
                WHERE ard.header_id = %s
                GROUP BY ard.marker_type""",
            (header["id"],),
        )
        result = {}
        for row in cur.fetchall():
            cp = row["checkpoint"]
            missing = max(0, expected - row["row_count"])
            result[cp] = {"errors": row["error_count"], "missing": missing}
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
