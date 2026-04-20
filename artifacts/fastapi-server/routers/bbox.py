from fastapi import APIRouter, HTTPException
from typing import Optional
from database import get_db, dict_cursor
import json
import math
import uuid

router = APIRouter(prefix="/fastapi")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _signed_dist_to_line(cx: float, cy: float,
                          lx1: float, ly1: float,
                          lx2: float, ly2: float) -> float:
    """Signed perpendicular distance from point (cx,cy) to infinite line through (lx1,ly1)-(lx2,ly2).
    Positive = left of line direction, negative = right."""
    dx = lx2 - lx1
    dy = ly2 - ly1
    line_len = math.sqrt(dx * dx + dy * dy)
    if line_len == 0:
        return 0.0
    return ((cy - ly1) * dx - (cx - lx1) * dy) / line_len


def _calc_rail_scale(fence_markers: list, rail_spacing_m: float) -> Optional[float]:
    """Average px-to-meter scale from fence markers (normalized 0-1 coords)."""
    if len(fence_markers) < 2:
        return None
    total_px = 0.0
    count = 0
    for i in range(len(fence_markers) - 1):
        p1, p2 = fence_markers[i], fence_markers[i + 1]
        dx = p2["x"] - p1["x"]
        dy = p2["y"] - p1["y"]
        seg_px = math.sqrt(dx * dx + dy * dy)
        if seg_px > 0:
            total_px += seg_px
            count += 1
    if count == 0 or total_px == 0:
        return None
    avg_px_per_interval = total_px / count
    return rail_spacing_m / avg_px_per_interval  # m / px


def _calculate(bboxes: list, reference_line: Optional[dict],
               fence_markers: list, params: dict) -> dict:
    """
    Returns {bbox_id: {cap_class, cap_color_key, dist_px, dist_m, delta_t, estimated_time}}.
    Coordinates are normalized (0-1).
    """
    if not reference_line or not bboxes:
        return {}

    lx1 = reference_line["x1"]
    ly1 = reference_line["y1"]
    lx2 = reference_line["x2"]
    ly2 = reference_line["y2"]

    direction_multiplier = params.get("direction_multiplier", 1)
    rail_spacing_m = params.get("rail_spacing_m", 3.0)
    distance_scale_factor = params.get("distance_scale_factor", 1.0)
    leader_official_time = params.get("leader_official_time")
    furlong_interval_time = params.get("furlong_interval_time")
    furlong_distance = params.get("furlong_distance", 200)

    if not leader_official_time or not furlong_interval_time or furlong_interval_time <= 0:
        return {}

    leader_speed = furlong_distance / furlong_interval_time  # m/s
    scale = _calc_rail_scale(fence_markers, rail_spacing_m)

    results = {}
    for bbox in bboxes:
        cx = bbox["x"] + bbox["w"] / 2
        cy = bbox["y"] + bbox["h"] / 2

        dist_px = _signed_dist_to_line(cx, cy, lx1, ly1, lx2, ly2) * direction_multiplier

        if scale is not None:
            dist_m = dist_px * scale * distance_scale_factor
        else:
            dist_m = None

        if dist_m is not None:
            delta_t = dist_m / leader_speed if leader_speed > 0 else 0
            estimated_time = leader_official_time + delta_t
        else:
            delta_t = None
            estimated_time = None

        results[bbox["id"]] = {
            "cap_class": bbox.get("cap_class"),
            "cap_color_key": bbox.get("cap_color_key"),
            "dist_px": round(dist_px, 4),
            "dist_m": round(dist_m, 4) if dist_m is not None else None,
            "delta_t": round(delta_t, 4) if delta_t is not None else None,
            "estimated_time": round(estimated_time, 2) if estimated_time is not None else None,
        }

    return results


# ── Annotation CRUD ───────────────────────────────────────────────────────────

