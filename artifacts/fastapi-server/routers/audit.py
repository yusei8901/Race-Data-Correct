"""監査ログAPI - 管理者向け操作履歴の参照と古いログの自動削除"""
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi", tags=["audit"])


# ── アクション・対象テーブルのラベル定義 ─────────────────────────────────────────
ACTION_LABELS = {
    "STATUS_CHANGE": "ステータス変更",
    "BIND_ANALYSIS": "解析結果バインド",
    "REVISION_REJECT": "差し戻し",
    "CONFIRM": "データ確定",
    "BULK_STATUS": "一括ステータス更新",
    "CREATE": "新規作成",
    "UPDATE": "更新",
    "DELETE": "削除",
}

TARGET_TABLE_LABELS = {
    "race": "レース",
    "race_status_history": "ステータス履歴",
    "correction_session": "補正セッション",
    "correction_result": "補正結果",
    "race_video": "動画",
    "venue_weather_preset": "プリセット",
    "analysis_job": "解析ジョブ",
    "batch_job": "バッチジョブ",
}


def _cleanup_old_logs(cur, retention_days: int = 180) -> int:
    """6ヶ月（180日）より古いログを削除し、削除件数を返す"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    cur.execute("DELETE FROM audit_log WHERE created_at < %s", (cutoff,))
    return cur.rowcount


@router.get("/audit-logs")
def list_audit_logs(
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    user_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    target_table: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """監査ログ一覧（フィルター + ページネーション）"""
    where_clauses = []
    params: list = []

    if from_date:
        where_clauses.append("al.created_at >= %s")
        params.append(f"{from_date} 00:00:00+00")
    if to_date:
        # to_date は inclusive 扱い: 翌日 00:00 未満
        try:
            d = datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            raise HTTPException(status_code=400, detail="to_date は YYYY-MM-DD 形式")
        where_clauses.append("al.created_at < %s")
        params.append(d.strftime("%Y-%m-%d 00:00:00+00"))
    if user_id:
        where_clauses.append("al.user_id = %s")
        params.append(user_id)
    if action:
        where_clauses.append("al.action = %s")
        params.append(action)
    if target_table:
        where_clauses.append("al.target_table = %s")
        params.append(target_table)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    offset = (page - 1) * page_size

    with get_db() as conn:
        with dict_cursor(conn) as cur:
            # 6ヶ月超のログをクリーンアップ（リクエスト時遅延削除）
            deleted = _cleanup_old_logs(cur)

            # 件数
            cur.execute(
                f"SELECT COUNT(*) AS cnt FROM audit_log al {where_sql}",
                params,
            )
            total = cur.fetchone()["cnt"]

            # 本体
            cur.execute(
                f"""
                SELECT
                    al.id,
                    al.user_id,
                    u.name AS user_name,
                    u.email AS user_email,
                    al.action,
                    al.target_table,
                    al.target_id,
                    al.old_value,
                    al.new_value,
                    al.ip_address,
                    al.created_at
                FROM audit_log al
                LEFT JOIN "user" u ON u.id = al.user_id
                {where_sql}
                ORDER BY al.created_at DESC
                LIMIT %s OFFSET %s
                """,
                params + [page_size, offset],
            )
            rows = cur.fetchall()

            items = []
            for r in rows:
                items.append({
                    "id": str(r["id"]),
                    "user_id": str(r["user_id"]) if r["user_id"] else None,
                    "user_name": r["user_name"],
                    "user_email": r["user_email"],
                    "action": r["action"],
                    "action_label": ACTION_LABELS.get(r["action"], r["action"]),
                    "target_table": r["target_table"],
                    "target_table_label": TARGET_TABLE_LABELS.get(
                        r["target_table"], r["target_table"]
                    ),
                    "target_id": r["target_id"],
                    "old_value": r["old_value"],
                    "new_value": r["new_value"],
                    "ip_address": r["ip_address"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                })

            conn.commit()

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "cleaned_up": deleted,
    }


@router.get("/audit-logs/filters")
def get_audit_filter_options():
    """監査ログのフィルター候補（ユーザー一覧、アクション一覧、対象テーブル一覧）"""
    with get_db() as conn:
        with dict_cursor(conn) as cur:
            cur.execute('SELECT id, name, email FROM "user" ORDER BY name')
            users = [
                {"id": str(r["id"]), "name": r["name"], "email": r["email"]}
                for r in cur.fetchall()
            ]

            cur.execute(
                "SELECT DISTINCT action FROM audit_log ORDER BY action"
            )
            db_actions = [r["action"] for r in cur.fetchall()]

            cur.execute(
                "SELECT DISTINCT target_table FROM audit_log ORDER BY target_table"
            )
            db_tables = [r["target_table"] for r in cur.fetchall()]

    # 既知ラベル + DB に存在するアクション/テーブルをマージ
    actions = []
    seen = set()
    for code in list(ACTION_LABELS.keys()) + db_actions:
        if code in seen:
            continue
        seen.add(code)
        actions.append({"code": code, "label": ACTION_LABELS.get(code, code)})

    tables = []
    seen = set()
    for code in list(TARGET_TABLE_LABELS.keys()) + db_tables:
        if code in seen:
            continue
        seen.add(code)
        tables.append({"code": code, "label": TARGET_TABLE_LABELS.get(code, code)})

    return {"users": users, "actions": actions, "target_tables": tables}
