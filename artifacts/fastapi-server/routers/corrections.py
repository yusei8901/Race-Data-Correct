"""
補正フロー API
POST /races/{raceId}/corrections/start
POST /races/{raceId}/corrections/draft
POST /races/{raceId}/corrections/complete
POST /races/{raceId}/corrections/cancel
POST /races/{raceId}/corrections/unlock
POST /races/{raceId}/corrections/heartbeat
POST /races/{raceId}/corrections/revert
POST /races/{raceId}/confirm
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from database import get_db, dict_cursor
from auth import get_current_user_id, is_admin, require_admin, to_jst_str

router = APIRouter(prefix="/fastapi")


def _get_race(cur, race_id: int) -> dict:
    cur.execute("SELECT * FROM race_official WHERE race_id=%s", [race_id])
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="レースが見つかりません")
    return row


def _write_status_history(cur, race_id, from_status, from_sub, to_status, to_sub, reason, user_id):
    cur.execute("""
        INSERT INTO race_status_history
          (race_id, from_status, from_sub_status, to_status, to_sub_status, reason, changed_by, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())
        RETURNING id
    """, [race_id, from_status, from_sub, to_status, to_sub, reason, user_id])
    return cur.fetchone()["id"]


def _write_audit(cur, user_id, action, table, target_id, old_val, new_val):
    import json
    cur.execute("""
        INSERT INTO audit_log (user_id, action, target_table, target_id, old_value, new_value, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,NOW())
    """, [user_id, action, table, target_id,
          json.dumps(old_val) if old_val else None,
          json.dumps(new_val) if new_val else None])


# ──────────────────────────────────────────
# POST /races/{raceId}/corrections/start
# ──────────────────────────────────────────
@router.post("/races/{race_id}/corrections/start")
def start_correction(race_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        # Check if already locked by someone else
        if race["corrected_by"] and race["corrected_by"] != user_id:
            cur.execute("SELECT name FROM \"user\" WHERE id=%s", [race["corrected_by"]])
            locker = cur.fetchone()
            raise HTTPException(
                status_code=409,
                detail=f"別のユーザー（{locker['name'] if locker else '不明'}）が補正中です"
            )

        # Get current analysis result
        if not race["current_analysis_result_id"]:
            raise HTTPException(status_code=409, detail="解析結果が存在しないため補正を開始できません")

        cur.execute("SELECT job_id FROM analysis_result_header WHERE id=%s",
                    [race["current_analysis_result_id"]])
        header = cur.fetchone()

        # Close any timed-out sessions
        cur.execute("""
            UPDATE correction_session SET status='TIMEOUT', updated_at=NOW()
            WHERE race_id=%s AND status='ACTIVE'
              AND last_heartbeat_at < NOW() - INTERVAL '30 minutes'
        """, [race_id])

        # Create new session
        cur.execute("""
            INSERT INTO correction_session
              (race_id, analysis_result_id, analysis_job_id, started_by,
               started_from_status, started_from_sub_status, status, started_at,
               last_heartbeat_at, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,'ACTIVE',NOW(),NOW(),NOW(),NOW())
            RETURNING id, started_at
        """, [race_id, race["current_analysis_result_id"],
              header["job_id"] if header else None,
              user_id, race["status"], race["sub_status"]])
        session = cur.fetchone()

        # Update race_official
        cur.execute("""
            UPDATE race_official
            SET status='ANALYZED', sub_status='EDITING',
                current_correction_session_id=%s,
                corrected_by=%s, corrected_at=NOW(), updated_at=NOW()
            WHERE race_id=%s
        """, [session["id"], user_id, race_id])

        _write_status_history(cur, race_id, race["status"], race["sub_status"],
                               "ANALYZED", "EDITING", "補正開始", user_id)
        _write_audit(cur, user_id, "UPDATE", "race_official", race["id"],
                     {"status": race["status"]}, {"status": "ANALYZED", "sub_status": "EDITING"})

        cur.execute("SELECT name FROM \"user\" WHERE id=%s", [user_id])
        uname = cur.fetchone()

        return {
            "sessionId": session["id"],
            "status": "ANALYZED",
            "subStatus": "EDITING",
            "lockedBy": {"id": user_id, "name": uname["name"] if uname else None},
            "startedAt": to_jst_str(session["started_at"]),
            "message": "補正を開始しました",
        }


# ──────────────────────────────────────────
# POST /races/{raceId}/corrections/draft
# ──────────────────────────────────────────
@router.post("/races/{race_id}/corrections/draft")
def save_draft(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    session_id = body.get("sessionId")
    save_mode = body.get("saveMode", "CONTINUE")  # CONTINUE or EXIT
    sections = body.get("sections", [])

    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        if not session_id:
            raise HTTPException(status_code=400, detail="sessionId は必須です")

        cur.execute("SELECT * FROM correction_session WHERE id=%s AND race_id=%s",
                    [session_id, race_id])
        session = cur.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="セッションが見つかりません")
        if session["status"] != "ACTIVE":
            raise HTTPException(status_code=409, detail="アクティブなセッションではありません")
        if session["started_by"] != user_id:
            raise HTTPException(status_code=403, detail="このセッションの操作権限がありません")

        # Get next version
        cur.execute("SELECT COALESCE(MAX(version),0)+1 AS nv FROM correction_result WHERE session_id=%s",
                    [session_id])
        version = cur.fetchone()["nv"]

        import json
        cur.execute("""
            INSERT INTO correction_result
              (session_id, version, result_type, corrected_by, corrected_at, summary_text, correction_data, created_at)
            VALUES (%s,%s,'DRAFT',%s,NOW(),%s,%s,NOW())
            RETURNING id, corrected_at
        """, [session_id, version, user_id, "一時保存", json.dumps({"sections": sections})])
        result = cur.fetchone()

        # Update heartbeat
        cur.execute("UPDATE correction_session SET last_heartbeat_at=NOW(), updated_at=NOW() WHERE id=%s",
                    [session_id])

        status = race["status"]
        sub_status = race["sub_status"]

        if save_mode == "EXIT":
            # Restore to pre-editing status
            back_status = session["started_from_status"]
            back_sub = session["started_from_sub_status"]
            cur.execute("""
                UPDATE race_official SET status=%s, sub_status=%s,
                  current_correction_session_id=NULL, corrected_by=NULL,
                  corrected_at=NULL, updated_at=NOW()
                WHERE race_id=%s
            """, [back_status, back_sub, race_id])
            _write_status_history(cur, race_id, status, sub_status,
                                   back_status, back_sub, "一時保存してEXIT", user_id)
            cur.execute("UPDATE correction_session SET status='PENDING', updated_at=NOW() WHERE id=%s",
                        [session_id])
            status, sub_status = back_status, back_sub

        return {
            "correctionResultId": result["id"],
            "sessionId": session_id,
            "version": version,
            "status": status,
            "subStatus": sub_status,
            "savedAt": to_jst_str(result["corrected_at"]),
            "saveMode": save_mode,
            "message": "保存しました",
        }


# ──────────────────────────────────────────
# POST /races/{raceId}/corrections/complete
# ──────────────────────────────────────────
@router.post("/races/{race_id}/corrections/complete")
def complete_correction(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    session_id = body.get("sessionId")
    complete_mode = body.get("completeMode", "REVIEW")  # REVIEW or CONFIRM (admin only)
    sections = body.get("sections", [])

    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        if not session_id:
            raise HTTPException(status_code=400, detail="sessionId は必須です")
        cur.execute("SELECT * FROM correction_session WHERE id=%s AND race_id=%s",
                    [session_id, race_id])
        session = cur.fetchone()
        if not session or session["status"] != "ACTIVE":
            raise HTTPException(status_code=409, detail="アクティブなセッションではありません")
        if session["started_by"] != user_id:
            raise HTTPException(status_code=403, detail="このセッションの操作権限がありません")

        if complete_mode == "CONFIRM" and not is_admin(user_id):
            raise HTTPException(status_code=403, detail="管理者のみ直接確定できます")

        cur.execute("SELECT COALESCE(MAX(version),0)+1 AS nv FROM correction_result WHERE session_id=%s",
                    [session_id])
        version = cur.fetchone()["nv"]

        import json
        cur.execute("""
            INSERT INTO correction_result
              (session_id, version, result_type, corrected_by, corrected_at, summary_text, correction_data, created_at)
            VALUES (%s,%s,'COMPLETED',%s,NOW(),%s,%s,NOW())
            RETURNING id, corrected_at
        """, [session_id, version, user_id, "補正完了", json.dumps({"sections": sections})])
        result = cur.fetchone()

        # Close session
        cur.execute("""
            UPDATE correction_session SET status='COMPLETED', completed_at=NOW(), updated_at=NOW()
            WHERE id=%s
        """, [session_id])

        # Determine next status
        if complete_mode == "CONFIRM":
            next_status, next_sub = "CONFIRMED", None
            cur.execute("""
                UPDATE race_official SET status=%s, sub_status=NULL,
                  current_correction_session_id=NULL, corrected_by=NULL, corrected_at=NULL,
                  confirmed_by=%s, confirmed_at=NOW(), updated_at=NOW()
                WHERE race_id=%s
            """, [next_status, user_id, race_id])
        else:
            next_status, next_sub = "IN_REVIEW", None
            cur.execute("""
                UPDATE race_official SET status=%s, sub_status=NULL,
                  current_correction_session_id=NULL, corrected_by=NULL,
                  corrected_at=NULL, updated_at=NOW()
                WHERE race_id=%s
            """, [next_status, race_id])

        _write_status_history(cur, race_id, race["status"], race["sub_status"],
                               next_status, next_sub, "補正完了", user_id)
        _write_audit(cur, user_id, "UPDATE", "race_official", race["id"],
                     {"status": race["status"]}, {"status": next_status})

        return {
            "correctionResultId": result["id"],
            "sessionId": session_id,
            "version": version,
            "status": next_status,
            "subStatus": next_sub,
            "completedAt": to_jst_str(result["corrected_at"]),
            "message": "補正を完了しました",
        }


# ──────────────────────────────────────────
# POST /races/{raceId}/corrections/cancel
# ──────────────────────────────────────────
@router.post("/races/{race_id}/corrections/cancel")
def cancel_correction(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    session_id = body.get("sessionId")
    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        if not session_id:
            raise HTTPException(status_code=400, detail="sessionId は必須です")
        cur.execute("SELECT * FROM correction_session WHERE id=%s AND race_id=%s",
                    [session_id, race_id])
        session = cur.fetchone()
        if not session or session["status"] != "ACTIVE":
            raise HTTPException(status_code=409, detail="アクティブなセッションではありません")
        if session["started_by"] != user_id:
            raise HTTPException(status_code=403, detail="このセッションの操作権限がありません")

        back_status = session["started_from_status"]
        back_sub = session["started_from_sub_status"]

        cur.execute("""
            UPDATE correction_session SET status='COMPLETED', completed_at=NOW(), updated_at=NOW()
            WHERE id=%s
        """, [session_id])
        cur.execute("""
            UPDATE race_official SET status=%s, sub_status=%s,
              current_correction_session_id=NULL, corrected_by=NULL,
              corrected_at=NULL, updated_at=NOW()
            WHERE race_id=%s
        """, [back_status, back_sub, race_id])

        _write_status_history(cur, race_id, race["status"], race["sub_status"],
                               back_status, back_sub, "補正キャンセル", user_id)

        return {
            "sessionId": session_id,
            "status": back_status,
            "subStatus": back_sub,
            "cancelledAt": to_jst_str(None),
            "message": "補正をキャンセルしました",
        }


# ──────────────────────────────────────────
# POST /races/{raceId}/corrections/unlock
# ──────────────────────────────────────────
@router.post("/races/{race_id}/corrections/unlock")
def force_unlock(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    session_id = body.get("sessionId")
    reason = body.get("reason", "強制ロック解除")

    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        if session_id:
            cur.execute("SELECT * FROM correction_session WHERE id=%s AND race_id=%s",
                        [session_id, race_id])
            session = cur.fetchone()
            if session:
                back_status = session["started_from_status"]
                back_sub = session["started_from_sub_status"]
                cur.execute("""
                    UPDATE correction_session SET status='COMPLETED', completed_at=NOW(), updated_at=NOW()
                    WHERE id=%s
                """, [session_id])
            else:
                back_status = race["status"]
                back_sub = None
        else:
            back_status = "ANALYZED"
            back_sub = None

        cur.execute("""
            UPDATE race_official SET sub_status=NULL,
              current_correction_session_id=NULL, corrected_by=NULL,
              corrected_at=NULL, updated_at=NOW()
            WHERE race_id=%s
        """, [race_id])
        _write_status_history(cur, race_id, race["status"], race["sub_status"],
                               race["status"], None, reason, user_id)

        import datetime
        return {
            "raceId": race_id, "sessionId": session_id,
            "status": race["status"], "subStatus": None,
            "unlockedAt": to_jst_str(datetime.datetime.utcnow()),
            "message": "ロックを解除しました",
        }


# ──────────────────────────────────────────
# POST /races/{raceId}/corrections/heartbeat
# ──────────────────────────────────────────
@router.post("/races/{race_id}/corrections/heartbeat")
def heartbeat(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    session_id = body.get("sessionId")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_official WHERE race_id=%s", [race_id])
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="レースが見つかりません")

        cur.execute("SELECT * FROM correction_session WHERE id=%s AND race_id=%s",
                    [session_id, race_id])
        session = cur.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="セッションが見つかりません")
        if session["status"] != "ACTIVE":
            raise HTTPException(status_code=409, detail="アクティブなセッションではありません")
        if session["started_by"] != user_id:
            raise HTTPException(status_code=403, detail="操作権限がありません")

        cur.execute("""
            UPDATE correction_session SET last_heartbeat_at=NOW(), updated_at=NOW()
            WHERE id=%s RETURNING last_heartbeat_at
        """, [session_id])
        updated = cur.fetchone()

        return {
            "raceId": race_id, "sessionId": session_id,
            "status": "ACTIVE",
            "lastHeartbeatAt": to_jst_str(updated["last_heartbeat_at"]),
            "message": "ハートビートを更新しました",
        }


# ──────────────────────────────────────────
# POST /races/{raceId}/corrections/revert  (差し戻し)
# ──────────────────────────────────────────
@router.post("/races/{race_id}/corrections/revert")
def revert_correction(race_id: int, body: dict, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    comment_text = body.get("comment", "")

    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        if race["status"] != "IN_REVIEW" or race["sub_status"] is not None:
            raise HTTPException(status_code=409,
                                detail="IN_REVIEW のレースのみ差し戻しできます")

        # Write comment
        cur.execute("""
            INSERT INTO race_comment (race_id, comment_type, comment, created_by, created_at)
            VALUES (%s,'REVISION_REQUEST',%s,%s,NOW())
            RETURNING id, created_at
        """, [race_id, comment_text, user_id])
        comment = cur.fetchone()

        # Update status
        cur.execute("""
            UPDATE race_official SET status='ANALYZED', sub_status='REVISION_REQUESTED',
              updated_at=NOW()
            WHERE race_id=%s
        """, [race_id])
        _write_status_history(cur, race_id, "IN_REVIEW", None,
                               "ANALYZED", "REVISION_REQUESTED", "差し戻し", user_id)
        _write_audit(cur, user_id, "REVISION_REJECT", "race_official", race["id"],
                     {"status": "IN_REVIEW"}, {"status": "ANALYZED", "sub_status": "REVISION_REQUESTED"})

        return {
            "raceId": race_id, "status": "ANALYZED", "subStatus": "REVISION_REQUESTED",
            "commentId": comment["id"],
            "revertedAt": to_jst_str(comment["created_at"]),
            "message": "差し戻しました",
        }


# ──────────────────────────────────────────
# POST /races/{raceId}/confirm
# ──────────────────────────────────────────
@router.post("/races/{race_id}/confirm")
def confirm_race(race_id: int, user_id: int = Depends(get_current_user_id)):
    require_admin(user_id)
    with get_db() as conn:
        cur = dict_cursor(conn)
        race = _get_race(cur, race_id)

        if race["status"] != "IN_REVIEW" or race["sub_status"] is not None:
            raise HTTPException(status_code=409, detail="IN_REVIEW のレースのみ確定できます")

        cur.execute("""
            UPDATE race_official SET status='CONFIRMED', sub_status=NULL,
              confirmed_by=%s, confirmed_at=NOW(), updated_at=NOW()
            WHERE race_id=%s
        """, [user_id, race_id])
        _write_status_history(cur, race_id, "IN_REVIEW", None,
                               "CONFIRMED", None, "管理者確定", user_id)
        _write_audit(cur, user_id, "CONFIRM", "race_official", race["id"],
                     {"status": "IN_REVIEW"}, {"status": "CONFIRMED"})

        cur.execute("SELECT confirmed_at FROM race_official WHERE race_id=%s", [race_id])
        updated = cur.fetchone()
        cur.execute("SELECT name FROM \"user\" WHERE id=%s", [user_id])
        uname = cur.fetchone()

        return {
            "raceId": race_id, "status": "CONFIRMED", "subStatus": None,
            "confirmedAt": to_jst_str(updated["confirmed_at"]),
            "confirmedBy": {"id": user_id, "name": uname["name"] if uname else None},
            "message": "確定しました",
        }
