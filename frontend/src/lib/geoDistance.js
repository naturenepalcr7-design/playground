/**
 * Geographic Distance Utilities & Geofence Enforcement
 * KMC GIS Server
 */

export const GEOFENCE_EDIT_RADIUS_METERS = 50.0;

/**
 * Computes great-circle distance between two WGS84 points in meters (Haversine formula).
 */
export function getHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371000; // Earth radius in meters
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Ray-casting algorithm to test whether [lon, lat] is inside a polygon linear ring.
 * @param {number} lon
 * @param {number} lat
 * @param {Array<[number, number]>} ring Array of [lon, lat] pairs
 */
export function pointInPolygonRing(lon, lat, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes the minimum distance in meters from (lat, lon) to a line segment A -> B.
 */
function pointToSegmentDistanceMeters(lat, lon, aCoord, bCoord) {
  const latRad = lat * (Math.PI / 180);
  const metersPerDegreeLat = 111132.954;
  const metersPerDegreeLon = 111132.954 * Math.cos(latRad);

  const ax = (aCoord[0] - lon) * metersPerDegreeLon;
  const ay = (aCoord[1] - lat) * metersPerDegreeLat;
  const bx = (bCoord[0] - lon) * metersPerDegreeLon;
  const by = (bCoord[1] - lat) * metersPerDegreeLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(ax, ay);

  let t = -(ax * dx + ay * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(projX, projY);
}

/**
 * Calculates the shortest distance in meters between a GPS location (lat, lng) and a GeoJSON geometry.
 * Returns 0 if point is inside a Polygon or MultiPolygon.
 * Returns Infinity if coordinates or geometry are invalid.
 */
export function getDistanceToGeoJsonGeometry(lat, lng, geom) {
  if (lat == null || lng == null || !geom) return Infinity;

  // Handle Feature object passed instead of geometry
  const geometry = geom.type === 'Feature' ? geom.geometry : geom;
  if (!geometry || !geometry.type || !geometry.coordinates) return Infinity;

  const type = String(geometry.type).toUpperCase();

  if (type === 'POINT') {
    const [cLon, cLat] = geometry.coordinates;
    return getHaversineDistance(lat, lng, cLat, cLon);
  }

  if (type === 'MULTIPOINT') {
    let minD = Infinity;
    for (const [cLon, cLat] of geometry.coordinates) {
      const d = getHaversineDistance(lat, lng, cLat, cLon);
      if (d < minD) minD = d;
    }
    return minD;
  }

  if (type === 'LINESTRING') {
    const coords = geometry.coordinates;
    let minD = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const d = pointToSegmentDistanceMeters(lat, lng, coords[i], coords[i + 1]);
      if (d < minD) minD = d;
    }
    return minD;
  }

  if (type === 'MULTILINESTRING') {
    let minD = Infinity;
    for (const line of geometry.coordinates) {
      for (let i = 0; i < line.length - 1; i++) {
        const d = pointToSegmentDistanceMeters(lat, lng, line[i], line[i + 1]);
        if (d < minD) minD = d;
      }
    }
    return minD;
  }

  if (type === 'POLYGON') {
    const rings = geometry.coordinates;
    if (!rings || rings.length === 0) return Infinity;

    // 1. Check if inside outer ring and not inside any hole
    if (pointInPolygonRing(lng, lat, rings[0])) {
      let inHole = false;
      for (let i = 1; i < rings.length; i++) {
        if (pointInPolygonRing(lng, lat, rings[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return 0; // Directly inside the polygon
    }

    // 2. Outside polygon: minimum distance to all boundary segments
    let minD = Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const d = pointToSegmentDistanceMeters(lat, lng, ring[i], ring[i + 1]);
        if (d < minD) minD = d;
      }
    }
    return minD;
  }

  if (type === 'MULTIPOLYGON') {
    let minD = Infinity;
    for (const polygonRings of geometry.coordinates) {
      if (!polygonRings || polygonRings.length === 0) continue;

      if (pointInPolygonRing(lng, lat, polygonRings[0])) {
        let inHole = false;
        for (let i = 1; i < polygonRings.length; i++) {
          if (pointInPolygonRing(lng, lat, polygonRings[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return 0;
      }

      for (const ring of polygonRings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const d = pointToSegmentDistanceMeters(lat, lng, ring[i], ring[i + 1]);
          if (d < minD) minD = d;
        }
      }
    }
    return minD;
  }

  if (type === 'GEOMETRYCOLLECTION') {
    let minD = Infinity;
    for (const g of geometry.geometries || []) {
      const d = getDistanceToGeoJsonGeometry(lat, lng, g);
      if (d < minD) minD = d;
    }
    return minD;
  }

  return Infinity;
}
