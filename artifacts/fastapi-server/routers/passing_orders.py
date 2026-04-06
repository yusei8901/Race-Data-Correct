from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")

RETURN_COLS = """id, race_id, checkpoint, horse_number, horse_name, gate_number,
                 color, lane, time_seconds::float, accuracy, position,
                 is_corrected, original_position, special_note,
                 running_position, absolute_speed::float, speed_change::float"""


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
        cur.execute(
            """SELECT checkpoint, COUNT(*) FILTER (
                WHERE time_seconds IS NULL
                   OR time_seconds > 300
                   OR time_seconds < 0.05
                   OR accuracy IS NOT NULL AND accuracy < 30
                   OR lane IS NULL
                   OR (absolute_speed IS NOT NULL AND absolute_speed > 80)
               ) AS error_count
               FROM passing_orders
               WHERE race_id = %s
               GROUP BY checkpoint""",
            (race_id,),
        )
        return {r["checkpoint"]: r["error_count"] for r in cur.fetchall()}


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
