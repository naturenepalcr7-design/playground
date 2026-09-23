"""
KMC-GIS-SERVER Geometry Utilities
Handles 2D/3D geometry sanitization, CRS auto-detection, and reprojection to WGS84 (EPSG:4326).
Pure coordinate manipulation prevents any Shapely ufunc/C-extension casting issues.
"""

from typing import Optional, Any, List, Dict
import pyproj

import base64

# 1x1 Transparent PNG binary constant for out-of-bounds tile queries
EMPTY_TILE_PNG = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06'
    b'\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01'
    b'\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
)

# 1x1 Transparent WebP binary constant for out-of-bounds tile queries
EMPTY_TILE_WEBP = base64.b64decode("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=")

WGS84_CRS = pyproj.CRS.from_epsg(4326)


def _get_first_coordinate(coords: Any) -> Optional[List[float]]:
    """Recursively extract the first 2D/3D coordinate pair from nested GeoJSON coordinate arrays."""
    if not coords or not isinstance(coords, (list, tuple)):
        return None
    if len(coords) >= 2 and isinstance(coords[0], (int, float)) and isinstance(coords[1], (int, float)):
        return [float(coords[0]), float(coords[1])]
    return _get_first_coordinate(coords[0])


def detect_crs_from_geojson_or_coords(geojson_data: dict) -> pyproj.CRS:
    """
    Detect source CRS from GeoJSON headers or infer from coordinate magnitude.
    Supports:
    - Explicit GeoJSON 'crs' field (e.g. EPSG:32645, EPSG:3857)
    - Nepal UTM Zone 45N (EPSG:32645)
    - Nepal UTM Zone 44N (EPSG:32644)
    - Web Mercator (EPSG:3857)
    - Default: WGS84 (EPSG:4326)
    """
    # 1. Check explicit CRS object in GeoJSON
    crs_info = geojson_data.get("crs")
    if crs_info and isinstance(crs_info, dict):
        props = crs_info.get("properties", {})
        crs_name = props.get("name", "")
        if crs_name:
            try:
                clean_name = crs_name.split("::")[-1] if "::" in crs_name else crs_name
                return pyproj.CRS.from_user_input(clean_name)
            except Exception:
                pass

    # 2. Inspect coordinate sample
    features = geojson_data.get("features", [])
    if not features and geojson_data.get("type") == "Feature":
        features = [geojson_data]

    for feat in features[:20]:
        geom = feat.get("geometry")
        if not geom or not geom.get("coordinates"):
            continue

        sample = _get_first_coordinate(geom["coordinates"])
        if sample and len(sample) >= 2:
            x, y = sample[0], sample[1]

            # Already WGS84 Geographic (-180..180, -90..90)
            if -180.0 <= x <= 180.0 and -90.0 <= y <= 90.0:
                return WGS84_CRS

            # Nepal UTM Zone 45N: Easting ~200,000-800,000, Northing ~2,800,000-3,400,000
            if 200000 <= x <= 900000 and 2800000 <= y <= 3400000:
                return pyproj.CRS.from_epsg(32645)

            # Nepal UTM Zone 44N: Easting ~100,000-600,000, Northing ~2,800,000-3,400,000 (Western Nepal)
            if 100000 <= x <= 600000 and 2800000 <= y <= 3400000:
                return pyproj.CRS.from_epsg(32644)

            # Web Mercator EPSG:3857 (X/Y magnitude up to 20,037,508)
            if abs(x) > 180 or abs(y) > 90:
                return pyproj.CRS.from_epsg(3857)

    return WGS84_CRS


def _sanitize_and_transform_coords(
    coords: Any,
    transformer: Optional[pyproj.Transformer] = None,
) -> Any:
    """
    Recursively:
    1. Strips any Z/M dimensions down to 2D [x, y]
    2. Reprojects [x, y] -> [lon, lat] using transformer if present
    """
    if not coords or not isinstance(coords, (list, tuple)):
        return coords

    # Base case: [x, y] or [x, y, z] or [x, y, z, m]
    if len(coords) >= 2 and isinstance(coords[0], (int, float)) and isinstance(coords[1], (int, float)):
        x, y = float(coords[0]), float(coords[1])
        if transformer is not None:
            try:
                x, y = transformer.transform(x, y)
            except Exception:
                pass
        return [x, y]

    # Recursive step for nested coordinate arrays
    cleaned = []
    for item in coords:
        transformed = _sanitize_and_transform_coords(item, transformer)
        if transformed is not None:
            cleaned.append(transformed)
    return cleaned


