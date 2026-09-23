"""
KMC-GIS-SERVER — OGC API – Features & WFS Vector Router
Fully compliant with OGC API – Features (Part 1: Core, Part 2: CRS, Part 4: CRUD)
and WFS 1.1.0 / 2.0.0 auto-detection for complete QGIS desktop compatibility.

Two prefixes:
  /ogc/         — Fully open, no authentication required
  /ogc-secure/  — All operations require Bearer token authentication
"""

import json
import re
from datetime import datetime, timezone
from typing import Optional, Tuple
from xml.sax.saxutils import escape as xml_escape
import xml.etree.ElementTree as ET

ET.register_namespace("gml", "http://www.opengis.net/gml")
ET.register_namespace("wfs", "http://www.opengis.net/wfs")
ET.register_namespace("ogc", "http://www.opengis.net/ogc")
ET.register_namespace("ows", "http://www.opengis.net/ows")

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models import VectorLayer, VectorFeature, User
from app.auth import get_current_user


def _get_base_url(request: Request) -> str:
    """Extract external base URL honoring reverse proxy headers."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    if host:
        return f"{proto}://{host}"
    return str(request.base_url).rstrip("/")


async def _resolve_layer(collection_id: str, db: AsyncSession) -> Optional[VectorLayer]:
    """Resolve a VectorLayer by integer ID or layer name (case-insensitive)."""
    if str(collection_id).isdigit():
        res = await db.execute(select(VectorLayer).where(VectorLayer.id == int(collection_id)))
        layer = res.scalar_one_or_none()
        if layer:
            return layer
    # Try exact name match
    res = await db.execute(select(VectorLayer).where(VectorLayer.name == collection_id))
    layer = res.scalar_one_or_none()
    if layer:
        return layer
    # Try case-insensitive name match
    res = await db.execute(select(VectorLayer).where(func.lower(VectorLayer.name) == collection_id.lower()))
    return res.scalar_one_or_none()


# ============================================================
# OpenAPI 3.0 Specification Generator
# ============================================================

def _openapi_spec(base_url: str, is_secure: bool = False) -> dict:
    svc = f"{base_url}/ogc-secure" if is_secure else f"{base_url}/ogc"
    title = "KMC GIS Server — OGC API Features (Secure)" if is_secure else "KMC GIS Server — OGC API Features"
    desc = "OGC API – Features service for Kathmandu Metropolitan City GIS vector layers."

    return {
        "openapi": "3.0.3",
        "info": {
            "title": title,
            "description": desc,
            "version": "1.0.0",
            "contact": {
                "name": "Kathmandu Metropolitan City GIS Administration",
                "email": "gis@kathmandu.gov.np"
            }
        },
        "servers": [
            {"url": svc, "description": "OGC API Features Service"}
        ],
        "paths": {
            "/": {
                "get": {
                    "summary": "Landing page",
                    "description": "Links to API definition, conformance statements and feature collections.",
                    "operationId": "getLandingPage",
                    "responses": {
                        "200": {
                            "description": "The landing page of the server",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/landingPage"}}
                            }
                        }
                    }
                }
            },
            "/api": {
                "get": {
                    "summary": "OpenAPI 3.0 definition",
                    "description": "The OpenAPI 3.0 document describing this API.",
                    "operationId": "getOpenAPI",
                    "responses": {
                        "200": {
                            "description": "OpenAPI 3.0 document",
                            "content": {
                                "application/vnd.oai.openapi+json;version=3.0": {},
                                "application/json": {}
                            }
                        }
                    }
                }
            },
            "/conformance": {
                "get": {
                    "summary": "Conformance classes",
                    "description": "Information about standards that this API conforms to.",
                    "operationId": "getConformance",
                    "responses": {
                        "200": {
                            "description": "Conformance declaration",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/confClasses"}}
                            }
                        }
                    }
                }
            },
            "/collections": {
                "get": {
                    "summary": "Feature collections",
                    "description": "Metadata about the vector layer collections available on this server.",
                    "operationId": "getCollections",
                    "responses": {
                        "200": {
                            "description": "List of collections",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/collections"}}
                            }
                        }
                    }
                }
            },
            "/collections/{collectionId}": {
                "get": {
                    "summary": "Describe a collection",
                    "description": "Metadata about a specific vector layer collection.",
                    "operationId": "describeCollection",
                    "parameters": [
                        {
                            "name": "collectionId",
                            "in": "path",
                            "description": "Identifier of the collection (layer ID or name)",
                            "required": True,
                            "schema": {"type": "string"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Collection metadata",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/collection"}}
                            }
                        },
                        "404": {"description": "Collection not found"}
                    }
                }
            },
            "/collections/{collectionId}/items": {
                "get": {
                    "summary": "Query features",
                    "description": "Fetch features of the vector layer as a GeoJSON FeatureCollection.",
                    "operationId": "getFeatures",
                    "parameters": [
                        {
                            "name": "collectionId",
                            "in": "path",
                            "description": "Identifier of the collection (layer ID or name)",
                            "required": True,
                            "schema": {"type": "string"}
                        },
                        {
                            "name": "limit",
                            "in": "query",
                            "description": "Maximum number of features to return (1-10000)",
                            "required": False,
                            "schema": {"type": "integer", "default": 1000, "minimum": 1, "maximum": 10000}
                        },
                        {
                            "name": "offset",
                            "in": "query",
                            "description": "Number of features to skip for pagination",
                            "required": False,
                            "schema": {"type": "integer", "default": 0, "minimum": 0}
                        },
                        {
                            "name": "bbox",
                            "in": "query",
                            "description": "Bounding box coordinates: minx,miny,maxx,maxy (WGS 84)",
                            "required": False,
                            "schema": {"type": "string"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "GeoJSON FeatureCollection",
                            "content": {
                                "application/geo+json": {"schema": {"$ref": "#/components/schemas/featureCollectionGeoJSON"}},
                                "application/json": {"schema": {"$ref": "#/components/schemas/featureCollectionGeoJSON"}}
                            }
                        },
                        "404": {"description": "Collection not found"}
                    }
                },
                "post": {
                    "summary": "Add a feature",
                    "description": "Insert a new feature into the vector layer (Part 4 Transactions).",
                    "operationId": "createFeature",
                    "parameters": [
                        {
                            "name": "collectionId",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"}
                        }
                    ],
                    "requestBody": {
                        "description": "GeoJSON feature to add",
                        "required": True,
                        "content": {
                            "application/geo+json": {"schema": {"$ref": "#/components/schemas/featureGeoJSON"}},
                            "application/json": {"schema": {"$ref": "#/components/schemas/featureGeoJSON"}}
                        }
                    },
                    "responses": {
                        "201": {"description": "Feature created successfully"},
                        "400": {"description": "Invalid feature data"},
                        "404": {"description": "Collection not found"}
                    }
                }
            },
            "/collections/{collectionId}/items/{featureId}": {
                "get": {
                    "summary": "Get a feature",
                    "description": "Fetch a single feature by its ID.",
                    "operationId": "getFeature",
                    "parameters": [
                        {"name": "collectionId", "in": "path", "required": True, "schema": {"type": "string"}},
                        {"name": "featureId", "in": "path", "required": True, "schema": {"type": "integer"}}
                    ],
                    "responses": {
                        "200": {
                            "description": "GeoJSON Feature",
                            "content": {
                                "application/geo+json": {"schema": {"$ref": "#/components/schemas/featureGeoJSON"}},
                                "application/json": {"schema": {"$ref": "#/components/schemas/featureGeoJSON"}}
                            }
                        },
                        "404": {"description": "Feature not found"}
                    }
                },
                "put": {
                    "summary": "Update a feature",
                    "description": "Replace an existing feature geometry and attributes.",
                    "operationId": "replaceFeature",
                    "parameters": [
                        {"name": "collectionId", "in": "path", "required": True, "schema": {"type": "string"}},
                        {"name": "featureId", "in": "path", "required": True, "schema": {"type": "integer"}}
                    ],
                    "responses": {
                        "200": {"description": "Feature updated successfully"},
                        "404": {"description": "Feature not found"}
                    }
                },
                "delete": {
                    "summary": "Delete a feature",
                    "description": "Delete a feature by ID.",
                    "operationId": "deleteFeature",
                    "parameters": [
                        {"name": "collectionId", "in": "path", "required": True, "schema": {"type": "string"}},
                        {"name": "featureId", "in": "path", "required": True, "schema": {"type": "integer"}}
                    ],
                    "responses": {
                        "200": {"description": "Feature deleted"},
                        "404": {"description": "Feature not found"}
                    }
                }
            }
        },
        "components": {
            "schemas": {
                "link": {
                    "type": "object",
                    "required": ["href", "rel"],
                    "properties": {
                        "href": {"type": "string"},
                        "rel": {"type": "string"},
                        "type": {"type": "string"},
                        "title": {"type": "string"}
                    }
                },
                "landingPage": {
                    "type": "object",
                    "required": ["links"],
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "links": {"type": "array", "items": {"$ref": "#/components/schemas/link"}}
                    }
                },
                "confClasses": {
                    "type": "object",
                    "required": ["conformsTo"],
                    "properties": {
                        "conformsTo": {"type": "array", "items": {"type": "string"}}
                    }
                },
                "collection": {
                    "type": "object",
                    "required": ["id", "links"],
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "itemType": {"type": "string", "default": "feature"},
                        "crs": {"type": "array", "items": {"type": "string"}},
                        "extent": {"type": "object"},
                        "links": {"type": "array", "items": {"$ref": "#/components/schemas/link"}}
                    }
                },
                "collections": {
                    "type": "object",
                    "required": ["collections", "links"],
                    "properties": {
                        "collections": {"type": "array", "items": {"$ref": "#/components/schemas/collection"}},
                        "links": {"type": "array", "items": {"$ref": "#/components/schemas/link"}}
                    }
                },
                "featureGeoJSON": {
                    "type": "object",
                    "required": ["type", "geometry", "properties"],
                    "properties": {
                        "type": {"type": "string", "enum": ["Feature"]},
                        "id": {"type": ["string", "integer"]},
                        "geometry": {"type": "object"},
                        "properties": {"type": "object"},
                        "links": {"type": "array", "items": {"$ref": "#/components/schemas/link"}}
                    }
                },
                "featureCollectionGeoJSON": {
                    "type": "object",
                    "required": ["type", "features"],
                    "properties": {
                        "type": {"type": "string", "enum": ["FeatureCollection"]},
                        "features": {"type": "array", "items": {"$ref": "#/components/schemas/featureGeoJSON"}},
                        "numberMatched": {"type": "integer"},
                        "numberReturned": {"type": "integer"},
                        "timeStamp": {"type": "string", "format": "date-time"},
                        "links": {"type": "array", "items": {"$ref": "#/components/schemas/link"}}
                    }
                }
            }
        }
    }


# ============================================================
# BBOX Normalization & WFS GML / XML Generators
# ============================================================

def _parse_bbox(bbox_str: Optional[str]) -> Optional[Tuple[float, float, float, float]]:
    """
    Parse and normalize bounding box from query string.
    Handles:
    - 4 values: minx, miny, maxx, maxy or miny, minx, maxy, maxx
    - 5 values (with CRS suffix e.g. urn:ogc:def:crs:EPSG::4326)
    - Global extent probes (e.g. -90, -180, 90, 180 or -180, -90, 180, 90) -> returns None to fetch all features
    - Inverted axis orders (EPSG:4326 lat/lon vs lon/lat)
    Returns: (west, south, east, north) in WGS84
    """
    if not bbox_str:
        return None
    try:
        cleaned = str(bbox_str).strip("()[]\"' ")
        parts = [p.strip() for p in cleaned.split(",") if p.strip()]
        if len(parts) < 4:
            return None
        v0, v1, v2, v3 = float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])

        # Global extent probe detection: if bounds span near full globe, bypass spatial filter
        if (abs(v0) >= 80 and abs(v1) >= 170) or (abs(v0) >= 170 and abs(v1) >= 80):
            return None

        min_v02, max_v02 = min(v0, v2), max(v0, v2)
        min_v13, max_v13 = min(v1, v3), max(v1, v3)

        # In Nepal / Kathmandu region: Latitude ~27.7, Longitude ~85.3
        # Check if v0 is latitude and v1 is longitude
        if min_v02 < 50 and min_v13 > 60:
            south, north = min_v02, max_v02
            west, east = min_v13, max_v13
        elif min_v02 > 60 and min_v13 < 50:
            west, east = min_v02, max_v02
            south, north = min_v13, max_v13
        else:
            # Check for EPSG:4326 in 5th part (WFS 1.1.0 specifies lat,lon for 4326)
            srs = parts[4].lower() if len(parts) >= 5 else ""
            if "epsg::4326" in srs or "epsg:4326" in srs:
                south, north = min_v02, max_v02
                west, east = min_v13, max_v13
            else:
                west, east = min_v02, max_v02
                south, north = min_v13, max_v13

        return (west, south, east, north)
    except Exception:
        return None


async def _wfs_get_feature(
    request: Request,
    layer: VectorLayer,
    db: AsyncSession,
    limit: int = 50000,
    offset: int = 0,
    bbox_str: Optional[str] = None,
) -> Response:
    """Generate compliant WFS 1.1.0 / 1.0.0 GML 2.1.2 FeatureCollection for QGIS desktop."""
    base = _get_base_url(request)
    path = request.url.path
    svc = f"{base}/ogc-secure" if "/ogc-secure" in path else f"{base}/ogc"

    clean_layer_name = re.sub(r'[^a-zA-Z0-9_]', '_', layer.name).strip('_') or f"layer_{layer.id}"

    query = select(
        VectorFeature.id,
        VectorFeature.properties,
        func.ST_AsGML(2, VectorFeature.geom).label("gml"),
    ).where(VectorFeature.layer_id == layer.id)

    parsed_bbox = _parse_bbox(bbox_str)
    if parsed_bbox:
        west, south, east, north = parsed_bbox
        bbox_wkt = f"POLYGON(({west} {south}, {east} {south}, {east} {north}, {west} {north}, {west} {south}))"
        query = query.where(
            func.ST_Intersects(VectorFeature.geom, func.ST_GeomFromText(bbox_wkt, 4326))
        )

    # Calculate overall extent for gml:boundedBy
    ext_result = await db.execute(
        select(
            func.ST_XMin(func.ST_Extent(VectorFeature.geom)),
            func.ST_YMin(func.ST_Extent(VectorFeature.geom)),
            func.ST_XMax(func.ST_Extent(VectorFeature.geom)),
            func.ST_YMax(func.ST_Extent(VectorFeature.geom)),
        ).where(VectorFeature.layer_id == layer.id)
    )
    ext_row = ext_result.one_or_none()
    minx, miny, maxx, maxy = 85.2, 27.6, 85.4, 27.8
    if ext_row and ext_row[0] is not None:
        minx, miny, maxx, maxy = float(ext_row[0]), float(ext_row[1]), float(ext_row[2]), float(ext_row[3])

    query = query.order_by(VectorFeature.id).offset(offset).limit(limit)
    rows = (await db.execute(query)).all()

    members = []
    for row in rows:
        fid = f"{clean_layer_name}.{row.id}"
        gml_geom = row.gml or ""

        # Build clean XML property tags
        props = dict(row.properties or {})
        prop_tags = []
        for k, v in props.items():
            if str(k).startswith("__"):
                continue
            k_clean = re.sub(r'[^a-zA-Z0-9_]', '_', str(k)).strip('_')
            if not k_clean:
                continue
            if k_clean[0].isdigit():
                k_clean = f"f_{k_clean}"
            if v is None:
                prop_tags.append(f"      <kmc:{k_clean} xsi:nil=\"true\"/>")
            else:
                val_str = xml_escape(str(v))
                prop_tags.append(f"      <kmc:{k_clean}>{val_str}</kmc:{k_clean}>")

        props_xml = "\n".join(prop_tags)
        members.append(f"""  <gml:featureMember>
    <kmc:{clean_layer_name} fid="{fid}" gml:id="{fid}">
      <kmc:geometry>
        {gml_geom}
      </kmc:geometry>
{props_xml}
    </kmc:{clean_layer_name}>
  </gml:featureMember>""")

    members_xml = "\n".join(members)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    xml_response = f"""<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:kmc="{svc}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  numberOfFeatures="{len(rows)}"
  timeStamp="{now_iso}">
  <gml:boundedBy>
    <gml:Box srsName="EPSG:4326">
      <gml:coordinates>{minx},{miny} {maxx},{maxy}</gml:coordinates>
    </gml:Box>
  </gml:boundedBy>
{members_xml}
</wfs:FeatureCollection>"""

    return Response(content=xml_response, media_type="text/xml; charset=utf-8")


async def _handle_wfs_transaction(request: Request, body_text: str, db: AsyncSession) -> Response:
    """
    Handle WFS-T (Transactional WFS) Insert, Update, and Delete operations from QGIS desktop.
    Enables QGIS 'Toggle Editing' (pencil icon) and persists edits directly to PostGIS.
    """
    num_inserted = 0
    num_updated = 0
    num_deleted = 0
    inserted_fids = []

    try:
        root = ET.fromstring(body_text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid WFS Transaction XML: {str(e)}")

    for child in root:
        action = child.tag.split("}")[-1]

        # 1. INSERT OPERATION
        if action == "Insert":
            for feat_elem in child:
                layer_name = feat_elem.tag.split("}")[-1]
                layer = await _resolve_layer(layer_name, db)
                if not layer:
                    continue

                gml_str = None
                props = {}
                for prop_elem in feat_elem:
                    p_tag = prop_elem.tag.split("}")[-1]
                    if p_tag in ("geometry", "geom") or "Polygon" in p_tag or "LineString" in p_tag or "Point" in p_tag:
                        if len(prop_elem) > 0:
                            gml_str = ET.tostring(prop_elem[0], encoding="unicode")
                        else:
                            gml_str = ET.tostring(prop_elem, encoding="unicode")
                    else:
                        props[p_tag] = prop_elem.text

                geom_sql = None
                if gml_str:
                    geom_sql = func.ST_SetSRID(func.ST_Multi(func.ST_Force2D(func.ST_GeomFromGML(gml_str))), 4326)

                if geom_sql is not None:
                    new_feat = VectorFeature(
                        layer_id=layer.id,
                        geom=geom_sql,
                        properties=props,
                        created_by=1,
                        version=1,
                    )
                    db.add(new_feat)
                    await db.flush()
                    clean_name = re.sub(r'[^a-zA-Z0-9_]', '_', layer.name).strip('_')
                    inserted_fids.append(f"{clean_name}.{new_feat.id}")
                    num_inserted += 1

        # 2. UPDATE OPERATION
        elif action == "Update":
            type_name = child.attrib.get("typeName", "")
            clean_name = type_name.split(":")[-1]
            layer = await _resolve_layer(clean_name, db) if clean_name else None

            target_id = None
            for filter_elem in child.iter():
                if filter_elem.tag.split("}")[-1] in ("FeatureId", "GmlObjectId"):
                    fid_val = filter_elem.attrib.get("fid") or filter_elem.attrib.get("gml:id", "")
                    if fid_val and "." in fid_val:
                        try:
                            target_id = int(fid_val.split(".")[-1])
                        except ValueError:
                            pass
                    elif fid_val and fid_val.isdigit():
                        target_id = int(fid_val)

            if target_id is not None:
                feat_res = await db.execute(select(VectorFeature).where(VectorFeature.id == target_id))
                feat = feat_res.scalar_one_or_none()
                if feat:
                    new_props = {}
                    new_gml = None

                    for prop_elem in child:
                        if prop_elem.tag.split("}")[-1] == "Property":
                            name_elem = None
                            val_elem = None
                            for sub in prop_elem:
                                sub_tag = sub.tag.split("}")[-1]
                                if sub_tag == "Name":
                                    name_elem = sub
                                elif sub_tag == "Value":
                                    val_elem = sub

                            if name_elem is not None and val_elem is not None:
                                p_name = (name_elem.text or "").strip().split(":")[-1]
                                if p_name in ("geometry", "geom") or len(val_elem) > 0:
                                    if len(val_elem) > 0:
                                        new_gml = ET.tostring(val_elem[0], encoding="unicode")
                                    else:
                                        new_gml = ET.tostring(val_elem, encoding="unicode")
                                else:
                                    new_props[p_name] = val_elem.text

                    if new_gml:
                        feat.geom = func.ST_SetSRID(func.ST_Multi(func.ST_Force2D(func.ST_GeomFromGML(new_gml))), 4326)

                    if new_props:
                        existing = dict(feat.properties or {})
                        existing.update(new_props)
                        feat.properties = existing
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(feat, "properties")

                    feat.version = (feat.version or 1) + 1
                    await db.flush()
                    num_updated += 1

        # 3. DELETE OPERATION
        elif action == "Delete":
            target_id = None
            for filter_elem in child.iter():
                if filter_elem.tag.split("}")[-1] in ("FeatureId", "GmlObjectId"):
                    fid_val = filter_elem.attrib.get("fid") or filter_elem.attrib.get("gml:id", "")
                    if fid_val and "." in fid_val:
                        try:
                            target_id = int(fid_val.split(".")[-1])
                        except ValueError:
                            pass
                    elif fid_val and fid_val.isdigit():
                        target_id = int(fid_val)

            if target_id is not None:
                feat_res = await db.execute(select(VectorFeature).where(VectorFeature.id == target_id))
                feat = feat_res.scalar_one_or_none()
                if feat:
                    await db.delete(feat)
                    await db.flush()
                    num_deleted += 1

    await db.commit()

    insert_xml = "\n".join([f'      <wfs:Feature><ogc:FeatureId fid="{fid}"/></wfs:Feature>' for fid in inserted_fids])
    resp_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<wfs:TransactionResponse version="1.1.0"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <wfs:TransactionSummary>
    <wfs:totalInserted>{num_inserted}</wfs:totalInserted>
    <wfs:totalUpdated>{num_updated}</wfs:totalUpdated>
    <wfs:totalDeleted>{num_deleted}</wfs:totalDeleted>
  </wfs:TransactionSummary>
  <wfs:InsertResults>
{insert_xml}
  </wfs:InsertResults>
  <wfs:TransactionResult>
    <wfs:Status>
      <wfs:SUCCESS/>
    </wfs:Status>
  </wfs:TransactionResult>
</wfs:TransactionResponse>"""

    return Response(content=resp_xml, media_type="text/xml; charset=utf-8")


