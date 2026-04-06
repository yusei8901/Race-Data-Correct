from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


@router.get("/races/{race_id}/history")
def get_race_history(race_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT
                   rsh.id,
                   COALESCE(u.name, '管理者') AS user_name,
                   rsh.status                 AS action_type,
                   rsh.metadata::text         AS description,
                   rsh.changed_at::text       AS created_at
               FROM race_status_history rsh
               LEFT JOIN "user" u ON rsh.changed_by = u.id
               WHERE rsh.race_id = %s
               ORDER BY rsh.changed_at DESC""",
            (race_id,),
        )
        rows = cur.fetchall()

        result = []
        for r in rows:
            desc = r.get("description")
            if desc and desc.startswith("{"):
                import json
                try:
                    meta = json.loads(desc)
                    desc = " / ".join(f"{k}: {v}" for k, v in meta.items() if v)
                except Exception:
                    pass
            result.append({
                "id": r["id"],
                "user_name": r["user_name"],
                "action_type": r["action_type"],
                "description": desc,
                "created_at": r["created_at"],
            })
        return result


@router.post("/races/{race_id}/history")
def add_race_history(race_id: str, body: dict):
    user_name = body.get("user_name", "システム")
    action_type = body.get("action_type", "")
    description = body.get("description", "")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute('SELECT id FROM "user" WHERE name = %s LIMIT 1', (user_name,))
        user_row = cur.fetchone()
        user_id = user_row["id"] if user_row else None

        import json
        cur.execute(
            """INSERT INTO race_status_history
               (id, race_id, status, changed_by, changed_at, metadata)
               VALUES (gen_random_uuid(), %s, %s, %s, NOW(), %s)
               RETURNING id""",
            (race_id, action_type, user_id,
             json.dumps({"description": description}) if description else "{}"),
        )
        row = cur.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "OK"}