def sanitize_and_reproject_geometry(
    geom_dict: dict,
    source_crs: pyproj.CRS,
    target_crs: Optional[pyproj.CRS] = None,
) -> Optional[dict]:
    """
    Sanitize any GeoJSON geometry:
    - Strips 3D (Z) and 4D (M) coordinate values cleanly down to 2D
    - Reprojects to WGS84 (EPSG:4326) if source_crs != EPSG:4326
    - Handles GeometryCollection, Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon
    """
    if not geom_dict or not isinstance(geom_dict, dict):
        return None

    geom_type = geom_dict.get("type")
    if not geom_type:
        return None

    if target_crs is None:
        target_crs = WGS84_CRS

    transformer = None
    if source_crs != target_crs:
        try:
            transformer = pyproj.Transformer.from_crs(source_crs, target_crs, always_xy=True)
        except Exception as e:
            print(f"[Geometry] Warning: could not create transformer from {source_crs} to {target_crs}: {e}")

    # Handle GeometryCollection
    if geom_type == "GeometryCollection":
        geometries = geom_dict.get("geometries", [])
        cleaned_geoms = []
        for g in geometries:
            sanitized = sanitize_and_reproject_geometry(g, source_crs, target_crs)
            if sanitized:
                cleaned_geoms.append(sanitized)
        if not cleaned_geoms:
            return None
        return {
            "type": "GeometryCollection",
            "geometries": cleaned_geoms,
        }

    # Standard Geometry types (Point, LineString, Polygon, Multi...)
    raw_coords = geom_dict.get("coordinates")
    if raw_coords is None:
        return None

    clean_coords = _sanitize_and_transform_coords(raw_coords, transformer)
    if not clean_coords:
        return None

    return {
        "type": geom_type,
        "coordinates": clean_coords,
    }


# ============================================================
# Layer Export Utilities for GisAdmin Downloads
# ============================================================

def export_features_to_geojson(features_data: List[Dict[str, Any]], layer_name: str) -> bytes:
    """Generate RFC 7946 compliant GeoJSON FeatureCollection bytes."""
    import json
    feature_collection = {
        "type": "FeatureCollection",
        "name": layer_name,
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}
        },
        "features": features_data,
    }
    return json.dumps(feature_collection, ensure_ascii=False, indent=2).encode('utf-8')


def parse_geom_dict(geom_dict: Dict[str, Any]) -> Any:
    """Robustly parse GeoJSON geometry dictionary into a Shapely geometry."""
    import json
    import shapely
    if not geom_dict:
        return None
    try:
        return shapely.from_geojson(json.dumps(geom_dict))
    except Exception:
        try:
            from shapely.geometry import shape
            return shape(geom_dict)
        except Exception:
            return None