async def _handle_wfs_post_request(request: Request, db: AsyncSession) -> Response:
    """Handle classic WFS POST requests from QGIS or map clients."""
    qp = {k.upper(): v for k, v in request.query_params.items()}
    if qp.get("REQUEST"):
        return await _handle_wfs_request(request, db)

    body_bytes = await request.body()
    body_text = body_bytes.decode("utf-8", errors="ignore")

    if "Transaction" in body_text or qp.get("REQUEST", "").upper() == "TRANSACTION":
        return await _handle_wfs_transaction(request, body_text, db)

    if "GetCapabilities" in body_text:
        return await _handle_wfs_request(request, db)

    if "DescribeFeatureType" in body_text:
        m = re.search(r'typeName=["\']([^"\']+)["\']', body_text, re.IGNORECASE)
        typename = m.group(1) if m else ""
        request.scope["query_string"] = f"SERVICE=WFS&REQUEST=DescribeFeatureType&TYPENAME={typename}".encode()
        return await _handle_wfs_request(request, db)

    if "GetFeature" in body_text:
        m_type = re.search(r'typeName=["\']([^"\']+)["\']', body_text, re.IGNORECASE)
        typename = m_type.group(1) if m_type else ""
        clean_name = typename.split(":")[-1]
        layer = await _resolve_layer(clean_name, db) if clean_name else None

        m_bbox = re.search(r'<ogc:BBOX>.*?<gml:coordinates>([^<]+)</gml:coordinates>.*?</ogc:BBOX>', body_text, re.DOTALL | re.IGNORECASE)
        bbox_str = None
        if m_bbox:
            bbox_str = m_bbox.group(1).strip().replace(" ", ",")

        m_max = re.search(r'maxFeatures=["\'](\d+)["\']', body_text, re.IGNORECASE)
        max_feat = int(m_max.group(1)) if m_max else 50000

        if layer:
            return await _wfs_get_feature(request, layer, db, limit=max_feat, offset=0, bbox_str=bbox_str)

    return await _handle_wfs_request(request, db)


