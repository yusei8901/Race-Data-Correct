"""
バッチジョブ・同期ジョブ・CSVエクスポート API
GET    /batch-jobs
GET    /batch-jobs/{jobId}
POST   /batch-jobs/{jobId}/run
POST   /race-sync-jobs
GET    /race-sync-jobs
POST   /csv-export-jobs
GET    /csv-export-jobs/{jobId}
"""
from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional
from database import get_db, dict_cursor
from auth import get_current_user_id, require_admin, to_jst_str

router = APIRouter(prefix="/fastapi")


# ────────────────────────────────────────
# GET /batch-jobs
# ────────────────────────────────────────
@router.get("/batch-jobs")
def list_batch_jobs(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT bj.id, bj.name, bj.target_type, bj.target_folder,
                   bj.schedule_type, bj.schedule_time, bj.enabled,
                   bj.created_at, bj.updated_at,
                   lr.id AS last_run_id, lr.status AS last_run_status,
                   lr.started_at AS last_run_started_at,
                   lr.completed_at AS last_run_completed_at,
                   lr.processed_count, lr.error_count
            FROM batch_job bj
            LEFT JOIN LATERAL (
                SELECT id, status, started_at, completed_at, processed_count, error_count
                FROM batch_job_run WHERE batch_job_id = bj.id
                ORDER BY created_at DESC LIMIT 1
            ) lr ON TRUE
            ORDER BY bj.id
        """)
        rows = cur.fetchall()
        return {
            "items": [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "targetType": r["target_type"],
                    "targetFolder": r["target_folder"],
                    "scheduleType": r["schedule_type"],
                    "scheduleTime": r["schedule_time"],
                    "enabled": r["enabled"],
                    "lastRun": {
                        "id": r["last_run_id"],
                        "status": r["last_run_status"],
                        "startedAt": to_jst_str(r["last_run_started_at"]),
                        "completedAt": to_jst_str(r["last_run_completed_at"]),
                        "processedCount": r["processed_count"],
                        "errorCount": r["error_count"],
                    } if r["last_run_id"] else None,
                    "updatedAt": to_jst_str(r["updated_at"]),
                }
                for r in rows
            ]
        }


# ────────────────────────────────────────
# GET /batch-jobs/{jobId}
# ────────────────────────────────────────
@router.get("/batch-jobs/{job_id}")
def get_batch_job(
    job_id: int,
    includeRuns: bool = Query(False),
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM batch_job WHERE id=%s", [job_id])
        job = cur.fetchone()
        if not job:
            raise HTTPException(status_code=404, detail="バッチジョブが見つかりません")

        runs = []
        if includeRuns:
            cur.execute("""
                SELECT id, trigger_type, status, started_at, completed_at,
                       pending_count, processed_count, error_count
                FROM batch_job_run WHERE batch_job_id=%s
                ORDER BY created_at DESC LIMIT 10
            """, [job_id])
            runs = [
                {
                    "id": r["id"],
                    "triggerType": r["trigger_type"],
                    "status": r["status"],
                    "startedAt": to_jst_str(r["started_at"]),
                    "completedAt": to_jst_str(r["completed_at"]),
                    "pendingCount": r["pending_count"],
                    "processedCount": r["processed_count"],
                    "errorCount": r["error_count"],
                }
                for r in cur.fetchall() or []
            ]

        return {
            "id": job["id"],
            "name": job["name"],
            "targetType": job["target_type"],
            "targetFolder": job["target_folder"],
            "scheduleType": job["schedule_type"],
            "scheduleTime": str(job["schedule_time"]) if job["schedule_time"] else None,
            "enabled": job["enabled"],
            "recentRuns": runs,
            "updatedAt": to_jst_str(job["updated_at"]),
        }


# ────────────────────────────────────────
# POST /batch-jobs/{jobId}/run
# ────────────────────────────────────────
@router.post("/batch-jobs/{job_id}/run")
def run_batch_job(
    job_id: int,
    body: dict = None,
    user_id: int = Depends(get_current_user_id),
):
    require_admin(user_id)
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM batch_job WHERE id=%s", [job_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="バッチジョブが見つかりません")

        cur.execute("""
            INSERT INTO batch_job_run (batch_job_id, trigger_type, status, started_at,
              pending_count, processed_count, error_count, created_at, updated_at)
            VALUES (%s,'MANUAL_REFRESH','RUNNING',NOW(),0,0,0,NOW(),NOW())
            RETURNING id, started_at
        """, [job_id])
        run = cur.fetchone()

        return {
            "runId": run["id"],
            "batchJobId": job_id,
            "status": "RUNNING",
            "startedAt": to_jst_str(run["started_at"]),
            "message": "バッチジョブを開始しました",
        }


# ────────────────────────────────────────
# POST /race-sync-jobs
# ────────────────────────────────────────
@router.post("/race-sync-jobs")
def create_sync_job(body: dict, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    holding_date = body.get("holdingDate")
    if not holding_date:
        raise HTTPException(status_code=400, detail="holdingDate は必須です")

    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            INSERT INTO race_sync_job (holding_date, status, triggered_by, created_at, updated_at)
            VALUES (%s,'PENDING',%s,NOW(),NOW())
            RETURNING id, created_at
        """, [holding_date, user_id])
        job = cur.fetchone()

        return {
            "syncJobId": job["id"],
            "holdingDate": holding_date,
            "status": "PENDING",
            "createdAt": to_jst_str(job["created_at"]),
            "message": "レース情報同期ジョブを作成しました",
        }


