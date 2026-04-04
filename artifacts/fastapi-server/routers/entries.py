from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


@router.get("/races/{race_id}/entries")
def get_race_entries(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT id, race_id, horse_number, gate_number, horse_name,
                      jockey_name, trainer_name,
                      last_3f::float, finish_time::float,
                      finish_position,
                      margin::float,
                      color, lane, furlong_splits
               FROM race_entries
               WHERE race_id = %s
               ORDER BY horse_number""",
            (race_id,),
        )
        return cur.fetchall()