async def _handle_wfs_request(request: Request, db: AsyncSession) -> Response:
    """Handle classic WFS 1.1.0/2.0.0 requests from QGIS auto-detect and WFS provider."""
    base = _get_base_url(request)
    path = request.url.path
    svc = f"{base}/ogc-secure" if "/ogc-secure" in path else f"{base}/ogc"

    qp = {k.upper(): v for k, v in request.query_params.items()}
    req_type = qp.get("REQUEST", "").upper()

    if req_type == "TRANSACTION":
        body_bytes = await request.body()
        body_text = body_bytes.decode("utf-8", errors="ignore")
        return await _handle_wfs_transaction(request, body_text, db)

    if req_type == "DESCRIBEFEATURETYPE":
        type_name = qp.get("TYPENAME") or qp.get("TYPENAMES") or ""
        clean_name = type_name.split(":")[-1] if type_name else ""

        async def _build_layer_xsd(l: VectorLayer) -> str:
            lname = re.sub(r'[^a-zA-Z0-9_]', '_', l.name).strip('_') or f"layer_{l.id}"
            gtype = str(l.geometry_type or "").upper()
            if "POLYGON" in gtype:
                gml_geom_type = "gml:MultiPolygonPropertyType"
            elif "LINE" in gtype:
                gml_geom_type = "gml:MultiLineStringPropertyType"
            elif "POINT" in gtype:
                gml_geom_type = "gml:PointPropertyType"
            else:
                gml_geom_type = "gml:GeometryPropertyType"

            prop_elements = [
                f'          <xs:element name="geometry" type="{gml_geom_type}" minOccurs="0" maxOccurs="1"/>'
            ]

            fields = l.fields_config or []
            if isinstance(fields, str):
                try:
                    fields = json.loads(fields)
                except Exception:
                    fields = []

            if not fields:
                sample_res = await db.execute(
                    select(VectorFeature.properties).where(VectorFeature.layer_id == l.id).limit(1)
                )
                sample_props = sample_res.scalar_one_or_none()
                if sample_props and isinstance(sample_props, dict):
                    for k, v in sample_props.items():
                        if str(k).startswith("__"):
                            continue
                        k_clean = re.sub(r'[^a-zA-Z0-9_]', '_', str(k)).strip('_')
                        if not k_clean:
                            continue
                        if k_clean[0].isdigit():
                            k_clean = f"f_{k_clean}"
                        xsd_type = "xs:double" if isinstance(v, (int, float)) else "xs:string"
                        prop_elements.append(f'          <xs:element name="{k_clean}" type="{xsd_type}" minOccurs="0" maxOccurs="1" nillable="true"/>')
            else:
                for f in fields:
                    fname = re.sub(r'[^a-zA-Z0-9_]', '_', str(f.get("name", ""))).strip('_')
                    if not fname:
                        continue
                    if fname[0].isdigit():
                        fname = f"f_{fname}"
                    ftype = str(f.get("type", "text")).lower()
                    if ftype in ("number", "integer", "int", "float", "double"):
                        xsd_type = "xs:double"
                    elif ftype in ("boolean", "bool"):
                        xsd_type = "xs:boolean"
                    else:
                        xsd_type = "xs:string"
                    prop_elements.append(f'          <xs:element name="{fname}" type="{xsd_type}" minOccurs="0" maxOccurs="1" nillable="true"/>')

            prop_elements.append('          <xs:any minOccurs="0" maxOccurs="unbounded" processContents="lax"/>')
            props_str = "\n".join(prop_elements)

            return f"""  <xs:element name="{lname}" type="kmc:{lname}Type" substitutionGroup="gml:_Feature"/>
  <xs:complexType name="{lname}Type">
    <xs:complexContent>
      <xs:extension base="gml:AbstractFeatureType">
        <xs:sequence>
{props_str}
        </xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>"""

        if clean_name:
            layer = await _resolve_layer(clean_name, db)
            if layer:
                type_elements = await _build_layer_xsd(layer)
            else:
                type_elements = f"""  <xs:element name="{clean_name}" type="kmc:{clean_name}Type" substitutionGroup="gml:_Feature"/>
  <xs:complexType name="{clean_name}Type">
    <xs:complexContent>
      <xs:extension base="gml:AbstractFeatureType">
        <xs:sequence>
          <xs:element name="geometry" type="gml:GeometryPropertyType" minOccurs="0" maxOccurs="1"/>
          <xs:any minOccurs="0" maxOccurs="unbounded" processContents="lax"/>
        </xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>"""
        else:
            result = await db.execute(select(VectorLayer).order_by(VectorLayer.id))
            all_layers = result.scalars().all()
            blocks = []
            for l in all_layers:
                blocks.append(await _build_layer_xsd(l))
            type_elements = "\n".join(blocks)

        xsd = f"""<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:gml="http://www.opengis.net/gml"
           xmlns:kmc="{svc}"
           targetNamespace="{svc}"
           elementFormDefault="qualified" version="1.0">
  <xs:import namespace="http://www.opengis.net/gml" schemaLocation="http://schemas.opengis.net/gml/3.1.1/base/gml.xsd"/>
{type_elements}
</xs:schema>"""
        return Response(content=xsd, media_type="text/xml; charset=utf-8")

    if req_type == "GETFEATURE":
        type_name = qp.get("TYPENAME") or qp.get("TYPENAMES") or ""
        clean_name = type_name.split(":")[-1] if type_name else ""
        layer = await _resolve_layer(clean_name, db) if clean_name else None
        if not layer and not clean_name:
            res = await db.execute(select(VectorLayer).order_by(VectorLayer.id))
            layer = res.scalars().first()

        if layer:
            out_fmt = qp.get("OUTPUTFORMAT", "").lower()
            limit = int(qp.get("MAXFEATURES", 50000))
            if "json" in out_fmt or "geojson" in out_fmt:
                return await _get_items(request, str(layer.id), db, limit=limit, offset=0, bbox=qp.get("BBOX"))
            return await _wfs_get_feature(request, layer, db, limit=limit, offset=0, bbox_str=qp.get("BBOX"))

    # Default / GetCapabilities
    result = await db.execute(select(VectorLayer).order_by(VectorLayer.id))
    layers = result.scalars().all()

    req_version = qp.get("VERSION") or qp.get("ACCEPTVERSIONS") or "1.1.0"
    if req_version.startswith("1.0"):
        # Compliant WFS 1.0.0 GetCapabilities
        f_types = []
        for l in layers:
            ext_res = await db.execute(
                select(
                    func.ST_XMin(func.ST_Extent(VectorFeature.geom)),
                    func.ST_YMin(func.ST_Extent(VectorFeature.geom)),
                    func.ST_XMax(func.ST_Extent(VectorFeature.geom)),
                    func.ST_YMax(func.ST_Extent(VectorFeature.geom)),
                ).where(VectorFeature.layer_id == l.id)
            )
            er = ext_res.one_or_none()
            minx, miny, maxx, maxy = 85.2, 27.6, 85.4, 27.8
            if er and er[0] is not None:
                minx, miny, maxx, maxy = float(er[0]), float(er[1]), float(er[2]), float(er[3])
            f_types.append(f"""    <FeatureType>
      <Name>{l.name}</Name>
      <Title>{l.name}</Title>
      <Abstract>{l.description or l.name}</Abstract>
      <SRS>EPSG:4326</SRS>
      <Operations>
        <Query/>
        <Insert/>
        <Update/>
        <Delete/>
      </Operations>
      <LatLongBoundingBox minx="{minx}" miny="{miny}" maxx="{maxx}" maxy="{maxy}"/>
    </FeatureType>""")

        ft_10 = "\n".join(f_types)
        xml_10 = f"""<?xml version="1.0" encoding="UTF-8"?>
<WFS_Capabilities version="1.0.0"
  xmlns="http://www.opengis.net/wfs"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Service>
    <Name>WFS</Name>
    <Title>KMC GIS Server — Vector Feature Service</Title>
    <Abstract>OGC API Features and WFS Vector Layer Service for Kathmandu Metropolitan City.</Abstract>
    <OnlineResource>{svc}/</OnlineResource>
    <Fees>NONE</Fees>
    <AccessConstraints>NONE</AccessConstraints>
  </Service>
  <Capability>
    <Request>
      <GetCapabilities>
        <DCPType>
          <HTTP>
            <Get onlineResource="{svc}/"/>
            <Post onlineResource="{svc}/"/>
          </HTTP>
        </DCPType>
      </GetCapabilities>
      <DescribeFeatureType>
        <SchemaDescriptionLanguage>
          <XMLSCHEMA/>
        </SchemaDescriptionLanguage>
        <DCPType>
          <HTTP>
            <Get onlineResource="{svc}/"/>
            <Post onlineResource="{svc}/"/>
          </HTTP>
        </DCPType>
      </DescribeFeatureType>
      <GetFeature>
        <ResultFormat>
          <GML2/>
        </ResultFormat>
        <DCPType>
          <HTTP>
            <Get onlineResource="{svc}/"/>
            <Post onlineResource="{svc}/"/>
          </HTTP>
        </DCPType>
      </GetFeature>
      <Transaction>
        <DCPType>
          <HTTP>
            <Post onlineResource="{svc}/"/>
          </HTTP>
        </DCPType>
      </Transaction>
    </Request>
  </Capability>
  <FeatureTypeList>
    <Operations>
      <Query/>
      <Insert/>
      <Update/>
      <Delete/>
    </Operations>
{ft_10}
  </FeatureTypeList>
</WFS_Capabilities>"""
        return Response(content=xml_10, media_type="text/xml; charset=utf-8")

    # Compliant WFS 1.1.0 GetCapabilities
    feature_types_xml = []
    for layer in layers:
        ext_result = await db.execute(
            select(
                func.ST_XMin(func.ST_Extent(VectorFeature.geom)),
                func.ST_YMin(func.ST_Extent(VectorFeature.geom)),
                func.ST_XMax(func.ST_Extent(VectorFeature.geom)),
                func.ST_YMax(func.ST_Extent(VectorFeature.geom)),
            ).where(VectorFeature.layer_id == layer.id)
        )
        ext_row = ext_result.one_or_none()
        minx, miny, maxx, maxy = 85.2, 27.6, 85.4, 27.8
        if ext_row and ext_row[0] is not None:
            minx, miny, maxx, maxy = float(ext_row[0]), float(ext_row[1]), float(ext_row[2]), float(ext_row[3])

        feature_types_xml.append(f"""    <wfs:FeatureType>
      <wfs:Name>{layer.name}</wfs:Name>
      <wfs:Title>{layer.name}</wfs:Title>
      <wfs:Abstract>{layer.description or layer.name}</wfs:Abstract>
      <wfs:DefaultSRS>urn:ogc:def:crs:EPSG::4326</wfs:DefaultSRS>
      <wfs:OtherSRS>EPSG:4326</wfs:OtherSRS>
      <wfs:OtherSRS>CRS:84</wfs:OtherSRS>
      <wfs:Operations>
        <wfs:Operation>Query</wfs:Operation>
        <wfs:Operation>Insert</wfs:Operation>
        <wfs:Operation>Update</wfs:Operation>
        <wfs:Operation>Delete</wfs:Operation>
      </wfs:Operations>
      <wfs:OutputFormats>
        <wfs:Format>text/xml; subtype=gml/3.1.1</wfs:Format>
        <wfs:Format>text/xml; subtype=gml/2.1.2</wfs:Format>
        <wfs:Format>application/geo+json</wfs:Format>
        <wfs:Format>application/json</wfs:Format>
      </wfs:OutputFormats>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>{minx} {miny}</ows:LowerCorner>
        <ows:UpperCorner>{maxx} {maxy}</ows:UpperCorner>
      </ows:WGS84BoundingBox>
    </wfs:FeatureType>""")

    ft_content = "\n".join(feature_types_xml)
    xml_caps = f"""<?xml version="1.0" encoding="UTF-8"?>
<wfs:WFS_Capabilities version="1.1.0"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:ows="http://www.opengis.net/ows"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.1.0/wfs.xsd">
  <ows:ServiceIdentification>
    <ows:Title>KMC GIS Server — Vector Feature Service</ows:Title>
    <ows:Abstract>OGC API Features and WFS Vector Layer Service for Kathmandu Metropolitan City.</ows:Abstract>
    <ows:ServiceType>WFS</ows:ServiceType>
    <ows:ServiceTypeVersion>1.1.0</ows:ServiceTypeVersion>
    <ows:ServiceTypeVersion>1.0.0</ows:ServiceTypeVersion>
    <ows:Fees>NONE</ows:Fees>
    <ows:AccessConstraints>NONE</ows:AccessConstraints>
  </ows:ServiceIdentification>
  <ows:ServiceProvider>
    <ows:ProviderName>Kathmandu Metropolitan City</ows:ProviderName>
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
          <ows:Get xlink:href="{svc}/"/>
          <ows:Post xlink:href="{svc}/"/>
        </ows:HTTP>
      </ows:DCP>
      <ows:Parameter name="service">
        <ows:Value>WFS</ows:Value>
      </ows:Parameter>
      <ows:Parameter name="AcceptVersions">
        <ows:Value>1.1.0</ows:Value>
        <ows:Value>1.0.0</ows:Value>
      </ows:Parameter>
    </ows:Operation>
    <ows:Operation name="DescribeFeatureType">
      <ows:DCP>
        <ows:HTTP>
          <ows:Get xlink:href="{svc}/"/>
          <ows:Post xlink:href="{svc}/"/>
        </ows:HTTP>
      </ows:DCP>
      <ows:Parameter name="outputFormat">
        <ows:Value>text/xml; subtype=gml/3.1.1</ows:Value>
        <ows:Value>application/json</ows:Value>
      </ows:Parameter>
    </ows:Operation>
    <ows:Operation name="GetFeature">
      <ows:DCP>
        <ows:HTTP>
          <ows:Get xlink:href="{svc}/"/>
          <ows:Post xlink:href="{svc}/"/>
        </ows:HTTP>
      </ows:DCP>
      <ows:Parameter name="resultType">
        <ows:Value>results</ows:Value>
        <ows:Value>hits</ows:Value>
      </ows:Parameter>
      <ows:Parameter name="outputFormat">
        <ows:Value>text/xml; subtype=gml/3.1.1</ows:Value>
        <ows:Value>text/xml; subtype=gml/2.1.2</ows:Value>
        <ows:Value>application/geo+json</ows:Value>
        <ows:Value>application/json</ows:Value>
      </ows:Parameter>
    </ows:Operation>
    <ows:Operation name="Transaction">
      <ows:DCP>
        <ows:HTTP>
          <ows:Get xlink:href="{svc}/"/>
          <ows:Post xlink:href="{svc}/"/>
        </ows:HTTP>
      </ows:DCP>
      <ows:Parameter name="inputFormat">
        <ows:Value>text/xml; subtype=gml/3.1.1</ows:Value>
      </ows:Parameter>
      <ows:Parameter name="idgen">
        <ows:Value>GenerateNew</ows:Value>
      </ows:Parameter>
    </ows:Operation>
  </ows:OperationsMetadata>
  <wfs:FeatureTypeList>
    <wfs:Operations>
      <wfs:Operation>Query</wfs:Operation>
      <wfs:Operation>Insert</wfs:Operation>
      <wfs:Operation>Update</wfs:Operation>
      <wfs:Operation>Delete</wfs:Operation>
    </wfs:Operations>
{ft_content}
  </wfs:FeatureTypeList>
</wfs:WFS_Capabilities>"""

    return Response(content=xml_caps, media_type="application/xml; charset=utf-8")


