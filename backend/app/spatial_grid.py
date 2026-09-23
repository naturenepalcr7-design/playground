"""
KMC-GIS-SERVER Spatial Grid & Task Generator
PostGIS-powered task grid generation (Square, Hexagon, Triangle) and
direct multi-polygon boundary import for field task division.
"""

from typing import List, Tuple, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import json
import math


def estimate_utm_srid(lon: float, lat: float) -> int:
    """
    Estimate the appropriate UTM SRID for a given WGS84 coordinate.
    Returns EPSG code for the UTM zone.

    Northern hemisphere: EPSG:326xx
    Southern hemisphere: EPSG:327xx
    where xx = zone number (1-60)
    """
    zone_number = int((lon + 180) / 6) + 1

    # Handle special cases for Norway/Svalbard
    if 56.0 <= lat < 64.0 and 3.0 <= lon < 12.0:
        zone_number = 32
    elif 72.0 <= lat < 84.0:
        if 0.0 <= lon < 9.0:
            zone_number = 31
        elif 9.0 <= lon < 21.0:
            zone_number = 33
        elif 21.0 <= lon < 33.0:
            zone_number = 35
        elif 33.0 <= lon < 42.0:
            zone_number = 37

    if lat >= 0:
        return 32600 + zone_number  # Northern hemisphere
    else:
        return 32700 + zone_number  # Southern hemisphere


async def generate_square_grid(
    db: AsyncSession,
    boundary_geojson: dict,
    grid_size_m: float,
    project_id: int,
) -> int:
    """Generate a square grid over a project boundary polygon."""
    boundary_json = json.dumps(boundary_geojson)

    centroid_query = text("""
        SELECT
            ST_X(ST_Centroid(ST_GeomFromGeoJSON(:geojson))) AS lon,
            ST_Y(ST_Centroid(ST_GeomFromGeoJSON(:geojson))) AS lat
    """)
    result = await db.execute(centroid_query, {"geojson": boundary_json})
    centroid = result.fetchone()
    utm_srid = int(estimate_utm_srid(centroid.lon, centroid.lat))

    grid_query = text(f"""
        WITH boundary AS (
            SELECT ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(:geojson)), 4326) AS geom
        ),
        boundary_utm AS (
            SELECT ST_Transform(geom, {utm_srid}) AS geom FROM boundary
        ),
        grid AS (
            SELECT (ST_SquareGrid(:grid_size, bu.geom)).*
            FROM boundary_utm bu
        ),
        clipped AS (
            SELECT
                ROW_NUMBER() OVER () AS grid_index,
                ST_Transform(
                    ST_Intersection(g.geom, bu.geom),
                    4326
                ) AS geom
            FROM grid g, boundary_utm bu
            WHERE ST_Intersects(g.geom, bu.geom)
              AND ST_Area(ST_Intersection(g.geom, bu.geom)) > (ST_Area(g.geom) * 0.01)
        )
        INSERT INTO task_grids (project_id, grid_index, geom, status, name)
        SELECT
            {int(project_id)},
            grid_index::int,
            geom,
            'READY',
            'ग्रिड #' || grid_index::text
        FROM clipped
        RETURNING id
    """)

    result = await db.execute(
        grid_query,
        {
            "geojson": boundary_json,
            "grid_size": float(grid_size_m),
        },
    )

    rows = result.fetchall()
    return len(rows)


async def generate_hexagon_grid(
    db: AsyncSession,
    boundary_geojson: dict,
    grid_size_m: float,
    project_id: int,
) -> int:
    """Generate a hexagonal grid over a project boundary polygon."""
    boundary_json = json.dumps(boundary_geojson)

    centroid_query = text("""
        SELECT
            ST_X(ST_Centroid(ST_GeomFromGeoJSON(:geojson))) AS lon,
            ST_Y(ST_Centroid(ST_GeomFromGeoJSON(:geojson))) AS lat
    """)
    result = await db.execute(centroid_query, {"geojson": boundary_json})
    centroid = result.fetchone()
    utm_srid = int(estimate_utm_srid(centroid.lon, centroid.lat))

    grid_query = text(f"""
        WITH boundary AS (
            SELECT ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(:geojson)), 4326) AS geom
        ),
        boundary_utm AS (
            SELECT ST_Transform(geom, {utm_srid}) AS geom FROM boundary
        ),
        grid AS (
            SELECT (ST_HexagonGrid(:grid_size, bu.geom)).*
            FROM boundary_utm bu
        ),
        clipped AS (
            SELECT
                ROW_NUMBER() OVER () AS grid_index,
                ST_Transform(
                    ST_Intersection(g.geom, bu.geom),
                    4326
                ) AS geom
            FROM grid g, boundary_utm bu
            WHERE ST_Intersects(g.geom, bu.geom)
              AND ST_Area(ST_Intersection(g.geom, bu.geom)) > (ST_Area(g.geom) * 0.01)
        )
        INSERT INTO task_grids (project_id, grid_index, geom, status, name)
        SELECT
            {int(project_id)},
            grid_index::int,
            geom,
            'READY',
            'षट्कोण #' || grid_index::text
        FROM clipped
        RETURNING id
    """)

    result = await db.execute(
        grid_query,
        {
            "geojson": boundary_json,
            "grid_size": float(grid_size_m),
        },
    )

    rows = result.fetchall()
    return len(rows)


