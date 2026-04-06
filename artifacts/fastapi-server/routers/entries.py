from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


@router.get("/races/{race_id}/entries")
def get_race_entries(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)

        cur.execute(
            """SELECT ohr.id,
                      %s                       AS race_id,
                      ohr.horse_number,
                      ohr.frame_number         AS gate_number,
                      ohr.horse_name,
                      NULL::text               AS jockey_name,
                      NULL::text               AS trainer_name,
                      NULL::float8             AS last_3f,
                      ohr.finishing_time       AS finish_time,
                      ohr.finishing_order      AS finish_position,
                      NULL::float8             AS margin,
                      NULL::text               AS color,
                      NULL::text               AS lane
               FROM official_horse_reference ohr
               JOIN race_linkage_result rlr
                 ON ohr.official_race_id = rlr.official_race_id
               WHERE rlr.race_id = %s
               ORDER BY ohr.horse_number""",
            (race_id, race_id),
        )
        rows = cur.fetchall()
        if rows:
            return rows

        cur.execute(
            """SELECT ard.id,
                      %s                   AS race_id,
                      ard.horse_number,
                      ard.gate_number,
                      ard.horse_name,
                      NULL::text           AS jockey_name,
                      NULL::text           AS trainer_name,
                      NULL::float8         AS last_3f,
                      NULL::float8         AS finish_time,
                      NULL::int            AS finish_position,
                      NULL::float8         AS margin,
                      ard.color,
                      ard.lane
               FROM analysis_result_detail ard
               JOIN analysis_result_header arh ON ard.header_id = arh.id
               WHERE arh.race_id = %s AND arh.is_current = TRUE
               GROUP BY ard.id, ard.horse_number, ard.gate_number, ard.horse_name, ard.color, ard.lane
               ORDER BY ard.horse_number""",
            (race_id, race_id),
        )
        return cur.fetchall()
