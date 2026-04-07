from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


def _fmt_job(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "cron_expression": row["cron_expression"],
        "status": "有効" if row["is_enabled"] else "停止中",
        "is_enabled": row["is_enabled"],
        "next_run_at": row["next_run_at"].isoformat() if row["next_run_at"] else None,
        "created_at": row["created_at"].isoformat() if row["created_at"] else "",
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else "",
    }


@router.get("/batch-jobs")
def get_batch_jobs():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM batch_job ORDER BY created_at DESC")
        return [_fmt_job(r) for r in cur.fetchall()]


@router.post("/batch-jobs", status_code=201)
def create_batch_job(body: dict):
    name = body.get("name")
    cron_expression = body.get("cron_expression")
    is_enabled = body.get("is_enabled", False)
    if not name or not cron_expression:
        raise HTTPException(status_code=400, detail="name and cron_expression are required")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """INSERT INTO batch_job (name, cron_expression, is_enabled, status)
               VALUES (%s, %s, %s, %s)
               RETURNING *""",
            (name, cron_expression, is_enabled, "有効" if is_enabled else "停止中"),
        )
        row = cur.fetchone()
        conn.commit()
        return _fmt_job(row)


@router.patch("/batch-jobs/{job_id}")
def update_batch_job(job_id: str, body: dict):
    set_parts = ["updated_at = NOW()"]
    params: list = []
    if "name" in body and body["name"] is not None:
        set_parts.append("name = %s")
        params.append(body["name"])
    if "cron_expression" in body and body["cron_expression"] is not None:
        set_parts.append("cron_expression = %s")
        params.append(body["cron_expression"])
    if "is_enabled" in body and body["is_enabled"] is not None:
        set_parts.append("is_enabled = %s")
        params.append(body["is_enabled"])
        set_parts.append("status = %s")
        params.append("有効" if body["is_enabled"] else "停止中")
    params.append(job_id)
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            f"UPDATE batch_job SET {', '.join(set_parts)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Batch job not found")
        conn.commit()
        return _fmt_job(row)


@router.delete("/batch-jobs/{job_id}")
def delete_batch_job(job_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("DELETE FROM batch_job WHERE id = %s RETURNING id", (job_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Batch job not found")
        conn.commit()
        return {"message": "Deleted"}


@router.patch("/batch-jobs/{job_id}/toggle")
def toggle_batch_job(job_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM batch_job WHERE id = %s", (job_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Batch job not found")
        new_enabled = not row["is_enabled"]
        new_status = "有効" if new_enabled else "停止中"
        cur.execute(
            "UPDATE batch_job SET is_enabled = %s, status = %s, updated_at = NOW() WHERE id = %s RETURNING *",
            (new_enabled, new_status, job_id),
        )
        updated = cur.fetchone()
        conn.commit()
        return _fmt_job(updated)
