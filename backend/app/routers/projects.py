"""
KMC-GIS-SERVER — Projects Router
Project CRUD, boundary upload, grid generation, asset assignments, and collector management.
"""

import json
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, delete, and_
import pyproj

from app.database import get_db
from app.models import (
    User, UserRole, SurveyProject, ProjectStatus, TaskGrid, TaskStatus,
    VectorLayer, MBTilesPackage,
    ProjectLayerAssignment, ProjectMBTilesAssignment, ProjectCollectorAssignment,
    GridType,
)
from app.schemas import (
    ProjectCreate, ProjectResponse, ProjectUpdate, GenerateGridRequest,
    BoundaryUploadResponse, AssignLayerRequest, AssignMBTilesRequest,
    AssignCollectorsRequest, ProjectCollectorResponse,
    MessageResponse,
)
from app.auth import get_current_user, require_role
from app.helpers import (
    log_audit, get_user_accessible_project_ids, is_project_accessible_by_user,
)
from app.spatial_grid import generate_grid, import_polygons_as_tasks
from app.geometry_utils import (
    detect_crs_from_geojson_or_coords,
    sanitize_and_reproject_geometry,
)

router = APIRouter(prefix="/api", tags=["Projects"])


# ---- Helper: Project Response Builder ----

async def _project_to_response(db: AsyncSession, project: SurveyProject) -> ProjectResponse:
    """Convert project ORM to response with computed fields."""
    boundary_geojson = None
    if project.boundary is not None:
        try:
            geojson_result = await db.execute(
                select(func.ST_AsGeoJSON(SurveyProject.boundary)).where(SurveyProject.id == project.id)
            )
            raw = geojson_result.scalar()
            if raw:
                boundary_geojson = json.loads(raw)
        except Exception:
            pass

    # Count tasks and progress
    task_count_result = await db.execute(
        select(func.count(TaskGrid.id)).where(TaskGrid.project_id == project.id)
    )
    task_count = task_count_result.scalar() or 0

    progress = {}
    if task_count > 0:
        status_result = await db.execute(
            select(TaskGrid.status, func.count(TaskGrid.id))
            .where(TaskGrid.project_id == project.id)
            .group_by(TaskGrid.status)
        )
        for row in status_result:
            progress[row[0].value if hasattr(row[0], 'value') else str(row[0])] = row[1]

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        boundary_geojson=boundary_geojson,
        grid_type=project.grid_type.value if project.grid_type else "SQUARE",
        grid_size_m=project.grid_size_m,
        form_schema=project.form_schema,
        status=project.status.value if project.status else "DRAFT",
        created_by=project.created_by,
        created_at=project.created_at,
        task_count=task_count,
        progress=progress,
    )


# ============================================================
# PROJECT CRUD
# ============================================================

