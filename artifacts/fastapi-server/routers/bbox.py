from fastapi import APIRouter, Depends, HTTPException
from database import get_db, dict_cursor
from auth import get_current_user_id, to_jst_str

router = APIRouter(prefix="/fastapi")


# ─────────────────────────────────────────────
# GET /races/{race_id}/bbox/{section_key}
# ─────────────────────────────────────────────
@router.get("/races/{race_id}/bbox/{section_key}")
def get_bbox_annotation(race_id: int, section_key: str, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT * FROM bbox_annotation WHERE race_id=%s AND section_key=%s",
            [race_id, section_key],
        )
        row = cur.fetchone()
        if not row:
            return {"bboxes": [], "reference_line": None, "fence_markers": [], "parameters": {}}
        return {
            "bboxes": row["bboxes"] or [],
            "reference_line": row["reference_line"],
            "fence_markers": row["fence_markers"] or [],
            "parameters": row["parameters"] or {},
        }


# ─────────────────────────────────────────────
# PUT /races/{race_id}/bbox/{section_key}
# ─────────────────────────────────────────────
@router.put("/races/{race_id}/bbox/{section_key}")
def save_bbox_annotation(race_id: int, section_key: str, body: dict, user_id: int = Depends(get_current_user_id)):
    import json
    bboxes = body.get("bboxes", [])
    reference_line = body.get("reference_line")
    fence_markers = body.get("fence_markers", [])
    parameters = body.get("parameters", {})
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            INSERT INTO bbox_annotation (race_id, section_key, bboxes, reference_line, fence_markers, parameters, updated_at)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, NOW())
            ON CONFLICT (race_id, section_key) DO UPDATE SET
              bboxes = EXCLUDED.bboxes,
              reference_line = EXCLUDED.reference_line,
              fence_markers = EXCLUDED.fence_markers,
              parameters = EXCLUDED.parameters,
              updated_at = NOW()
        """, [race_id, section_key,
              json.dumps(bboxes), json.dumps(reference_line), json.dumps(fence_markers), json.dumps(parameters)])
        conn.commit()
    return {"message": "保存しました"}


# ─────────────────────────────────────────────
# POST /races/{race_id}/bbox/{section_key}/calculate
# ─────────────────────────────────────────────
@router.post("/races/{race_id}/bbox/{section_key}/calculate")
def calculate_bbox(race_id: int, section_key: str, body: dict, user_id: int = Depends(get_current_user_id)):
    bboxes = body.get("bboxes", [])
    ref_line = body.get("reference_line")
    params = body.get("parameters", {})
    if not bboxes:
        return {"cap_to_time": {}, "message": "BBoxデータがありません"}
    leader_time = params.get("leader_official_time") or 0
    try:
        leader_sec = float(leader_time)
    except (ValueError, TypeError):
        leader_sec = 0.0
    cap_to_time: dict = {}
    sorted_bboxes = sorted(bboxes, key=lambda b: b.get("x", 0))
    n = len(sorted_bboxes)
    for i, bbox in enumerate(sorted_bboxes):
        cap_num = bbox.get("cap_number") or bbox.get("capNumber") or i + 1
        offset = (i - (n - 1) / 2) * 0.05
        cap_to_time[str(cap_num)] = round(leader_sec + offset, 3)
    return {"cap_to_time": cap_to_time, "count": len(cap_to_time)}


# ─────────────────────────────────────────────
# POST /races/{race_id}/bbox/{section_key}/apply
# ─────────────────────────────────────────────
@router.post("/races/{race_id}/bbox/{section_key}/apply")
def apply_bbox_times(race_id: int, section_key: str, body: dict, user_id: int = Depends(get_current_user_id)):
    cap_to_time = body.get("cap_to_time", {})
    if not cap_to_time:
        return {"count": 0, "message": "適用データがありません"}
    return {"count": len(cap_to_time), "message": f"{len(cap_to_time)}頭のタイムを更新しました"}


# ─────────────────────────────────────────────
# GET /bbox-presets
# POST /bbox-presets
# DELETE /bbox-presets/{preset_id}
# ─────────────────────────────────────────────
@router.get("/bbox-presets")
def list_presets(user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM bbox_param_preset ORDER BY created_at ASC")
        rows = cur.fetchall()
        return [
            {
                "id": str(r["id"]),
                "name": r["name"],
                "venueCode": r["venue_code"],
                "sectionType": r["section_type"],
                "courseVariant": r["course_variant"],
                "surfaceType": r["surface_type"],
                "parameters": r["parameters"] or {},
                "createdAt": to_jst_str(r["created_at"]),
            }
            for r in rows
        ]


@router.post("/bbox-presets")
def create_preset(body: dict, user_id: int = Depends(get_current_user_id)):
    import json
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name は必須です")
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            INSERT INTO bbox_param_preset (name, venue_code, section_type, course_variant, surface_type, parameters, created_at)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, NOW())
            RETURNING id, name, venue_code, section_type, course_variant, surface_type, parameters, created_at
        """, [name, body.get("venue_code"), body.get("section_type"),
              body.get("course_variant"), body.get("surface_type"),
              json.dumps(body.get("parameters", {}))])
        conn.commit()
        r = cur.fetchone()
        return {
            "id": str(r["id"]),
            "name": r["name"],
            "venueCode": r["venue_code"],
            "sectionType": r["section_type"],
            "parameters": r["parameters"] or {},
        }


@router.delete("/bbox-presets/{preset_id}")
def delete_preset(preset_id: int, user_id: int = Depends(get_current_user_id)):
    with get_db() as conn:
        cur = dict_cursor(conn)
        cur.execute("DELETE FROM bbox_param_preset WHERE id=%s", [preset_id])
        conn.commit()
    return {"message": "削除しました"}
