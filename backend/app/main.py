"""
KMC-GIS-SERVER — Main FastAPI Application
Modular entrypoint mounting all domain APIRouters.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine
from app.init_db import init_database
from app.helpers import (
    log_audit,
    get_user_accessible_project_ids,
    is_project_accessible_by_user,
    is_layer_accessible_by_user,
    is_mbtiles_accessible_by_user,
)
from app.routers import (
    health,
    auth,
    users,
    projects,
    tasks,
    layers,
    features,
    linking,
    tiles,
    media,
    tracking,
    ogcapi,
    house_numbering,
)

settings = get_settings()


# ============================================================
# Application Lifespan (Startup & Shutdown)
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database, extensions, tables, and seed superuser on startup; cleanup on shutdown."""
    import os
    temp_dir = os.path.join(settings.TILESERVER_DATA_DIR, "temp")
    os.makedirs(temp_dir, exist_ok=True)
    try:
        os.chmod(temp_dir, 0o777)
    except Exception:
        pass
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    try:
        os.chmod(settings.UPLOAD_DIR, 0o777)
    except Exception:
        pass
    await init_database()
    await house_numbering.start_house_numbering_worker()
    print(f"[{settings.APP_NAME}] Started successfully. Version: 1.0.0")
    yield
    await house_numbering.stop_house_numbering_worker()
    await engine.dispose()


# ============================================================
# FastAPI App Initialization
# ============================================================

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url="/api/redoc" if settings.DEBUG else None,
    openapi_url="/api/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,
)

# ---- CORS Middleware ----
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Router Registration
# ============================================================

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(layers.router)
app.include_router(features.router)
app.include_router(linking.router)
app.include_router(tiles.router)
app.include_router(media.router)
app.include_router(tracking.router)
app.include_router(ogcapi.router_open)
app.include_router(ogcapi.router_secure)
app.include_router(house_numbering.router)
