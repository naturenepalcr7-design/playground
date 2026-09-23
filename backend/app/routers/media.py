"""
KMC-GIS-SERVER — Media Router
Media attachment upload and retrieval endpoints.
"""

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.config import get_settings
from app.models import User, MediaAttachment
from app.auth import get_current_user

router = APIRouter(prefix="/api/media", tags=["Media"])

settings = get_settings()


@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    feature_id: int = Form(None),
    task_id: int = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a media file (image, audio, etc.) and attach to a feature or task."""
    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_name = file.filename.replace(" ", "_")
    saved_name = f"u{current_user.id}_{timestamp}_{safe_name}"
    file_path = os.path.join(upload_dir, saved_name)

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    media = MediaAttachment(
        filename=saved_name,
        original_filename=file.filename,
        content_type=file.content_type or "application/octet-stream",
        file_size=len(content),
        feature_id=feature_id,
        task_id=task_id,
        uploaded_by=current_user.id,
    )
    db.add(media)
    await db.flush()

    return {
        "id": media.id,
        "filename": media.filename,
        "original_filename": media.original_filename,
        "content_type": media.content_type,
        "file_size": media.file_size,
        "download_url": f"/api/media/{media.id}",
    }


@router.get("/{media_id}")
async def get_media(
    media_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Download / view a media file by ID."""
    result = await db.execute(select(MediaAttachment).where(MediaAttachment.id == media_id))
    media = result.scalar_one_or_none()
    if not media:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")

    file_path = os.path.join(settings.UPLOAD_DIR, media.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on disk")

    return FileResponse(
        path=file_path,
        filename=media.original_filename,
        media_type=media.content_type,
    )