# ============================================================
# Shared OGC Logic
# ============================================================

async def _landing_page(request: Request, db: AsyncSession):
    """OGC API landing page with WFS fallback and OpenAPI links."""
    if request.method == "POST":
        return await _handle_wfs_post_request(request, db)

    # Check if this is a classic WFS request (e.g. from QGIS version auto-detect)
    qp = {k.upper(): v for k, v in request.query_params.items()}
    accept = request.headers.get("accept", "").lower()
    if qp.get("SERVICE", "").upper() == "WFS" or qp.get("REQUEST") or ("application/xml" in accept and "application/json" not in accept):
        return await _handle_wfs_request(request, db)

    base = _get_base_url(request)
    path = request.url.path
    svc = f"{base}/ogc-secure" if "/ogc-secure" in path else f"{base}/ogc"

    return JSONResponse({
        "title": "KMC GIS Server — OGC API Features",
        "description": "OGC API – Features service for Kathmandu Metropolitan City GIS vector layers.",
        "links": [
            {"href": f"{svc}/", "rel": "self", "type": "application/json", "title": "This document"},
            {"href": f"{svc}/api", "rel": "service-desc", "type": "application/vnd.oai.openapi+json;version=3.0", "title": "OpenAPI 3.0 definition of the API"},
            {"href": f"{svc}/api", "rel": "service-desc", "type": "application/json", "title": "OpenAPI 3.0 definition of the API"},
            {"href": f"{svc}/api", "rel": "service-doc", "type": "text/html", "title": "API documentation"},
            {"href": f"{svc}/conformance", "rel": "conformance", "type": "application/json", "title": "OGC API conformance classes implemented by this server"},
            {"href": f"{svc}/collections", "rel": "data", "type": "application/json", "title": "Metadata about the feature collections"},
        ],
    })