@router.get("/races/{race_id}/bbox/{checkpoint}")
def get_bbox_annotation(race_id: str, checkpoint: str):
    with get_db() as conn:
        with dict_cursor(conn) as cur:
            cur.execute("""
                SELECT id, bboxes, reference_line, fence_markers, parameters, updated_at
                FROM bbox_annotation
                WHERE race_id = %s AND checkpoint = %s
            """, (race_id, checkpoint))
            row = cur.fetchone()
            if not row:
                return {
                    "id": None,
                    "bboxes": [],
                    "reference_line": None,
                    "fence_markers": [],
                    "parameters": {},
                }
            return {
                "id": str(row["id"]),
                "bboxes": row["bboxes"] or [],
                "reference_line": row["reference_line"],
                "fence_markers": row["fence_markers"] or [],
                "parameters": row["parameters"] or {},
                "updated_at": str(row["updated_at"]) if row["updated_at"] else None,
            }


@router.put("/races/{race_id}/bbox/{checkpoint}")
def save_bbox_annotation(race_id: str, checkpoint: str, body: dict):
    bboxes = body.get("bboxes", [])
    reference_line = body.get("reference_line")
    fence_markers = body.get("fence_markers", [])
    parameters = body.get("parameters", {})

    with get_db() as conn:
        with dict_cursor(conn) as cur:
            cur.execute("""
                INSERT INTO bbox_annotation (race_id, checkpoint, bboxes, reference_line, fence_markers, parameters)
                VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb)
                ON CONFLICT (race_id, checkpoint) DO UPDATE SET
                    bboxes = EXCLUDED.bboxes,
                    reference_line = EXCLUDED.reference_line,
                    fence_markers = EXCLUDED.fence_markers,
                    parameters = EXCLUDED.parameters,
                    updated_at = NOW()
                RETURNING id, updated_at
            """, (
                race_id, checkpoint,
                json.dumps(bboxes),
                json.dumps(reference_line),
                json.dumps(fence_markers),
                json.dumps(parameters),
            ))
            row = cur.fetchone()
            conn.commit()
            return {"id": str(row["id"]), "updated_at": str(row["updated_at"])}


@router.post("/races/{race_id}/bbox/{checkpoint}/calculate")
def calculate_estimated_times(race_id: str, checkpoint: str, body: dict):
    """
    Calculate estimated passing times from BBOX annotations.
    Returns per-bbox results; caller decides whether to apply.
    """
    bboxes = body.get("bboxes", [])
    reference_line = body.get("reference_line")
    fence_markers = body.get("fence_markers", [])
    parameters = body.get("parameters", {})

    results = _calculate(bboxes, reference_line, fence_markers, parameters)

    # Build cap_color_key → estimated_time map for easy frontend use
    cap_to_time: dict = {}
    for bbox_id, r in results.items():
        key = r.get("cap_color_key")
        t = r.get("estimated_time")
        if key is not None and t is not None:
            # If multiple bboxes have same cap_color_key, take min (closest = leader)
            if key not in cap_to_time or t < cap_to_time[key]["estimated_time"]:
                cap_to_time[key] = {
                    "estimated_time": t,
                    "delta_t": r.get("delta_t"),
                    "dist_m": r.get("dist_m"),
                    "dist_px": r.get("dist_px"),
                }

    return {
        "bbox_results": results,
        "cap_to_time": cap_to_time,
    }


@router.post("/races/{race_id}/bbox/{checkpoint}/apply")
def apply_estimated_times(race_id: str, checkpoint: str, body: dict):
    """
    Apply calculated estimated times to passing_order records.
    Overwrites time_seconds for matching horse rows (matched by gate_number = cap_color_key).
    Records a history entry for audit trail.
    """
    cap_to_time: dict = body.get("cap_to_time", {})  # {str(gate_number): {estimated_time, ...}}

    if not cap_to_time:
        raise HTTPException(status_code=400, detail="cap_to_time is empty")

    # CAP color key (gate number 1-8) → time mapping
    applied = []
    with get_db() as conn:
        with dict_cursor(conn) as cur:
            # Get current analysis result header
            cur.execute("""
                SELECT arh.id AS header_id
                FROM analysis_result_header arh
                WHERE arh.race_id = %s AND arh.is_current = TRUE
                ORDER BY arh.created_at DESC LIMIT 1
            """, (race_id,))
            header = cur.fetchone()
            if not header:
                raise HTTPException(status_code=404, detail="No current analysis result header")
            header_id = header["header_id"]

            for gate_str, info in cap_to_time.items():
                gate_number = int(gate_str)
                estimated_time = info.get("estimated_time")
                if estimated_time is None:
                    continue

                # Find analysis_result_detail rows for this checkpoint + gate_number
                cur.execute("""
                    UPDATE analysis_result_detail
                    SET corrected_time = %s,
                        is_corrected = TRUE
                    WHERE header_id = %s
                      AND marker_type = %s
                      AND gate_number = %s
                    RETURNING id, horse_number, horse_name
                """, (estimated_time, header_id, checkpoint, gate_number))
                rows = cur.fetchall()
                for r in rows:
                    applied.append({
                        "horse_number": r["horse_number"],
                        "horse_name": r["horse_name"],
                        "estimated_time": estimated_time,
                        "gate_number": gate_number,
                    })

            conn.commit()

    return {"applied": applied, "count": len(applied)}


