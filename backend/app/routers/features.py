"""
KMC-GIS-SERVER — Features Router
Vector feature CRUD with geofence enforcement for DataCollectors.
"""

import re
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, and_, or_, Integer
from sqlalchemy.orm import aliased
from sqlalchemy.orm.attributes import flag_modified
import pyproj

from app.database import get_db
from app.models import (
    User, UserRole, VectorLayer, VectorFeature, AuditLog,
)
from app.schemas import FeatureCreate, FeatureUpdate, MessageResponse
from app.auth import get_current_user, require_role
from app.helpers import log_audit, is_layer_accessible_by_user
from app.geofence import (
    verify_feature_proximity, verify_new_feature_proximity,
    verify_collector_grid_containment,
)
from app.geometry_utils import (
    detect_crs_from_geojson_or_coords,
    _sanitize_and_transform_coords,
    _get_first_coordinate,
    WGS84_CRS,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Features"])


@router.get("/layers/{layer_id}/features")
async def list_features(
    layer_id: int,
    bbox: Optional[str] = Query(None, description="Bounding box: west,south,east,north"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List features for a layer as GeoJSON FeatureCollection. Supports bbox filter."""
    if not await is_layer_accessible_by_user(db, current_user, layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This layer is not linked to any of your assigned projects.",
        )

    creator = aliased(User)
    updater = aliased(User)

    query = select(
        VectorFeature.id,
        VectorFeature.properties,
        VectorFeature.created_by,
        VectorFeature.updated_by,
        VectorFeature.version,
        VectorFeature.created_at,
        VectorFeature.updated_at,
        creator.username.label("creator_username"),
        creator.full_name.label("creator_full_name"),
        updater.username.label("updater_username"),
        updater.full_name.label("updater_full_name"),
        func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
    ).outerjoin(creator, VectorFeature.created_by == creator.id) \
     .outerjoin(updater, VectorFeature.updated_by == updater.id) \
     .where(VectorFeature.layer_id == layer_id)

    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) == 4:
                west, south, east, north = parts
                bbox_wkt = f"POLYGON(({west} {south}, {east} {south}, {east} {north}, {west} {north}, {west} {south}))"
                query = query.where(
                    func.ST_Intersects(
                        VectorFeature.geom,
                        func.ST_GeomFromText(bbox_wkt, 4326)
                    )
                )
        except (ValueError, IndexError):
            pass

    result = await db.execute(query)
    rows = result.all()

    features = []
    detected_crs = None
    transformer = None

    for row in rows:
        geom = None
        if row.geojson:
            try:
                parsed = json.loads(row.geojson)
                if isinstance(parsed, dict) and "type" in parsed and "coordinates" in parsed and parsed.get("coordinates") is not None:
                    # Check if coordinates are projected/UTM (>180 or >90) and need auto-healing to WGS84
                    if detected_crs is None:
                        sample = _get_first_coordinate(parsed.get("coordinates"))
                        if sample and (abs(sample[0]) > 180.0 or abs(sample[1]) > 90.0):
                            detected_crs = detect_crs_from_geojson_or_coords({"features": [{"geometry": parsed}]})
                            if detected_crs != WGS84_CRS:
                                try:
                                    transformer = pyproj.Transformer.from_crs(detected_crs, WGS84_CRS, always_xy=True)
                                except Exception:
                                    transformer = None
                        else:
                            detected_crs = WGS84_CRS

                    if transformer is not None:
                        clean_coords = _sanitize_and_transform_coords(parsed.get("coordinates"), transformer)
                        parsed["coordinates"] = clean_coords

                    geom = parsed
            except Exception:
                geom = None

        if geom is not None:
            clean_props = {
                k: v for k, v in (row.properties or {}).items()
                if k.lower() not in ("geometry", "the_geom", "geom") and not str(k).startswith("__")
            }
            edit_type = "update" if (row.version and row.version > 1) or row.updated_by else "create"
            clean_props.update({
                "_id": row.id,
                "_created_by": row.created_by,
                "_created_by_username": row.creator_username,
                "_created_by_name": row.creator_full_name,
                "_updated_by": row.updated_by,
                "_updated_by_username": row.updater_username,
                "_updated_by_name": row.updater_full_name,
                "_version": row.version,
                "_created_at": row.created_at.isoformat() if row.created_at else None,
                "_updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "_edit_type": edit_type,
            })
            features.append({
                "type": "Feature",
                "id": row.id,
                "geometry": geom,
                "properties": clean_props,
            })

    return {
        "type": "FeatureCollection",
        "features": features,
        "total_count": len(features),
    }


@router.post("/features")
async def create_feature(
    body: FeatureCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """
    Create a new vector feature.
    DataCollector is strictly restricted to their assigned task grids (or assigned project boundary).
    GisAdmin bypasses all spatial restriction and proximity checks.
    """
    if not await is_layer_accessible_by_user(db, current_user, body.layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This layer is not linked to any of your assigned projects.",
        )

    # Verify layer exists and is editable
    layer_result = await db.execute(select(VectorLayer).where(VectorLayer.id == body.layer_id))
    layer = layer_result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    if current_user.role == UserRole.DataCollector and not layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This layer is not editable by DataCollectors")

    geom_json = json.dumps(body.geom_geojson)

    # Strict Grid Containment and Optional GPS Geofence for DataCollector
    if current_user.role == UserRole.DataCollector:
        await verify_collector_grid_containment(db, current_user, body.layer_id, body.geom_geojson)

        if body.collector_lat is not None and body.collector_lng is not None:
            # Convert GeoJSON to WKT for proximity check
            wkt_result = await db.execute(
                text("SELECT ST_AsText(ST_GeomFromGeoJSON(:geojson))"),
                {"geojson": geom_json},
            )
            geom_wkt = wkt_result.scalar()
            await verify_new_feature_proximity(
                db, current_user.role.value, body.collector_lat, body.collector_lng, geom_wkt
            )

    clean_props = {}
    target_feat_id = None
    target_link_val = None
    target_link_field = None

    for k, v in (body.properties or {}).items():
        if str(k).startswith("__"):
            continue
        if k == "_target_feature_id":
            try:
                target_feat_id = int(v)
            except Exception:
                pass
            continue
        if str(k).endswith("_linked_id") and v is not None and str(v).strip() != "":
            target_link_val = str(v).strip()
            target_link_field = k
        if k == "gid" and v is not None and str(v).isdigit():
            try:
                v = int(v)
            except Exception:
                pass
        clean_props[k] = v

    # Automatically record username in "Kmc_Editor" when created by a DataCollector
    if current_user.role == UserRole.DataCollector:
        clean_props["Kmc_Editor"] = current_user.username

    feature = VectorFeature(
        layer_id=body.layer_id,
        geom=func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(geom_json)), 4326),
        properties=clean_props,
        created_by=current_user.id,
        version=1,
    )
    db.add(feature)
    await db.flush()

    # Two-way linking: if this feature links to a target feature, update the target feature as well
    try:
        target_feature_to_update = None
        if target_feat_id:
            tf_q = await db.execute(select(VectorFeature).where(VectorFeature.id == target_feat_id))
            target_feature_to_update = tf_q.scalar_one_or_none()
        elif target_link_val and target_link_field:
            # Find target feature by matching ID or linking field
            prefix = target_link_field[:-10]
            clean_prefix = re.sub(r'[^a-zA-Z0-9_]', '_', prefix).strip('_').lower()
            all_l_q = await db.execute(select(VectorLayer))
            t_layer = next((l for l in all_l_q.scalars().all() if re.sub(r'[^a-zA-Z0-9_]', '_', l.name).strip('_').lower() == clean_prefix), layer)
            if t_layer:
                if target_link_val.isdigit():
                    tf_q = await db.execute(
                        select(VectorFeature).where(
                            and_(VectorFeature.layer_id == t_layer.id, VectorFeature.id == int(target_link_val))
                        )
                    )
                    target_feature_to_update = tf_q.scalar_one_or_none()
                if not target_feature_to_update:
                    # Search by properties (e.g. gid == target_link_val)
                    tf_cand_q = await db.execute(
                        select(VectorFeature).where(VectorFeature.layer_id == t_layer.id)
                    )
                    for cand in tf_cand_q.scalars().all():
                        c_props = cand.properties or {}
                        if str(c_props.get("gid", "")).strip() == target_link_val or str(c_props.get("id", "")).strip() == target_link_val:
                            target_feature_to_update = cand
                            break

        if target_feature_to_update and target_feature_to_update.id != feature.id:
            t_props = dict(target_feature_to_update.properties or {})
            curr_layer_clean = re.sub(r'[^a-zA-Z0-9_]', '_', layer.name).strip('_')
            point_link_val = feature.properties.get("gid") or feature.id
            t_props[f"{curr_layer_clean}_linked_id"] = str(point_link_val)
            t_props["linked_point_id"] = feature.id
            t_props["linked_point_gid"] = feature.properties.get("gid") or feature.id
            target_feature_to_update.properties = t_props
            flag_modified(target_feature_to_update, "properties")
            target_feature_to_update.updated_by = current_user.id
            target_feature_to_update.version += 1
            await db.flush()
    except Exception as link_err:
        logger.warning(f"Failed to auto-update target feature link: {link_err}")

    await log_audit(db, current_user.id, "CREATE_FEATURE", "VectorFeature", feature.id,
                    details={"layer_id": feature.layer_id},
                    ip=request.client.host if request.client else None)

    # Return the created feature
    feat_result = await db.execute(
        select(
            VectorFeature.id, VectorFeature.properties, VectorFeature.version,
            VectorFeature.created_by, VectorFeature.updated_by,
            VectorFeature.created_at, VectorFeature.updated_at,
            func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).where(VectorFeature.id == feature.id)
    )
    row = feat_result.one()

    return {
        "type": "Feature",
        "id": row.id,
        "geometry": json.loads(row.geojson) if row.geojson else None,
        "properties": {
            **(row.properties or {}),
            "_id": row.id,
            "_created_by": row.created_by,
            "_created_by_username": current_user.username,
            "_created_by_name": current_user.full_name,
            "_updated_by": row.updated_by,
            "_version": row.version,
            "_created_at": row.created_at.isoformat() if row.created_at else None,
            "_updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "_edit_type": "create",
        },
    }


@router.put("/features/{feature_id}")
async def update_feature(
    feature_id: int,
    body: FeatureUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """
    Update an existing vector feature.
    DataCollector can modify features only within their assigned task grids (or assigned project boundary).
    GisAdmin bypasses all spatial restrictions.
    """
    result = await db.execute(
        select(VectorFeature).where(VectorFeature.id == feature_id)
    )
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    if not await is_layer_accessible_by_user(db, current_user, feature.layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This feature belongs to a layer outside your assigned projects.",
        )

    # Check layer editability
    layer_result = await db.execute(select(VectorLayer).where(VectorLayer.id == feature.layer_id))
    layer = layer_result.scalar_one_or_none()
    if current_user.role == UserRole.DataCollector and layer and not layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Layer not editable by DataCollectors")

    # Strict Grid Containment for DataCollector
    if current_user.role == UserRole.DataCollector:
        target_geom = body.geom_geojson
        if target_geom is None:
            geojson_res = await db.execute(
                select(func.ST_AsGeoJSON(VectorFeature.geom)).where(VectorFeature.id == feature_id)
            )
            raw_geojson = geojson_res.scalar()
            if raw_geojson:
                target_geom = json.loads(raw_geojson)

        if target_geom:
            await verify_collector_grid_containment(db, current_user, feature.layer_id, target_geom, feature_id=feature_id)

        if body.collector_lat is not None and body.collector_lng is not None:
            await verify_feature_proximity(
                db, current_user.role.value, body.collector_lat, body.collector_lng, feature_id
            )

    # Apply updates
    if body.geom_geojson is not None:
        geom_json = json.dumps(body.geom_geojson)
        feature.geom = func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(geom_json)), 4326)

    # Merge properties (preserve existing, override with new)
    existing_props = dict(feature.properties or {})
    if body.properties is not None:
        existing_props.update(body.properties)

    # Automatically record username in "Kmc_Editor" when a DataCollector edits any feature
    if current_user.role == UserRole.DataCollector:
        existing_props["Kmc_Editor"] = current_user.username

    feature.properties = existing_props
    flag_modified(feature, "properties")

    feature.updated_by = current_user.id
    feature.version += 1

    await log_audit(db, current_user.id, "UPDATE_FEATURE", "VectorFeature", feature_id,
                    details={"layer_id": feature.layer_id, "version": feature.version},
                    ip=request.client.host if request.client else None)

    await db.flush()

    # Return updated feature
    feat_result = await db.execute(
        select(
            VectorFeature.id, VectorFeature.properties, VectorFeature.version,
            VectorFeature.created_by, VectorFeature.updated_by,
            VectorFeature.created_at, VectorFeature.updated_at,
            func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).where(VectorFeature.id == feature_id)
    )
    row = feat_result.one()

    return {
        "type": "Feature",
        "id": row.id,
        "geometry": json.loads(row.geojson) if row.geojson else None,
        "properties": {
            **(row.properties or {}),
            "_id": row.id,
            "_created_by": row.created_by,
            "_updated_by": row.updated_by,
            "_updated_by_username": current_user.username,
            "_updated_by_name": current_user.full_name,
            "_version": row.version,
            "_created_at": row.created_at.isoformat() if row.created_at else None,
            "_updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "_edit_type": "update",
        },
    }


@router.delete("/features/{feature_id}", response_model=MessageResponse)
async def delete_feature(
    feature_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """Delete a vector feature (GisAdmin or DataCollector within their assigned grids)."""
    result = await db.execute(select(VectorFeature).where(VectorFeature.id == feature_id))
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    if not await is_layer_accessible_by_user(db, current_user, feature.layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This feature belongs to a layer outside your assigned projects.",
        )

    layer_result = await db.execute(select(VectorLayer).where(VectorLayer.id == feature.layer_id))
    layer = layer_result.scalar_one_or_none()
    if current_user.role == UserRole.DataCollector and layer and not layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Layer not editable by DataCollectors")

    if current_user.role == UserRole.DataCollector:
        # Ownership check: A DataCollector can only delete features created and saved by themselves
        creator_id = feature.created_by
        props = feature.properties or {}
        editor_username = str(props.get("Kmc_Editor", "")).strip().lower()
        is_owner = (creator_id == current_user.id) or (
            editor_username and editor_username == current_user.username.lower()
        )

        if not is_owner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="पहुँच अस्वीकृत: तपाईंले आफूले सिर्जना गरेका फिचरहरू मात्र मेटाउन सक्नुहुन्छ। (Access denied: You can only delete features created and saved by you.)",
            )

        geojson_res = await db.execute(
            select(func.ST_AsGeoJSON(VectorFeature.geom)).where(VectorFeature.id == feature_id)
        )
        raw_geojson = geojson_res.scalar()
        if raw_geojson:
            await verify_collector_grid_containment(db, current_user, feature.layer_id, json.loads(raw_geojson), feature_id=feature_id)

    await log_audit(db, current_user.id, "DELETE_FEATURE", "VectorFeature", feature_id,
                    details={
                        "layer_id": feature.layer_id,
                        "feature_id": feature_id,
                        "properties": feature.properties or {},
                    },
                    ip=request.client.host if request.client else None)
    await db.delete(feature)
    return MessageResponse(message="Feature deleted")


@router.get("/layers/{layer_id}/audit-edits")
async def get_layer_audit_edits(
    layer_id: int,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List recent feature audit logs for a layer (Create, Update, Delete)."""
    if not await is_layer_accessible_by_user(db, current_user, layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This layer is not linked to any of your assigned projects.",
        )

    feature_ids_subq = select(VectorFeature.id).where(VectorFeature.layer_id == layer_id)

    q = (
        select(
            AuditLog.id,
            AuditLog.action,
            AuditLog.entity_id,
            AuditLog.user_id,
            AuditLog.details,
            AuditLog.timestamp,
            User.username,
            User.full_name,
        )
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(
            and_(
                AuditLog.entity_type == "VectorFeature",
                AuditLog.action.in_(["CREATE_FEATURE", "UPDATE_FEATURE", "DELETE_FEATURE"]),
                or_(
                    func.json_extract_path_text(AuditLog.details, "layer_id") == str(layer_id),
                    AuditLog.entity_id.in_(feature_ids_subq),
                ),
            )
        )
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
    )

    result = await db.execute(q)
    rows = result.all()

    audit_edits = []
    for r in rows:
        edit_action = "create"
        if r.action == "UPDATE_FEATURE":
            edit_action = "update"
        elif r.action == "DELETE_FEATURE":
            edit_action = "delete"

        audit_edits.append({
            "id": r.id,
            "feature_id": r.entity_id,
            "layer_id": layer_id,
            "user_id": r.user_id,
            "username": r.username,
            "full_name": r.full_name,
            "action": r.action,
            "edit_type": edit_action,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "details": r.details or {},
        })

    return {
        "layer_id": layer_id,
        "edits": audit_edits,
        "total_count": len(audit_edits),
    }
