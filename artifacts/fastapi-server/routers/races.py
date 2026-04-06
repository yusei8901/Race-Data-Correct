from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")

RACE_COLUMNS = """id, race_date::text, venue, race_type, race_number, race_name,
    surface_type, distance, direction, weather, condition, start_time,
    status, video_status, video_url, analysis_status, assigned_user,
    locked_by, locked_at::text, reanalysis_reason, reanalysis_comment,
    correction_request_comment,
    updated_at::text, created_at::text"""


@router.get("/races/latest-date")
def get_latest_race_date():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT MAX(race_date)::text AS latest_date FROM races WHERE race_date IS NOT NULL")
        row = cur.fetchone()
        return {"date": row["latest_date"] if row else None}


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

        cur.execute(
            """UPDATE races SET status = '待機中', locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE status = '補正中' AND locked_at IS NOT NULL
               AND locked_at < NOW() - INTERVAL '30 minutes'"""
        )

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        cur.execute(
            f"SELECT {RACE_COLUMNS} FROM races {where_sql} ORDER BY venue, race_number",
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
                COUNT(*) FILTER (WHERE status = 'データ確定') as confirmed,
                COUNT(*) FILTER (WHERE status = '補正中') as in_progress,
                COUNT(*) FILTER (WHERE status = '待機中') as standby,
                COUNT(*) FILTER (WHERE status = 'レビュー待ち') as review,
                COUNT(*) FILTER (WHERE status = '修正要請') as correction_request,
                COUNT(*) FILTER (WHERE status = '再解析要請') as reanalysis_request,
                COUNT(*) FILTER (WHERE status = '突合失敗') as matching_failure,
                COUNT(*) FILTER (WHERE analysis_status = '解析中') as analyzing,
                COUNT(*) FILTER (WHERE analysis_status = '再解析中') as reanalyzing,
                COUNT(*) FILTER (WHERE analysis_status = '解析失敗') as analysis_failed
            FROM races {where_sql}""",
            params,
        )
        summary = dict(cur.fetchone())

        cur.execute(
            f"SELECT venue, COUNT(*) as count FROM races {where_sql} GROUP BY venue ORDER BY venue",
            params,
        )
        summary["by_venue"] = [{"venue": r["venue"], "count": r["count"]} for r in cur.fetchall()]
        return summary


class BatchUpdateBody(BaseModel):
    race_ids: List[str]
    status: str


@router.patch("/races/batch-update")
def batch_update_races(body: BatchUpdateBody):
    if not body.race_ids:
        raise HTTPException(status_code=400, detail="race_ids must not be empty")
    allowed_statuses = {"待機中", "補正中", "レビュー待ち", "修正要請", "データ確定"}
    if body.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "UPDATE races SET status = %s, updated_at = NOW() WHERE id = ANY(%s::uuid[])",
            (body.status, body.race_ids),
        )
        return {"updated": cur.rowcount}


@router.get("/races/{race_id}")
def get_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """UPDATE races SET status = '待機中', locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE id = %s AND status = '補正中' AND locked_at IS NOT NULL
               AND locked_at < NOW() - INTERVAL '30 minutes'""",
            (race_id,),
        )
        cur.execute(f"SELECT {RACE_COLUMNS} FROM races WHERE id = %s", (race_id,))
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


@router.get("/races/{race_id}/available-analysis")
def get_available_analysis(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT race_date, venue, distance, surface_type, race_number, race_name FROM races WHERE id = %s",
            (race_id,),
        )
        target = cur.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            """SELECT id, race_date::text AS date, venue, race_number, race_name,
                      distance, surface_type, analysis_status
               FROM races
               WHERE id != %s
                 AND race_date = %s
                 AND venue = %s
                 AND analysis_status = '完了'
               ORDER BY race_number""",
            (race_id, target["race_date"], target["venue"]),
        )
        rows = cur.fetchall()
        target_race_name = target["race_name"]
        return [
            {
                "id": r["id"],
                "label": f"{r['race_name']} (解析済み)",
                "date": r["date"],
                "venue": r["venue"],
                "race_number": r["race_number"],
                "race_name": r["race_name"],
                "distance": r["distance"],
                "surface_type": r["surface_type"],
                "same_venue": True,
                "mismatch": r["race_name"] != target_race_name,
            }
            for r in rows
        ]


@router.post("/races/{race_id}/complete-analysis")
def complete_analysis(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, analysis_status FROM races WHERE id = %s", (race_id,))
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        if race["analysis_status"] not in ("解析中", "再解析中"):
            raise HTTPException(status_code=400, detail="Race is not in analyzing state")
        cur.execute(
            """UPDATE races SET analysis_status = '完了', status = '待機中', updated_at = NOW()
               WHERE id = %s""",
            (race_id,),
        )
        conn.commit()
        return {"ok": True}


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
            f"UPDATE races SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING {RACE_COLUMNS}",
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


class StartCorrectionBody(BaseModel):
    user_name: str = "管理者"


@router.post("/races/{race_id}/corrections/start")
def start_correction(race_id: str, body: StartCorrectionBody = StartCorrectionBody()):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status, locked_by FROM races WHERE id = %s", (race_id,))
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        if race["status"] == "補正中" and race["locked_by"] and race["locked_by"] != body.user_name:
            raise HTTPException(status_code=409, detail=f"{race['locked_by']}が編集中です")
        cur.execute(
            f"""UPDATE races SET status = '補正中', locked_by = %s, locked_at = NOW(), updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (body.user_name, race_id),
        )
        return cur.fetchone()


