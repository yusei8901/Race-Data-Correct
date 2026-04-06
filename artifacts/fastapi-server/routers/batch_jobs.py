from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/fastapi")

_jobs: dict = {}
_next_id = [1]


def _new_id():
    i = _next_id[0]
    _next_id[0] += 1
    return str(i)


@router.get("/batch-jobs")
def get_batch_jobs():
    return list(_jobs.values())


@router.post("/batch-jobs", status_code=201)
def create_batch_job(body: dict):
    name = body.get("name")
    cron = body.get("cron_expression")
    if not name or not cron:
        raise HTTPException(status_code=400, detail="name and cron_expression are required")
    job_id = _new_id()
    job = {
        "id": job_id,
        "name": name,
        "cron_expression": cron,
        "status": "有効" if body.get("is_enabled") else "停止中",
        "is_enabled": bool(body.get("is_enabled", False)),
        "next_run_at": None,
        "created_at": None,
        "updated_at": None,
    }
    _jobs[job_id] = job
    return job


@router.patch("/batch-jobs/{job_id}")
def update_batch_job(job_id: str, body: dict):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Batch job not found")
    for k in ("name", "cron_expression", "is_enabled"):
        if k in body:
            job[k] = body[k]
    if "is_enabled" in body:
        job["status"] = "有効" if body["is_enabled"] else "停止中"
    return job


@router.delete("/batch-jobs/{job_id}")
def delete_batch_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Batch job not found")
    del _jobs[job_id]
    return {"message": "バッチジョブを削除しました"}


@router.patch("/batch-jobs/{job_id}/toggle")
def toggle_batch_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Batch job not found")
    job["is_enabled"] = not job["is_enabled"]
    job["status"] = "有効" if job["is_enabled"] else "停止中"
    return job
