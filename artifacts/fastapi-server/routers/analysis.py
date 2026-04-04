from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


@router.get("/venues")
def get_venues():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id::text, venue_id, name, race_type FROM venues ORDER BY race_type, name")
        return [{"id": r["venue_id"], "name": r["name"], "race_type": r["race_type"]} for r in cur.fetchall()]


@router.get("/analysis-params/{venue_id}")
def get_analysis_params(venue_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT venue_id, venue_name, race_type, params, updated_at::text
               FROM analysis_params WHERE venue_id = %s""",
            (venue_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Analysis params not found")
        return row


@router.patch("/analysis-params/{venue_id}")
def update_analysis_params(venue_id: str, body: dict):
    params = body.get("params")
    if params is None:
        raise HTTPException(status_code=400, detail="params is required")

    with get_db() as conn:
        cur = dict_cursor(conn)
        import json
        cur.execute(
            """UPDATE analysis_params SET params = %s, updated_at = NOW()
               WHERE venue_id = %s RETURNING venue_id, venue_name, race_type, params, updated_at::text""",
            (json.dumps(params), venue_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Analysis params not found")
        return row
