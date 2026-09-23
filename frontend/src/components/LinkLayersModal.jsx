'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Link2, X, Database, Layers, ArrowRight, CheckCircle2,
  AlertCircle, Sparkles, Filter, RefreshCw, Check, Info,
  MapPin, Shield, HelpCircle, ChevronRight, Sliders, Play
} from 'lucide-react';
import { layersAPI, featuresAPI } from '../lib/api';

/**
 * Sanitizes target layer name to generate default <target_layer_name>_linked_id
 */
function generateDefaultFieldName(targetLayerName) {
  if (!targetLayerName) return 'target_linked_id';
  const clean = targetLayerName
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${clean || 'target'}_linked_id`;
}

/**
 * LinkLayersModal Component — Official Nepal Government WebGIS Standard
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 * 
 * Supports:
 * - Selecting Source and Target vector layers
 * - Linking by Attribute Match (Source Field == Target Field) or Spatial Overlay (Intersects, Within, Contains, Nearest)
 * - Selecting which target layer ID/attribute field to store
 * - Automatic generation of `<target_layer_name>_linked_id`
 * - Live execution with progress and statistics
 */
export default function LinkLayersModal({
  isOpen,
  onClose,
  vectorLayers = [],
  initialSourceLayerId = null,
  onLinkedSuccess = null,
}) {
  const [sourceLayerId, setSourceLayerId] = useState(initialSourceLayerId || '');
  const [targetLayerId, setTargetLayerId] = useState('');
  const [linkMethod, setLinkMethod] = useState('attribute'); // 'attribute' | 'spatial' | 'direct'
  const [sourceMatchField, setSourceMatchField] = useState('');
  const [targetMatchField, setTargetMatchField] = useState('');
  const [spatialPredicate, setSpatialPredicate] = useState('intersects'); // 'intersects' | 'within' | 'contains' | 'nearest'
  const [targetIdField, setTargetIdField] = useState('_id');
  const [customFieldName, setCustomFieldName] = useState('');
  const [useCustomFieldName, setUseCustomFieldName] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(true);

  const [loading, setLoading] = useState(false);
  const [fetchingFeatures, setFetchingFeatures] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Cached layer features to discover property fields
  const [layerFeaturesMap, setLayerFeaturesMap] = useState({});

  // Sync initialSourceLayerId when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialSourceLayerId) {
        setSourceLayerId(initialSourceLayerId);
      } else if (vectorLayers.length > 0 && !sourceLayerId) {
        setSourceLayerId(vectorLayers[0].id);
      }
      setResult(null);
      setError(null);
    }
  }, [isOpen, initialSourceLayerId, vectorLayers]);

  // Set default target layer when sourceLayerId changes
  useEffect(() => {
    if (sourceLayerId && vectorLayers.length > 1) {
      if (!targetLayerId || targetLayerId === sourceLayerId) {
        const other = vectorLayers.find((l) => l.id !== Number(sourceLayerId));
        if (other) setTargetLayerId(other.id);
      }
    }
  }, [sourceLayerId, vectorLayers, targetLayerId]);

  // Fetch sample features for selected source and target layers to discover property keys
  useEffect(() => {
    if (!isOpen) return;

    const layersToFetch = [sourceLayerId, targetLayerId].filter(
      (id) => id && !layerFeaturesMap[id]
    );

    if (layersToFetch.length > 0) {
      setFetchingFeatures(true);
      Promise.allSettled(
        layersToFetch.map((id) =>
          featuresAPI.list(id).then((res) => ({ id, data: res.data }))
        )
      )
        .then((results) => {
          const newMap = { ...layerFeaturesMap };
          results.forEach((r) => {
            if (r.status === 'fulfilled' && r.value) {
              const { id, data } = r.value;
              const features = data?.features || (Array.isArray(data) ? data : []);
              newMap[id] = features;
            }
          });
          setLayerFeaturesMap(newMap);
        })
        .finally(() => setFetchingFeatures(false));
    }
  }, [isOpen, sourceLayerId, targetLayerId, layerFeaturesMap]);

  // Helper to extract property field names from layer features
  const getLayerFields = (layerId) => {
    const layer = vectorLayers.find((l) => l.id === Number(layerId));
    const features = layerFeaturesMap[layerId] || (layer?.features?.features) || [];
    const fieldsSet = new Set(['_id']);

    features.slice(0, 50).forEach((f) => {
      const props = f.properties || {};
      Object.keys(props).forEach((k) => {
        if (!['geom', 'the_geom', 'geometry_type'].includes(k)) {
          fieldsSet.add(k);
        }
      });
    });

    return Array.from(fieldsSet);
  };

  const sourceFields = useMemo(() => getLayerFields(sourceLayerId), [sourceLayerId, layerFeaturesMap, vectorLayers]);
  const targetFields = useMemo(() => getLayerFields(targetLayerId), [targetLayerId, layerFeaturesMap, vectorLayers]);

  // Set default matching fields
  useEffect(() => {
    if (sourceFields.length > 0 && !sourceMatchField) {
      const preferred = sourceFields.find((f) => ['id', 'code', 'ward_no', 'parcel_id', 'building_id', 'fid'].includes(f.toLowerCase())) || sourceFields[0];
      setSourceMatchField(preferred);
    }
  }, [sourceFields, sourceMatchField]);

  useEffect(() => {
    if (targetFields.length > 0 && !targetMatchField) {
      const preferred = targetFields.find((f) => ['id', 'code', 'ward_no', 'parcel_id', 'building_id', 'fid'].includes(f.toLowerCase())) || targetFields[0];
      setTargetMatchField(preferred);
    }
  }, [targetFields, targetMatchField]);

  const sourceLayer = vectorLayers.find((l) => l.id === Number(sourceLayerId));
  const targetLayer = vectorLayers.find((l) => l.id === Number(targetLayerId));

  const generatedFieldName = useMemo(() => {
    if (useCustomFieldName && customFieldName.trim()) {
      return customFieldName.trim();
    }
    return generateDefaultFieldName(targetLayer?.name);
  }, [targetLayer?.name, useCustomFieldName, customFieldName]);

  if (!isOpen) return null;

  const handleExecuteLink = async (e) => {
    e.preventDefault();
    if (!sourceLayerId || !targetLayerId) {
      setError('कृपया स्रोत र लक्षित दुवै भेक्टर तहहरू छान्नुहोस्');
      return;
    }
    if (Number(sourceLayerId) === Number(targetLayerId)) {
      setError('स्रोत र लक्षित तह फरक हुनुपर्छ');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const payload = {
      target_layer_id: Number(targetLayerId),
      target_id_field: targetIdField || '_id',
      link_method: linkMethod,
      source_match_field: linkMethod === 'attribute' ? sourceMatchField : null,
      target_match_field: linkMethod === 'attribute' ? targetMatchField : null,
      spatial_predicate: linkMethod === 'spatial' ? spatialPredicate : null,
      custom_field_name: useCustomFieldName && customFieldName.trim() ? customFieldName.trim() : null,
      overwrite_existing: overwriteExisting,
    };

    try {
      const res = await layersAPI.link(Number(sourceLayerId), payload);
      setResult(res.data);
      if (onLinkedSuccess) {
        onLinkedSuccess({
          sourceLayerId: Number(sourceLayerId),
          targetLayerId: Number(targetLayerId),
          fieldName: res.data.linked_attribute_name,
          linkedCount: res.data.linked_count,
        });
      }
    } catch (err) {
      console.error('[LinkLayersModal] Error linking layers:', err);
      setError(err.response?.data?.detail || err.message || 'तहहरू जोड्न असफल भयो');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in font-sans">
      <div
        className="w-full max-w-xl bg-white border border-gov-blue-300 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92dvh]"
        id="link-vector-layers-modal"
      >
        {/* Pinned Header Banner */}
        <div className="bg-gov-blue-800 text-white px-4 py-3 flex items-center justify-between shrink-0 shadow-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gov-blue-700 border border-gov-blue-600 flex items-center justify-center text-gov-gold-400 shrink-0">
              <Link2 className="w-4.5 h-4.5" />
            </div>
            <div className="truncate">
              <h2 className="text-sm sm:text-base font-bold font-nepali truncate leading-tight">
                भेक्टर तह फिचर सम्बन्ध व्यवस्थापन (Link Layers)
              </h2>
              <span className="text-[10.5px] text-gov-blue-200 block truncate">
                स्रोत र लक्षित तहका फिचरहरू बीच सम्बन्ध (Feature-to-Feature Relationship)
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-1 rounded-lg transition-colors shrink-0"
            title="बन्द गर्नुहोस् (Close)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleExecuteLink} className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 overscroll-contain text-xs text-slate-800">
          
          {/* Error Message Alert */}
          {error && (
            <div className="p-3 bg-gov-red-50 border border-gov-red-200 text-gov-red-800 rounded-xl flex items-start gap-2.5 text-xs font-semibold animate-slide-up">
              <AlertCircle className="w-4 h-4 text-gov-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {/* Success Message Alert */}
          {result && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl flex flex-col gap-2 animate-slide-up shadow-xs">
              <div className="flex items-center gap-2 font-bold font-nepali text-sm text-emerald-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>सम्बन्ध सफलतापूर्वक कायम भयो (Link Established!)</span>
              </div>
              <div className="text-xs text-emerald-950 pl-7 space-y-1 font-nepali leading-relaxed">
                <p>
                  &bull; स्रोत तह: <strong>{result.source_layer_name}</strong> (जम्मा: {result.total_source_features} फिचर)
                </p>
                <p>
                  &bull; लक्षित तह: <strong>{result.target_layer_name}</strong>
                </p>
                <p>
                  &bull; नयाँ थपिएको विशेषता फिल्ड:{' '}
                  <code className="px-1.5 py-0.5 rounded bg-emerald-200/80 font-mono font-bold text-emerald-950 text-[11px]">
                    {result.linked_attribute_name}
                  </code>
                </p>
                <p>
                  &bull; जोडिएका फिचर संख्या:{' '}
                  <span className="font-bold text-emerald-900 font-mono text-sm">{result.linked_count}</span> (
                  <span className="font-mono">{result.matched_percentage}%</span> मिलान)
                </p>
              </div>
            </div>
          )}

          {/* Step 1 & 2: Source Layer & Target Layer Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            {/* Source Layer */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gov-blue-950 font-nepali flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-gov-blue-800 shrink-0" />
                <span>१. स्रोत भेक्टर तह (Source Layer):</span>
              </label>
              <select
                value={sourceLayerId}
                onChange={(e) => {
                  setSourceLayerId(e.target.value);
                  setResult(null);
                }}
                className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-gov-blue-800 font-medium cursor-pointer shadow-2xs"
                required
              >
                <option value="" disabled>स्रोत तह छान्नुहोस्...</option>
                {vectorLayers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.geometry_type?.toLowerCase() || 'geom'}) {l.is_global ? '[Global]' : '[Project]'}
                  </option>
                ))}
              </select>
              {sourceLayer && (
                <div className="text-[10px] text-slate-500 flex items-center gap-1.5 pl-0.5">
                  <span className="px-1.5 py-0.2 rounded bg-gov-blue-100 text-gov-blue-900 font-bold uppercase text-[9px]">
                    {sourceLayer.geometry_type || 'Geom'}
                  </span>
                  <span>{sourceLayer.feature_count ?? sourceFields.length} विशेषताहरू</span>
                </div>
              )}
            </div>

            {/* Target Layer */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gov-blue-950 font-nepali flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-gov-blue-800 shrink-0" />
                <span>२. लक्षित भेक्टर तह (Target Layer):</span>
              </label>
              <select
                value={targetLayerId}
                onChange={(e) => {
                  setTargetLayerId(e.target.value);
                  setResult(null);
                }}
                className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-gov-blue-800 font-medium cursor-pointer shadow-2xs"
                required
              >
                <option value="" disabled>लक्षित तह छान्नुहोस्...</option>
                {vectorLayers
                  .filter((l) => l.id !== Number(sourceLayerId))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.geometry_type?.toLowerCase() || 'geom'}) {l.is_global ? '[Global]' : '[Project]'}
                    </option>
                  ))}
              </select>
              {targetLayer && (
                <div className="text-[10px] text-slate-500 flex items-center gap-1.5 pl-0.5">
                  <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-900 font-bold uppercase text-[9px]">
                    {targetLayer.geometry_type || 'Geom'}
                  </span>
                  <span>{targetLayer.feature_count ?? targetFields.length} विशेषताहरू</span>
                </div>
              )}
            </div>
          </div>

          {/* Step 3: Relationship Method Selection */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-gov-blue-950 font-nepali flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-gov-blue-800 shrink-0" />
              <span>३. सम्बन्ध स्थापना विधि (Linking Criteria):</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Method A: Attribute Matching */}
              <button
                type="button"
                onClick={() => setLinkMethod('attribute')}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 cursor-pointer ${
                  linkMethod === 'attribute'
                    ? 'bg-gov-blue-50/90 border-gov-blue-800 ring-1 ring-gov-blue-800 shadow-xs'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gov-blue-950 font-nepali text-xs">
                    विशेषता मान मिलान (Attribute Match)
                  </span>
                  {linkMethod === 'attribute' && <Check className="w-4 h-4 text-gov-blue-800" />}
                </div>
                <p className="text-[10px] text-slate-600 leading-normal font-nepali">
                  दुवै तहमा समान कोड, नम्बर वा नाम भएका फिचरहरू आपसमा जोड्ने (e.g. ward_no, parcel_id, name)।
                </p>
              </button>

              {/* Method B: Spatial Overlay */}
              <button
                type="button"
                onClick={() => setLinkMethod('spatial')}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 cursor-pointer ${
                  linkMethod === 'spatial'
                    ? 'bg-gov-blue-50/90 border-gov-blue-800 ring-1 ring-gov-blue-800 shadow-xs'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gov-blue-950 font-nepali text-xs">
                    भौगोलिक सम्बन्ध (Spatial Predicate)
                  </span>
                  {linkMethod === 'spatial' && <Check className="w-4 h-4 text-gov-blue-800" />}
                </div>
                <p className="text-[10px] text-slate-600 leading-normal font-nepali">
                  नक्सामा भौगोलिक रूपमा खप्टिएका वा भित्र परेका फिचरहरू आपसमा जोड्ने (ST_Intersects, ST_Within)।
                </p>
              </button>
            </div>

            {/* Method Details: Attribute Match Fields Selector */}
            {linkMethod === 'attribute' && (
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2.5 animate-slide-up mt-2">
                <div className="text-[10.5px] font-bold text-slate-700 font-nepali flex items-center gap-1">
                  <Filter className="w-3 h-3 text-gov-blue-800" />
                  <span>मिल्दोजुल्दो विशेषता फिल्डहरू छान्नुहोस् (Matching Fields):</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">
                      स्रोत तहको फिल्ड (Source Match Field):
                    </label>
                    <select
                      value={sourceMatchField}
                      onChange={(e) => setSourceMatchField(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-800 font-mono outline-none focus:border-gov-blue-800 cursor-pointer"
                    >
                      {sourceFields.map((f) => (
                        <option key={f} value={f}>
                          {f} {f === '_id' ? '(Feature ID)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">
                      लक्षित तहको मिल्दो फिल्ड (Target Match Field):
                    </label>
                    <select
                      value={targetMatchField}
                      onChange={(e) => setTargetMatchField(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-800 font-mono outline-none focus:border-gov-blue-800 cursor-pointer"
                    >
                      {targetFields.map((f) => (
                        <option key={f} value={f}>
                          {f} {f === '_id' ? '(Feature ID)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Method Details: Spatial Predicate Selector */}
            {linkMethod === 'spatial' && (
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 animate-slide-up mt-2">
                <label className="text-[10.5px] font-bold text-slate-700 font-nepali block">
                  भौगोलिक सम्बन्ध प्रकार (Spatial Operator):
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {[
                    { id: 'intersects', label: 'खप्टिएको (Intersects)', desc: 'कुनै पनि भाग छोएको' },
                    { id: 'within', label: 'भित्र परेको (Within)', desc: 'स्रोत लक्षितभित्र रहेको' },
                    { id: 'contains', label: 'समावेश भएको (Contains)', desc: 'लक्षितलाई ढाकेको' },
                    { id: 'nearest', label: 'सबैभन्दा नजिक (Nearest)', desc: 'नजिकको दुरीमा' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSpatialPredicate(p.id)}
                      className={`p-2 rounded-lg border text-left text-[11px] font-nepali transition-all cursor-pointer ${
                        spatialPredicate === p.id
                          ? 'bg-gov-blue-800 text-white font-bold border-gov-blue-900 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="font-bold truncate">{p.label}</div>
                      <div className={`text-[9px] truncate ${spatialPredicate === p.id ? 'text-gov-blue-200' : 'text-slate-400'}`}>
                        {p.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Step 4: Prompt User for Target Layer ID/Attribute Field to Store */}
          <div className="bg-gov-gold-50/70 border border-gov-gold-300 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-amber-950 font-nepali flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>४. लक्षित तहबाट कुन ID/विशेषता भण्डारण गर्ने? (Target ID to Store):</span>
              </label>
              <span className="text-[10px] text-amber-800 font-semibold uppercase font-mono">Prompt</span>
            </div>
            <p className="text-[10px] text-slate-600 font-nepali leading-relaxed">
              सम्बन्ध स्थापित भएपछि लक्षित तहको कुन मान (Value) स्रोत तहमा सिर्जना हुने नयाँ फिल्डमा राख्न चाहनुहुन्छ?
            </p>
            <div className="flex items-center gap-2">
              <select
                value={targetIdField}
                onChange={(e) => setTargetIdField(e.target.value)}
                className="flex-1 bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono font-medium outline-none focus:border-amber-600 cursor-pointer shadow-2xs"
              >
                <option value="_id">_id (फिचर प्रणाली ID - Default System ID)</option>
                {targetFields
                  .filter((f) => f !== '_id')
                  .map((f) => (
                    <option key={f} value={f}>
                      {f} (विशेषता मान / Property Value)
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Step 5: Automatically Created Attribute Name Preview */}
          <div className="bg-slate-100/90 border border-slate-300 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-800 font-nepali flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-gov-blue-800 shrink-0" />
                <span>५. स्रोत तहमा स्वतः बन्ने नयाँ विशेषता फिल्ड (New Attribute Field):</span>
              </label>
              <button
                type="button"
                onClick={() => setUseCustomFieldName(!useCustomFieldName)}
                className="text-[10px] text-gov-blue-800 hover:text-gov-blue-950 underline font-semibold font-nepali cursor-pointer"
              >
                {useCustomFieldName ? 'स्वतः नाम राख्नुहोस् (Default)' : 'नाम परिवर्तन गर्नुहोस् (Custom Name)'}
              </button>
            </div>

            {useCustomFieldName ? (
              <input
                type="text"
                value={customFieldName}
                onChange={(e) => setCustomFieldName(e.target.value)}
                placeholder={generateDefaultFieldName(targetLayer?.name)}
                className="w-full bg-white border border-gov-blue-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono font-bold outline-none focus:border-gov-blue-800"
              />
            ) : (
              <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200">
                <code className="text-xs font-mono font-bold text-gov-blue-900 flex-1 truncate">
                  {generatedFieldName}
                </code>
                <span className="text-[9.5px] px-2 py-0.5 rounded bg-gov-blue-100 text-gov-blue-900 font-bold font-nepali shrink-0">
                  स्वतः सिर्जना हुने
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="overwrite-link-prop"
                checked={overwriteExisting}
                onChange={(e) => setOverwriteExisting(e.target.checked)}
                className="rounded border-slate-300 text-gov-blue-800 focus:ring-gov-blue-800 cursor-pointer"
              />
              <label htmlFor="overwrite-link-prop" className="text-[10.5px] text-slate-700 font-nepali cursor-pointer">
                पहिले नै सम्बन्धित मान भएमा नयाँ मानले ओभरराइट गर्ने (Overwrite existing values)
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2 shrink-0 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold font-nepali transition-colors"
            >
              रद्द गर्नुहोस् (Cancel)
            </button>

            <button
              type="submit"
              disabled={loading || fetchingFeatures || !sourceLayerId || !targetLayerId}
              className={`py-2 px-5 rounded-xl text-white text-xs font-bold font-nepali flex items-center gap-2 shadow-md transition-all cursor-pointer active:scale-98 ${
                loading || fetchingFeatures || !sourceLayerId || !targetLayerId
                  ? 'bg-slate-400 cursor-not-allowed opacity-70'
                  : 'bg-gov-blue-800 hover:bg-gov-blue-900 shadow-gov-blue-900/20'
              }`}
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>सम्बन्ध कायम गर्दै...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-gov-gold-400 fill-gov-gold-400" />
                  <span>सम्बन्ध कायम गर्नुहोस् (Establish Link)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
