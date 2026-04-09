from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from database import get_db, dict_cursor
import uuid

router = APIRouter(prefix="/fastapi")


# ── Categories ───────────────────────────────────────────────────────────────

@router.get("/categories")
def get_categories():
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id::text, code, name FROM race_category ORDER BY name")
        return cur.fetchall()


# ── Events ───────────────────────────────────────────────────────────────────

def fmt_event(row: dict) -> dict:
    return {
        "id": row["id"],
        "category_id": row["category_id"],
        "category_name": row.get("category_name"),
        "event_date": row["event_date"],
        "venue_code": row["venue_code"],
        "venue_name": row["venue_name"],
        "round": row["round"],
        "race_count": row.get("race_count", 0),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


@router.get("/events")
def get_events(
    category_id: Optional[str] = Query(None),
    venue_code: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        where = []
        params = []
        if category_id:
            where.append("re.category_id = %s::uuid")
            params.append(category_id)
        if venue_code:
            where.append("re.venue_code = %s")
            params.append(venue_code)
        if date_from:
            where.append("re.event_date >= %s")
            params.append(date_from)
        if date_to:
            where.append("re.event_date <= %s")
            params.append(date_to)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        offset = (page - 1) * limit
        params += [limit, offset]
        cur.execute(
            f"""SELECT re.id::text, re.category_id::text, rc.name AS category_name,
                       re.event_date::text, re.venue_code, re.venue_name, re.round,
                       re.created_at::text, re.updated_at::text,
                       COUNT(r.id) AS race_count
               FROM race_event re
               LEFT JOIN race_category rc ON rc.id = re.category_id
               LEFT JOIN race r ON r.event_id = re.id
               {where_sql}
               GROUP BY re.id, rc.name
               ORDER BY re.event_date DESC, re.venue_name
               LIMIT %s OFFSET %s""",
            params,
        )
        rows = cur.fetchall()
        return [fmt_event(r) for r in rows]


@router.post("/events", status_code=201)
def create_event(body: dict):
    required = ["category_id", "event_date", "venue_code", "venue_name", "round"]
    for f in required:
        if f not in body:
            raise HTTPException(status_code=422, detail=f"Missing field: {f}")
    with get_db() as conn:
        cur = dict_cursor(conn)
        eid = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO race_event (id, category_id, event_date, venue_code, venue_name, round, created_at, updated_at)
               VALUES (%s, %s::uuid, %s, %s, %s, %s, NOW(), NOW()) RETURNING id::text""",
            (eid, body["category_id"], body["event_date"], body["venue_code"], body["venue_name"], body["round"]),
        )
        conn.commit()
        cur.execute(
            """SELECT re.id::text, re.category_id::text, rc.name AS category_name,
                      re.event_date::text, re.venue_code, re.venue_name, re.round,
                      re.created_at::text, re.updated_at::text, 0 AS race_count
               FROM race_event re
               LEFT JOIN race_category rc ON rc.id = re.category_id
               WHERE re.id = %s::uuid""",
            (eid,),
        )
        return fmt_event(cur.fetchone())


@router.get("/events/{event_id}")
def get_event(event_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT re.id::text, re.category_id::text, rc.name AS category_name,
                      re.event_date::text, re.venue_code, re.venue_name, re.round,
                      re.created_at::text, re.updated_at::text,
                      COUNT(r.id) AS race_count
               FROM race_event re
               LEFT JOIN race_category rc ON rc.id = re.category_id
               LEFT JOIN race r ON r.event_id = re.id
               WHERE re.id = %s::uuid
               GROUP BY re.id, rc.name""",
            (event_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        return fmt_event(row)


# ── Event Races ───────────────────────────────────────────────────────────────

@router.get("/events/{event_id}/races")
def get_event_races(event_id: str):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """SELECT r.id::text, r.race_number, r.race_name, r.surface_type,
                      r.distance, r.direction, r.start_time::text,
                      r.status, r.updated_at::text
               FROM race r
               WHERE r.event_id = %s::uuid
               ORDER BY r.race_number""",
            (event_id,),
        )
        return cur.fetchall()


@router.post("/events/{event_id}/races", status_code=201)
def create_event_race(event_id: str, body: dict):
    required = ["race_number", "race_name", "surface_type", "distance"]
    for f in required:
        if f not in body:
            raise HTTPException(status_code=422, detail=f"Missing field: {f}")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id FROM race_event WHERE id = %s::uuid", (event_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Event not found")
        rid = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO race
                 (id, event_id, race_number, race_name, surface_type, distance,
                  direction, start_time, status, created_at, updated_at)
               VALUES (%s, %s::uuid, %s, %s, %s, %s, %s, %s, 'PENDING', NOW(), NOW())
               RETURNING id::text, race_number, race_name, surface_type, distance,
                         direction, start_time::text, status, updated_at::text""",
            (rid, event_id, body["race_number"], body["race_name"],
             body["surface_type"], body["distance"],
             body.get("direction"), body.get("start_time")),
        )
        conn.commit()
        return cur.fetchone()
