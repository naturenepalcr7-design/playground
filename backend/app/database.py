"""
KMC-GIS-SERVER Database Engine & Session Management
Async SQLAlchemy 2.0 with PostGIS support.
"""

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
    AsyncEngine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, text
from app.config import get_settings

settings = get_settings()

engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_extensions():
    """Ensure PostGIS and required extensions are enabled."""
    extensions = ["postgis", "postgis_topology", "pg_trgm", '"uuid-ossp"']
    for ext in extensions:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {ext};"))
        except Exception:
            # Extension may have been created concurrently by another worker
            pass