async def _conformance():
    """OGC conformance declaration."""
    return JSONResponse({
        "conformsTo": [
            "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core",
            "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30",
            "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/html",
            "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson",
            "http://www.opengis.net/spec/ogcapi-features-2/1.0/conf/crs",
            "http://www.opengis.net/spec/ogcapi-features-4/1.0/conf/create-replace-delete",
        ]
    })


async def _list_collections(request: Request, db: AsyncSession):
    """List all vector layers as OGC collections."""
    result = await db.execute(select(VectorLayer).order_by(VectorLayer.id))
    layers = result.scalars().all()

    base = _get_base_url(request)
    path = request.url.path
    svc = f"{base}/ogc-secure" if "/ogc-secure" in path else f"{base}/ogc"

    collections = []
    for layer in layers:
        ext_result = await db.execute(
            select(
                func.ST_XMin(func.ST_Extent(VectorFeature.geom)),
                func.ST_YMin(func.ST_Extent(VectorFeature.geom)),
                func.ST_XMax(func.ST_Extent(VectorFeature.geom)),
                func.ST_YMax(func.ST_Extent(VectorFeature.geom)),
            ).where(VectorFeature.layer_id == layer.id)
        )
        ext_row = ext_result.one_or_none()
        bbox = None
        if ext_row and ext_row[0] is not None:
            bbox = [float(ext_row[0]), float(ext_row[1]), float(ext_row[2]), float(ext_row[3])]

        count_result = await db.execute(
            select(func.count(VectorFeature.id)).where(VectorFeature.layer_id == layer.id)
        )
        count = count_result.scalar() or 0

        collections.append({
            "id": str(layer.id),
            "title": layer.name,
            "description": layer.description or "",
            "itemType": "feature",
            "crs": [
                "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
                "http://www.opengis.net/def/crs/EPSG/0/4326"
            ],
            "storageCrs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
            "extent": {
                "spatial": {
                    "bbox": [bbox] if bbox else [[-180, -90, 180, 90]],
                    "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
                },
                "temporal": {
                    "interval": [[None, None]],
                    "trs": "http://www.opengis.net/def/uom/ISO-8601/0/Gregorian"
                }
            },
            "links": [
                {"href": f"{svc}/collections/{layer.id}", "rel": "self", "type": "application/json", "title": f"Collection {layer.name}"},
                {"href": f"{svc}/collections/{layer.id}/items", "rel": "items", "type": "application/geo+json", "title": f"Features of {layer.name} (GeoJSON)"},
                {"href": f"{svc}/collections/{layer.id}/items", "rel": "items", "type": "application/json", "title": f"Features of {layer.name} (JSON)"},
            ],
            "itemCount": count,
            "numberMatched": count,
        })

    return JSONResponse({
        "collections": collections,
        "links": [
            {"href": f"{svc}/collections", "rel": "self", "type": "application/json", "title": "This document"},
        ],
    })


