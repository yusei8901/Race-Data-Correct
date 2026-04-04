from fastapi import APIRouter, HTTPException
from typing import Optional
from pydantic import BaseModel
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


@router.get("/races/{race_id}/history")
def get_correction_history(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT id, race_id, user_name, action_type, description,
                      created_at::text
               FROM correction_history
               WHERE race_id = %s
               ORDER BY created_at DESC""",
            (race_id,),
        )
        return cur.fetchall()


class HistoryEntry(BaseModel):
    user_name: str
    action_type: str
    description: Optional[str] = None


@router.post("/races/{race_id}/history")
def add_correction_history(race_id: str, body: HistoryEntry):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """INSERT INTO correction_history (race_id, user_name, action_type, description)
               VALUES (%s, %s, %s, %s)
               RETURNING id, race_id, user_name, action_type, description, created_at::text""",
            (race_id, body.user_name, body.action_type, body.description),
        )
        return cur.fetchone()
