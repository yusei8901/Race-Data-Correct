from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional, List
from database import get_db, dict_cursor
from auth import get_current_user_id, is_admin, require_admin, to_jst_str

router = APIRouter(prefix="/fastapi")


STATUS_LABEL = {
    "WAITING": "解析待ち", "ANALYZING": "解析中", "ANALYZED": "解析完了",
    "IN_REVIEW": "レビュー中", "CONFIRMED": "確定済み", "NEEDS_ATTENTION": "要対応",
}
SUB_STATUS_LABEL = {
    "EDITING": "補正中", "REVISION_REQUESTED": "修正要請あり",
    "ANALYSIS_FAILED": "解析失敗", "MATCH_FAILED": "突合失敗",
    "ANALYSIS_REQUESTED": "再解析要請あり",
}
VIDEO_STATUS_LABEL = {"UNLINK": "未連携", "LINKED": "連携済み", "LINK_FAILED": "連携失敗"}


def _available_actions(status: str, sub_status: Optional[str], user_id: int,
                       locked_by: Optional[int]) -> List[str]:
    admin = is_admin(user_id)
    actions: List[str] = ["OPEN_ANALYSIS_OPTION", "OPEN_HISTORY_COMMENT"]

    locked_by_me = locked_by is not None and locked_by == user_id
    locked_by_other = locked_by is not None and locked_by != user_id

    if admin:
        if sub_status in (None, "REVISION_REQUESTED"):
            if status in ("ANALYZED", "CONFIRMED"):
                actions += ["START_CORRECTION", "RUN_REANALYSIS", "RELINK_ANALYSIS_DATA"]
            elif status == "IN_REVIEW":
                actions += ["START_CORRECTION", "CONFIRM_DATA", "REQUEST_REVISION",
                            "RUN_REANALYSIS", "RELINK_ANALYSIS_DATA"]
        elif sub_status == "EDITING":
            if locked_by_me:
                actions += ["SAVE_DRAFT", "COMPLETE_CORRECTION", "CANCEL_CORRECTION"]
            elif locked_by_other:
                actions += ["FORCE_UNLOCK"]
        elif sub_status == "ANALYSIS_REQUESTED":
            actions += ["RUN_REANALYSIS"]
        elif sub_status == "MATCH_FAILED":
            actions += ["RELINK_ANALYSIS_DATA"]
        elif sub_status == "ANALYSIS_FAILED":
            actions += ["RUN_REANALYSIS"]
    else:
        if status == "ANALYZED":
            if sub_status in (None, "REVISION_REQUESTED"):
                actions += ["START_CORRECTION", "REQUEST_REANALYSIS", "REQUEST_LINKAGE"]
            elif sub_status == "EDITING" and locked_by_me:
                actions += ["SAVE_DRAFT", "COMPLETE_CORRECTION", "CANCEL_CORRECTION"]
        elif status == "NEEDS_ATTENTION":
            if sub_status == "MATCH_FAILED":
                actions += ["REQUEST_LINKAGE"]
            elif sub_status == "ANALYSIS_FAILED":
                actions += ["REQUEST_REANALYSIS"]

    return actions


def _race_name(row: dict) -> str:
    if row.get("race_title"):
        return row["race_title"]
    parts = [
        row.get("race_type_name") or "",
        row.get("race_condition_name") or "",
        row.get("race_symbol_name") or "",
    ]
    return "".join(p for p in parts if p) or "（レース名未登録）"


