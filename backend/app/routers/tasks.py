"""
KMC-GIS-SERVER — Tasks Router
Task grid listing, assignment, auto-distribution, lock/unlock, submit, and validate endpoints.
"""

import json
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, delete, and_
import redis.asyncio as aioredis

from app.database import get_db
from app.models import (
    User, UserRole, SurveyProject, ProjectStatus, TaskGrid, TaskStatus,
    ProjectCollectorAssignment,
)
from app.schemas import (
    TaskActionRequest, TaskAssignRequest, AutoDistributeRequest,
    MessageResponse,
)
from app.auth import get_current_user, require_role, get_redis
from app.helpers import log_audit, is_project_accessible_by_user
from app.geofence import verify_task_proximity

router = APIRouter(prefix="/api", tags=["Tasks"])


@router.get("/projects/{project_id}/tasks")
async def list_tasks(
    project_id: int,
    status_filter: Optional[str] = Query(None),
    collector_filter: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List task grids for a project. DataCollector only sees grids assigned to them."""
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not assigned to this project.",
        )

    query = (
        select(
            TaskGrid.id,
            TaskGrid.grid_index,
            TaskGrid.name,
            TaskGrid.status,
            TaskGrid.assigned_to,
            TaskGrid.assigned_at,
            TaskGrid.assigned_by,
            TaskGrid.properties,
            TaskGrid.locked_by,
            TaskGrid.locked_at,
            TaskGrid.mapped_at,
            TaskGrid.validated_by,
            TaskGrid.validated_at,
            func.ST_AsGeoJSON(TaskGrid.geom).label("geojson"),
            User.full_name.label("assigned_to_name"),
            User.username.label("assigned_to_username"),
        )
        .outerjoin(User, TaskGrid.assigned_to == User.id)
        .where(TaskGrid.project_id == project_id)
    )

    # CRITICAL: For Data Collectors, strictly filter to only their assigned grids!
    if current_user.role == UserRole.DataCollector:
        query = query.where(TaskGrid.assigned_to == current_user.id)
    else:
        if collector_filter:
            if collector_filter == "UNASSIGNED":
                query = query.where(TaskGrid.assigned_to.is_(None))
            elif collector_filter == "ASSIGNED":
                query = query.where(TaskGrid.assigned_to.is_not(None))
            elif collector_filter.isdigit():
                query = query.where(TaskGrid.assigned_to == int(collector_filter))

    if status_filter:
        query = query.where(TaskGrid.status == TaskStatus(status_filter))

    query = query.order_by(TaskGrid.grid_index)
    result = await db.execute(query)
    rows = result.all()

    features = []
    for row in rows:
        features.append({
            "type": "Feature",
            "id": row.id,
            "geometry": json.loads(row.geojson) if row.geojson else None,
            "properties": {
                "id": row.id,
                "grid_index": row.grid_index,
                "name": row.name or f"कार्यक्षेत्र #{row.grid_index}",
                "status": row.status.value if hasattr(row.status, 'value') else str(row.status),
                "assigned_to": row.assigned_to,
                "assigned_to_name": row.assigned_to_name or row.assigned_to_username or None,
                "assigned_at": row.assigned_at.isoformat() if row.assigned_at else None,
                "assigned_by": row.assigned_by,
                "properties": row.properties or {},
                "locked_by": row.locked_by,
                "locked_at": row.locked_at.isoformat() if row.locked_at else None,
                "mapped_at": row.mapped_at.isoformat() if row.mapped_at else None,
                "validated_by": row.validated_by,
                "validated_at": row.validated_at.isoformat() if row.validated_at else None,
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "total_count": len(features),
    }


@router.post("/projects/{project_id}/tasks/assign", response_model=MessageResponse)
async def assign_project_tasks(
    project_id: int,
    body: TaskAssignRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Assign or reassign task(s) to a Data Collector (GisAdmin only). If user_id is null, unassigns."""
    target_user = None
    if body.user_id:
        u_res = await db.execute(select(User).where(User.id == body.user_id, User.is_active == True))
        target_user = u_res.scalar_one_or_none()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target collector not found or inactive")

        # Automatically ensure the collector has a project assignment record
        existing_pca = await db.execute(
            select(ProjectCollectorAssignment).where(
                and_(ProjectCollectorAssignment.project_id == project_id,
                     ProjectCollectorAssignment.user_id == body.user_id)
            )
        )
        if not existing_pca.scalar_one_or_none():
            pca = ProjectCollectorAssignment(
                project_id=project_id,
                user_id=body.user_id,
                assigned_by=admin.id,
                assigned_at=datetime.utcnow(),
            )
            db.add(pca)

    assign_time = datetime.utcnow() if body.user_id else None
    assigner_id = admin.id if body.user_id else None

    # Chunk into batches of 500 to handle large task selections safely
    chunk_size = 500
    updated_count = 0
    for i in range(0, len(body.task_ids), chunk_size):
        chunk = body.task_ids[i:i + chunk_size]
        stmt = (
            update(TaskGrid)
            .where(
                and_(
                    TaskGrid.project_id == project_id,
                    TaskGrid.id.in_(chunk),
                )
            )
            .values(
                assigned_to=body.user_id,
                assigned_at=assign_time,
                assigned_by=assigner_id,
            )
        )
        res = await db.execute(stmt)
        updated_count += res.rowcount

    action_label = f"तोकियो ({target_user.full_name or target_user.username})" if target_user else "हटाउनु सफल भयो (Unassigned)"
    await log_audit(db, admin.id, "ASSIGN_TASKS", "SurveyProject", project_id,
                    {"task_count": len(body.task_ids), "user_id": body.user_id, "updated_count": updated_count})

    return MessageResponse(
        message=f"{updated_count} वटा कार्यक्षेत्र सफलतापूर्वक {action_label}",
        detail=f"Updated {updated_count} task(s)",
    )


@router.delete("/projects/{project_id}/tasks/reset", response_model=MessageResponse)
async def reset_project_tasks(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Reset / Delete all task grids for a project (GisAdmin only)."""
    proj_res = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = proj_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    del_res = await db.execute(
        delete(TaskGrid).where(TaskGrid.project_id == project_id)
    )
    deleted_count = del_res.rowcount

    project.boundary = None
    project.status = ProjectStatus.DRAFT
    await db.flush()

    await log_audit(db, admin.id, "RESET_TASKS", "SurveyProject", project_id, {"deleted_count": deleted_count})

    return MessageResponse(
        message=f"परियोजनाका सबै {deleted_count} कार्य ग्रिड विभाजनहरू सफलतापूर्वक हटाइयो।",
        detail=f"Deleted {deleted_count} task grid(s)"
    )


@router.post("/projects/{project_id}/tasks/auto-distribute", response_model=MessageResponse)
async def auto_distribute_project_tasks(
    project_id: int,
    body: AutoDistributeRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Auto-distribute all unassigned READY tasks evenly among selected Data Collectors (GisAdmin only)."""
    if not body.user_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one collector user ID is required")

    u_res = await db.execute(select(User).where(User.id.in_(body.user_ids), User.is_active == True))
    valid_users = u_res.scalars().all()
    if not valid_users:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid active users found")

    user_ids = [u.id for u in valid_users]

    # Ensure all selected collectors are assigned to the project
    now = datetime.utcnow()
    for u in valid_users:
        existing_pca = await db.execute(
            select(ProjectCollectorAssignment).where(
                and_(ProjectCollectorAssignment.project_id == project_id,
                     ProjectCollectorAssignment.user_id == u.id)
            )
        )
        if not existing_pca.scalar_one_or_none():
            pca = ProjectCollectorAssignment(
                project_id=project_id,
                user_id=u.id,
                assigned_by=admin.id,
                assigned_at=now,
            )
            db.add(pca)

    tasks_res = await db.execute(
        select(TaskGrid.id)
        .where(
            and_(
                TaskGrid.project_id == project_id,
                TaskGrid.assigned_to.is_(None),
                TaskGrid.status == TaskStatus.READY,
            )
        )
        .order_by(TaskGrid.grid_index)
    )
    task_ids = [row[0] for row in tasks_res.all()]

    if not task_ids:
        return MessageResponse(message="तोक्नका लागि कुनै बाँकी कार्यक्षेत्र छैन (No unassigned tasks to distribute)")

    for idx, t_id in enumerate(task_ids):
        assigned_uid = user_ids[idx % len(user_ids)]
        await db.execute(
            update(TaskGrid)
            .where(TaskGrid.id == t_id)
            .values(
                assigned_to=assigned_uid,
                assigned_at=now,
                assigned_by=admin.id,
            )
        )

    await log_audit(db, admin.id, "AUTO_DISTRIBUTE_TASKS", "SurveyProject", project_id,
                    {"total_tasks": len(task_ids), "collector_count": len(user_ids)})

    return MessageResponse(
        message=f"{len(task_ids)} वटा कार्यक्षेत्र {len(user_ids)} जना संकलकहरूमा समान रूपमा वितरण गरियो",
        detail=f"Distributed {len(task_ids)} tasks across {len(user_ids)} collectors",
    )


@router.post("/tasks/{task_id}/lock", response_model=MessageResponse)
async def lock_task(
    task_id: int,
    body: TaskActionRequest = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector)),
):
    """Lock a task for mapping. Uses Redis TTL lock + DB row lock."""
    # Row-level lock
    result = await db.execute(
        select(TaskGrid).where(TaskGrid.id == task_id).with_for_update()
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    # Assignment and project check for DataCollector
    if current_user.role == UserRole.DataCollector:
        if task.assigned_to != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="यो कार्यक्षेत्र तपाईंलाई तोकिएको छैन (This task is not assigned to you)",
            )
        if not await is_project_accessible_by_user(db, current_user, task.project_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. You are not assigned to this project.",
            )

    # Geofence check for DataCollector
    if current_user.role == UserRole.DataCollector:
        if not body or body.collector_lat is None or body.collector_lng is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="GPS coordinates required for DataCollector")
        await verify_task_proximity(db, current_user.role.value,
                                    body.collector_lat, body.collector_lng, task_id)

    if task.status != TaskStatus.READY and task.status != TaskStatus.INVALIDATED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Task cannot be locked — current status: {task.status.value}")

    # Redis distributed lock (TTL 2 hours)
    try:
        redis_client = await get_redis()
        lock_key = f"task_lock:{task_id}"
        acquired = await redis_client.set(lock_key, str(current_user.id), ex=7200, nx=True)
        if not acquired:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Task is already locked by another user")
    except aioredis.ConnectionError:
        pass  # Redis unavailable — rely on DB lock

    task.status = TaskStatus.LOCKED_FOR_MAPPING
    task.locked_by = current_user.id
    task.locked_at = datetime.utcnow()

    return MessageResponse(message=f"Task #{task.grid_index} locked for mapping")