@router.post("/projects", response_model=ProjectResponse)
async def create_project(
    body: ProjectCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Create a new survey project (GisAdmin only)."""
    project = SurveyProject(
        name=body.name,
        description=body.description,
        grid_type=GridType(body.grid_type),
        grid_size_m=body.grid_size_m,
        form_schema=body.form_schema,
        status=ProjectStatus.DRAFT,
        created_by=admin.id,
    )

    # Set boundary if provided
    if body.boundary_geojson:
        boundary_json = json.dumps(body.boundary_geojson)
        project.boundary = func.ST_GeomFromGeoJSON(boundary_json)

    db.add(project)
    await db.flush()

    await log_audit(db, admin.id, "CREATE_PROJECT", "SurveyProject", project.id,
                    ip=request.client.host if request.client else None)

    return await _project_to_response(db, project)


@router.get("/projects", response_model=List[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List accessible projects for the current user."""
    accessible_ids = await get_user_accessible_project_ids(db, current_user)

    query = select(SurveyProject).order_by(SurveyProject.created_at.desc())
    if accessible_ids is not None:
        if not accessible_ids:
            return []
        query = query.where(SurveyProject.id.in_(accessible_ids))

    result = await db.execute(query)
    projects = result.scalars().all()
    return [await _project_to_response(db, p) for p in projects]


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a project by ID (enforcing access control)."""
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="यस परियोजनामा पहुँच अस्वीकृत (Access denied. You are not assigned to this project.)",
        )
    result = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return await _project_to_response(db, project)


@router.put("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Update a project (GisAdmin only)."""
    result = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    update_data = body.model_dump(exclude_unset=True)
    if "boundary_geojson" in update_data and update_data["boundary_geojson"]:
        boundary_json = json.dumps(update_data.pop("boundary_geojson"))
        project.boundary = func.ST_GeomFromGeoJSON(boundary_json)

    if "grid_type" in update_data:
        update_data["grid_type"] = GridType(update_data["grid_type"])
    if "status" in update_data:
        update_data["status"] = ProjectStatus(update_data["status"])

    for key, value in update_data.items():
        setattr(project, key, value)

    return await _project_to_response(db, project)


@router.delete("/projects/{project_id}", response_model=MessageResponse)
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Delete a project and all associated data (GisAdmin only)."""
    result = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    await db.delete(project)
    await log_audit(db, admin.id, "DELETE_PROJECT", "SurveyProject", project_id)
    return MessageResponse(message=f"Project '{project.name}' deleted")


# ============================================================
# BOUNDARY UPLOAD & GRID GENERATION
# ============================================================

@router.post("/projects/{project_id}/boundary/upload", response_model=BoundaryUploadResponse)
async def upload_project_boundary(
    project_id: int,
    file: Optional[UploadFile] = File(None),
    boundary_json: Optional[str] = Form(None),
    method: str = Form("AUTO"),  # "AUTO", "IMPORT_ALL_AS_TASKS", "GENERATE_GRID", "SET_BOUNDARY_ONLY"
    grid_type: Optional[str] = Form("SQUARE"),
    grid_size_m: Optional[float] = Form(100.0),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """
    Method A / Method B Boundary Processor (GisAdmin only).
    - Upload GeoJSON file or send JSON payload containing single or multi-polygon boundaries.
    - Multi-polygon (Method A): imports each polygon as an independent field task.
    - Single-polygon / Grid Generation (Method B): generates clipped grid (Square, Hexagon, or Triangle).
    """
    result = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    geojson_data = None
    if file:
        content = await file.read()
        try:
            geojson_data = json.loads(content)
        except json.JSONDecodeError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON/GeoJSON in uploaded file")
    elif boundary_json:
        try:
            geojson_data = json.loads(boundary_json)
        except json.JSONDecodeError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid boundary JSON data")
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please provide a GeoJSON file or boundary JSON")

    # Detect CRS & Target CRS
    source_crs = detect_crs_from_geojson_or_coords(geojson_data)
    target_crs = pyproj.CRS.from_epsg(4326)

    # Extract all Polygon / MultiPolygon features
    raw_features = []
    if geojson_data.get("type") == "FeatureCollection":
        raw_features = geojson_data.get("features", [])
    elif geojson_data.get("type") == "Feature":
        raw_features = [geojson_data]
    elif geojson_data.get("type") in ("Polygon", "MultiPolygon", "GeometryCollection"):
        raw_features = [{"type": "Feature", "geometry": geojson_data, "properties": {}}]

    polygon_features = []
    for feat in raw_features:
        raw_geom = feat.get("geometry")
        if not raw_geom:
            continue
        clean_geom = sanitize_and_reproject_geometry(raw_geom, source_crs, target_crs)
        if not clean_geom:
            continue
        gtype = clean_geom.get("type")
        if gtype in ("Polygon", "MultiPolygon"):
            polygon_features.append({
                "type": "Feature",
                "geometry": clean_geom,
                "properties": feat.get("properties") or {},
            })
        elif gtype == "GeometryCollection":
            for subg in clean_geom.get("geometries", []):
                if subg.get("type") in ("Polygon", "MultiPolygon"):
                    polygon_features.append({
                        "type": "Feature",
                        "geometry": subg,
                        "properties": feat.get("properties") or {},
                    })

    if not polygon_features:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No valid Polygon or MultiPolygon geometries found in uploaded boundary")

    poly_count = len(polygon_features)
    is_multi = poly_count > 1

    # Method A: Multi-polygon direct import as field tasks
    if method == "IMPORT_ALL_AS_TASKS" or (method == "AUTO" and is_multi):
        tasks_created = await import_polygons_as_tasks(db, project_id, polygon_features, clear_existing=True)
        await log_audit(db, admin.id, "IMPORT_BOUNDARY_TASKS", "SurveyProject", project_id,
                        {"polygon_count": poly_count, "tasks_created": tasks_created})
        return BoundaryUploadResponse(
            message=f"सफलतापूर्वक {tasks_created} वटा बहुभुज कार्यक्षेत्रहरू (Field Tasks) सिर्जना गरियो",
            polygon_count=poly_count,
            tasks_created=tasks_created,
            is_multi=is_multi,
            method="IMPORT_ALL_AS_TASKS",
        )

    # Method B / Single Polygon Boundary Setup
    if poly_count == 1:
        boundary_geom = polygon_features[0]["geometry"]
    else:
        boundary_geom = {
            "type": "MultiPolygon",
            "coordinates": [
                feat["geometry"]["coordinates"] if feat["geometry"]["type"] == "Polygon"
                else part
                for feat in polygon_features
                for part in (feat["geometry"]["coordinates"] if feat["geometry"]["type"] == "MultiPolygon" else [feat["geometry"]["coordinates"]])
            ]
        }

    # Set project boundary in WGS84
    project.boundary = func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(json.dumps(boundary_geom))), 4326)
    if grid_type in GridType.__members__:
        project.grid_type = GridType(grid_type)
    if grid_size_m:
        project.grid_size_m = grid_size_m
    await db.flush()

    if method == "SET_BOUNDARY_ONLY":
        project.status = ProjectStatus.DRAFT
        await log_audit(db, admin.id, "SET_BOUNDARY", "SurveyProject", project_id, {"polygon_count": poly_count})
        return BoundaryUploadResponse(
            message="परियोजना सिमाना सफलतापूर्वक सेट भयो",
            polygon_count=poly_count,
            tasks_created=0,
            is_multi=is_multi,
            method="SET_BOUNDARY_ONLY",
        )

    # Method B: Generate Grid
    count = await generate_grid(db, boundary_geom, project.grid_type.value, project.grid_size_m, project_id)
    project.status = ProjectStatus.ACTIVE
    await log_audit(db, admin.id, "GENERATE_GRID", "SurveyProject", project_id,
                    {"grid_type": project.grid_type.value, "grid_size_m": project.grid_size_m, "count": count})

    return BoundaryUploadResponse(
        message=f"सिमानाबाट सफलतापूर्वक {count} वटा ग्रिड कार्यक्षेत्रहरू सिर्जना गरियो",
        polygon_count=poly_count,
        tasks_created=count,
        is_multi=is_multi,
        method="GENERATE_GRID",
    )


@router.post("/projects/{project_id}/generate-grid", response_model=MessageResponse)
async def generate_project_grid(
    project_id: int,
    body: GenerateGridRequest = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Generate task grids for a project (GisAdmin only). Supports canvas drawn boundary or existing project boundary."""
    result = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    boundary_geojson = None
    if body and body.boundary_geojson:
        boundary_geojson = body.boundary_geojson
        # Save this drawn/provided boundary as the project boundary
        project.boundary = func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(json.dumps(boundary_geojson))), 4326)
        await db.flush()
    elif project.boundary is not None:
        geojson_result = await db.execute(
            select(func.ST_AsGeoJSON(SurveyProject.boundary)).where(SurveyProject.id == project_id)
        )
        raw_json = geojson_result.scalar()
        if raw_json:
            boundary_geojson = json.loads(raw_json)

    if not boundary_geojson:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="कृपया पहिले नक्सा क्यानभासमा क्षेत्र कोर्नुहोस् वा सिमाना अपलोड गर्नुहोस् (Please draw an area on map canvas or upload boundary first)"
        )

    grid_type = body.grid_type if body and body.grid_type else (project.grid_type.value if project.grid_type else "SQUARE")
    grid_size = body.grid_size_m if body and body.grid_size_m else (project.grid_size_m or 100.0)

    if grid_type in GridType.__members__:
        project.grid_type = GridType(grid_type)
    project.grid_size_m = grid_size

    count = await generate_grid(db, boundary_geojson, grid_type, grid_size, project_id)

    # Update project status to ACTIVE
    project.status = ProjectStatus.ACTIVE

    await log_audit(db, admin.id, "GENERATE_GRID", "SurveyProject", project_id,
                    {"grid_type": grid_type, "grid_size_m": grid_size, "count": count})

    return MessageResponse(
        message=f"सफलतापूर्वक {count} वटा ग्रिड कार्यक्षेत्रहरू सिर्जना गरियो",
        detail=f"ढाँचा: {grid_type}, आकार: {grid_size}m"
    )