# ────────────────────────────────────────
# GET /races
# ────────────────────────────────────────
@router.get("/races")
def get_races(
    date: Optional[str] = Query(None),
    raceCategoryCode: Optional[str] = Query(None),
    venueCode: Optional[str] = Query(None),
    statusGroup: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    subStatus: Optional[str] = Query(None),
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where_clauses: List[str] = []
        params: List = []

        if date:
            where_clauses.append("ro.holding_date = %s")
            params.append(int(date.replace("-", "")))
        if raceCategoryCode:
            where_clauses.append("rc.code = %s")
            params.append(raceCategoryCode)
        if venueCode:
            where_clauses.append("ro.place_code = %s")
            params.append(venueCode)
        if status:
            where_clauses.append("ro.status = %s")
            params.append(status)
        if subStatus:
            where_clauses.append("ro.sub_status = %s")
            params.append(subStatus)
        if statusGroup == "UNCONFIRMED":
            where_clauses.append("ro.status NOT IN ('CONFIRMED','WAITING')")
        elif statusGroup == "CONFIRMED":
            where_clauses.append("ro.status = 'CONFIRMED'")
        elif statusGroup == "WAITING":
            where_clauses.append("ro.status = 'WAITING'")

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        cur.execute(f"""
            SELECT ro.race_id, ro.place_code, ro.race_number, ro.race_title,
                   ro.distance, ro.track_code, ro.status, ro.sub_status,
                   ro.holding_date, ro.corrected_by, ro.confirmed_by, ro.updated_at,
                   rv.short_name_2 AS venue_name,
                   rc.code AS race_category_code,
                   rt.name AS race_type_name,
                   rcond.name AS race_condition_name,
                   rsym.name AS race_symbol_name,
                   vid.status AS video_status,
                   (SELECT comment FROM race_comment
                    WHERE race_id = ro.race_id ORDER BY created_at DESC LIMIT 1) AS latest_comment
            FROM race_official ro
            LEFT JOIN race_venue rv ON rv.code = ro.place_code
            LEFT JOIN race_category rc ON rc.id = rv.category_id
            LEFT JOIN race_type rt ON rt.code = ro.race_type_code
            LEFT JOIN race_condition rcond ON rcond.code = ro.race_condition_code1
            LEFT JOIN race_symbol rsym ON rsym.code = ro.race_symbol_code
            LEFT JOIN LATERAL (
                SELECT status FROM race_video
                WHERE race_id = ro.race_id ORDER BY uploaded_at DESC LIMIT 1
            ) vid ON TRUE
            {where_sql}
            ORDER BY ro.holding_date DESC, ro.race_number ASC
        """, params)

        rows = cur.fetchall()
        items = []
        for r in rows:
            items.append({
                "raceId": r["race_id"],
                "venue": {"code": r["place_code"], "name": r["venue_name"] or r["place_code"]},
                "raceNumber": r["race_number"],
                "raceName": _race_name(r),
                "distance": r["distance"],
                "videoStatus": r["video_status"] or "UNLINK",
                "videoStatusLabel": VIDEO_STATUS_LABEL.get(r["video_status"] or "UNLINK", ""),
                "isSelectable": r["status"] in ("ANALYZED","IN_REVIEW","CONFIRMED","NEEDS_ATTENTION"),
                "status": r["status"],
                "statusLabel": STATUS_LABEL.get(r["status"], r["status"]),
                "subStatus": r["sub_status"],
                "subStatusLabel": SUB_STATUS_LABEL.get(r["sub_status"] or "", "") or None,
                "latestComment": r["latest_comment"],
                "updatedAt": to_jst_str(r["updated_at"]),
                "availableActions": ["DETAIL"],
            })

        return {"date": date, "raceCategoryCode": raceCategoryCode,
                "statusGroup": statusGroup, "items": items}


# ────────────────────────────────────────
# GET /races/{raceId}
# ────────────────────────────────────────
@router.get("/races/{race_id}")
def get_race(
    race_id: int,
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT ro.*, rv.name AS venue_name, rv.short_name_2 AS venue_short,
                   rc.code AS race_category_code,
                   rt.name AS race_type_name, rcond.name AS race_condition_name,
                   rsym.name AS race_symbol_name,
                   vid.id AS video_id, vid.status AS video_status,
                   lu.name AS locked_by_name, cu.name AS confirmed_by_name
            FROM race_official ro
            LEFT JOIN race_venue rv ON rv.code = ro.place_code
            LEFT JOIN race_category rc ON rc.id = rv.category_id
            LEFT JOIN race_type rt ON rt.code = ro.race_type_code
            LEFT JOIN race_condition rcond ON rcond.code = ro.race_condition_code1
            LEFT JOIN race_symbol rsym ON rsym.code = ro.race_symbol_code
            LEFT JOIN LATERAL (
                SELECT id, status FROM race_video
                WHERE race_id = ro.race_id ORDER BY uploaded_at DESC LIMIT 1
            ) vid ON TRUE
            LEFT JOIN "user" lu ON lu.id = ro.corrected_by
            LEFT JOIN "user" cu ON cu.id = ro.confirmed_by
            WHERE ro.race_id = %s
        """, [race_id])
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="レースが見つかりません")

        cur.execute("""
            SELECT COUNT(*) AS cnt FROM correction_result cr
            JOIN correction_session cs ON cr.session_id = cs.id
            WHERE cs.race_id = %s AND cr.result_type = 'COMPLETED'
        """, [race_id])
        has_correction = cur.fetchone()["cnt"] > 0

        actions = _available_actions(row["status"], row["sub_status"], user_id, row["corrected_by"])

        return {
            "raceId": row["race_id"],
            "basicInfo": {
                "holdingDate": str(row["holding_date"]) if row["holding_date"] else None,
                "placeCode": row["place_code"],
                "holdingTime": row["holding_time"],
                "holdingDay": row["holding_day"],
                "raceNumber": row["race_number"],
                "raceName": _race_name(row),
                "distance": row["distance"],
                "trackCode": row["track_code"],
                "weatherCode": row["weather_code"],
                "startTime": str(row["start_time"]) if row["start_time"] else None,
                "venue": {
                    "code": row["place_code"],
                    "name": row["venue_name"],
                    "shortName": row["venue_short"],
                },
            },
            "statusInfo": {
                "status": row["status"],
                "statusLabel": STATUS_LABEL.get(row["status"], row["status"]),
                "subStatus": row["sub_status"],
                "subStatusLabel": SUB_STATUS_LABEL.get(row["sub_status"] or "", "") or None,
            },
            "videoInfo": {
                "videoId": row["video_id"],
                "status": row["video_status"] or "UNLINK",
                "statusLabel": VIDEO_STATUS_LABEL.get(row["video_status"] or "UNLINK", ""),
                "playable": row["video_status"] == "LINKED",
            },
            "assigneeInfo": {
                "correctedBy": row["corrected_by"],
                "correctedByName": row["locked_by_name"],
                "correctedAt": to_jst_str(row["corrected_at"]),
                "confirmedBy": row["confirmed_by"],
                "confirmedByName": row["confirmed_by_name"],
                "confirmedAt": to_jst_str(row["confirmed_at"]),
            },
            "sectionNavigation": {"sectionKeys": ["PASSING_200", "STRAIGHT_700"]},
            "correctionSummary": {
                "currentCorrectionSessionId": row["current_correction_session_id"],
                "lockedBy": row["corrected_by"],
                "lockedByName": row["locked_by_name"],
                "hasCorrectionResult": has_correction,
                "currentAnalysisResultId": row["current_analysis_result_id"],
            },
            "availableActions": actions,
        }


# ────────────────────────────────────────
# GET /races/{raceId}/entries
# ────────────────────────────────────────
@router.get("/races/{race_id}/entries")
def get_race_entries(race_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_official WHERE race_id=%s", [race_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="レースが見つかりません")
        cur.execute("""
            SELECT orr.horse_number, orr.border_number, ohr.horse_name,
                   ohr.sex_code
            FROM official_race_result orr
            LEFT JOIN official_horse_reference ohr ON ohr.horse_id = orr.horse_id
            WHERE orr.race_id=%s ORDER BY orr.horse_number ASC
        """, [race_id])
        horses = []
        for h in cur.fetchall():
            horses.append({
                "horseNumber": h.get("horse_number"),
                "gateNumber": h.get("border_number"),
                "horseName": h.get("horse_name") or f"馬{h.get('horse_number')}",
                "sexCode": h.get("sex_code"),
            })
        if not horses:
            for i in range(1, 15):
                horses.append({"horseNumber": i, "gateNumber": i, "horseName": f"馬{i}", "sexCode": None})
        return {"raceId": race_id, "entries": horses}


# ────────────────────────────────────────
# GET /races/{raceId}/sections/{sectionKey}
# ────────────────────────────────────────
@router.get("/races/{race_id}/sections/{section_key:path}")
def get_race_section(race_id: int, section_key: str,
                     user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_official WHERE race_id=%s", [race_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="レースが見つかりません")

        cur.execute("""
            SELECT cr.correction_data FROM correction_result cr
            JOIN correction_session cs ON cr.session_id = cs.id
            WHERE cs.race_id=%s AND cr.result_type='COMPLETED'
            ORDER BY cr.corrected_at DESC LIMIT 1
        """, [race_id])
        corr = cur.fetchone()
        if corr and corr["correction_data"]:
            data = corr["correction_data"]
            sections = data if isinstance(data, list) else data.get("sections", [])
            rows = next(
                (s.get("rows", []) for s in sections if s.get("sectionKey") == section_key),
                []
            )
            return {"raceId": race_id, "sectionKey": section_key,
                    "dataSource": "CORRECTION", "rows": rows}

        cur.execute("""
            SELECT ard.* FROM analysis_result_detail ard
            JOIN analysis_result_header arh ON arh.id = ard.header_id
            WHERE arh.race_id=%s AND arh.is_current=TRUE
            ORDER BY ard.rank ASC NULLS LAST, ard.time_sec ASC
        """, [race_id])
        rows = []
        for d in cur.fetchall():
            rows.append({
                "rank": d["rank"],
                "passingTime": float(d["passing_time"]) if d["passing_time"] else None,
                "coursePosition": d["course_position"],
                "reliability": d["reliability"],
                "className": d["class_name"],
                "memo": None, "bbox": None, "mapping": None,
            })
        return {"raceId": race_id, "sectionKey": section_key,
                "dataSource": "ANALYSIS", "rows": rows}


# ────────────────────────────────────────
# GET /races/{raceId}/video
# ────────────────────────────────────────
@router.get("/races/{race_id}/video")
def get_race_video(race_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_official WHERE race_id=%s", [race_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="レースが見つかりません")
        cur.execute("""
            SELECT status, storage_path FROM race_video
            WHERE race_id=%s ORDER BY uploaded_at DESC LIMIT 1
        """, [race_id])
        vid = cur.fetchone()
        playable = vid and vid["status"] == "LINKED"
        return {
            "video": {
                "status": vid["status"] if vid else "UNLINK",
                "statusLabel": VIDEO_STATUS_LABEL.get(vid["status"] if vid else "UNLINK", ""),
                "playable": playable,
                "url": None,
                "expiresAt": None,
                "message": None if playable else "動画が連携されていません",
            },
            "meta": {"durationSec": None, "width": None, "height": None} if playable else None,
            "seekPoints": [],
        }


# ────────────────────────────────────────
# GET /races/{raceId}/history-summary
# ────────────────────────────────────────
@router.get("/races/{race_id}/history-summary")
def get_race_history_summary(race_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_official WHERE race_id=%s", [race_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="レースが見つかりません")

        timeline = []

        cur.execute("""
            SELECT h.*, u.name AS user_name FROM race_status_history h
            LEFT JOIN "user" u ON u.id = h.changed_by
            WHERE h.race_id=%s ORDER BY h.created_at ASC
        """, [race_id])
        for h in cur.fetchall():
            fl = STATUS_LABEL.get(h["from_status"] or "", h["from_status"] or "なし")
            tl = STATUS_LABEL.get(h["to_status"], h["to_status"])
            if h["from_sub_status"]:
                fl += f"/{SUB_STATUS_LABEL.get(h['from_sub_status'], h['from_sub_status'])}"
            if h["to_sub_status"]:
                tl += f"/{SUB_STATUS_LABEL.get(h['to_sub_status'], h['to_sub_status'])}"
            timeline.append({
                "eventType": "STATUS_CHANGE", "eventTypeLabel": "ステータス変更",
                "displayLabel": f"{fl} → {tl}",
                "summaryText": h["reason"],
                "executedAt": to_jst_str(h["created_at"]),
                "executedBy": {"id": h["changed_by"], "name": h["user_name"]},
                "fromStatus": h["from_status"], "fromSubStatus": h["from_sub_status"],
                "toStatus": h["to_status"], "toSubStatus": h["to_sub_status"],
            })

        cur.execute("""
            SELECT cr.id, cr.version, cr.result_type, cr.corrected_at, cr.summary_text,
                   u.name AS user_name, u.id AS user_id
            FROM correction_result cr
            JOIN correction_session cs ON cr.session_id=cs.id
            JOIN "user" u ON u.id=cr.corrected_by
            WHERE cs.race_id=%s ORDER BY cr.corrected_at ASC
        """, [race_id])
        for cr in cur.fetchall():
            label = "一時保存" if cr["result_type"] == "DRAFT" else "補正完了"
            timeline.append({
                "eventType": "CORRECTION", "eventTypeLabel": label,
                "displayLabel": cr["summary_text"] or label,
                "summaryText": cr["summary_text"],
                "executedAt": to_jst_str(cr["corrected_at"]),
                "executedBy": {"id": cr["user_id"], "name": cr["user_name"]},
                "correctionResultId": cr["id"], "version": cr["version"],
            })

        cur.execute("""
            SELECT c.id, c.comment_type, c.comment, c.created_at,
                   u.name AS user_name, u.id AS user_id
            FROM race_comment c
            JOIN "user" u ON u.id=c.created_by
            WHERE c.race_id=%s ORDER BY c.created_at ASC
        """, [race_id])
        for c in cur.fetchall():
            type_label = "修正要請" if c["comment_type"] == "REVISION_REQUEST" else "再解析要請"
            timeline.append({
                "eventType": "COMMENT", "eventTypeLabel": type_label,
                "displayLabel": c["comment"], "summaryText": c["comment"],
                "executedAt": to_jst_str(c["created_at"]),
                "executedBy": {"id": c["user_id"], "name": c["user_name"]},
                "commentId": c["id"], "commentType": c["comment_type"],
            })

        timeline.sort(key=lambda x: x["executedAt"] or "")
        return {"raceId": race_id, "summary": {"timelineCount": len(timeline)},
                "timeline": timeline}


# ────────────────────────────────────────
# GET /races/{raceId}/history
# POST /races/{raceId}/history
# ────────────────────────────────────────
@router.get("/races/{race_id}/history")
def get_race_history(race_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_official WHERE race_id=%s", [race_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="レースが見つかりません")
        cur.execute("""
            SELECT h.id, h.from_status, h.from_sub_status, h.to_status, h.to_sub_status,
                   h.reason, h.created_at, u.name AS user_name
            FROM race_status_history h
            LEFT JOIN "user" u ON u.id = h.changed_by
            WHERE h.race_id=%s ORDER BY h.created_at DESC LIMIT 50
        """, [race_id])
        rows = cur.fetchall()
        items = []
        for h in rows:
            items.append({
                "id": h["id"],
                "fromStatus": h["from_status"], "fromSubStatus": h["from_sub_status"],
                "toStatus": h["to_status"], "toSubStatus": h["to_sub_status"],
                "reason": h["reason"], "createdAt": to_jst_str(h["created_at"]),
                "userName": h["user_name"],
            })
        return {"raceId": race_id, "items": items, "total": len(items)}


@router.post("/races/{race_id}/history")
def add_race_history(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status, sub_status FROM race_official WHERE race_id=%s", [race_id])
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="レースが見つかりません")
        action_type = body.get("action_type") or body.get("actionType") or "操作"
        description = body.get("description") or ""
        cur.execute("""
            INSERT INTO race_status_history
              (race_id,from_status,from_sub_status,to_status,to_sub_status,reason,changed_by,created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())
            RETURNING id
        """, [race_id, row["status"], row["sub_status"], row["status"], row["sub_status"],
              f"{action_type}: {description}", user_id])
        conn.commit()
        return {"message": "履歴を記録しました"}


# ────────────────────────────────────────
# GET /races/{raceId}/official-results
# ────────────────────────────────────────
@router.get("/races/{race_id}/official-results")
def get_official_results(race_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_official WHERE race_id=%s", [race_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="レースが見つかりません")

        cur.execute("""
            SELECT orr.*, ohr.horse_name
            FROM official_race_result orr
            LEFT JOIN official_horse_reference ohr ON ohr.horse_id = orr.horse_id
            WHERE orr.race_id=%s ORDER BY orr.final_arrival_order ASC NULLS LAST
        """, [race_id])
        horses = []
        for h in cur.fetchall():
            horses.append({
                "finishPos": h.get("final_arrival_order"),
                "gateNumber": h.get("border_number"),
                "horseNumber": h.get("horse_number"),
                "horseName": h.get("horse_name"),
                "jockeyName": None,
                "finishTime": h.get("arrival_time"),
                "marginTime": h.get("gap_code"),
            })

        cur.execute("""
            SELECT raptime1, raptime2, raptime3, raptime4, raptime5,
                   raptime6, raptime7, raptime8, raptime9, raptime10,
                   raptime11, raptime12, raptime13, raptime14, raptime15
            FROM official_lead_furlong_time WHERE race_id=%s LIMIT 1
        """, [race_id])
        ft_row = cur.fetchone()
        lead_times = []
        if ft_row:
            for i in range(1, 16):
                val = ft_row.get(f"raptime{i}")
                if val is not None:
                    lead_times.append({"markerDistance": i * 200, "leadTime": val})

        return {"horses": horses, "leaderFurlongTimes": lead_times, "hasData": len(horses) > 0}


# ────────────────────────────────────────
# POST /races/bulk-status
# ────────────────────────────────────────
@router.post("/races/bulk-status")
def bulk_status(body: dict, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    race_ids = body.get("raceIds", [])
    to_status = body.get("toStatus")
    to_sub_status = body.get("toSubStatus")
    if not race_ids or not to_status:
        raise HTTPException(status_code=400, detail="raceIds と toStatus は必須です")

    success, failed = [], []
    with get_db() as conn:
        cur = dict_cursor(conn)
        for rid in race_ids:
            try:
                cur.execute("SELECT status, sub_status FROM race_official WHERE race_id=%s", [rid])
                row = cur.fetchone()
                if not row:
                    failed.append(rid); continue
                cur.execute(
                    "UPDATE race_official SET status=%s,sub_status=%s,updated_at=NOW() WHERE race_id=%s",
                    [to_status, to_sub_status, rid])
                cur.execute("""
                    INSERT INTO race_status_history
                      (race_id,from_status,from_sub_status,to_status,to_sub_status,reason,changed_by,created_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())
                """, [rid, row["status"], row["sub_status"], to_status, to_sub_status,
                      "一括ステータス変更", user_id])
                success.append(rid)
            except Exception:
                failed.append(rid)

    return {"resultStatus": "PARTIAL_SUCCESS" if failed else "SUCCESS",
            "successCount": len(success), "failureCount": len(failed),
            "failedRaceIds": failed}
