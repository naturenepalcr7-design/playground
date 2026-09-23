"""
KMC-GIS-SERVER — Users Router
User CRUD and user-project assignment endpoints (GisAdmin only).
"""

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_

from app.database import get_db
from app.models import (
    User, UserRole, SurveyProject, TaskGrid,
    ProjectCollectorAssignment,
)
from app.schemas import (
    UserCreate, UserResponse, UserUpdate,
    CollectorProjectResponse, MessageResponse,
)
from app.auth import hash_password, get_current_user, require_role
from app.helpers import log_audit

router = APIRouter(prefix="/api", tags=["Users"])


@router.post("/users", response_model=UserResponse)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Create a new user (GisAdmin only)."""
    # Check uniqueness
    existing = await db.execute(
        select(User).where(or_(User.username == body.username, User.email == body.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username or email already exists")

    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=UserRole(body.role),
        is_active=True,
    )
    db.add(user)
    await db.flush()

    await log_audit(db, admin.id, "CREATE_USER", "User", user.id, {"role": body.role})
    return user


@router.get("/users", response_model=List[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """List all users (GisAdmin only)."""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return result.scalars().all()


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Get a specific user by ID (GisAdmin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Update a user (GisAdmin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    update_data = body.model_dump(exclude_unset=True)
    if "role" in update_data:
        update_data["role"] = UserRole(update_data["role"])

    for key, value in update_data.items():
        setattr(user, key, value)

    await log_audit(db, admin.id, "UPDATE_USER", "User", user_id, update_data)
    return user


@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Deactivate a user (soft delete, GisAdmin only)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate yourself")

    user.is_active = False
    await log_audit(db, admin.id, "DEACTIVATE_USER", "User", user_id)
    return MessageResponse(message=f"User {user.username} deactivated")


@router.get("/users/{user_id}/projects", response_model=List[CollectorProjectResponse])
async def list_user_assigned_projects(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get list of projects assigned to a user (GisAdmin or the user themselves)."""
    if current_user.role != UserRole.GisAdmin and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    query = (
        select(
            SurveyProject.id.label("project_id"),
            SurveyProject.name.label("project_name"),
            SurveyProject.status,
            ProjectCollectorAssignment.assigned_at,
        )
        .join(ProjectCollectorAssignment, ProjectCollectorAssignment.project_id == SurveyProject.id)
        .where(ProjectCollectorAssignment.user_id == user_id)
        .order_by(ProjectCollectorAssignment.assigned_at.desc())
    )
    result = await db.execute(query)
    rows = result.all()

    projects = []
    for r in rows:
        task_count_res = await db.execute(
            select(func.count(TaskGrid.id)).where(
                and_(TaskGrid.project_id == r.project_id, TaskGrid.assigned_to == user_id)
            )
        )
        task_count = task_count_res.scalar() or 0
        projects.append(CollectorProjectResponse(
            project_id=r.project_id,
            project_name=r.project_name,
            status=r.status.value if hasattr(r.status, 'value') else str(r.status),
            assigned_at=r.assigned_at,
            assigned_tasks_count=task_count,
        ))
    return projects
