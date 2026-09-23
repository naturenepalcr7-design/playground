'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Edit3, Save, RotateCcw, Trash2, X, CheckCircle2,
  AlertTriangle, Loader2, Plus, Tag, Layers, MapPin,
  Calendar, Hash, Type, HelpCircle, Magnet, MousePointerClick, Sparkles,
  Undo2, Redo2, ChevronDown, ChevronUp, PenTool, MinusCircle, Move,
  Link2, Unlink, Database
} from 'lucide-react';

function countVertices(geom) {
  if (!geom || !geom.coordinates) return 0;
  const geomType = geom.type;
  if (geomType === 'Point') return 1;
  if (geomType === 'LineString' || geomType === 'MultiPoint') return geom.coordinates.length;
  if (geomType === 'Polygon' || geomType === 'MultiLineString') {
    let cnt = 0;
    geom.coordinates.forEach((ring) => {
      if (Array.isArray(ring)) cnt += ring.length;
    });
    return cnt;
  }
  if (geomType === 'MultiPolygon') {
    let cnt = 0;
    geom.coordinates.forEach((poly) => {
      if (Array.isArray(poly)) {
        poly.forEach((ring) => {
          if (Array.isArray(ring)) cnt += ring.length;
        });
      }
    });
    return cnt;
  }
  return 0;
}

/**
 * FeatureEditPanel Component — Official Nepal Government WebGIS Standard
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 * 
 * Manages spatial geometry status, snapping control, undo/redo, and attribute editing for selected vector features.
 */
