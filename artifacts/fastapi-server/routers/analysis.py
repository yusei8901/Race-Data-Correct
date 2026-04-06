from fastapi import APIRouter

router = APIRouter(prefix="/fastapi")

VENUE_MAP = {
    "nakayama": ("中山", "中央競馬"),
    "hanshin":  ("阪神", "中央競馬"),
    "kyoto":    ("京都", "中央競馬"),
    "tokyo":    ("東京", "中央競馬"),
    "oi":       ("大井", "地方競馬"),
    "kawasaki": ("川崎", "地方競馬"),
}


@router.get("/venues")
def get_venues():
    return [
        {"id": vid, "name": names[0], "race_type": names[1]}
        for vid, names in VENUE_MAP.items()
    ]


@router.get("/analysis-params/{venue_id}")
def get_analysis_params(venue_id: str):
    info = VENUE_MAP.get(venue_id, (venue_id, "中央競馬"))
    return {
        "venue_id": venue_id,
        "venue_name": info[0],
        "race_type": info[1],
        "params": {
            "brightness_threshold": 128,
            "contrast_boost": 1.2,
            "noise_reduction": 0.5,
            "tracking_sensitivity": 0.8,
        },
        "updated_at": None,
    }


@router.patch("/analysis-params/{venue_id}")
def update_analysis_params(venue_id: str, body: dict):
    info = VENUE_MAP.get(venue_id, (venue_id, "中央競馬"))
    return {
        "venue_id": venue_id,
        "venue_name": info[0],
        "race_type": info[1],
        "params": body.get("params", {}),
        "updated_at": None,
    }
