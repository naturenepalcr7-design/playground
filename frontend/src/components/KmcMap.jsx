'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Navigation, Crosshair, ZoomIn, ZoomOut, Maximize, X, Users, MapPin, ChevronLeft, ChevronRight, Compass } from 'lucide-react';
import { getDistanceToGeoJsonGeometry, GEOFENCE_EDIT_RADIUS_METERS } from '../lib/geoDistance';
import { getCollectorColor, extractFeatureCollector } from '../lib/collectorPalette';

/**
 * Helper to validate bounding extent array [minX, minY, maxX, maxY]
 */
function isValidExtent(extent) {
  return (
    Array.isArray(extent) &&
    extent.length === 4 &&
    extent.every((val) => typeof val === 'number' && isFinite(val) && !isNaN(val)) &&
    extent[0] <= extent[2] &&
    extent[1] <= extent[3]
  );
}

/**
 * Helper to strictly validate and extract only real OpenLayers features with valid geometries
 */
function isValidOlFeature(f) {
  try {
    if (!f || typeof f.getGeometry !== 'function') return false;
    const geom = f.getGeometry();
    if (!geom || typeof geom.getExtent !== 'function') return false;
    const extent = geom.getExtent();
    if (!isValidExtent(extent)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function getValidOlFeatures(features) {
  if (!Array.isArray(features)) return [];
  const valid = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (isValidOlFeature(f)) {
      valid.push(f);
    }
  }
  return valid;
}

/**
 * Extracts clean, valid 2D coordinates from any OpenLayers geometry type
 */
function extractCoordinatesFromGeometry(geom) {
  if (!geom) return [];
  const geomType = geom.getType();
  let coords = [];
  if (geomType === 'Point') {
    coords = [geom.getCoordinates()];
  } else if (geomType === 'LineString' || geomType === 'MultiPoint') {
    coords = geom.getCoordinates();
  } else if (geomType === 'Polygon' || geomType === 'MultiLineString') {
    const rings = geom.getCoordinates();
    if (Array.isArray(rings)) {
      rings.forEach((r) => {
        if (Array.isArray(r)) coords = coords.concat(r);
      });
    }
  } else if (geomType === 'MultiPolygon') {
    const polyList = geom.getCoordinates();
    if (Array.isArray(polyList)) {
      polyList.forEach((poly) => {
        if (Array.isArray(poly)) {
          poly.forEach((r) => {
            if (Array.isArray(r)) coords = coords.concat(r);
          });
        }
      });
    }
  }
  return coords.filter((c) => c && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]));
}

/**
 * Computes the minimum squared distance from point p to line segment (v, w).
 */
function distanceToSegmentSquared(p, v, w) {
  const l2 = (w[0] - v[0]) ** 2 + (w[1] - v[1]) ** 2;
  if (l2 === 0) return (p[0] - v[0]) ** 2 + (p[1] - v[1]) ** 2;
  const t = Math.max(0, Math.min(1, ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2));
  const projectionX = v[0] + t * (w[0] - v[0]);
  const projectionY = v[1] + t * (w[1] - v[1]);
  return (p[0] - projectionX) ** 2 + (p[1] - projectionY) ** 2;
}

/**
 * Checks if a 2D coordinate is within a tolerance distance of any boundary segment of a Polygon / MultiPolygon.
 */
function isPointNearPolygonBoundary(geom, coordinate, toleranceMapUnits = 20) {
  if (!geom || !coordinate) return false;
  const geomType = geom.getType();
  const tolSq = toleranceMapUnits * toleranceMapUnits;

  let ringsList = [];
  if (geomType === 'Polygon') {
    ringsList = geom.getCoordinates(); // array of linear rings
  } else if (geomType === 'MultiPolygon') {
    const polyList = geom.getCoordinates(); // array of polygons
    if (Array.isArray(polyList)) {
      polyList.forEach((poly) => {
        if (Array.isArray(poly)) {
          poly.forEach((r) => {
            if (Array.isArray(r)) ringsList.push(r);
          });
        }
      });
    }
  } else {
    // For non-polygon geometries (Point, LineString), any hit is already on the geometry
    return true;
  }

  for (let r = 0; r < ringsList.length; r++) {
    const ring = ringsList[r];
    if (!Array.isArray(ring) || ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i++) {
      const p1 = ring[i];
      const p2 = ring[i + 1];
      if (distanceToSegmentSquared(coordinate, p1, p2) <= tolSq) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Finds the index of the vertex in olFeature geometry closest to clickCoord within tolerance.
 * Returns { index: number, coordinate: [x, y] } or null if none within tolerance.
 */
function findVertexIndexNearCoord(olFeature, clickCoord, toleranceMapUnits = 20) {
  if (!olFeature || !clickCoord) return null;
  const geom = olFeature.getGeometry();
  if (!geom) return null;
  const coords = extractCoordinatesFromGeometry(geom);
  if (!coords || coords.length === 0) return null;

  let bestIdx = -1;
  let minD = toleranceMapUnits;
  for (let i = 0; i < coords.length; i++) {
    const d = Math.hypot(coords[i][0] - clickCoord[0], coords[i][1] - clickCoord[1]);
    if (d < minD) {
      minD = d;
      bestIdx = i;
    }
  }

  if (bestIdx !== -1) {
    return { index: bestIdx, coordinate: coords[bestIdx] };
  }
  return null;
}

/**
 * Inserts targetCoord into geometry right adjacent to the selectedVertexIndex,
 * and returns the new global index of the inserted vertex.
 */
function insertCoordinateAtVertex(geom, targetCoord, selectedVertexIndex = null) {
  if (!geom || !targetCoord) return 0;
  const geomType = geom.getType();

  if (geomType === 'LineString') {
    const coords = geom.getCoordinates().slice();
    if (coords.length === 0) {
      coords.push(targetCoord);
      geom.setCoordinates(coords);
      return 0;
    }

    if (selectedVertexIndex === null || selectedVertexIndex === undefined || selectedVertexIndex >= coords.length - 1) {
      // Default / End point selected: append to the end of the line
      coords.push(targetCoord);
      geom.setCoordinates(coords);
      return coords.length - 1;
    } else if (selectedVertexIndex === 0) {
      // Start point selected: prepend outward from the start
      coords.unshift(targetCoord);
      geom.setCoordinates(coords);
      return 0;
    } else {
      // Intermediate vertex selected: insert right after selected vertex
      const insertIdx = selectedVertexIndex + 1;
      coords.splice(insertIdx, 0, targetCoord);
      geom.setCoordinates(coords);
      return insertIdx;
    }
  } else if (geomType === 'MultiLineString') {
    const lines = geom.getCoordinates().slice();
    if (lines.length === 0 || !Array.isArray(lines[0])) {
      geom.setCoordinates([[targetCoord]]);
      return 0;
    }

    let targetLineIdx = lines.length - 1;
    let localIdx = selectedVertexIndex;
    let accumulated = 0;

    if (selectedVertexIndex !== null && selectedVertexIndex !== undefined) {
      for (let l = 0; l < lines.length; l++) {
        const count = lines[l].length;
        if (selectedVertexIndex < accumulated + count) {
          targetLineIdx = l;
          localIdx = selectedVertexIndex - accumulated;
          break;
        }
        accumulated += count;
      }
    }

    const currentLine = lines[targetLineIdx].slice();
    let newLocalIdx = 0;

    if (localIdx === null || localIdx === undefined || localIdx >= currentLine.length - 1) {
      currentLine.push(targetCoord);
      newLocalIdx = currentLine.length - 1;
    } else if (localIdx === 0) {
      currentLine.unshift(targetCoord);
      newLocalIdx = 0;
    } else {
      newLocalIdx = localIdx + 1;
      currentLine.splice(newLocalIdx, 0, targetCoord);
    }

    lines[targetLineIdx] = currentLine;
    geom.setCoordinates(lines);
    return accumulated + newLocalIdx;
  } else if (geomType === 'Polygon') {
    const rings = geom.getCoordinates().slice();
    if (rings.length === 0 || !Array.isArray(rings[0])) {
      rings[0] = [targetCoord, targetCoord, targetCoord, targetCoord];
      geom.setCoordinates(rings);
      return 0;
    }

    const outerRing = rings[0].slice();
    let insertIdx;
    if (selectedVertexIndex === null || selectedVertexIndex === undefined || selectedVertexIndex >= outerRing.length - 1) {
      insertIdx = Math.max(1, outerRing.length - 1);
    } else {
      insertIdx = selectedVertexIndex + 1;
    }

    outerRing.splice(insertIdx, 0, targetCoord);
    // Ensure polygon closure
    if (outerRing.length >= 3) {
      outerRing[outerRing.length - 1] = outerRing[0];
    }
    rings[0] = outerRing;
    geom.setCoordinates(rings);
    return insertIdx;
  } else if (geomType === 'MultiPolygon') {
    const polys = geom.getCoordinates().slice();
    if (polys.length === 0 || !Array.isArray(polys[0]) || polys[0].length === 0) {
      geom.setCoordinates([[[targetCoord, targetCoord, targetCoord, targetCoord]]]);
      return 0;
    }

    const poly0 = polys[0].slice();
    const outerRing = (poly0[0] || []).slice();
    let insertIdx;
    if (selectedVertexIndex === null || selectedVertexIndex === undefined || selectedVertexIndex >= outerRing.length - 1) {
      insertIdx = Math.max(1, outerRing.length - 1);
    } else {
      insertIdx = selectedVertexIndex + 1;
    }

    outerRing.splice(insertIdx, 0, targetCoord);
    if (outerRing.length >= 3) {
      outerRing[outerRing.length - 1] = outerRing[0];
    }
    poly0[0] = outerRing;
    polys[0] = poly0;
    geom.setCoordinates(polys);
    return insertIdx;
  } else if (geomType === 'Point') {
    geom.setCoordinates(targetCoord);
    return 0;
  } else if (geomType === 'MultiPoint') {
    const pts = geom.getCoordinates().slice();
    pts.push(targetCoord);
    geom.setCoordinates(pts);
    return pts.length - 1;
  }
  return 0;
}

/**
 * Renders vertex markers for the selected feature into snappingVerticesSource,
 * with the currently selected active vertex highlighted in RED.
 */
function renderSelectedFeatureVertices(olFeature, source, PointClass, FeatureClass, StyleClass, CircleStyleClass, FillClass, StrokeClass, selectedVertexIndex = null) {
  if (!source) return;
  source.clear();
  if (!olFeature || !PointClass || !FeatureClass || !StyleClass || !CircleStyleClass || !FillClass || !StrokeClass) return;
  const geom = olFeature.getGeometry();
  if (!geom) return;
  const coords = extractCoordinatesFromGeometry(geom);
  if (!coords || coords.length === 0) return;

  const vertexFeatures = coords.map((c, idx) => {
    const isSelected = (selectedVertexIndex !== null && selectedVertexIndex !== undefined && idx === selectedVertexIndex);
    const feat = new FeatureClass({
      geometry: new PointClass(c),
      vertexIndex: idx,
      isSelected,
    });

    if (isSelected) {
      // Selected active vertex: Vibrant RED (#dc2626) with pulsing red halo ring
      feat.setStyle([
        // Outer glowing red halo
        new StyleClass({
          image: new CircleStyleClass({
            radius: 12,
            stroke: new StrokeClass({ color: '#ef4444', width: 3 }),
            fill: new FillClass({ color: 'rgba(239, 68, 68, 0.35)' }),
          }),
        }),
        // Inner sharp red core with white border
        new StyleClass({
          image: new CircleStyleClass({
            radius: 6.5,
            fill: new FillClass({ color: '#dc2626' }),
            stroke: new StrokeClass({ color: '#ffffff', width: 2.5 }),
          }),
        }),
      ]);
    } else {
      // Regular vertex: Clean Cyan (#0284c7) with halo
      feat.setStyle([
        new StyleClass({
          image: new CircleStyleClass({
            radius: 8.5,
            stroke: new StrokeClass({ color: '#0284c7', width: 1.5 }),
            fill: new FillClass({ color: 'rgba(2, 132, 199, 0.2)' }),
          }),
        }),
        new StyleClass({
          image: new CircleStyleClass({
            radius: 4.5,
            fill: new FillClass({ color: '#0284c7' }),
            stroke: new StrokeClass({ color: '#ffffff', width: 1.5 }),
          }),
        }),
      ]);
    }
    return feat;
  });

  source.addFeatures(vertexFeatures);
}

/**
 * Extends or appends a coordinate to any OpenLayers geometry type
 */
function extendGeometryToCoordinate(geom, targetCoord) {
  if (!geom || !targetCoord) return;
  const geomType = geom.getType();

  if (geomType === 'LineString') {
    const coords = geom.getCoordinates().slice();
    if (coords.length === 0) {
      coords.push(targetCoord);
    } else {
      const dStart = Math.hypot(targetCoord[0] - coords[0][0], targetCoord[1] - coords[0][1]);
      const dEnd = Math.hypot(targetCoord[0] - coords[coords.length - 1][0], targetCoord[1] - coords[coords.length - 1][1]);
      if (dStart < dEnd) {
        coords.unshift(targetCoord);
      } else {
        coords.push(targetCoord);
      }
    }
    geom.setCoordinates(coords);
  } else if (geomType === 'MultiLineString') {
    const lines = geom.getCoordinates().slice();
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1].slice();
      lastLine.push(targetCoord);
      lines[lines.length - 1] = lastLine;
      geom.setCoordinates(lines);
    }
  } else if (geomType === 'Polygon') {
    const rings = geom.getCoordinates().slice();
    if (rings.length > 0) {
      const outerRing = rings[0].slice();
      if (outerRing.length >= 3) {
        outerRing.splice(outerRing.length - 1, 0, targetCoord);
      } else {
        outerRing.push(targetCoord);
        if (outerRing.length >= 3) {
          outerRing.push(outerRing[0]);
        }
      }
      rings[0] = outerRing;
      geom.setCoordinates(rings);
    }
  } else if (geomType === 'MultiPolygon') {
    const polys = geom.getCoordinates().slice();
    if (polys.length > 0 && polys[0].length > 0) {
      const outerRing = polys[0][0].slice();
      if (outerRing.length >= 3) {
        outerRing.splice(outerRing.length - 1, 0, targetCoord);
      } else {
        outerRing.push(targetCoord);
        if (outerRing.length >= 3) {
          outerRing.push(outerRing[0]);
        }
      }
      polys[0][0] = outerRing;
      geom.setCoordinates(polys);
    }
  } else if (geomType === 'Point') {
    geom.setCoordinates(targetCoord);
  } else if (geomType === 'MultiPoint') {
    const pts = geom.getCoordinates().slice();
    pts.push(targetCoord);
    geom.setCoordinates(pts);
  }
}

/**
 * Removes the vertex closest to targetCoord within tolerance from olFeature
 */
function removeNearestVertexFromFeature(olFeature, targetCoord, toleranceMapUnits = 50) {
  if (!olFeature || !targetCoord) return false;
  const geom = olFeature.getGeometry();
  if (!geom) return false;
  const geomType = geom.getType();

  if (geomType === 'LineString') {
    const coords = geom.getCoordinates().slice();
    if (coords.length <= 2) return false; // Minimum 2 points for a line
    let bestIdx = -1;
    let minD = toleranceMapUnits;
    for (let i = 0; i < coords.length; i++) {
      const d = Math.hypot(coords[i][0] - targetCoord[0], coords[i][1] - targetCoord[1]);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      coords.splice(bestIdx, 1);
      geom.setCoordinates(coords);
      return true;
    }
  } else if (geomType === 'MultiLineString') {
    const lines = geom.getCoordinates().slice();
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l].slice();
      if (line.length <= 2) continue;
      let bestIdx = -1;
      let minD = toleranceMapUnits;
      for (let i = 0; i < line.length; i++) {
        const d = Math.hypot(line[i][0] - targetCoord[0], line[i][1] - targetCoord[1]);
        if (d < minD) {
          minD = d;
          bestIdx = i;
        }
      }
      if (bestIdx !== -1) {
        line.splice(bestIdx, 1);
        lines[l] = line;
        geom.setCoordinates(lines);
        return true;
      }
    }
  } else if (geomType === 'Polygon') {
    const rings = geom.getCoordinates().slice();
    if (rings.length === 0) return false;
    const outerRing = rings[0].slice();
    if (outerRing.length <= 4) return false; // Minimum 3 points (+1 closing) for polygon
    let bestIdx = -1;
    let minD = toleranceMapUnits;
    for (let i = 0; i < outerRing.length - 1; i++) {
      const d = Math.hypot(outerRing[i][0] - targetCoord[0], outerRing[i][1] - targetCoord[1]);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      outerRing.splice(bestIdx, 1);
      outerRing[outerRing.length - 1] = outerRing[0]; // ensure closure
      rings[0] = outerRing;
      geom.setCoordinates(rings);
      return true;
    }
  } else if (geomType === 'MultiPolygon') {
    const polys = geom.getCoordinates().slice();
    if (polys.length === 0 || !polys[0] || polys[0].length === 0) return false;
    const outerRing = polys[0][0].slice();
    if (outerRing.length <= 4) return false;
    let bestIdx = -1;
    let minD = toleranceMapUnits;
    for (let i = 0; i < outerRing.length - 1; i++) {
      const d = Math.hypot(outerRing[i][0] - targetCoord[0], outerRing[i][1] - targetCoord[1]);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      outerRing.splice(bestIdx, 1);
      outerRing[outerRing.length - 1] = outerRing[0];
      polys[0][0] = outerRing;
      geom.setCoordinates(polys);
      return true;
    }
  }
  return false;
}

/**
 * Calculates perpendicular / minimum distance from point p to segment [v, w]
 */
function distToSegment(p, v, w) {
  const l2 = (w[0] - v[0]) * (w[0] - v[0]) + (w[1] - v[1]) * (w[1] - v[1]);
  if (l2 === 0) return Math.hypot(p[0] - v[0], p[1] - v[1]);
  let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = v[0] + t * (w[0] - v[0]);
  const projY = v[1] + t * (w[1] - v[1]);
  return Math.hypot(p[0] - projX, p[1] - projY);
}

/**
 * Continuously searches all visible vector layer sources for the closest vertex within tolerance in pixels
 */
