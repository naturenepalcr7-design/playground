"""
KMC-GIS-SERVER Geofence Engine
Server-side 50m proximity enforcement and grid containment using PostGIS.
"""

import json
from typing import Optional, Union, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.config import get_settings
from app.models import User, UserRole

settings = get_settings()
GEOFENCE_RADIUS = settings.GEOFENCE_RADIUS_METERS  # 50.0 meters


async def verify_collector_grid_containment(
    db: AsyncSession,
    user: User,
    layer_id: int,
    geom_geojson: Union[Dict[str, Any], str],
    feature_id: Optional[int] = None,
) -> bool:
    """
    Strictly verify that a DataCollector's feature geometry is contained within
    or intersects one of their assigned task grids (or assigned project boundary if no grids exist).
    GisAdmin and Validator always bypass this check.
    """
    if user.role != UserRole.DataCollector:
        return True

    geom_json_str = json.dumps(geom_geojson) if isinstance(geom_geojson, dict) else str(geom_geojson)

    # 1. Find projects assigned to this user that include this layer
    # Layer can be project-scoped (layer.project_id) or assigned via ProjectLayerAssignment
    layer_proj_query = text("""
        SELECT DISTINCT p.id, p.name, (SELECT COUNT(tg.id) FROM task_grids tg WHERE tg.project_id = p.id) as grid_count
        FROM survey_projects p
        JOIN project_collector_assignments pca ON pca.project_id = p.id
        LEFT JOIN project_layer_assignments pla ON pla.project_id = p.id
        LEFT JOIN vector_layers vl ON (vl.id = :layer_id AND vl.project_id = p.id)
        WHERE pca.user_id = :user_id
          AND (pla.layer_id = :layer_id OR vl.id = :layer_id)
    """)
    res = await db.execute(layer_proj_query, {"user_id": user.id, "layer_id": layer_id})
    assigned_projects = res.fetchall()

    if not assigned_projects:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="पहुँच अस्वीकृत: यो तह तपाईंलाई तोकिएको कुनै पनि परियोजनासँग सम्बन्धित छैन। (Access denied: This layer is not linked to any of your assigned projects.)",
        )

    # 2. For each assigned project associated with this layer:
    # If the project has task grids, check if the geometry intersects an assigned task grid.
    # If no task grids exist in the project, check if the geometry intersects the project boundary.
    is_valid = False
    has_grids_in_any = False

    for proj in assigned_projects:
        grid_count = proj.grid_count or 0
        if grid_count > 0:
            has_grids_in_any = True
            grid_check_query = text("""
                SELECT tg.id, tg.grid_index, tg.name
                FROM task_grids tg
                WHERE tg.project_id = :project_id
                  AND tg.assigned_to = :user_id
                  AND ST_Intersects(
                      tg.geom,
                      ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(:geom_json)), 4326)
                  )
                LIMIT 1;
            """)
            g_res = await db.execute(grid_check_query, {"project_id": proj.id, "user_id": user.id, "geom_json": geom_json_str})
            matched_grid = g_res.fetchone()
            if matched_grid:
                is_valid = True
                break
        else:
            # Project has no grids: check project boundary
            proj_boundary_query = text("""
                SELECT sp.id
                FROM survey_projects sp
                WHERE sp.id = :project_id
                  AND (
                      sp.boundary IS NULL
                      OR ST_Intersects(
                          sp.boundary,
                          ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(:geom_json)), 4326)
                      )
                  )
                LIMIT 1;
            """)
            p_res = await db.execute(proj_boundary_query, {"project_id": proj.id, "geom_json": geom_json_str})
            matched_proj = p_res.fetchone()
            if matched_proj:
                is_valid = True
                break

    if not is_valid:
        if has_grids_in_any:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="पहुँच अस्वीकृत: तपाईंले आफूलाई तोकिएको कार्यक्षेत्र (ग्रिड) भित्रका फिचरहरू मात्र सम्पादन वा सिर्जना गर्न सक्नुहुन्छ। (Access denied: You can only edit or create features strictly within your assigned task grids.)",
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="पहुँच अस्वीकृत: यो फिचर तपाईंलाई तोकिएको परियोजनाको सिमाना भन्दा बाहिर छ। (Access denied: Feature is outside your assigned project boundary.)",
            )

    return True