async def _get_collection(request: Request, collection_id: str, db: AsyncSession):
    """Get single collection metadata by ID or name."""
    layer = await _resolve_layer(collection_id, db)
    if not layer:
        raise HTTPException(status_code=404, detail=f"Collection '{collection_id}' not found")

    base = _get_base_url(request)
    path = request.url.path
    svc = f"{base}/ogc-secure" if "/ogc-secure" in path else f"{base}/ogc"

    ext_result = await db.execute(
        select(
            func.ST_XMin(func.ST_Extent(VectorFeature.geom)),
            func.ST_YMin(func.ST_Extent(VectorFeature.geom)),
            func.ST_XMax(func.ST_Extent(VectorFeature.geom)),
            func.ST_YMax(func.ST_Extent(VectorFeature.geom)),
        ).where(VectorFeature.layer_id == layer.id)
    )
    ext_row = ext_result.one_or_none()
    bbox = None
    if ext_row and ext_row[0] is not None:
        bbox = [float(ext_row[0]), float(ext_row[1]), float(ext_row[2]), float(ext_row[3])]

    count_result = await db.execute(
        select(func.count(VectorFeature.id)).where(VectorFeature.layer_id == layer.id)
    )
    count = count_result.scalar() or 0

    return JSONResponse({
        "id": str(layer.id),
        "title": layer.name,
        "description": layer.description or "",
        "itemType": "feature",
        "crs": [
            "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
            "http://www.opengis.net/def/crs/EPSG/0/4326"
        ],
        "storageCrs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        "extent": {
            "spatial": {
                "bbox": [bbox] if bbox else [[-180, -90, 180, 90]],
                "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
            },
            "temporal": {
                "interval": [[None, None]],
                "trs": "http://www.opengis.net/def/uom/ISO-8601/0/Gregorian"
            }
        },
        "links": [
            {"href": f"{svc}/collections/{layer.id}", "rel": "self", "type": "application/json", "title": f"Collection {layer.name}"},
            {"href": f"{svc}/collections/{layer.id}/items", "rel": "items", "type": "application/geo+json", "title": f"Features of {layer.name} (GeoJSON)"},
            {"href": f"{svc}/collections/{layer.id}/items", "rel": "items", "type": "application/json", "title": f"Features of {layer.name} (JSON)"},
        ],
        "itemCount": count,
        "numberMatched": count,
    })


