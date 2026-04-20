from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional
from database import get_db, dict_cursor
from auth import get_current_user_id

router = APIRouter(prefix="/fastapi")


# GET /venues
@router.get("/venues")
def get_venues(
    raceCategoryCode: Optional[str] = Query(None),
    user_id: int = Depends(get_current_user_id),
):
    with get_db() as conn:
        cur = dict_cursor(conn)
        params = []
        where = ""
        if raceCategoryCode:
            where = "WHERE rc.code = %s"
            params.append(raceCategoryCode)

        cur.execute(f"""
            SELECT rv.code, rv.name, rv.short_name_1, rv.short_name_2, rv.short_name_3,
                   rv.venue_name_en, rc.code AS category_code, rc.name AS category_name
            FROM race_venue rv
            JOIN race_category rc ON rc.id = rv.category_id
            {where}
            ORDER BY rv.code
        """, params)
        rows = cur.fetchall()
        return {
            "items": [
                {
                    "code": r["code"],
                    "name": r["name"],
                    "shortName": r["short_name_2"],
                    "shortName1": r["short_name_1"],
                    "shortName3": r["short_name_3"],
                    "venueNameEn": r["venue_name_en"],
                    "categoryCode": r["category_code"],
                    "categoryName": r["category_name"],
                }
                for r in rows
            ]
        }


# GET /race-categories
@router.get("/race-categories")
def get_race_categories(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT code, name FROM race_category ORDER BY id")
        rows = cur.fetchall()
        return {"items": [{"code": r["code"], "name": r["name"]} for r in rows]}


# GET /correction-memos
@router.get("/correction-memos")
def get_correction_memos(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT id, memo_text, display_order FROM correction_memo_master "
            "WHERE is_active=TRUE ORDER BY display_order"
        )
        rows = cur.fetchall()
        return {"items": [{"id": r["id"], "text": r["memo_text"]} for r in rows]}
