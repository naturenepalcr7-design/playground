'use client';

import { useState, useEffect } from 'react';
import {
  Info, X, Layers, MapPin, Edit3, Maximize2, Copy, Check,
  Calendar, Tag, Hash, FileText, Globe, Ruler, ExternalLink,
  ChevronDown, ChevronUp, Search, Sparkles, AlertTriangle,
  Link2, ArrowUpRight, Database, Loader2, Trash2, History
} from 'lucide-react';
import { featuresAPI } from '../lib/api';
import { getDistanceToGeoJsonGeometry, GEOFENCE_EDIT_RADIUS_METERS } from '../lib/geoDistance';

function formatDateTime(isoStr) {
  if (!isoStr) return 'उपलब्ध छैन';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('ne-NP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return isoStr;
  }
}

/**
 * Converts square meters into Ropani-Aana-Paisa-Daam (Nepal Standard Land Measurement)
 */
function formatNepaliLandArea(sqMeters) {
  if (!sqMeters || sqMeters <= 0) return null;
  const sqFt = sqMeters * 10.7639;

  // 1 Ropani = 508.72 sq.m = 5476 sq.ft (16 Aana)
  // 1 Aana = 31.80 sq.m = 342.25 sq.ft (4 Paisa)
  // 1 Paisa = 7.95 sq.m = 85.56 sq.ft (4 Daam)
  // 1 Daam = 1.99 sq.m = 21.39 sq.ft

  let remaining = sqMeters;
  const ropani = Math.floor(remaining / 508.72);
  remaining -= ropani * 508.72;

  const aana = Math.floor(remaining / 31.80);
  remaining -= aana * 31.80;

  const paisa = Math.floor(remaining / 7.95);
  remaining -= paisa * 7.95;

  const daam = (remaining / 1.99).toFixed(1);

  const rapdStr = `${ropani}-${aana}-${paisa}-${daam} (रोपनी-आना-पैसा-दाम)`;
  return {
    sqMeters: sqMeters.toFixed(2),
    sqFt: sqFt.toFixed(2),
    rapd: rapdStr,
  };
}

/**
 * Calculates approximate planar area of a GeoJSON Polygon in square meters (EPSG:3857 coordinates)
 */
function calculatePolygonArea(geometry) {
  if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) return 0;
  const ring = geometry.coordinates[0];
  if (ring.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    area += (p1[0] * p2[1]) - (p2[0] * p1[1]);
  }
  return Math.abs(area) / 2;
}

/**
 * Calculates approximate length of a GeoJSON LineString in meters (EPSG:3857 coordinates)
 */
function calculateLineLength(geometry) {
  if (!geometry || !geometry.coordinates || geometry.coordinates.length < 2) return 0;
  const coords = geometry.coordinates;
  let len = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    len += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  }
  return len;
}