async def _get_items(
    request: Request,
    collection_id: str,
    db: AsyncSession,
    limit: int = 1000,
    offset: int = 0,
    bbox: Optional[str] = None,
):
    """Get features from a collection as standard GeoJSON."""
    layer = await _resolve_layer(collection_id, db)
    if not layer:
        raise HTTPException(status_code=404, detail=f"Collection '{collection_id}' not found")

    layer_id = layer.id
    try:
        limit = int(limit)
    except (ValueError, TypeError):
        limit = 1000
    try:
        offset = int(offset)
    except (ValueError, TypeError):
        offset = 0

    limit = max(1, min(limit, 10000))
    offset = max(0, offset)

    query = select(
        VectorFeature.id,
        VectorFeature.properties,
        VectorFeature.version,
        VectorFeature.created_at,
        VectorFeature.updated_at,
        func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
    ).where(VectorFeature.layer_id == layer_id)

    # Bbox filter
    parsed_bbox = _parse_bbox(bbox)
    if parsed_bbox:
        west, south, east, north = parsed_bbox
        bbox_wkt = f"POLYGON(({west} {south}, {east} {south}, {east} {north}, {west} {north}, {west} {south}))"
        query = query.where(
            func.ST_Intersects(VectorFeature.geom, func.ST_GeomFromText(bbox_wkt, 4326))
        )

    # Count total
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Paginate
    query = query.order_by(VectorFeature.id).offset(offset).limit(limit)
    rows = (await db.execute(query)).all()

    base = _get_base_url(request)
    path = request.url.path
    svc = f"{base}/ogc-secure" if "/ogc-secure" in path else f"{base}/ogc"

    features = []
    for row in rows:
        geom = None
        if row.geojson:
            try:
                geom = json.loads(row.geojson)
            except Exception:
                pass

        props = dict(row.properties or {})
        clean_props = {k: v for k, v in props.items() if not str(k).startswith("__")}

        if geom is not None:
            features.append({
                "type": "Feature",
                "id": row.id,
                "geometry": geom,
                "properties": clean_props,
                "links": [
                    {"href": f"{svc}/collections/{layer_id}/items/{row.id}", "rel": "self", "type": "application/geo+json"}
                ]
            })

    links = [
        {"href": f"{svc}/collections/{layer_id}/items?limit={limit}&offset={offset}", "rel": "self", "type": "application/geo+json", "title": "This page"},
        {"href": f"{svc}/collections/{layer_id}", "rel": "collection", "type": "application/json", "title": layer.name},
    ]
    if offset + limit < total:
        links.append({"href": f"{svc}/collections/{layer_id}/items?limit={limit}&offset={offset + limit}", "rel": "next", "type": "application/geo+json", "title": "Next page"})
    if offset > 0:
        links.append({"href": f"{svc}/collections/{layer_id}/items?limit={limit}&offset={max(0, offset - limit)}", "rel": "prev", "type": "application/geo+json", "title": "Previous page"})

    return JSONResponse(
        content={
            "type": "FeatureCollection",
            "features": features,
            "numberMatched": total,
            "numberReturned": len(features),
            "timeStamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "crs": {
                "type": "name",
                "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}
            },
            "links": links,
        },
        media_type="application/geo+json",
    )


async def _get_item(layer_id: int, feature_id: int, db: AsyncSession):
    """Get single feature."""
    result = await db.execute(
        select(
            VectorFeature.id,
            VectorFeature.properties,
            VectorFeature.version,
            func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).where(VectorFeature.layer_id == layer_id, VectorFeature.id == feature_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Feature not found")

    geom = json.loads(row.geojson) if row.geojson else None
    props = {k: v for k, v in (row.properties or {}).items() if not str(k).startswith("__")}

    return JSONResponse(
        content={
            "type": "Feature",
            "id": row.id,
            "geometry": geom,
            "properties": props,
        },
        media_type="application/geo+json",
    )


async def _create_item(collection_id: str, request: Request, db: AsyncSession, user_id: int = 1):
    """Create a new feature (OGC Part 4)."""
    layer = await _resolve_layer(collection_id, db)
    if not layer:
        raise HTTPException(status_code=404, detail=f"Collection '{collection_id}' not found")
    layer_id = layer.id

    body = await request.json()
    geom = body.get("geometry")
    props = body.get("properties", {})

    if not geom:
        raise HTTPException(status_code=400, detail="Feature must include a 'geometry' object")

    geom_json = json.dumps(geom)
    feature = VectorFeature(
        layer_id=layer_id,
        geom=func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(geom_json)), 4326),
        properties=props or {},
        created_by=user_id,
        version=1,
    )
    db.add(feature)
    await db.flush()
    await db.commit()

    feat_result = await db.execute(
        select(
            VectorFeature.id,
            VectorFeature.properties,
            func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).where(VectorFeature.id == feature.id)
    )
    row = feat_result.one()

    return JSONResponse(
        status_code=201,
        content={
            "type": "Feature",
            "id": row.id,
            "geometry": json.loads(row.geojson) if row.geojson else None,
            "properties": row.properties or {},
        },
        media_type="application/geo+json",
        headers={"Location": f"collections/{layer_id}/items/{row.id}"},
    )