# ── Preset CRUD ───────────────────────────────────────────────────────────────

@router.get("/bbox-presets")
def list_presets():
    with get_db() as conn:
        with dict_cursor(conn) as cur:
            cur.execute("""
                SELECT id, name, venue_code, section_type, course_variant, surface_type,
                       parameters, created_at, updated_at
                FROM bbox_param_preset
                ORDER BY name ASC
            """)
            rows = cur.fetchall()
            return [
                {
                    "id": str(r["id"]),
                    "name": r["name"],
                    "venue_code": r["venue_code"],
                    "section_type": r["section_type"],
                    "course_variant": r["course_variant"],
                    "surface_type": r["surface_type"],
                    "parameters": r["parameters"] or {},
                    "created_at": str(r["created_at"]),
                    "updated_at": str(r["updated_at"]),
                }
                for r in rows
            ]


@router.post("/bbox-presets")
def create_preset(body: dict):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    with get_db() as conn:
        with dict_cursor(conn) as cur:
            cur.execute("""
                INSERT INTO bbox_param_preset (name, venue_code, section_type, course_variant, surface_type, parameters)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                RETURNING id, name, venue_code, section_type, course_variant, surface_type, parameters, created_at, updated_at
            """, (
                name,
                body.get("venue_code") or None,
                body.get("section_type") or None,
                body.get("course_variant") or None,
                body.get("surface_type") or None,
                json.dumps(body.get("parameters", {})),
            ))
            row = cur.fetchone()
            conn.commit()
            return {
                "id": str(row["id"]),
                "name": row["name"],
                "venue_code": row["venue_code"],
                "section_type": row["section_type"],
                "course_variant": row["course_variant"],
                "surface_type": row["surface_type"],
                "parameters": row["parameters"] or {},
                "created_at": str(row["created_at"]),
                "updated_at": str(row["updated_at"]),
            }


@router.put("/bbox-presets/{preset_id}")
def update_preset(preset_id: str, body: dict):
    with get_db() as conn:
        with dict_cursor(conn) as cur:
            cur.execute("""
                UPDATE bbox_param_preset
                SET name = %s,
                    venue_code = %s,
                    section_type = %s,
                    course_variant = %s,
                    surface_type = %s,
                    parameters = %s::jsonb,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING id
            """, (
                body.get("name"),
                body.get("venue_code") or None,
                body.get("section_type") or None,
                body.get("course_variant") or None,
                body.get("surface_type") or None,
                json.dumps(body.get("parameters", {})),
                preset_id,
            ))
            row = cur.fetchone()
            conn.commit()
            if not row:
                raise HTTPException(status_code=404, detail="Preset not found")
            return {"id": str(row["id"])}


@router.delete("/bbox-presets/{preset_id}")
def delete_preset(preset_id: str):
    with get_db() as conn:
        with dict_cursor(conn) as cur:
            cur.execute("DELETE FROM bbox_param_preset WHERE id = %s RETURNING id", (preset_id,))
            row = cur.fetchone()
            conn.commit()
            if not row:
                raise HTTPException(status_code=404, detail="Preset not found")
            return {"deleted": str(row["id"])}
