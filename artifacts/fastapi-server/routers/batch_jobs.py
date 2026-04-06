from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")

_TABLE_INIT = """
CREATE TABLE IF NOT EXISTS batch_job (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(100) NOT NULL,
    cron_expression varchar(50) NOT NULL,
    status      varchar(20)  NOT NULL DEFAULT '停止中',
    is_enabled  boolean      NOT NULL DEFAULT false,
    next_run_at timestamptz,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);
"""


def _ensure_table(conn):
    cur = dict_cursor(conn)
    cur.execute(_TABLE_INIT)
    conn.commit()


@router.get("/batch-jobs")
def get_batch_jobs():
    with get_db() as conn:
        _ensure_table(conn)
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT id, name, cron_expression, status, is_enabled,
                      next_run_at::text, created_at::text, updated_at::text
               FROM batch_job ORDER BY created_at"""
        )
        return cur.fetchall()


@router.post("/batch-jobs", status_code=201)
def create_batch_job(body: dict):
    name = body.get("name")
    cron = body.get("cron_expression")
    if not name or not cron:
        raise HTTPException(status_code=400, detail="name and cron_expression are required")
    is_enabled = bool(body.get("is_enabled", False))
    with get_db() as conn:
        _ensure_table(conn)
        cur = dict_cursor(conn)
        cur.execute(
            """INSERT INTO batch_job (name, cron_expression, status, is_enabled)
               VALUES (%s, %s, %s, %s)
               RETURNING id, name, cron_expression, status, is_enabled,
                         next_run_at::text, created_at::text, updated_at::text""",
            (name, cron, "有効" if is_enabled else "停止中", is_enabled),
        )
        conn.commit()
        return cur.fetchone()


@router.patch("/batch-jobs/{job_id}")
def update_batch_job(job_id: str, body: dict):
    allowed = {"name", "cron_expression", "is_enabled"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    if "is_enabled" in updates:
        updates["status"] = "有効" if updates["is_enabled"] else "停止中"
    set_clause = ", ".join(f"{k} = %s" for k in updates)
    params = list(updates.values()) + [job_id]
    with get_db() as conn:
        _ensure_table(conn)
        cur = dict_cursor(conn)
        cur.execute(
            f"""UPDATE batch_job SET {set_clause}, updated_at = NOW()
                WHERE id = %s
                RETURNING id, name, cron_expression, status, is_enabled,
                          next_run_at::text, created_at::text, updated_at::text""",
            params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Batch job not found")
        conn.commit()
        return row


@router.delete("/batch-jobs/{job_id}")
def delete_batch_job(job_id: str):
    with get_db() as conn:
        _ensure_table(conn)
        cur = dict_cursor(conn)
        cur.execute("DELETE FROM batch_job WHERE id = %s", (job_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Batch job not found")
        conn.commit()
        return {"message": "バッチジョブを削除しました"}


@router.patch("/batch-jobs/{job_id}/toggle")
def toggle_batch_job(job_id: str):
    with get_db() as conn:
        _ensure_table(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT is_enabled FROM batch_job WHERE id = %s", (job_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Batch job not found")
        new_enabled = not row["is_enabled"]
        new_status = "有効" if new_enabled else "停止中"
        cur.execute(
            """UPDATE batch_job SET is_enabled = %s, status = %s, updated_at = NOW()
               WHERE id = %s
               RETURNING id, name, cron_expression, status, is_enabled,
                         next_run_at::text, created_at::text, updated_at::text""",
            (new_enabled, new_status, job_id),
        )
        conn.commit()
        return cur.fetchone()
