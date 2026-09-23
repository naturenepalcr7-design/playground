"""
KMC-GIS-SERVER — Tracking Router
Real-time GPS tracking: location ping, active collector listing, and location history.
"""

import json
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
import redis.asyncio as aioredis

from app.database import get_db
from app.models import (
    User, UserRole,
    CollectorLiveLocation, CollectorLocationLog,
    ProjectCollectorAssignment, SurveyProject, TaskGrid, TaskStatus,
)
from app.schemas import (
    LocationPingRequest, CollectorStatusUpdateRequest, CollectorLocationResponse,
    CollectorLocationHistoryItem, MessageResponse,
)
from app.auth import get_current_user, require_role, get_redis
from app.helpers import get_user_accessible_project_ids

router = APIRouter(prefix="/api/tracking", tags=["Tracking"])


# ============================================================
# 0. Collector Activity Status (Active / Inactive / Background)
# ============================================================

@router.post("/status", response_model=MessageResponse)
async def update_collector_status(
    body: CollectorStatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update collector live activity state immediately (e.g. active, inactive, background).
    Called on browser visibilitychange, beforeunload, and pagehide beacons.
    """
    result = await db.execute(
        select(CollectorLiveLocation).where(CollectorLiveLocation.user_id == current_user.id)
    )
    live_loc = result.scalar_one_or_none()

    if live_loc:
        live_loc.is_online = body.is_online
        live_loc.app_state = body.app_state
        live_loc.last_seen = func.now()
        if body.latitude is not None and body.longitude is not None:
            live_loc.latitude = body.latitude
            live_loc.longitude = body.longitude
            live_loc.geom = func.ST_SetSRID(func.ST_MakePoint(body.longitude, body.latitude), 4326)
    else:
        if body.latitude is not None and body.longitude is not None:
            point_geom = func.ST_SetSRID(func.ST_MakePoint(body.longitude, body.latitude), 4326)
            live_loc = CollectorLiveLocation(
                user_id=current_user.id,
                latitude=body.latitude,
                longitude=body.longitude,
                geom=point_geom,
                is_online=body.is_online,
                app_state=body.app_state,
                last_seen=func.now(),
            )
            db.add(live_loc)

    await db.flush()

    # Clear or update Redis cache
    try:
        redis_client = await get_redis()
        if not body.is_online or body.app_state in ("inactive", "background"):
            await redis_client.delete(f"collector_location:{current_user.id}")
    except Exception:
        pass

    return MessageResponse(message=f"Status set to {body.app_state}")


# ============================================================
# 1. GPS Location Ping (Data Collectors & Field Surveyors)
# ============================================================

@router.post("/ping", response_model=MessageResponse)
async def tracking_ping(
    body: LocationPingRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Accept a real-time GPS ping from an authenticated field user.
    Upserts their live location and appends a breadcrumb to the location log.
    """
    point_geom = func.ST_SetSRID(func.ST_MakePoint(body.longitude, body.latitude), 4326)

    # Upsert live location record
    result = await db.execute(
        select(CollectorLiveLocation).where(CollectorLiveLocation.user_id == current_user.id)
    )
    live_loc = result.scalar_one_or_none()

    if live_loc:
        live_loc.latitude = body.latitude
        live_loc.longitude = body.longitude
        live_loc.geom = point_geom
        live_loc.accuracy = body.accuracy
        live_loc.altitude = body.altitude
        live_loc.heading = body.heading
        live_loc.speed = body.speed
        live_loc.battery_level = body.battery_level
        live_loc.is_online = True
        live_loc.last_seen = func.now()
        live_loc.app_state = body.app_state or "active"
        live_loc.device_info = body.device_info
    else:
        live_loc = CollectorLiveLocation(
            user_id=current_user.id,
            latitude=body.latitude,
            longitude=body.longitude,
            geom=point_geom,
            accuracy=body.accuracy,
            altitude=body.altitude,
            heading=body.heading,
            speed=body.speed,
            battery_level=body.battery_level,
            is_online=True,
            last_seen=func.now(),
            app_state=body.app_state or "active",
            device_info=body.device_info,
        )
        db.add(live_loc)

    # Append breadcrumb to location history log
    log = CollectorLocationLog(
        user_id=current_user.id,
        latitude=body.latitude,
        longitude=body.longitude,
        geom=point_geom,
        accuracy=body.accuracy,
        speed=body.speed,
        heading=body.heading,
        timestamp=func.now(),
    )
    db.add(log)
    await db.flush()

    # Cache latest coordinate in Redis for quick lookup
    try:
        redis_client = await get_redis()
        await redis_client.setex(
            f"collector_location:{current_user.id}",
            300,
            json.dumps({
                "user_id": current_user.id,
                "username": current_user.username,
                "full_name": current_user.full_name,
                "lat": body.latitude,
                "lng": body.longitude,
                "accuracy": body.accuracy,
                "heading": body.heading,
                "speed": body.speed,
            }),
        )
    except Exception:
        pass

    return MessageResponse(message="Location updated")


# ============================================================
# 2. Get Live Collector Locations List
# ============================================================

@router.get("/collectors", response_model=List[CollectorLocationResponse])
async def get_collector_locations(
    project_id: Optional[int] = Query(None),
    stale_minutes: int = Query(30, description="Consider stale after this many minutes of no updates"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get live locations of active Data Collectors and field surveyors.
    Accessible to GisAdmin, Validator, and DataCollectors within their assigned project(s).
    """
    query = (
        select(
            CollectorLiveLocation.user_id,
            CollectorLiveLocation.latitude,
            CollectorLiveLocation.longitude,
            CollectorLiveLocation.accuracy,
            CollectorLiveLocation.altitude,
            CollectorLiveLocation.heading,
            CollectorLiveLocation.speed,
            CollectorLiveLocation.battery_level,
            CollectorLiveLocation.is_online,
            CollectorLiveLocation.app_state,
            CollectorLiveLocation.last_seen,
            User.username,
            User.full_name,
            User.email,
            User.role,
        )
        .join(User, CollectorLiveLocation.user_id == User.id)
    )

    # Access control: DataCollector only sees collectors in assigned projects
    if current_user.role == UserRole.DataCollector:
        accessible_pids = await get_user_accessible_project_ids(db, current_user)
        if not accessible_pids:
            return []
        if project_id is not None:
            if project_id not in accessible_pids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied. You are not assigned to this project."
                )
            target_pids = [project_id]
        else:
            target_pids = accessible_pids

        query = query.where(
            CollectorLiveLocation.user_id.in_(
                select(ProjectCollectorAssignment.user_id).where(
                    ProjectCollectorAssignment.project_id.in_(target_pids)
                )
            )
        )
    elif project_id is not None:
        query = query.where(
            CollectorLiveLocation.user_id.in_(
                select(ProjectCollectorAssignment.user_id).where(
                    ProjectCollectorAssignment.project_id == project_id
                )
            )
        )

    result = await db.execute(query)
    rows = result.all()

    now = datetime.now(timezone.utc)
    collectors = []

    for r in rows:
        # Calculate minutes ago and determine active/online status
        if r.last_seen:
            dt = r.last_seen if r.last_seen.tzinfo else r.last_seen.replace(tzinfo=timezone.utc)
            seconds_ago = max(0, int((now - dt).total_seconds()))
            minutes_ago = max(0, seconds_ago // 60)
            is_stale = seconds_ago > (stale_minutes * 60)
            # Active ONLY if is_online is True, app_state is 'active', and ping is not stale
            is_active = bool(r.is_online and (r.app_state == "active") and not is_stale)
            effective_app_state = r.app_state if not is_stale else "inactive"
        else:
            minutes_ago = None
            is_active = False
            effective_app_state = "inactive"

        # Assigned projects for this collector
        proj_q = await db.execute(
            select(SurveyProject.id, SurveyProject.name, SurveyProject.status)
            .join(ProjectCollectorAssignment, ProjectCollectorAssignment.project_id == SurveyProject.id)
            .where(ProjectCollectorAssignment.user_id == r.user_id)
        )
        assigned_projects = [
            {"id": p_id, "name": p_name, "status": p_status.value if hasattr(p_status, 'value') else str(p_status)}
            for p_id, p_name, p_status in proj_q.all()
        ]

        # Total assigned tasks
        task_cnt_q = await db.execute(
            select(func.count(TaskGrid.id)).where(TaskGrid.assigned_to == r.user_id)
        )
        assigned_count = task_cnt_q.scalar() or 0

        # Currently locked active task
        active_task_q = await db.execute(
            select(TaskGrid.id, TaskGrid.grid_index, TaskGrid.status, TaskGrid.project_id)
            .where(and_(TaskGrid.locked_by == r.user_id, TaskGrid.status == TaskStatus.LOCKED_FOR_MAPPING))
            .limit(1)
        )
        active_row = active_task_q.one_or_none()
        active_task = (
            {
                "id": active_row.id,
                "grid_index": active_row.grid_index,
                "status": active_row.status.value,
                "project_id": active_row.project_id,
            }
            if active_row
            else None
        )

        collectors.append(
            CollectorLocationResponse(
                user_id=r.user_id,
                username=r.username,
                full_name=r.full_name,
                email=r.email,
                role=r.role.value if hasattr(r.role, 'value') else str(r.role),
                latitude=r.latitude,
                longitude=r.longitude,
                accuracy=r.accuracy,
                altitude=r.altitude,
                heading=r.heading,
                speed=r.speed,
                battery_level=r.battery_level,
                is_online=is_active,
                app_state=effective_app_state,
                last_seen=r.last_seen,
                minutes_ago=minutes_ago,
                assigned_projects=assigned_projects,
                assigned_tasks_count=assigned_count,
                active_task=active_task,
            )
        )

    return collectors


# ============================================================
# 3. Collector Locations as GeoJSON FeatureCollection
# ============================================================

@router.get("/collectors/geojson")
async def get_collector_locations_geojson(
    project_id: Optional[int] = Query(None),
    stale_minutes: int = Query(30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get live collector locations formatted as a GeoJSON FeatureCollection for direct map overlays.
    """
    query = (
        select(
            CollectorLiveLocation.user_id,
            CollectorLiveLocation.latitude,
            CollectorLiveLocation.longitude,
            CollectorLiveLocation.accuracy,
            CollectorLiveLocation.heading,
            CollectorLiveLocation.speed,
            CollectorLiveLocation.last_seen,
            CollectorLiveLocation.is_online,
            CollectorLiveLocation.app_state,
            User.username,
            User.full_name,
            User.role,
        )
        .join(User, CollectorLiveLocation.user_id == User.id)
    )

    if current_user.role == UserRole.DataCollector:
        accessible_pids = await get_user_accessible_project_ids(db, current_user)
        if not accessible_pids:
            return {"type": "FeatureCollection", "features": []}
        target_pids = [project_id] if project_id and project_id in accessible_pids else accessible_pids
        query = query.where(
            CollectorLiveLocation.user_id.in_(
                select(ProjectCollectorAssignment.user_id).where(
                    ProjectCollectorAssignment.project_id.in_(target_pids)
                )
            )
        )
    elif project_id is not None:
        query = query.where(
            CollectorLiveLocation.user_id.in_(
                select(ProjectCollectorAssignment.user_id).where(
                    ProjectCollectorAssignment.project_id == project_id
                )
            )
        )

    result = await db.execute(query)
    rows = result.all()

    now = datetime.now(timezone.utc)
    features = []

    for r in rows:
        if r.last_seen:
            dt = r.last_seen if r.last_seen.tzinfo else r.last_seen.replace(tzinfo=timezone.utc)
            seconds_ago = max(0, int((now - dt).total_seconds()))
            minutes_ago = max(0, seconds_ago // 60)
            is_stale = seconds_ago > (stale_minutes * 60)
            is_active = bool(r.is_online and (r.app_state == "active") and not is_stale)
            effective_app_state = r.app_state if not is_stale else "inactive"
        else:
            is_stale = True
            is_active = False
            effective_app_state = "inactive"

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [r.longitude, r.latitude],
            },
            "properties": {
                "user_id": r.user_id,
                "username": r.username,
                "full_name": r.full_name,
                "role": r.role.value if hasattr(r.role, 'value') else str(r.role),
                "accuracy": r.accuracy,
                "heading": r.heading,
                "speed": r.speed,
                "last_seen": r.last_seen.isoformat() if r.last_seen else None,
                "is_online": is_active,
                "app_state": effective_app_state,
                "is_stale": is_stale,
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }


# ============================================================
# 4. Collector GPS Track History
# ============================================================

@router.get("/collectors/{user_id}/history", response_model=List[CollectorLocationHistoryItem])
async def get_collector_history(
    user_id: int,
    hours: int = Query(24, description="Retrieve location history from the last N hours"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get GPS breadcrumb history for a specific collector.
    GisAdmin and Validator can view any collector; DataCollectors can only view their own history.
    """
    if current_user.role not in (UserRole.GisAdmin, UserRole.Validator) and current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You can only view your own GPS track history."
        )

    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    result = await db.execute(
        select(CollectorLocationLog)
        .where(
            and_(
                CollectorLocationLog.user_id == user_id,
                CollectorLocationLog.timestamp >= since,
            )
        )
        .order_by(CollectorLocationLog.timestamp.asc())
    )

    return [
        CollectorLocationHistoryItem(
            latitude=log.latitude,
            longitude=log.longitude,
            accuracy=log.accuracy,
            speed=log.speed,
            heading=log.heading,
            timestamp=log.timestamp,
        )
        for log in result.scalars().all()
    ]
