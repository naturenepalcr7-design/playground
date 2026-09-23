"""
KMC-GIS-SERVER — Linking Router
Layer-to-layer and feature-to-feature linking endpoints.
"""

import re
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, and_
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import User, UserRole, VectorLayer, VectorFeature
from app.schemas import (
    LayerLinkRequest, LayerLinkResponse, LayerRelationshipItem, LayerRelationshipsResponse,
    FeatureLinkRequest, LinkedFeatureItem, FeatureRelationshipsResponse,
)
from app.auth import get_current_user, require_role
from app.helpers import log_audit, is_layer_accessible_by_user

router = APIRouter(prefix="/api", tags=["Layer Linking"])


def sanitize_link_field_name(target_layer_name: str, custom_name: Optional[str] = None) -> str:
    """Sanitize target layer name to generate a clean <target_layer_name>_linked_id attribute name."""
    if custom_name and custom_name.strip():
        clean = re.sub(r'[^\w_]', '_', custom_name.strip())
        clean = re.sub(r'_+', '_', clean).strip('_')
        return clean if clean else "linked_id"
    clean_name = re.sub(r'[^\w_]', '_', target_layer_name.strip())
    clean_name = re.sub(r'_+', '_', clean_name).strip('_')
    return f"{clean_name}_linked_id"


