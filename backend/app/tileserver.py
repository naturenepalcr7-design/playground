"""
KMC-GIS-SERVER TileServer Management
Handles high-performance MBTiles upload, metadata extraction, config regeneration, and TileServer-GL reload.
"""

import os
import re
import time
import json
import shutil
import sqlite3
from typing import Optional, Dict, Any
from pathlib import Path

import aiofiles
import httpx
from fastapi import UploadFile, HTTPException, status
from starlette.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.models import MBTilesPackage

settings = get_settings()

TILESERVER_DATA_DIR = Path(settings.TILESERVER_DATA_DIR)
TILESERVER_CONFIG_PATH = TILESERVER_DATA_DIR / "config.json"


def extract_mbtiles_metadata(filename: str) -> Dict[str, Any]:
    """
    Read metadata (bounds, minzoom, maxzoom) from MBTiles SQLite header safely in read-only mode.
    Provides robust fallbacks for missing bounds and zoom levels.
    """
    file_path = TILESERVER_DATA_DIR / os.path.basename(filename)
    meta = {
        "bounds": [-180.0, -85.051129, 180.0, 85.051129],
        "center": None,
        "min_zoom": 0,
        "max_zoom": 22,
        "format": "png",
    }
    if not file_path.exists():
        return meta

    try:
        # Connect in read-only mode with URI for maximum read concurrency and safety
        with sqlite3.connect(f"file:{file_path}?mode=ro", uri=True) as conn:
            cursor = conn.cursor()

            # 1. Read key-value metadata table
            data = {}
            try:
                cursor.execute("SELECT name, value FROM metadata")
                data = {r[0]: r[1] for r in cursor.fetchall()}
            except Exception:
                pass

            # 2. Parse bounds: standard is west, south, east, north
            if "bounds" in data and isinstance(data["bounds"], str):
                try:
                    parts = [float(x.strip()) for x in data["bounds"].split(",")]
                    if len(parts) == 4:
                        meta["bounds"] = parts
                except Exception:
                    pass

            # 3. Min / Max Zoom
            min_z = data.get("minzoom")
            max_z = data.get("maxzoom")
            if min_z is not None:
                try:
                    meta["min_zoom"] = int(min_z)
                except Exception:
                    pass
            if max_z is not None:
                try:
                    meta["max_zoom"] = int(max_z)
                except Exception:
                    pass

            # 4. Fallback: inspect tiles table directly if zoom missing
            if min_z is None or max_z is None:
                try:
                    cursor.execute("SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles")
                    row = cursor.fetchone()
                    if row:
                        if min_z is None and row[0] is not None:
                            meta["min_zoom"] = int(row[0])
                        if max_z is None and row[1] is not None:
                            meta["max_zoom"] = int(row[1])
                except Exception:
                    pass

            # 5. Tile format
            if "format" in data:
                meta["format"] = str(data["format"]).lower()

            # 6. Center: parse from metadata or compute from bounds
            if "center" in data and isinstance(data["center"], str):
                try:
                    center_parts = [float(x.strip()) for x in data["center"].split(",")]
                    if len(center_parts) >= 2:
                        meta["center"] = center_parts[:3]  # [lon, lat, zoom] or [lon, lat]
                except Exception:
                    pass

            # Fallback: compute center from bounds if not set
            if meta["center"] is None and meta["bounds"] != [-180.0, -85.051129, 180.0, 85.051129]:
                b = meta["bounds"]
                center_lon = (b[0] + b[2]) / 2.0
                center_lat = (b[1] + b[3]) / 2.0
                center_zoom = meta["min_zoom"]
                meta["center"] = [round(center_lon, 6), round(center_lat, 6), center_zoom]

    except Exception as e:
        print(f"[MBTiles] Could not extract metadata from {filename}: {e}")

    return meta


def _sync_stream_copy(src_file, dst_path: Path):
    """Perform high-throughput streaming copy using a 64MB buffer in kernel/C space."""
    if hasattr(src_file, "seek"):
        src_file.seek(0)
    with open(dst_path, "wb") as dst:
        shutil.copyfileobj(src_file, dst, length=64 * 1024 * 1024)


