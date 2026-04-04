from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


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
            f"""SELECT id, race_id, checkpoint, horse_number, horse_name, gate_number,
                       color, lane, time_seconds::float, accuracy, position,
                       is_corrected, original_position
                FROM passing_orders
                WHERE race_id = %s{where_extra}
                ORDER BY position""",
            params,
        )
        return cur.fetchall()


@router.patch("/passing-orders/{id}")
def update_passing_order(id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id, position FROM passing_orders WHERE id = %s",
            (id,),
        )
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Passing order not found")

        allowed = {"position", "lane", "time_seconds"}
        updates = {k: v for k, v in body.items() if k in allowed and v is not None}

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
                WHERE id = %s RETURNING id, race_id, checkpoint, horse_number, horse_name,
                gate_number, color, lane, time_seconds::float, accuracy, position,
                is_corrected, original_position""",
            params,
        )
        return cur.fetchone()
