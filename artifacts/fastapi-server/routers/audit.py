from fastapi import APIRouter, Query
from typing import Optional
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


@router.get("/audit-logs")
def get_audit_logs(
    race_id: Optional[str] = Query(None),
    target_table: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where = []
        params = []
        if race_id:
            where.append("al.target_id = %s")
            params.append(race_id)
        if target_table:
            where.append("al.target_table = %s")
            params.append(target_table)
        if action:
            where.append("al.action = %s")
            params.append(action)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        params += [limit, offset]
        cur.execute(
            f"""SELECT al.id::text, al.user_id::text,
                       al.action, al.target_table, al.target_id,
                       al.old_value, al.new_value, al.ip_address,
                       al.created_at::text
               FROM audit_log al
               {where_sql}
               ORDER BY al.created_at DESC
               LIMIT %s OFFSET %s""",
            params,
        )
        rows = cur.fetchall()
        return {
            "items": rows,
            "total": len(rows),
            "limit": limit,
            "offset": offset,
        }
