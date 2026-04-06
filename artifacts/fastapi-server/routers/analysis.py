import json
from fastapi import APIRouter
from database import get_db, dict_cursor

router = APIRouter(prefix="/fastapi")

_TABLE_INIT = """
CREATE TABLE IF NOT EXISTS analysis_venue_config (
    venue_id    varchar(20) PRIMARY KEY,
    venue_name  varchar(100) NOT NULL,
    race_type   varchar(50)  NOT NULL,
    params      jsonb        NOT NULL DEFAULT '{}',
    updated_at  timestamptz  NOT NULL DEFAULT now()
);
"""

DEFAULT_VENUES = [
    ("nakayama", "中山", "中央競馬"),
    ("hanshin",  "阪神", "中央競馬"),
    ("kyoto",    "京都", "中央競馬"),
    ("tokyo",    "東京", "中央競馬"),
    ("oi",       "大井", "地方競馬"),
    ("kawasaki", "川崎", "地方競馬"),
]

DEFAULT_PARAMS = {
    "brightness_threshold": 128,
    "contrast_boost": 1.2,
    "noise_reduction": 0.5,
    "tracking_sensitivity": 0.8,
}


def _ensure_table(conn):
    cur = dict_cursor(conn)
    cur.execute(_TABLE_INIT)
    for vid, vname, rtype in DEFAULT_VENUES:
        cur.execute(
            """INSERT INTO analysis_venue_config (venue_id, venue_name, race_type, params)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (venue_id) DO NOTHING""",
            (vid, vname, rtype, json.dumps(DEFAULT_PARAMS)),
        )
    conn.commit()


@router.get("/venues")
def get_venues():
    with get_db() as conn:
        _ensure_table(conn)
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT venue_id AS id, venue_name AS name, race_type FROM analysis_venue_config ORDER BY race_type, venue_name"
        )
        return cur.fetchall()


@router.get("/analysis-params/{venue_id}")
def get_analysis_params(venue_id: str):
    with get_db() as conn:
        _ensure_table(conn)
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT venue_id, venue_name, race_type, params, updated_at::text FROM analysis_venue_config WHERE venue_id = %s",
            (venue_id,),
        )
        row = cur.fetchone()
        if not row:
            return {
                "venue_id": venue_id,
                "venue_name": venue_id,
                "race_type": "中央競馬",
                "params": DEFAULT_PARAMS,
                "updated_at": None,
            }
        return row


@router.patch("/analysis-params/{venue_id}")
def update_analysis_params(venue_id: str, body: dict):
    params = body.get("params", {})
    with get_db() as conn:
        _ensure_table(conn)
        cur = dict_cursor(conn)
        cur.execute(
            """INSERT INTO analysis_venue_config (venue_id, venue_name, race_type, params, updated_at)
               VALUES (%s, %s, %s, %s, NOW())
               ON CONFLICT (venue_id) DO UPDATE SET params = EXCLUDED.params, updated_at = NOW()
               RETURNING venue_id, venue_name, race_type, params, updated_at::text""",
            (venue_id, venue_id, "中央競馬", json.dumps(params)),
        )
        conn.commit()
        return cur.fetchone()