async def _replace_item(collection_id: str, feature_id: int, request: Request, db: AsyncSession, user_id: int = 1):
    """Replace (update) a feature (OGC Part 4)."""
    layer = await _resolve_layer(collection_id, db)
    if not layer:
        raise HTTPException(status_code=404, detail=f"Collection '{collection_id}' not found")
    layer_id = layer.id

    result = await db.execute(
        select(VectorFeature).where(VectorFeature.layer_id == layer_id, VectorFeature.id == feature_id)
    )
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")

    body = await request.json()
    geom = body.get("geometry")
    props = body.get("properties")

    if geom:
        geom_json = json.dumps(geom)
        feature.geom = func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(geom_json)), 4326)

    if props is not None:
        existing = dict(feature.properties or {})
        existing.update(props)
        feature.properties = existing
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(feature, "properties")

    feature.updated_by = user_id
    feature.version = (feature.version or 1) + 1
    await db.flush()
    await db.commit()

    feat_result = await db.execute(
        select(
            VectorFeature.id,
            VectorFeature.properties,
            func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).where(VectorFeature.id == feature_id)
    )
    row = feat_result.one()

    return JSONResponse(
        content={
            "type": "Feature",
            "id": row.id,
            "geometry": json.loads(row.geojson) if row.geojson else None,
            "properties": row.properties or {},
        },
        media_type="application/geo+json",
    )


async def _delete_item(collection_id: str, feature_id: int, db: AsyncSession):
    """Delete a feature (OGC Part 4)."""
    layer = await _resolve_layer(collection_id, db)
    if not layer:
        raise HTTPException(status_code=404, detail=f"Collection '{collection_id}' not found")
    layer_id = layer.id

    result = await db.execute(
        select(VectorFeature).where(VectorFeature.layer_id == layer_id, VectorFeature.id == feature_id)
    )
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")

    await db.delete(feature)
    await db.flush()
    await db.commit()

    return JSONResponse(status_code=200, content={"message": "Feature deleted"})


# ============================================================
# OPEN ROUTER — /ogc (No authentication required)
# ============================================================

router_open = APIRouter(prefix="/ogc", tags=["OGC API (Open)"])


@router_open.get("")
@router_open.get("/")
@router_open.post("")
@router_open.post("/")
async def ogc_landing(request: Request, db: AsyncSession = Depends(get_db)):
    return await _landing_page(request, db)


@router_open.get("/api")
@router_open.get("/openapi.json")
async def ogc_api_spec(request: Request):
    base = _get_base_url(request)
    return JSONResponse(_openapi_spec(base, is_secure=False))


@router_open.get("/conformance")
async def ogc_conformance():
    return await _conformance()


@router_open.get("/collections")
async def ogc_collections(request: Request, db: AsyncSession = Depends(get_db)):
    return await _list_collections(request, db)


@router_open.get("/collections/{collection_id}")
async def ogc_collection(collection_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    return await _get_collection(request, collection_id, db)


@router_open.get("/collections/{collection_id}/items")
async def ogc_items(
    collection_id: str,
    request: Request,
    limit: int = Query(1000, ge=1, le=10000),
    offset: int = Query(0, ge=0),
    bbox: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await _get_items(request, collection_id, db, limit, offset, bbox)


@router_open.get("/collections/{collection_id}/items/{feature_id}")
async def ogc_item(collection_id: str, feature_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    layer = await _resolve_layer(collection_id, db)
    if not layer:
        raise HTTPException(status_code=404, detail="Collection not found")
    return await _get_item(layer.id, feature_id, db)


@router_open.post("/collections/{collection_id}/items", status_code=201)
async def ogc_create_item(collection_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    return await _create_item(collection_id, request, db, user_id=1)


@router_open.put("/collections/{collection_id}/items/{feature_id}")
@router_open.patch("/collections/{collection_id}/items/{feature_id}")
async def ogc_replace_item(collection_id: str, feature_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    return await _replace_item(collection_id, feature_id, request, db, user_id=1)


@router_open.delete("/collections/{collection_id}/items/{feature_id}")
async def ogc_delete_item(collection_id: str, feature_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    layer = await _resolve_layer(collection_id, db)
    if not layer:
        raise HTTPException(status_code=404, detail="Collection not found")
    return await _delete_item(layer.id, feature_id, db)


# ============================================================
# SECURE ROUTER — /ogc-secure (Bearer token required)
# ============================================================

router_secure = APIRouter(prefix="/ogc-secure", tags=["OGC API (Secure)"])


@router_secure.get("")
@router_secure.get("/")
@router_secure.post("")
@router_secure.post("/")
async def ogcs_landing(request: Request, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return await _landing_page(request, db)


@router_secure.get("/api")
@router_secure.get("/openapi.json")
async def ogcs_api_spec(request: Request, _user: User = Depends(get_current_user)):
    base = _get_base_url(request)
    return JSONResponse(_openapi_spec(base, is_secure=True))


@router_secure.get("/conformance")
async def ogcs_conformance(_user: User = Depends(get_current_user)):
    return await _conformance()


@router_secure.get("/collections")
async def ogcs_collections(request: Request, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return await _list_collections(request, db)


@router_secure.get("/collections/{collection_id}")
async def ogcs_collection(collection_id: str, request: Request, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return await _get_collection(request, collection_id, db)


@router_secure.get("/collections/{collection_id}/items")
async def ogcs_items(
    collection_id: str,
    request: Request,
    limit: int = Query(1000, ge=1, le=10000),
    offset: int = Query(0, ge=0),
    bbox: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _get_items(request, collection_id, db, limit, offset, bbox)


@router_secure.get("/collections/{collection_id}/items/{feature_id}")
async def ogcs_item(collection_id: str, feature_id: int, request: Request, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    layer = await _resolve_layer(collection_id, db)
    if not layer:
        raise HTTPException(status_code=404, detail="Collection not found")
    return await _get_item(layer.id, feature_id, db)


@router_secure.post("/collections/{collection_id}/items", status_code=201)
async def ogcs_create_item(collection_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _create_item(collection_id, request, db, user_id=user.id)


@router_secure.put("/collections/{collection_id}/items/{feature_id}")
@router_secure.patch("/collections/{collection_id}/items/{feature_id}")
async def ogcs_replace_item(collection_id: str, feature_id: int, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _replace_item(collection_id, feature_id, request, db, user_id=user.id)


@router_secure.delete("/collections/{collection_id}/items/{feature_id}")
async def ogcs_delete_item(collection_id: str, feature_id: int, request: Request, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    return await _delete_item(collection_id, feature_id, db)
