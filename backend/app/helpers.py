"""
KMC-GIS-SERVER — Shared Helpers
Access control utilities and audit logging used across multiple routers.
"""

import logging
from typing import Optional, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from app.models import (
    User, UserRole, SurveyProject,
    VectorLayer, VectorFeature, MBTilesPackage,
    ProjectLayerAssignment, ProjectMBTilesAssignment, ProjectCollectorAssignment,
    TaskGrid, AuditLog,
)

logger = logging.getLogger(__name__)


# ============================================================
# Audit Logger Utility
# ============================================================

async def log_audit(db: AsyncSession, user_id: int, action: str, entity_type: str,
                    entity_id: int = None, details: dict = None, ip: str = None):
    """Insert an audit log entry."""
    audit = AuditLog(
        user_id=user_id, action=action, entity_type=entity_type,
        entity_id=entity_id, details=details, ip_address=ip,
    )
    db.add(audit)


# ============================================================
# Data Collector Access Control Helpers
# ============================================================

async def get_user_accessible_project_ids(db: AsyncSession, user: User) -> Optional[List[int]]:
    """
    Returns list of project IDs accessible to the given user.
    - GisAdmin and Validator can access all projects (returns None to indicate no filter).
    - DataCollector can access only projects explicitly assigned via ProjectCollectorAssignment
      or where they have task grids assigned to them.
    """
    if user.role in (UserRole.GisAdmin, UserRole.Validator):
        return None  # None means unrestricted access

    # 1. Projects explicitly assigned to this collector
    res1 = await db.execute(
        select(ProjectCollectorAssignment.project_id).where(ProjectCollectorAssignment.user_id == user.id)
    )
    assigned_ids = set(row[0] for row in res1.all())

    # 2. Projects where the collector has any assigned tasks
    res2 = await db.execute(
        select(TaskGrid.project_id).where(TaskGrid.assigned_to == user.id)
    )
    task_proj_ids = set(row[0] for row in res2.all())

    return list(assigned_ids | task_proj_ids)


async def is_project_accessible_by_user(db: AsyncSession, user: User, project_id: int) -> bool:
    """Check whether a specific project is accessible by the user."""
    if user.role in (UserRole.GisAdmin, UserRole.Validator):
        return True
    accessible_ids = await get_user_accessible_project_ids(db, user)
    return accessible_ids is not None and project_id in accessible_ids


async def is_layer_accessible_by_user(db: AsyncSession, user: User, layer_id: int) -> bool:
    """
    Check whether a specific vector layer is accessible by the user.
    - GisAdmin / Validator: True
    - DataCollector: True only if the layer is project-scoped to an assigned project
      or linked to an assigned project via ProjectLayerAssignment.
    """
    if user.role in (UserRole.GisAdmin, UserRole.Validator):
        return True

    accessible_project_ids = await get_user_accessible_project_ids(db, user)
    if not accessible_project_ids:
        return False

    # Check if layer is project-scoped to one of the user's projects
    res1 = await db.execute(
        select(VectorLayer.id).where(
            and_(VectorLayer.id == layer_id, VectorLayer.project_id.in_(accessible_project_ids))
        )
    )
    if res1.scalar_one_or_none() is not None:
        return True

    # Check if layer is assigned to one of the user's projects
    res2 = await db.execute(
        select(ProjectLayerAssignment.id).where(
            and_(
                ProjectLayerAssignment.layer_id == layer_id,
                ProjectLayerAssignment.project_id.in_(accessible_project_ids),
            )
        )
    )
    return res2.scalar_one_or_none() is not None


async def is_mbtiles_accessible_by_user(db: AsyncSession, user: User, mbtiles_id: int) -> bool:
    """
    Check whether a specific MBTiles package is accessible by the user.
    - GisAdmin / Validator: True
    - DataCollector: True only if project-scoped to an assigned project or linked to an assigned project.
    """
    if user.role in (UserRole.GisAdmin, UserRole.Validator):
        return True

    accessible_project_ids = await get_user_accessible_project_ids(db, user)
    if not accessible_project_ids:
        return False

    # Check direct project scope
    res1 = await db.execute(
        select(MBTilesPackage.id).where(
            and_(MBTilesPackage.id == mbtiles_id, MBTilesPackage.project_id.in_(accessible_project_ids))
        )
    )
    if res1.scalar_one_or_none() is not None:
        return True

    # Check assignment junction
    res2 = await db.execute(
        select(ProjectMBTilesAssignment.id).where(
            and_(
                ProjectMBTilesAssignment.mbtiles_id == mbtiles_id,
                ProjectMBTilesAssignment.project_id.in_(accessible_project_ids),
            )
        )
    )
    return res2.scalar_one_or_none() is not None