export default function FeatureDetailsPanel({
  feature, // { id, layerId, layerName, geometryType, properties, geometry, extent }
  onClose,
  onEdit = null,
  onDelete = null,
  deleting = false,
  onZoomToFeature = null,
  onInspectLinkedFeature = null,
  gpsPosition = null,
  isCollector = false,
  user = null,
  isAdmin = false,
  onFeatureBlocked = null,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedField, setCopiedField] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [linkedData, setLinkedData] = useState([]);
  const [loadingLinked, setLoadingLinked] = useState(false);

  useEffect(() => {
    setShowDeleteConfirm(false);
  }, [feature?.id]);

  useEffect(() => {
    if (!feature?.id) return;
    let isCancelled = false;

    // Discover local linked properties
    const localLinkedProps = Object.entries(feature.properties || {})
      .filter(([k, v]) => k.endsWith('_linked_id') && v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => {
        const rawLayerName = k.replace(/_linked_id$/, '').replace(/_/g, ' ');
        return {
          attribute_name: k,
          target_id_value: v,
          layer_name: rawLayerName,
          layer_id: null,
          feature_id: typeof v === 'number' ? v : (String(v).match(/^\d+$/) ? parseInt(v, 10) : null),
          direction: 'outbound',
        };
      });

    setLinkedData(localLinkedProps);
    setLoadingLinked(true);

    featuresAPI.getLinked(feature.id)
      .then((res) => {
        if (!isCancelled && res.data?.linked_features) {
          setLinkedData(res.data.linked_features);
        }
      })
      .catch((err) => {
        console.error('[FeatureDetailsPanel] Error fetching linked features:', err);
      })
      .finally(() => {
        if (!isCancelled) setLoadingLinked(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [feature?.id, feature?.properties]);

  if (!feature) return null;

  const { id, layerName, geometryType, properties = {}, geometry, extent } = feature;

  // Calculate real-time distance from collector GPS to feature geometry
  const distToGps = (isCollector && gpsPosition?.lat != null && gpsPosition?.lng != null && geometry)
    ? getDistanceToGeoJsonGeometry(gpsPosition.lat, gpsPosition.lng, geometry)
    : null;

  const isOutsideGps50m = isCollector && (
    !gpsPosition ||
    gpsPosition.lat == null ||
    gpsPosition.lng == null ||
    distToGps === null ||
    distToGps > GEOFENCE_EDIT_RADIUS_METERS
  );

  // Ownership verification: GisAdmin can delete any feature; DataCollector can only delete features they created and saved
  const isCreator = Boolean(
    isAdmin ||
    (isCollector && (
      (properties?._created_by != null && user?.id != null && Number(properties._created_by) === Number(user.id)) ||
      (properties?.Kmc_Editor && user?.username && String(properties.Kmc_Editor).trim().toLowerCase() === String(user.username).trim().toLowerCase()) ||
      (feature?.created_by != null && user?.id != null && Number(feature.created_by) === Number(user.id))
    ))
  );
  const canDelete = Boolean(onDelete && (isAdmin || isCreator));

  // Filter out internal non-user properties
  const cleanEntries = Object.entries(properties).filter(
    ([k]) => !['geom', 'the_geom', 'geometry_type', '_id'].includes(k)
  );

  const filteredEntries = cleanEntries.filter(
    ([k, v]) =>
      k.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(v).toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Geometric measurements
  const geomTypeUpper = (geometryType || '').toUpperCase();
  const isPolygon = geomTypeUpper.includes('POLYGON');
  const isLine = geomTypeUpper.includes('LINE');
  const isPoint = geomTypeUpper.includes('POINT');

  let areaInfo = null;
  let lineLength = 0;

  if (isPolygon) {
    const areaSqM = calculatePolygonArea(geometry);
    areaInfo = formatNepaliLandArea(areaSqM);
  } else if (isLine) {
    lineLength = calculateLineLength(geometry);
  }

  const handleCopy = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard?.writeText(String(text));
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div
      className={`fixed left-0 right-0 bottom-0 sm:left-auto sm:right-4 sm:bottom-4 landscape:right-2 landscape:top-2 landscape:bottom-2 landscape:w-80 landscape:left-auto landscape:max-h-[calc(100dvh-16px)] landscape:rounded-xl landscape:border sm:absolute z-40 w-full sm:w-96 sm:max-w-md ${
        isCollapsed ? 'h-14 max-h-14' : 'h-[75dvh] max-h-[85dvh] sm:h-auto sm:max-h-[calc(100%-80px)]'
      } flex flex-col min-h-0 bg-white border-t sm:border border-gov-blue-300 rounded-t-2xl sm:rounded-xl shadow-2xl animate-slide-up overflow-hidden font-sans transition-all pb-[max(0.375rem,env(safe-area-inset-bottom,0px))]`}
      id="feature-details-panel"
    >
      {/* Header Banner with Layer Info & Action Buttons */}
      <div
        className="bg-gov-blue-800 text-white px-3.5 py-2 sm:py-2.5 flex flex-col shrink-0 select-none shadow-sm cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {/* Mobile Grab / Drag Handle Pill */}
        <div className="w-10 h-1 bg-white/40 rounded-full mx-auto mb-1.5 sm:hidden shrink-0" />

        <div className="flex items-center justify-between text-xs font-bold font-nepali w-full">
          <div className="flex items-center gap-2 truncate">
            <div className="w-6 h-6 rounded bg-gov-blue-700 border border-gov-blue-600 flex items-center justify-center text-gov-gold-400 shrink-0">
              {isPoint && <MapPin className="w-3.5 h-3.5" />}
              {isLine && <Ruler className="w-3.5 h-3.5" />}
              {isPolygon && <Layers className="w-3.5 h-3.5" />}
            </div>
            <div className="truncate text-left">
              <div className="flex items-center gap-1.5 leading-tight">
                <span className="truncate">{layerName || 'तह विशेषता'}</span>
                <span className="text-[10px] font-mono font-normal bg-gov-blue-900/90 text-gov-gold-300 px-1 py-0.2 rounded">
                  #{id}
                </span>
              </div>
              <span className="text-[9px] text-gov-blue-200 block font-normal leading-tight font-sans">
                {geometryType || 'Feature'} &bull; काठमाडौँ महानगर WebGIS
              </span>
              {isCollector && (
                <div className="mt-1 flex items-center gap-1">
                  {distToGps !== null ? (
                    <span
                      className={`text-[10px] font-sans font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs ${
                        distToGps <= GEOFENCE_EDIT_RADIUS_METERS
                          ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40'
                          : 'bg-rose-500/25 text-rose-200 border border-rose-400/40'
                      }`}
                    >
                      <MapPin className="w-2.5 h-2.5 shrink-0" />
                      <span>GPS दूरी: {Math.round(distToGps)}m {distToGps <= GEOFENCE_EDIT_RADIUS_METERS ? '(सम्पादन योग्य)' : '(५०m बाहिर)'}</span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-sans font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-500/25 text-amber-200 border border-amber-400/40 shadow-xs">
                      <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                      <span>GPS स्थान फेला परेन</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {onZoomToFeature && (
              <button
                type="button"
                onClick={() => onZoomToFeature(geometry, extent)}
                className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-1 rounded transition-colors"
                title="विशेषतामा जुम गर्नुहोस् (Zoom to Feature)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-1 rounded transition-colors"
              title={isCollapsed ? 'विस्तार गर्नुहोस्' : 'खुम्च्याउनुहोस्'}
            >
              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-1 rounded transition-colors"
              title="बन्द गर्नुहोस् (Close)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Body Content */}
      {!isCollapsed && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5 text-xs text-slate-800 overscroll-contain scrollbar-thin">
          {/* Edit History & Audit Metadata Card */}
          {(properties._created_by != null || properties._updated_by != null || properties.Kmc_Editor || (properties._version && properties._version > 1)) && (
            <div className="bg-gradient-to-r from-amber-50/90 to-amber-100/50 border border-amber-300 rounded-lg p-2.5 flex flex-col gap-1.5 text-[11px] shadow-xs">
              <div className="flex items-center justify-between text-amber-950 font-bold font-nepali">
                <span className="flex items-center gap-1">
                  <History className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span>सम्पादन विवरण (Edit Information):</span>
                </span>
                <span className={`px-2 py-0.2 rounded-full text-[9px] font-bold font-nepali border ${
                  (properties._version > 1 || properties._updated_by != null)
                    ? 'bg-cyan-100 text-cyan-900 border-cyan-300'
                    : 'bg-amber-100 text-amber-900 border-amber-300'
                }`}>
                  {(properties._version > 1 || properties._updated_by != null)
                    ? `परिमार्जित (v${properties._version || 2})`
                    : 'नयाँ सिर्जना (Created)'}
                </span>
              </div>

              <div className="space-y-1 text-slate-700 pl-1 text-[10px] font-nepali">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">फिचर आइडी:</span>
                  <span className="font-mono font-bold text-slate-800">#{id}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">तहको नाम:</span>
                  <span className="font-bold text-gov-blue-900">{layerName || `तह #${feature.layerId}`}</span>
                </div>
                {properties._created_by_username && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">सिर्जनाकर्ता:</span>
                    <span className="font-bold text-slate-800">
                      {properties._created_by_name ? `${properties._created_by_name} (@${properties._created_by_username})` : `@${properties._created_by_username}`}
                    </span>
                  </div>
                )}
                {properties.Kmc_Editor && !properties._created_by_username && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">डाटा संकलनकर्ता:</span>
                    <span className="font-bold text-slate-800">@{properties.Kmc_Editor}</span>
                  </div>
                )}
                {properties._created_at && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">सिर्जना मिति:</span>
                    <span className="font-mono text-slate-700">{formatDateTime(properties._created_at)}</span>
                  </div>
                )}
                {properties._updated_by_username && (
                  <div className="flex justify-between items-center pt-0.5 border-t border-amber-200/60">
                    <span className="text-slate-500">पछिल्लो परिमार्जन:</span>
                    <span className="font-bold text-cyan-900">
                      {properties._updated_by_name ? `${properties._updated_by_name} (@${properties._updated_by_username})` : `@${properties._updated_by_username}`}
                    </span>
                  </div>
                )}
                {properties._updated_at && properties._version > 1 && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">परिमार्जन मिति:</span>
                    <span className="font-mono text-slate-700">{formatDateTime(properties._updated_at)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Spatial Metrics Banner (Calculated Measurements) */}
          {(areaInfo || lineLength > 0 || (isPoint && geometry?.coordinates)) && (
            <div className="bg-gov-blue-50/70 border border-gov-blue-200/80 rounded-lg p-2 flex flex-col gap-1 text-[11px]">
              <div className="flex items-center justify-between text-gov-blue-900 font-bold font-nepali">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-gov-blue-700 shrink-0" />
                  <span>भौगोलिक मापन (Spatial Metrics):</span>
                </span>
              </div>

              {isPolygon && areaInfo && (
                <div className="space-y-0.5 text-slate-700 pl-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-nepali">क्षेत्रफल (वर्ग मिटर):</span>
                    <span className="font-mono font-bold text-gov-blue-950">{areaInfo.sqMeters} m²</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-nepali">क्षेत्रफल (वर्ग फिट):</span>
                    <span className="font-mono text-slate-800">{areaInfo.sqFt} sq.ft</span>
                  </div>
                  <div className="flex justify-between pt-0.5 border-t border-gov-blue-200/50">
                    <span className="text-gov-blue-900 font-bold font-nepali">नेपाली प्रणाली:</span>
                    <span className="font-nepali font-bold text-gov-red-700">{areaInfo.rapd}</span>
                  </div>
                </div>
              )}

              {isLine && lineLength > 0 && (
                <div className="space-y-0.5 text-slate-700 pl-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-nepali">लम्बाइ (मिटर):</span>
                    <span className="font-mono font-bold text-gov-blue-950">{lineLength.toFixed(2)} m</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-nepali">लम्बाइ (किलोमिटर / फिट):</span>
                    <span className="font-mono text-slate-800">
                      {(lineLength / 1000).toFixed(3)} km / {(lineLength * 3.28084).toFixed(1)} ft
                    </span>
                  </div>
                </div>
              )}

              {isPoint && geometry?.coordinates && (
                <div className="space-y-0.5 text-slate-700 pl-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-nepali">निर्देशाङ्क (Coordinates):</span>
                    <span className="font-mono font-bold text-gov-blue-950">
                      {geometry.coordinates[0]?.toFixed(5)}, {geometry.coordinates[1]?.toFixed(5)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Linked Features Section (सम्बन्धित फिचरहरू) */}
          {linkedData.length > 0 && (
            <div className="bg-purple-50/80 border border-purple-200 rounded-lg p-2.5 space-y-2 shadow-2xs animate-slide-up">
              <div className="flex items-center justify-between text-purple-950 font-bold font-nepali text-[11px]">
                <span className="flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-purple-700 shrink-0" />
                  <span>सम्बन्धित फिचरहरू (Linked Features):</span>
                </span>
                <span className="px-1.5 py-0.2 rounded-full bg-purple-200 text-purple-900 font-mono text-[9px]">
                  {linkedData.length} सम्बन्ध
                </span>
              </div>

              <div className="space-y-1.5">
                {linkedData.map((item, idx) => {
                  const targetName = item.layer_name || 'Target Layer';
                  const targetId = item.target_id_value;
                  const targetProps = item.properties || {};
                  const labelValue = targetProps.name || targetProps.parcel_id || targetProps.code || targetProps.title || null;

                  return (
                    <div
                      key={idx}
                      className="bg-white p-2 rounded-md border border-purple-200/80 flex items-center justify-between gap-2 text-[11px]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1 py-0.2 rounded text-[8.5px] font-bold ${
                            item.direction === 'inbound'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {item.direction === 'inbound' ? 'आन्तरिक' : 'लक्षित तह'}
                          </span>
                          <span className="font-bold text-slate-800 truncate font-nepali">
                            {targetName}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-600 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono bg-slate-100 px-1 py-0.2 rounded text-slate-700 font-semibold">
                            {item.attribute_name || 'linked_id'}: {String(targetId)}
                          </span>
                          {labelValue && (
                            <span className="text-slate-500 truncate max-w-[120px]">
                              ({labelValue})
                            </span>
                          )}
                        </div>
                      </div>

                      {onInspectLinkedFeature && (
                        <button
                          type="button"
                          onClick={() => onInspectLinkedFeature(item)}
                          className="px-2 py-1 rounded bg-purple-700 hover:bg-purple-800 text-white text-[10px] font-bold font-nepali flex items-center gap-1 shrink-0 shadow-2xs transition-colors"
                          title="नक्सामा हेर्नुहोस् र जुम गर्नुहोस् (View & Zoom)"
                        >
                          <ArrowUpRight className="w-3 h-3 text-gov-gold-400" />
                          <span>हेर्नुहोस्</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search attributes if list is long */}
          {cleanEntries.length > 5 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                placeholder="विशेषता खोज्नुहोस् (Filter attributes)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-md pl-7 pr-2 py-1 text-[11px] outline-none focus:border-gov-blue-800"
              />
            </div>
          )}

          {/* Attributes Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden shadow-xs">
            <div className="bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-700 font-nepali flex items-center justify-between border-b border-slate-200">
              <span className="flex items-center gap-1">
                <Tag className="w-3 h-3 text-slate-500" />
                <span>विशेषता सूची (Attributes List)</span>
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {filteredEntries.length} / {cleanEntries.length}
              </span>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="p-3 text-center text-[10px] text-slate-400 font-nepali">
                कुनै विशेषता फेला परेन (No attributes found)
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {filteredEntries.map(([key, value]) => {
                  const valStr = value === null || value === undefined ? '-' : String(value);
                  const isUrl = valStr.startsWith('http://') || valStr.startsWith('https://');

                  return (
                    <div
                      key={key}
                      className="px-2.5 py-1.5 flex items-start justify-between gap-2 hover:bg-gov-blue-50/40 transition-colors group text-[11px]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold text-slate-700 font-mono break-words leading-tight">
                          {key}
                        </div>
                        <div className="text-slate-800 break-words leading-snug mt-0.5">
                          {isUrl ? (
                            <a
                              href={valStr}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gov-blue-700 underline flex items-center gap-0.5 hover:text-gov-blue-900"
                            >
                              <span className="truncate">{valStr}</span>
                              <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                            </a>
                          ) : (
                            valStr
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopy(valStr, key)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-gov-blue-800 rounded hover:bg-slate-200/60 transition-all shrink-0"
                        title="प्रतिलिपि गर्नुहोस् (Copy)"
                      >
                        {copiedField === key ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sticky Action Buttons Bar */}
        <div className="p-2.5 sm:p-3 bg-slate-100/95 backdrop-blur-xs border-t border-slate-200 flex flex-col gap-2 shrink-0 sticky bottom-0 z-10 pb-[max(0.625rem,calc(env(safe-area-inset-bottom,0px)+0.375rem))]">
          {showDeleteConfirm ? (
            <div className="p-3 bg-gov-red-50 border border-gov-red-200 rounded-lg text-xs flex flex-col gap-2 animate-fade-in shadow-sm">
              <div className="flex items-center gap-1.5 text-gov-red-800 font-bold font-nepali">
                <AlertTriangle className="w-4 h-4 text-gov-red-700 shrink-0" />
                <span>के तपाईं यो सम्पूर्ण फिचर (#{id}) मेटाउन निश्चित हुनुहुन्छ?</span>
              </div>
              <p className="text-[10px] text-slate-600 font-nepali leading-relaxed">
                यो सम्पूर्ण फिचर प्रणालीबाट सधैंका लागि मेटिनेछ। यो कार्य फिर्ता गर्न सकिने छैन। (Are you sure you want to delete this feature? This action cannot be undone.)
              </p>
              <div className="flex justify-end gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="px-2.5 py-1 text-[11px] font-medium bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50 transition-colors shadow-xs"
                >
                  रद्द गर्नुहोस् (Cancel)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onDelete) {
                      onDelete(feature.id, feature.layerId);
                    }
                  }}
                  disabled={deleting}
                  className="px-3 py-1 text-[11px] font-bold bg-gov-red-700 hover:bg-gov-red-800 text-white rounded flex items-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95"
                >
                  {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  <span>{deleting ? 'मेटाउँदै...' : 'हो, मेटाउनुहोस् (Delete)'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {onEdit && (
                feature.isWithinAssignedGrid === false ? (
                  <div
                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold font-nepali flex items-center justify-center gap-1.5 shadow-xs select-none"
                    title="यो फिचर तपाईंलाई तोकिएको कार्यक्षेत्र (ग्रिड) भन्दा बाहिर भएकाले हेर्न मात्र मिल्छ।"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>कार्यक्षेत्र बाहिर (हेर्न मात्र मिल्ने)</span>
                  </div>
                ) : isOutsideGps50m ? (
                  <button
                    type="button"
                    onClick={() => {
                      const msg = (!gpsPosition || gpsPosition.lat == null)
                        ? '⚠️ GPS स्थान प्राप्त हुन सकेन। सम्पादन गर्न आफ्नो GPS सक्रिय गर्नुहोस् र ५० मिटर भित्र हुनुहोस्। (GPS location required. Must be within 50m to edit.)'
                        : `⚠️ तपाईं यो फिचरबाट ${Math.round(distToGps)} मिटर टाढा हुनुहुन्छ। सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ। सम्पादन मोड खोलिएन। (You are ${Math.round(distToGps)}m away from this feature. You must be within 50m to edit. Edit mode not opened.)`;
                      if (onFeatureBlocked) {
                        onFeatureBlocked({ reason: 'OUTSIDE_GPS_50M', message: msg });
                      } else {
                        alert(msg);
                      }
                    }}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 text-[10px] font-bold font-nepali flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer active:scale-98"
                    title={
                      (!gpsPosition || gpsPosition.lat == null)
                        ? 'GPS स्थान फेला परेन। सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ।'
                        : `फिचरबाट दूरी: ${Math.round(distToGps)}m (सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ)`
                    }
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>
                      {distToGps !== null
                        ? `५० मिटर बाहिर (${Math.round(distToGps)}m) - सम्पादन निषेधित`
                        : 'GPS आवश्यक (सम्पादन निषेधित)'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onEdit(feature.layerId, feature.id)}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-gov-blue-800 hover:bg-gov-blue-900 text-white text-[11px] font-bold font-nepali flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-98"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-gov-gold-400" />
                    <span>सम्पादन गर्नुहोस् (Edit Mode)</span>
                  </button>
                )
              )}

              {/* Option to Delete Entire Feature (for GisAdmin or the corresponding DataCollector) */}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleting}
                  className="py-1.5 px-3 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 hover:text-rose-800 text-[11px] font-bold font-nepali flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-98 shrink-0"
                  title="यो फिचर पूर्ण रूपमा मेटाउनुहोस् (Delete Entire Feature)"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>मेटाउनुहोस् (Delete)</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="py-1.5 px-3 rounded-lg bg-white hover:bg-slate-200 text-slate-700 border border-slate-300 text-[11px] font-bold font-nepali transition-colors shadow-xs"
              >
                बन्द (Close)
              </button>
            </div>
          )}
        </div>
      </>
    )}
  </div>
);
}
