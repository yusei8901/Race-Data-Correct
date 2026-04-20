"""
Auth helpers.
In production: GCP IAP sets X-Goog-Authenticated-User-Email / X-Goog-IAP-JWT-Assertion.
For dev: use X-Dev-User-Id header (1=regular, 10=admin) or default to user id=1.
"""
from fastapi import Header, HTTPException
from database import get_db, dict_cursor
from typing import Optional

ADMIN_USER_IDS = {10}


def get_current_user_id(x_dev_user_id: Optional[str] = Header(None, alias="X-Dev-User-Id")) -> int:
    try:
        uid = int(x_dev_user_id) if x_dev_user_id else 1
    except ValueError:
        uid = 1
    return uid


def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_USER_IDS


def require_admin(user_id: int):
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="管理者権限が必要です")


def to_jst_str(ts) -> Optional[str]:
    """Convert timestamp (aware or naive UTC) to ISO 8601 +09:00 string."""
    if ts is None:
        return None
    import datetime
    JST = datetime.timezone(datetime.timedelta(hours=9))
    if hasattr(ts, 'tzinfo') and ts.tzinfo is not None:
        ts = ts.astimezone(JST)
    else:
        ts = ts.replace(tzinfo=datetime.timezone.utc).astimezone(JST)
    return ts.isoformat()
