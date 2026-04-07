import os
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

# import 時点では検証しない（Cloud Run 等で PORT に先にバインドさせるため）。
# 接続が必要なときだけ DATABASE_URL を必須にする。
DATABASE_URL = os.environ.get("DATABASE_URL")


def _require_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL must be set")
    return url


def get_connection():
    return psycopg2.connect(_require_database_url())


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def dict_cursor(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