async def generate_triangle_grid(
    db: AsyncSession,
    boundary_geojson: dict,
    grid_size_m: float,
    project_id: int,
) -> int:
    """Generate a triangular tessellation grid over a project boundary polygon."""
    boundary_json = json.dumps(boundary_geojson)

    centroid_query = text("""
        SELECT
            ST_X(ST_Centroid(ST_GeomFromGeoJSON(:geojson))) AS lon,
            ST_Y(ST_Centroid(ST_GeomFromGeoJSON(:geojson))) AS lat
    """)
    result = await db.execute(centroid_query, {"geojson": boundary_json})
    centroid = result.fetchone()
    utm_srid = int(estimate_utm_srid(centroid.lon, centroid.lat))

    grid_query = text(f"""
        WITH boundary AS (
            SELECT ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(:geojson)), 4326) AS geom
        ),
        boundary_utm AS (
            SELECT ST_Transform(geom, {utm_srid}) AS geom FROM boundary
        ),
        sq_grid AS (
            SELECT (ST_SquareGrid(:grid_size, bu.geom)).geom AS ggeom
            FROM boundary_utm bu
        ),
        triangles AS (
            SELECT
                ST_SetSRID(ST_MakePolygon(ST_MakeLine(ARRAY[
                    ST_Point(ST_XMin(ggeom), ST_YMin(ggeom)),
                    ST_Point(ST_XMax(ggeom), ST_YMin(ggeom)),
                    ST_Point(ST_XMax(ggeom), ST_YMax(ggeom)),
                    ST_Point(ST_XMin(ggeom), ST_YMin(ggeom))
                ])), {utm_srid}) AS geom
            FROM sq_grid
            UNION ALL
            SELECT
                ST_SetSRID(ST_MakePolygon(ST_MakeLine(ARRAY[
                    ST_Point(ST_XMin(ggeom), ST_YMin(ggeom)),
                    ST_Point(ST_XMax(ggeom), ST_YMax(ggeom)),
                    ST_Point(ST_XMin(ggeom), ST_YMax(ggeom)),
                    ST_Point(ST_XMin(ggeom), ST_YMin(ggeom))
                ])), {utm_srid}) AS geom
            FROM sq_grid
        ),
        clipped AS (
            SELECT
                ROW_NUMBER() OVER () AS grid_index,
                ST_Transform(
                    ST_Intersection(t.geom, bu.geom),
                    4326
                ) AS geom
            FROM triangles t, boundary_utm bu
            WHERE ST_Intersects(t.geom, bu.geom)
              AND ST_Area(ST_Intersection(t.geom, bu.geom)) > (ST_Area(t.geom) * 0.01)
        )
        INSERT INTO task_grids (project_id, grid_index, geom, status, name)
        SELECT
            {int(project_id)},
            grid_index::int,
            geom,
            'READY',
            'त्रिकोण #' || grid_index::text
        FROM clipped
        RETURNING id
    """)

    result = await db.execute(
        grid_query,
        {
            "geojson": boundary_json,
            "grid_size": float(grid_size_m),
        },
    )

    rows = result.fetchall()
    return len(rows)


async def generate_grid(
    db: AsyncSession,
    boundary_geojson: dict,
    grid_type: str,
    grid_size_m: float,
    project_id: int,
) -> int:
    """
    Generate task grids for a project. Dispatches to square, hexagon, or triangle generator.
    """
    # Clear existing grids for this project
    await db.execute(
        text("DELETE FROM task_grids WHERE project_id = :pid"),
        {"pid": project_id},
    )

    if grid_type == "HEXAGON":
        return await generate_hexagon_grid(db, boundary_geojson, grid_size_m, project_id)
    elif grid_type == "TRIANGLE":
        return await generate_triangle_grid(db, boundary_geojson, grid_size_m, project_id)
    else:
        return await generate_square_grid(db, boundary_geojson, grid_size_m, project_id)


async def import_polygons_as_tasks(
    db: AsyncSession,
    project_id: int,
    polygon_features: List[Dict[str, Any]],
    clear_existing: bool = True,
) -> int:
    """
    Method A Handler — Multi-Polygon or Single Polygon Boundary Task Importer.
    Takes an array of GeoJSON polygon feature dicts and creates an individual TaskGrid for each polygon.
    Also computes the unified boundary and updates the SurveyProject record.
    """
    if clear_existing:
        await db.execute(
            text("DELETE FROM task_grids WHERE project_id = :pid"),
            {"pid": project_id},
        )

    count = 0
    for idx, feat in enumerate(polygon_features, start=1):
        geom = feat.get("geometry")
        if not geom:
            continue

        props = feat.get("properties") or {}
        # Derive task name from common GIS properties
        name = (
            props.get("name")
            or props.get("NAME")
            or props.get("title")
            or props.get("ward")
            or props.get("Ward")
            or props.get("ward_no")
            or props.get("WARD_NO")
            or props.get("id")
            or props.get("ID")
            or f"कार्यक्षेत्र #{idx}"
        )
        if isinstance(name, (int, float)):
            name = f"वडा/क्षेत्र #{name}"

        geom_json = json.dumps(geom)
        insert_query = text("""
            INSERT INTO task_grids (project_id, grid_index, name, geom, status, properties)
            VALUES (
                :project_id,
                :grid_index,
                :name,
                ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(:geom_json)), 4326),
                'READY',
                :props_json
            )
        """)
        await db.execute(
            insert_query,
            {
                "project_id": project_id,
                "grid_index": idx,
                "name": str(name)[:255],
                "geom_json": geom_json,
                "props_json": json.dumps(props),
            },
        )
        count += 1

    # Update SurveyProject boundary to the combined union of all task polygons
    update_boundary_query = text("""
        UPDATE survey_projects
        SET boundary = (
            SELECT ST_UnaryUnion(ST_Collect(geom))
            FROM task_grids
            WHERE project_id = :pid
        ),
        status = 'ACTIVE'
        WHERE id = :pid
    """)
    await db.execute(update_boundary_query, {"pid": project_id})

    return count

