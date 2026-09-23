'use client';

import { useState } from 'react';
import {
  Layers, Map, Satellite, Globe2, Image, ChevronDown, ChevronUp,
  Eye, EyeOff, Tag, Sliders, Database, MapPin, Maximize2, Ban, X, Edit3, Square, Link2,
  Download, Loader2, Users, Radio, Magnet, Sparkles, History, CheckCircle2,
  User, UserCheck, Check, Palette,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { layersAPI, tilesAPI, triggerFileDownload } from '../lib/api';
import { getCollectorColor, extractFeatureCollector, COLLECTOR_PALETTE } from '../lib/collectorPalette';

/**
 * LayerControl Component — Official Nepal Government WebGIS Standard
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 */
export default function LayerControl({
  isOpen,
  onToggle,
  activeBasemap,
  onBasemapChange,
  basemapOpacity = 100,
  onBasemapOpacityChange,
  // Server Raster (MBTiles)
  rasterLayers = [],
  onRasterToggle,
  onRasterOpacityChange,
  onZoomToRaster,
  // Server Vector (PostGIS)
  vectorLayers = [],
  onVectorToggle,
  onVectorOpacityChange,
  onZoomToVector,
  activeEditLayerId = null,
  onEditLayer = null,
  onVectorOutlineToggle = null,
  onOpenLinkLayers = null,
  collectorLocations = [],
  showCollectorLocations = false,
  onToggleCollectorLocations = null,
  onZoomToCollector = null,
  projects = [],
  onToggleLayerSnapping = null,
  onToggleViewEdits = null,
  onToggleMyEdits = null,
  onToggleCollectorInLayer = null,
  onSetLayerCollectors = null,
  onChangeEditCollector = null,
  onOpenLayerEditsModal = null,
  currentUser = null,
}) {
  const { isAdmin } = useAuth();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isControlled = isOpen !== undefined;
  const expanded = isControlled ? isOpen : internalExpanded;

  const [showTrackingSection, setShowTrackingSection] = useState(false);
  const [downloadingRasterId, setDownloadingRasterId] = useState(null);
  const [downloadingVectorId, setDownloadingVectorId] = useState(null);
  const [vectorDownloadModal, setVectorDownloadModal] = useState(null); // { layer: layerObj }

  const onlineCollectorsCount = Array.isArray(collectorLocations)
    ? collectorLocations.filter((c) => c.is_online).length
    : 0;

  // ---- Download MBTiles Raster Layer (GisAdmin only) ----
  const handleDownloadRaster = async (raster) => {
    if (!raster || !raster.id) return;
    try {
      setDownloadingRasterId(raster.id);
      const res = await tilesAPI.download(raster.id);
      const defaultFilename = raster.filename || `${(raster.name || 'tiles').replace(/[^a-zA-Z0-9_\-\.]/g, '_')}.mbtiles`;
      triggerFileDownload(res, defaultFilename);
    } catch (err) {
      console.error('[LayerControl] Error downloading MBTiles:', err);
      alert(err.response?.data?.detail || 'इमेज्री डाउनलोड गर्न सकिएन');
    } finally {
      setDownloadingRasterId(null);
    }
  };

  // ---- Download Vector Layer (GisAdmin only) ----
  const handleDownloadVector = async (layer, format = 'geojson') => {
    if (!layer || !layer.id) return;
    try {
      setDownloadingVectorId(layer.id);
      const res = await layersAPI.download(layer.id, format);
      const ext = format === 'shapefile' || format === 'shp' ? 'zip' : format;
      const defaultFilename = `${(layer.name || 'layer').replace(/[^a-zA-Z0-9_\-\.]/g, '_')}.${ext}`;
      triggerFileDownload(res, defaultFilename);
      setVectorDownloadModal(null);
    } catch (err) {
      console.error('[LayerControl] Error downloading layer:', err);
      alert(err.response?.data?.detail || 'तह डाउनलोड गर्न सकिएन');
    } finally {
      setDownloadingVectorId(null);
    }
  };

  const handleToggle = () => {
    if (isControlled) {
      if (onToggle) onToggle(!isOpen);
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };

  const handleClose = () => {
    if (isControlled) {
      if (onToggle) onToggle(false);
    } else {
      setInternalExpanded(false);
    }
  };

  const [showBasemaps, setShowBasemaps] = useState(false);
  const [showRasters, setShowRasters] = useState(false);
  const [showVectors, setShowVectors] = useState(false);

  const basemaps = [
    { id: 'osm', label: 'OSM नक्सा', icon: Map, color: 'text-gov-blue-800' },
    { id: 'esri', label: 'Esri Satellite', icon: Satellite, color: 'text-emerald-700' },
    { id: 'google', label: 'Google Earth', icon: Globe2, color: 'text-amber-600' },
    { id: 'none', label: 'कुनै पनि होइन', icon: Ban, color: 'text-gov-red-700' },
  ];

  return (
    <>
      {/* Mobile click-away backdrop */}
      {expanded && (
        <div
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-[1px] z-30 sm:hidden"
          onClick={handleClose}
        />
      )}

      <div className={`absolute top-3 right-3 ${expanded ? 'z-40' : 'z-20'} max-h-[calc(100dvh-75px)] flex flex-col items-end animate-fade-in`} id="layer-control-panel">
        {/* Main Government Toggle Button */}
        <button
          onClick={handleToggle}
          className="bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg p-2 sm:px-3 sm:py-2 flex items-center gap-2 shadow-md transition-all mb-1.5 shrink-0"
          title="तह व्यवस्थापन (GIS Layers)"
        >
          <div className="w-5 h-5 rounded bg-gov-blue-800 text-white flex items-center justify-center shrink-0">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div className="text-left hidden sm:block">
            <span className="text-xs font-bold text-gov-blue-900 block leading-tight font-nepali">
              तह व्यवस्थापन (GIS Layers)
            </span>
            <span className="text-[10px] text-slate-500 block leading-tight">
              {vectorLayers.length + rasterLayers.length} तहहरू उपलब्ध
            </span>
          </div>
          {expanded ?
            <ChevronUp className="w-4 h-4 text-slate-400" /> :
            <ChevronDown className="w-4 h-4 text-slate-400" />
          }
        </button>

        {expanded && (
          <div className="w-[360px] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-130px)] sm:max-h-[calc(100dvh-140px)] flex flex-col min-h-0 bg-white border border-slate-300 rounded-xl shadow-2xl text-slate-800 animate-slide-up overflow-hidden pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
            
            {/* Pinned Header Banner with Close Button */}
            <div className="bg-gov-blue-800 text-white px-3 py-2 flex items-center justify-between text-xs font-bold font-nepali shrink-0 shadow-sm">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-gov-gold-400" />
                भू-स्थानिक तह नियन्त्रण (Spatial Layers)
              </span>
              <button
                onClick={handleClose}
                className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-0.5 rounded transition-colors"
                title="बन्द गर्नुहोस् (Close)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="overflow-y-auto p-2.5 space-y-2 flex-1 min-h-0 overscroll-contain scrollbar-thin">

          {/* ========================================================= */}
          {/* 1. BASEMAPS SECTION */}
          {/* ========================================================= */}
          <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
            <button
              onClick={() => setShowBasemaps(!showBasemaps)}
              className="flex items-center justify-between w-full pb-1 text-xs font-bold text-slate-700 uppercase tracking-wider font-nepali"
            >
              <span className="flex items-center gap-1.5">
                <Map className="w-3.5 h-3.5 text-gov-blue-800" />
                आधारभूत नक्सा (Basemaps)
              </span>
              {showBasemaps ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </button>

            {showBasemaps && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {basemaps.map((bm) => {
                    const Icon = bm.icon;
                    const isSelected = activeBasemap === bm.id;
                    return (
                      <button
                        key={bm.id}
                        onClick={() => onBasemapChange(bm.id)}
                        className={`flex items-center gap-2 p-2 rounded-md text-xs transition-all border text-left
                          ${isSelected
                            ? 'bg-gov-blue-50 text-gov-blue-900 border-gov-blue-800 font-bold shadow-sm ring-1 ring-gov-blue-800'
                            : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200 font-medium'
                          }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isSelected ? bm.color : 'text-slate-400'}`} />
                        <span className="text-[11px] truncate w-full">{bm.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Basemap Opacity */}
                {activeBasemap !== 'none' && (
                  <div className="pt-2 border-t border-slate-200">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-1">
                      <span>नक्सा पारदर्शिता (Opacity)</span>
                      <span className="text-gov-blue-800 font-mono font-bold">{basemapOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={basemapOpacity}
                      onChange={(e) => onBasemapOpacityChange(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-gov-blue-800"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 1.5 DATA COLLECTOR REAL-TIME FLEET TRACKING */}
          {/* ========================================================= */}
          <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
            <div className="flex items-center justify-between w-full pb-1 text-xs font-bold text-slate-700 uppercase tracking-wider font-nepali">
              <button
                type="button"
                onClick={() => setShowTrackingSection(!showTrackingSection)}
                className="flex items-center gap-1.5 flex-1 text-left"
              >
                <Users className="w-3.5 h-3.5 text-emerald-700" />
                <span>फिल्ड संकलक ट्र्याकिङ ({onlineCollectorsCount} सक्रिय)</span>
                {showTrackingSection ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
              </button>

              {onToggleCollectorLocations && (
                <button
                  type="button"
                  onClick={onToggleCollectorLocations}
                  className="p-1 text-slate-400 hover:text-emerald-700 hover:bg-slate-100 rounded transition-colors"
                  title={showCollectorLocations ? 'ट्र्याकिङ नक्साबाट लुकाउनुहोस्' : 'ट्र्याकिङ नक्सामा देखाउनुहोस्'}
                >
                  {showCollectorLocations ? <Eye className="w-3.5 h-3.5 text-emerald-700" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                </button>
              )}
            </div>

            {showTrackingSection && (
              <div className="mt-2 space-y-1.5">
                {collectorLocations.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-1 text-center italic font-nepali">
                    कुनै संकलक दर्ता गरिएको छैन
                  </p>
                ) : (
                  collectorLocations.map((col) => (
                    <div
                      key={col.user_id}
                      className={`p-2 rounded-md border transition-all ${
                        col.is_online
                          ? 'bg-white border-emerald-200 shadow-xs'
                          : 'bg-slate-100 border-slate-200 opacity-75'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="relative">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
                              col.is_online ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-400' : 'bg-slate-200 text-slate-700'
                            }`}>
                              {col.full_name ? col.full_name.charAt(0).toUpperCase() : 'U'}
                            </div>
                            {col.is_online && (
                              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 animate-pulse ring-1 ring-white" />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-800 font-nepali truncate">
                              {col.full_name || col.username}
                            </div>
                            <div className="text-[10px] text-slate-500 font-nepali flex items-center gap-1">
                              <span className={col.is_online ? 'text-emerald-700 font-bold' : 'text-slate-500'}>
                                {col.is_online ? '🟢 सक्रिय (Active)' : (col.app_state === 'background' || col.app_state === 'inactive' ? '⚪ निष्क्रिय (Inactive)' : `⚪ ${col.minutes_ago !== null && col.minutes_ago !== undefined ? `${col.minutes_ago} मिनेट अघि` : 'निष्क्रिय (Inactive)'}`)}
                              </span>
                              {col.accuracy && (
                                <span>&middot; ±{col.accuracy.toFixed(0)}m</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {col.latitude && col.longitude && onZoomToCollector && (
                          <button
                            type="button"
                            onClick={() => onZoomToCollector(col)}
                            className="p-1 text-slate-400 hover:text-emerald-800 hover:bg-slate-100 rounded transition-colors shrink-0"
                            title="संकलकको स्थानमा जानुहोस् (Locate Collector)"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 2. SERVER RASTER (MBTILES / DRONE IMAGERY) */}
          {/* ========================================================= */}
          <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
            <button
              onClick={() => setShowRasters(!showRasters)}
              className="flex items-center justify-between w-full pb-1 text-xs font-bold text-slate-700 uppercase tracking-wider font-nepali"
            >
              <span className="flex items-center gap-1.5">
                <Image className="w-3.5 h-3.5 text-gov-blue-800" />
                ड्रोन तथा रास्टर इमेज्री ({rasterLayers.length})
              </span>
              {showRasters ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </button>

            {showRasters && (
              <div className="mt-2 space-y-1.5">
                {rasterLayers.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-1 text-center italic">
                    कुनै रास्टर तह अपलोड गरिएको छैन
                  </p>
                ) : (
                  rasterLayers.map((raster) => {
                    const isVisible = raster.visible !== false;
                    const opacity = raster.opacity ?? 100;
                    return (
                      <div
                        key={raster.id}
                        className={`p-2 rounded-md border transition-all ${
                          isVisible
                            ? 'bg-white border-gov-blue-200 shadow-sm'
                            : 'bg-slate-100 border-slate-200 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            onClick={() => onRasterToggle(raster.id)}
                            className="flex items-center gap-2 flex-1 text-left min-w-0"
                          >
                            {isVisible ? (
                              <Eye className="w-4 h-4 text-gov-blue-800 shrink-0" />
                            ) : (
                              <EyeOff className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <div className="truncate">
                              <span className="text-xs font-bold text-slate-800 truncate block">
                                {raster.name}
                              </span>
                              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                <span className={`px-1 py-0 rounded text-[9px] font-bold ${
                                  raster.is_global
                                    ? 'bg-purple-100 text-purple-800'
                                    : 'bg-amber-100 text-amber-900 border border-amber-200'
                                }`}>
                                  {raster.is_global
                                    ? 'महानगर तह (Global)'
                                    : `विशेष परियोजना: ${raster.project_name || projects.find((p) => p.id === raster.project_id)?.name || raster.project_id || 'परियोजना'}`}
                                </span>
                                {raster.file_size && (
                                  <span>&middot; {(raster.file_size / (1024 * 1024)).toFixed(1)} MB</span>
                                )}
                              </span>
                            </div>
                          </button>

                          <div className="flex items-center gap-0.5 shrink-0">
                            {isAdmin && (
                              <button
                                type="button"
                                disabled={downloadingRasterId === raster.id}
                                onClick={() => handleDownloadRaster(raster)}
                                className="p-1 text-slate-400 hover:text-emerald-800 hover:bg-slate-100 rounded transition-colors shrink-0"
                                title="रास्टर इमेज्री (.mbtiles) डाउनलोड गर्नुहोस्"
                              >
                                {downloadingRasterId === raster.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-800" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}

                            {onZoomToRaster && (
                              <button
                                onClick={() => onZoomToRaster(raster)}
                                className="p-1 text-slate-400 hover:text-gov-blue-800 hover:bg-slate-100 rounded transition-colors shrink-0"
                                title="तहमा जुम गर्नुहोस् (Zoom to layer)"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {isVisible && (
                          <div className="mt-1.5 pt-1.5 border-t border-slate-100">
                            <div className="flex items-center justify-between text-[10px] text-slate-600 mb-0.5">
                              <span>पारदर्शिता (Opacity)</span>
                              <span className="font-mono font-bold text-gov-blue-800">{opacity}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={opacity}
                              onChange={(e) => onRasterOpacityChange(raster.id, parseInt(e.target.value))}
                              className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-gov-blue-800"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* 3. SERVER VECTOR (POSTGIS / GEOJSON) */}
          {/* ========================================================= */}
          <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
            <button
              onClick={() => setShowVectors(!showVectors)}
              className="flex items-center justify-between w-full pb-1 text-xs font-bold text-slate-700 uppercase tracking-wider font-nepali"
            >
              <span className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-gov-blue-800" />
                भेक्टर तहहरू ({vectorLayers.length})
              </span>
              {showVectors ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </button>

            {showVectors && (
              <div className="mt-2 space-y-1.5">
                {vectorLayers.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-1 text-center italic">
                    कुनै भेक्टर तह उपलब्ध छैन
                  </p>
                ) : (
                  vectorLayers.map((layer) => {
                    const isVisible = layer.visible !== false;
                    const opacity = layer.opacity ?? 100;
                    return (
                      <div
                        key={layer.id}
                        className={`p-2 rounded-md border transition-all ${
                          isVisible
                            ? 'bg-white border-gov-blue-200 shadow-sm'
                            : 'bg-slate-100 border-slate-200 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            onClick={() => onVectorToggle(layer.id)}
                            className="flex items-center gap-2 flex-1 text-left min-w-0"
                          >
                            {isVisible ? (
                              <Eye className="w-4 h-4 text-emerald-700 shrink-0" />
                            ) : (
                              <EyeOff className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <div className="truncate">
                              <span className="text-xs font-bold text-slate-800 truncate block">
                                {layer.name}
                              </span>
                              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                <span className={`px-1 py-0 rounded text-[9px] font-bold ${
                                  layer.is_global
                                    ? 'bg-purple-100 text-purple-800'
                                    : 'bg-amber-100 text-amber-900 border border-amber-200'
                                }`}>
                                  {layer.is_global
                                    ? 'महानगर तह (Global)'
                                    : `विशेष परियोजना: ${layer.project_name || projects.find((p) => p.id === layer.project_id)?.name || layer.project_id || 'परियोजना'}`}
                                </span>
                                <span className="capitalize text-slate-600">
                                  &middot; {layer.geometry_type?.toLowerCase() || 'geom'}
                                </span>
                                {layer.feature_count !== undefined && (
                                  <span>&middot; {layer.feature_count} वस्तुहरू</span>
                                )}
                                <span className={`px-1 py-0 rounded text-[9px] font-bold inline-flex items-center gap-0.5 ${
                                  layer.allow_snapping !== false
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-rose-100 text-rose-800'
                                }`}>
                                  <Magnet className="w-2.5 h-2.5" />
                                  <span>{layer.allow_snapping !== false ? 'स्न्याप सक्षम' : 'स्न्याप बन्द'}</span>
                                </span>
                              </span>
                            </div>
                          </button>

                          <div className="flex items-center gap-0.5 shrink-0">
                            {/* Outline Only Toggle for Polygon Layers */}
                            {((layer.geometry_type || '').toUpperCase().includes('POLYGON') || (layer.features?.features && layer.features.features.some(f => f.geometry?.type?.toUpperCase().includes('POLYGON')))) && onVectorOutlineToggle && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onVectorOutlineToggle(layer.id);
                                }}
                                className={`p-1 rounded transition-colors ${
                                  layer.outlineOnly
                                    ? 'bg-amber-600 text-white font-bold shadow-xs ring-1 ring-amber-400'
                                    : 'text-slate-400 hover:text-amber-600 hover:bg-slate-100'
                                }`}
                                title={
                                  layer.outlineOnly
                                    ? 'आउटलाइन मोड सक्रिय (सिमाना मात्र) — रंग भर्न क्लिक गर्नुहोस्'
                                    : 'आउटलाइन मात्र मोड खोल्नुहोस् (सिमाना मात्र देखाउनुहोस्)'
                                }
                              >
                                <Square className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {onOpenLinkLayers && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenLinkLayers(layer);
                                }}
                                className="p-1 rounded text-slate-400 hover:text-gov-blue-800 hover:bg-slate-100 transition-colors"
                                title="फिचर सम्बन्ध कायम गर्नुहोस् (Link Features with another layer)"
                              >
                                <Link2 className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {onEditLayer && (
                              <button
                                onClick={() => onEditLayer(layer.id)}
                                className={`p-1 rounded transition-colors ${
                                  activeEditLayerId === layer.id
                                    ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-400'
                                    : 'text-slate-400 hover:text-amber-600 hover:bg-slate-100'
                                }`}
                                title="तह सम्पादन मोड खोल्नुहोस् (Edit Features)"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {isAdmin && onToggleLayerSnapping && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleLayerSnapping(layer.id, layer.allow_snapping === false);
                                }}
                                className={`p-1 rounded transition-colors ${
                                  layer.allow_snapping !== false
                                    ? 'text-emerald-700 hover:bg-emerald-50'
                                    : 'text-slate-400 hover:text-emerald-700 hover:bg-slate-100'
                                }`}
                                title={
                                  layer.allow_snapping !== false
                                    ? 'यस तहमा स्न्यापिङ बन्द गर्नुहोस् (Snapping Allowed — Click to Disable)'
                                    : 'यस तहमा स्न्यापिङ खोल्नुहोस् (Snapping Disabled — Click to Enable)'
                                }
                              >
                                <Magnet className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => setVectorDownloadModal({ layer })}
                                className="p-1 text-slate-400 hover:text-gov-blue-800 hover:bg-slate-100 rounded transition-colors"
                                title="तह डाउनलोड गर्नुहोस् (Download Layer Data)"
                              >
                                {downloadingVectorId === layer.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gov-blue-800" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}

                            {onZoomToVector && (
                              <button
                                onClick={() => onZoomToVector(layer)}
                                className="p-1 text-slate-400 hover:text-emerald-700 hover:bg-slate-100 rounded transition-colors"
                                title="तहमा जुम गर्नुहोस् (Zoom to layer)"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {isVisible && (
                          <div className="mt-1.5 pt-1.5 border-t border-slate-100">
                            <div className="flex items-center justify-between text-[10px] text-slate-600 mb-0.5">
                              <span>पारदर्शिता (Opacity)</span>
                              <span className="font-mono font-bold text-emerald-800">{opacity}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={opacity}
                              onChange={(e) => onVectorOpacityChange(layer.id, parseInt(e.target.value))}
                              className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-700"
                            />
                          </div>
                        )}

                        {/* View Edits Quick Toggle Bar & Expandable Filter Controls */}
                        {(() => {
                          // Collect all edited features on this layer
                          const layerFeats = layer.features?.features || [];
                          const editItems = layerFeats.filter((f) => {
                            const p = f.properties || {};
                            return p._created_by != null || p._updated_by != null || p.Kmc_Editor;
                          });

                          // Group by unique editor and assign distinct color
                          const collectorMap = {};
                          editItems.forEach((f) => {
                            const p = f.properties || {};
                            const info = extractFeatureCollector(p);
                            if (info.hasEdit && info.key) {
                              if (!collectorMap[info.key]) {
                                collectorMap[info.key] = {
                                  key: info.key,
                                  username: info.username,
                                  fullName: info.fullName || info.username || info.key,
                                  userId: info.userId,
                                  count: 0,
                                };
                              }
                              collectorMap[info.key].count++;
                            }
                          });

                          const uniqueLayerCollectors = Object.values(collectorMap).map((col, idx) => ({
                            ...col,
                            color: getCollectorColor(col.key, idx),
                          }));

                          // Normalize active selected collectors
                          let selected = layer.selectedCollectors;
                          if (!selected || (Array.isArray(selected) && selected.length === 0)) {
                            if (layer.editCollectorId) {
                              selected = [layer.editCollectorId];
                            } else {
                              selected = isAdmin ? ['all'] : ['my_edits'];
                            }
                          }
                          const isAll = selected.includes('all');
                          const isMyEditsActive = selected.length === 1 && selected.includes('my_edits');

                          const myUsername = (currentUser?.username || '').toLowerCase();
                          const myId = currentUser?.id;
                          const myColor = getCollectorColor(myUsername || myId || 'me');

                          // Filter currently highlighted items for counter
                          let highlightedItems = [];
                          if (layer.viewEdits) {
                            if (!isAdmin || isMyEditsActive) {
                              highlightedItems = editItems.filter((f) => {
                                const p = f.properties || {};
                                const info = extractFeatureCollector(p);
                                return (
                                  (myId != null && (info.createdById === myId || info.updatedById === myId)) ||
                                  (myUsername && (
                                    (info.createdByUsername || '').toLowerCase() === myUsername ||
                                    (info.updatedByUsername || '').toLowerCase() === myUsername ||
                                    (info.kmcEditor || '').toLowerCase() === myUsername
                                  ))
                                );
                              });
                            } else if (isAll) {
                              highlightedItems = editItems;
                            } else {
                              highlightedItems = editItems.filter((f) => {
                                const p = f.properties || {};
                                const info = extractFeatureCollector(p);
                                return selected.some((s) => {
                                  const target = String(s).toLowerCase();
                                  return (
                                    target === info.key ||
                                    target === String(info.userId) ||
                                    target === (info.username || '').toLowerCase() ||
                                    target === (info.createdByUsername || '').toLowerCase() ||
                                    target === (info.updatedByUsername || '').toLowerCase() ||
                                    target === (info.kmcEditor || '').toLowerCase()
                                  );
                                });
                              });
                            }
                          }

                          const myEditsCount = editItems.filter((f) => {
                            const p = f.properties || {};
                            const info = extractFeatureCollector(p);
                            return (
                              (myId != null && (info.createdById === myId || info.updatedById === myId)) ||
                              (myUsername && (
                                (info.createdByUsername || '').toLowerCase() === myUsername ||
                                (info.updatedByUsername || '').toLowerCase() === myUsername ||
                                (info.kmcEditor || '').toLowerCase() === myUsername
                              ))
                            );
                          }).length;

                          return (
                            <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex flex-col gap-1.5">
                              {/* Quick Action Buttons for Layer Edit Visualization */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {/* 1. "My Edits (मेरो सम्पादन)" Direct Button */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (onToggleMyEdits) {
                                      onToggleMyEdits(layer.id);
                                    } else if (onToggleViewEdits) {
                                      onToggleViewEdits(layer.id);
                                    }
                                  }}
                                  className={`flex-1 py-1 px-2 rounded-md text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all shadow-xs cursor-pointer ${
                                    layer.viewEdits && isMyEditsActive
                                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30 ring-1 ring-emerald-400 active:scale-98'
                                      : 'bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 hover:border-emerald-300 active:scale-98'
                                  }`}
                                  title="तपाईंले सम्पादन गर्नुभएका फिचरहरू मात्र नक्सामा हाइलाइट गर्नुहोस् (My Edits)"
                                >
                                  {layer.viewEdits && isMyEditsActive ? (
                                    <UserCheck className="w-3.5 h-3.5 text-emerald-100 animate-pulse" />
                                  ) : (
                                    <User className="w-3.5 h-3.5 text-slate-500" />
                                  )}
                                  <span>मेरो सम्पादन ({myEditsCount})</span>
                                </button>

                                {/* 2. Master "View Edits (सम्पादन दृश्य)" Button */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (onToggleViewEdits) onToggleViewEdits(layer.id);
                                  }}
                                  className={`flex-1 py-1 px-2 rounded-md text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all shadow-xs cursor-pointer ${
                                    layer.viewEdits && !isMyEditsActive
                                      ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/25 ring-1 ring-amber-400 active:scale-98'
                                      : 'bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300 active:scale-98'
                                  }`}
                                  title="यस तहका सम्पादित फिचरहरू सबै संकलक अनुसार हेर्नुहोस् (View Edits)"
                                >
                                  <Sparkles className={`w-3.5 h-3.5 ${layer.viewEdits && !isMyEditsActive ? 'text-amber-100 animate-pulse' : 'text-amber-600'}`} />
                                  <span>{layer.viewEdits && !isMyEditsActive ? 'दृश्य सक्रिय' : 'सम्पादन दृश्य'}</span>
                                </button>

                                {/* 3. Details Button */}
                                {onOpenLayerEditsModal && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenLayerEditsModal(layer);
                                    }}
                                    className="py-1 px-2 rounded-md text-[10px] font-bold font-nepali bg-white hover:bg-gov-blue-50 text-slate-600 hover:text-gov-blue-900 border border-slate-200 hover:border-gov-blue-300 shadow-xs transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                                    title="सम्पादन तालिका र विस्तृत रेकर्ड हेर्नुहोस्"
                                  >
                                    <History className="w-3 h-3 text-gov-blue-700" />
                                    <span>विवरण</span>
                                  </button>
                                )}
                              </div>

                              {/* Multi-Collector & Color Selection Sub-Panel */}
                              {layer.viewEdits && (
                                <div className="p-2 bg-gradient-to-b from-slate-50 to-amber-50/70 rounded-lg border border-amber-300/80 text-xs flex flex-col gap-2 shadow-xs animate-slide-up">
                                  {isAdmin ? (
                                    <div className="flex flex-col gap-1.5">
                                      {/* Preset Actions */}
                                      <div className="flex items-center justify-between gap-1 flex-wrap">
                                        <span className="text-[10px] text-slate-700 font-bold font-nepali flex items-center gap-1">
                                          <Palette className="w-3 h-3 text-amber-700" />
                                          <span>संकलक छनोट (अलग रङ):</span>
                                        </span>
                                        <div className="flex items-center gap-1 text-[9px] font-nepali">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (onSetLayerCollectors) onSetLayerCollectors(layer.id, ['all']);
                                            }}
                                            className={`px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                                              isAll
                                                ? 'bg-amber-600 text-white border-amber-600 font-bold'
                                                : 'bg-white text-slate-600 hover:bg-amber-50 border-slate-300'
                                            }`}
                                            title="सबै संकलकका सम्पादन फरक फरक रङमा हेर्नुहोस्"
                                          >
                                            सबै (बहुल-रङ)
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (onSetLayerCollectors) onSetLayerCollectors(layer.id, ['my_edits']);
                                            }}
                                            className={`px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                                              isMyEditsActive
                                                ? 'bg-emerald-600 text-white border-emerald-600 font-bold'
                                                : 'bg-white text-slate-600 hover:bg-emerald-50 border-slate-300'
                                            }`}
                                            title="मेरो सम्पादन मात्र देखाउनुहोस्"
                                          >
                                            मेरो मात्र
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (onSetLayerCollectors) onSetLayerCollectors(layer.id, []);
                                            }}
                                            className="px-1.5 py-0.5 rounded bg-white text-slate-500 hover:bg-slate-100 border border-slate-300 cursor-pointer"
                                            title="सबै छनोट खाली गर्नुहोस्"
                                          >
                                            हटाउनुहोस्
                                          </button>
                                        </div>
                                      </div>

                                      {/* Collector Chips / Pills */}
                                      {uniqueLayerCollectors.length === 0 ? (
                                        <div className="text-[10px] text-slate-500 italic font-nepali text-center py-1">
                                          यस तहमा कुनै सम्पादन फेला परेन
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-1 bg-white/90 rounded-md border border-slate-200">
                                          {uniqueLayerCollectors.map((c) => {
                                            const isSelected = isAll || selected.includes(c.key);
                                            return (
                                              <button
                                                key={c.key}
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (onToggleCollectorInLayer) {
                                                    onToggleCollectorInLayer(layer.id, c.key);
                                                  }
                                                }}
                                                style={{
                                                  backgroundColor: isSelected ? c.color.bg : '#ffffff',
                                                  borderColor: isSelected ? c.color.stroke : '#e2e8f0',
                                                  color: isSelected ? c.color.text : '#475569',
                                                }}
                                                className={`px-1.5 py-0.5 rounded-md border text-[10px] font-nepali flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                                                  isSelected ? 'ring-1' : 'hover:border-slate-400'
                                                }`}
                                                title={`${c.fullName} का सम्पादनहरू नक्सामा हाइलाइट/अन-हाइलाइट गर्नुहोस्`}
                                              >
                                                <span
                                                  style={{ backgroundColor: c.color.hex }}
                                                  className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-xs ring-1 ring-black/10"
                                                />
                                                <span className="font-semibold truncate max-w-[110px]">{c.fullName}</span>
                                                <span
                                                  style={{ backgroundColor: isSelected ? c.color.hex : '#f1f5f9', color: isSelected ? '#ffffff' : '#64748b' }}
                                                  className="text-[9px] px-1 py-0.2 rounded-full font-mono font-bold"
                                                >
                                                  {c.count}
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}

                                      {/* Visual Color Legend Bar */}
                                      <div className="bg-white/80 p-1.5 rounded-md border border-slate-200 text-[9.5px] font-nepali flex items-center justify-between flex-wrap gap-1">
                                        <div className="flex items-center gap-1 text-slate-700 font-bold">
                                          <span>रङ सङ्केत (Legend):</span>
                                          {isAll ? (
                                            <span className="text-amber-700 font-normal">प्रत्येक संकलकको आफ्नै रङ</span>
                                          ) : isMyEditsActive ? (
                                            <span className="flex items-center gap-1 text-emerald-700 font-normal">
                                              <span style={{ backgroundColor: myColor.hex }} className="w-2 h-2 rounded-full inline-block" />
                                              मेरो सम्पादन
                                            </span>
                                          ) : (
                                            <span className="text-slate-600 font-normal">{selected.length} संकलक छानिएका</span>
                                          )}
                                        </div>
                                        <span className="font-mono font-bold text-amber-900 bg-amber-100/80 px-1.5 py-0.2 rounded border border-amber-300">
                                          हाइलाइट: {highlightedItems.length}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    /* Regular Data Collector view */
                                    <div className="bg-white/90 p-2 rounded-md border border-emerald-200 text-[10.5px] text-slate-800 font-nepali flex flex-col gap-1 shadow-xs">
                                      <div className="flex items-center justify-between">
                                        <span className="flex items-center gap-1.5 font-bold text-emerald-900">
                                          <span style={{ backgroundColor: myColor.hex }} className="w-2.5 h-2.5 rounded-full inline-block ring-1 ring-white" />
                                          <span>तपाईंका सम्पादनहरू (My Edits)</span>
                                        </span>
                                        <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                          {highlightedItems.length} फिचर
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-600">
                                        नक्सामा तपाईंले सिर्जना वा परिमार्जन गरेका फिचरहरू तपाईंको रङमा हाइलाइट गरिएका छन्।
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    )}
  </div>

  {/* Vector Layer Download Format Modal */}
  {vectorDownloadModal && vectorDownloadModal.layer && (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-fade-in font-sans">
      <div className="bg-white rounded-xl shadow-2xl border border-gov-blue-400 w-full max-w-sm overflow-hidden flex flex-col max-h-[90dvh] animate-slide-up">
        <div className="bg-gov-blue-800 text-white px-3.5 py-2.5 flex items-center justify-between text-xs font-bold font-nepali">
          <div className="flex items-center gap-1.5">
            <Download className="w-4 h-4 text-gov-gold-400" />
            <span>तह डाउनलोड (Download Layer)</span>
          </div>
          <button
            type="button"
            onClick={() => setVectorDownloadModal(null)}
            className="text-white/80 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 space-y-3 flex-1 overflow-y-auto text-xs">
          <div className="bg-gov-blue-50 p-2.5 rounded-lg border border-gov-blue-200">
            <div className="text-xs font-bold text-gov-blue-950 font-nepali">
              {vectorDownloadModal.layer.name}
            </div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
              प्रकार: {vectorDownloadModal.layer.geometry_type} &middot; वस्तु: {vectorDownloadModal.layer.feature_count ?? '-'}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-slate-700 font-nepali">
              ढाँचा चयन गर्नुहोस् (Choose Format):
            </div>

            {/* GeoJSON */}
            <button
              type="button"
              disabled={downloadingVectorId === vectorDownloadModal.layer.id}
              onClick={() => handleDownloadVector(vectorDownloadModal.layer, 'geojson')}
              className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-left"
            >
              <div>
                <div className="font-bold text-slate-900 font-nepali text-xs">GeoJSON (.geojson)</div>
                <div className="text-[10px] text-slate-500">मानक वेब GIS ढाँचा (RFC 7946)</div>
              </div>
              {downloadingVectorId === vectorDownloadModal.layer.id ? (
                <Loader2 className="w-4 h-4 text-gov-blue-800 animate-spin" />
              ) : (
                <Download className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {/* ESRI Shapefile */}
            <button
              type="button"
              disabled={downloadingVectorId === vectorDownloadModal.layer.id}
              onClick={() => handleDownloadVector(vectorDownloadModal.layer, 'shapefile')}
              className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-left"
            >
              <div>
                <div className="font-bold text-slate-900 font-nepali text-xs">ESRI Shapefile (.zip)</div>
                <div className="text-[10px] text-slate-500">ArcGIS, QGIS बन्डल (.shp, .dbf, .prj)</div>
              </div>
              {downloadingVectorId === vectorDownloadModal.layer.id ? (
                <Loader2 className="w-4 h-4 text-gov-blue-800 animate-spin" />
              ) : (
                <Download className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {/* KML */}
            <button
              type="button"
              disabled={downloadingVectorId === vectorDownloadModal.layer.id}
              onClick={() => handleDownloadVector(vectorDownloadModal.layer, 'kml')}
              className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-left"
            >
              <div>
                <div className="font-bold text-slate-900 font-nepali text-xs">KML (.kml)</div>
                <div className="text-[10px] text-slate-500">Google Earth ढाँचा</div>
              </div>
              {downloadingVectorId === vectorDownloadModal.layer.id ? (
                <Loader2 className="w-4 h-4 text-gov-blue-800 animate-spin" />
              ) : (
                <Download className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {/* CSV */}
            <button
              type="button"
              disabled={downloadingVectorId === vectorDownloadModal.layer.id}
              onClick={() => handleDownloadVector(vectorDownloadModal.layer, 'csv')}
              className="w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-left"
            >
              <div>
                <div className="font-bold text-slate-900 font-nepali text-xs">CSV (.csv)</div>
                <div className="text-[10px] text-slate-500">स्प्रेडसिट तालिका + WKT ज्यामिति</div>
              </div>
              {downloadingVectorId === vectorDownloadModal.layer.id ? (
                <Loader2 className="w-4 h-4 text-gov-blue-800 animate-spin" />
              ) : (
                <Download className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        <div className="bg-slate-50 px-3.5 py-2 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={() => setVectorDownloadModal(null)}
            className="btn-gov-secondary text-xs py-1 px-3"
          >
            बन्द
          </button>
        </div>
      </div>
    </div>
  )}
  </>
);
}
