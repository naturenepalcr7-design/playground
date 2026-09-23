"""
KMC-GIS-SERVER — Tiles Router
MBTiles upload, listing, download, XYZ tile serving, and TileJSON endpoints.
"""

import os
import re
import sqlite3
from typing import Optional, List
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File, Form, Query
from fastapi.responses import Response, FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from app.database import get_db
from app.models import (
    User, UserRole, SurveyProject, MBTilesPackage,
    ProjectMBTilesAssignment,
)
from app.schemas import MBTilesResponse, MessageResponse
from app.auth import get_current_user, require_role
from app.helpers import (
    log_audit, get_user_accessible_project_ids, is_project_accessible_by_user,
)
from app.tileserver import (
    save_mbtiles_file, regenerate_tileserver_config,
    delete_mbtiles_file, get_file_size, extract_mbtiles_metadata,
    TILESERVER_DATA_DIR,
)
from app.geometry_utils import EMPTY_TILE_PNG, EMPTY_TILE_WEBP

router = APIRouter(prefix="/api", tags=["Tiles"])


@router.post("/tiles/upload", response_model=MBTilesResponse)
async def upload_mbtiles(
    name: str = Form(...),
    is_global: bool = Form(True),
    project_id: Optional[int] = Form(None),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Upload an .mbtiles file to the tile server (GisAdmin only)."""
    if not file.filename.lower().endswith(".mbtiles"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be .mbtiles")

    # Verify target project if project-scoped
    if not is_global and project_id:
        proj_res = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
        if not proj_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target project not found")

    # Save file to tileserver data directory
    saved_filename = await save_mbtiles_file(file, file.filename)
    file_size = get_file_size(saved_filename)
    meta = extract_mbtiles_metadata(saved_filename)

    # Register in database
    try:
        package = MBTilesPackage(
            name=name,
            filename=saved_filename,
            description=description,
            bounds=meta.get("bounds"),
            center=meta.get("center"),
            min_zoom=meta.get("min_zoom"),
            max_zoom=meta.get("max_zoom"),
            file_size=file_size,
            is_global=is_global,
            project_id=project_id if not is_global else None,
            uploaded_by=admin.id,
        )
        db.add(package)
        await db.flush()

        # Regenerate TileServer-GL config asynchronously
        await regenerate_tileserver_config(db)

        return MBTilesResponse(
            id=package.id, name=package.name, filename=package.filename,
            description=package.description, bounds=package.bounds,
            center=package.center,
            min_zoom=package.min_zoom, max_zoom=package.max_zoom,
            file_size=package.file_size, is_global=package.is_global,
            project_id=package.project_id, created_at=package.created_at,
        )
    except Exception as e:
        await delete_mbtiles_file(saved_filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register MBTiles package: {str(e)}"
        )


@router.get("/tiles", response_model=List[MBTilesResponse])
async def list_mbtiles(
    all_tiles: bool = Query(False, description="List all MBTiles packages (global and project-scoped)"),
    project_id: Optional[int] = Query(None, description="Filter MBTiles by project ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List MBTiles packages (enforcing access control for DataCollectors)."""
    if current_user.role == UserRole.DataCollector:
        accessible_proj_ids = await get_user_accessible_project_ids(db, current_user)
        if not accessible_proj_ids:
            return []

        if project_id is not None:
            if project_id not in accessible_proj_ids:
                return []
            target_pids = [project_id]
        else:
            target_pids = accessible_proj_ids

        assigned_result = await db.execute(
            select(ProjectMBTilesAssignment.mbtiles_id)
            .where(ProjectMBTilesAssignment.project_id.in_(target_pids))
        )
        assigned_ids = [row[0] for row in assigned_result.all()]

        query = select(MBTilesPackage).where(
            or_(
                MBTilesPackage.id.in_(assigned_ids) if assigned_ids else False,
                and_(MBTilesPackage.project_id.in_(target_pids), MBTilesPackage.is_global == False),
            )
        ).order_by(MBTilesPackage.created_at.desc())
    else:
        query = select(MBTilesPackage)
        if project_id is not None:
            assigned_result = await db.execute(
                select(ProjectMBTilesAssignment.mbtiles_id)
                .where(ProjectMBTilesAssignment.project_id == project_id)
            )
            assigned_ids = [row[0] for row in assigned_result.all()]
            query = query.where(
                or_(
                    MBTilesPackage.id.in_(assigned_ids) if assigned_ids else False,
                    and_(MBTilesPackage.project_id == project_id, MBTilesPackage.is_global == False),
                )
            )
        elif not all_tiles:
            query = query.where(MBTilesPackage.is_global == True)
        query = query.order_by(MBTilesPackage.created_at.desc())

    result = await db.execute(query)
    packages = result.scalars().all()
    proj_res = await db.execute(select(SurveyProject.id, SurveyProject.name))
    proj_map = {pid: pname for pid, pname in proj_res.all()}
    return [
        MBTilesResponse(
            id=pkg.id, name=pkg.name, filename=pkg.filename, description=pkg.description,
            bounds=pkg.bounds, center=pkg.center,
            min_zoom=pkg.min_zoom, max_zoom=pkg.max_zoom,
            file_size=pkg.file_size, is_global=pkg.is_global, project_id=pkg.project_id,
            project_name=proj_map.get(pkg.project_id) if pkg.project_id else None,
            created_at=pkg.created_at,
        )
        for pkg in packages
    ]


@router.get("/projects/{project_id}/tiles", response_model=List[MBTilesResponse])
async def list_project_mbtiles(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all MBTiles available to a project:
    (assigned globals) ∪ (project-specific)
    """
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not assigned to this project.",
        )

    assigned_result = await db.execute(
        select(ProjectMBTilesAssignment.mbtiles_id)
        .where(ProjectMBTilesAssignment.project_id == project_id)
    )
    assigned_ids = [row[0] for row in assigned_result.all()]

    query = select(MBTilesPackage).where(
        or_(
            MBTilesPackage.id.in_(assigned_ids) if assigned_ids else False,
            and_(MBTilesPackage.project_id == project_id, MBTilesPackage.is_global == False),
        )
    )

    result = await db.execute(query)
    packages = result.scalars().all()
    proj_res = await db.execute(select(SurveyProject.id, SurveyProject.name))
    proj_map = {pid: pname for pid, pname in proj_res.all()}
    return [
        MBTilesResponse(
            id=pkg.id, name=pkg.name, filename=pkg.filename, description=pkg.description,
            bounds=pkg.bounds, center=pkg.center,
            min_zoom=pkg.min_zoom, max_zoom=pkg.max_zoom,
            file_size=pkg.file_size, is_global=pkg.is_global, project_id=pkg.project_id,
            project_name=proj_map.get(pkg.project_id) if pkg.project_id else None,
            created_at=pkg.created_at,
        )
        for pkg in packages
    ]


@router.post("/projects/{project_id}/tiles/upload", response_model=MBTilesResponse)
async def upload_project_mbtiles(
    project_id: int,
    name: str = Form(...),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Upload a project-specific .mbtiles file (GisAdmin only)."""
    proj = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not file.filename.lower().endswith(".mbtiles"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be .mbtiles")

    saved_filename = await save_mbtiles_file(file, f"proj{project_id}_{file.filename}")
    file_size = get_file_size(saved_filename)
    meta = extract_mbtiles_metadata(saved_filename)

    try:
        package = MBTilesPackage(
            name=name,
            filename=saved_filename,
            description=description,
            bounds=meta.get("bounds"),
            center=meta.get("center"),
            min_zoom=meta.get("min_zoom"),
            max_zoom=meta.get("max_zoom"),
            file_size=file_size,
            is_global=False,
            project_id=project_id,
            uploaded_by=admin.id,
        )
        db.add(package)
        await db.flush()

        await regenerate_tileserver_config(db)

        return MBTilesResponse(
            id=package.id, name=package.name, filename=package.filename,
            description=package.description, bounds=package.bounds,
            center=package.center,
            min_zoom=package.min_zoom, max_zoom=package.max_zoom,
            file_size=package.file_size, is_global=package.is_global,
            project_id=package.project_id, created_at=package.created_at,
        )
    except Exception as e:
        await delete_mbtiles_file(saved_filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register MBTiles package: {str(e)}"
        )


@router.delete("/tiles/{tile_id}", response_model=MessageResponse)
async def delete_mbtiles_pkg(
    tile_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Delete an MBTiles package (GisAdmin only)."""
    result = await db.execute(select(MBTilesPackage).where(MBTilesPackage.id == tile_id))
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MBTiles package not found")

    await delete_mbtiles_file(package.filename)
    await db.delete(package)
    await db.flush()

    await regenerate_tileserver_config(db)

    return MessageResponse(message=f"MBTiles '{package.name}' deleted")


@router.get("/tiles/{tile_id}/download")
async def download_mbtiles(
    tile_id: int,
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """
    Download raw MBTiles (.mbtiles) package file.
    Exclusively available to GisAdmin.
    """
    result = await db.execute(select(MBTilesPackage).where(MBTilesPackage.id == tile_id))
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MBTiles package not found")

    file_path = TILESERVER_DATA_DIR / os.path.basename(package.filename)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MBTiles file not found on disk")

    await log_audit(
        db, admin.id, "DOWNLOAD_RASTER_LAYER", "MBTilesPackage", tile_id,
        details={
            "name": package.name,
            "filename": package.filename,
            "file_size": package.file_size,
        },
        ip=request.client.host if request and request.client else None,
    )

    clean_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', package.name).strip('_') or f"tiles_{package.id}"
    if not clean_name.lower().endswith(".mbtiles"):
        clean_name = f"{clean_name}.mbtiles"

    return FileResponse(
        path=str(file_path),
        filename=clean_name,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{clean_name}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/tiles/{tile_id}/{z}/{x}/{y}")
async def get_mbtile_xyz(
    tile_id: int,
    z: int,
    x: int,
    y: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Serve XYZ raster tile directly from SQLite MBTiles file.
    Supports standard XYZ and TMS coordinate schemes with high-performance caching.
    Accepts .png, .webp, .jpg, .jpeg, or extensionless tile requests for universal QGIS compatibility.
    """
    # Parse y coordinate and optional extension (.png, .webp, .jpg, .jpeg)
    ext = None
    if "." in y:
        y_part, ext = y.rsplit(".", 1)
        ext = ext.lower()
        try:
            y_int = int(y_part)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid y coordinate")
    else:
        try:
            y_int = int(y)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid y coordinate")

    result = await db.execute(select(MBTilesPackage).where(MBTilesPackage.id == tile_id))
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tile package not found")

    file_path = TILESERVER_DATA_DIR / os.path.basename(package.filename)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MBTiles file not found on disk")

    # Convert standard XYZ y to TMS y (MBTiles internal coordinate convention)
    tms_y = (1 << z) - 1 - y_int

    try:
        with sqlite3.connect(f"file:{file_path}?mode=ro", uri=True) as conn:
            cursor = conn.cursor()
            # 1. Try standard tiles table
            row = None
            try:
                cursor.execute(
                    "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                    (z, x, tms_y)
                )
                row = cursor.fetchone()
            except sqlite3.OperationalError:
                pass

            # 2. Fallback to images JOIN map view
            if not row or not row[0]:
                try:
                    cursor.execute(
                        "SELECT tile_data FROM images JOIN map ON images.tile_id = map.tile_id "
                        "WHERE map.zoom_level = ? AND map.tile_column = ? AND map.tile_row = ?",
                        (z, x, tms_y)
                    )
                    row = cursor.fetchone()
                except sqlite3.OperationalError:
                    pass

            if not row or not row[0]:
                is_webp = request.url.path.endswith(".webp") or "image/webp" in request.headers.get("accept", "")
                return Response(
                    content=EMPTY_TILE_WEBP if is_webp else EMPTY_TILE_PNG,
                    media_type="image/webp" if is_webp else "image/png",
                    headers={
                        "Cache-Control": "public, max-age=86400",
                        "Access-Control-Allow-Origin": "*",
                    },
                )

            tile_data = row[0]
            content_type = "image/png"
            if tile_data.startswith(b'\xff\xd8\xff'):
                content_type = "image/jpeg"
            elif tile_data.startswith(b'RIFF') and b'WEBP' in tile_data[:16]:
                content_type = "image/webp"
            elif tile_data.startswith(b'\x1f\x8b'):
                content_type = "application/x-protobuf"

            return Response(
                content=tile_data,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/tiles/{tile_id}/tilejson.json")
async def get_tilejson(
    tile_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return TileJSON 2.2.0 metadata for an MBTiles package."""
    result = await db.execute(select(MBTilesPackage).where(MBTilesPackage.id == tile_id))
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tile package not found")

    # Dynamic base URL honoring reverse proxy headers
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    base_url = f"{proto}://{host}" if host else str(request.base_url).rstrip("/")

    # Compute center fallback from bounds if not stored
    center = package.center
    if not center and package.bounds and len(package.bounds) == 4:
        b = package.bounds
        center = [round((b[0] + b[2]) / 2.0, 6), round((b[1] + b[3]) / 2.0, 6), package.min_zoom or 0]

    return {
        "tilejson": "2.2.0",
        "name": package.name,
        "description": package.description,
        "version": "1.0.0",
        "scheme": "xyz",
        "tiles": [
            f"{base_url}/api/tiles/{package.id}/{{z}}/{{x}}/{{y}}.png",
            f"{base_url}/api/tiles/{package.id}/{{z}}/{{x}}/{{y}}.webp",
            f"{base_url}/api/tiles/{package.id}/{{z}}/{{x}}/{{y}}",
        ],
        "minzoom": package.min_zoom or 0,
        "maxzoom": package.max_zoom or 22,
        "bounds": package.bounds or [-180, -85, 180, 85],
        "center": center or [85.3, 27.7, 12],
    }


def _generate_wmts_capabilities(packages: List[MBTilesPackage], base_url: str) -> str:
    """Generate compliant OGC WMTS 1.0.0 Capabilities XML."""
    layers_xml = []
    for pkg in packages:
        bounds = pkg.bounds or [85.265578, 27.673476, 85.367998, 27.751398]
        min_lon, min_lat, max_lon, max_lat = bounds[0], bounds[1], bounds[2], bounds[3]
        pkg_name = xml_escape(pkg.name or f"TilePackage_{pkg.id}")
        pkg_desc = xml_escape(pkg.description or pkg.name or "")

        layers_xml.append(f"""    <Layer>
      <ows:Title>{pkg_name}</ows:Title>
      <ows:Abstract>{pkg_desc}</ows:Abstract>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>{min_lon} {min_lat}</ows:LowerCorner>
        <ows:UpperCorner>{max_lon} {max_lat}</ows:UpperCorner>
      </ows:WGS84BoundingBox>
      <ows:Identifier>{pkg.id}</ows:Identifier>
      <Style isDefault="true">
        <ows:Title>Default Style</ows:Title>
        <ows:Identifier>default</ows:Identifier>
      </Style>
      <Format>image/webp</Format>
      <Format>image/png</Format>
      <TileMatrixSetLink>
        <TileMatrixSet>GoogleMapsCompatible</TileMatrixSet>
      </TileMatrixSetLink>
      <ResourceURL format="image/webp" resourceType="tile" template="{base_url}/api/tiles/{pkg.id}/{{TileMatrix}}/{{TileCol}}/{{TileRow}}.webp"/>
      <ResourceURL format="image/png" resourceType="tile" template="{base_url}/api/tiles/{pkg.id}/{{TileMatrix}}/{{TileCol}}/{{TileRow}}.png"/>
    </Layer>""")

    # TileMatrix definitions for zoom 0 to 22 (Standard GoogleMapsCompatible)
    matrix_list = []
    for z in range(0, 23):
        scale_denom = 559082264.0287178 / (2 ** z)
        matrix_size = 2 ** z
        matrix_list.append(f"""      <TileMatrix>
        <ows:Identifier>{z}</ows:Identifier>
        <ScaleDenominator>{scale_denom:.10f}</ScaleDenominator>
        <TopLeftCorner>-20037508.34278925 20037508.34278925</TopLeftCorner>
        <TileWidth>256</TileWidth>
        <TileHeight>256</TileHeight>
        <MatrixWidth>{matrix_size}</MatrixWidth>
        <MatrixHeight>{matrix_size}</MatrixHeight>
      </TileMatrix>""")

    tile_matrices_xml = "\n".join(matrix_list)
    all_layers_xml = "\n".join(layers_xml)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0"
  xmlns:ows="http://www.opengis.net/ows/1.1"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:gml="http://www.opengis.net/gml"
  xsi:schemaLocation="http://www.opengis.net/wmts/1.0 http://schemas.opengis.net/wmts/1.0/wmtsGetCapabilities_response.xsd"
  version="1.0.0">
  <ows:ServiceIdentification>
    <ows:Title>KMC GIS Server — WMTS Raster Tile Service</ows:Title>
    <ows:Abstract>OGC Web Map Tile Service (WMTS) for Kathmandu Metropolitan City orthophoto raster imagery.</ows:Abstract>
    <ows:ServiceType>OGC WMTS</ows:ServiceType>
    <ows:ServiceTypeVersion>1.0.0</ows:ServiceTypeVersion>
    <ows:Fees>none</ows:Fees>
    <ows:AccessConstraints>none</ows:AccessConstraints>
  </ows:ServiceIdentification>
  <ows:ServiceProvider>
    <ows:ProviderName>Kathmandu Metropolitan City</ows:ProviderName>
    <ows:ProviderSite xlink:href="{base_url}/"/>
    <ows:ServiceContact>
      <ows:IndividualName>GIS Administrator</ows:IndividualName>
      <ows:ContactInfo>
        <ows:Address>
          <ows:City>Kathmandu</ows:City>
          <ows:Country>Nepal</ows:Country>
        </ows:Address>
      </ows:ContactInfo>
    </ows:ServiceContact>
  </ows:ServiceProvider>
  <ows:OperationsMetadata>
    <ows:Operation name="GetCapabilities">
      <ows:DCP>
        <ows:HTTP>
          <ows:Get xlink:href="{base_url}/api/tiles/wmts.xml">
            <ows:Constraint name="GetEncoding">
              <ows:AllowedValues>
                <ows:Value>KVP</ows:Value>
              </ows:AllowedValues>
            </ows:Constraint>
          </ows:Get>
        </ows:HTTP>
      </ows:DCP>
    </ows:Operation>
    <ows:Operation name="GetTile">
      <ows:DCP>
        <ows:HTTP>
          <ows:Get xlink:href="{base_url}/api/tiles/">
            <ows:Constraint name="GetEncoding">
              <ows:AllowedValues>
                <ows:Value>RESTful</ows:Value>
              </ows:AllowedValues>
            </ows:Constraint>
          </ows:Get>
        </ows:HTTP>
      </ows:DCP>
    </ows:Operation>
  </ows:OperationsMetadata>
  <Contents>
{all_layers_xml}
    <TileMatrixSet>
      <ows:Identifier>GoogleMapsCompatible</ows:Identifier>
      <ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>
      <ows:WellKnownScaleSet>urn:ogc:def:wkss:OGC:1.0:GoogleMapsCompatible</ows:WellKnownScaleSet>
{tile_matrices_xml}
    </TileMatrixSet>
  </Contents>
  <ServiceMetadataURL xlink:href="{base_url}/api/tiles/wmts.xml"/>
</Capabilities>"""


@router.get("/tiles/wmts.xml")
@router.get("/tiles/WMTSCapabilities.xml")
@router.get("/tiles/wmts")
async def get_all_wmts(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return OGC WMTS 1.0.0 Capabilities XML for all global MBTiles packages."""
    result = await db.execute(select(MBTilesPackage).where(MBTilesPackage.is_global == True))
    packages = result.scalars().all()
    if not packages:
        result = await db.execute(select(MBTilesPackage))
        packages = result.scalars().all()

    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    base_url = f"{proto}://{host}" if host else str(request.base_url).rstrip("/")

    xml = _generate_wmts_capabilities(packages, base_url)
    return Response(content=xml, media_type="text/xml; charset=utf-8")


@router.get("/tiles/{tile_id}/wmts.xml")
@router.get("/tiles/{tile_id}/WMTSCapabilities.xml")
@router.get("/tiles/{tile_id}/wmts")
async def get_single_wmts(
    tile_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return OGC WMTS 1.0.0 Capabilities XML for a specific MBTiles package."""
    result = await db.execute(select(MBTilesPackage).where(MBTilesPackage.id == tile_id))
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tile package not found")

    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    base_url = f"{proto}://{host}" if host else str(request.base_url).rstrip("/")

    xml = _generate_wmts_capabilities([package], base_url)
    return Response(content=xml, media_type="text/xml; charset=utf-8")


@router.get("/tiles/{tile_id}/qgis.xml")
async def get_qgis_gdal_wms(
    tile_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Download a ready-to-use GDAL WMS XML file with exact Kathmandu bounding box.
    Users can simply drag this file into QGIS to open the raster with exact extent!
    """
    result = await db.execute(select(MBTilesPackage).where(MBTilesPackage.id == tile_id))
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tile package not found")

    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    base_url = f"{proto}://{host}" if host else str(request.base_url).rstrip("/")

    bounds = package.bounds or [85.265578, 27.673476, 85.367998, 27.751398]
    min_lon, min_lat, max_lon, max_lat = bounds[0], bounds[1], bounds[2], bounds[3]
    clean_name = re.sub(r'[^a-zA-Z0-9_]', '_', package.name or f"tiles_{package.id}")

    xml_content = f"""<GDAL_WMS>
  <Service name="TMS">
    <ServerUrl>{base_url}/api/tiles/{package.id}/${{z}}/${{x}}/${{y}}.webp</ServerUrl>
  </Service>
  <DataWindow>
    <UpperLeftX>{min_lon}</UpperLeftX>
    <UpperLeftY>{max_lat}</UpperLeftY>
    <LowerRightX>{max_lon}</LowerRightX>
    <LowerRightY>{min_lat}</LowerRightY>
    <TileLevel>{package.max_zoom or 22}</TileLevel>
    <TileCountX>1</TileCountX>
    <TileCountY>1</TileCountY>
    <YOrigin>top</YOrigin>
  </DataWindow>
  <Projection>EPSG:4326</Projection>
  <BlockSizeX>256</BlockSizeX>
  <BlockSizeY>256</BlockSizeY>
  <BandsCount>4</BandsCount>
  <ZeroBlockHttpCodes>200,204,404</ZeroBlockHttpCodes>
  <ZeroBlockOnServerException>true</ZeroBlockOnServerException>
</GDAL_WMS>"""

    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={
            "Content-Disposition": f'attachment; filename="{clean_name}_qgis.xml"',
            "Access-Control-Allow-Origin": "*",
        },
    )