# ────────────────────────────────────────
# GET /race-sync-jobs
# ────────────────────────────────────────
@router.get("/race-sync-jobs")
def list_sync_jobs(
    limit: int = Query(20, ge=1, le=100),
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT rsj.id, rsj.holding_date, rsj.status, rsj.started_at,
                   rsj.completed_at, rsj.error_message, rsj.created_at,
                   u.name AS triggered_by_name
            FROM race_sync_job rsj
            LEFT JOIN "user" u ON u.id = rsj.triggered_by
            ORDER BY rsj.created_at DESC LIMIT %s
        """, [limit])
        rows = cur.fetchall()
        return {
            "items": [
                {
                    "syncJobId": r["id"],
                    "holdingDate": r["holding_date"],
                    "status": r["status"],
                    "startedAt": to_jst_str(r["started_at"]),
                    "completedAt": to_jst_str(r["completed_at"]),
                    "errorMessage": r["error_message"],
                    "triggeredBy": r["triggered_by_name"],
                    "createdAt": to_jst_str(r["created_at"]),
                }
                for r in rows
            ]
        }


# ────────────────────────────────────────
# POST /csv-export-jobs
# ────────────────────────────────────────
@router.post("/csv-export-jobs")
def create_csv_export(body: dict, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    from_date = body.get("fromDate")
    to_date = body.get("toDate")
    venue_codes = body.get("venueCodes", [])

    with get_db() as conn:
        cur = dict_cursor(conn)
        import json
        cur.execute("""
            INSERT INTO audit_log (user_id, action, target_table, target_id, new_value, created_at)
            VALUES (%s,'CSV_EXPORT','race_official',NULL,%s,NOW())
            RETURNING id, created_at
        """, [user_id, json.dumps({"fromDate": from_date, "toDate": to_date,
                                    "venueCodes": venue_codes})])
        row = cur.fetchone()
        return {
            "exportJobId": row["id"],
            "status": "PENDING",
            "createdAt": to_jst_str(row["created_at"]),
            "message": "CSVエクスポートジョブを作成しました（実装フェーズで実際のエクスポート連携）",
        }


# ────────────────────────────────────────
# GET /csv-export-jobs/{jobId}
# ────────────────────────────────────────
@router.get("/csv-export-jobs/{job_id}")
def get_csv_export(job_id: int, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    return {
        "exportJobId": job_id,
        "status": "PENDING",
        "downloadUrl": None,
        "message": "CSVエクスポートジョブ詳細（実装フェーズで実際の状態確認）",
    }