def export_features_to_shapefile_zip(
    features_data: List[Dict[str, Any]],
    layer_name: str,
    default_geom_type: str = "Polygon"
) -> bytes:
    """
    Export GeoJSON features list to ESRI Shapefile bundle inside a ZIP archive.
    Supports UTF-8 encoding (.cpg), WGS84 projection (.prj), and handles mixed
    geometry types by generating type-safe shapefile layers.
    """
    import os
    import re
    import io
    import tempfile
    import zipfile
    import fiona
    from fiona.crs import from_epsg
    from shapely.geometry import mapping

    safe_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', layer_name).strip('_') or "layer"

    # Group features by base geometry family: Point, LineString, Polygon
    groups = {"Point": [], "LineString": [], "Polygon": []}
    for f in features_data:
        g = f.get("geometry")
        if not g:
            continue
        g_type = str(g.get("type", ""))
        if "Point" in g_type:
            groups["Point"].append(f)
        elif "Line" in g_type:
            groups["LineString"].append(f)
        else:
            groups["Polygon"].append(f)

    # Filter active groups
    active_groups = {k: v for k, v in groups.items() if len(v) > 0}
    if not active_groups:
        # Fallback if no valid geometry found
        family = "Polygon"
        if "POINT" in (default_geom_type or "").upper():
            family = "Point"
        elif "LINE" in (default_geom_type or "").upper():
            family = "LineString"
        active_groups[family] = features_data

    # Collect property keys and normalize to 10-char DBF compliant field names
    all_raw_keys = set()
    for f in features_data:
        props = f.get("properties") or {}
        for k in props.keys():
            if k != "_id" and not k.startswith("__"):
                all_raw_keys.add(k)

    field_map = {"_id": "id"}
    used_dbf_keys = {"id"}

    for rk in sorted(all_raw_keys):
        # Allow alphanumeric and underscore for DBF field names (max 10 chars ASCII)
        clean_k = re.sub(r'[^a-zA-Z0-9_]', '_', str(rk)).strip('_')[:10]
        if not clean_k:
            clean_k = "field"
        final_k = clean_k
        counter = 1
        while final_k.lower() in {u.lower() for u in used_dbf_keys}:
            suffix = str(counter)
            final_k = f"{clean_k[:10 - len(suffix)]}{suffix}"
            counter += 1
        used_dbf_keys.add(final_k)
        field_map[rk] = final_k

    properties_schema = {dbf_k: "str" for dbf_k in used_dbf_keys}

    with tempfile.TemporaryDirectory() as tmpdir:
        for g_family, g_feats in active_groups.items():
            fname_prefix = safe_name if len(active_groups) == 1 else f"{safe_name}_{g_family.lower()}"
            shp_path = os.path.join(tmpdir, f"{fname_prefix}.shp")
            cpg_path = os.path.join(tmpdir, f"{fname_prefix}.cpg")

            # Write CPG for UTF-8 support
            with open(cpg_path, "w", encoding="utf-8") as cpg_file:
                cpg_file.write("UTF-8\n")

            fiona_geom_type = (
                "MultiPoint" if g_family == "Point"
                else ("MultiLineString" if g_family == "LineString" else "MultiPolygon")
            )

            schema = {
                "geometry": fiona_geom_type,
                "properties": properties_schema,
            }

            with fiona.open(
                shp_path,
                mode="w",
                driver="ESRI Shapefile",
                crs=from_epsg(4326),
                schema=schema,
                encoding="utf-8",
            ) as shp:
                for feat in g_feats:
                    geom_dict = feat.get("geometry")
                    if not geom_dict:
                        continue
                    try:
                        s_geom = parse_geom_dict(geom_dict)
                        if s_geom is None or s_geom.is_empty:
                            continue
                        if not s_geom.is_valid:
                            try:
                                import shapely
                                s_geom = shapely.make_valid(s_geom)
                            except Exception:
                                s_geom = s_geom.buffer(0)

                        out_mapping = mapping(s_geom)
                        geom_t = out_mapping.get("type", "")
                        if not geom_t.startswith("Multi"):
                            out_mapping = {"type": f"Multi{geom_t}", "coordinates": [out_mapping["coordinates"]]}

                        # Build DBF attributes
                        in_props = feat.get("properties") or {}
                        out_props = {}
                        for orig_k, dbf_k in field_map.items():
                            if orig_k == "_id":
                                val = feat.get("id") or in_props.get("_id") or in_props.get("id") or ""
                            else:
                                val = in_props.get(orig_k, "")
                            out_props[dbf_k] = str(val) if val is not None else ""

                        shp.write({
                            "geometry": out_mapping,
                            "properties": out_props,
                        })
                    except Exception:
                        continue

        # Package into in-memory zip
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for fname in os.listdir(tmpdir):
                full_path = os.path.join(tmpdir, fname)
                if os.path.isfile(full_path):
                    zip_file.write(full_path, arcname=fname)

        zip_buffer.seek(0)
        return zip_buffer.getvalue()


