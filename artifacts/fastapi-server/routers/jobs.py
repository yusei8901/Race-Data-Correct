from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor
import uuid

router = APIRouter(prefix="/fastapi")


def fmt_job(row: dict) -> dict:
    return {
        "id": row["id"],
        "race_id": row.get("race_id"),
        "video_id": row.get("video_id"),
        "status": row["status"],
        "analysis_mode": row.get("analysis_mode"),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "error_message": row.get("error_message"),
        "parameters": row.get("parameters"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


@router.get("/races/{race_id}/analysis/jobs")
def list_analysis_jobs(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT aj.id::text, rv.race_id::text, aj.video_id::text,
                      aj.status, aj.analysis_mode, aj.started_at::text,
                      aj.completed_at::text, aj.error_message, aj.parameters,
                      aj.created_at::text, aj.updated_at::text
               FROM analysis_job aj
               JOIN race_video rv ON rv.id = aj.video_id
               WHERE rv.race_id = %s::uuid
               ORDER BY aj.created_at DESC""",
            (race_id,),
        )
        return [fmt_job(r) for r in cur.fetchall()]


@router.get("/races/{race_id}/analysis/jobs/{job_id}")
def get_analysis_job(race_id: str, job_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT aj.id::text, rv.race_id::text, aj.video_id::text,
                      aj.status, aj.analysis_mode, aj.started_at::text,
                      aj.completed_at::text, aj.error_message, aj.parameters,
                      aj.created_at::text, aj.updated_at::text
               FROM analysis_job aj
               JOIN race_video rv ON rv.id = aj.video_id
               WHERE aj.id = %s::uuid AND rv.race_id = %s::uuid""",
            (job_id, race_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
        return fmt_job(row)


@router.post("/races/{race_id}/analysis/jobs", status_code=201)
def create_analysis_job(race_id: str, body: dict = None):
    body = body or {}
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id::text FROM race_video WHERE race_id = %s::uuid LIMIT 1",
            (race_id,),
        )
        video = cur.fetchone()
        if not video:
            raise HTTPException(status_code=404, detail="No video found for race")
        job_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO analysis_job
                 (id, video_id, status, analysis_mode, parameters, created_at, updated_at)
               VALUES (%s, %s::uuid, 'PENDING', %s, %s, NOW(), NOW())
               RETURNING id::text, status, analysis_mode, created_at::text""",
            (job_id, video["id"],
             body.get("analysis_mode", "standard"),
             "{}"),
        )
        result = cur.fetchone()
        conn.commit()
        return {"id": result["id"], "race_id": race_id, "video_id": video["id"],
                "status": result["status"], "analysis_mode": result["analysis_mode"],
                "created_at": result["created_at"]}


@router.post("/races/{race_id}/analysis/reanalyze")
def reanalyze_race(race_id: str, body: dict = None):
    """再解析 — 新規 analysis_job として実行。旧 /races/{id}/reanalyze と同等。"""
    from routers.races import _get_sys_user, _write_history, _write_audit, get_race
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM race WHERE id = %s::uuid", (race_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Race not found")
        cur.execute(
            "UPDATE race SET status = 'ANALYZING', updated_at = NOW() WHERE id = %s::uuid",
            (race_id,),
        )
        user_id = _get_sys_user(cur)
        _write_history(cur, race_id, "ANALYZING", user_id)
        _write_audit(cur, user_id, "STATUS_CHANGE", "race", race_id,
                     {"status": old["status"]}, {"status": "ANALYZING"})
        conn.commit()
    return get_race(race_id)