export default function FeatureEditPanel({
  feature, // { id, layerId, layerName, geometryType, properties, originalGeom, currentGeom, isModified }
  onSave,
  onRevertGeometry,
  onDelete,
  onClose,
  saving = false,
  deleting = false,
  schema = null,
  snappingEnabled = true,
  onToggleSnapping = null,
  snapTolerance = 15,
  onChangeSnapTolerance = null,
  layerAllowsSnapping = true,
  onUndo = null,
  onRedo = null,
  canUndo = false,
  canRedo = false,
  editSubMode = null, // null (none selected = all allowed) | 'tane' | 'bistar' | 'metne'
  onChangeEditSubMode = null,
  onRemoveLastVertex = null,
  vectorLayers = [],
  user = null,
  isAdmin = false,
  isCollector = false,
}) {
  const [properties, setProperties] = useState({});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [showAddProp, setShowAddProp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isAttrDirty, setIsAttrDirty] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [activeTab, setActiveTab] = useState('form'); // 'form' (default on mobile/desktop) | 'spatial'

  // Ownership verification: GisAdmin can delete any feature; DataCollector can only delete features they created and saved
  const isCreator = Boolean(
    isAdmin ||
    (isCollector && (
      (feature?.properties?._created_by != null && user?.id != null && Number(feature.properties._created_by) === Number(user.id)) ||
      (feature?.properties?.Kmc_Editor && user?.username && String(feature.properties.Kmc_Editor).trim().toLowerCase() === String(user.username).trim().toLowerCase()) ||
      (feature?.created_by != null && user?.id != null && Number(feature.created_by) === Number(user.id))
    ))
  );
  const canDelete = Boolean(onDelete && (isAdmin || isCreator));

  // Find vector layer field definitions with robust ID & name matching
  const currentLayer = vectorLayers.find((l) => String(l.id) === String(feature?.layerId)) ||
                       vectorLayers.find((l) => String(l.id) === String(feature?.layer_id)) ||
                       vectorLayers.find((l) => l.name === feature?.layerName);

  // Safely parse layer fields config (handles Array, JSON string, or schema fallback)
  const rawFields = currentLayer?.fields_config;
  let parsedFields = [];
  if (Array.isArray(rawFields)) {
    parsedFields = rawFields;
  } else if (typeof rawFields === 'string' && rawFields.trim()) {
    try {
      const p = JSON.parse(rawFields);
      if (Array.isArray(p)) parsedFields = p;
      else if (p && Array.isArray(p.fields)) parsedFields = p.fields;
    } catch (e) {
      console.warn('Failed to parse fields_config:', e);
    }
  } else if (schema && Array.isArray(schema.fields)) {
    parsedFields = schema.fields;
  }
  const layerFields = parsedFields;

  // Sync incoming feature properties and ensure layer fields are present
  useEffect(() => {
    const initialProps = { ...(feature?.properties || {}) };
    layerFields.forEach((f) => {
      if (f.name && !(f.name in initialProps)) {
        initialProps[f.name] = '';
      }
    });
    setProperties(initialProps);
    setIsAttrDirty(false);
    setShowAddProp(false);
    setShowDeleteConfirm(false);
    setValidationErrors([]);
  }, [feature?.id, feature?.layerId, currentLayer?.id, layerFields.length]);

  const handlePropChange = (key, val) => {
    setProperties((prev) => ({ ...prev, [key]: val }));
    setIsAttrDirty(true);
    if (validationErrors.includes(key)) {
      setValidationErrors((prev) => prev.filter((k) => k !== key));
    }
  };

  const handleRemoveProp = (key) => {
    setProperties((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setIsAttrDirty(true);
  };

  const handleAddProp = (e) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    setProperties((prev) => ({ ...prev, [newKey.trim()]: newVal }));
    setNewKey('');
    setNewVal('');
    setShowAddProp(false);
    setIsAttrDirty(true);
  };

  const handleSave = () => {
    if (!feature) return;

    // Strict validation of compulsory fields
    const missing = [];
    layerFields.forEach((f) => {
      if (f.required) {
        const val = properties[f.name];
        const isEmpty =
          val === undefined ||
          val === null ||
          (typeof val === 'string' && val.trim() === '') ||
          (Array.isArray(val) && val.length === 0);
        if (isEmpty) {
          missing.push(f.name);
        }
      }
    });

    if (missing.length > 0) {
      setValidationErrors(missing);
      setActiveTab('form'); // Switch tab so user sees the missing fields immediately
      const missingLabels = missing.map((k) => {
        const f = layerFields.find((lf) => lf.name === k);
        return f?.label ? `${f.label} (${k})` : k;
      });
      alert(`⚠️ कृपया सबै अनिवार्य फिल्डहरू तुरुन्त भर्नुहोस्!\n(Please fill all compulsory fields instantly):\n\n• ${missingLabels.join('\n• ')}`);

      setTimeout(() => {
        const firstEl = document.querySelector(`input[name="prop_${missing[0]}"]`);
        if (firstEl) firstEl.focus();
      }, 50);
      return;
    }

    if (onSave) {
      onSave({
        id: feature.id,
        properties,
        geometry: feature.currentGeom || feature.originalGeom,
      });
    }
  };

  if (!feature) return null;

  const isSpatialModified = feature.isModified;
  const isAnyDirty = isSpatialModified || isAttrDirty;

  const geomType = feature.geometryType || feature.currentGeom?.type || feature.originalGeom?.type || '';
  const isPointSingle = geomType === 'Point';

  const isTaneActive = editSubMode === 'tane' || editSubMode === 'modify';
  const isBistarActive = editSubMode === 'bistar' || editSubMode === 'extend';
  const isMetneActive = editSubMode === 'metne' || editSubMode === 'deleteVertex';
  const isNoneSelected = !editSubMode;

  // Single selection lock: when one is selected, other two are disabled
  const isTaneDisabled = !isNoneSelected && !isTaneActive;
  const isBistarDisabled = (!isNoneSelected && !isBistarActive) || isPointSingle;
  const isMetneDisabled = !isNoneSelected && !isMetneActive;

  const handleToggleSubMode = (mode) => {
    if (!onChangeEditSubMode) return;
    if (
      (mode === 'tane' && isTaneActive) ||
      (mode === 'bistar' && isBistarActive) ||
      (mode === 'metne' && isMetneActive)
    ) {
      // Toggle off -> returns to null (none selected = all allowed)
      onChangeEditSubMode(null);
    } else {
      onChangeEditSubMode(mode);
    }
  };

  const [showAddLink, setShowAddLink] = useState(false);
  const [selectedTargetLayerId, setSelectedTargetLayerId] = useState('');
  const [targetFeatureInputVal, setTargetFeatureInputVal] = useState('');

  const handleAddLayerLink = (e) => {
    e.preventDefault();
    if (!selectedTargetLayerId) return;
    const targetL = vectorLayers.find((l) => l.id === Number(selectedTargetLayerId));
    if (!targetL) return;
    const cleanName = targetL.name.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const fieldName = `${cleanName || 'target'}_linked_id`;
    setProperties((prev) => ({ ...prev, [fieldName]: targetFeatureInputVal.trim() || '' }));
    setSelectedTargetLayerId('');
    setTargetFeatureInputVal('');
    setShowAddLink(false);
    setIsAttrDirty(true);
  };

  return (
    <div
      className={`fixed left-0 right-0 bottom-0 sm:left-auto sm:right-4 sm:bottom-4 landscape:right-2 landscape:top-2 landscape:bottom-2 landscape:w-80 landscape:left-auto landscape:max-h-[calc(100dvh-16px)] landscape:rounded-xl landscape:border sm:absolute z-40 w-full sm:w-96 sm:max-w-md ${
        isCollapsed ? 'h-14 max-h-14' : 'h-[78dvh] max-h-[85dvh] sm:h-auto sm:max-h-[calc(100%-24px)]'
      } flex flex-col min-h-0 bg-white border-t sm:border border-slate-300 rounded-t-2xl sm:rounded-xl shadow-2xl animate-slide-up overflow-hidden font-sans transition-all pb-[max(0.375rem,env(safe-area-inset-bottom,0px))]`}
      id="feature-edit-panel"
    >
      {/* Header Banner */}
      <div
        className="bg-gov-blue-800 text-white px-3.5 py-2 sm:py-2.5 flex flex-col shrink-0 shadow-sm cursor-pointer select-none"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {/* Mobile Grab / Drag Handle Pill */}
        <div className="w-10 h-1 bg-white/40 rounded-full mx-auto mb-1.5 sm:hidden shrink-0" />

        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded bg-gov-gold-500/20 border border-gov-gold-400/40 text-gov-gold-400 flex items-center justify-center shrink-0">
              <Edit3 className="w-3.5 h-3.5" />
            </div>
            <div className="truncate">
              <h3 className="text-xs font-bold font-nepali text-white truncate leading-tight">
                विशेषता सम्पादन (Feature Editor)
              </h3>
              <span className="text-[10px] text-gov-blue-200 block truncate">
                {feature.layerName || 'तह'} &middot; #{feature.id}
              </span>
            </div>
          </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Quick Snapping Toggle in Header */}
          {onToggleSnapping && !isCollapsed && (
            layerAllowsSnapping === false ? (
              <span
                className="px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 border bg-slate-800 text-rose-300 border-rose-800/40 cursor-not-allowed opacity-80"
                title="प्रशासकद्वारा यस तहमा स्न्यापिङ बन्द गरिएको छ (Snapping disabled for this layer by admin)"
              >
                <Magnet className="w-3 h-3 text-rose-400" />
                <span className="font-nepali">स्न्याप निषेधित</span>
              </span>
            ) : (
              <button
                onClick={onToggleSnapping}
                className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all border ${
                  snappingEnabled
                    ? 'bg-emerald-600/90 text-white border-emerald-400/50 shadow-sm'
                    : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
                }`}
                title={snappingEnabled ? 'स्न्यापिङ सक्रिय छ (बन्द गर्न थिच्नुहोस्)' : 'स्न्यापिङ बन्द छ (सक्रिय गर्न थिच्नुहोस्)'}
              >
                <Magnet className={`w-3 h-3 ${snappingEnabled ? 'text-gov-gold-300 animate-pulse' : 'text-slate-400'}`} />
                <span className="font-nepali">{snappingEnabled ? 'स्न्याप अन' : 'स्न्याप अफ'}</span>
              </button>
            )
          )}

          {/* Minimize / Expand Toggle Button */}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-gov-blue-200 hover:text-white hover:bg-gov-blue-700 p-1 rounded-md transition-colors"
            title={isCollapsed ? "प्यानल खोल्नुहोस् (Expand)" : "प्यानल खुम्च्याउनुहोस् (Collapse)"}
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          <button
            onClick={onClose}
            className="text-gov-blue-200 hover:text-white hover:bg-gov-blue-700 p-1 rounded-md transition-colors"
            title="बन्द गर्नुहोस् (Close)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

      {!isCollapsed && (
        <>
          {/* Tab Navigation: [विशेषता फारम (Fields Form)] | [नक्सा उपकरण (Geometry Tools)] */}
          <div className="flex items-center border-b border-slate-200 bg-slate-100/90 shrink-0 select-none p-1.5 gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('form')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold font-nepali flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'form'
                  ? 'bg-gov-blue-800 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200'
              }`}
            >
              <Tag className={`w-3.5 h-3.5 ${activeTab === 'form' ? 'text-gov-gold-400' : 'text-slate-500'}`} />
              <span>विशेषता फारम (Fields Form)</span>
              {validationErrors.length > 0 ? (
                <span className="text-[9px] px-1.5 py-0.2 rounded-full font-sans font-bold bg-rose-500 text-white animate-pulse">
                  {validationErrors.length}
                </span>
              ) : Object.keys(properties).length > 0 ? (
                <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-mono font-semibold ${
                  activeTab === 'form' ? 'bg-gov-blue-900 text-gov-blue-200' : 'bg-slate-200 text-slate-700'
                }`}>
                  {Object.keys(properties).length}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('spatial')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold font-nepali flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'spatial'
                  ? 'bg-gov-blue-800 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200'
              }`}
            >
              <PenTool className={`w-3.5 h-3.5 ${activeTab === 'spatial' ? 'text-gov-gold-400' : 'text-slate-500'}`} />
              <span>नक्सा उपकरण (Geometry)</span>
              {isSpatialModified ? (
                <span className="text-[9px] px-1.5 py-0.2 rounded-full font-sans font-bold bg-amber-500 text-amber-950 animate-pulse">
                  परिमार्जित
                </span>
              ) : (
                <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-mono font-semibold ${
                  activeTab === 'spatial' ? 'bg-gov-blue-900 text-gov-blue-200' : 'bg-slate-200 text-slate-700'
                }`}>
                  {countVertices(feature.currentGeom || feature.originalGeom)}
                </span>
              )}
            </button>
          </div>

          {/* Spatial Geometry & Vertex Editing Tab Content */}
          {activeTab === 'spatial' && (
            <div className="overflow-y-auto p-3 space-y-2.5 flex-1 min-h-0 overscroll-contain text-xs scrollbar-thin">
              {/* Spatial Geometry Status Ribbon */}
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    प्रकार:
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gov-blue-100 text-gov-blue-900 font-mono uppercase">
                    {feature.geometryType || 'Geometry'}
                  </span>
                </div>

                {feature.isWithinAssignedGrid === false ? (
                  <div className="flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-300 animate-pulse">
                    <AlertTriangle className="w-3 h-3 text-red-600" />
                    <span className="font-nepali">ग्रिड सिमाना बाहिर</span>
                  </div>
                ) : isSpatialModified ? (
                  <div className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-300 animate-pulse">
                    <AlertTriangle className="w-3 h-3 text-amber-600" />
                    <span className="font-nepali">जियोमेट्री परिमार्जित</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span className="font-nepali text-[10px]">सम्पादन योग्य (Active)</span>
                  </div>
                )}
              </div>

              {/* Geometry Action & Vertex Editing Toolbar */}
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-700 font-nepali flex items-center gap-1">
                    <PenTool className="w-3 h-3 text-gov-blue-800" />
                    सम्पादन उपकरण (Edit Tools):
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-gov-blue-100 text-gov-blue-900 border border-gov-blue-200">
                    {countVertices(feature.currentGeom || feature.originalGeom)} बिन्दुहरू (Vertices)
                  </span>
                </div>

                {/* Status indicator: All Allowed vs Single Active Mode */}
                {isNoneSelected ? (
                  <div className="flex items-center justify-between px-2 py-1 rounded bg-sky-50 border border-sky-200 text-[10px] font-nepali text-sky-900">
                    <span className="flex items-center gap-1 font-bold">
                      <Sparkles className="w-3 h-3 text-sky-600 shrink-0" />
                      <span>सबै सम्पादन खुला (All Edits Allowed)</span>
                    </span>
                    <span className="text-[9px] text-sky-700 bg-sky-100/90 px-1.5 py-0.2 rounded font-sans font-semibold">
                      छनौट छैन
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between px-2 py-1 rounded bg-amber-50 border border-amber-200 text-[10px] font-nepali text-amber-900">
                    <span className="flex items-center gap-1 font-bold truncate">
                      {isTaneActive && <Move className="w-3 h-3 text-gov-blue-800 shrink-0" />}
                      {isBistarActive && <Plus className="w-3 h-3 text-emerald-600 shrink-0" />}
                      {isMetneActive && <Trash2 className="w-3 h-3 text-gov-red-600 shrink-0" />}
                      <span>
                        {isTaneActive && 'केवल "ताने" सक्रिय (Only Move/Reshape Allowed)'}
                        {isBistarActive && 'केवल "बिस्तार" सक्रिय (Only Extend Allowed)'}
                        {isMetneActive && 'केवल "मेट्ने" सक्रिय (Only Delete Allowed)'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onChangeEditSubMode && onChangeEditSubMode(null)}
                      className="text-[9px] text-amber-800 hover:text-amber-950 font-bold underline shrink-0 cursor-pointer ml-1"
                      title="सबै सम्पादन खुला गर्नुहोस् (Deselect to allow all edits)"
                    >
                      सबै खुला गर्ने
                    </button>
                  </div>
                )}

                {/* The three edit options: ताने | बिस्तार | मेट्ने */}
                <div className="grid grid-cols-3 gap-1.5">
                  {/* 1. ताने */}
                  <button
                    type="button"
                    onClick={() => handleToggleSubMode('tane')}
                    disabled={isTaneDisabled}
                    className={`py-2 px-2 rounded-lg text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all border ${
                      isTaneActive
                        ? 'bg-gov-blue-800 text-white border-gov-blue-900 shadow-sm ring-2 ring-gov-blue-400 cursor-pointer'
                        : isTaneDisabled
                        ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 cursor-not-allowed shadow-none'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-gov-blue-400 cursor-pointer'
                    }`}
                    title={
                      isTaneDisabled
                        ? 'अहिले केवल अर्को मोड सक्रिय छ (Disabled)'
                        : isTaneActive
                        ? 'ताने सक्रिय छ (बन्द गर्न पुनः थिच्नुहोस्)'
                        : 'ताने मात्र सक्रिय गर्न थिच्नुहोस्'
                    }
                  >
                    <Move className={`w-3 h-3 shrink-0 ${isTaneActive ? 'text-gov-gold-300' : 'text-slate-500'}`} />
                    <span>ताने</span>
                  </button>

                  {/* 2. बिस्तार */}
                  <button
                    type="button"
                    onClick={() => handleToggleSubMode('bistar')}
                    disabled={isBistarDisabled}
                    className={`py-2 px-2 rounded-lg text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all border ${
                      isBistarActive
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm ring-2 ring-emerald-400 cursor-pointer'
                        : isBistarDisabled
                        ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 cursor-not-allowed shadow-none'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-emerald-400 cursor-pointer'
                    }`}
                    title={
                      isPointSingle
                        ? 'एकल बिन्दु फिचरलाई बिस्तार गर्न मिल्दैन (Not applicable to Point)'
                        : isBistarDisabled
                        ? 'अहिले केवल अर्को मोड सक्रिय छ (Disabled)'
                        : isBistarActive
                        ? 'बिस्तार सक्रिय छ (बन्द गर्न पुनः थिच्नुहोस्)'
                        : 'बिस्तार मात्र सक्रिय गर्न थिच्नुहोस्'
                    }
                  >
                    <Plus className={`w-3 h-3 shrink-0 ${isBistarActive ? 'text-emerald-100' : 'text-slate-500'}`} />
                    <span>बिस्तार</span>
                  </button>

                  {/* 3. मेट्ने */}
                  <button
                    type="button"
                    onClick={() => handleToggleSubMode('metne')}
                    disabled={isMetneDisabled}
                    className={`py-2 px-2 rounded-lg text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all border ${
                      isMetneActive
                        ? 'bg-gov-red-600 text-white border-gov-red-700 shadow-sm ring-2 ring-gov-red-400 cursor-pointer'
                        : isMetneDisabled
                        ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 cursor-not-allowed shadow-none'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-gov-red-400 cursor-pointer'
                    }`}
                    title={
                      isMetneDisabled
                        ? 'अहिले केवल अर्को मोड सक्रिय छ (Disabled)'
                        : isMetneActive
                        ? 'मेट्ने सक्रिय छ (बन्द गर्न पुनः थिच्नुहोस्)'
                        : 'मेट्ने मात्र सक्रिय गर्न थिच्नुहोस्'
                    }
                  >
                    <Trash2 className={`w-3 h-3 shrink-0 ${isMetneActive ? 'text-rose-200' : 'text-slate-500'}`} />
                    <span>मेट्ने</span>
                  </button>
                </div>

                {/* Quick Vertex Pop & Geometry Action Guidance */}
                <div className="flex items-center justify-between pt-0.5 text-[9.5px] font-nepali">
                  <span className="text-slate-600 truncate">
                    {isNoneSelected && (
                      isPointSingle
                        ? '👉 बिन्दु सार्न तानेर वा नयाँ ठाउँमा थिचेर सार्नुहोस्।'
                        : '👉 तान्ने, नयाँ बिन्दु थप्ने (बिस्तार) वा मेट्ने सबै कार्यहरू खुला छन्।'
                    )}
                    {isTaneActive && (
                      isPointSingle
                        ? '👉 बिन्दुलाई नक्सामा तानेर स्थान परिवर्तन गर्नुहोस्।'
                        : '👉 बिन्दु/खण्ड समातेर तान्नुहोस् र आकार मिलाउनुहोस्।'
                    )}
                    {isBistarActive && (
                      isPointSingle
                        ? '⚠️ बिन्दु फिचरलाई विस्तार गर्न मिल्दैन (स्थान सार्न "ताने" प्रयोग गर्नुहोस्)।'
                        : '👉 नक्सामा क्लिक गरी नयाँ बिन्दु थपेर विस्तार गर्नुहोस्।'
                    )}
                    {isMetneActive && (
                      isPointSingle
                        ? '👉 बिन्दु मेटाउन तल रहेको "मेटाउनुहोस्" बटन प्रयोग गर्नुहोस्।'
                        : '👉 हटाउन चाहेको बिन्दुमा सिधै क्लिक गर्नुहोस्।'
                    )}
                  </span>
                  {onRemoveLastVertex && !isPointSingle && (
                    <button
                      type="button"
                      onClick={onRemoveLastVertex}
                      className="text-[9.5px] font-bold text-gov-red-700 hover:text-gov-red-900 flex items-center gap-0.5 underline cursor-pointer shrink-0 ml-1"
                      title="अन्तिम बिन्दु हटाउनुहोस्"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>अन्तिम हटाउने</span>
                    </button>
                  )}
                </div>
                {/* Explicit Option to Delete Entire Feature (Distinct from vertex editing) */}
                {canDelete && (
                  <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between bg-rose-50/80 p-2 rounded-lg border border-rose-200">
                    <div className="flex flex-col pr-2">
                      <span className="text-[11px] font-bold text-gov-red-900 font-nepali flex items-center gap-1">
                        <Trash2 className="w-3.5 h-3.5 text-gov-red-700 shrink-0" />
                        सम्पूर्ण फिचर मेटाउने (Delete Entire Feature)
                      </span>
                      <span className="text-[9.5px] text-slate-600 font-nepali">
                        यो सम्पूर्ण फिचर नक्सा र डाटाबेसबाट सधैंका लागि हटाउनुहोस्।
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-2.5 py-1.5 text-[10px] font-bold font-nepali bg-gov-red-700 hover:bg-gov-red-800 text-white rounded-md shadow-xs transition-all cursor-pointer active:scale-95 shrink-0 flex items-center gap-1"
                      title="सम्पूर्ण फिचर मेटाउनुहोस्"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>मेटाउनुहोस्</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Snapping Tolerance Control in Geometry Tab */}
              {layerAllowsSnapping !== false && onChangeSnapTolerance && (
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px] font-nepali">
                    <span className="font-bold text-slate-700 flex items-center gap-1">
                      <Magnet className="w-3.5 h-3.5 text-gov-blue-700" />
                      <span>स्न्यापिङ सहिष्णुता (Snap Tolerance):</span>
                    </span>
                    <span className="font-mono font-bold text-gov-blue-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {snapTolerance}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={40}
                    step={1}
                    value={snapTolerance}
                    onChange={(e) => onChangeSnapTolerance(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-gov-blue-800"
                  />
                  <div className="flex justify-between text-[9px] text-slate-400">
                    <span>५px (सटीक)</span>
                    <span>४०px (स्पर्श/मोबाइल)</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Scrollable Attribute Form Tab Content */}
          {activeTab === 'form' && (
            <div className="overflow-y-auto p-3 space-y-2.5 flex-1 min-h-0 overscroll-contain text-xs scrollbar-thin">
              <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                <span className="font-bold text-gov-blue-900 font-nepali flex items-center gap-1">
                  <Tag className="w-3 h-3 text-gov-red-700" />
                  विशेषता विवरणहरू (Attributes)
                </span>
                <div className="flex items-center gap-2">
                  {vectorLayers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddLink(!showAddLink);
                        setShowAddProp(false);
                      }}
                      className="text-[10.5px] font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded border border-purple-200 transition-colors"
                      title="अर्को भेक्टर तहसँग फिचर जोड्नुहोस्"
                    >
                      <Link2 className="w-3 h-3" />
                      <span>तह जोड्ने</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddProp(!showAddProp);
                      setShowAddLink(false);
                    }}
                    className="text-[10.5px] font-semibold text-gov-blue-800 hover:text-gov-blue-950 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>फिल्ड थप्नुहोस्</span>
                  </button>
                </div>
              </div>

              {/* Add Layer Link Subform */}
              {showAddLink && (
                <form onSubmit={handleAddLayerLink} className="bg-purple-50/90 p-2.5 rounded-lg border border-purple-200 flex flex-col gap-2 animate-fade-in">
                  <div className="text-[10px] font-bold text-purple-950 font-nepali flex items-center gap-1">
                    <Link2 className="w-3 h-3 text-purple-700" />
                    <span>लक्षित तहसँग सम्बन्ध जोड्नुहोस् (Link to Vector Layer):</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <select
                      value={selectedTargetLayerId}
                      onChange={(e) => setSelectedTargetLayerId(e.target.value)}
                      className="px-2 py-1 bg-white border border-purple-300 rounded text-xs outline-none focus:border-purple-800 cursor-pointer"
                      required
                    >
                      <option value="" disabled>लक्षित तह छान्नुहोस्...</option>
                      {vectorLayers
                        .filter((l) => l.id !== feature.layerId)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Linked Feature ID / मान (Value)"
                      value={targetFeatureInputVal}
                      onChange={(e) => setTargetFeatureInputVal(e.target.value)}
                      className="px-2 py-1 bg-white border border-purple-300 rounded text-xs outline-none focus:border-purple-800"
                      required
                    />
                  </div>
                  <div className="flex justify-end gap-1.5 mt-0.5">
                    <button
                      type="button"
                      onClick={() => setShowAddLink(false)}
                      className="px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 rounded"
                    >
                      रद्द
                    </button>
                    <button
                      type="submit"
                      className="px-2.5 py-0.5 text-[10px] bg-purple-700 text-white rounded font-bold hover:bg-purple-800"
                    >
                      सम्बन्ध थप्नुहोस्
                    </button>
                  </div>
                </form>
              )}

              {/* Add Property Subform */}
              {showAddProp && (
                <form onSubmit={handleAddProp} className="bg-gov-blue-50/70 p-2.5 rounded-lg border border-gov-blue-200 flex flex-col gap-2 animate-fade-in">
                  <div className="text-[10px] font-bold text-gov-blue-900 font-nepali">
                    नयाँ विशेषता फिल्ड थप्नुहोस्:
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      placeholder="Field Name (e.g. road_width)"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="px-2 py-1 bg-white border border-slate-300 rounded text-xs outline-none focus:border-gov-blue-800"
                      required
                    />
                    <input
                      type="text"
                      placeholder="Value (मान)"
                      value={newVal}
                      onChange={(e) => setNewVal(e.target.value)}
                      className="px-2 py-1 bg-white border border-slate-300 rounded text-xs outline-none focus:border-gov-blue-800"
                    />
                  </div>
                  <div className="flex justify-end gap-1.5 mt-0.5">
                    <button
                      type="button"
                      onClick={() => setShowAddProp(false)}
                      className="px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 rounded"
                    >
                      रद्द
                    </button>
                    <button
                      type="submit"
                      className="px-2.5 py-0.5 text-[10px] bg-gov-blue-800 text-white rounded font-bold hover:bg-gov-blue-900"
                    >
                      थप्नुहोस्
                    </button>
                  </div>
                </form>
              )}

              {/* Property Key-Value Inputs */}
              {Object.keys(properties).length === 0 ? (
                <p className="text-[11px] text-slate-400 italic py-2 text-center">
                  कुनै विशेषता उपलब्ध छैन (No attributes)
                </p>
              ) : (
                <div className="space-y-2">
                  {/* Missing Compulsory Error Alert Banner */}
                  {validationErrors.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-950 text-xs font-nepali flex items-start gap-2 mb-2 animate-shake">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-bold">कृपया सबै अनिवार्य फिल्डहरू तुरुन्त भर्नुहोस्:</div>
                        <div className="text-[10.5px] text-rose-800 mt-0.5 font-medium leading-relaxed">
                          तलका अनिवार्य विवरणहरू नभरी सुरक्षित गर्न सकिँदैन:
                          <ul className="list-disc list-inside mt-0.5 font-bold">
                            {validationErrors.map((k) => {
                              const f = layerFields.find((lf) => lf.name === k);
                              return (
                                <li key={k} className="text-rose-900">
                                  {f?.label || k}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {Object.entries(properties)
                    .sort(([aKey], [bKey]) => {
                      const aDef = layerFields.find((f) => f.name === aKey);
                      const bDef = layerFields.find((f) => f.name === bKey);
                      const aReq = aDef?.required ? 1 : 0;
                      const bReq = bDef?.required ? 1 : 0;
                      return bReq - aReq;
                    })
                    .map(([key, val]) => {
                      const isLinkedProp = key.endsWith('_linked_id');
                      const isKmcEditor = key === 'Kmc_Editor';
                      const linkedLayerLabel = isLinkedProp ? key.replace(/_linked_id$/, '').replace(/_/g, ' ') : null;
                      const fieldDef = layerFields.find((f) => f.name === key);
                      const isCompulsory = Boolean(fieldDef?.required);
                      const hasError = validationErrors.includes(key);

                      return (
                        <div
                          key={key}
                          className={`p-2.5 rounded-lg border flex flex-col gap-1.5 transition-all ${
                            hasError
                              ? 'bg-rose-50/95 border-rose-400 ring-2 ring-rose-300 shadow-sm'
                              : isCompulsory
                              ? 'bg-amber-50/60 border-amber-300 ring-1 ring-amber-200'
                              : isLinkedProp
                              ? 'bg-purple-50/70 border-purple-300 ring-1 ring-purple-200 shadow-2xs'
                              : isKmcEditor
                              ? 'bg-blue-50/80 border-blue-200 ring-1 ring-blue-100 shadow-2xs'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <label className="text-[11px] font-bold font-mono truncate flex items-center gap-1.5 text-slate-800">
                              {isLinkedProp && (
                                <Link2 className="w-3 h-3 text-purple-700 shrink-0" />
                              )}
                              {isKmcEditor && (
                                <Sparkles className="w-3 h-3 text-blue-600 shrink-0" />
                              )}
                              <span className={isLinkedProp ? 'text-purple-950 font-bold' : isKmcEditor ? 'text-blue-950 font-bold' : ''}>
                                {fieldDef?.label || key}
                              </span>
                              {fieldDef?.label && fieldDef.name !== fieldDef.label && (
                                <span className="text-[9px] font-mono text-slate-400 font-normal">
                                  ({fieldDef.name})
                                </span>
                              )}
                              {isCompulsory && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-sans font-bold bg-amber-200 text-amber-900 border border-amber-300 shrink-0 flex items-center gap-1 shadow-2xs">
                                  <span className="text-rose-600 font-black text-xs leading-none">*</span>
                                  <span>अनिवार्य (Compulsory)</span>
                                </span>
                              )}
                              {isLinkedProp && (
                                <span className="text-[8.5px] px-1 py-0.1 rounded bg-purple-200 text-purple-900 font-sans font-semibold">
                                  तह: {linkedLayerLabel}
                                </span>
                              )}
                              {isKmcEditor && (
                                <span className="text-[8.5px] px-1 py-0.1 rounded bg-blue-200 text-blue-900 font-sans font-semibold">
                                  सम्पादक (Editor)
                                </span>
                              )}
                            </label>
                            {!isKmcEditor && !isCompulsory && (
                              <button
                                type="button"
                                onClick={() => handleRemoveProp(key)}
                                className="text-slate-400 hover:text-gov-red-700 p-0.5 rounded transition-colors"
                                title={isLinkedProp ? 'सम्बन्ध हटाउनुहोस् (Unlink)' : 'फिल्ड हटाउनुहोस्'}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <input
                            type={fieldDef?.type === 'number' ? 'number' : 'text'}
                            name={`prop_${key}`}
                            value={val === null || val === undefined ? '' : String(val)}
                            onChange={(e) => handlePropChange(key, e.target.value)}
                            placeholder={
                              isCompulsory
                                ? '* अनिवार्य फिल्ड (Required)...'
                                : isLinkedProp
                                ? 'Linked Feature ID'
                                : ''
                            }
                            readOnly={isKmcEditor}
                            className={`w-full px-2.5 py-1.5 bg-white border rounded-md text-xs text-slate-800 font-medium outline-none transition-all ${
                              hasError
                                ? 'border-rose-500 ring-2 ring-rose-300 bg-rose-50/40 text-rose-950 font-bold placeholder-rose-400'
                                : isCompulsory
                                ? 'border-amber-300 focus:border-amber-600 focus:ring-1 focus:ring-amber-500'
                                : isLinkedProp
                                ? 'border-purple-300 focus:border-purple-800 focus:ring-1 focus:ring-purple-800'
                                : isKmcEditor
                                ? 'border-blue-300 bg-blue-50/50 cursor-not-allowed text-blue-900 font-semibold'
                                : 'border-slate-300 focus:border-gov-blue-800 focus:ring-1 focus:ring-gov-blue-800'
                            }`}
                          />
                          {hasError && (
                            <div className="flex items-center gap-1 text-rose-600 text-[10px] font-bold font-nepali animate-pulse">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>यो अनिवार्य फिल्ड हो, कृपया तुरुन्त भर्नुहोस् (Compulsory Field)</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

      {/* Delete Confirmation Modal Overlay */}
      {showDeleteConfirm && (
        <div className="p-3 bg-gov-red-50 border-t border-gov-red-200 text-xs flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-gov-red-800 font-bold font-nepali">
            <AlertTriangle className="w-4 h-4 text-gov-red-700 shrink-0" />
            <span>के तपाईं यो वस्तु (Feature #{feature.id}) मेटाउन निश्चित हुनुहुन्छ?</span>
          </div>
          <p className="text-[10px] text-slate-600 font-nepali">
            यो कार्य फिर्ता गर्न सकिने छैन।
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-2.5 py-1 text-[11px] font-medium bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50"
            >
              रद्द गर्नुहोस्
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(false);
                if (onDelete) onDelete(feature.id, feature.layerId || feature.layer_id);
              }}
              disabled={deleting}
              className="px-3 py-1 text-[11px] font-bold bg-gov-red-700 hover:bg-gov-red-800 text-white rounded flex items-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95"
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              <span>{deleting ? 'मेटाउँदै...' : 'हो, मेटाउनुहोस् (Delete)'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Footer Action Buttons */}
      {!showDeleteConfirm && (
        <div className="p-2.5 sm:p-3 bg-slate-100/95 backdrop-blur-xs border-t border-slate-200 flex items-center justify-between gap-2 shrink-0 sticky bottom-0 z-10 pb-[max(0.625rem,calc(env(safe-area-inset-bottom,0px)+0.375rem))]">
          <div className="flex items-center gap-1">
            {onUndo && (
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                className={`p-1.5 rounded-lg border flex items-center gap-1 transition-all ${
                  canUndo
                    ? 'bg-white hover:bg-amber-50 text-amber-800 border-amber-300 shadow-xs cursor-pointer active:scale-95'
                    : 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                }`}
                title="पूर्ववत गर्नुहोस् (Undo / Backspace)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            )}

            {onRedo && (
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                className={`p-1.5 rounded-lg border flex items-center gap-1 transition-all ${
                  canRedo
                    ? 'bg-white hover:bg-amber-50 text-amber-800 border-amber-300 shadow-xs cursor-pointer active:scale-95'
                    : 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                }`}
                title="पुनः गर्नुहोस् (Redo / Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            )}

            {isSpatialModified && onRevertGeometry && (
              <button
                onClick={onRevertGeometry}
                className="px-2 py-1.5 text-xs text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1 font-nepali font-semibold shadow-sm transition-all"
                title="परिमार्जित जियोमेट्री पूर्ववत गर्नुहोस्"
              >
                <RotateCcw className="w-3 h-3 text-amber-600" />
                <span className="hidden sm:inline">रिसेट</span>
              </button>
            )}

            {canDelete && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-2 py-1.5 text-xs text-gov-red-700 hover:text-white hover:bg-gov-red-700 bg-gov-red-50 border border-gov-red-200 rounded-lg flex items-center gap-1 font-nepali font-bold transition-all shadow-xs cursor-pointer active:scale-95"
                title="यो सम्पूर्ण फिचर मेटाउनुहोस् (Delete Entire Feature)"
              >
                <Trash2 className="w-3.5 h-3.5 text-gov-red-600" />
                <span className="hidden sm:inline">फिचर मेट्ने</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 font-nepali font-medium transition-all"
            >
              रद्द
            </button>

            <button
              onClick={handleSave}
              disabled={saving || feature.isWithinAssignedGrid === false}
              title={feature.isWithinAssignedGrid === false ? "फिचर तोकिएको कार्यक्षेत्र (ग्रिड) भन्दा बाहिर छ। कृपया ग्रिड भित्रै मिलाउनुहोस्।" : "सुरक्षित गर्नुहोस्"}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-md font-nepali transition-all ${
                feature.isWithinAssignedGrid === false
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed border border-slate-300 shadow-none'
                  : saving
                  ? 'bg-gov-blue-700 text-white opacity-80 cursor-wait'
                  : isAnyDirty
                  ? 'bg-gov-blue-800 hover:bg-gov-blue-900 text-white shadow-gov-blue-900/20 cursor-pointer active:scale-95'
                  : 'bg-gov-blue-800/80 text-white hover:bg-gov-blue-800 cursor-pointer'
              }`}
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <Save className="w-3.5 h-3.5 text-gov-gold-300" />
              )}
              <span>{saving ? 'सुरक्षित हुँदैछ... (Saving...)' : 'सुरक्षित गर्नुहोस् (Save)'}</span>
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
