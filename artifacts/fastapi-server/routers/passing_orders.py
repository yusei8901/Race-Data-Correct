from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")

RETURN_COLS = """id, race_id, checkpoint, horse_number, horse_name, gate_number,
                 color, lane, time_seconds::float, accuracy, position,
                 is_corrected, original_position, special_note,
                 running_position, absolute_speed::float, speed_change::float"""

EXEMPT_NOTES = ('映像見切れ', '確認困難', '他馬と重複', '落馬', '失格')


@router.get("/races/{race_id}/passing-orders")
def get_passing_orders(race_id: str, checkpoint: Optional[str] = Query(None)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where_extra = ""
        params = [race_id]
        if checkpoint:
            where_extra = " AND checkpoint = %s"
            params.append(checkpoint)

        cur.execute(
            f"""SELECT {RETURN_COLS}
                FROM passing_orders
                WHERE race_id = %s{where_extra}
                ORDER BY position""",
            params,
        )
        return cur.fetchall()


@router.get("/races/{race_id}/checkpoint-errors")
def get_checkpoint_errors(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)

        # Total entry count for this race
        cur.execute("SELECT COUNT(*) AS total FROM race_entries WHERE race_id = %s", (race_id,))
        total_entries = cur.fetchone()["total"]

        # Error and present count per checkpoint
        # Errors: exempt rows with special_note in exempt list from error conditions
        cur.execute(
            """SELECT
                 po.checkpoint,
                 COUNT(*) AS present_count,
                 COUNT(*) FILTER (
                   WHERE po.special_note NOT IN %s
                     AND (
                       po.time_seconds IS NULL
                       OR po.time_seconds > 300
                       OR po.time_seconds < 0.05
                       OR (po.accuracy IS NOT NULL AND po.accuracy < 30)
                       OR po.lane IS NULL
                       OR (po.absolute_speed IS NOT NULL AND po.absolute_speed > 80)
                       OR (po.absolute_speed IS NOT NULL AND po.absolute_speed < 30)
                       OR (re.gate_number IS NOT NULL AND po.gate_number != re.gate_number)
                     )
                 ) AS error_count
               FROM passing_orders po
               LEFT JOIN race_entries re
                 ON re.race_id = po.race_id AND re.horse_number = po.horse_number
               WHERE po.race_id = %s
               GROUP BY po.checkpoint""",
            (EXEMPT_NOTES, race_id),
        )
        rows = cur.fetchall()
        result = {}
        for r in rows:
            missing = max(0, total_entries - r["present_count"])
            result[r["checkpoint"]] = {
                "errors": r["error_count"],
                "missing": missing,
            }
        return result


@router.patch("/passing-orders/{id}")
def update_passing_order(id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id, position, original_position FROM passing_orders WHERE id = %s",
            (id,),
        )
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Passing order not found")

        allowed = {"position", "lane", "time_seconds", "horse_number",
                   "special_note", "running_position", "gate_number", "color"}
        updates = {k: v for k, v in body.items() if k in allowed}

        if "position" in updates and updates["position"] != existing["position"]:
            updates["is_corrected"] = True
            if existing["original_position"] is None:
                updates["original_position"] = existing["position"]

        if not updates:
            raise HTTPException(status_code=400, detail="No valid fields to update")

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        params = list(updates.values()) + [id]
        cur.execute(
            f"""UPDATE passing_orders SET {set_clause}
                WHERE id = %s RETURNING {RETURN_COLS}""",
            params,
        )
        return cur.fetchone()