async def verify_task_proximity(
    db: AsyncSession,
    user_role: str,
    collector_lat: float,
    collector_lng: float,
    task_id: int,
) -> bool:
    """
    Verify that a DataCollector's GPS position is within 50m of a task grid boundary.
    GisAdmin always bypasses this check.

    Uses ST_DWithin with ::geography cast for geodetic (spherical) distance in meters.
    """
    if user_role == UserRole.GisAdmin.value or user_role == UserRole.GisAdmin:
        return True

    if collector_lat is None or collector_lng is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GPS coordinates (collector_lat, collector_lng) are required for DataCollector operations.",
        )

    # Validate coordinate bounds
    if not (-90.0 <= collector_lat <= 90.0) or not (-180.0 <= collector_lng <= 180.0):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid GPS coordinates: latitude must be [-90, 90], longitude must be [-180, 180].",
        )

    query = text("""
        SELECT ST_DWithin(
            tg.geom::geography,
            ST_SetSRID(ST_Point(:lng, :lat), 4326)::geography,
            :radius
        ) AS within_range
        FROM task_grids tg
        WHERE tg.id = :task_id
    """)

    result = await db.execute(
        query,
        {"lng": collector_lng, "lat": collector_lat, "radius": GEOFENCE_RADIUS, "task_id": task_id},
    )
    row = result.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task grid {task_id} not found.",
        )

    if not row.within_range:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Access denied: Your GPS position ({collector_lat}, {collector_lng}) "
                f"is beyond {GEOFENCE_RADIUS}m from task grid #{task_id}. "
                f"Move closer to the task area to perform this action."
            ),
        )

    return True


async def verify_feature_proximity(
    db: AsyncSession,
    user_role: str,
    collector_lat: float,
    collector_lng: float,
    feature_id: int,
) -> bool:
    """
    Verify that a DataCollector's GPS position is within 50m of an existing feature.
    Used when updating/editing existing features.
    GisAdmin always bypasses.
    """
    if user_role == UserRole.GisAdmin.value or user_role == UserRole.GisAdmin:
        return True

    if collector_lat is None or collector_lng is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GPS coordinates (collector_lat, collector_lng) are required for DataCollector operations.",
        )

    query = text("""
        SELECT ST_DWithin(
            vf.geom::geography,
            ST_SetSRID(ST_Point(:lng, :lat), 4326)::geography,
            :radius
        ) AS within_range
        FROM vector_features vf
        WHERE vf.id = :feature_id
    """)

    result = await db.execute(
        query,
        {"lng": collector_lng, "lat": collector_lat, "radius": GEOFENCE_RADIUS, "feature_id": feature_id},
    )
    row = result.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feature {feature_id} not found.",
        )

    if not row.within_range:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Access denied: Your GPS position ({collector_lat}, {collector_lng}) "
                f"is beyond {GEOFENCE_RADIUS}m from feature #{feature_id}. "
                f"Move closer to the feature to edit it."
            ),
        )

    return True


async def verify_new_feature_proximity(
    db: AsyncSession,
    user_role: str,
    collector_lat: float,
    collector_lng: float,
    geom_wkt: str,
) -> bool:
    """
    Verify that a DataCollector's GPS position is within 50m of a new feature's geometry.
    Used when creating new features.
    """
    if user_role == UserRole.GisAdmin.value or user_role == UserRole.GisAdmin:
        return True

    if collector_lat is None or collector_lng is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GPS coordinates (collector_lat, collector_lng) are required for DataCollector operations.",
        )

    query = text("""
        SELECT ST_DWithin(
            ST_GeomFromText(:geom_wkt, 4326)::geography,
            ST_SetSRID(ST_Point(:lng, :lat), 4326)::geography,
            :radius
        ) AS within_range
    """)

    result = await db.execute(
        query,
        {"geom_wkt": geom_wkt, "lng": collector_lng, "lat": collector_lat, "radius": GEOFENCE_RADIUS},
    )
    row = result.fetchone()

    if not row or not row.within_range:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Access denied: Your GPS position ({collector_lat}, {collector_lng}) "
                f"is beyond {GEOFENCE_RADIUS}m from the new feature location. "
                f"Move closer to create features in this area."
            ),
        )

    return True


async def verify_double_geofence(
    db: AsyncSession,
    user_role: str,
    collector_lat: float,
    collector_lng: float,
    task_id: int,
    feature_id: int = None,
    new_geom_wkt: str = None,
) -> bool:
    """
    Double geofence check: Verifies proximity to BOTH the task grid AND the feature.
    """
    if user_role == UserRole.GisAdmin.value or user_role == UserRole.GisAdmin:
        return True

    # Check 1: Within 50m of task grid
    await verify_task_proximity(db, user_role, collector_lat, collector_lng, task_id)

    # Check 2: Within 50m of feature (existing or new)
    if feature_id is not None:
        await verify_feature_proximity(db, user_role, collector_lat, collector_lng, feature_id)
    elif new_geom_wkt is not None:
        await verify_new_feature_proximity(db, user_role, collector_lat, collector_lng, new_geom_wkt)

    return True