# ============================================================
# PROJECT ASSET ASSIGNMENTS
# ============================================================

@router.post("/projects/{project_id}/assign-layer", response_model=MessageResponse)
async def assign_layer_to_project(
    project_id: int,
    body: AssignLayerRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Assign a global vector layer to a project (GisAdmin only)."""
    proj = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    layer = await db.execute(select(VectorLayer).where(VectorLayer.id == body.layer_id))
    layer_obj = layer.scalar_one_or_none()
    if not layer_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")
    if not layer_obj.is_global:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only global layers can be assigned to projects")

    existing = await db.execute(
        select(ProjectLayerAssignment).where(
            and_(ProjectLayerAssignment.project_id == project_id,
                 ProjectLayerAssignment.layer_id == body.layer_id)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer already assigned to this project")

    assignment = ProjectLayerAssignment(
        project_id=project_id, layer_id=body.layer_id, assigned_by=admin.id,
    )
    db.add(assignment)
    return MessageResponse(message=f"Layer '{layer_obj.name}' assigned to project")


@router.post("/projects/{project_id}/assign-tiles", response_model=MessageResponse)
async def assign_mbtiles_to_project(
    project_id: int,
    body: AssignMBTilesRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Assign a global MBTiles package to a project (GisAdmin only)."""
    proj = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    mbtiles = await db.execute(select(MBTilesPackage).where(MBTilesPackage.id == body.mbtiles_id))
    mbtiles_obj = mbtiles.scalar_one_or_none()
    if not mbtiles_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MBTiles package not found")
    if not mbtiles_obj.is_global:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only global MBTiles can be assigned")

    existing = await db.execute(
        select(ProjectMBTilesAssignment).where(
            and_(ProjectMBTilesAssignment.project_id == project_id,
                 ProjectMBTilesAssignment.mbtiles_id == body.mbtiles_id)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="MBTiles already assigned")

    assignment = ProjectMBTilesAssignment(
        project_id=project_id, mbtiles_id=body.mbtiles_id, assigned_by=admin.id,
    )
    db.add(assignment)
    return MessageResponse(message=f"MBTiles '{mbtiles_obj.name}' assigned to project")


@router.delete("/projects/{project_id}/unassign-layer/{layer_id}", response_model=MessageResponse)
async def unassign_layer(
    project_id: int, layer_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Remove a layer assignment from a project."""
    result = await db.execute(
        select(ProjectLayerAssignment).where(
            and_(ProjectLayerAssignment.project_id == project_id,
                 ProjectLayerAssignment.layer_id == layer_id)
        )
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    await db.delete(assignment)
    return MessageResponse(message="Layer unassigned from project")


@router.delete("/projects/{project_id}/unassign-tiles/{mbtiles_id}", response_model=MessageResponse)
async def unassign_mbtiles(
    project_id: int, mbtiles_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Remove an MBTiles assignment from a project."""
    result = await db.execute(
        select(ProjectMBTilesAssignment).where(
            and_(ProjectMBTilesAssignment.project_id == project_id,
                 ProjectMBTilesAssignment.mbtiles_id == mbtiles_id)
        )
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    await db.delete(assignment)
    return MessageResponse(message="MBTiles unassigned from project")


@router.get("/projects/{project_id}/assignments")
async def get_project_assignments(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all assigned vector layer IDs and MBTiles IDs for a project."""
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not assigned to this project.",
        )

    layer_result = await db.execute(
        select(ProjectLayerAssignment.layer_id).where(ProjectLayerAssignment.project_id == project_id)
    )
    layer_ids = [row[0] for row in layer_result.all()]

    mbtiles_result = await db.execute(
        select(ProjectMBTilesAssignment.mbtiles_id).where(ProjectMBTilesAssignment.project_id == project_id)
    )
    mbtiles_ids = [row[0] for row in mbtiles_result.all()]

    return {
        "project_id": project_id,
        "assigned_layer_ids": layer_ids,
        "assigned_mbtiles_ids": mbtiles_ids,
    }


# ============================================================
# PROJECT COLLECTOR ASSIGNMENTS
# ============================================================

@router.get("/projects/{project_id}/collectors", response_model=List[ProjectCollectorResponse])
async def list_project_collectors(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """List all Data Collectors assigned to a project (GisAdmin only)."""
    proj_res = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    if not proj_res.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    query = (
        select(
            User.id.label("user_id"),
            User.username,
            User.full_name,
            User.email,
            ProjectCollectorAssignment.assigned_at,
        )
        .join(ProjectCollectorAssignment, ProjectCollectorAssignment.user_id == User.id)
        .where(ProjectCollectorAssignment.project_id == project_id)
        .order_by(ProjectCollectorAssignment.assigned_at.desc())
    )
    result = await db.execute(query)
    rows = result.all()

    collectors = []
    for r in rows:
        task_count_res = await db.execute(
            select(func.count(TaskGrid.id)).where(
                and_(TaskGrid.project_id == project_id, TaskGrid.assigned_to == r.user_id)
            )
        )
        task_count = task_count_res.scalar() or 0
        collectors.append(ProjectCollectorResponse(
            user_id=r.user_id,
            username=r.username,
            full_name=r.full_name,
            email=r.email,
            assigned_at=r.assigned_at,
            assigned_tasks_count=task_count,
        ))
    return collectors


@router.post("/projects/{project_id}/collectors", response_model=MessageResponse)
async def assign_collectors_to_project(
    project_id: int,
    body: AssignCollectorsRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Assign one or more Data Collectors to a project (GisAdmin only)."""
    proj_res = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = proj_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    users_res = await db.execute(
        select(User).where(and_(User.id.in_(body.user_ids), User.is_active == True))
    )
    valid_users = users_res.scalars().all()
    if not valid_users:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active users found for assignment")

    added_count = 0
    now = datetime.utcnow()
    for u in valid_users:
        existing = await db.execute(
            select(ProjectCollectorAssignment).where(
                and_(ProjectCollectorAssignment.project_id == project_id,
                     ProjectCollectorAssignment.user_id == u.id)
            )
        )
        if not existing.scalar_one_or_none():
            assignment = ProjectCollectorAssignment(
                project_id=project_id,
                user_id=u.id,
                assigned_by=admin.id,
                assigned_at=now,
            )
            db.add(assignment)
            added_count += 1

    await log_audit(db, admin.id, "ASSIGN_PROJECT_COLLECTORS", "SurveyProject", project_id,
                    {"assigned_users": [u.id for u in valid_users], "added_count": added_count})

    return MessageResponse(
        message=f"{len(valid_users)} जना तथ्याङ्क संकलकहरू परियोजना '{project.name}' मा तोकियो",
        detail=f"Assigned {len(valid_users)} collector(s) to project {project_id}",
    )


@router.delete("/projects/{project_id}/collectors/{user_id}", response_model=MessageResponse)
async def unassign_collector_from_project(
    project_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Remove a Data Collector from a project and unassign their tasks in this project (GisAdmin only)."""
    res = await db.execute(
        select(ProjectCollectorAssignment).where(
            and_(ProjectCollectorAssignment.project_id == project_id,
                 ProjectCollectorAssignment.user_id == user_id)
        )
    )
    assignment = res.scalar_one_or_none()
    if assignment:
        await db.delete(assignment)

    # Unassign all tasks in this project currently assigned to this user
    await db.execute(
        update(TaskGrid)
        .where(and_(TaskGrid.project_id == project_id, TaskGrid.assigned_to == user_id))
        .values(assigned_to=None, assigned_at=None, assigned_by=None)
    )

    # Unlock any task locked by this user in this project
    await db.execute(
        update(TaskGrid)
        .where(and_(TaskGrid.project_id == project_id, TaskGrid.locked_by == user_id, TaskGrid.status == TaskStatus.LOCKED_FOR_MAPPING))
        .values(status=TaskStatus.READY, locked_by=None, locked_at=None)
    )

    await log_audit(db, admin.id, "UNASSIGN_PROJECT_COLLECTOR", "SurveyProject", project_id, {"user_id": user_id})

    return MessageResponse(
        message="तथ्याङ्क संकलक परियोजनाबाट सफलतापूर्वक हटाइयो",
        detail=f"Collector {user_id} unassigned from project {project_id}",
    )