@router.post("/layers/{source_layer_id}/link", response_model=LayerLinkResponse)
async def link_vector_layers(
    source_layer_id: int,
    body: LayerLinkRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """
    Establish feature-to-feature links between vector layers.
    Automatically creates/updates `<target_layer_name>_linked_id` in the source layer features.
    Supports Attribute Matching and Spatial Overlay predicates.
    """
    # Check source layer access
    if not await is_layer_accessible_by_user(db, current_user, source_layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Source layer is not accessible.",
        )

    # Check target layer access
    if not await is_layer_accessible_by_user(db, current_user, body.target_layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Target layer is not accessible.",
        )

    # Get source layer
    src_res = await db.execute(select(VectorLayer).where(VectorLayer.id == source_layer_id))
    source_layer = src_res.scalar_one_or_none()
    if not source_layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source layer not found")

    # Get target layer
    tgt_res = await db.execute(select(VectorLayer).where(VectorLayer.id == body.target_layer_id))
    target_layer = tgt_res.scalar_one_or_none()
    if not target_layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target layer not found")

    if current_user.role == UserRole.DataCollector and not source_layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Source layer is not editable by DataCollectors")

    # Compute target linked field name (<target_layer_name>_linked_id)
    field_name = sanitize_link_field_name(target_layer.name, body.custom_field_name)

    # Fetch source features
    src_feat_res = await db.execute(select(VectorFeature).where(VectorFeature.layer_id == source_layer_id))
    source_features = src_feat_res.scalars().all()
    total_source = len(source_features)
    if total_source == 0:
        return LayerLinkResponse(
            success=True,
            message=f"स्रोत तह '{source_layer.name}' मा कुनै फिचर उपलब्ध छैन (No features in source layer).",
            source_layer_id=source_layer.id,
            source_layer_name=source_layer.name,
            target_layer_id=target_layer.id,
            target_layer_name=target_layer.name,
            linked_attribute_name=field_name,
            linked_count=0,
            total_source_features=0,
            matched_percentage=0.0,
        )

    # Fetch target features
    tgt_feat_res = await db.execute(select(VectorFeature).where(VectorFeature.layer_id == body.target_layer_id))
    target_features = tgt_feat_res.scalars().all()

    linked_count = 0

    if body.link_method == "attribute":
        src_field = (body.source_match_field or "_id").strip()
        tgt_field = (body.target_match_field or "_id").strip()

        # Build target lookup map: normalized_key -> target_id_value
        target_map = {}
        for tf in target_features:
            if tgt_field in ("_id", "id"):
                match_val = tf.id
            else:
                match_val = (tf.properties or {}).get(tgt_field)

            if match_val is not None:
                norm_key = str(match_val).strip().lower()

                if body.target_id_field in ("_id", "id"):
                    target_val = tf.id
                else:
                    target_val = (tf.properties or {}).get(body.target_id_field, tf.id)

                target_map[norm_key] = target_val

        # Update source features
        for sf in source_features:
            existing_props = dict(sf.properties or {})
            if not body.overwrite_existing and field_name in existing_props and existing_props[field_name] is not None:
                continue

            if src_field in ("_id", "id"):
                src_val = sf.id
            else:
                src_val = existing_props.get(src_field)

            if src_val is not None:
                norm_src_key = str(src_val).strip().lower()
                if norm_src_key in target_map:
                    existing_props[field_name] = target_map[norm_src_key]
                    sf.properties = existing_props
                    flag_modified(sf, "properties")
                    sf.updated_by = current_user.id
                    sf.version += 1
                    linked_count += 1

    elif body.link_method == "spatial":
        # Spatial join using PostGIS
        predicate = body.spatial_predicate or "intersects"
        if predicate == "within":
            spatial_func = "ST_Within(s.geom, t.geom)"
        elif predicate == "contains":
            spatial_func = "ST_Contains(t.geom, s.geom)"
        elif predicate == "nearest":
            spatial_func = "ST_DWithin(s.geom, t.geom, 0.05)"
        else:
            spatial_func = "ST_Intersects(s.geom, t.geom)"

        sql = text(f"""
            SELECT s.id as source_id, t.id as target_id, t.properties as target_props
            FROM vector_features s
            JOIN vector_features t ON {spatial_func}
            WHERE s.layer_id = :source_layer_id AND t.layer_id = :target_layer_id
        """)

        spatial_res = await db.execute(sql, {
            "source_layer_id": source_layer_id,
            "target_layer_id": body.target_layer_id,
        })
        rows = spatial_res.all()

        source_target_match = {}
        for r in rows:
            sid = r.source_id
            if sid not in source_target_match:
                t_props = r.target_props or {}
                if isinstance(t_props, str):
                    try:
                        t_props = json.loads(t_props)
                    except Exception:
                        t_props = {}
                if body.target_id_field in ("_id", "id"):
                    t_val = r.target_id
                else:
                    t_val = t_props.get(body.target_id_field, r.target_id)
                source_target_match[sid] = t_val

        # Update source features
        for sf in source_features:
            existing_props = dict(sf.properties or {})
            if not body.overwrite_existing and field_name in existing_props and existing_props[field_name] is not None:
                continue

            if sf.id in source_target_match:
                existing_props[field_name] = source_target_match[sf.id]
                sf.properties = existing_props
                flag_modified(sf, "properties")
                sf.updated_by = current_user.id
                sf.version += 1
                linked_count += 1

    else:  # direct (e.g. source id == target id)
        target_by_id = {tf.id: tf for tf in target_features}
        for sf in source_features:
            existing_props = dict(sf.properties or {})
            if not body.overwrite_existing and field_name in existing_props and existing_props[field_name] is not None:
                continue

            if sf.id in target_by_id:
                tf = target_by_id[sf.id]
                if body.target_id_field in ("_id", "id"):
                    target_val = tf.id
                else:
                    target_val = (tf.properties or {}).get(body.target_id_field, tf.id)
                existing_props[field_name] = target_val
                sf.properties = existing_props
                flag_modified(sf, "properties")
                sf.updated_by = current_user.id
                sf.version += 1
                linked_count += 1

    await db.flush()
    await db.commit()

    await log_audit(
        db, current_user.id, "LINK_LAYER_FEATURES", "VectorLayer", source_layer_id,
        details={
            "target_layer_id": body.target_layer_id,
            "target_layer_name": target_layer.name,
            "attribute_name": field_name,
            "linked_count": linked_count,
            "total_source": total_source,
        },
        ip=request.client.host if request.client else None,
    )

    percentage = round((linked_count / total_source) * 100, 1) if total_source > 0 else 0.0

    return LayerLinkResponse(
        success=True,
        message=f"{total_source} मध्ये {linked_count} फिचरहरू '{target_layer.name}' सँग '{field_name}' फिल्डमा सफलतापूर्वक जोडिए।",
        source_layer_id=source_layer.id,
        source_layer_name=source_layer.name,
        target_layer_id=target_layer.id,
        target_layer_name=target_layer.name,
        linked_attribute_name=field_name,
        linked_count=linked_count,
        total_source_features=total_source,
        matched_percentage=percentage,
    )


@router.get("/layers/{layer_id}/relationships", response_model=LayerRelationshipsResponse)
async def get_layer_relationships(
    layer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all detected linked layer relationships for a vector layer."""
    if not await is_layer_accessible_by_user(db, current_user, layer_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    layer_res = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id))
    layer = layer_res.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    # Fetch all features of this layer
    feat_res = await db.execute(select(VectorFeature.properties).where(VectorFeature.layer_id == layer_id))
    rows = feat_res.all()
    total_features = len(rows)

    # Detect all *_linked_id fields and count non-null occurrences
    link_counts = {}
    for r in rows:
        props = r[0] or {}
        for k, v in props.items():
            if k.endswith("_linked_id") and v is not None and str(v).strip() != "":
                link_counts[k] = link_counts.get(k, 0) + 1

    # Fetch all vector layers to match target names
    all_layers_res = await db.execute(select(VectorLayer))
    all_layers = all_layers_res.scalars().all()
    layer_map = {re.sub(r'[^a-zA-Z0-9_]', '_', l.name).strip('_').lower(): l for l in all_layers}

    relationships = []
    for field_name, cnt in link_counts.items():
        base_name = field_name[:-10]  # remove '_linked_id'
        base_clean = re.sub(r'[^a-zA-Z0-9_]', '_', base_name).strip('_').lower()
        matched_target = layer_map.get(base_clean)

        target_id = matched_target.id if matched_target else 0
        target_name = matched_target.name if matched_target else base_name

        relationships.append(LayerRelationshipItem(
            target_layer_id=target_id,
            target_layer_name=target_name,
            attribute_name=field_name,
            target_id_field="_id",
            linked_features_count=cnt,
            total_features_count=total_features,
        ))

    return LayerRelationshipsResponse(
        layer_id=layer.id,
        layer_name=layer.name,
        relationships=relationships,
    )


@router.get("/features/{feature_id}/linked", response_model=FeatureRelationshipsResponse)
async def get_feature_linked_items(
    feature_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all features linked to this feature (both outbound and inbound links).
    Includes target geometries and properties for map visualization and attribute inspection.
    """
    from sqlalchemy import func as sa_func

    feat_res = await db.execute(select(VectorFeature).where(VectorFeature.id == feature_id))
    feature = feat_res.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    if not await is_layer_accessible_by_user(db, current_user, feature.layer_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    layer_res = await db.execute(select(VectorLayer).where(VectorLayer.id == feature.layer_id))
    current_layer = layer_res.scalar_one()

    all_layers_res = await db.execute(select(VectorLayer))
    all_layers = all_layers_res.scalars().all()
    layer_by_id = {l.id: l for l in all_layers}
    layer_by_clean_name = {re.sub(r'[^a-zA-Z0-9_]', '_', l.name).strip('_').lower(): l for l in all_layers}

    linked_items = []

    # 1. Outbound links (this feature has *_linked_id)
    props = feature.properties or {}
    for k, val in props.items():
        if k.endswith("_linked_id") and val is not None and str(val).strip() != "":
            target_layer_prefix = k[:-10]
            clean_prefix = re.sub(r'[^a-zA-Z0-9_]', '_', target_layer_prefix).strip('_').lower()
            target_layer = layer_by_clean_name.get(clean_prefix)

            target_feat = None
            if target_layer:
                # Try finding target feature by ID
                try:
                    target_id_int = int(val)
                    tf_res = await db.execute(
                        select(
                            VectorFeature.id,
                            VectorFeature.properties,
                            sa_func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
                        ).where(
                            and_(
                                VectorFeature.layer_id == target_layer.id,
                                VectorFeature.id == target_id_int,
                            )
                        )
                    )
                    target_feat = tf_res.one_or_none()
                except (ValueError, TypeError):
                    target_feat = None

                if not target_feat:
                    # Try matching by property value
                    tf_res = await db.execute(
                        select(
                            VectorFeature.id,
                            VectorFeature.properties,
                            sa_func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
                        ).where(
                            VectorFeature.layer_id == target_layer.id
                        )
                    )
                    for row in tf_res.all():
                        r_props = row.properties or {}
                        if any(str(pv).strip().lower() == str(val).strip().lower() for pv in r_props.values()):
                            target_feat = row
                            break

            if target_feat:
                geom_parsed = json.loads(target_feat.geojson) if target_feat.geojson else None
                linked_items.append(LinkedFeatureItem(
                    layer_id=target_layer.id if target_layer else 0,
                    layer_name=target_layer.name if target_layer else target_layer_prefix,
                    feature_id=target_feat.id,
                    target_id_field="_id",
                    target_id_value=val,
                    attribute_name=k,
                    properties=target_feat.properties or {},
                    geom_geojson=geom_parsed,
                    direction="outbound",
                ))
            else:
                linked_items.append(LinkedFeatureItem(
                    layer_id=target_layer.id if target_layer else 0,
                    layer_name=target_layer.name if target_layer else target_layer_prefix,
                    feature_id=int(val) if str(val).isdigit() else 0,
                    target_id_field="_id",
                    target_id_value=val,
                    attribute_name=k,
                    properties={},
                    geom_geojson=None,
                    direction="outbound",
                ))

    # 2. Inbound links (features pointing to this feature, across or within layers)
    curr_layer_clean = re.sub(r'[^a-zA-Z0-9_]', '_', current_layer.name).strip('_')
    inbound_field = f"{curr_layer_clean}_linked_id"
    match_targets = {
        str(feature.id).strip(),
        str(props.get("id", "")).strip(),
        str(props.get("gid", "")).strip(),
        str(props.get("fid", "")).strip(),
    }
    match_targets = {m for m in match_targets if m and m != "None"}

    inbound_res = await db.execute(
        select(
            VectorFeature.id,
            VectorFeature.layer_id,
            VectorFeature.properties,
            sa_func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).where(
            VectorFeature.id != feature.id
        )
    )
    for in_row in inbound_res.all():
        in_props = in_row.properties or {}
        val = in_props.get(inbound_field) or in_props.get("target_id") or in_props.get("linked_point_gid") or in_props.get("linked_point_id")
        if val is not None and str(val).strip() in match_targets:
            in_layer = layer_by_id.get(in_row.layer_id)
            geom_parsed = json.loads(in_row.geojson) if in_row.geojson else None
            linked_items.append(LinkedFeatureItem(
                layer_id=in_row.layer_id,
                layer_name=in_layer.name if in_layer else f"Layer {in_row.layer_id}",
                feature_id=in_row.id,
                target_id_field="_id",
                target_id_value=feature.id,
                attribute_name=inbound_field,
                properties=in_props,
                geom_geojson=geom_parsed,
                direction="inbound",
            ))

    return FeatureRelationshipsResponse(
        feature_id=feature.id,
        layer_id=current_layer.id,
        layer_name=current_layer.name,
        linked_features=linked_items,
    )


@router.post("/features/{feature_id}/link")
async def link_single_feature(
    feature_id: int,
    body: FeatureLinkRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """Link a single feature to a target feature in a target layer."""
    feat_res = await db.execute(select(VectorFeature).where(VectorFeature.id == feature_id))
    feature = feat_res.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    if not await is_layer_accessible_by_user(db, current_user, feature.layer_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    tgt_res = await db.execute(select(VectorLayer).where(VectorLayer.id == body.target_layer_id))
    target_layer = tgt_res.scalar_one_or_none()
    if not target_layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target layer not found")

    field_name = sanitize_link_field_name(target_layer.name, body.custom_field_name)

    props = dict(feature.properties or {})
    props[field_name] = body.target_feature_id
    if current_user.role == UserRole.DataCollector:
        props["Kmc_Editor"] = current_user.username
    feature.properties = props
    flag_modified(feature, "properties")
    feature.updated_by = current_user.id
    feature.version += 1

    await log_audit(
        db, current_user.id, "LINK_FEATURE", "VectorFeature", feature_id,
        details={"target_layer_id": body.target_layer_id, "attribute_name": field_name, "value": body.target_feature_id},
        ip=request.client.host if request.client else None,
    )
    await db.flush()
    await db.commit()

    return {
        "message": f"विशेषता '{target_layer.name}' सँग सफलतापूर्वक जोडियो",
        "field_name": field_name,
        "value": body.target_feature_id,
        "feature_id": feature.id,
    }


@router.delete("/features/{feature_id}/link")
async def unlink_single_feature(
    feature_id: int,
    target_layer_id: Optional[int] = Query(None),
    attribute_name: Optional[str] = Query(None),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """Remove a link to a target layer from a single feature."""
    feat_res = await db.execute(select(VectorFeature).where(VectorFeature.id == feature_id))
    feature = feat_res.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    if not await is_layer_accessible_by_user(db, current_user, feature.layer_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    field_to_remove = attribute_name
    if not field_to_remove and target_layer_id:
        tgt_res = await db.execute(select(VectorLayer).where(VectorLayer.id == target_layer_id))
        target_layer = tgt_res.scalar_one_or_none()
        if target_layer:
            field_to_remove = sanitize_link_field_name(target_layer.name)

    if not field_to_remove:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Specify attribute_name or target_layer_id")

    props = dict(feature.properties or {})
    if field_to_remove in props:
        del props[field_to_remove]
        if current_user.role == UserRole.DataCollector:
            props["Kmc_Editor"] = current_user.username
        feature.properties = props
        flag_modified(feature, "properties")
        feature.updated_by = current_user.id
        feature.version += 1
        await log_audit(
            db, current_user.id, "UNLINK_FEATURE", "VectorFeature", feature_id,
            details={"field_removed": field_to_remove},
            ip=request.client.host if request and request.client else None,
        )
        await db.flush()
        await db.commit()

    return {"message": f"Link removed for {field_to_remove}", "feature_id": feature.id}