@router.post("/tasks/{task_id}/unlock", response_model=MessageResponse)
async def unlock_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Unlock a task (return to READY). Only locker or admin can unlock."""
    result = await db.execute(
        select(TaskGrid).where(TaskGrid.id == task_id).with_for_update()
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status != TaskStatus.LOCKED_FOR_MAPPING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Task is not locked for mapping")

    if task.locked_by != current_user.id and current_user.role != UserRole.GisAdmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the locker or admin can unlock")

    if current_user.role == UserRole.DataCollector and not await is_project_accessible_by_user(db, current_user, task.project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You are not assigned to this project.")

    task.status = TaskStatus.READY
    task.locked_by = None
    task.locked_at = None

    try:
        redis_client = await get_redis()
        await redis_client.delete(f"task_lock:{task_id}")
    except aioredis.ConnectionError:
        pass

    return MessageResponse(message=f"Task #{task.grid_index} unlocked")


@router.post("/tasks/{task_id}/submit", response_model=MessageResponse)
async def submit_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector)),
):
    """Submit a mapped task for validation."""
    result = await db.execute(
        select(TaskGrid).where(TaskGrid.id == task_id).with_for_update()
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status != TaskStatus.LOCKED_FOR_MAPPING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Task must be LOCKED_FOR_MAPPING — current: {task.status.value}")

    if task.locked_by != current_user.id and current_user.role != UserRole.GisAdmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the mapper or admin can submit")

    if current_user.role == UserRole.DataCollector and not await is_project_accessible_by_user(db, current_user, task.project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. You are not assigned to this project.")

    task.status = TaskStatus.MAPPED
    task.mapped_at = datetime.utcnow()

    try:
        redis_client = await get_redis()
        await redis_client.delete(f"task_lock:{task_id}")
    except aioredis.ConnectionError:
        pass

    return MessageResponse(message=f"Task #{task.grid_index} submitted for validation")


@router.post("/tasks/{task_id}/validate", response_model=MessageResponse)
async def validate_task(
    task_id: int,
    action: str = Query(..., pattern=r"^(validate|invalidate)$"),
    db: AsyncSession = Depends(get_db),
    validator: User = Depends(require_role(UserRole.GisAdmin, UserRole.Validator)),
):
    """Validate or invalidate a mapped task (Validator/GisAdmin only)."""
    result = await db.execute(
        select(TaskGrid).where(TaskGrid.id == task_id).with_for_update()
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status != TaskStatus.MAPPED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Task must be MAPPED — current: {task.status.value}")

    if action == "validate":
        task.status = TaskStatus.VALIDATED
    else:
        task.status = TaskStatus.INVALIDATED

    task.validated_by = validator.id
    task.validated_at = datetime.utcnow()

    return MessageResponse(message=f"Task #{task.grid_index} {action}d")
