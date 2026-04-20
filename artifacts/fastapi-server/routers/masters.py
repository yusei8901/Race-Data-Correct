import json
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")


@router.get("/memo-masters")
def get_memo_masters():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id, memo_text, display_order, is_active FROM correction_memo_master WHERE is_active = TRUE ORDER BY display_order"
        )
        return cur.fetchall()


@router.get("/venue-presets")
def get_venue_presets(
    venue_code: Optional[str] = Query(None),
    surface_type: Optional[str] = Query(None),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where, params = ["is_active = TRUE"], []
        if venue_code:
            where.append("venue_code = %s")
            params.append(venue_code)
        if surface_type:
            where.append("(surface_type = %s OR surface_type IS NULL)")
            params.append(surface_type)
        where_sql = "WHERE " + " AND ".join(where)
        cur.execute(
            f"""SELECT id, venue_code, weather_preset_code, name, surface_type,
                       preset_parameters, is_active, created_at::text, updated_at::text
                FROM venue_weather_preset
                {where_sql}
                ORDER BY venue_code, weather_preset_code""",
            params,
        )
        return cur.fetchall()


@router.put("/venue-presets/{preset_id}")
def update_venue_preset(preset_id: str, body: dict):
    params_data = body.get("preset_parameters")
    if params_data is None:
        raise HTTPException(status_code=400, detail="preset_parameters is required")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """UPDATE venue_weather_preset
               SET preset_parameters = %s, updated_at = NOW()
               WHERE id = %s
               RETURNING id, venue_code, weather_preset_code, name, surface_type,
                         preset_parameters, is_active, created_at::text, updated_at::text""",
            (json.dumps(params_data), preset_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Venue preset not found")
        conn.commit()
        return row


@router.get("/venues")
def get_venues():
    """Return unique venue list from race_event (distinct venue_code + venue_name)."""
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT DISTINCT venue_code AS id, venue_name AS name
               FROM race_event
               ORDER BY venue_name"""
        )
        return cur.fetchall()
