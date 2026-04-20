"""
解析オプション・解析実行・突合 API
GET/PUT  /races/{raceId}/analysis-option
POST     /races/{raceId}/analysis/request
POST     /races/{raceId}/analysis/reanalyze
POST     /races/{raceId}/linkage/request
GET      /races/{raceId}/linkage
POST     /races/{raceId}/linkage/retry
"""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db, dict_cursor
from auth import get_current_user_id, require_admin, to_jst_str

router = APIRouter(prefix="/fastapi")


def _get_race(cur, race_id: int) -> dict:
    cur.execute("SELECT * FROM race_official WHERE race_id=%s", [race_id])
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="レースが見つかりません")
    return row


def _write_history(cur, race_id, from_status, from_sub, to_status, to_sub, reason, user_id):
    cur.execute("""
        INSERT INTO race_status_history
          (race_id,from_status,from_sub_status,to_status,to_sub_status,reason,changed_by,created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())
    """, [race_id, from_status, from_sub, to_status, to_sub, reason, user_id])


# ──────────────────────────────────────────
# GET /races/{raceId}/analysis-option
# ──────────────────────────────────────────
@router.get("/races/{race_id}/analysis-option")
def get_analysis_option(race_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        _get_race(cur, race_id)
        cur.execute("""
            SELECT ao.id, ao.video_goal_time, ao.venue_weather_preset_id,
                   ao.updated_at, vwp.name AS preset_name, vwp.weather_preset_code
            FROM analysis_option ao
            LEFT JOIN venue_weather_preset vwp ON vwp.id = ao.venue_weather_preset_id
            WHERE ao.race_id = %s
            ORDER BY ao.updated_at DESC LIMIT 1
        """, [race_id])
        opt = cur.fetchone()
        if not opt:
            return {"raceId": race_id, "goalTime": None, "preset": None, "updatedAt": None}
        return {
            "raceId": race_id,
            "goalTime": float(opt["video_goal_time"]) if opt["video_goal_time"] else None,
            "preset": {"id": opt["venue_weather_preset_id"], "name": opt["preset_name"],
                       "code": opt["weather_preset_code"]} if opt["venue_weather_preset_id"] else None,
            "updatedAt": to_jst_str(opt["updated_at"]),
        }


# ──────────────────────────────────────────
# PUT /races/{raceId}/analysis-option
# ──────────────────────────────────────────
@router.put("/races/{race_id}/analysis-option")
def update_analysis_option(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    goal_time = body.get("goalTime")
    preset_id = body.get("preset")
    if isinstance(preset_id, dict):
        preset_id = preset_id.get("id")

    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        # Get latest video for this race
        cur.execute("SELECT id FROM race_video WHERE race_id=%s ORDER BY uploaded_at DESC LIMIT 1",
                    [race_id])
        vid = cur.fetchone()
        if not vid:
            raise HTTPException(status_code=409, detail="動画が存在しないため解析オプションを設定できません")

        cur.execute("""
            INSERT INTO analysis_option (race_id, video_id, venue_weather_preset_id, video_goal_time,
              created_at, updated_at)
            VALUES (%s,%s,%s,%s,NOW(),NOW())
            ON CONFLICT (video_id) DO UPDATE SET
              venue_weather_preset_id=EXCLUDED.venue_weather_preset_id,
              video_goal_time=EXCLUDED.video_goal_time,
              updated_at=NOW()
        """, [race_id, vid["id"], preset_id, goal_time])

        return {"message": "解析オプションを保存しました"}


# ──────────────────────────────────────────
# POST /races/{raceId}/analysis/request  (一般ユーザー: 再解析要請)
# ──────────────────────────────────────────
@router.post("/races/{race_id}/analysis/request")
def request_reanalysis(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    reason = body.get("reason", "")
    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        cur.execute("""
            INSERT INTO race_comment (race_id, comment_type, comment, created_by, created_at)
            VALUES (%s,'REANALYSIS_REQUEST',%s,%s,NOW())
        """, [race_id, reason, user_id])

        cur.execute("""
            UPDATE race_official SET status='NEEDS_ATTENTION', sub_status='ANALYSIS_REQUESTED',
              updated_at=NOW()
            WHERE race_id=%s
        """, [race_id])
        _write_history(cur, race_id, race["status"], race["sub_status"],
                       "NEEDS_ATTENTION", "ANALYSIS_REQUESTED", f"再解析要請: {reason}", user_id)

        return {"message": "再解析を要請しました"}


# ──────────────────────────────────────────
# POST /races/{raceId}/analysis/reanalyze  (管理者: 再解析実行)
# ──────────────────────────────────────────
@router.post("/races/{race_id}/analysis/reanalyze")
def run_reanalysis(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        cur.execute("SELECT id FROM race_video WHERE race_id=%s ORDER BY uploaded_at DESC LIMIT 1",
                    [race_id])
        vid = cur.fetchone()
        if not vid:
            raise HTTPException(status_code=409, detail="動画が存在しないため再解析できません")

        cur.execute("""
            INSERT INTO analysis_job (video_id, status, analysis_mode, created_at, updated_at)
            VALUES (%s,'PENDING','200m',NOW(),NOW())
            RETURNING id
        """, [vid["id"]])
        job = cur.fetchone()

        cur.execute("""
            UPDATE race_official SET status='ANALYZING', sub_status=NULL, updated_at=NOW()
            WHERE race_id=%s
        """, [race_id])
        _write_history(cur, race_id, race["status"], race["sub_status"],
                       "ANALYZING", None, "再解析開始", user_id)

        return {"jobId": job["id"], "message": "再解析ジョブを作成しました"}


# ──────────────────────────────────────────
# POST /races/{raceId}/linkage/request
# ──────────────────────────────────────────
@router.post("/races/{race_id}/linkage/request")
def request_linkage(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    comment_text = body.get("comment", "")
    with get_db() as conn:
        cur = dict_cursor(conn)
        _get_race(cur, race_id)
        cur.execute("""
            INSERT INTO race_comment (race_id, comment_type, comment, created_by, created_at)
            VALUES (%s,'REVISION_REQUEST',%s,%s,NOW())
        """, [race_id, comment_text, user_id])
        return {"message": "突合疑義を登録しました"}


# ──────────────────────────────────────────
# GET /races/{raceId}/linkage
# ──────────────────────────────────────────
@router.get("/races/{race_id}/linkage")
def get_linkage(race_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        _get_race(cur, race_id)

        cur.execute("""
            SELECT rlr.id AS result_id, rlr.section_key, rlr.linkage_status,
                   rlm.id AS mapping_id, rlm.detected_object_key, rlm.horse_number,
                   rlm.horse_id, rlm.mapping_status, rlm.mapping_source, rlm.confidence,
                   ohr.horse_name
            FROM race_linkage_result rlr
            LEFT JOIN race_linkage_mapping rlm ON rlm.linkage_result_id = rlr.id AND rlm.is_active=TRUE
            LEFT JOIN official_horse_reference ohr ON ohr.horse_id = rlm.horse_id
            WHERE rlr.race_id = %s
            ORDER BY rlr.section_key, rlm.horse_number
        """, [race_id])
        rows = cur.fetchall()

        sections = {}
        for r in rows:
            key = r["section_key"] or "UNKNOWN"
            if key not in sections:
                sections[key] = {"sectionKey": key, "rows": []}
            if r["mapping_id"]:
                sections[key]["rows"].append({
                    "className": r["detected_object_key"],
                    "horseNumber": r["horse_number"],
                    "horseName": r["horse_name"],
                    "status": r["mapping_status"],
                    "source": r["mapping_source"],
                    "confidence": float(r["confidence"]) if r["confidence"] else None,
                })

        return {"raceId": race_id, "sections": list(sections.values())}


# ──────────────────────────────────────────
# POST /races/{raceId}/linkage/retry
# ──────────────────────────────────────────
@router.post("/races/{race_id}/linkage/retry")
def retry_linkage(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    with get_db() as conn:
        cur = dict_cursor(conn)
        _get_race(cur, race_id)
        import json
        cur.execute("""
            INSERT INTO audit_log (user_id, action, target_table, target_id, new_value, created_at)
            VALUES (%s,'RELINK','race_official',(SELECT id FROM race_official WHERE race_id=%s),%s,NOW())
        """, [user_id, race_id, json.dumps({"race_id": race_id})])
        return {"message": "突合再実行を登録しました（実装フェーズで解析システム連携）"}
