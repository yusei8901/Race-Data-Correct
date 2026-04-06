import json
from fastapi import APIRouter, HTTPException
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")

DEFAULT_PARAMS = {
    "brightness_threshold": 128,
    "contrast_boost": 1.2,
    "noise_reduction": 0.5,
    "tracking_sensitivity": 0.8,
}


@router.get("/venues")
def get_venues():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT venue_id AS id, venue_name AS name, race_type FROM analysis_venue_config ORDER BY race_type, venue_name"
        )
        return cur.fetchall()


@router.get("/analysis-params/{venue_id}")
def get_analysis_params(venue_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT venue_id, venue_name, race_type, params, updated_at::text FROM analysis_venue_config WHERE venue_id = %s",
            (venue_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Analysis config not found")
        return row


@router.patch("/analysis-params/{venue_id}")
def update_analysis_params(venue_id: str, body: dict):
    params = body.get("params")
    if params is None:
        raise HTTPException(status_code=400, detail="params is required")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """UPDATE analysis_venue_config
               SET params = %s, updated_at = NOW()
               WHERE venue_id = %s
               RETURNING venue_id, venue_name, race_type, params, updated_at::text""",
            (json.dumps(params), venue_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Analysis config not found")
        conn.commit()
        return row