function findNearestVertex(map, pixel, visibleSources, tolerancePx) {
  if (!map || !pixel || !Array.isArray(visibleSources) || visibleSources.length === 0) return null;
  const coord = map.getCoordinateFromPixel(pixel);
  if (!coord) return null;
  const view = map.getView();
  if (!view) return null;
  const resolution = view.getResolution();
  if (!resolution) return null;

  const mapTolerance = tolerancePx * resolution;
  const extent = [
    coord[0] - mapTolerance,
    coord[1] - mapTolerance,
    coord[0] + mapTolerance,
    coord[1] + mapTolerance,
  ];

  let nearestCoord = null;
  let minPixelDist = tolerancePx;
  let nearestFeature = null;

  visibleSources.forEach((source) => {
    if (!source || typeof source.forEachFeatureInExtent !== 'function') return;
    try {
      source.forEachFeatureInExtent(extent, (feature) => {
        const geom = feature.getGeometry();
        if (!geom) return;
        const coords = extractCoordinatesFromGeometry(geom);

        for (let i = 0; i < coords.length; i++) {
          const c = coords[i];
          if (!c || c.length < 2) continue;
          const vertexPixel = map.getPixelFromCoordinate(c);
          if (!vertexPixel) continue;
          const dist = Math.hypot(vertexPixel[0] - pixel[0], vertexPixel[1] - pixel[1]);
          if (dist <= minPixelDist) {
            minPixelDist = dist;
            nearestCoord = c;
            nearestFeature = feature;
          }
        }
      });
    } catch (e) {
      // safe fallback
    }
  });

  return nearestCoord ? { coordinate: nearestCoord, distance: minPixelDist, feature: nearestFeature } : null;
}

/**
 * KmcMap — OpenLayers Multi-Layer Map Engine
 * 
 * Features:
 * - Basemaps: OSM, Esri Satellite, Google Earth, No Basemap
 * - Multi-layer Server Raster (XYZ MBTiles from TileServer-GL)
 * - Multi-layer Server Vector (PostGIS GeoJSON datasets) with complete error isolation
 * - Zoom-to-Layer capability for any vector or raster dataset
 * - Task grid layer with status-based styling
 * - Live GPS tracking with accuracy circle
 * - Vector feature drawing (Point/Line/Polygon)
 */