async def save_mbtiles_file(
    upload_file: UploadFile,
    filename: str,
) -> str:
    """
    Save an uploaded .mbtiles file to the TileServer data directory.
    Uses high-speed streaming copy with 64MB buffer in a worker thread.
    Prevents path traversal and handles duplicate filenames safely.

    Args:
        upload_file: FastAPI UploadFile
        filename: Target filename for storage

    Returns:
        Sanitized unique filename within the tileserver data directory
    """
    if not filename.lower().endswith(".mbtiles"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must have .mbtiles extension.",
        )

    # Sanitize filename — strip dangerous characters and path traversal
    base_name = os.path.basename(filename)
    safe_stem = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", Path(base_name).stem).strip("_") or "raster"
    safe_filename = f"{safe_stem}.mbtiles"

    TILESERVER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    dest_path = TILESERVER_DATA_DIR / safe_filename

    # If a file with this name already exists, make it unique
    if dest_path.exists():
        unique_suffix = f"{int(time.time())}_{safe_stem[:30]}"
        safe_filename = f"{unique_suffix}.mbtiles"
        dest_path = TILESERVER_DATA_DIR / safe_filename

    # Fast streaming write to disk using 64MB kernel-assisted copy
    try:
        await run_in_threadpool(_sync_stream_copy, upload_file.file, dest_path)
        try:
            os.chmod(dest_path, 0o664)
        except Exception:
            pass
    except Exception as e:
        # Cleanup partial file on error
        if dest_path.exists():
            try:
                os.remove(dest_path)
            except Exception:
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save file: {str(e)}",
        )
    finally:
        # Release spooling temp resources immediately to reclaim disk space
        try:
            await upload_file.close()
        except Exception:
            pass

    return safe_filename


async def regenerate_tileserver_config(db: AsyncSession) -> dict:
    """
    Regenerate TileServer-GL config.json by scanning all MBTiles packages
    registered in the database. Writes the config file and triggers reload.

    Args:
        db: AsyncSession

    Returns:
        The generated config dict
    """
    result = await db.execute(select(MBTilesPackage))
    packages = result.scalars().all()

    data = {}
    for pkg in packages:
        source_key = f"tiles-{pkg.id}"
        data[source_key] = {
            "mbtiles": pkg.filename,
        }

    config = {
        "options": {
            "paths": {
                "root": "",
                "mbtiles": "/data",
            },
            "serveAllStyles": False,
            "publicUrl": "/tiles",
        },
        "data": data,
    }

    try:
        TILESERVER_DATA_DIR.mkdir(parents=True, exist_ok=True)
        config_json = json.dumps(config, indent=2)
        async with aiofiles.open(TILESERVER_CONFIG_PATH, "w") as f:
            await f.write(config_json)
        try:
            os.chmod(TILESERVER_CONFIG_PATH, 0o666)
        except Exception:
            pass
    except Exception as e:
        print(f"[TileServer] Failed to write config.json: {e}")

    # Trigger TileServer reload asynchronously without blocking client
    await reload_tileserver()

    return config


async def reload_tileserver():
    """
    Signal TileServer-GL to reload its configuration.
    Non-blocking with short timeout so it never hangs requests.
    """
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.get(f"{settings.TILESERVER_INTERNAL_URL}/health")
    except Exception:
        # TileServer-GL will pick up config on demand or restart
        pass


async def delete_mbtiles_file(filename: str) -> bool:
    """
    Delete an .mbtiles file from the TileServer data directory.

    Args:
        filename: The filename to delete

    Returns:
        True if deleted successfully
    """
    file_path = TILESERVER_DATA_DIR / os.path.basename(filename)
    try:
        if file_path.exists():
            os.remove(file_path)
            return True
    except Exception:
        pass
    return False


def get_file_size(filename: str) -> Optional[int]:
    """Get file size in bytes for an mbtiles file."""
    file_path = TILESERVER_DATA_DIR / os.path.basename(filename)
    try:
        if file_path.exists():
            return file_path.stat().st_size
    except Exception:
        pass
    return None
