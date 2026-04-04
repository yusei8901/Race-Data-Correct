from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


@router.get("/races")
def get_races(
    date: Optional[str] = Query(None),
    venue: Optional[str] = Query(None),
    race_type: Optional[str] = Query(None),
    video_status: Optional[str] = Query(None),
    analysis_status: Optional[str] = Query(None),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where_clauses = []
        params = []

        if date:
            where_clauses.append("race_date = %s")
            params.append(date)
        if venue:
            where_clauses.append("venue = %s")
            params.append(venue)
        if race_type:
            where_clauses.append("race_type = %s")
            params.append(race_type)
        if video_status:
            where_clauses.append("video_status = %s")
            params.append(video_status)
        if analysis_status:
            where_clauses.append("analysis_status = %s")
            params.append(analysis_status)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        cur.execute(
            f"""SELECT id, race_date::text, venue, race_type, race_number, race_name,
                       surface_type, distance, direction, weather, condition, start_time,
                       status, video_status, video_url, analysis_status, assigned_user,
                       updated_at::text, created_at::text
                FROM races {where_sql}
                ORDER BY venue, race_number""",
            params,
        )
        return cur.fetchall()


@router.get("/races/summary")
def get_race_summary(date: Optional[str] = Query(None)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where_sql = "WHERE race_date = %s" if date else ""
        params = [date] if date else []

        cur.execute(
            f"""SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = '補正完了') as completed,
                COUNT(*) FILTER (WHERE status = '補正中') as in_progress,
                COUNT(*) FILTER (WHERE status IN ('修正要求', 'データ補正')) as needs_correction,
                COUNT(*) FILTER (WHERE status = 'レビュー') as review
            FROM races {where_sql}""",
            params,
        )
        summary = dict(cur.fetchone())

        cur.execute(
            f"""SELECT venue, COUNT(*) as count FROM races {where_sql} GROUP BY venue ORDER BY venue""",
            params,
        )
        summary["by_venue"] = [{"venue": r["venue"], "count": r["count"]} for r in cur.fetchall()]
        return summary


@router.get("/races/{race_id}")
def get_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT id, race_date::text, venue, race_type, race_number, race_name,
                      surface_type, distance, direction, weather, condition, start_time,
                      status, video_status, video_url, analysis_status, assigned_user,
                      updated_at::text, created_at::text
               FROM races WHERE id = %s""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


@router.patch("/races/{race_id}")
def update_race(race_id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        allowed = {"status", "assigned_user", "video_status"}
        updates = {k: v for k, v in body.items() if k in allowed}
        if not updates:
            raise HTTPException(status_code=400, detail="No valid fields to update")

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        params = list(updates.values()) + [race_id]
        cur.execute(
            f"""UPDATE races SET {set_clause}, updated_at = NOW()
                WHERE id = %s RETURNING id, race_date::text, venue, race_type, race_number,
                race_name, surface_type, distance, direction, weather, condition, start_time,
                status, video_status, video_url, analysis_status, assigned_user,
                updated_at::text, created_at::text""",
            params,
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


@router.post("/races/{race_id}/reanalyze")
def reanalyze_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE races SET analysis_status = '解析中', updated_at = NOW() WHERE id = %s",
            (race_id,),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Race not found")
        return {"message": "再解析リクエストを送信しました"}


@router.post("/races/{race_id}/corrections/start")
def start_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """UPDATE races SET status = '補正中', updated_at = NOW()
               WHERE id = %s RETURNING id, race_date::text, venue, race_type, race_number,
               race_name, surface_type, distance, direction, weather, condition, start_time,
               status, video_status, video_url, analysis_status, assigned_user,
               updated_at::text, created_at::text""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


@router.post("/races/{race_id}/corrections/complete")
def complete_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """UPDATE races SET status = '補正完了', updated_at = NOW()
               WHERE id = %s RETURNING id, race_date::text, venue, race_type, race_number,
               race_name, surface_type, distance, direction, weather, condition, start_time,
               status, video_status, video_url, analysis_status, assigned_user,
               updated_at::text, created_at::text""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race