export default function KmcMap({
  gpsPosition,
  taskGrids,
  serverVectors = [], // [{ id, name, visible, opacity, features, geometry_type }]
  serverRasters = [], // [{ id, name, visible, opacity, bounds }]
  activeBasemap = 'google',
  basemapOpacity = 100,
  zoomTarget = null, // { type: 'vector'|'raster', id, bounds, timestamp }
  selectedTask,
  onTaskClick,
  onFeatureCreate,
  drawMode = null, // 'Point', 'LineString', 'Polygon', null
  activeLayerId = null,
  editMode = false,
  editLayerId = null,
  selectedFeatureId = null,
  onFeatureSelect = null,
  onFeatureModifyEnd = null,
  snappingEnabled = true,
  snapTolerance = 15,
  onSnappingToggle = null,
  geometryUpdateTrigger = null, // { featureId, geometry, timestamp } for Undo/Redo/Revert
  drawUndoTrigger = null, // { action: 'undo', timestamp } for Draw Undo
  drawRedoTrigger = null, // { action: 'redo', timestamp } for Draw Redo
  onDrawVertexChange = null, // ({ undoCount, redoCount }) => void
  onFeatureInspect = null, // ({ id, layerId, layerName, geometryType, properties, geometry, extent, isWithinAssignedGrid }) => void
  inspectedFeatureId = null,
  drawnBoundary = null, // GeoJSON geometry for task grid canvas drawing preview
  isCollector = false,
  onFeatureBlocked = null, // ({ reason, message }) => void
  editSubMode = null, // null (none selected = all allowed) | 'tane' | 'bistar' | 'metne'
  outlinedTaskIds = new Set(),
  outlineAllTasks = false,
  pickLinkedFeatureMode = false,
  selectedLinkedFeatureId = null,
  selectedLinkedLayerId = null,
  onLinkedFeatureSelect = null,
  collectorLocations = [],
  showCollectorLocations = false,
  onCollectorSelect = null,
  currentUser = null,
  isAdmin = false,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [inspectedCollector, setInspectedCollector] = useState(null);
  const [inspectedCollectorCluster, setInspectedCollectorCluster] = useState([]);
  const [clusterMemberIndex, setClusterMemberIndex] = useState(0);
  const [mapRotation, setMapRotation] = useState(0);
  const layersRef = useRef({
    basemaps: {},
    taskLayer: null,
    taskSource: null,
    gpsLayer: null,
    gpsSource: null,
    collectorTrackingLayer: null,
    collectorTrackingSource: null,
    snappingVerticesLayer: null,
    snappingVerticesSource: null,
    snapIndicatorLayer: null,
    snapIndicatorSource: null,
    featureHighlightLayer: null,
    featureHighlightSource: null,
    serverRasters: {}, // { [id]: TileLayer }
    serverVectors: {}, // { [id]: { layer: VectorLayer, source: VectorSource } }
  });
  const drawInteractionRef = useRef(null);
  const sketchFeatureRef = useRef(null);
  const drawRedoStackRef = useRef([]);
  const drawUndoCountRef = useRef(0);
  const selectInteractionRef = useRef(null);
  const modifyInteractionRef = useRef(null);
  const snapInteractionsRef = useRef([]);
  const snapIndicatorSourceRef = useRef(null);
  const snappingVerticesSourceRef = useRef(null);
  const featureHighlightSourceRef = useRef(null);
  const hoveredFeatureRef = useRef(null);
  const inspectedFeatureRef = useRef(null);
  const selectedOlFeatureRef = useRef(null);
  const isModifyingRef = useRef(false);
  const modifyTimerRef = useRef(null);
  const selectedVertexIndexRef = useRef(null);

  const drawModeRef = useRef(drawMode);
  const activeLayerIdRef = useRef(activeLayerId);
  const editModeRef = useRef(editMode);
  const editLayerIdRef = useRef(editLayerId);
  const snappingEnabledRef = useRef(snappingEnabled);
  const snapToleranceRef = useRef(snapTolerance);
  const serverVectorsRef = useRef(serverVectors);
  const onFeatureInspectRef = useRef(onFeatureInspect);
  const inspectedFeatureIdRef = useRef(inspectedFeatureId);
  const isCollectorRef = useRef(isCollector);
  const onFeatureBlockedRef = useRef(onFeatureBlocked);
  const editSubModeRef = useRef(editSubMode);
  const outlinedTaskIdsRef = useRef(outlinedTaskIds);
  const outlineAllTasksRef = useRef(outlineAllTasks);
  const pickLinkedFeatureModeRef = useRef(pickLinkedFeatureMode);
  const onLinkedFeatureSelectRef = useRef(onLinkedFeatureSelect);
  const gpsPositionRef = useRef(gpsPosition);

  // Helper to check if a vector layer allows snapping (configured by Admin)
  const isLayerSnappable = useCallback((layerId) => {
    if (!layerId) return true;
    const lData = (serverVectorsRef.current || []).find((v) => String(v.id) === String(layerId));
    return lData ? (lData.allow_snapping !== false) : true;
  }, []);

  useEffect(() => {
    drawModeRef.current = drawMode;
    activeLayerIdRef.current = activeLayerId;
    editModeRef.current = editMode;
    editLayerIdRef.current = editLayerId;
    snappingEnabledRef.current = snappingEnabled;
    snapToleranceRef.current = snapTolerance;
    serverVectorsRef.current = serverVectors;
    onFeatureInspectRef.current = onFeatureInspect;
    inspectedFeatureIdRef.current = inspectedFeatureId;
    isCollectorRef.current = isCollector;
    onFeatureBlockedRef.current = onFeatureBlocked;
    editSubModeRef.current = editSubMode;
    outlinedTaskIdsRef.current = outlinedTaskIds;
    outlineAllTasksRef.current = outlineAllTasks;
    pickLinkedFeatureModeRef.current = pickLinkedFeatureMode;
    onLinkedFeatureSelectRef.current = onLinkedFeatureSelect;
    gpsPositionRef.current = gpsPosition;
  }, [drawMode, activeLayerId, editMode, editLayerId, snappingEnabled, snapTolerance, serverVectors, onFeatureInspect, inspectedFeatureId, isCollector, onFeatureBlocked, editSubMode, outlinedTaskIds, outlineAllTasks, pickLinkedFeatureMode, onLinkedFeatureSelect, gpsPosition]);

  // ---- Sync task grid outline mode across tasks ----
  useEffect(() => {
    outlinedTaskIdsRef.current = outlinedTaskIds;
    outlineAllTasksRef.current = outlineAllTasks;
    if (layersRef.current.taskLayer) {
      layersRef.current.taskLayer.changed();
    }
  }, [outlinedTaskIds, outlineAllTasks]);

  // ---- Sync Modify interaction active state with editSubMode ----
  useEffect(() => {
    if (modifyInteractionRef.current) {
      if (editSubMode === 'bistar' || editSubMode === 'extend' || editSubMode === 'metne' || editSubMode === 'deleteVertex') {
        modifyInteractionRef.current.setActive(false);
      } else {
        modifyInteractionRef.current.setActive(true);
      }
    }
  }, [editSubMode]);

  const [olLoaded, setOlLoaded] = useState(false);
  const [olModules, setOlModules] = useState(null);

  // ---- Dynamic OpenLayers import (SSR-safe) ----
  useEffect(() => {
    const loadOL = async () => {
      try {
        const [
          { default: Map },
          { default: View },
          { default: TileLayer },
          { default: VectorLayer },
          { default: OSM },
          { default: XYZ },
          { default: VectorSource },
          { default: GeoJSON },
          { default: Style },
          { default: Fill },
          { default: Stroke },
          { default: CircleStyle },
          { default: Feature },
          { default: Point },
          { default: MultiPoint },
          { default: LineString },
          { default: Draw },
          { default: Snap },
          { default: Select },
          { default: Modify },
          { fromLonLat, toLonLat, transformExtent },
          { default: CircleGeom },
          { default: TextStyle },
        ] = await Promise.all([
          import('ol/Map'),
          import('ol/View'),
          import('ol/layer/Tile'),
          import('ol/layer/Vector'),
          import('ol/source/OSM'),
          import('ol/source/XYZ'),
          import('ol/source/Vector'),
          import('ol/format/GeoJSON'),
          import('ol/style/Style'),
          import('ol/style/Fill'),
          import('ol/style/Stroke'),
          import('ol/style/Circle'),
          import('ol/Feature'),
          import('ol/geom/Point'),
          import('ol/geom/MultiPoint'),
          import('ol/geom/LineString'),
          import('ol/interaction/Draw'),
          import('ol/interaction/Snap'),
          import('ol/interaction/Select'),
          import('ol/interaction/Modify'),
          import('ol/proj'),
          import('ol/geom/Circle'),
          import('ol/style/Text'),
        ]);

        setOlModules({
          Map, View, TileLayer, VectorLayer, OSM, XYZ, VectorSource, GeoJSON,
          Style, Fill, Stroke, CircleStyle, Circle: CircleStyle, TextStyle, Feature, Point, MultiPoint, LineString, Draw, Snap,
          Select, Modify, CircleGeom, fromLonLat, toLonLat, transformExtent,
        });
        setOlLoaded(true);
      } catch (err) {
        console.error('[Map] Failed to load OpenLayers modules:', err);
      }
    };

    loadOL();
  }, []);

  // ---- Initialize Map ----
  useEffect(() => {
    if (!olLoaded || !olModules || !mapRef.current || mapInstance.current) return;

    try {
      const {
        Map, View, TileLayer, OSM, XYZ, VectorLayer, VectorSource, fromLonLat,
        Style, Fill, Stroke, CircleStyle, Feature, Point, GeoJSON, TextStyle,
      } = olModules;

      // Basemap layers
      const osmLayer = new TileLayer({
        source: new OSM(),
        visible: activeBasemap === 'osm',
        opacity: basemapOpacity / 100,
      });

      const esriLayer = new TileLayer({
        source: new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maxZoom: 19,
        }),
        visible: activeBasemap === 'esri',
        opacity: basemapOpacity / 100,
      });

      const googleLayer = new TileLayer({
        source: new XYZ({
          url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          maxZoom: 20,
        }),
        visible: activeBasemap === 'google',
        opacity: basemapOpacity / 100,
      });

      // Task grid vector layer
      const taskSource = new VectorSource();
      const taskLayer = new VectorLayer({
        source: taskSource,
        zIndex: 70,
        declutter: true,
        renderBuffer: 100,
        style: (feature, resolution) => {
          const status = feature.get('status');
          const isAssigned = !!feature.get('assigned_to');
          const isSelected = feature.get('id') === selectedTask?.id;
          const gridIndex = feature.get('grid_index');
          const assignedName = feature.get('assigned_to_name');

          const colors = {
            READY: isAssigned ? 'rgba(4, 71, 175, 0.25)' : 'rgba(14, 165, 233, 0.16)',
            LOCKED_FOR_MAPPING: 'rgba(245, 158, 11, 0.35)',
            MAPPED: 'rgba(16, 185, 129, 0.35)',
            LOCKED_FOR_VALIDATION: 'rgba(139, 92, 246, 0.35)',
            VALIDATED: 'rgba(6, 182, 212, 0.35)',
            INVALIDATED: 'rgba(239, 68, 68, 0.35)',
          };
          const strokes = {
            READY: isAssigned ? '#0447af' : '#0284c7',
            LOCKED_FOR_MAPPING: '#d97706',
            MAPPED: '#059669',
            LOCKED_FOR_VALIDATION: '#7c3aed',
            VALIDATED: '#0891b2',
            INVALIDATED: '#c8102e',
          };

          const taskId = feature.get('id');
          const isOutlined = outlineAllTasksRef.current || (
            outlinedTaskIdsRef.current && (
              outlinedTaskIdsRef.current instanceof Set
                ? outlinedTaskIdsRef.current.has(taskId)
                : Array.isArray(outlinedTaskIdsRef.current) && outlinedTaskIdsRef.current.includes(taskId)
            )
          );

          const strokeStyle = new Stroke({
            color: isSelected ? '#ffcc00' : (strokes[status] || '#0284c7'),
            width: isSelected ? 4.0 : (isOutlined ? 3.0 : (isAssigned ? 2.5 : 2.0)),
            lineDash: (!isAssigned && status === 'READY' && !isOutlined) ? [6, 4] : undefined,
          });

          // Only render text label when zoomed in or when selected for ultra-smooth 60fps performance
          const showLabel = isSelected || (resolution < 6.0 && gridIndex);
          const labelText = showLabel && gridIndex ? `#${gridIndex}${assignedName ? ` (${assignedName.split(' ')[0]})` : ''}` : '';

          const fillColor = isOutlined
            ? 'rgba(0, 0, 0, 0)'
            : (isSelected ? 'rgba(255, 204, 0, 0.35)' : (colors[status] || 'rgba(14, 165, 233, 0.15)'));

          return new Style({
            fill: new Fill({ color: fillColor }),
            stroke: strokeStyle,
            text: showLabel && TextStyle && labelText ? new TextStyle({
              text: labelText,
              font: isSelected ? 'bold 12px sans-serif' : 'bold 10px sans-serif',
              fill: new Fill({ color: isSelected ? '#0447af' : '#0f172a' }),
              stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
              overflow: false,
            }) : undefined,
          });
        },
      });

      // Drawn Boundary preview layer (for Task Grid Canvas Drawing Area)
      const drawnBoundarySource = new VectorSource();
      const drawnBoundaryLayer = new VectorLayer({
        source: drawnBoundarySource,
        zIndex: 15,
        style: new Style({
          fill: new Fill({ color: 'rgba(4, 71, 175, 0.18)' }),
          stroke: new Stroke({
            color: '#f59e0b',
            width: 3.5,
            lineDash: [8, 6],
          }),
        }),
      });

      // GPS position layer
      const gpsSource = new VectorSource();
      const gpsLayer = new VectorLayer({
        source: gpsSource,
        zIndex: 50,
      });

      // Real-Time Collector Fleet Tracking Layer (with Co-Location Spider Support)
      const collectorTrackingSource = new VectorSource();
      const collectorTrackingLayer = new VectorLayer({
        source: collectorTrackingSource,
        zIndex: 55,
        style: (feature) => {
          const isAccuracyCircle = feature.get('isAccuracyCircle');
          const isSpiderLeg = feature.get('isSpiderLeg');
          const isCoLocationHub = feature.get('isCoLocationHub');
          const isOnline = feature.get('is_online');

          if (isAccuracyCircle) {
            return new Style({
              fill: new Fill({ color: isOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(100, 116, 139, 0.08)' }),
              stroke: new Stroke({
                color: isOnline ? 'rgba(16, 185, 129, 0.55)' : 'rgba(100, 116, 139, 0.35)',
                width: 1.5,
                lineDash: [5, 4],
              }),
            });
          }

          if (isSpiderLeg) {
            return new Style({
              stroke: new Stroke({
                color: isOnline ? '#10b981' : '#94a3b8',
                width: 2,
                lineDash: [4, 4],
              }),
            });
          }

          if (isCoLocationHub) {
            const members = feature.get('clusterMembers') || [];
            const count = members.length;
            return [
              new Style({
                image: new CircleStyle({
                  radius: 8,
                  fill: new Fill({ color: '#1e293b' }),
                  stroke: new Stroke({ color: '#ffffff', width: 2 }),
                }),
                text: new TextStyle({
                  text: `📍 साझा बिन्दु (${count})`,
                  font: 'bold 10px sans-serif',
                  offsetY: 16,
                  fill: new Fill({ color: '#0f172a' }),
                  stroke: new Stroke({ color: '#ffffff', width: 3 }),
                  backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.95)' }),
                  backgroundStroke: new Stroke({ color: '#94a3b8', width: 1 }),
                  padding: [1, 5, 1, 5],
                }),
              }),
            ];
          }

          const name = feature.get('name') || feature.get('username') || 'संकलक';
          const statusIcon = isOnline ? '🟢' : '⚪';
          const clusterTotal = feature.get('clusterTotal') || 1;
          const clusterIndex = feature.get('clusterIndex');
          const badgeText = clusterTotal > 1 ? ` [${clusterIndex + 1}/${clusterTotal}]` : '';
          const labelText = `${statusIcon} ${name}${badgeText}`;

          return [
            // Outer halo / officer marker
            new Style({
              image: new CircleStyle({
                radius: isOnline ? 12 : 10,
                fill: new Fill({ color: isOnline ? '#10b981' : '#64748b' }),
                stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
              }),
            }),
            // Inner core dot
            new Style({
              image: new CircleStyle({
                radius: isOnline ? 5.5 : 4.5,
                fill: new Fill({ color: isOnline ? '#047857' : '#334155' }),
                stroke: new Stroke({ color: '#ffffff', width: 1 }),
              }),
              text: new TextStyle({
                text: labelText,
                font: 'bold 11px sans-serif',
                offsetY: -18,
                fill: new Fill({ color: isOnline ? '#064e3b' : '#1e293b' }),
                stroke: new Stroke({ color: '#ffffff', width: 3 }),
                backgroundFill: new Fill({ color: isOnline ? 'rgba(236, 253, 245, 0.95)' : 'rgba(241, 245, 249, 0.95)' }),
                backgroundStroke: new Stroke({ color: isOnline ? '#10b981' : '#94a3b8', width: 1 }),
                padding: [2, 6, 2, 6],
              }),
            }),
          ];
        },
      });

      // Snapping Candidate Vertices Display Layer (Displays all vertex handles like Edit Mode)
      const snappingVerticesSource = new VectorSource();
      const snappingVerticesLayer = new VectorLayer({
        source: snappingVerticesSource,
        zIndex: 900,
        style: new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: '#06b6d4' }), // Cyan vertex circle identical to Edit Mode!
            stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
          }),
        }),
      });
      snappingVerticesSourceRef.current = snappingVerticesSource;

      // Feature Hover & Inspection Highlight Layer (Glowing outline & highlighted fill)
      const featureHighlightSource = new VectorSource();
      const featureHighlightLayer = new VectorLayer({
        source: featureHighlightSource,
        zIndex: 850,
        style: (feature) => {
          const geom = feature ? feature.getGeometry() : null;
          if (!geom) return [];
          const type = geom.getType();
          const styles = [];

          if (type === 'Polygon' || type === 'MultiPolygon') {
            const layerId = feature.get('_layerId') || feature.get('layer_id');
            const layerData = layerId ? serverVectorsRef.current.find((v) => String(v.id) === String(layerId)) : null;
            const isOutlined = !!(layerData && layerData.outlineOnly);

            styles.push(
              new Style({
                fill: (isOutlined || editModeRef.current) ? new Fill({ color: 'rgba(0, 0, 0, 0)' }) : new Fill({ color: 'rgba(245, 158, 11, 0.28)' }),
                stroke: new Stroke({ color: '#f59e0b', width: 3.5, lineDash: [8, 4] }),
              })
            );
          } else if (type === 'LineString' || type === 'MultiLineString') {
            styles.push(
              new Style({
                stroke: new Stroke({ color: '#f59e0b', width: 5.5 }),
              })
            );
          } else if (type === 'Point' || type === 'MultiPoint') {
            styles.push(
              new Style({
                image: new CircleStyle({
                  radius: 11,
                  fill: new Fill({ color: 'rgba(245, 158, 11, 0.45)' }),
                  stroke: new Stroke({ color: '#f59e0b', width: 3 }),
                }),
              })
            );
          }
          return styles;
        },
      });
      featureHighlightSourceRef.current = featureHighlightSource;

      // Snapping Target Indicator Layer
      // Snapping & Clicked/Tapped Vertex Highlight Layer (Vibrant Golden-Amber glowing marker)
      const snapIndicatorSource = new VectorSource();
      const snapIndicatorLayer = new VectorLayer({
        source: snapIndicatorSource,
        zIndex: 1000,
        style: [
          new Style({
            image: new CircleStyle({
              radius: 12,
              stroke: new Stroke({ color: 'rgba(245, 158, 11, 0.45)', width: 6 }),
            }),
          }),
          new Style({
            image: new CircleStyle({
              radius: 6.5,
              fill: new Fill({ color: '#f59e0b' }),
              stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
            }),
          }),
        ],
      });
      snapIndicatorSourceRef.current = snapIndicatorSource;

      const map = new Map({
        target: mapRef.current,
        layers: [osmLayer, esriLayer, googleLayer, taskLayer, drawnBoundaryLayer, gpsLayer, collectorTrackingLayer, featureHighlightLayer, snappingVerticesLayer, snapIndicatorLayer],
        view: new View({
          center: fromLonLat([85.324, 27.7172]), // Kathmandu default
          zoom: 13,
          maxZoom: 22,
        }),
        controls: [],
      });

      map.getView().on('change:rotation', () => {
        setMapRotation(map.getView().getRotation());
      });

      layersRef.current = {
        basemaps: { osm: osmLayer, esri: esriLayer, google: googleLayer },
        taskLayer,
        taskSource,
        drawnBoundaryLayer,
        drawnBoundarySource,
        gpsLayer,
        gpsSource,
        collectorTrackingLayer,
        collectorTrackingSource,
        featureHighlightLayer,
        featureHighlightSource,
        snappingVerticesLayer,
        snappingVerticesSource,
        snapIndicatorLayer,
        snapIndicatorSource,
        serverRasters: {},
        serverVectors: {},
      };

      // Helper to check if a feature geometry is within collector's assigned task grids
      const checkFeatureWithinAssignedGrids = (olFeature) => {
        if (!isCollectorRef.current) return true;
        const taskSource = layersRef.current.taskSource;
        if (!taskSource) return true;
        const gridFeatures = taskSource.getFeatures();
        if (!gridFeatures || gridFeatures.length === 0) {
          // Project has no task grids - collector can edit directly within project
          return true;
        }
        const featGeom = olFeature ? olFeature.getGeometry() : null;
        if (!featGeom) return true;
        const featExtent = featGeom.getExtent();

        for (const gridFeat of gridFeatures) {
          const gridGeom = gridFeat.getGeometry();
          if (gridGeom && gridGeom.intersectsExtent(featExtent)) {
            return true;
          }
        }
        return false;
      };

      // Helper to immediately highlight a tapped/clicked vertex on any device (Touch/Mobile/Desktop)
      const highlightVertexAtEvent = (evt) => {
        if (!snapIndicatorSourceRef.current) return;
        const currentTargetId = drawModeRef.current ? activeLayerIdRef.current : (editModeRef.current ? editLayerIdRef.current : null);
        if (currentTargetId && !isLayerSnappable(currentTargetId)) {
          snapIndicatorSourceRef.current.clear();
          return;
        }

        const isTouch = evt.originalEvent?.pointerType === 'touch' || ('ontouchstart' in window && evt.originalEvent?.touches?.length > 0);
        const effectiveTol = isTouch ? Math.max(snapToleranceRef.current, 28) : Math.max(snapToleranceRef.current, 15);

        const visibleSources = Object.entries(layersRef.current.serverVectors)
          .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible() && obj.source && isLayerSnappable(id))
          .map(([_, obj]) => obj.source);

        const snapResult = findNearestVertex(map, evt.pixel, visibleSources, effectiveTol);
        if (snapResult) {
          snapIndicatorSourceRef.current.clear();
          const snapPoint = new Feature({ geometry: new Point(snapResult.coordinate) });
          snapIndicatorSourceRef.current.addFeature(snapPoint);
        }
      };

      // Helper to validate whether a clicked/tapped feature should be selected or ignored based on outline mode
      const isFeatureHitValid = (f, layerId, coordinate, resolution) => {
        if (!f || !coordinate) return false;
        const layerData = serverVectorsRef.current.find((v) => String(v.id) === String(layerId));
        const isOutlined = !!(layerData && layerData.outlineOnly);
        const geom = f.getGeometry();
        if (!geom) return false;
        const type = geom.getType();
        const isPoly = type === 'Polygon' || type === 'MultiPolygon';

        if (isOutlined && isPoly) {
          const toleranceMapUnits = Math.max(12, 14) * (resolution || 1);
          return isPointNearPolygonBoundary(geom, coordinate, toleranceMapUnits);
        }
        return true;
      };

      // Helper to validate whether a clicked/tapped task grid should be selected or ignored based on outline mode
      const isTaskHitValid = (f, coordinate, resolution) => {
        if (!f || !coordinate) return false;
        const taskId = f.get('id');
        const isOutlined = outlineAllTasksRef.current || (
          outlinedTaskIdsRef.current && (
            outlinedTaskIdsRef.current instanceof Set
              ? outlinedTaskIdsRef.current.has(taskId)
              : Array.isArray(outlinedTaskIdsRef.current) && outlinedTaskIdsRef.current.includes(taskId)
          )
        );

        if (isOutlined) {
          const geom = f.getGeometry();
          if (!geom) return false;
          const toleranceMapUnits = Math.max(12, 14) * (resolution || 1);
          return isPointNearPolygonBoundary(geom, coordinate, toleranceMapUnits);
        }
        return true;
      };

      map.on('pointerdown', (evt) => {
        highlightVertexAtEvent(evt);
      });

      // Click handler for task grids & Edit Mode (Selection + Feature Extension)
      map.on('singleclick', (evt) => {
        // If a drag/modify interaction just finished, ignore trailing click event
        if (isModifyingRef.current) {
          return;
        }

        highlightVertexAtEvent(evt);
        const resolution = map.getView().getResolution() || 1;
        const toleranceMapUnits = Math.max(snapToleranceRef.current || 20, 20) * resolution;
        const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0));
        const touchHitTol = isTouchDevice ? 24 : 10;

        // --- 00. Collector Marker / Co-Location Hub Click (View Collector Fleet Info) ---
        if (layersRef.current.collectorTrackingLayer) {
          const clickedCollectorFeat = map.forEachFeatureAtPixel(evt.pixel, (f) => {
            if (f && (f.get('isCollectorMarker') || f.get('isCoLocationHub'))) return f;
            return null;
          }, {
            layerFilter: (l) => l === layersRef.current.collectorTrackingLayer,
            hitTolerance: touchHitTol,
          });

          if (clickedCollectorFeat) {
            const colData = clickedCollectorFeat.get('collectorData');
            const clusterMembers = clickedCollectorFeat.get('clusterMembers') || (colData ? [colData] : []);
            const targetCol = colData || (clusterMembers.length > 0 ? clusterMembers[0] : null);
            if (targetCol) {
              const idx = clusterMembers.findIndex((c) => c.user_id === targetCol.user_id);
              setInspectedCollector(targetCol);
              setInspectedCollectorCluster(clusterMembers);
              setClusterMemberIndex(idx >= 0 ? idx : 0);
              if (onCollectorSelect) onCollectorSelect(targetCol);
              return;
            }
          }
        }

        // --- 0. Pick Linked Feature Mode (Direct Feature Selection for Linking) ---
        if (pickLinkedFeatureModeRef.current) {
          const visibleVectorLayers = Object.values(layersRef.current.serverVectors)
            .filter((obj) => obj && obj.layer && obj.layer.getVisible())
            .map((obj) => obj.layer);

          const clickedVector = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
            const foundEntry = Object.entries(layersRef.current.serverVectors).find(
              ([id, obj]) => obj && obj.layer === layer
            );
            const layerId = foundEntry ? foundEntry[0] : null;
            if (f && layerId && isFeatureHitValid(f, layerId, evt.coordinate, resolution)) {
              return { feature: f, layer, layerId };
            }
            return null;
          }, {
            layerFilter: (l) => visibleVectorLayers.includes(l),
            hitTolerance: 8,
          });

          if (clickedVector && clickedVector.feature && onLinkedFeatureSelectRef.current) {
            const f = clickedVector.feature;
            const lId = parseInt(clickedVector.layerId);
            const targetLayerData = serverVectorsRef.current.find((v) => Number(v.id) === lId);
            const featProps = f.getProperties ? f.getProperties() : (f.properties || {});
            const cleanProps = { ...featProps };
            delete cleanProps.geometry;
            delete cleanProps.geom;

            const fid = f.getId ? f.getId() : (f.get ? f.get('_id') : featProps._id || featProps.id);

            let geomGeojson = null;
            const geom = f.getGeometry ? f.getGeometry() : null;
            if (geom && olModules?.GeoJSON) {
              const format = new olModules.GeoJSON();
              geomGeojson = JSON.parse(format.writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
            }

            onLinkedFeatureSelectRef.current({
              layerId: lId,
              layerName: targetLayerData?.name || `Layer_${lId}`,
              featureId: fid,
              properties: cleanProps,
              geometry: geomGeojson,
            });
            return;
          }
        }

        // --- 1. Edit Mode Interaction Handling ---
        if (editModeRef.current) {
          const currentLayerObj = editLayerIdRef.current ? layersRef.current.serverVectors[String(editLayerIdRef.current)] : null;

          // CASE A: Delete Vertex Sub-Mode (मेट्ने)
          if ((editSubModeRef.current === 'metne' || editSubModeRef.current === 'deleteVertex') && selectedOlFeatureRef.current) {
            const curFeat = selectedOlFeatureRef.current;
            const geom = curFeat.getGeometry();
            const geomType = geom?.getType();

            if (geomType === 'Point') {
              alert('⚠️ बिन्दु फिचर हटाउन विशेषता प्यानलमा रहेको "मेटाउनुहोस्" (Delete) बटन प्रयोग गर्नुहोस्।');
              return;
            }

            const coords = extractCoordinatesFromGeometry(geom);
            if (geomType === 'LineString' && coords && coords.length <= 2) {
              alert('⚠️ रेखामा कम्तीमा २ बिन्दु हुनुपर्छ, थप मेट्न सकिँदैन। (Line must have at least 2 vertices.)');
              return;
            }
            if ((geomType === 'Polygon' || geomType === 'MultiPolygon') && coords && coords.length <= 4) {
              alert('⚠️ बहुभुजमा कम्तीमा ३ कुना हुनुपर्छ, थप मेट्न सकिँदैन। (Polygon must have at least 3 vertices.)');
              return;
            }

            const deleted = removeNearestVertexFromFeature(curFeat, evt.coordinate, toleranceMapUnits);

            if (deleted) {
              curFeat.changed();
              if (modifyInteractionRef.current) {
                modifyInteractionRef.current.setActive(false);
                modifyInteractionRef.current.setActive(true);
              }
              const newCoords = extractCoordinatesFromGeometry(curFeat.getGeometry());
              selectedVertexIndexRef.current = Math.max(0, Math.min(selectedVertexIndexRef.current || 0, newCoords.length - 1));
              if (olModules) {
                const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke, GeoJSON } = olModules;
                renderSelectedFeatureVertices(curFeat, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);
                const format = new GeoJSON();
                const geojson = JSON.parse(format.writeFeature(curFeat, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
                const featureId = curFeat.getId() || curFeat.get('_id') || geojson.id || geojson.properties?._id;
                const isWithin = checkFeatureWithinAssignedGrids(curFeat);
                if (onFeatureModifyEnd) {
                  onFeatureModifyEnd(featureId, geojson.geometry, isWithin);
                }
              }
              return;
            }
            return;
          }

          // CASE B: A feature IS ALREADY selected
          if (selectedOlFeatureRef.current) {
            const curFeat = selectedOlFeatureRef.current;

            // Step 1: Check if user tapped/clicked directly ON an existing vertex of this selected feature (14-pixel hit radius)
            const vertexTapTolerance = 14 * resolution;
            const hitVertex = findVertexIndexNearCoord(curFeat, evt.coordinate, vertexTapTolerance);
            if (hitVertex) {
              // User tapped an existing vertex! Select this vertex and turn its color RED!
              selectedVertexIndexRef.current = hitVertex.index;
              if (olModules) {
                const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke } = olModules;
                renderSelectedFeatureVertices(curFeat, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);
              }
              return;
            }

            // Step 2: Check if user clicked on ANOTHER feature to switch selection
            let clickedOtherFeature = null;
            let otherLayerId = editLayerIdRef.current;
            let otherLayerData = serverVectorsRef.current.find((v) => String(v.id) === String(otherLayerId));

            if (currentLayerObj && currentLayerObj.layer) {
              clickedOtherFeature = map.forEachFeatureAtPixel(evt.pixel, (f) => {
                if (isFeatureHitValid(f, editLayerIdRef.current, evt.coordinate, resolution)) {
                  return f;
                }
                return null;
              }, {
                layerFilter: (l) => l === currentLayerObj.layer,
                hitTolerance: touchHitTol,
              });
            }

            if (!clickedOtherFeature) {
              const visibleEntries = Object.entries(layersRef.current.serverVectors)
                .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible());
              const visibleLayers = visibleEntries.map(([id, obj]) => obj.layer);

              const hit = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
                const found = visibleEntries.find(([id, obj]) => obj.layer === layer);
                if (found && isFeatureHitValid(f, found[0], evt.coordinate, resolution)) {
                  return { feature: f, layerId: parseInt(found[0], 10) };
                }
                return null;
              }, {
                layerFilter: (l) => visibleLayers.includes(l),
                hitTolerance: touchHitTol,
              });

              if (hit) {
                clickedOtherFeature = hit.feature;
                otherLayerId = hit.layerId;
                otherLayerData = serverVectorsRef.current.find((v) => String(v.id) === String(otherLayerId));
                editLayerIdRef.current = otherLayerId;
              }
            }

            if (clickedOtherFeature && clickedOtherFeature !== curFeat) {
              if (isCollectorRef.current && !checkFeatureWithinAssignedGrids(clickedOtherFeature)) {
                if (onFeatureBlockedRef.current) {
                  onFeatureBlockedRef.current({
                    reason: 'OUTSIDE_GRID',
                    message: '⚠️ यो फिचर तपाईंलाई तोकिएको कार्यक्षेत्र (ग्रिड) भन्दा बाहिर छ। (This feature is outside your assigned task grids.)',
                  });
                }
                return;
              }

              if (isCollectorRef.current) {
                const gps = gpsPositionRef.current;
                if (!gps || gps.lat == null || gps.lng == null) {
                  if (onFeatureBlockedRef.current) {
                    onFeatureBlockedRef.current({
                      reason: 'NO_GPS',
                      message: '⚠️ GPS स्थान प्राप्त हुन सकेन। सम्पादन गर्न आफ्नो GPS सक्रिय गर्नुहोस् र ५० मिटर भित्र हुनुहोस्। (GPS location required. Must be within 50m to edit.)',
                    });
                  }
                  return;
                }

                if (olModules?.GeoJSON) {
                  const format = new olModules.GeoJSON();
                  const geojsonObj = JSON.parse(format.writeFeature(clickedOtherFeature, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
                  const dist = getDistanceToGeoJsonGeometry(gps.lat, gps.lng, geojsonObj.geometry);
                  if (dist > GEOFENCE_EDIT_RADIUS_METERS) {
                    const distM = Math.round(dist);
                    if (onFeatureBlockedRef.current) {
                      onFeatureBlockedRef.current({
                        reason: 'OUTSIDE_GPS_50M',
                        message: `⚠️ तपाईं यो फिचरबाट ${distM} मिटर टाढा हुनुहुन्छ। सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ। सम्पादन मोड खोलिएन। (You are ${distM}m away from this feature. You must be within 50m to edit.)`,
                      });
                    }
                    return;
                  }
                }
              }

              if (olModules) {
                const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke, GeoJSON } = olModules;
                const format = new GeoJSON();
                const geojson = JSON.parse(format.writeFeature(clickedOtherFeature, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
                const featureId = clickedOtherFeature.getId() || clickedOtherFeature.get('_id') || geojson.id || geojson.properties?._id;
                const targetLayerData = serverVectorsRef.current.find((v) => String(v.id) === String(editLayerIdRef.current));

                selectedOlFeatureRef.current = clickedOtherFeature;
                if (selectInteractionRef.current) {
                  selectInteractionRef.current.getFeatures().clear();
                  selectInteractionRef.current.getFeatures().push(clickedOtherFeature);
                }

                const coords = extractCoordinatesFromGeometry(clickedOtherFeature.getGeometry());
                selectedVertexIndexRef.current = Math.max(0, coords.length - 1);
                renderSelectedFeatureVertices(clickedOtherFeature, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);

                if (onFeatureSelect) {
                  onFeatureSelect({
                    id: featureId,
                    layerId: otherLayerId || editLayerIdRef.current,
                    layerName: otherLayerData?.name || targetLayerData?.name || 'तह',
                    geometryType: geojson.geometry?.type || clickedOtherFeature.getGeometry()?.getType(),
                    properties: geojson.properties || {},
                    originalGeom: geojson.geometry,
                    currentGeom: geojson.geometry,
                    isModified: false,
                    isWithinAssignedGrid: true,
                  });
                }
              }
              return;
            }

            // Step 3: User clicked a NEW location on the map!
            const sub = editSubModeRef.current;
            const geom = curFeat.getGeometry();
            const geomType = geom?.getType();

            // When in 'metne' mode: clicking empty space must NOT insert any vertex
            if (sub === 'metne' || sub === 'deleteVertex') {
              return;
            }

            // When in 'tane' mode: extending is DISABLED!
            // For a single Point feature, clicking a new spot relocates/moves the point.
            if (sub === 'tane' || sub === 'modify') {
              if (geomType === 'Point') {
                let targetCoord = evt.coordinate;
                const isEditLayerSnappable = isLayerSnappable(editLayerIdRef.current);
                if (snappingEnabledRef.current && isEditLayerSnappable) {
                  const visibleSources = Object.entries(layersRef.current.serverVectors)
                    .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible() && obj.source && isLayerSnappable(id))
                    .map(([_, obj]) => obj.source);
                  const snapResult = findNearestVertex(map, evt.pixel, visibleSources, snapToleranceRef.current);
                  if (snapResult) {
                    targetCoord = snapResult.coordinate;
                  }
                }
                geom.setCoordinates(targetCoord);
                curFeat.changed();
                if (olModules) {
                  const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke, GeoJSON } = olModules;
                  renderSelectedFeatureVertices(curFeat, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, 0);
                  const isWithin = checkFeatureWithinAssignedGrids(curFeat);
                  const format = new GeoJSON();
                  const geojson = JSON.parse(format.writeFeature(curFeat, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
                  const featureId = curFeat.getId() || curFeat.get('_id') || geojson.id || geojson.properties?._id;
                  if (onFeatureModifyEnd) {
                    onFeatureModifyEnd(featureId, geojson.geometry, isWithin);
                  }
                }
                return;
              }
              // For LineString / Polygon: do NOT insert vertex in ताने mode!
              return;
            }

            // At this point, mode is either null (all allowed) or 'bistar' (only extend allowed)
            // For a single Point feature: points cannot be extended!
            if (geomType === 'Point') {
              if (sub === 'bistar' || sub === 'extend') {
                return; // cannot extend single point
              }
              // In null mode, clicking empty space relocates the point
              let targetCoord = evt.coordinate;
              const isEditLayerSnappable = isLayerSnappable(editLayerIdRef.current);
              if (snappingEnabledRef.current && isEditLayerSnappable) {
                const visibleSources = Object.entries(layersRef.current.serverVectors)
                  .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible() && obj.source && isLayerSnappable(id))
                  .map(([_, obj]) => obj.source);
                const snapResult = findNearestVertex(map, evt.pixel, visibleSources, snapToleranceRef.current);
                if (snapResult) {
                  targetCoord = snapResult.coordinate;
                }
              }
              geom.setCoordinates(targetCoord);
              curFeat.changed();
              if (olModules) {
                const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke, GeoJSON } = olModules;
                renderSelectedFeatureVertices(curFeat, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, 0);
                const isWithin = checkFeatureWithinAssignedGrids(curFeat);
                const format = new GeoJSON();
                const geojson = JSON.parse(format.writeFeature(curFeat, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
                const featureId = curFeat.getId() || curFeat.get('_id') || geojson.id || geojson.properties?._id;
                if (onFeatureModifyEnd) {
                  onFeatureModifyEnd(featureId, geojson.geometry, isWithin);
                }
              }
              return;
            }

            // For LineString, MultiLineString, Polygon, MultiPolygon:
            // Append/insert new vertex adjacent to selected vertex (बिस्तार)
            let targetCoord = evt.coordinate;

            // Snapping: If enabled and allowed for this layer, snap to nearby vertex of any snappable visible layer
            const isEditLayerSnappable = isLayerSnappable(editLayerIdRef.current);
            if (snappingEnabledRef.current && isEditLayerSnappable) {
              const visibleSources = Object.entries(layersRef.current.serverVectors)
                .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible() && obj.source && isLayerSnappable(id))
                .map(([_, obj]) => obj.source);

              const snapResult = findNearestVertex(map, evt.pixel, visibleSources, snapToleranceRef.current);
              if (snapResult) {
                targetCoord = snapResult.coordinate;
              }
            }

            const newIdx = insertCoordinateAtVertex(geom, targetCoord, selectedVertexIndexRef.current);
            curFeat.changed();
            selectedVertexIndexRef.current = newIdx; // The newly created vertex becomes the selected RED vertex!

            if (modifyInteractionRef.current && (sub === null || sub === 'tane' || sub === 'modify')) {
              modifyInteractionRef.current.setActive(false);
              modifyInteractionRef.current.setActive(true);
            }
            if (selectInteractionRef.current) {
              selectInteractionRef.current.getFeatures().clear();
              selectInteractionRef.current.getFeatures().push(curFeat);
            }

            if (olModules) {
              const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke, GeoJSON } = olModules;
              renderSelectedFeatureVertices(curFeat, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);

              const isWithin = checkFeatureWithinAssignedGrids(curFeat);
              if (isCollectorRef.current && !isWithin && onFeatureBlockedRef.current) {
                onFeatureBlockedRef.current({
                  reason: 'OUTSIDE_GRID',
                  message: '⚠️ चेतावनी: परिमार्जित भाग तपाईंको कार्यक्षेत्र (ग्रिड) भन्दा बाहिर पुगेको छ। कृपया ग्रिड भित्रै सीमित राख्नुहोस्।',
                });
              }

              const format = new GeoJSON();
              const geojson = JSON.parse(format.writeFeature(curFeat, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
              const featureId = curFeat.getId() || curFeat.get('_id') || geojson.id || geojson.properties?._id;

              if (onFeatureModifyEnd) {
                onFeatureModifyEnd(featureId, geojson.geometry, isWithin);
              }
            }
            return;
          }

          // CASE C: NO feature is currently selected -> check if user clicked an existing feature to select it
          let clickedFeature = null;
          let targetLayerId = editLayerIdRef.current;
          let targetLayerData = serverVectorsRef.current.find((v) => String(v.id) === String(targetLayerId));

          if (currentLayerObj && currentLayerObj.layer) {
            clickedFeature = map.forEachFeatureAtPixel(evt.pixel, (f) => {
              if (isFeatureHitValid(f, editLayerIdRef.current, evt.coordinate, resolution)) {
                return f;
              }
              return null;
            }, {
              layerFilter: (l) => l === currentLayerObj.layer,
              hitTolerance: touchHitTol,
            });
          }

          // Fallback: search across all visible vector layers if not hit on current layer
          if (!clickedFeature) {
            const visibleEntries = Object.entries(layersRef.current.serverVectors)
              .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible());
            const visibleLayers = visibleEntries.map(([id, obj]) => obj.layer);

            const hit = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
              const found = visibleEntries.find(([id, obj]) => obj.layer === layer);
              if (found && isFeatureHitValid(f, found[0], evt.coordinate, resolution)) {
                return { feature: f, layerId: parseInt(found[0], 10) };
              }
              return null;
            }, {
              layerFilter: (l) => visibleLayers.includes(l),
              hitTolerance: touchHitTol,
            });

            if (hit) {
              clickedFeature = hit.feature;
              targetLayerId = hit.layerId;
              targetLayerData = serverVectorsRef.current.find((v) => String(v.id) === String(targetLayerId));
              editLayerIdRef.current = targetLayerId;
            }
          }

            if (clickedFeature) {
              if (isCollectorRef.current && !checkFeatureWithinAssignedGrids(clickedFeature)) {
                if (onFeatureBlockedRef.current) {
                  onFeatureBlockedRef.current({
                    reason: 'OUTSIDE_GRID',
                    message: '⚠️ यो फिचर तपाईंलाई तोकिएको कार्यक्षेत्र (ग्रिड) भन्दा बाहिर छ। (This feature is outside your assigned task grids.)',
                  });
                }
                return;
              }

              if (isCollectorRef.current) {
                const gps = gpsPositionRef.current;
                if (!gps || gps.lat == null || gps.lng == null) {
                  if (onFeatureBlockedRef.current) {
                    onFeatureBlockedRef.current({
                      reason: 'NO_GPS',
                      message: '⚠️ GPS स्थान प्राप्त हुन सकेन। सम्पादन गर्न आफ्नो GPS सक्रिय गर्नुहोस् र ५० मिटर भित्र हुनुहोस्। (GPS location required. Must be within 50m to edit.)',
                    });
                  }
                  return;
                }

                if (olModules?.GeoJSON) {
                  const format = new olModules.GeoJSON();
                  const geojsonObj = JSON.parse(format.writeFeature(clickedFeature, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
                  const dist = getDistanceToGeoJsonGeometry(gps.lat, gps.lng, geojsonObj.geometry);
                  if (dist > GEOFENCE_EDIT_RADIUS_METERS) {
                    const distM = Math.round(dist);
                    if (onFeatureBlockedRef.current) {
                      onFeatureBlockedRef.current({
                        reason: 'OUTSIDE_GPS_50M',
                        message: `⚠️ तपाईं यो फिचरबाट ${distM} मिटर टाढा हुनुहुन्छ। सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ। सम्पादन मोड खोलिएन। (You are ${distM}m away from this feature. You must be within 50m to edit.)`,
                      });
                    }
                    return;
                  }
                }
              }

              if (olModules) {
                const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke, GeoJSON } = olModules;
                const format = new GeoJSON();
                const geojson = JSON.parse(format.writeFeature(clickedFeature, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
                const featureId = clickedFeature.getId() || clickedFeature.get('_id') || geojson.id || geojson.properties?._id;
                const targetLayerData = serverVectorsRef.current.find((v) => String(v.id) === String(editLayerIdRef.current));

                selectedOlFeatureRef.current = clickedFeature;
                if (selectInteractionRef.current) {
                  selectInteractionRef.current.getFeatures().clear();
                  selectInteractionRef.current.getFeatures().push(clickedFeature);
                }

                const coords = extractCoordinatesFromGeometry(clickedFeature.getGeometry());
                selectedVertexIndexRef.current = Math.max(0, coords.length - 1);
                renderSelectedFeatureVertices(clickedFeature, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);

                if (onFeatureSelect) {
                  onFeatureSelect({
                    id: featureId,
                    layerId: targetLayerId || editLayerIdRef.current,
                    layerName: targetLayerData?.name || 'तह',
                    geometryType: geojson.geometry?.type || clickedFeature.getGeometry()?.getType(),
                    properties: geojson.properties || {},
                    originalGeom: geojson.geometry,
                    currentGeom: geojson.geometry,
                    isModified: false,
                    isWithinAssignedGrid: true,
                  });
                }
              }
              return;
            }

          // Clicked empty space with no selection
          selectedOlFeatureRef.current = null;
          selectedVertexIndexRef.current = null;
          if (selectInteractionRef.current) {
            selectInteractionRef.current.getFeatures().clear();
          }
          if (layersRef.current.snappingVerticesSource) {
            layersRef.current.snappingVerticesSource.clear();
          }
          if (onFeatureSelect) {
            onFeatureSelect(null);
          }
          return;
        }

        // --- 2. Non-Edit Mode: Feature Inspection and Attribute Display on Click / Tap ---
        if (!editModeRef.current && !drawModeRef.current) {
          const visibleVectorLayers = Object.values(layersRef.current.serverVectors)
            .filter((obj) => obj && obj.layer && obj.layer.getVisible())
            .map((obj) => obj.layer);

          const clickedVector = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
            const foundEntry = Object.entries(layersRef.current.serverVectors).find(
              ([id, obj]) => obj && obj.layer === layer
            );
            const layerId = foundEntry ? foundEntry[0] : null;
            if (f && layerId && isFeatureHitValid(f, layerId, evt.coordinate, resolution)) {
              return { feature: f, layer, layerId };
            }
            return null;
          }, {
            layerFilter: (l) => visibleVectorLayers.includes(l),
            hitTolerance: touchHitTol,
          });

          if (clickedVector && clickedVector.feature && clickedVector.layerId) {
            const feat = clickedVector.feature;
            inspectedFeatureRef.current = feat;
            if (featureHighlightSourceRef.current) {
              featureHighlightSourceRef.current.clear();
              featureHighlightSourceRef.current.addFeature(feat.clone());
            }

            const format = new GeoJSON();
            const geojson = JSON.parse(
              format.writeFeature(feat, {
                dataProjection: 'EPSG:4326',
                featureProjection: 'EPSG:3857',
              })
            );
            const featureId = feat.getId() || feat.get('_id') || geojson.id || geojson.properties?._id;
            const targetLayerData = serverVectorsRef.current.find((v) => String(v.id) === String(clickedVector.layerId));
            const isWithinGrid = checkFeatureWithinAssignedGrids(feat);

            if (onFeatureInspectRef.current) {
              onFeatureInspectRef.current({
                id: featureId,
                layerId: clickedVector.layerId,
                layerName: targetLayerData?.name || 'तह',
                geometryType: geojson.geometry?.type || feat.getGeometry()?.getType(),
                properties: geojson.properties || {},
                geometry: geojson.geometry,
                extent: feat.getGeometry()?.getExtent(),
                isWithinAssignedGrid: isWithinGrid,
              });
            }
            return;
          }
        }

        // --- 3. Task grid click handling ---
        const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => {
          if (isTaskHitValid(f, evt.coordinate, resolution)) {
            return f;
          }
          return null;
        }, {
          layerFilter: (l) => l === taskLayer,
          hitTolerance: 6,
        });
        if (feature && onTaskClick) {
          onTaskClick({
            id: feature.get('id'),
            grid_index: feature.get('grid_index'),
            name: feature.get('name'),
            status: feature.get('status'),
            assigned_to: feature.get('assigned_to'),
            assigned_to_name: feature.get('assigned_to_name'),
            assigned_at: feature.get('assigned_at'),
            locked_by: feature.get('locked_by'),
            locked_at: feature.get('locked_at'),
            properties: feature.get('properties'),
          });
        }
      });

      // Cursor change on hover, Feature Hover Highlighting, & Snapping Visual Target Detection
      map.on('pointermove', (evt) => {
        if (evt.dragging) return;
        const resolution = map.getView().getResolution() || 1;

        // Snapping Visual Detection during Edit / Draw Mode
        const currentTargetLayerId = editModeRef.current ? editLayerIdRef.current : (drawModeRef.current ? activeLayerIdRef.current : null);
        const isCurrentLayerSnappable = !currentTargetLayerId || isLayerSnappable(currentTargetLayerId);
        const isSnappingActive = (editModeRef.current || drawModeRef.current) && snappingEnabledRef.current && isCurrentLayerSnappable;

        if (isSnappingActive && snapIndicatorSourceRef.current) {
          const visibleSources = Object.entries(layersRef.current.serverVectors)
            .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible() && obj.source && isLayerSnappable(id))
            .map(([_, obj]) => obj.source);

          const snapResult = findNearestVertex(map, evt.pixel, visibleSources, snapToleranceRef.current);
          if (snapResult) {
            snapIndicatorSourceRef.current.clear();
            const snapPoint = new Feature({ geometry: new Point(snapResult.coordinate) });
            snapIndicatorSourceRef.current.addFeature(snapPoint);
            map.getTargetElement().style.cursor = 'crosshair';
            return;
          } else {
            snapIndicatorSourceRef.current.clear();
          }
        } else if (snapIndicatorSourceRef.current) {
          snapIndicatorSourceRef.current.clear();
        }

        // Non-Edit Mode: Feature Hover Highlighting & Pointer Cursor
        if (!editModeRef.current && !drawModeRef.current && featureHighlightSourceRef.current) {
          const visibleVectorLayers = Object.values(layersRef.current.serverVectors)
            .filter((obj) => obj && obj.layer && obj.layer.getVisible())
            .map((obj) => obj.layer);

          const hitVector = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
            const foundEntry = Object.entries(layersRef.current.serverVectors).find(
              ([id, obj]) => obj && obj.layer === layer
            );
            const layerId = foundEntry ? foundEntry[0] : null;
            if (f && layerId && isFeatureHitValid(f, layerId, evt.coordinate, resolution)) {
              return f;
            }
            return null;
          }, {
            layerFilter: (l) => visibleVectorLayers.includes(l),
            hitTolerance: 6,
          });

          if (hitVector) {
            map.getTargetElement().style.cursor = 'pointer';
            if (hoveredFeatureRef.current !== hitVector) {
              hoveredFeatureRef.current = hitVector;
              // If not currently locked to an inspected feature, show hover highlight
              if (!inspectedFeatureIdRef.current) {
                featureHighlightSourceRef.current.clear();
                featureHighlightSourceRef.current.addFeature(hitVector.clone());
              }
            }
            return;
          } else {
            if (hoveredFeatureRef.current) {
              hoveredFeatureRef.current = null;
              if (!inspectedFeatureIdRef.current) {
                featureHighlightSourceRef.current.clear();
              }
            }
          }
        }

        // Task grid hover cursor
        const hit = map.forEachFeatureAtPixel(evt.pixel, (f) => {
          if (isTaskHitValid(f, evt.coordinate, resolution)) {
            return true;
          }
          return null;
        }, {
          layerFilter: (l) => l === taskLayer,
          hitTolerance: 6,
        });
        map.getTargetElement().style.cursor = hit ? 'pointer' : '';
      });

      // Contextmenu (Right-Click) listener on map viewport for single-vertex deletion in Edit Mode
      map.getViewport().addEventListener('contextmenu', (e) => {
        if (!editModeRef.current || !selectedOlFeatureRef.current) return;
        const sub = editSubModeRef.current;
        if (sub === 'tane' || sub === 'modify' || sub === 'bistar' || sub === 'extend') {
          // Deleting vertices is disabled when ताने or बिस्तार is selected
          return;
        }
        const pixel = map.getEventPixel(e);
        const coord = map.getCoordinateFromPixel(pixel);
        if (!coord) return;

        const resolution = map.getView().getResolution() || 1;
        const toleranceMapUnits = Math.max(snapToleranceRef.current || 20, 20) * resolution;

        const deleted = removeNearestVertexFromFeature(selectedOlFeatureRef.current, coord, toleranceMapUnits);
        if (deleted) {
          e.preventDefault(); // Prevent browser right-click menu
          const curFeat = selectedOlFeatureRef.current;
          curFeat.changed();
          if (modifyInteractionRef.current) {
            modifyInteractionRef.current.setActive(false);
            modifyInteractionRef.current.setActive(true);
          }
          const coords = extractCoordinatesFromGeometry(curFeat.getGeometry());
          selectedVertexIndexRef.current = Math.max(0, Math.min(selectedVertexIndexRef.current || 0, coords.length - 1));

          if (layersRef.current.snappingVerticesSource) {
            renderSelectedFeatureVertices(curFeat, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);
          }
          const format = new GeoJSON();
          const geojson = JSON.parse(format.writeFeature(curFeat, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
          const featureId = curFeat.getId() || curFeat.get('_id') || geojson.id || geojson.properties?._id;
          const isWithin = checkFeatureWithinAssignedGrids(curFeat);
          if (onFeatureModifyEnd) {
            onFeatureModifyEnd(featureId, geojson.geometry, isWithin);
          }
        }
      });

      mapInstance.current = map;
    } catch (err) {
      console.error('[Map] Init error:', err);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(undefined);
        mapInstance.current = null;
      }
    };
  }, [olLoaded, olModules]);

  // ---- Update basemap visibility & opacity (supports 'none' mode) ----
  useEffect(() => {
    if (!layersRef.current.basemaps?.osm) return;
    const { basemaps } = layersRef.current;
    Object.entries(basemaps).forEach(([key, layer]) => {
      if (layer) {
        layer.setVisible(activeBasemap === key);
        layer.setOpacity(activeBasemap === key ? basemapOpacity / 100 : 0);
      }
    });
  }, [activeBasemap, basemapOpacity]);

  // ---- Sync Server Raster (MBTiles) Layers ----
  useEffect(() => {
    if (!olModules || !mapInstance.current) return;
    const { TileLayer, XYZ } = olModules;
    const existingRasters = layersRef.current.serverRasters;

    // Remove deleted rasters
    Object.keys(existingRasters).forEach((id) => {
      if (!serverRasters.find((r) => String(r.id) === id)) {
        mapInstance.current.removeLayer(existingRasters[id]);
        delete existingRasters[id];
      }
    });

    // Add / update rasters
    serverRasters.forEach((raster) => {
      const id = String(raster.id);
      const isVisible = raster.visible !== false;
      const opacity = (raster.opacity ?? 100) / 100;

      if (!existingRasters[id]) {
        const tileLayer = new TileLayer({
          source: new XYZ({
            url: `/api/tiles/${raster.id}/{z}/{x}/{y}.png`,
            maxZoom: 22,
          }),
          visible: isVisible,
          opacity: opacity,
          zIndex: 5,
        });
        mapInstance.current.addLayer(tileLayer);
        existingRasters[id] = tileLayer;
      } else {
        existingRasters[id].setVisible(isVisible);
        existingRasters[id].setOpacity(opacity);
      }
    });
  }, [serverRasters, olModules]);

  // ---- Sync Server Vector (PostGIS) Layers (With Complete Error Isolation) ----
  useEffect(() => {
    if (!olModules || !mapInstance.current) return;
    const { VectorLayer, VectorSource, GeoJSON, Style, Fill, Stroke, CircleStyle } = olModules;
    const existingVectors = layersRef.current.serverVectors;

    // Remove deleted vector layers
    Object.keys(existingVectors).forEach((id) => {
      if (!serverVectors.find((v) => String(v.id) === id)) {
        mapInstance.current.removeLayer(existingVectors[id].layer);
        delete existingVectors[id];
      }
    });

    // Add / update vector layers
    const colorPalette = [
      '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#f97316'
    ];

    serverVectors.forEach((layerData, idx) => {
      const id = String(layerData.id);
      const isVisible = layerData.visible !== false;
      const opacity = (layerData.opacity ?? 100) / 100;
      const color = colorPalette[idx % colorPalette.length];
      const geomType = (layerData.geometry_type || '').toUpperCase();

      // Smart Z-Index: Polygons base, LineStrings elevated, Points top
      let zIndex = 20 + idx;
      if (geomType.includes('POLYGON')) zIndex = 15 + idx;
      else if (geomType.includes('LINE')) zIndex = 35 + idx;
      else if (geomType.includes('POINT')) zIndex = 55 + idx;

      try {
        const createLayerStyle = () => (feature) => {
          const geom = feature ? feature.getGeometry() : null;
          const type = geom ? geom.getType().toUpperCase() : geomType;
          const isPoly = type.includes('POLYGON');
          const isLine = type.includes('LINE');
          const isLayerOutlined = !!layerData.outlineOnly;

          // Layer-specific Multi-Collector Edit Visualization check
          let isTargetEdit = false;
          let activeColor = null;

          if (layerData.viewEdits && feature) {
            const props = feature.getProperties() || {};
            const editorInfo = extractFeatureCollector(props);

            if (editorInfo.hasEdit) {
              const myUsername = (currentUser?.username || '').toLowerCase();
              const myId = currentUser?.id;
              const isMine = (
                (myId != null && (editorInfo.createdById === myId || editorInfo.updatedById === myId)) ||
                (myUsername && (
                  (editorInfo.createdByUsername || '').toLowerCase() === myUsername ||
                  (editorInfo.updatedByUsername || '').toLowerCase() === myUsername ||
                  (editorInfo.kmcEditor || '').toLowerCase() === myUsername
                ))
              );

              // Normalize selectedCollectors
              // Can be: ['all'], ['my_edits'], or array of collector keys, e.g. ['gopal', 'kush']
              let selected = layerData.selectedCollectors;
              if (!selected || (Array.isArray(selected) && selected.length === 0)) {
                if (layerData.editCollectorId) {
                  selected = [layerData.editCollectorId];
                } else {
                  selected = isAdmin ? ['all'] : ['my_edits'];
                }
              }

              if (!isAdmin || selected.includes('my_edits')) {
                // Highlighting logged-in user's edits
                if (isMine) {
                  isTargetEdit = true;
                  activeColor = getCollectorColor(myUsername || myId || 'my_edits');
                }
              } else if (selected.includes('all')) {
                // Highlighting all edits, each with their assigned distinct color!
                isTargetEdit = true;
                activeColor = getCollectorColor(editorInfo.key);
              } else {
                // Highlighting specific selected collectors with distinct colors
                const matchSelected = selected.some((sel) => {
                  const s = String(sel).toLowerCase();
                  return (
                    s === editorInfo.key ||
                    s === String(editorInfo.userId) ||
                    s === (editorInfo.username || '').toLowerCase() ||
                    s === (editorInfo.createdByUsername || '').toLowerCase() ||
                    s === (editorInfo.updatedByUsername || '').toLowerCase() ||
                    s === (editorInfo.kmcEditor || '').toLowerCase()
                  );
                });

                if (matchSelected) {
                  isTargetEdit = true;
                  activeColor = getCollectorColor(editorInfo.key);
                }
              }
            }
          }

          // HIGHLIGHT STYLING FOR EDITED FEATURES (Distinct color per collector, elevated Z-index, double casing)
          if (isTargetEdit && activeColor) {
            const casingColor = '#ffffff';
            const strokeColor = activeColor.stroke;
            const fillColor = activeColor.fill;
            const hexColor = activeColor.hex;

            if (isPoly) {
              return [
                new Style({
                  zIndex: 998,
                  stroke: new Stroke({ color: casingColor, width: 5.5 }),
                }),
                new Style({
                  zIndex: 999,
                  fill: new Fill({ color: fillColor }),
                  stroke: new Stroke({ color: strokeColor, width: 3.5 }),
                }),
              ];
            } else if (isLine) {
              return [
                new Style({
                  zIndex: 998,
                  stroke: new Stroke({ color: casingColor, width: 6.5 }),
                }),
                new Style({
                  zIndex: 999,
                  stroke: new Stroke({ color: strokeColor, width: 4.5 }),
                }),
              ];
            } else {
              return [
                new Style({
                  zIndex: 998,
                  image: new CircleStyle({
                    radius: 12,
                    fill: new Fill({ color: fillColor }),
                    stroke: new Stroke({ color: casingColor, width: 2 }),
                  }),
                }),
                new Style({
                  zIndex: 999,
                  image: new CircleStyle({
                    radius: 6.5,
                    fill: new Fill({ color: hexColor }),
                    stroke: new Stroke({ color: casingColor, width: 2.5 }),
                  }),
                }),
              ];
            }
          }

          // STANDARD LAYER STYLING
          if (isLayerOutlined && isPoly) {
            // Outline Mode: Display polygons as outline-only with 100% transparent interior
            return new Style({
              fill: new Fill({ color: 'rgba(0, 0, 0, 0)' }),
              stroke: new Stroke({ color: color, width: 2.8 }),
            });
          }

          if (isPoly) {
            return new Style({
              fill: new Fill({ color: `${color}33` }),
              stroke: new Stroke({ color: color, width: 2.5 }),
            });
          } else if (type.includes('LINE')) {
            return new Style({
              stroke: new Stroke({ color: color, width: 3 }),
            });
          } else {
            return new Style({
              image: new CircleStyle({
                radius: 6,
                fill: new Fill({ color: color }),
                stroke: new Stroke({ color: '#ffffff', width: 2 }),
              }),
            });
          }
        };

        if (!existingVectors[id]) {
          const source = new VectorSource();
          const vectorLayer = new VectorLayer({
            source,
            visible: isVisible,
            opacity: opacity,
            zIndex: zIndex,
            style: createLayerStyle(),
            updateWhileAnimating: false,
            updateWhileInteracting: false,
            renderBuffer: 200,
          });

          mapInstance.current.addLayer(vectorLayer);
          existingVectors[id] = { layer: vectorLayer, source };
        } else {
          existingVectors[id].layer.setVisible(isVisible);
          existingVectors[id].layer.setOpacity(opacity);
          existingVectors[id].layer.setZIndex(zIndex);
          existingVectors[id].layer.setStyle(createLayerStyle());
          existingVectors[id].layer.changed();
        }

        // Safely parse and add features only if valid and changed
        if (layerData.features && existingVectors[id]) {
          if (existingVectors[id].lastFeaturesRef !== layerData.features) {
            const source = existingVectors[id].source;
            source.clear();

            let geoJsonData = layerData.features;

            // Normalize: handle raw array of features, object with features, or FeatureCollection
            if (Array.isArray(geoJsonData)) {
              geoJsonData = { type: 'FeatureCollection', features: geoJsonData };
            } else if (geoJsonData && typeof geoJsonData === 'object') {
              if (!geoJsonData.type && Array.isArray(geoJsonData.features)) {
                geoJsonData = { ...geoJsonData, type: 'FeatureCollection' };
              }
            }

            if (
              geoJsonData &&
              (geoJsonData.type === 'FeatureCollection' ||
                geoJsonData.type === 'Feature' ||
                Array.isArray(geoJsonData.features))
            ) {
              const featureList = Array.isArray(geoJsonData.features) ? geoJsonData.features : null;
              const isLargeLayer = featureList && featureList.length > 500;

              if (isLargeLayer) {
                // OPTIMIZED: Progressive chunked rendering for large layers (e.g. roads, buildings)
                const format = new GeoJSON();
                const CHUNK_SIZE = 500;
                let totalAdded = 0;

                const processChunk = (startIdx) => {
                  if (!existingVectors[id] || !existingVectors[id].source) return;
                  const currentSource = existingVectors[id].source;
                  const endIdx = Math.min(startIdx + CHUNK_SIZE, featureList.length);
                  const chunk = featureList.slice(startIdx, endIdx);

                  try {
                    const chunkCollection = { type: 'FeatureCollection', features: chunk };
                    const parsed = format.readFeatures(chunkCollection, {
                      dataProjection: 'EPSG:4326',
                      featureProjection: 'EPSG:3857',
                    });
                    const valid = getValidOlFeatures(parsed);
                    if (valid.length > 0) {
                      try {
                        currentSource.addFeatures(valid);
                      } catch (bulkErr) {
                        for (let i = 0; i < valid.length; i++) {
                          try { currentSource.addFeature(valid[i]); } catch (e) {}
                        }
                      }
                      totalAdded += valid.length;
                    }
                  } catch (chunkErr) {
                    for (const feat of chunk) {
                      try {
                        if (feat && feat.geometry && feat.geometry.coordinates && Array.isArray(feat.geometry.coordinates) && feat.geometry.coordinates.length > 0) {
                          const cleanFeat = {
                            type: 'Feature',
                            geometry: feat.geometry,
                            properties: { ...(feat.properties || {}) },
                          };
                          delete cleanFeat.properties.geometry;
                          delete cleanFeat.properties.the_geom;
                          const singleCollection = { type: 'FeatureCollection', features: [cleanFeat] };
                          const parsed = format.readFeatures(singleCollection, {
                            dataProjection: 'EPSG:4326',
                            featureProjection: 'EPSG:3857',
                          });
                          const valid = getValidOlFeatures(parsed);
                          for (const vf of valid) {
                            try { currentSource.addFeature(vf); totalAdded++; } catch (e) {}
                          }
                        }
                      } catch (e) {}
                    }
                  }

                  if (endIdx < featureList.length) {
                    requestAnimationFrame(() => processChunk(endIdx));
                  } else {
                    console.log(`[Map] Layer ${id}: progressively loaded ${totalAdded} features (chunked)`);
                  }
                };

                processChunk(0);
              } else {
                // STANDARD: Small layers — existing synchronous approach
                try {
                  const format = new GeoJSON();
                  const rawFeatures = format.readFeatures(geoJsonData, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: 'EPSG:3857',
                  });
                  const validFeatures = getValidOlFeatures(rawFeatures);
                  if (validFeatures.length > 0) {
                    try {
                      source.addFeatures(validFeatures);
                    } catch (bulkErr) {
                      console.warn(`[Map] Layer ${id}: Bulk addFeatures failed, inserting individually:`, bulkErr);
                      for (let i = 0; i < validFeatures.length; i++) {
                        try { source.addFeature(validFeatures[i]); } catch (e) {}
                      }
                    }
                    console.log(`[Map] Layer ${id}: loaded ${source.getFeatures().length} features successfully`);
                  } else {
                    console.warn(`[Map] Layer ${id}: GeoJSON parsed but 0 valid features`);
                  }
                } catch (parseErr) {
                  console.error(`[Map] Layer ${id}: GeoJSON parse error:`, parseErr);
                  // Attempt fallback: parse features one-by-one to skip bad ones
                  if (Array.isArray(geoJsonData.features)) {
                    const format = new GeoJSON();
                    let addedCount = 0;
                    for (const feat of geoJsonData.features) {
                      try {
                        if (feat && feat.geometry && feat.geometry.coordinates && Array.isArray(feat.geometry.coordinates) && feat.geometry.coordinates.length > 0) {
                          const cleanFeat = {
                            type: 'Feature',
                            geometry: feat.geometry,
                            properties: { ...(feat.properties || {}) },
                          };
                          delete cleanFeat.properties.geometry;
                          delete cleanFeat.properties.the_geom;

                          const singleCollection = { type: 'FeatureCollection', features: [cleanFeat] };
                          const parsed = format.readFeatures(singleCollection, {
                            dataProjection: 'EPSG:4326',
                            featureProjection: 'EPSG:3857',
                          });
                          const valid = getValidOlFeatures(parsed);
                          for (const vf of valid) {
                            try {
                              source.addFeature(vf);
                              addedCount++;
                            } catch (e) {}
                          }
                        }
                      } catch (e) {
                        // Skip malformed feature
                      }
                    }
                    console.log(`[Map] Layer ${id}: fallback parsed ${addedCount} features`);
                  }
                }
              }
            } else {
              console.warn(`[Map] Layer ${id}: unrecognized data format, type="${geoJsonData?.type}"`);
            }
            existingVectors[id].lastFeaturesRef = layerData.features;
          }
        }
      } catch (err) {
        console.warn(`[Map] Safely handled vector dataset rendering for layer ${id}:`, err);
      }
    });
  }, [serverVectors, olModules, editMode, currentUser, isAdmin]);

  // ---- Update Polygon Styles on Edit Mode Toggle (Outline-Only with Transparent Interior in Edit Mode) ----
  useEffect(() => {
    if (!mapInstance.current || !olModules) return;
    const existingVectors = layersRef.current.serverVectors;
    Object.values(existingVectors).forEach((entry) => {
      if (entry && entry.layer) {
        entry.layer.changed();
      }
    });
  }, [editMode, olModules]);

  // ---- Handle Zoom to Layer (Triggered by zoomTarget prop) ----
  useEffect(() => {
    if (!zoomTarget || !mapInstance.current || !olModules) return;
    const { transformExtent } = olModules;

    try {
      if (zoomTarget.type === 'vector') {
        const vectorObj = layersRef.current.serverVectors[String(zoomTarget.id)];
        if (vectorObj && vectorObj.source) {
          const extent = vectorObj.source.getExtent();
          if (isValidExtent(extent)) {
            mapInstance.current.getView().fit(extent, {
              padding: [80, 80, 80, 80],
              duration: 700,
              maxZoom: 19,
            });
          }
        }
      } else if (zoomTarget.type === 'raster') {
        if (zoomTarget.bounds && Array.isArray(zoomTarget.bounds) && zoomTarget.bounds.length === 4) {
          const extent = transformExtent(zoomTarget.bounds, 'EPSG:4326', 'EPSG:3857');
          if (isValidExtent(extent)) {
            mapInstance.current.getView().fit(extent, {
              padding: [80, 80, 80, 80],
              duration: 700,
              maxZoom: 20,
            });
          }
        } else {
          // Fallback: Query TileJSON from FastAPI endpoint
          fetch(`/api/tiles/${zoomTarget.id}/tilejson.json`)
            .then((res) => (res.ok ? res.json() : null))
            .then((tileJson) => {
              if (tileJson && tileJson.bounds && Array.isArray(tileJson.bounds)) {
                const extent = transformExtent(tileJson.bounds, 'EPSG:4326', 'EPSG:3857');
                if (isValidExtent(extent) && mapInstance.current) {
                  mapInstance.current.getView().fit(extent, {
                    padding: [80, 80, 80, 80],
                    duration: 700,
                    maxZoom: 20,
                  });
                }
              }
            })
            .catch((e) => console.log('Raster bounds query:', e));
        }
      } else if (zoomTarget.type === 'extent') {
        if (zoomTarget.bounds && Array.isArray(zoomTarget.bounds) && isValidExtent(zoomTarget.bounds)) {
          mapInstance.current.getView().fit(zoomTarget.bounds, {
            padding: [90, 90, 90, 90],
            duration: 600,
            maxZoom: 19,
          });
        }
      }
    } catch (err) {
      console.warn('[Map] Zoom to layer error:', err);
    }
  }, [zoomTarget, olModules]);

  // ---- Sync Inspected Feature Highlight from outside ----
  useEffect(() => {
    if (!featureHighlightSourceRef.current) return;
    if (!inspectedFeatureId) {
      inspectedFeatureRef.current = null;
      featureHighlightSourceRef.current.clear();
      return;
    }

    // Find the feature in visible vector layers and highlight it
    let found = false;
    Object.values(layersRef.current.serverVectors).forEach((vObj) => {
      if (found || !vObj || !vObj.source) return;
      const match = vObj.source.getFeatures().find((f) => {
        const fid = f.getId() || f.get('_id') || f.get('id');
        return String(fid) === String(inspectedFeatureId);
      });
      if (match) {
        found = true;
        inspectedFeatureRef.current = match;
        featureHighlightSourceRef.current.clear();
        featureHighlightSourceRef.current.addFeature(match.clone());
      }
    });
  }, [inspectedFeatureId, serverVectors]);

  // ---- Update task grids ----
  useEffect(() => {
    if (!olModules || !layersRef.current.taskSource) return;
    const { GeoJSON } = olModules;
    const source = layersRef.current.taskSource;
    source.clear();

    if (taskGrids && (taskGrids.type === 'FeatureCollection' || Array.isArray(taskGrids.features))) {
      try {
        const format = new GeoJSON();
        const rawFeatures = format.readFeatures(taskGrids, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        const validFeatures = getValidOlFeatures(rawFeatures);
        if (validFeatures.length > 0) {
          try {
            source.addFeatures(validFeatures);
          } catch (bulkErr) {
            console.warn('[Map] Bulk add task features failed, adding one by one:', bulkErr);
            for (let i = 0; i < validFeatures.length; i++) {
              try {
                source.addFeature(validFeatures[i]);
              } catch (e) {}
            }
          }

          if (mapInstance.current) {
            const extent = source.getExtent();
            if (isValidExtent(extent)) {
              mapInstance.current.getView().fit(extent, { padding: [60, 60, 60, 60], duration: 500, maxZoom: 18 });
            }
          }
        }
      } catch (err) {
        console.warn('[Map] Task grid parse notice:', err);
      }
    }
  }, [taskGrids, olModules]);

  // ---- Redraw task layer when selectedTask changes ----
  useEffect(() => {
    if (layersRef.current.taskLayer) {
      layersRef.current.taskLayer.changed();
    }
  }, [selectedTask]);

  // ---- Update Drawn Task Boundary Preview on Map ----
  useEffect(() => {
    if (!olModules || !layersRef.current.drawnBoundarySource) return;
    const { GeoJSON } = olModules;
    const source = layersRef.current.drawnBoundarySource;
    source.clear();

    if (drawnBoundary) {
      try {
        const format = new GeoJSON();
        const feat = format.readFeature(
          {
            type: 'Feature',
            geometry: drawnBoundary,
            properties: {},
          },
          { featureProjection: 'EPSG:3857' }
        );
        if (feat && feat.getGeometry()) {
          source.addFeature(feat);
          const extent = feat.getGeometry().getExtent();
          if (mapInstance.current && isValidExtent(extent)) {
            mapInstance.current.getView().fit(extent, { padding: [80, 80, 80, 80], duration: 400 });
          }
        }
      } catch (err) {
        console.warn('[Map] Drawn boundary preview error:', err);
      }
    }
  }, [drawnBoundary, olModules]);

  // ---- Update GPS position + accuracy circle ----
  useEffect(() => {
    if (!olModules || !layersRef.current.gpsSource || !gpsPosition) return;
    try {
      const { Feature, Point, Style, Fill, Stroke, CircleStyle, CircleGeom, fromLonLat } = olModules;
      const source = layersRef.current.gpsSource;
      source.clear();

      const coords = fromLonLat([gpsPosition.lng, gpsPosition.lat]);

      // GPS dot
      const gpsDot = new Feature({ geometry: new Point(coords) });
      gpsDot.setStyle(new Style({
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({ color: '#3478ff' }),
          stroke: new Stroke({ color: '#ffffff', width: 3 }),
        }),
      }));
      source.addFeature(gpsDot);

      // Accuracy Circle
      const accuracyCircle = new Feature({
        geometry: new CircleGeom(coords, gpsPosition.accuracy || 30),
      });
      accuracyCircle.setStyle(new Style({
        fill: new Fill({ color: 'rgba(52, 120, 255, 0.08)' }),
        stroke: new Stroke({ color: 'rgba(52, 120, 255, 0.35)', width: 1.5, lineDash: [6, 4] }),
      }));
      source.addFeature(accuracyCircle);
    } catch (err) {
      console.warn('[Map] GPS render notice:', err);
    }
  }, [gpsPosition, olModules]);

  // ---- Update Real-Time Data Collector Tracking Locations on Map (Dynamic Co-Location Spider Dispersal) ----
  useEffect(() => {
    if (!olModules || !layersRef.current.collectorTrackingSource) return;
    const { Feature, Point, LineString, CircleGeom, fromLonLat } = olModules;
    const source = layersRef.current.collectorTrackingSource;
    source.clear();

    if (!showCollectorLocations || !Array.isArray(collectorLocations) || collectorLocations.length === 0) {
      return;
    }

    try {
      // 1. Filter collectors with valid geographic coordinates
      const validCollectors = collectorLocations.filter(
        (col) => col.latitude !== null && col.longitude !== null && !isNaN(col.latitude) && !isNaN(col.longitude)
      );

      // 2. Spatial Clustering: Group co-located or near-identical coordinates (< 10 meters distance)
      const clusters = [];
      validCollectors.forEach((col) => {
        const coords = fromLonLat([col.longitude, col.latitude]);
        let matchedCluster = null;

        for (const cl of clusters) {
          const dx = cl.anchorCoords[0] - coords[0];
          const dy = cl.anchorCoords[1] - coords[1];
          // If within 10 meters in map projection units, group as co-located
          if (Math.hypot(dx, dy) < 10) {
            matchedCluster = cl;
            break;
          }
        }

        if (matchedCluster) {
          matchedCluster.collectors.push(col);
          if (col.accuracy) {
            matchedCluster.maxAccuracy = Math.max(matchedCluster.maxAccuracy || 0, col.accuracy);
          }
          if (col.is_online) {
            matchedCluster.hasOnline = true;
          }
        } else {
          clusters.push({
            anchorCoords: coords,
            collectors: [col],
            maxAccuracy: col.accuracy || 0,
            hasOnline: !!col.is_online,
          });
        }
      });

      // 3. Render Each Cluster (Single Collector vs. Co-located Multi-Collector Spider Dispersal)
      clusters.forEach((cluster) => {
        const N = cluster.collectors.length;
        const anchorCoords = cluster.anchorCoords;

        // Shared Accuracy Halo at true GPS position
        if (cluster.maxAccuracy > 0) {
          const accCircle = new Feature({
            geometry: new CircleGeom(anchorCoords, Math.min(cluster.maxAccuracy, 200)),
          });
          accCircle.set('isAccuracyCircle', true);
          accCircle.set('is_online', cluster.hasOnline);
          source.addFeature(accCircle);
        }

        if (N === 1) {
          // Exactly 1 Collector at this position
          const col = cluster.collectors[0];
          const markerFeat = new Feature({
            geometry: new Point(anchorCoords),
          });
          markerFeat.set('isCollectorMarker', true);
          markerFeat.set('name', col.full_name || col.username);
          markerFeat.set('username', col.username);
          markerFeat.set('is_online', !!col.is_online);
          markerFeat.set('collectorData', col);
          markerFeat.set('clusterMembers', cluster.collectors);
          markerFeat.set('clusterIndex', 0);
          markerFeat.set('clusterTotal', 1);
          source.addFeature(markerFeat);
        } else {
          // 2 or more Collectors co-located at the EXACT same location!
          // Dynamic Spider Dispersal radius based on number of officers
          const R = N === 2 ? 22 : (N <= 4 ? 26 : 32); // meters offset in EPSG:3857

          // Central anchor hub indicating shared location
          const hubFeat = new Feature({
            geometry: new Point(anchorCoords),
          });
          hubFeat.set('isCoLocationHub', true);
          hubFeat.set('clusterMembers', cluster.collectors);
          hubFeat.set('is_online', cluster.hasOnline);
          source.addFeature(hubFeat);

          // Disperse each officer radially around the anchor point
          cluster.collectors.forEach((col, idx) => {
            // Distribute angles evenly: for N=2 use diagonal -45 deg and +135 deg so labels never collide
            const angle = N === 2
              ? (idx === 0 ? -Math.PI / 4 : (3 * Math.PI) / 4)
              : ((2 * Math.PI * idx) / N) - Math.PI / 2;

            const offsetX = anchorCoords[0] + R * Math.cos(angle);
            const offsetY = anchorCoords[1] + R * Math.sin(angle);
            const dispersedCoords = [offsetX, offsetY];

            // Connector Spider Line from center to dispersed position
            if (LineString) {
              const lineFeat = new Feature({
                geometry: new LineString([anchorCoords, dispersedCoords]),
              });
              lineFeat.set('isSpiderLeg', true);
              lineFeat.set('is_online', !!col.is_online);
              source.addFeature(lineFeat);
            }

            // Dispersed Officer Marker
            const markerFeat = new Feature({
              geometry: new Point(dispersedCoords),
            });
            markerFeat.set('isCollectorMarker', true);
            markerFeat.set('isDispersed', true);
            markerFeat.set('name', col.full_name || col.username);
            markerFeat.set('username', col.username);
            markerFeat.set('is_online', !!col.is_online);
            markerFeat.set('collectorData', col);
            markerFeat.set('clusterMembers', cluster.collectors);
            markerFeat.set('clusterIndex', idx);
            markerFeat.set('clusterTotal', N);
            markerFeat.set('anchorCoords', anchorCoords);
            source.addFeature(markerFeat);
          });
        }
      });
    } catch (err) {
      console.warn('[Map] Collector tracking dispersal render notice:', err);
    }
  }, [collectorLocations, showCollectorLocations, olModules]);

  // ---- Handle Zoom Target (Center on Collector or Layer) ----
  useEffect(() => {
    if (!mapInstance.current || !zoomTarget || !olModules) return;
    const { fromLonLat } = olModules;
    try {
      if (zoomTarget.type === 'collector' && zoomTarget.lat && zoomTarget.lng) {
        mapInstance.current.getView().animate({
          center: fromLonLat([zoomTarget.lng, zoomTarget.lat]),
          zoom: 18,
          duration: 800,
        });
      }
    } catch (e) {
      console.warn('[Map] Zoom target notice:', e);
    }
  }, [zoomTarget, olModules]);

  // ---- Update Selected Feature Vertex Handles Display (Displays vertex handles ONLY for selected feature) ----
  useEffect(() => {
    if (!olModules || !layersRef.current.snappingVerticesSource) return;
    const { Feature, Point, Style, Circle: CircleStyle, Fill, Stroke } = olModules;
    const source = layersRef.current.snappingVerticesSource;

    // Only display vertex handles if editMode is active, a feature is selected, and snapping is enabled
    if (!editMode || !selectedFeatureId || !snappingEnabled) {
      source.clear();
      return;
    }

    try {
      const layerObj = layersRef.current.serverVectors[String(editLayerId)];
      if (!layerObj || !layerObj.source) {
        source.clear();
        return;
      }

      const match = layerObj.source.getFeatures().find((f) => {
        const fid = f.getId() || f.get('_id') || f.get('id');
        return String(fid) === String(selectedFeatureId);
      });

      if (match) {
        renderSelectedFeatureVertices(match, source, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);
      } else {
        source.clear();
      }
    } catch (err) {
      console.warn('[Map] Selected feature vertices display error:', err);
    }
  }, [editMode, editLayerId, selectedFeatureId, snappingEnabled, serverVectors, olModules]);

  // ---- Draw interaction with Real-time Vertex Handles and Undo/Redo Tracking ----
  useEffect(() => {
    if (!olModules || !mapInstance.current) return;
    const { Draw, Snap, GeoJSON, Style, Fill, Stroke, CircleStyle, Point, MultiPoint, Feature } = olModules;

    if (drawInteractionRef.current) {
      mapInstance.current.removeInteraction(drawInteractionRef.current);
      drawInteractionRef.current = null;
    }
    sketchFeatureRef.current = null;
    drawRedoStackRef.current = [];
    drawUndoCountRef.current = 0;
    if (onDrawVertexChange) {
      onDrawVertexChange({ undoCount: 0, redoCount: 0 });
    }

    if (drawMode) {
      try {
        // Safe dynamic style function for Draw interaction
        const drawStyle = (feature) => {
          try {
            const geom = feature ? feature.getGeometry() : null;
            if (!geom) return [];
            const type = geom.getType();
            const styles = [];

            // 1. Polygon Fill
            if (type === 'Polygon' || type === 'MultiPolygon') {
              styles.push(
                new Style({
                  fill: new Fill({ color: 'rgba(4, 71, 175, 0.25)' }),
                })
              );
            }

            // 2. Line / Polygon Boundary Stroke
            styles.push(
              new Style({
                stroke: new Stroke({
                  color: '#0447af',
                  width: 3,
                  lineDash: [6, 4],
                }),
              })
            );

            // 3. Point marker (if drawing a Point)
            if (type === 'Point') {
              styles.push(
                new Style({
                  image: new CircleStyle({
                    radius: 7,
                    fill: new Fill({ color: '#f59e0b' }),
                    stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
                  }),
                })
              );
              return styles;
            }

            // 4. Vertex handles for LineString and Polygon
            let coords = [];
            if (type === 'LineString') {
              coords = geom.getCoordinates() || [];
            } else if (type === 'Polygon') {
              const rings = geom.getCoordinates() || [];
              coords = rings[0] || [];
            }

            const validCoords = coords.filter(
              (c) => Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1])
            );

            if (validCoords.length > 0) {
              // Placed vertices in cyan
              styles.push(
                new Style({
                  geometry: new MultiPoint(validCoords),
                  image: new CircleStyle({
                    radius: 5.5,
                    fill: new Fill({ color: '#06b6d4' }),
                    stroke: new Stroke({ color: '#ffffff', width: 2 }),
                  }),
                })
              );

              // Active / latest placed vertex in glowing amber
              if (validCoords.length > 1) {
                const activeCoord = validCoords[validCoords.length - 2];
                if (activeCoord && activeCoord.length >= 2) {
                  styles.push(
                    new Style({
                      geometry: new Point(activeCoord),
                      image: new CircleStyle({
                        radius: 12,
                        stroke: new Stroke({ color: '#f59e0b', width: 2.5 }),
                        fill: new Fill({ color: 'rgba(245, 158, 11, 0.35)' }),
                      }),
                    }),
                    new Style({
                      geometry: new Point(activeCoord),
                      image: new CircleStyle({
                        radius: 6.5,
                        fill: new Fill({ color: '#f59e0b' }),
                        stroke: new Stroke({ color: '#ffffff', width: 2 }),
                      }),
                    })
                  );
                }
              }
            }

            return styles;
          } catch (err) {
            console.warn('[Map] drawStyle fallback:', err);
            return [
              new Style({
                stroke: new Stroke({ color: '#0447af', width: 3 }),
                fill: new Fill({ color: 'rgba(4, 71, 175, 0.25)' }),
                image: new CircleStyle({ radius: 6, fill: new Fill({ color: '#f59e0b' }) }),
              }),
            ];
          }
        };

        const drawInteraction = new Draw({
          type: drawMode,
          style: drawStyle,
        });

        drawInteraction.on('drawstart', (event) => {
          sketchFeatureRef.current = event.feature;
          drawRedoStackRef.current = [];
          const geom = event.feature.getGeometry();

          const updateCounts = () => {
            if (!sketchFeatureRef.current) return;
            const curGeom = sketchFeatureRef.current.getGeometry();
            if (!curGeom) return;
            const type = curGeom.getType();
            let count = 0;
            if (type === 'LineString') {
              const coords = curGeom.getCoordinates();
              count = Math.max(0, coords.length - 1);
            } else if (type === 'Polygon') {
              const rings = curGeom.getCoordinates();
              count = Math.max(0, (rings[0]?.length || 0) - 2);
            }
            drawUndoCountRef.current = count;
            if (onDrawVertexChange) {
              onDrawVertexChange({ undoCount: count, redoCount: drawRedoStackRef.current.length });
            }
          };

          geom.on('change', updateCounts);
        });

        drawInteraction.on('drawend', (event) => {
          sketchFeatureRef.current = null;
          drawRedoStackRef.current = [];
          drawUndoCountRef.current = 0;
          if (onDrawVertexChange) {
            onDrawVertexChange({ undoCount: 0, redoCount: 0 });
          }

          const format = new GeoJSON();
          const geojson = JSON.parse(
            format.writeFeature(event.feature, { featureProjection: 'EPSG:3857' })
          );

          // Spatial & Vertex Snapping Link Detection across visible vector layers
          let linkedInfo = null;
          try {
            const drawnGeom = event.feature.getGeometry();
            if (drawnGeom && layersRef.current.serverVectors) {
              const drawnExtent = drawnGeom.getExtent();
              const drawnCoords = extractCoordinatesFromGeometry(drawnGeom);

              let bestMatch = null;
              let minDistance = Infinity;

              const vectorEntries = Object.entries(layersRef.current.serverVectors);
              for (const [layerIdStr, layerObj] of vectorEntries) {
                if (!layerObj || !layerObj.layer || !layerObj.layer.getVisible() || !layerObj.source) continue;
                const lId = parseInt(layerIdStr);
                const layerDef = (serverVectors || []).find((v) => v.id === lId);
                const layerName = layerDef?.name || `Layer_${lId}`;

                layerObj.source.forEachFeatureInExtent(drawnExtent, (feat) => {
                  const featGeom = feat.getGeometry();
                  if (!featGeom) return;

                  // 1. Exact vertex snap match
                  const featCoords = extractCoordinatesFromGeometry(featGeom);
                  for (const dc of drawnCoords) {
                    for (const fc of featCoords) {
                      const d = Math.hypot(dc[0] - fc[0], dc[1] - fc[1]);
                      if (d < minDistance) {
                        minDistance = d;
                        bestMatch = {
                          layerId: lId,
                          layerName: layerName,
                          feature: feat,
                          distance: d,
                          type: 'snap_vertex',
                        };
                      }
                    }
                  }

                  // 2. Spatial intersection match if no close vertex snap
                  if (minDistance > 5 && featGeom.intersectsExtent(drawnExtent)) {
                    if (!bestMatch || bestMatch.type !== 'snap_vertex') {
                      bestMatch = {
                        layerId: lId,
                        layerName: layerName,
                        feature: feat,
                        distance: 0,
                        type: 'intersects',
                      };
                    }
                  }
                });
              }

              if (bestMatch && bestMatch.feature) {
                const feat = bestMatch.feature;
                const featProps = feat.getProperties ? feat.getProperties() : (feat.properties || {});
                const cleanProps = { ...featProps };
                delete cleanProps.geometry;
                delete cleanProps.geom;

                const fid = feat.getId ? feat.getId() : (feat.get ? feat.get('_id') : featProps._id || featProps.id);

                linkedInfo = {
                  layerId: bestMatch.layerId,
                  layerName: bestMatch.layerName,
                  featureId: fid,
                  properties: cleanProps,
                  matchType: bestMatch.type,
                };
              }
            }
          } catch (err) {
            console.warn('[Map] Link detection on draw end error:', err);
          }

          if (onFeatureCreate) {
            onFeatureCreate(geojson.geometry, linkedInfo);
          }
        });

        mapInstance.current.addInteraction(drawInteraction);
        drawInteractionRef.current = drawInteraction;

        // Add Snapping interactions for all visible vector layers that allow snapping
        const isDrawTargetSnappable = !activeLayerId || isLayerSnappable(activeLayerId);
        if (snappingEnabled && Snap && isDrawTargetSnappable) {
          Object.entries(layersRef.current.serverVectors).forEach(([id, obj]) => {
            if (obj && obj.layer && obj.layer.getVisible() && obj.source && isLayerSnappable(id)) {
              const snapInt = new Snap({
                source: obj.source,
                pixelTolerance: snapTolerance || 15,
                edge: true,
                vertex: true,
              });
              mapInstance.current.addInteraction(snapInt);
              snapInteractionsRef.current.push(snapInt);
            }
          });
        }
      } catch (err) {
        console.warn('[Map] Draw interaction notice:', err);
      }
    }

    return () => {
      if (mapInstance.current) {
        if (drawInteractionRef.current) {
          mapInstance.current.removeInteraction(drawInteractionRef.current);
          drawInteractionRef.current = null;
        }
        if (snapInteractionsRef.current && snapInteractionsRef.current.length > 0) {
          snapInteractionsRef.current.forEach((int) => {
            mapInstance.current.removeInteraction(int);
          });
          snapInteractionsRef.current = [];
        }
      }
      sketchFeatureRef.current = null;
      drawRedoStackRef.current = [];
      drawUndoCountRef.current = 0;
      if (onDrawVertexChange) {
        onDrawVertexChange({ undoCount: 0, redoCount: 0 });
      }
    };
  }, [drawMode, olModules, onFeatureCreate, onDrawVertexChange, snappingEnabled, snapTolerance, serverVectors]);

  // Pause/Resume Draw interaction during map feature picking mode
  useEffect(() => {
    if (drawInteractionRef.current) {
      drawInteractionRef.current.setActive(!pickLinkedFeatureMode);
    }
  }, [pickLinkedFeatureMode]);

  // Highlight Selected Linked Feature on Map Canvas (Vibrant Purple Halo)
  useEffect(() => {
    if (!olModules || !featureHighlightSourceRef.current) return;
    const { Style, Stroke, Fill, CircleStyle } = olModules;

    if (!selectedLinkedFeatureId || !selectedLinkedLayerId) {
      if (!inspectedFeatureId) {
        featureHighlightSourceRef.current.clear();
      }
      return;
    }

    const layerObj = layersRef.current.serverVectors[String(selectedLinkedLayerId)];
    if (layerObj && layerObj.source) {
      const feat = layerObj.source.getFeatures().find((f) => {
        const fid = f.getId ? f.getId() : (f.get ? f.get('_id') : f.get('id'));
        return String(fid) === String(selectedLinkedFeatureId);
      });

      if (feat && feat.getGeometry()) {
        featureHighlightSourceRef.current.clear();
        const clone = feat.clone();
        clone.setStyle([
          new Style({
            stroke: new Stroke({ color: '#9333ea', width: 4.5 }),
            fill: new Fill({ color: 'rgba(147, 51, 234, 0.25)' }),
            image: new CircleStyle({
              radius: 8,
              fill: new Fill({ color: '#9333ea' }),
              stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
            }),
          }),
          new Style({
            stroke: new Stroke({ color: '#c084fc', width: 2, lineDash: [6, 4] }),
          }),
        ]);
        featureHighlightSourceRef.current.addFeature(clone);
      }
    }
  }, [selectedLinkedFeatureId, selectedLinkedLayerId, olModules, inspectedFeatureId]);

  // ---- Handle Draw Undo Trigger ----
  useEffect(() => {
    if (!drawUndoTrigger || !drawMode || !drawInteractionRef.current || !sketchFeatureRef.current) return;
    try {
      const geom = sketchFeatureRef.current.getGeometry();
      if (!geom) return;
      const type = geom.getType();

      if (type === 'LineString') {
        const coords = geom.getCoordinates();
        if (coords.length > 1) {
          const removed = coords[coords.length - 2];
          drawRedoStackRef.current.push(removed);
        }
      } else if (type === 'Polygon') {
        const rings = geom.getCoordinates();
        if (rings[0] && rings[0].length > 2) {
          const removed = rings[0][rings[0].length - 3];
          drawRedoStackRef.current.push(removed);
        }
      }

      drawInteractionRef.current.removeLastPoint();

      let count = 0;
      if (type === 'LineString') {
        const curCoords = geom.getCoordinates();
        count = Math.max(0, curCoords.length - 1);
      } else if (type === 'Polygon') {
        const curRings = geom.getCoordinates();
        count = Math.max(0, (curRings[0]?.length || 0) - 2);
      }
      drawUndoCountRef.current = count;
      if (onDrawVertexChange) {
        onDrawVertexChange({ undoCount: count, redoCount: drawRedoStackRef.current.length });
      }
    } catch (err) {
      console.warn('[Map] Draw undo error:', err);
    }
  }, [drawUndoTrigger, drawMode, onDrawVertexChange]);

  // ---- Handle Draw Redo Trigger ----
  useEffect(() => {
    if (!drawRedoTrigger || !drawMode || !sketchFeatureRef.current || drawRedoStackRef.current.length === 0) return;
    try {
      const geom = sketchFeatureRef.current.getGeometry();
      if (!geom) return;
      const type = geom.getType();
      const redoPoint = drawRedoStackRef.current.pop();
      if (!redoPoint) return;

      if (type === 'LineString') {
        const coords = geom.getCoordinates().slice();
        if (coords.length > 0) {
          coords.splice(coords.length - 1, 0, redoPoint);
          geom.setCoordinates(coords);
        }
      } else if (type === 'Polygon') {
        const rings = geom.getCoordinates().slice();
        if (rings.length > 0 && rings[0].length > 0) {
          const outerRing = rings[0].slice();
          outerRing.splice(outerRing.length - 2, 0, redoPoint);
          rings[0] = outerRing;
          geom.setCoordinates(rings);
        }
      }

      sketchFeatureRef.current.changed();

      let count = 0;
      if (type === 'LineString') {
        count = Math.max(0, geom.getCoordinates().length - 1);
      } else if (type === 'Polygon') {
        const rings = geom.getCoordinates();
        count = Math.max(0, (rings[0]?.length || 0) - 2);
      }
      drawUndoCountRef.current = count;
      if (onDrawVertexChange) {
        onDrawVertexChange({ undoCount: count, redoCount: drawRedoStackRef.current.length });
      }
    } catch (err) {
      console.warn('[Map] Draw redo error:', err);
    }
  }, [drawRedoTrigger, drawMode, onDrawVertexChange]);

  // ---- Edit Mode: Feature Selection & Spatial Modification ----
  useEffect(() => {
    if (!olModules || !mapInstance.current) return;
    const { Select, Modify, GeoJSON, Style, Fill, Stroke, CircleStyle, Feature, Point } = olModules;

    // Clean up previous edit interactions
    if (selectInteractionRef.current) {
      mapInstance.current.removeInteraction(selectInteractionRef.current);
      selectInteractionRef.current = null;
    }
    if (modifyInteractionRef.current) {
      mapInstance.current.removeInteraction(modifyInteractionRef.current);
      modifyInteractionRef.current = null;
    }

    if (!editMode || !editLayerId) {
      selectedOlFeatureRef.current = null;
      if (snapIndicatorSourceRef.current) {
        snapIndicatorSourceRef.current.clear();
      }
      return;
    }

    const layerObj = layersRef.current.serverVectors[String(editLayerId)];
    if (!layerObj || !layerObj.layer) return;

    try {
      // 1. Setup Select Interaction
      // Note: Condition returns false for default click handling because our map singleclick listener
      // handles both feature selection and canvas feature-extension without losing selection!
      const selectInteraction = new Select({
        layers: [layerObj.layer],
        condition: () => false,
        style: (feature) => {
          const geom = feature ? feature.getGeometry() : null;
          const geomType = geom ? geom.getType().toUpperCase() : '';
          const isPolygon = geomType.includes('POLYGON');

          return [
            new Style({
              stroke: new Stroke({ color: 'rgba(245, 158, 11, 0.45)', width: 8 }),
            }),
            new Style({
              fill: isPolygon ? new Fill({ color: 'rgba(0, 0, 0, 0)' }) : new Fill({ color: 'rgba(245, 158, 11, 0.25)' }),
              stroke: new Stroke({ color: '#f59e0b', width: 3.5 }),
              image: new CircleStyle({
                radius: 7,
                fill: new Fill({ color: '#f59e0b' }),
                stroke: new Stroke({ color: '#ffffff', width: 2 }),
              }),
            }),
          ];
        },
      });

      // 2. Setup Modify Interaction attached to selected features collection with red handle styling & vertex deletion support
      const modifyInteraction = new Modify({
        features: selectInteraction.getFeatures(),
        pixelTolerance: Math.max(snapTolerance, 15),
        deleteCondition: (e) => {
          const sub = editSubModeRef.current;
          if (sub === 'tane' || sub === 'modify' || sub === 'bistar' || sub === 'extend') {
            return false;
          }
          return e.originalEvent && (e.originalEvent.altKey || e.originalEvent.shiftKey || e.originalEvent.ctrlKey);
        },
        style: [
          // Outer luminous red halo for dragging handles
          new Style({
            image: new CircleStyle({
              radius: 12,
              stroke: new Stroke({ color: '#ef4444', width: 2.5 }),
              fill: new Fill({ color: 'rgba(239, 68, 68, 0.3)' }),
            }),
          }),
          // Inner red handle dot
          new Style({
            image: new CircleStyle({
              radius: 6,
              fill: new Fill({ color: '#dc2626' }),
              stroke: new Stroke({ color: '#ffffff', width: 2 }),
            }),
          }),
        ],
      });

      // Track modify start
      modifyInteraction.on('modifystart', (evt) => {
        const mapEvt = evt.mapBrowserEvent;
        const isEditSnappable = isLayerSnappable(editLayerId);
        if (mapEvt && snapIndicatorSourceRef.current && mapInstance.current && snappingEnabled && isEditSnappable) {
          const visibleSources = Object.entries(layersRef.current.serverVectors)
            .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible() && obj.source && isLayerSnappable(id))
            .map(([_, obj]) => obj.source);
          const res = findNearestVertex(mapInstance.current, mapEvt.pixel, visibleSources, Math.max(snapTolerance, 25));
          if (res) {
            snapIndicatorSourceRef.current.clear();
            snapIndicatorSourceRef.current.addFeature(new Feature({ geometry: new Point(res.coordinate) }));
          }
        }
      });

      // 3. Handle modify end (spatial drag completed)
      modifyInteraction.on('modifyend', (evt) => {
        isModifyingRef.current = true;
        if (modifyTimerRef.current) clearTimeout(modifyTimerRef.current);
        modifyTimerRef.current = setTimeout(() => {
          isModifyingRef.current = false;
        }, 200);

        const modifiedFeatures = evt.features.getArray();
        if (modifiedFeatures && modifiedFeatures.length > 0) {
          const feat = modifiedFeatures[0];
          const mapEvt = evt.mapBrowserEvent;

          if (mapEvt && mapEvt.coordinate) {
            const hit = findVertexIndexNearCoord(feat, mapEvt.coordinate, 50);
            if (hit) {
              selectedVertexIndexRef.current = hit.index;
            }
          }

          if (layersRef.current.snappingVerticesSource && olModules) {
            const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke } = olModules;
            renderSelectedFeatureVertices(feat, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);
          }

          const format = new GeoJSON();
          const geojson = JSON.parse(
            format.writeFeature(feat, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857',
            })
          );

          const featureId = feat.getId() || feat.get('_id') || geojson.id || geojson.properties?._id;

          // Check if modified geometry is within assigned task grid
          let isWithin = true;
          if (isCollectorRef.current && layersRef.current.taskSource) {
            const gridFeatures = layersRef.current.taskSource.getFeatures();
            if (gridFeatures && gridFeatures.length > 0) {
              const featGeom = feat.getGeometry();
              if (featGeom) {
                const featExtent = featGeom.getExtent();
                isWithin = gridFeatures.some((g) => g.getGeometry() && g.getGeometry().intersectsExtent(featExtent));
              }
            }
          }

          if (isCollectorRef.current && !isWithin && onFeatureBlockedRef.current) {
            onFeatureBlockedRef.current({
              reason: 'OUTSIDE_GRID',
              message: '⚠️ चेतावनी: परिमार्जित भाग तपाईंको कार्यक्षेत्र (ग्रिड) भन्दा बाहिर पुगेको छ। कृपया ग्रिड भित्रै सीमित राख्नुहोस्।',
            });
          }

          if (onFeatureModifyEnd) {
            onFeatureModifyEnd(featureId, geojson.geometry, isWithin);
          }
        }
      });

      mapInstance.current.addInteraction(selectInteraction);
      mapInstance.current.addInteraction(modifyInteraction);

      // Deactivate modify drag if in bistar or metne mode
      if (editSubMode === 'bistar' || editSubMode === 'extend' || editSubMode === 'metne' || editSubMode === 'deleteVertex') {
        modifyInteraction.setActive(false);
      }

      selectInteractionRef.current = selectInteraction;
      modifyInteractionRef.current = modifyInteraction;

      // Sync if feature was already selected
      if (selectedFeatureId && layerObj.source) {
        const features = layerObj.source.getFeatures();
        const match = features.find((f) => {
          const fid = f.getId() || f.get('_id') || f.get('id');
          return String(fid) === String(selectedFeatureId);
        });
        if (match) {
          // Check grid boundary & GPS 50m geofence for Data Collector
          let allowed = true;
          if (isCollectorRef.current) {
            const gps = gpsPositionRef.current;
            if (!gps || gps.lat == null || gps.lng == null) {
              allowed = false;
            } else if (layersRef.current.taskSource) {
              const gridFeatures = layersRef.current.taskSource.getFeatures();
              if (gridFeatures && gridFeatures.length > 0) {
                const featGeom = match.getGeometry();
                if (featGeom) {
                  const featExtent = featGeom.getExtent();
                  allowed = gridFeatures.some((g) => g.getGeometry() && g.getGeometry().intersectsExtent(featExtent));
                }
              }
            }

            if (allowed && olModules?.GeoJSON) {
              const format = new olModules.GeoJSON();
              const geojsonObj = JSON.parse(format.writeFeature(match, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
              const dist = getDistanceToGeoJsonGeometry(gps.lat, gps.lng, geojsonObj.geometry);
              if (dist > GEOFENCE_EDIT_RADIUS_METERS) {
                allowed = false;
              }
            }
          }
          if (allowed) {
            selectedOlFeatureRef.current = match;
            const coords = extractCoordinatesFromGeometry(match.getGeometry());
            selectedVertexIndexRef.current = Math.max(0, coords.length - 1);
            selectInteraction.getFeatures().clear();
            selectInteraction.getFeatures().push(match);

            if (layersRef.current.snappingVerticesSource && olModules) {
              const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke } = olModules;
              renderSelectedFeatureVertices(match, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Map] Edit interaction setup error:', err);
    }

    return () => {
      if (mapInstance.current) {
        if (selectInteractionRef.current) {
          mapInstance.current.removeInteraction(selectInteractionRef.current);
          selectInteractionRef.current = null;
        }
        if (modifyInteractionRef.current) {
          mapInstance.current.removeInteraction(modifyInteractionRef.current);
          modifyInteractionRef.current = null;
        }
      }
      if (layersRef.current.snappingVerticesSource) {
        layersRef.current.snappingVerticesSource.clear();
      }
      if (featureHighlightSourceRef.current) {
        featureHighlightSourceRef.current.clear();
      }
      if (snapIndicatorSourceRef.current) {
        snapIndicatorSourceRef.current.clear();
      }
    };
  }, [editMode, editLayerId, olModules, serverVectors, onFeatureModifyEnd, snapTolerance, snappingEnabled]);

  // ---- Sync Selected Feature when selectedFeatureId prop changes ----
  useEffect(() => {
    if (!editMode || !editLayerId || !layersRef.current.serverVectors[String(editLayerId)]) {
      selectedOlFeatureRef.current = null;
      selectedVertexIndexRef.current = null;
      if (selectInteractionRef.current) {
        selectInteractionRef.current.getFeatures().clear();
      }
      if (layersRef.current.snappingVerticesSource) {
        layersRef.current.snappingVerticesSource.clear();
      }
      if (featureHighlightSourceRef.current) {
        featureHighlightSourceRef.current.clear();
      }
      return;
    }

    const layerObj = layersRef.current.serverVectors[String(editLayerId)];
    if (!layerObj || !layerObj.source || !selectInteractionRef.current || !olModules) return;

    if (!selectedFeatureId) {
      selectedOlFeatureRef.current = null;
      selectedVertexIndexRef.current = null;
      selectInteractionRef.current.getFeatures().clear();
      if (layersRef.current.snappingVerticesSource) {
        layersRef.current.snappingVerticesSource.clear();
      }
      if (featureHighlightSourceRef.current) {
        featureHighlightSourceRef.current.clear();
      }
    } else {
      const features = layerObj.source.getFeatures();
      const match = features.find((f) => {
        const fid = f.getId() || f.get('_id') || f.get('id');
        return String(fid) === String(selectedFeatureId);
      });
      if (match) {
        let allowed = true;
        if (isCollectorRef.current) {
          const gps = gpsPositionRef.current;
          if (!gps || gps.lat == null || gps.lng == null) {
            allowed = false;
          } else if (olModules?.GeoJSON) {
            const format = new olModules.GeoJSON();
            const geojsonObj = JSON.parse(format.writeFeature(match, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
            const dist = getDistanceToGeoJsonGeometry(gps.lat, gps.lng, geojsonObj.geometry);
            if (dist > GEOFENCE_EDIT_RADIUS_METERS) {
              allowed = false;
            }
          }
        }

        if (allowed) {
          selectedOlFeatureRef.current = match;
          const coords = extractCoordinatesFromGeometry(match.getGeometry());
          selectedVertexIndexRef.current = Math.max(0, coords.length - 1);

          selectInteractionRef.current.getFeatures().clear();
          selectInteractionRef.current.getFeatures().push(match);

          if (layersRef.current.snappingVerticesSource && olModules) {
            const { Point, Feature, Style, Circle: CircleStyle, Fill, Stroke } = olModules;
            renderSelectedFeatureVertices(match, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);
          }
        } else {
          selectedOlFeatureRef.current = null;
          selectedVertexIndexRef.current = null;
          selectInteractionRef.current.getFeatures().clear();
          if (layersRef.current.snappingVerticesSource) {
            layersRef.current.snappingVerticesSource.clear();
          }
          if (featureHighlightSourceRef.current) {
            featureHighlightSourceRef.current.clear();
          }
        }
      } else {
        selectedOlFeatureRef.current = null;
        selectedVertexIndexRef.current = null;
        selectInteractionRef.current.getFeatures().clear();
        if (layersRef.current.snappingVerticesSource) {
          layersRef.current.snappingVerticesSource.clear();
        }
        if (featureHighlightSourceRef.current) {
          featureHighlightSourceRef.current.clear();
        }
      }
    }
  }, [selectedFeatureId, editMode, editLayerId, snappingEnabled, olModules]);

  // ---- Sync External Geometry Update (Undo / Redo / Revert / Pop Vertex) to OpenLayers Feature ----
  useEffect(() => {
    if (!geometryUpdateTrigger || !olModules || !mapInstance.current) return;
    const { GeoJSON, Point, Feature, Style, Circle: CircleStyle, Fill, Stroke } = olModules;
    const { featureId, geometry } = geometryUpdateTrigger;

    if (selectedOlFeatureRef.current && geometry) {
      const curId =
        selectedOlFeatureRef.current.getId() ||
        selectedOlFeatureRef.current.get('_id') ||
        selectedOlFeatureRef.current.get('id');
      if (!featureId || String(curId) === String(featureId)) {
        try {
          const format = new GeoJSON();
          const readGeom = format.readGeometry(geometry, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857',
          });
          selectedOlFeatureRef.current.setGeometry(readGeom);
          selectedOlFeatureRef.current.changed();

          const coords = extractCoordinatesFromGeometry(readGeom);
          selectedVertexIndexRef.current = Math.max(0, coords.length - 1);

          if (selectInteractionRef.current) {
            selectInteractionRef.current.getFeatures().clear();
            selectInteractionRef.current.getFeatures().push(selectedOlFeatureRef.current);
          }

          if (layersRef.current.snappingVerticesSource) {
            renderSelectedFeatureVertices(selectedOlFeatureRef.current, layersRef.current.snappingVerticesSource, Point, Feature, Style, CircleStyle, Fill, Stroke, selectedVertexIndexRef.current);
          }

          if (modifyInteractionRef.current) {
            modifyInteractionRef.current.setActive(false);
            modifyInteractionRef.current.setActive(true);
          }
        } catch (err) {
          console.warn('[Map] Geometry update trigger notice:', err);
        }
      }
    }
  }, [geometryUpdateTrigger, snappingEnabled, olModules]);

  // ---- Sync Multi-Layer Snapping Interactions in Edit Mode & Draw Mode ----
  useEffect(() => {
    if (!mapInstance.current || !olModules) return;
    const { Snap } = olModules;

    // Remove existing snap interactions
    snapInteractionsRef.current.forEach((snap) => {
      try {
        mapInstance.current.removeInteraction(snap);
      } catch (e) {}
    });
    snapInteractionsRef.current = [];

    const currentTargetId = drawMode ? activeLayerId : (editMode ? editLayerId : null);
    const isTargetSnappable = !currentTargetId || isLayerSnappable(currentTargetId);

    if ((editMode || drawMode) && snappingEnabled && isTargetSnappable) {
      const visibleSources = Object.entries(layersRef.current.serverVectors)
        .filter(([id, obj]) => obj && obj.layer && obj.layer.getVisible() && obj.source && isLayerSnappable(id))
        .map(([_, obj]) => obj.source);

      visibleSources.forEach((source) => {
        try {
          const snapInt = new Snap({
            source,
            pixelTolerance: snapTolerance,
            vertex: true,
            edge: true,
          });
          mapInstance.current.addInteraction(snapInt);
          snapInteractionsRef.current.push(snapInt);
        } catch (e) {
          console.warn('[Map] Snap interaction attach notice:', e);
        }
      });
    }

    return () => {
      if (mapInstance.current) {
        snapInteractionsRef.current.forEach((snap) => {
          try {
            mapInstance.current.removeInteraction(snap);
          } catch (e) {}
        });
        snapInteractionsRef.current = [];
      }
    };
  }, [editMode, drawMode, activeLayerId, editLayerId, snappingEnabled, snapTolerance, serverVectors, olModules, isLayerSnappable]);

  // ---- Fly to GPS ----
  const flyToGPS = useCallback(() => {
    if (!mapInstance.current || !gpsPosition || !olModules) return;
    const { fromLonLat } = olModules;
    try {
      mapInstance.current.getView().animate({
        center: fromLonLat([gpsPosition.lng, gpsPosition.lat]),
        zoom: 18,
        duration: 800,
      });
    } catch (e) {
      console.warn('[Map] Fly to GPS notice:', e);
    }
  }, [gpsPosition, olModules]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full map-container" id="kmc-map" />

      {/* Government Map Quick Controls (Bottom Left) */}
      <div className="absolute bottom-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.75rem))] left-3 flex flex-col gap-1.5 z-20">
        <button
          id="gps-center-btn"
          onClick={flyToGPS}
          className="w-9 h-9 rounded-md bg-white hover:bg-gov-blue-50 text-gov-blue-800 border border-slate-300
                     flex items-center justify-center transition-all shadow-md group"
          title="वर्तमान जीपीएस स्थानमा जानुहोस् (Center on GPS)"
        >
          <Navigation className="w-4.5 h-4.5 group-hover:scale-110 transition-transform" />
        </button>

        <button
          id="reset-north-btn"
          onClick={() => {
            if (mapInstance.current) {
              mapInstance.current.getView().animate({ rotation: 0, duration: 400 });
            }
          }}
          className="w-9 h-9 rounded-md bg-white hover:bg-gov-blue-50 text-gov-blue-800 border border-slate-300
                     flex items-center justify-center transition-all shadow-md group"
          title="उत्तरतिर रिसेट गर्नुहोस् (Reset to North)"
        >
          <Compass
            className="w-4.5 h-4.5 group-hover:scale-110 transition-transform"
            style={{ transform: `rotate(${-mapRotation}rad)` }}
          />
        </button>

        <button
          id="fit-extent-btn"
          onClick={() => {
            if (mapInstance.current && layersRef.current.taskSource) {
              const extent = layersRef.current.taskSource.getExtent();
              if (isValidExtent(extent)) {
                mapInstance.current.getView().fit(extent, { padding: [60, 60, 60, 60], duration: 500 });
              }
            }
          }}
          className="w-9 h-9 rounded-md bg-white hover:bg-gov-blue-50 text-gov-blue-800 border border-slate-300
                     flex items-center justify-center transition-all shadow-md group"
          title="कार्य ग्रिड क्षेत्रमा जुम गर्नुहोस् (Fit to Tasks)"
        >
          <Maximize className="w-4.5 h-4.5 group-hover:scale-110 transition-transform" />
        </button>
      </div>

      {/* Collector Info Popup Card (When GisAdmin clicks a collector marker) */}
      {inspectedCollector && (
        <div className="absolute top-4 right-4 z-40 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-300 p-4 w-80 max-w-[calc(100vw-32px)] font-sans animate-slide-up">
          {/* Multi-officer Co-Location Switcher Header */}
          {inspectedCollectorCluster.length > 1 && (
            <div className="bg-gov-blue-50 border border-gov-blue-200/90 rounded-xl p-2 mb-2.5 text-xs font-nepali space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between text-gov-blue-950 font-bold text-[11px]">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-gov-blue-800" />
                  <span>यस साझा स्थानमा {inspectedCollectorCluster.length} जना संकलकहरू</span>
                </span>
                <span className="text-[10px] bg-gov-blue-200 text-gov-blue-900 px-1.5 py-0.5 rounded font-mono font-bold">
                  {clusterMemberIndex + 1} / {inspectedCollectorCluster.length}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const prevIdx = (clusterMemberIndex - 1 + inspectedCollectorCluster.length) % inspectedCollectorCluster.length;
                    setClusterMemberIndex(prevIdx);
                    setInspectedCollector(inspectedCollectorCluster[prevIdx]);
                  }}
                  className="p-1 rounded bg-white hover:bg-gov-blue-100 border border-gov-blue-200 text-gov-blue-800 shadow-xs flex items-center justify-center transition-colors shrink-0"
                  title="अघिल्लो संकलक"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
                  {inspectedCollectorCluster.map((col, cIdx) => (
                    <button
                      key={col.user_id}
                      type="button"
                      onClick={() => {
                        setClusterMemberIndex(cIdx);
                        setInspectedCollector(col);
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold truncate flex-1 transition-all ${
                        cIdx === clusterMemberIndex
                          ? 'bg-gov-blue-800 text-white shadow-xs'
                          : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      {col.full_name ? col.full_name.split(' ')[0] : col.username}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = (clusterMemberIndex + 1) % inspectedCollectorCluster.length;
                    setClusterMemberIndex(nextIdx);
                    setInspectedCollector(inspectedCollectorCluster[nextIdx]);
                  }}
                  className="p-1 rounded bg-white hover:bg-gov-blue-100 border border-gov-blue-200 text-gov-blue-800 shadow-xs flex items-center justify-center transition-colors shrink-0"
                  title="पछिल्लो संकलक"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <div className="flex items-start justify-between pb-2.5 border-b border-slate-100">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                inspectedCollector.is_online ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-400' : 'bg-slate-100 text-slate-700'
              }`}>
                {inspectedCollector.full_name ? inspectedCollector.full_name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="min-w-0">
                <div className="font-bold text-slate-900 text-sm font-nepali truncate">
                  {inspectedCollector.full_name || inspectedCollector.username}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  @{inspectedCollector.username}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setInspectedCollector(null);
                setInspectedCollectorCluster([]);
              }}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="py-2.5 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 text-[11px] font-nepali">स्थिति (Status):</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                inspectedCollector.is_online
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-700'
              }`}>
                <span className={`w-2 h-2 rounded-full ${inspectedCollector.is_online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                <span>{inspectedCollector.is_online ? 'सक्रिय (Online)' : `बन्द (${inspectedCollector.minutes_ago !== null && inspectedCollector.minutes_ago !== undefined ? `${inspectedCollector.minutes_ago} मिनेट अघि` : 'Offline'})`}</span>
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 text-[11px] font-nepali">जीपीएस स्थान (GPS):</span>
              <span className="font-mono text-[10px] text-slate-800 font-bold">
                {inspectedCollector.latitude?.toFixed(6)}°N, {inspectedCollector.longitude?.toFixed(6)}°E
              </span>
            </div>

            {inspectedCollector.accuracy && (
              <div className="flex items-center justify-between">
                <span className="text-slate-500 text-[11px] font-nepali">शुद्धता (Accuracy):</span>
                <span className="font-mono text-[10px] text-slate-700">
                  ±{inspectedCollector.accuracy.toFixed(1)}m
                </span>
              </div>
            )}

            {inspectedCollector.assigned_projects?.length > 0 && (
              <div className="pt-1 border-t border-slate-100">
                <span className="text-slate-500 text-[10px] block mb-1 font-nepali">तोकिएका परियोजनाहरू:</span>
                <div className="flex flex-wrap gap-1">
                  {inspectedCollector.assigned_projects.map((p) => (
                    <span key={p.id} className="px-1.5 py-0.5 bg-gov-blue-50 text-gov-blue-800 rounded text-[10px] font-nepali font-semibold">
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {inspectedCollector.active_task && (
              <div className="bg-amber-50 p-2 rounded-lg border border-amber-200 text-[11px] text-amber-900 font-nepali">
                हाल कार्य भइरहेको ग्रिड: <strong>ग्रिड #{inspectedCollector.active_task.grid_index}</strong>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100 flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (mapInstance.current && olModules && inspectedCollector.latitude && inspectedCollector.longitude) {
                  const { fromLonLat } = olModules;
                  mapInstance.current.getView().animate({
                    center: fromLonLat([inspectedCollector.longitude, inspectedCollector.latitude]),
                    zoom: 18,
                    duration: 600,
                  });
                }
              }}
              className="flex-1 bg-gov-blue-800 hover:bg-gov-blue-900 text-white text-[11px] font-bold py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all font-nepali"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>केन्द्रमा देखाउनुहोस्</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Coordinates & Government System Ribbon with Live GPS */}
      <div className="absolute bottom-0 left-0 right-0 min-h-[1.5rem] bg-slate-900/95 text-slate-300 backdrop-blur-sm border-t border-slate-700/60 px-3 flex items-center justify-between text-[10px] z-20 font-sans pb-[env(safe-area-inset-bottom,0px)]">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-gov-gold-400 font-nepali">काठमाडौँ महानगरपालिका</span>
          <span className="text-slate-500 hidden sm:inline">|</span>
          <span className="text-slate-400 font-mono hidden md:inline">CRS: EPSG:3857 (WGS 84)</span>
        </div>

        <div className="flex items-center gap-3 font-sans">
          {gpsPosition ? (
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono">{gpsPosition.lat.toFixed(6)}°N, {gpsPosition.lng.toFixed(6)}°E</span>
              <span className="text-slate-400 hidden sm:inline">(±{gpsPosition.accuracy?.toFixed(1) || '?'}m)</span>
            </div>
          ) : (
            <div className="text-slate-500 hidden sm:inline">जीपीएस निष्क्रिय (GPS Off)</div>
          )}
        </div>
      </div>

      {!olLoaded && (
        <div className="absolute inset-0 bg-slate-100 flex items-center justify-center z-30">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-gov-blue-800 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-700 text-xs font-semibold font-nepali">काठमाडौँ महानगर नक्सा इन्जिन लोड हुँदैछ...</p>
          </div>
        </div>
      )}
    </div>
  );
}
