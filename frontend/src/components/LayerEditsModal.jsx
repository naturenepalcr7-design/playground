'use client';

import { useState, useEffect } from 'react';
import {
  X, History, Sparkles, Filter, Search, Loader2,
  Calendar, User, Tag, Layers, CheckCircle2, AlertTriangle,
  Maximize2, Eye, Trash2, Edit3, PlusCircle
} from 'lucide-react';
import { layersAPI } from '../lib/api';

/**
 * Formats ISO date string to readable Nepali/Local format
 */
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
      second: '2-digit',
    });
  } catch (e) {
    return isoStr;
  }
}

export default function LayerEditsModal({
  isOpen,
  onClose,
  layer,
  onZoomToFeature = null,
  currentUser = null,
  isAdmin = false,
}) {
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'audit'
  const [searchTerm, setSearchTerm] = useState('');
  const [collectorFilter, setCollectorFilter] = useState('all');
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Load audit logs when modal opens
  useEffect(() => {
    if (!isOpen || !layer?.id) return;
    setLoadingAudit(true);
    layersAPI.getAuditEdits(layer.id, 200)
      .then((res) => {
        setAuditLogs(res.data?.edits || []);
      })
      .catch((err) => {
        console.error('[LayerEditsModal] Failed to fetch layer audit edits:', err);
      })
      .finally(() => {
        setLoadingAudit(false);
      });
  }, [isOpen, layer?.id]);

  if (!isOpen || !layer) return null;

  // Extract edited features from current layer.features
  const allFeatures = layer.features?.features || [];
  const activeEditedFeatures = allFeatures
    .map((f) => {
      const p = f.properties || {};
      const fid = f.id || p._id;
      const createdBy = p._created_by;
      const updatedBy = p._updated_by;
      const creatorUsername = p._created_by_username || p.Kmc_Editor || '';
      const creatorName = p._created_by_name || '';
      const updaterUsername = p._updated_by_username || '';
      const updaterName = p._updated_by_name || '';
      const version = p._version || 1;
      const isUpdated = (version > 1) || updatedBy != null;
      const editType = isUpdated ? 'update' : 'create';
      const effectiveEditor = isUpdated
        ? (updaterName ? `${updaterName} (@${updaterUsername})` : (updaterUsername || p.Kmc_Editor || `प्रयोगकर्ता #${updatedBy}`))
        : (creatorName ? `${creatorName} (@${creatorUsername})` : (creatorUsername || p.Kmc_Editor || `प्रयोगकर्ता #${createdBy}`));

      const timestamp = isUpdated ? (p._updated_at || p._created_at) : p._created_at;

      return {
        id: fid,
        rawFeature: f,
        editType,
        version,
        createdBy,
        creatorUsername,
        updatedBy,
        updaterUsername,
        effectiveEditor,
        editorUsername: isUpdated ? (updaterUsername || p.Kmc_Editor) : (creatorUsername || p.Kmc_Editor),
        timestamp,
        properties: p,
      };
    })
    .filter((f) => {
      // Must be created/edited by a collector or have edit tracking
      return f.createdBy != null || f.updatedBy != null || f.editorUsername;
    });

  // Extract list of unique collectors for filter dropdown
  const uniqueCollectors = Array.from(
    new Set(
      activeEditedFeatures
        .map((f) => f.editorUsername)
        .filter(Boolean)
    )
  );

  // Filter active edits based on user selection / role
  const filteredActiveEdits = activeEditedFeatures.filter((item) => {
    // If not admin, collector only sees their own edits
    if (!isAdmin) {
      const myUsername = (currentUser?.username || '').toLowerCase();
      const myId = currentUser?.id;
      const isMine = (
        (myId != null && (item.createdBy === myId || item.updatedBy === myId)) ||
        (myUsername && (item.editorUsername || '').toLowerCase() === myUsername)
      );
      if (!isMine) return false;
    } else if (collectorFilter !== 'all') {
      if ((item.editorUsername || '').toLowerCase() !== collectorFilter.toLowerCase()) {
        return false;
      }
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchesId = String(item.id).includes(q);
      const matchesEditor = (item.effectiveEditor || '').toLowerCase().includes(q);
      const matchesProps = JSON.stringify(item.properties).toLowerCase().includes(q);
      return matchesId || matchesEditor || matchesProps;
    }
    return true;
  });

  // Filter audit logs (especially deleted features)
  const deletedLogs = auditLogs.filter((l) => l.edit_type === 'delete');
  const filteredDeletedLogs = deletedLogs.filter((item) => {
    if (!isAdmin) {
      const myUsername = (currentUser?.username || '').toLowerCase();
      const myId = currentUser?.id;
      const isMine = (myId != null && item.user_id === myId) || (myUsername && (item.username || '').toLowerCase() === myUsername);
      if (!isMine) return false;
    } else if (collectorFilter !== 'all') {
      if ((item.username || '').toLowerCase() !== collectorFilter.toLowerCase()) {
        return false;
      }
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        String(item.feature_id).includes(q) ||
        (item.username || '').toLowerCase().includes(q) ||
        (item.full_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const createdCount = filteredActiveEdits.filter((e) => e.editType === 'create').length;
  const updatedCount = filteredActiveEdits.filter((e) => e.editType === 'update').length;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-fade-in font-sans">
      <div className="bg-white rounded-2xl shadow-2xl border border-gov-blue-300 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90dvh] animate-slide-up">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-gov-blue-900 via-gov-blue-800 to-gov-blue-950 text-white px-4 py-3 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-white/10 text-gov-gold-400">
              <History className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold font-nepali truncate flex items-center gap-1.5">
                <span>सम्पादन रेकर्ड विवरण:</span>
                <span className="text-gov-gold-300 underline underline-offset-2">{layer.name}</span>
              </h2>
              <p className="text-[10px] text-white/80 font-nepali">
                तह आइडी #{layer.id} &middot; कुल {allFeatures.length} फिचरहरू मध्ये {activeEditedFeatures.length} सम्पादित
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Edit Summary Metric Cards */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 grid grid-cols-3 gap-2 text-center shrink-0">
          <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[10px] text-slate-500 font-nepali block">कुल सम्पादन (Total)</span>
            <span className="text-base font-black text-gov-blue-900 font-mono">
              {filteredActiveEdits.length}
            </span>
          </div>
          <div className="bg-amber-50/80 p-2 rounded-xl border border-amber-200 shadow-xs">
            <span className="text-[10px] text-amber-800 font-bold font-nepali flex items-center justify-center gap-1">
              <PlusCircle className="w-3 h-3 text-amber-600" />
              नयाँ सिर्जना (Created)
            </span>
            <span className="text-base font-black text-amber-700 font-mono">
              {createdCount}
            </span>
          </div>
          <div className="bg-cyan-50/80 p-2 rounded-xl border border-cyan-200 shadow-xs">
            <span className="text-[10px] text-cyan-800 font-bold font-nepali flex items-center justify-center gap-1">
              <Edit3 className="w-3 h-3 text-cyan-600" />
              परिमार्जित (Updated)
            </span>
            <span className="text-base font-black text-cyan-700 font-mono">
              {updatedCount}
            </span>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px] font-nepali font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={`px-3 py-1 rounded-md transition-all ${
                activeTab === 'active'
                  ? 'bg-white text-gov-blue-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              सक्रिय सम्पादन ({filteredActiveEdits.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1 rounded-md transition-all ${
                activeTab === 'audit'
                  ? 'bg-white text-gov-red-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              मेटाइएका फिचरहरू ({deletedLogs.length})
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 justify-end min-w-[240px]">
            {/* Collector Dropdown Filter (Admin only) */}
            {isAdmin && (
              <div className="flex items-center gap-1 text-[11px] font-nepali">
                <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={collectorFilter}
                  onChange={(e) => setCollectorFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-800 outline-none focus:border-gov-blue-700 font-medium"
                >
                  <option value="all">⚡ सबै संकलनकर्ता (All)</option>
                  {uniqueCollectors.map((c) => (
                    <option key={c} value={c}>
                      @{c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Quick Search */}
            <div className="relative w-36 sm:w-44">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="खोज्नुहोस् (Search ID)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-2 py-1 text-[11px] bg-slate-50 border border-slate-300 rounded-lg outline-none focus:border-gov-blue-700"
              />
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-y-auto flex-1 p-3 overscroll-contain scrollbar-thin">
          {activeTab === 'active' && (
            filteredActiveEdits.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center text-slate-400">
                <History className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-xs font-nepali font-semibold text-slate-600">कुनै सम्पादित फिचरहरू फेला परेनन्</p>
                <p className="text-[10px] text-slate-400 font-nepali mt-0.5">
                  छनोट गरिएको फिल्टर अनुसार यस तहमा कुनै सम्पादन उपलब्ध छैन।
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredActiveEdits.map((item) => {
                  const isCreate = item.editType === 'create';
                  return (
                    <div
                      key={item.id}
                      className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2.5 ${
                        isCreate
                          ? 'bg-amber-50/40 border-amber-200 hover:border-amber-400'
                          : 'bg-cyan-50/40 border-cyan-200 hover:border-cyan-400'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 font-mono font-bold text-xs shadow-xs ${
                            isCreate
                              ? 'bg-amber-500 text-white'
                              : 'bg-cyan-600 text-white'
                          }`}
                        >
                          #{item.id}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold font-nepali flex items-center gap-1 ${
                                isCreate
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-cyan-100 text-cyan-900 border border-cyan-300'
                              }`}
                            >
                              {isCreate ? <PlusCircle className="w-2.5 h-2.5" /> : <Edit3 className="w-2.5 h-2.5" />}
                              <span>{isCreate ? 'नयाँ सिर्जना (Created)' : `परिमार्जित (v${item.version})`}</span>
                            </span>
                            <span className="text-[11px] font-bold text-slate-800 font-nepali truncate">
                              {item.effectiveEditor}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5 font-nepali">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              <span>{formatDateTime(item.timestamp)}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {onZoomToFeature && (
                        <button
                          type="button"
                          onClick={() => {
                            onZoomToFeature(item.rawFeature?.geometry, null, item.rawFeature);
                            onClose();
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold font-nepali bg-white hover:bg-gov-blue-800 text-gov-blue-800 hover:text-white border border-gov-blue-300 rounded-lg shadow-xs transition-all flex items-center gap-1 shrink-0"
                          title="यस फिचरमा जुम गर्नुहोस्"
                        >
                          <Maximize2 className="w-3 h-3" />
                          <span>नक्सामा हेर्नुहोस्</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {activeTab === 'audit' && (
            loadingAudit ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-gov-blue-700" />
                <span className="text-xs font-nepali">अडिट रेकर्ड लोड हुँदैछ...</span>
              </div>
            ) : filteredDeletedLogs.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center text-slate-400">
                <Trash2 className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-xs font-nepali font-semibold text-slate-600">कुनै मेटाइएका फिचरहरू छैनन्</p>
                <p className="text-[10px] text-slate-400 font-nepali mt-0.5">
                  यस तहमा कुनै फिचर मेटाइएको अडिट रेकर्ड भेटिएन।
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredDeletedLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-xl border border-rose-200 bg-rose-50/40 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 font-mono font-bold text-xs shadow-xs">
                        #{log.feature_id}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold font-nepali bg-rose-100 text-rose-900 border border-rose-300 flex items-center gap-1">
                            <Trash2 className="w-2.5 h-2.5" />
                            <span>मेटाइएको फिचर (Deleted)</span>
                          </span>
                          <span className="text-[11px] font-bold text-slate-800 font-nepali">
                            {log.full_name ? `${log.full_name} (@${log.username})` : `@${log.username}`}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5 font-nepali">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{formatDateTime(log.timestamp)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs font-nepali shrink-0">
          <span className="text-[11px] text-slate-500">
            काठमाडौँ महानगरपालिका भू-सूचना प्रणाली &middot; सम्पादन अडिट ट्रयाकिङ
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-200 text-slate-700 font-bold border border-slate-300 shadow-xs transition-colors"
          >
            बन्द गर्नुहोस् (Close)
          </button>
        </div>
      </div>
    </div>
  );
}
