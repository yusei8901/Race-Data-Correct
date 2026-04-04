from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


def format_job(row):
    if row is None:
        return None
    r = dict(row)
    if r.get("next_run_at"):
        r["next_run_at"] = str(r["next_run_at"])
    if r.get("created_at"):
        r["created_at"] = str(r["created_at"])
    if r.get("updated_at"):
        r["updated_at"] = str(r["updated_at"])
    return r


@router.get("/batch-jobs")
def get_batch_jobs():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT id, name, cron_expression, status, is_enabled,
                      next_run_at::text, created_at::text, updated_at::text
               FROM batch_jobs ORDER BY created_at"""
        )
        return cur.fetchall()


@router.post("/batch-jobs", status_code=201)
def create_batch_job(body: dict):
    name = body.get("name")
    cron = body.get("cron_expression")
    is_enabled = body.get("is_enabled", False)

    if not name or not cron:
        raise HTTPException(status_code=400, detail="name and cron_expression are required")

    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """INSERT INTO batch_jobs (name, cron_expression, status, is_enabled)
               VALUES (%s, %s, %s, %s)
               RETURNING id, name, cron_expression, status, is_enabled,
                         next_run_at::text, created_at::text, updated_at::text""",
            (name, cron, "有効" if is_enabled else "停止中", is_enabled),
        )
        return cur.fetchone()


@router.patch("/batch-jobs/{id}")
def update_batch_job(id: str, body: dict):
    with get_db() as conn:
        cur = dict_cursor(conn)
        allowed = {"name", "cron_expression", "is_enabled"}
        updates = {k: v for k, v in body.items() if k in allowed and v is not None}

        if "is_enabled" in updates:
            updates["status"] = "有効" if updates["is_enabled"] else "停止中"

        if not updates:
            raise HTTPException(status_code=400, detail="No valid fields to update")

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        params = list(updates.values()) + [id]
        cur.execute(
            f"""UPDATE batch_jobs SET {set_clause}, updated_at = NOW()
                WHERE id = %s RETURNING id, name, cron_expression, status, is_enabled,
                next_run_at::text, created_at::text, updated_at::text""",
            params,
        )
        job = cur.fetchone()
        if not job:
            raise HTTPException(status_code=404, detail="Batch job not found")
        return job


@router.delete("/batch-jobs/{id}")
def delete_batch_job(id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("DELETE FROM batch_jobs WHERE id = %s", (id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Batch job not found")
        return {"message": "バッチジョブを削除しました"}


@router.patch("/batch-jobs/{id}/toggle")
def toggle_batch_job(id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT is_enabled FROM batch_jobs WHERE id = %s", (id,))
        job = cur.fetchone()
        if not job:
            raise HTTPException(status_code=404, detail="Batch job not found")

        new_enabled = not job["is_enabled"]
        new_status = "有効" if new_enabled else "停止中"
        cur.execute(
            """UPDATE batch_jobs SET is_enabled = %s, status = %s, updated_at = NOW()
               WHERE id = %s RETURNING id, name, cron_expression, status, is_enabled,
               next_run_at::text, created_at::text, updated_at::text""",
            (new_enabled, new_status, id),
        )
        return cur.fetchone()
