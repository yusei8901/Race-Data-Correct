from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor
import uuid
import csv
import io

router = APIRouter(prefix="/fastapi")


def fmt_export_job(row: dict) -> dict:
    return {
        "id": row["id"],
        "event_id": row.get("event_id"),
        "status": row["status"],
        "dataset": row.get("dataset"),
        "storage_path": row.get("storage_path"),
        "race_count": row.get("race_count"),
        "error_message": row.get("error_message"),
        "created_at": row.get("created_at"),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
    }


@router.get("/export-jobs/{job_id}")
def get_export_job(job_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT id::text, event_id::text, status, dataset, storage_path,
                      race_count, error_message,
                      created_at::text, started_at::text, completed_at::text
               FROM csv_export_job WHERE id = %s::uuid""",
            (job_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Export job not found")
        return fmt_export_job(row)


@router.get("/events/{event_id}/export/csv")
def export_event_csv_sync(
    event_id: str,
    dataset: str = Query("all", pattern="^(passing_points|straight_sections|all)$"),
):
    """同期 CSV 出力 — 小規模レース向け直接ダウンロード。"""
    from fastapi.responses import StreamingResponse
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_event WHERE id = %s::uuid", (event_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Event not found")

        output = io.StringIO()
        output.write("\ufeff")  # BOM for Excel

        if dataset in ("passing_points", "all"):
            cur.execute(
                """SELECT r.id AS race_id, r.race_number, r.race_name,
                          ard.horse_number,
                          ard.marker_type AS marker_distance,
                          ard.rank,
                          ard.time_sec AS passing_time,
                          ard.lane,
                          ard.special_note,
                          ard.is_corrected AS is_manually_corrected
                   FROM race r
                   JOIN analysis_result_header arh ON arh.race_id = r.id AND arh.is_current = TRUE
                   JOIN analysis_result_detail ard ON ard.header_id = arh.id
                   WHERE r.event_id = %s::uuid
                   ORDER BY r.race_number, ard.marker_type, ard.rank""",
                (event_id,),
            )
            rows = cur.fetchall()
            writer = csv.writer(output)
            writer.writerow(["race_id", "race_number", "race_name", "horse_number",
                             "marker_distance", "rank", "passing_time",
                             "lane_position", "special_note", "is_manually_corrected"])
            for row in rows:
                writer.writerow([
                    row["race_id"], row["race_number"], row["race_name"],
                    row["horse_number"], row["marker_distance"], row["rank"],
                    row["passing_time"], row["lane"], row["special_note"],
                    row["is_manually_corrected"],
                ])

        if dataset in ("straight_sections", "all"):
            if dataset == "all":
                output.write("\n")
            cur.execute(
                """SELECT r.id AS race_id, r.race_number, r.race_name,
                          ass.horse_number, ass.section_start_dist, ass.section_end_dist,
                          ass.section_avg_speed, ass.speed_diff, ass.lateral_position,
                          ass.is_corrected AS is_manually_corrected
                   FROM race r
                   JOIN analysis_result_header arh ON arh.race_id = r.id AND arh.is_current = TRUE
                   JOIN analysis_straight_section ass ON ass.header_id = arh.id
                   WHERE r.event_id = %s::uuid
                   ORDER BY r.race_number, ass.horse_number""",
                (event_id,),
            )
            rows = cur.fetchall()
            writer = csv.writer(output)
            writer.writerow(["race_id", "race_number", "race_name", "horse_number",
                             "section_start_dist", "section_end_dist",
                             "section_avg_speed", "speed_diff",
                             "lateral_position", "is_manually_corrected"])
            for row in rows:
                writer.writerow([
                    row["race_id"], row["race_number"], row["race_name"],
                    row["horse_number"], row["section_start_dist"],
                    row["section_end_dist"], row["section_avg_speed"],
                    row["speed_diff"], row["lateral_position"],
                    row["is_manually_corrected"],
                ])

    output.seek(0)
    return StreamingResponse(
        iter([output.read()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="event_{event_id[:8]}_{dataset}.csv"'},
    )


@router.post("/events/{event_id}/export/csv", status_code=202)
def export_event_csv_async(event_id: str, body: dict = None):
    """非同期エクスポートジョブを登録してジョブIDを返す。"""
    body = body or {}
    dataset = body.get("dataset", "all")
    if dataset not in ("passing_points", "straight_sections", "all"):
        raise HTTPException(status_code=422, detail="Invalid dataset")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_event WHERE id = %s::uuid", (event_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Event not found")
        cur.execute("SELECT COUNT(*) AS cnt FROM race WHERE event_id = %s::uuid", (event_id,))
        race_count = cur.fetchone()["cnt"]
        job_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO csv_export_job
                 (id, event_id, status, dataset, race_count, created_at)
               VALUES (%s, %s::uuid, 'PENDING', %s, %s, NOW())
               RETURNING id::text, status, dataset, race_count, created_at::text""",
            (job_id, event_id, dataset, race_count),
        )
        result = cur.fetchone()
        conn.commit()
        return {
            "job_id": result["id"],
            "status": result["status"],
            "dataset": result["dataset"],
            "race_count": result["race_count"],
            "created_at": result["created_at"],
        }