@router.post("/races/{race_id}/corrections/complete")
def complete_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"""UPDATE races SET status = 'レビュー待ち', locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


class TempSaveBody(BaseModel):
    user_name: str = "管理者"
    exit_editing: bool = False


@router.post("/races/{race_id}/corrections/temp-save")
def temp_save_correction(race_id: str, body: TempSaveBody = TempSaveBody()):
    with get_db() as conn:
        cur = dict_cursor(conn)
        if body.exit_editing:
            cur.execute(
                f"""UPDATE races SET status = '待機中', locked_by = NULL, locked_at = NULL, updated_at = NOW()
                   WHERE id = %s RETURNING {RACE_COLUMNS}""",
                (race_id,),
            )
        else:
            cur.execute(
                f"UPDATE races SET updated_at = NOW() WHERE id = %s RETURNING {RACE_COLUMNS}",
                (race_id,),
            )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


@router.post("/races/{race_id}/corrections/cancel")
def cancel_correction(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"""UPDATE races SET status = '待機中', locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


@router.post("/races/{race_id}/force-unlock")
def force_unlock(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"""UPDATE races SET status = '待機中', locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


class ReanalysisRequestBody(BaseModel):
    reason: str
    comment: Optional[str] = None


@router.post("/races/{race_id}/reanalysis-request")
def request_reanalysis(race_id: str, body: ReanalysisRequestBody):
    if body.reason == "その他" and not body.comment:
        raise HTTPException(status_code=400, detail="「その他」を選択した場合はコメントが必須です")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"""UPDATE races SET status = '再解析要請', analysis_status = '解析失敗',
               reanalysis_reason = %s, reanalysis_comment = %s,
               locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (body.reason, body.comment, race_id),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


class MatchingFailureBody(BaseModel):
    user_name: str = "管理者"


@router.post("/races/{race_id}/matching-failure")
def report_matching_failure(race_id: str, body: MatchingFailureBody = MatchingFailureBody()):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"""UPDATE races SET status = '突合失敗', analysis_status = '突合失敗',
               locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


class CorrectionRequestBody(BaseModel):
    comment: str


@router.post("/races/{race_id}/correction-request")
def request_correction(race_id: str, body: CorrectionRequestBody):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"""UPDATE races SET status = '修正要請', correction_request_comment = %s,
               locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (body.comment, race_id),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


@router.post("/races/{race_id}/confirm")
def confirm_race(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"""UPDATE races SET status = 'データ確定', locked_by = NULL, locked_at = NULL, updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race


class DataBindingBody(BaseModel):
    analysis_data_id: str


@router.post("/races/{race_id}/bind-analysis")
def bind_analysis_data(race_id: str, body: DataBindingBody):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id FROM races WHERE id = %s AND analysis_status = '完了'",
            (body.analysis_data_id,),
        )
        source = cur.fetchone()
        if not source:
            raise HTTPException(status_code=400, detail="指定された解析データが見つかりません")

        cur.execute("DELETE FROM passing_orders WHERE race_id = %s", (race_id,))

        cur.execute(
            """INSERT INTO passing_orders
               (race_id, checkpoint, horse_number, gate_number, time_seconds, lane,
                accuracy, absolute_speed, speed_change, running_position, special_note,
                position, color, horse_name, is_corrected, original_position)
               SELECT %s, checkpoint, horse_number, gate_number, time_seconds, lane,
                accuracy, absolute_speed, speed_change, running_position, special_note,
                position, color, horse_name, false, original_position
               FROM passing_orders WHERE race_id = %s""",
            (race_id, body.analysis_data_id),
        )

        cur.execute(
            f"""UPDATE races SET status = '待機中', analysis_status = '完了',
               updated_at = NOW()
               WHERE id = %s RETURNING {RACE_COLUMNS}""",
            (race_id,),
        )
        race = cur.fetchone()
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        return race