def export_features_to_kml(features_data: List[Dict[str, Any]], layer_name: str) -> bytes:
    """Generate KML 2.2 XML bytes for Google Earth."""
    import xml.sax.saxutils as saxutils

    def escape_xml(s: Any) -> str:
        return saxutils.escape(str(s) if s is not None else "")

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        '  <Document>',
        f'    <name>{escape_xml(layer_name)}</name>',
        '    <Style id="defaultStyle">',
        '      <LineStyle><color>ff0000ff</color><width>2</width></LineStyle>',
        '      <PolyStyle><color>7f00ff00</color></PolyStyle>',
        '    </Style>',
    ]

    for feat in features_data:
        feat_id = feat.get("id", "")
        geom = feat.get("geometry")
        props = feat.get("properties") or {}

        if not geom:
            continue

        s_geom = parse_geom_dict(geom)
        if s_geom is None or s_geom.is_empty:
            continue

        lines.append('    <Placemark>')
        lines.append(f'      <name>Feature #{escape_xml(feat_id)}</name>')
        lines.append('      <styleUrl>#defaultStyle</styleUrl>')
        lines.append('      <ExtendedData>')
        for k, v in props.items():
            if not str(k).startswith("__"):
                lines.append(f'        <Data name="{escape_xml(k)}"><value>{escape_xml(v)}</value></Data>')
        lines.append('      </ExtendedData>')

        try:
            geom_type = geom.get("type", "")
            coords = geom.get("coordinates")
            if "Point" in geom_type:
                pt_coords = s_geom.centroid
                lines.append(f'      <Point><coordinates>{pt_coords.x},{pt_coords.y},0</coordinates></Point>')
            elif "Line" in geom_type and coords:
                if geom_type == "LineString":
                    coord_str = " ".join(f"{c[0]},{c[1]},0" for c in coords if len(c) >= 2)
                    lines.append(f'      <LineString><coordinates>{coord_str}</coordinates></LineString>')
                else:
                    lines.append('      <MultiGeometry>')
                    for line_c in coords:
                        coord_str = " ".join(f"{c[0]},{c[1]},0" for c in line_c if len(c) >= 2)
                        lines.append(f'        <LineString><coordinates>{coord_str}</coordinates></LineString>')
                    lines.append('      </MultiGeometry>')
            elif "Polygon" in geom_type and coords:
                if geom_type == "Polygon" and len(coords) > 0:
                    lines.append('      <Polygon>')
                    lines.append('        <outerBoundaryIs><LinearRing><coordinates>')
                    coord_str = " ".join(f"{c[0]},{c[1]},0" for c in coords[0] if len(c) >= 2)
                    lines.append(f'          {coord_str}')
                    lines.append('        </coordinates></LinearRing></outerBoundaryIs>')
                    lines.append('      </Polygon>')
                else:
                    lines.append('      <MultiGeometry>')
                    for poly_c in coords:
                        if poly_c and len(poly_c) > 0:
                            lines.append('        <Polygon>')
                            lines.append('          <outerBoundaryIs><LinearRing><coordinates>')
                            coord_str = " ".join(f"{c[0]},{c[1]},0" for c in poly_c[0] if len(c) >= 2)
                            lines.append(f'            {coord_str}')
                            lines.append('          </coordinates></LinearRing></outerBoundaryIs>')
                            lines.append('        </Polygon>')
                    lines.append('      </MultiGeometry>')
        except Exception:
            pass

        lines.append('    </Placemark>')

    lines.append('  </Document>')
    lines.append('</kml>')

    return "\n".join(lines).encode('utf-8')


def export_features_to_csv(features_data: List[Dict[str, Any]], layer_name: str) -> bytes:
    """Generate UTF-8 CSV bytes (with BOM) with properties and WKT geometry."""
    import csv
    import io

    all_keys = set()
    for f in features_data:
        props = f.get("properties") or {}
        for k in props.keys():
            if k != "_id" and not str(k).startswith("__"):
                all_keys.add(k)

    header = ["_id", "wkt_geometry"] + sorted(all_keys)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(header)

    for feat in features_data:
        feat_id = feat.get("id", "")
        geom = feat.get("geometry")
        props = feat.get("properties") or {}

        wkt_str = ""
        if geom:
            try:
                s_geom = parse_geom_dict(geom)
                if s_geom:
                    wkt_str = s_geom.wkt
            except Exception:
                wkt_str = ""

        row = [feat_id, wkt_str]
        for k in sorted(all_keys):
            row.append(props.get(k, ""))
        writer.writerow(row)

    # UTF-8 with BOM (\ufeff) for Excel compatibility with Nepali Unicode text
    return ("\ufeff" + output.getvalue()).encode('utf-8')


