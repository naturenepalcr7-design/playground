"""
KMC-GIS-SERVER Database Initialization
Creates tables, extensions, and seeds the default superuser.
"""

import os
import json
import sqlite3
from pathlib import Path
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import engine, AsyncSessionLocal, Base, init_extensions
from app.models import User, UserRole, MBTilesPackage
from app.auth import hash_password
from app.config import get_settings

settings = get_settings()


async def init_database():
    """
    Initialize the database safely across multiple uvicorn workers:
    1. Acquire Postgres advisory lock so only one worker initializes
    2. Create extensions
    3. Create all tables from ORM metadata
    4. Seed the default superuser if not exists
    """
    async with engine.begin() as conn:
        # Acquire transaction-level advisory lock (ID: 847291)
        await conn.execute(text("SELECT pg_advisory_xact_lock(847291);"))
        
        # Extensions
        extensions = ["postgis", "postgis_topology", "pg_trgm", '"uuid-ossp"']
        for ext in extensions:
            try:
                await conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {ext};"))
            except Exception:
                pass

        # Tables
        await conn.run_sync(Base.metadata.create_all)

        # Safe schema synchronization for existing databases
        sync_sqls = [
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS allow_snapping BOOLEAN DEFAULT TRUE NOT NULL;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS fields_config JSONB DEFAULT '[]'::jsonb;",
            "ALTER TABLE mbtiles_packages ALTER COLUMN file_size TYPE BIGINT;",
            "ALTER TABLE mbtiles_packages ADD COLUMN IF NOT EXISTS center JSONB;",
            "ALTER TABLE media_attachments ALTER COLUMN file_size TYPE BIGINT;",
            "ALTER TABLE survey_projects ALTER COLUMN boundary TYPE geometry(Geometry, 4326);",
            "ALTER TABLE task_grids ALTER COLUMN geom TYPE geometry(Geometry, 4326);",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS name VARCHAR(255);",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS properties JSONB;",
            """
            CREATE TABLE IF NOT EXISTS project_collector_assignments (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES survey_projects(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                assigned_by INTEGER NOT NULL REFERENCES users(id),
                assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_project_collector UNIQUE (project_id, user_id)
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_pca_project ON project_collector_assignments(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_pca_user ON project_collector_assignments(user_id);",
            """
            CREATE TABLE IF NOT EXISTS collector_live_locations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom geometry(Point, 4326) NOT NULL,
                accuracy DOUBLE PRECISION,
                altitude DOUBLE PRECISION,
                heading DOUBLE PRECISION,
                speed DOUBLE PRECISION,
                battery_level DOUBLE PRECISION,
                is_online BOOLEAN NOT NULL DEFAULT TRUE,
                last_seen TIMESTAMP NOT NULL DEFAULT NOW(),
                app_state VARCHAR(50) DEFAULT 'active',
                device_info JSONB
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_cll_user ON collector_live_locations(user_id);",
            "CREATE INDEX IF NOT EXISTS idx_cll_geom ON collector_live_locations USING gist(geom);",
            """
            CREATE TABLE IF NOT EXISTS collector_location_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom geometry(Point, 4326) NOT NULL,
                accuracy DOUBLE PRECISION,
                speed DOUBLE PRECISION,
                heading DOUBLE PRECISION,
                timestamp TIMESTAMP NOT NULL DEFAULT NOW()
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_cll_logs_user ON collector_location_logs(user_id);",
            "CREATE INDEX IF NOT EXISTS idx_cll_logs_time ON collector_location_logs(timestamp);",
            "CREATE INDEX IF NOT EXISTS idx_cll_logs_geom ON collector_location_logs USING gist(geom);",
        ]
        for sql in sync_sqls:
            try:
                await conn.execute(text(sql))
            except Exception:
                pass

    # Seed superuser
    await seed_superuser()

    # Backfill MBTiles center metadata for existing packages
    await backfill_mbtiles_centers()

    # Synchronize TileServer configuration with database MBTiles packages
    await sync_tileserver_config()


async def sync_tileserver_config():
    """Ensure TileServer config.json exists and matches packages registered in the database."""
    from app.tileserver import regenerate_tileserver_config
    try:
        async with AsyncSessionLocal() as db:
            await regenerate_tileserver_config(db)
    except Exception as e:
        print(f"[INIT] TileServer config sync handled: {e}")


async def seed_superuser():
    """
    Create or synchronize the default GisAdmin superuser from environment variables.
    Protected with advisory lock and error recovery to prevent multi-worker races.
    """
    async with AsyncSessionLocal() as db:
        try:
            # Transaction advisory lock (ID: 847292)
            await db.execute(text("SELECT pg_advisory_xact_lock(847292);"))
            result = await db.execute(
                select(User).where(User.username == settings.ADMIN_USERNAME)
            )
            existing = result.scalar_one_or_none()

            if existing is None:
                # Fallback check for user id=1 in case ADMIN_USERNAME was renamed in .env
                res_id1 = await db.execute(select(User).where(User.id == 1))
                existing = res_id1.scalar_one_or_none()

            if existing is None:
                admin_user = User(
                    username=settings.ADMIN_USERNAME,
                    email=settings.ADMIN_EMAIL,
                    hashed_password=hash_password(settings.ADMIN_PASSWORD),
                    full_name=settings.ADMIN_FULL_NAME,
                    role=UserRole.GisAdmin,
                    is_active=True,
                )
                db.add(admin_user)
                await db.commit()
                print(f"[INIT] Default superuser '{settings.ADMIN_USERNAME}' created successfully.")
            else:
                # Synchronize credentials from .env to the existing superuser
                existing.username = settings.ADMIN_USERNAME
                existing.email = settings.ADMIN_EMAIL
                existing.full_name = settings.ADMIN_FULL_NAME
                existing.hashed_password = hash_password(settings.ADMIN_PASSWORD)
                existing.is_active = True
                existing.role = UserRole.GisAdmin
                await db.commit()
                print(f"[INIT] Superuser '{settings.ADMIN_USERNAME}' credentials synchronized from .env.")
        except Exception as e:
            await db.rollback()
            # If another worker seeded simultaneously, that is expected
            print(f"[INIT] Superuser seed handled cleanly.")


async def backfill_mbtiles_centers():
    """
    One-time startup task: scan all MBTilesPackage records that have center=NULL,
    re-read center metadata from the .mbtiles SQLite file, and update the DB.
    """
    from app.tileserver import extract_mbtiles_metadata, TILESERVER_DATA_DIR

    async with AsyncSessionLocal() as db:
        try:
            await db.execute(text("SELECT pg_advisory_xact_lock(847293);"))
            result = await db.execute(
                select(MBTilesPackage).where(MBTilesPackage.center.is_(None))
            )
            packages = result.scalars().all()

            if not packages:
                return

            updated = 0
            for pkg in packages:
                try:
                    meta = extract_mbtiles_metadata(pkg.filename)
                    center = meta.get("center")
                    if center:
                        pkg.center = center
                        updated += 1
                except Exception:
                    pass

            if updated > 0:
                await db.commit()
                print(f"[INIT] Backfilled center metadata for {updated} MBTiles packages.")
        except Exception as e:
            await db.rollback()
            print(f"[INIT] MBTiles center backfill handled: {e}")

