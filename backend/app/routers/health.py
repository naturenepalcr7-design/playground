"""
KMC-GIS-SERVER — Health Check Router
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.auth import get_redis
from app.schemas import HealthResponse

router = APIRouter(prefix="/api", tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def health_check(db: AsyncSession = Depends(get_db)):
    """System health check — verifies database and Redis connectivity."""
    db_status = "unhealthy"
    redis_status = "unhealthy"

    try:
        await db.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception:
        pass

    try:
        redis_client = await get_redis()
        await redis_client.ping()
        redis_status = "healthy"
    except Exception:
        pass

    return HealthResponse(
        status="ok" if db_status == "healthy" else "degraded",
        version="1.0.0",
        database=db_status,
        redis=redis_status,
    )
