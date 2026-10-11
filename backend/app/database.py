"""SQLAlchemy engine/session setup for SQLite.

Concurrency notes
-----------------
* WAL journal mode lets readers proceed while a single writer commits.
* ``busy_timeout`` makes a writer wait for the write lock instead of failing
  immediately with "database is locked".
* pysqlite's default transaction handling only opens a transaction at the first
  INSERT/UPDATE/DELETE, so plain reads never hold a stale snapshot that would
  later need upgrading to a write lock.
* All payment state transitions are single conditional UPDATE statements
  (``... WHERE status = 'PENDING'``); the affected row count tells us whether
  this request won the race.
"""

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False, "timeout": 30},
    pool_size=20,
    max_overflow=80,
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _configure_sqlite(dbapi_connection, _connection_record) -> None:  # pragma: no cover - driver hook
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a session that is always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
