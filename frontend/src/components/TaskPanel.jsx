'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Grid3X3, Lock, Unlock, CheckCircle2, XCircle, Send,
  ChevronRight, Filter, BarChart3, X, Loader2, Upload,
  Users, UserCheck, RefreshCw, Layers, Sparkles, Check,
  Hexagon, Square, Triangle, FileUp, ArrowRight, UserPlus,
  AlertCircle, Shield, Info, CheckSquare, Square as UncheckedSquare,
  Edit3, PenTool, MousePointerClick, Trash2, RotateCcw,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { tasksAPI, projectsAPI, usersAPI } from '../lib/api';

/**
 * TaskPanel Component — Official Nepal Government WebGIS Standard
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 * Comprehensive Field Task & Grid Management Console
 *
 * Supported Features:
 * 1. Method A — Upload Boundary (Multi-Polygon -> individual tasks, Single Polygon -> grid or single task)
 * 2. Method B — Generate Grid directly from Map Canvas Drawing or Project Boundary (Square, Hexagon, Triangle)
 * 3. Individual & Bulk Task Assignment to Data Collectors
 * 4. Automatic Round-Robin Task Distribution
 * 5. Lifecycle Management (Lock, Unlock, Submit, Validate, Invalidate, Reassign)
 * 6. Reset All Task Grids
 */

const STATUS_CONFIG = {
  READY: { label: 'तयार (Ready)', badge: 'bg-blue-50 text-gov-blue-800 border-gov-blue-200', color: '#0447af' },
  LOCKED_FOR_MAPPING: { label: 'कार्य भइरहेको (Locked)', badge: 'bg-amber-50 text-amber-800 border-amber-200', color: '#d97706' },
  MAPPED: { label: 'म्याप सम्पन्न (Mapped)', badge: 'bg-emerald-50 text-emerald-800 border-emerald-200', color: '#059669' },
  LOCKED_FOR_VALIDATION: { label: 'प्रमाणीकरणमा (Validating)', badge: 'bg-purple-50 text-purple-800 border-purple-200', color: '#7c3aed' },
  VALIDATED: { label: 'प्रमाणीकृत (Validated)', badge: 'bg-teal-50 text-teal-800 border-teal-200', color: '#0891b2' },
  INVALIDATED: { label: 'अस्वीकृत (Invalidated)', badge: 'bg-red-50 text-gov-red-700 border-red-200', color: '#c8102e' },
};

export default function TaskPanel({
  tasks = [],
  selectedTask,
  onTaskSelect,
  onTaskAction,
  onClose,
  loading = false,
  activeProject,
  projects = [],
  onSelectProject,
  onRefreshTasks,
  onStartDrawBoundary,
  drawnBoundary = null,
  isDrawingBoundary = false,
  onClearDrawnBoundary,
  outlinedTaskIds = new Set(),
  onToggleTaskOutline = null,
  onToggleAllTasksOutline = null,
  outlineAllTasks = false,
}) {
  const { user, isAdmin, isCollector, isValidator } = useAuth();

  // ---- Navigation Tabs ----
  const taskList = tasks?.features || [];
  const hasTasks = taskList.length > 0;
  const [activeTab, setActiveTab] = useState(hasTasks || !isAdmin ? 'list' : 'methodB');

  // If tasks become available/empty, adjust tab accordingly
  useEffect(() => {
    if (!hasTasks && activeTab === 'list' && isAdmin) {
      setActiveTab('methodB');
    }
  }, [hasTasks, activeTab, isAdmin]);

  // ---- Users / Collectors List ----
  const [collectors, setCollectors] = useState([]);
  const [collectorsLoading, setCollectorsLoading] = useState(false);

  // ---- Filter States ----
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [collectorFilter, setCollectorFilter] = useState('ALL'); // 'ALL', 'UNASSIGNED', or user_id
  const [searchTerm, setSearchTerm] = useState('');
  const [showStats, setShowStats] = useState(true);

  // ---- Bulk Selection State ----
  const [selectedTaskIds, setSelectedTaskIds] = useState(new Set());
  const [bulkCollectorId, setBulkCollectorId] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [autoDistributeLoading, setAutoDistributeLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAutoDistributeConfirm, setShowAutoDistributeConfirm] = useState(false);

  // ---- Method A (Upload Boundary) State ----
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadParsedInfo, setUploadParsedInfo] = useState(null); // { count, isMulti, geometries }
  const [uploadMethodType, setUploadMethodType] = useState('IMPORT_ALL_AS_TASKS'); // 'IMPORT_ALL_AS_TASKS' | 'GENERATE_GRID' | 'SINGLE_TASK'
  const [uploadGridType, setUploadGridType] = useState('SQUARE');
  const [uploadGridSize, setUploadGridSize] = useState(100);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);

  // ---- Method B (Generate Grid from Canvas / Boundary) State ----
  const [methodBSource, setMethodBSource] = useState('CANVAS'); // 'CANVAS' | 'PROJECT_BOUNDARY'
  const [methodBGridType, setMethodBGridType] = useState(activeProject?.grid_type || 'SQUARE');
  const [methodBGridSize, setMethodBGridSize] = useState(activeProject?.grid_size_m || 100);
  const [methodBSubmitting, setMethodBSubmitting] = useState(false);

  // ---- Feedback Notifications ----
  const [feedback, setFeedback] = useState(null);

  // Load collectors on mount or when admin opens
  useEffect(() => {
    if (isAdmin) {
      setCollectorsLoading(true);
      usersAPI.list()
        .then((res) => {
          const userList = Array.isArray(res.data) ? res.data : [];
          setCollectors(userList.filter((u) => u.role === 'DataCollector' || u.role === 'GisAdmin'));
        })
        .catch(console.error)
        .finally(() => setCollectorsLoading(false));
    }
  }, [isAdmin]);

  // Compute Task Statistics
  const stats = useMemo(() => {
    const s = {
      TOTAL: taskList.length,
      UNASSIGNED: 0,
      ASSIGNED: 0,
      READY: 0,
      LOCKED_FOR_MAPPING: 0,
      MAPPED: 0,
      LOCKED_FOR_VALIDATION: 0,
      VALIDATED: 0,
      INVALIDATED: 0,
    };
    taskList.forEach((t) => {
      const p = t.properties || {};
      const status = p.status || 'READY';
      s[status] = (s[status] || 0) + 1;
      if (p.assigned_to) {
        s.ASSIGNED += 1;
      } else {
        s.UNASSIGNED += 1;
      }
    });
    return s;
  }, [taskList]);

  const progressPct = stats.TOTAL > 0 ? Math.round(((stats.VALIDATED + stats.MAPPED) / stats.TOTAL) * 100) : 0;

  // Filter Tasks List
  const filteredTasks = useMemo(() => {
    return taskList.filter((t) => {
      const p = t.properties || {};
      // Status filter
      if (statusFilter !== 'ALL' && p.status !== statusFilter) {
        return false;
      }
      // Collector filter
      if (collectorFilter === 'UNASSIGNED' && p.assigned_to) {
        return false;
      }
      if (collectorFilter === 'ASSIGNED' && !p.assigned_to) {
        return false;
      }
      if (collectorFilter !== 'ALL' && collectorFilter !== 'UNASSIGNED' && collectorFilter !== 'ASSIGNED') {
        if (String(p.assigned_to) !== String(collectorFilter)) {
          return false;
        }
      }
      // Search term filter (Task # or name)
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesIndex = String(p.grid_index).includes(query);
        const matchesName = (p.name || '').toLowerCase().includes(query);
        const matchesCollector = (p.assigned_to_name || '').toLowerCase().includes(query);
        if (!matchesIndex && !matchesName && !matchesCollector) {
          return false;
        }
      }
      return true;
    });
  }, [taskList, statusFilter, collectorFilter, searchTerm]);

  // ---- Pagination for High Performance with Large Task Datasets (5,000+ tasks) ----
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(40);

  // Auto-reset current page to 1 when filters or active project changes
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, collectorFilter, searchTerm, activeProject?.id]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedTasks = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [filteredTasks, safeCurrentPage, pageSize]);

  // Handle File Drag / Selection for Method A
  const handleFileChange = (file) => {
    if (!file) return;
    setUploadedFile(file);
    setUploadParsedInfo(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const geojson = JSON.parse(e.target.result);
        let rawFeatures = [];
        if (geojson.type === 'FeatureCollection') {
          rawFeatures = geojson.features || [];
        } else if (geojson.type === 'Feature') {
          rawFeatures = [geojson];
        } else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
          rawFeatures = [{ type: 'Feature', geometry: geojson, properties: {} }];
        }

        const polygonFeatures = rawFeatures.filter((f) => {
          const gtype = f.geometry?.type;
          return gtype === 'Polygon' || gtype === 'MultiPolygon' || gtype === 'GeometryCollection';
        });

        const isMulti = polygonFeatures.length > 1;
        setUploadParsedInfo({
          count: polygonFeatures.length,
          isMulti,
          features: polygonFeatures,
          filename: file.name,
        });

        if (isMulti) {
          setUploadMethodType('IMPORT_ALL_AS_TASKS');
        } else {
          setUploadMethodType('GENERATE_GRID');
        }
      } catch (err) {
        setFeedback({ type: 'error', text: 'अमान्य GeoJSON फाइल ढाँचा। कृपया मान्य .geojson फाइल छान्नुहोस्।' });
      }
    };
    reader.readAsText(file);
  };

  // Submit Method A — Upload Boundary
  const handleUploadBoundarySubmit = async (e) => {
    e.preventDefault();
    if (!activeProject?.id) {
      setFeedback({ type: 'error', text: 'कृपया पहिले परियोजना छान्नुहोस्।' });
      return;
    }
    if (!uploadedFile) {
      setFeedback({ type: 'error', text: 'कृपया सिमाना GeoJSON फाइल छान्नुहोस्।' });
      return;
    }

    setUploadSubmitting(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);
      formData.append('method', uploadMethodType);
      formData.append('grid_type', uploadGridType);
      formData.append('grid_size_m', String(uploadGridSize));

      const res = await projectsAPI.uploadBoundary(activeProject.id, formData);
      setFeedback({ type: 'success', text: res.data?.message || 'सिमाना तथा कार्यक्षेत्र सफलतापूर्वक सिर्जना भयो।' });
      setUploadedFile(null);
      setUploadParsedInfo(null);
      if (onRefreshTasks) await onRefreshTasks();
      setActiveTab('list');
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.detail || 'सिमाना अपलोड गर्न सकिएन।' });
    }
    setUploadSubmitting(false);
  };

  // Submit Method B — Generate Grid from Canvas Drawing or Boundary
  const handleMethodBSubmit = async (e) => {
    e.preventDefault();
    if (!activeProject?.id) {
      setFeedback({ type: 'error', text: 'कृपया पहिले परियोजना छान्नुहोस्।' });
      return;
    }

    if (methodBSource === 'CANVAS' && !drawnBoundary) {
      setFeedback({ type: 'error', text: 'कृपया पहिले नक्सा क्यानभासमा क्षेत्र कोर्नुहोस् (बहुभुज वा आयत छान्नुहोस्)।' });
      return;
    }

    setMethodBSubmitting(true);
    setFeedback(null);
    try {
      const payload = {
        grid_type: methodBGridType,
        grid_size_m: parseFloat(methodBGridSize),
      };
      if (methodBSource === 'CANVAS' && drawnBoundary) {
        payload.boundary_geojson = drawnBoundary;
      }

      const res = await projectsAPI.generateGrid(activeProject.id, payload);
      setFeedback({ type: 'success', text: res.data?.message || 'ग्रिड कार्यक्षेत्रहरू सफलतापूर्वक उत्पादन भयो।' });
      if (onClearDrawnBoundary) onClearDrawnBoundary();
      if (onRefreshTasks) await onRefreshTasks();
      setActiveTab('list');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.detail || 'ग्रिड उत्पादन गर्न सकिएन। नक्सामा क्षेत्र कोरेको वा सिमाना सेट भएको सुनिश्चित गर्नुहोस्।',
      });
    }
    setMethodBSubmitting(false);
  };

  // Single Task Assignment / Reassignment
  const handleSingleAssign = async (taskId, userId) => {
    if (!activeProject?.id) return;
    try {
      const targetUid = userId ? parseInt(userId, 10) : null;
      await tasksAPI.assign(activeProject.id, [taskId], targetUid);
      setFeedback({
        type: 'success',
        text: targetUid ? 'कार्यक्षेत्र सफलतापूर्वक संकलकलाई तोकियो।' : 'कार्यक्षेत्र तोकिएको हटाउनु सफल भयो (Unassigned)।',
      });
      if (onRefreshTasks) await onRefreshTasks();
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.detail || 'कार्य तोक्न सकिएन।' });
    }
  };

  // Bulk Task Assignment
  const handleBulkAssign = async () => {
    if (!activeProject?.id || selectedTaskIds.size === 0) return;
    setBulkActionLoading(true);
    try {
      const targetUid = bulkCollectorId ? parseInt(bulkCollectorId, 10) : null;
      const ids = Array.from(selectedTaskIds);
      await tasksAPI.assign(activeProject.id, ids, targetUid);
      setFeedback({
        type: 'success',
        text: `${ids.length} वटा कार्यक्षेत्र सफलतापूर्वक ${targetUid ? 'तोकियो' : 'हटाउनु सफल भयो'}।`,
      });
      setSelectedTaskIds(new Set());
      setBulkCollectorId('');
      if (onRefreshTasks) await onRefreshTasks();
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.detail || 'सामूहिक कार्य तोक्न सकिएन।' });
    }
    setBulkActionLoading(false);
  };

  // Auto-Distribute Tasks Trigger
  const handleAutoDistribute = () => {
    if (!activeProject?.id || collectors.length === 0) return;
    setShowAutoDistributeConfirm(true);
  };

  // Auto-Distribute Confirm Execution
  const confirmAutoDistribute = async () => {
    setAutoDistributeLoading(true);
    try {
      const collectorIds = collectors.map((c) => c.id);
      const res = await tasksAPI.autoDistribute(activeProject.id, collectorIds);
      setFeedback({ type: 'success', text: res.data?.message || 'कार्यक्षेत्रहरू समान रूपमा वितरण गरियो।' });
      setShowAutoDistributeConfirm(false);
      if (onRefreshTasks) await onRefreshTasks();
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.detail || 'वितरण गर्न सकिएन।' });
    }
    setAutoDistributeLoading(false);
  };

  // Reset / Delete All Task Grids Trigger
  const handleResetGrids = () => {
    if (!activeProject?.id) return;
    setShowResetConfirm(true);
  };

  // Reset / Delete All Task Grids Execution
  const confirmResetGrids = async () => {
    if (!activeProject?.id) return;
    setResetLoading(true);
    setFeedback(null);
    try {
      const res = await tasksAPI.reset(activeProject.id);
      setFeedback({
        type: 'success',
        text: res.data?.message || 'परियोजनाका सबै कार्य ग्रिड विभाजनहरू सफलतापूर्वक हटाइयो।',
      });
      setSelectedTaskIds(new Set());
      setShowResetConfirm(false);
      if (onClearDrawnBoundary) onClearDrawnBoundary();
      if (onRefreshTasks) await onRefreshTasks();
      setActiveTab('methodB');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.detail || 'ग्रिड विभाजन रिसेट गर्न सकिएन।',
      });
    }
    setResetLoading(false);
  };

  // Toggle Single Selection
  const toggleTaskSelection = (taskId) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  // Toggle Select All Filtered Tasks
  const toggleSelectAllFiltered = () => {
    if (selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(filteredTasks.map((t) => t.id || t.properties?.id)));
    }
  };

  // Get available actions for task lifecycle
  const getActions = (task) => {
    const s = task.properties?.status;
    const lockedBy = task.properties?.locked_by;
    const assignedTo = task.properties?.assigned_to;
    const actions = [];

    // Lock condition: Unassigned or assigned to current user, and role is collector or admin
    if (s === 'READY' || s === 'INVALIDATED') {
      const canLock = isAdmin || (isCollector && (!assignedTo || assignedTo === user?.id));
      if (canLock) {
        actions.push({ id: 'lock', label: 'नक्साङ्कनका लागि लक गर्नुहोस् (Lock)', icon: Lock, variant: 'btn-gov-primary' });
      }
    }
    if (s === 'LOCKED_FOR_MAPPING') {
      if (isAdmin || lockedBy === user?.id) {
        actions.push({ id: 'unlock', label: 'अनलक गर्नुहोस् (Unlock)', icon: Unlock, variant: 'btn-gov-secondary' });
        actions.push({ id: 'submit', label: 'पेश गर्नुहोस् (Submit Mapped)', icon: Send, variant: 'btn-gov-primary' });
      }
    }
    if (s === 'MAPPED') {
      if (isAdmin || isValidator) {
        actions.push({ id: 'validate', label: 'प्रमाणीकरण गर्नुहोस् (Validate)', icon: CheckCircle2, variant: 'btn-gov-primary' });
        actions.push({ id: 'invalidate', label: 'अस्वीकृत गर्नुहोस् (Invalidate)', icon: XCircle, variant: 'btn-gov-red' });
      }
    }

    return actions;
  };

  return (
    <div
      className="fixed inset-0 sm:inset-auto sm:top-3 sm:right-3 sm:bottom-3 sm:w-[480px] sm:max-w-[calc(100vw-24px)] w-full h-[100dvh] sm:h-auto bg-slate-50 border-0 sm:border border-slate-300 rounded-none sm:rounded-xl shadow-2xl z-50 flex flex-col min-h-0 overflow-hidden animate-slide-right font-sans pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
      id="task-panel"
    >
      {/* 1. Header & Project Switcher */}
      <div className="bg-gov-blue-800 text-white p-3.5 flex flex-col gap-2 shrink-0 rounded-none sm:rounded-t-xl border-b border-gov-blue-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gov-blue-950 flex items-center justify-center text-gov-gold-400 border border-gov-blue-700/50 shadow-xs">
              <Grid3X3 className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-xs font-bold font-nepali tracking-wide leading-tight text-white flex items-center gap-1.5">
                कार्य विभाजन ग्रिड (Task Grid Management)
              </h2>
              <span className="text-[10px] text-gov-blue-200">
                काठमाडौँ महानगरपालिका WebGIS
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/90 hover:text-white hover:bg-gov-red-700/90 px-2 py-1 rounded-lg transition-colors flex items-center gap-1 text-xs font-bold border border-white/20 hover:border-gov-red-500 shadow-xs"
            title="बन्द गर्नुहोस् (Close Task Panel)"
          >
            <span className="text-[10px]">बन्द</span>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Project Selector Dropdown */}
        {projects.length > 0 && onSelectProject && (
          <div className="flex items-center gap-2 pt-1 border-t border-gov-blue-700/60">
            <span className="text-[10px] font-bold text-gov-blue-200 uppercase shrink-0">परियोजना:</span>
            <select
              value={activeProject?.id || ''}
              onChange={(e) => {
                const target = projects.find((p) => String(p.id) === e.target.value);
                if (target) onSelectProject(target);
              }}
              className="bg-gov-blue-950 text-white text-xs rounded px-2 py-1 border border-gov-blue-700 w-full font-medium focus:outline-hidden focus:ring-1 focus:ring-gov-gold-400"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.status ? `(${p.status})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 2. Navigation Tabs Ribbon */}
      <div className="bg-white border-b border-slate-200 px-3 flex items-center gap-1 shrink-0 overflow-x-auto">
        <button
          onClick={() => setActiveTab('list')}
          className={`py-2 px-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all ${
            activeTab === 'list'
              ? 'border-gov-blue-800 text-gov-blue-800'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>कार्यहरू ({stats.TOTAL})</span>
        </button>

        {isAdmin && (
          <>
            <button
              onClick={() => setActiveTab('methodA')}
              className={`py-2 px-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all ${
                activeTab === 'methodA'
                  ? 'border-gov-blue-800 text-gov-blue-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>विधि A: सिमाना अपलोड</span>
            </button>

            <button
              onClick={() => setActiveTab('methodB')}
              className={`py-2 px-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all ${
                activeTab === 'methodB'
                  ? 'border-gov-blue-800 text-gov-blue-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-gov-gold-500" />
              <span>विधि B: ग्रिड उत्पादन</span>
            </button>
          </>
        )}
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-2.5 mx-3 mt-2.5 rounded-lg border text-xs flex items-center justify-between animate-fade-in ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-red-50 text-red-800 border-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />}
            <span>{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-500 hover:text-slate-800 ml-2">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3. Tab Body Container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* ============================================================ */}
        {/* TAB 1: TASK LIST & ASSIGNMENTS                                */}
        {/* ============================================================ */}
        {activeTab === 'list' && (
          <div className="space-y-3">
            {/* Completion Progress Bar */}
            {stats.TOTAL > 0 && (
              <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                  <span className="font-nepali">समग्र कार्य प्रगति (Completion Progress)</span>
                  <span className="text-gov-blue-800 font-mono">{progressPct}%</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-2.5">
                  <div
                    className="h-full bg-gov-blue-800 rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                {/* Quick Status Stats Badges */}
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setStatusFilter('ALL')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                      statusFilter === 'ALL'
                        ? 'bg-gov-blue-800 text-white border-gov-blue-800 shadow-xs'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    सबै ({stats.TOTAL})
                  </button>

                  <button
                    onClick={() => setCollectorFilter(collectorFilter === 'UNASSIGNED' ? 'ALL' : 'UNASSIGNED')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                      collectorFilter === 'UNASSIGNED'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                    }`}
                  >
                    नतोकिएको ({stats.UNASSIGNED})
                  </button>

                  <button
                    onClick={() => setCollectorFilter(collectorFilter === 'ASSIGNED' ? 'ALL' : 'ASSIGNED')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                      collectorFilter === 'ASSIGNED'
                        ? 'bg-gov-blue-900 text-white border-gov-blue-900 shadow-xs'
                        : 'bg-blue-50 text-gov-blue-900 border-blue-200 hover:bg-blue-100'
                    }`}
                  >
                    तोकिएको ({stats.ASSIGNED})
                  </button>

                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                    const count = stats[key] || 0;
                    if (count === 0) return null;
                    return (
                      <button
                        key={key}
                        onClick={() => setStatusFilter(statusFilter === key ? 'ALL' : key)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                          statusFilter === key
                            ? 'bg-gov-blue-800 text-white border-gov-blue-800 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                        {cfg.label.split(' ')[0]} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Filter Bar & Search */}
            {stats.TOTAL > 0 && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="कार्य नं. वा संकलक खोज्नुहोस्..."
                    className="gov-input text-xs flex-1 py-1.5"
                  />
                  {isAdmin && collectors.length > 0 && (
                    <select
                      value={collectorFilter}
                      onChange={(e) => setCollectorFilter(e.target.value)}
                      className="gov-input text-xs w-36 py-1.5"
                      title="तथ्याङ्क संकलक अनुसार फिल्टर गर्नुहोस्"
                    >
                      <option value="ALL">सबै संकलकहरू</option>
                      <option value="UNASSIGNED">⚠️ नतोकिएको मात्र</option>
                      <option value="ASSIGNED">👤 तोकिएको मात्र</option>
                      {collectors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name || c.username}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Bulk Actions Toolbar for GIS Admin */}
                {isAdmin && (
                  <div className="p-2 bg-slate-100 rounded-lg border border-slate-300 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={toggleSelectAllFiltered}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-gov-blue-900 hover:underline"
                      >
                        {selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-gov-blue-800" />
                        ) : (
                          <UncheckedSquare className="w-4 h-4 text-slate-500" />
                        )}
                        <span>सबै ({selectedTaskIds.size}/{filteredTasks.length})</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 flex-1 justify-end">
                      {selectedTaskIds.size > 0 ? (
                        <>
                          <select
                            value={bulkCollectorId}
                            onChange={(e) => setBulkCollectorId(e.target.value)}
                            className="bg-white text-slate-800 text-[11px] border border-slate-300 rounded px-2 py-1 font-medium"
                          >
                            <option value="">संकलक छान्नुहोस्...</option>
                            <option value="">(तोकिएको हटाउनुहोस् / Unassign)</option>
                            {collectors.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.full_name || c.username}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={handleBulkAssign}
                            disabled={bulkActionLoading}
                            className="btn-gov-primary text-[11px] py-1 px-2.5"
                          >
                            {bulkActionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
                            <span>तोक्नुहोस्</span>
                          </button>
                        </>
                      ) : (
                        collectors.length > 0 && stats.UNASSIGNED > 0 && (
                          <button
                            onClick={handleAutoDistribute}
                            disabled={autoDistributeLoading}
                            className="bg-gov-gold-400 hover:bg-gov-gold-500 text-gov-blue-950 font-bold text-[10px] py-1 px-2 rounded border border-gov-gold-500 flex items-center gap-1 transition-colors"
                            title="सबै नतोकिएका कार्यहरू संकलकहरूमा समान रूपमा बाँड्नुहोस्"
                          >
                            {autoDistributeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            <span>समान वितरण ({stats.UNASSIGNED})</span>
                          </button>
                        )
                      )}
                    </div>

                    {/* Reset All Grids Footer inside Toolbar */}
                    <div className="w-full flex items-center justify-between pt-1 border-t border-slate-200 mt-1">
                      <span className="text-[10px] text-slate-500 font-medium">
                        जम्मा कार्यक्षेत्र: <strong>{taskList.length}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={handleResetGrids}
                        disabled={resetLoading}
                        className="text-[10px] text-red-600 hover:text-red-800 font-bold hover:underline inline-flex items-center gap-1 py-0.5 px-1.5 rounded bg-red-50 hover:bg-red-100 border border-red-200 transition-colors"
                        title="परियोजनाका सबै ग्रिड विभाजनहरू मेटाउनुहोस्"
                      >
                        {resetLoading ? <Loader2 className="w-3 h-3 animate-spin text-red-600" /> : <Trash2 className="w-3 h-3 text-red-600" />}
                        <span>सबै ग्रिड रिसेट (Reset Grids)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Task List Cards & Pagination */}
            {filteredTasks.length === 0 ? (
              <div className="text-center py-8 bg-white rounded-lg border border-slate-200 p-4">
                <Grid3X3 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-700 text-xs font-bold font-nepali">
                  {stats.TOTAL === 0 ? 'कुनै ग्रिड विभाजन छैन (No Task Grids)' : 'कुनै कार्यक्षेत्र भेटिएन (No Tasks Match Filter)'}
                </p>
                {stats.TOTAL === 0 && isAdmin && (
                  <div className="mt-3 flex justify-center gap-2">
                    <button
                      onClick={() => setActiveTab('methodA')}
                      className="btn-gov-primary text-xs py-1 px-3"
                    >
                      विधि A: सिमाना अपलोड गर्नुहोस्
                    </button>
                    <button
                      onClick={() => setActiveTab('methodB')}
                      className="btn-gov-secondary text-xs py-1 px-3"
                    >
                      विधि B: ग्रिड उत्पादन
                    </button>
                  </div>
                )}
                {stats.TOTAL === 0 && isCollector && (
                  <div className="mt-3 max-w-xs mx-auto space-y-2">
                    <p className="text-[11px] text-slate-500 font-nepali">
                      यस परियोजनामा कुनै ग्रिड विभाजन गरिएको छैन। तपाईं यस परियोजनाका सक्रिय भेक्टर तहहरूमा सिधै तथ्याङ्क संकलन / म्यापिङ गर्न सक्नुहुन्छ।
                    </p>
                    <div className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-full font-nepali">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>प्रत्यक्ष संकलन खुला छ (Direct Mapping Mode)</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {/* Pagination Controls Header */}
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-300 flex items-center justify-between text-xs shadow-2xs gap-1.5 flex-wrap">
                  <div className="flex items-center gap-1.5 text-slate-700 text-[11px] font-medium">
                    <span>देखाउँदै: <strong>{((safeCurrentPage - 1) * pageSize) + 1}</strong> - <strong>{Math.min(safeCurrentPage * pageSize, filteredTasks.length)}</strong> / <strong>{filteredTasks.length}</strong></span>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Global Outline All Listed Grids Toggle Button */}
                    {onToggleAllTasksOutline && filteredTasks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onToggleAllTasksOutline(filteredTasks.map(t => t.properties?.id || t.id))}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-bold font-nepali flex items-center gap-1 border transition-all cursor-pointer mr-1 ${
                          outlineAllTasks
                            ? 'bg-amber-600 text-white border-amber-700 shadow-xs ring-1 ring-amber-400'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:border-amber-300'
                        }`}
                        title={
                          outlineAllTasks
                            ? 'सबै ग्रिडहरूको आउटलाइन मोड बन्द गर्नुहोस् (रंग भर्नुहोस्)'
                            : 'सबै ग्रिडहरूलाई आउटलाइन मात्र (सिमाना मात्र) देखाउनुहोस्'
                        }
                      >
                        <Square className="w-3 h-3" />
                        <span>{outlineAllTasks ? 'आउटलाइन ON' : 'सबै आउटलाइन'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={safeCurrentPage <= 1}
                      onClick={() => setCurrentPage(1)}
                      className="px-1.5 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="पहिलो पृष्ठ"
                    >
                      «
                    </button>
                    <button
                      type="button"
                      disabled={safeCurrentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="px-2 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ‹ अघिल्लो
                    </button>

                    <select
                      value={safeCurrentPage}
                      onChange={(e) => setCurrentPage(Number(e.target.value))}
                      className="text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white font-bold text-gov-blue-950"
                    >
                      {Array.from({ length: Math.min(totalPages, 150) }, (_, i) => i + 1).map((p) => (
                        <option key={p} value={p}>
                          पृष्ठ {p} / {totalPages}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="px-2 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      पछिल्लो ›
                    </button>
                    <button
                      type="button"
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() => setCurrentPage(totalPages)}
                      className="px-1.5 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="अन्तिम पृष्ठ"
                    >
                      »
                    </button>
                  </div>
                </div>

                {/* Paginated Task Cards */}
                <div className="space-y-2">
                  {paginatedTasks.map((task) => {
                    const props = task.properties || {};
                    const cfg = STATUS_CONFIG[props.status] || STATUS_CONFIG.READY;
                    const isSelected = selectedTask?.id === props.id;
                    const isChecked = selectedTaskIds.has(props.id);
                    const actions = getActions(task);

                    return (
                      <div
                        key={task.id || props.id}
                        className={`rounded-lg border transition-all bg-white shadow-xs ${
                          isSelected
                            ? 'border-gov-blue-800 ring-2 ring-gov-blue-800/30 bg-gov-blue-50/40'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {/* Card Header Bar */}
                        <div
                          className="p-2.5 flex items-center justify-between cursor-pointer"
                          onClick={() => onTaskSelect(props)}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {/* Checkbox for Admin Bulk selection */}
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleTaskSelection(props.id);
                                }}
                                className="text-slate-400 hover:text-gov-blue-800"
                              >
                                {isChecked ? (
                                  <CheckSquare className="w-4 h-4 text-gov-blue-800" />
                                ) : (
                                  <UncheckedSquare className="w-4 h-4" />
                                )}
                              </button>
                            )}

                            {/* Task Index Badge */}
                            <div
                              className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold font-mono border shrink-0"
                              style={{ backgroundColor: `${cfg.color}15`, color: cfg.color, borderColor: `${cfg.color}40` }}
                            >
                              #{props.grid_index}
                            </div>

                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900 truncate font-nepali">
                                {props.name || `कार्यक्षेत्र #${props.grid_index}`}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-bold border ${cfg.badge}`}>
                                  {cfg.label}
                                </span>

                                {/* Collector Assignment Tag */}
                                {props.assigned_to_name ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-800 border border-slate-300 truncate max-w-[120px]">
                                    <Users className="w-2.5 h-2.5 text-gov-blue-700" />
                                    <span className="truncate">{props.assigned_to_name}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                    ⚠️ नतोकिएको
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Individual Task Grid Outline Toggle Button */}
                            {onToggleTaskOutline && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleTaskOutline(props.id);
                                }}
                                className={`p-1 rounded border transition-colors cursor-pointer ${
                                  (outlineAllTasks || (outlinedTaskIds && (outlinedTaskIds instanceof Set ? outlinedTaskIds.has(props.id) : outlinedTaskIds.includes(props.id))))
                                    ? 'bg-amber-600 text-white border-amber-700 shadow-xs ring-1 ring-amber-400 font-bold'
                                    : 'text-slate-400 border-slate-200 hover:text-amber-600 hover:bg-slate-100 hover:border-slate-300'
                                }`}
                                title={
                                  (outlineAllTasks || (outlinedTaskIds && (outlinedTaskIds instanceof Set ? outlinedTaskIds.has(props.id) : outlinedTaskIds.includes(props.id))))
                                    ? `ग्रिड #${props.grid_index} आउटलाइन मोड बन्द गर्नुहोस् (रंग भर्नुहोस्)`
                                    : `ग्रिड #${props.grid_index} आउटलाइन मात्र (सिमाना मात्र) देखाउनुहोस्`
                                }
                              >
                                <Square className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                          </div>
                        </div>

                        {/* Expanded Details & Actions */}
                        {isSelected && (
                          <div className="px-3 pb-3 pt-2 border-t border-slate-100 bg-slate-50/70 rounded-b-lg space-y-2.5 animate-fade-in text-xs">
                            {/* Admin Collector Assignment Dropdown */}
                            {isAdmin && collectors.length > 0 && (
                              <div className="bg-white p-2 rounded border border-slate-200 flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-slate-700 shrink-0">संकलक तोक्नुहोस्:</span>
                                <select
                                  value={props.assigned_to || ''}
                                  onChange={(e) => handleSingleAssign(props.id, e.target.value)}
                                  className="gov-input text-xs py-1 flex-1 font-medium"
                                >
                                  <option value="">(कुनै संकलक छैन / Unassigned)</option>
                                  {collectors.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.full_name || c.username} ({c.role})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Task Workflow Action Buttons */}
                            {actions.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {actions.map((action) => {
                                  const Icon = action.icon;
                                  return (
                                    <button
                                      key={action.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onTaskAction(props.id, action.id);
                                      }}
                                      disabled={loading}
                                      className={`${action.variant} text-xs py-1.5 px-3 flex-1 flex items-center justify-center gap-1.5`}
                                    >
                                      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                                      <span>{action.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Bottom Pagination Controls if multiple pages */}
                {totalPages > 1 && (
                  <div className="p-2 bg-slate-50 rounded-lg border border-slate-300 flex items-center justify-between text-xs shadow-2xs">
                    <span className="text-[11px] text-slate-600">
                      पृष्ठ <strong>{safeCurrentPage}</strong> / <strong>{totalPages}</strong> ({filteredTasks.length} कार्यहरू)
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={safeCurrentPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="px-2 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        ‹ अघिल्लो
                      </button>
                      <button
                        type="button"
                        disabled={safeCurrentPage >= totalPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className="px-2 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        पछिल्लो ›
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 2: METHOD A — UPLOAD BOUNDARY (SINGLE / MULTI-POLYGON)     */}
        {/* ============================================================ */}
        {activeTab === 'methodA' && (
          <form onSubmit={handleUploadBoundarySubmit} className="space-y-3 bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-xs font-bold text-gov-blue-950 flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-gov-blue-800" />
                <span>विधि A: बहुभुज सिमाना अपलोड (Upload Vector Boundary)</span>
              </h3>
              <p className="text-[11px] text-slate-600 mt-0.5">
                वडा, क्षेत्र, वा कार्यक्षेत्रको बहुभुज (.geojson / .json) फाइल अपलोड गर्नुहोस्।
              </p>
            </div>

            {/* Existing Tasks Warning with Reset Button */}
            {hasTasks && (
              <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span className="text-amber-900 text-[11px]">
                    यस परियोजनामा पहिले नै <strong>{taskList.length}</strong> वटा ग्रिडहरू छन्।
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleResetGrids}
                  disabled={resetLoading}
                  className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold shrink-0 ml-2 shadow-2xs inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>सबै रिसेट गर्नुहोस्</span>
                </button>
              </div>
            )}

            {/* Drag & Drop Upload Zone */}
            <div className="border-2 border-dashed border-gov-blue-300 hover:border-gov-blue-600 rounded-lg p-4 text-center bg-gov-blue-50/30 transition-colors">
              <input
                type="file"
                id="boundary-file-input"
                accept=".geojson,.json"
                onChange={(e) => handleFileChange(e.target.files?.[0])}
                className="hidden"
              />
              <label htmlFor="boundary-file-input" className="cursor-pointer block space-y-2">
                <FileUp className="w-8 h-8 text-gov-blue-800 mx-auto" />
                <div>
                  <span className="text-xs font-bold text-gov-blue-900 block">
                    {uploadedFile ? uploadedFile.name : 'GeoJSON फाइल यहाँ तान्नुहोस् वा छान्नुहोस्'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Supports .geojson, .json (EPSG:4326, EPSG:3857, Nepal UTM 44/45N)
                  </span>
                </div>
              </label>
            </div>

            {/* Geometry Inspection Preview */}
            {uploadParsedInfo && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-300 space-y-3 animate-fade-in text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">पहिचान गरिएको बहुभुज:</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    uploadParsedInfo.isMulti ? 'bg-purple-100 text-purple-900' : 'bg-blue-100 text-blue-900'
                  }`}>
                    {uploadParsedInfo.count} वटा बहुभुज ({uploadParsedInfo.isMulti ? 'Multi-Polygon' : 'Single Polygon'})
                  </span>
                </div>

                {/* Option Routing based on Single vs Multi-Polygon */}
                {uploadParsedInfo.isMulti ? (
                  <div className="space-y-2 bg-white p-2.5 rounded border border-slate-200">
                    <div className="text-[11px] font-bold text-slate-800">
                      कार्यक्षेत्र विभाजन विकल्प:
                    </div>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="multi-opt"
                        checked={uploadMethodType === 'IMPORT_ALL_AS_TASKS'}
                        onChange={() => setUploadMethodType('IMPORT_ALL_AS_TASKS')}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-bold text-gov-blue-900 block text-xs">
                          प्रत्येक बहुभुजलाई छुट्टै कार्यक्षेत्र बनाउनुहोस् (Recommended)
                        </span>
                        <span className="text-[10px] text-slate-500">
                          अपलोड गरिएका {uploadParsedInfo.count} वटै बहुभुजहरूलाई छुट्टाछुट्टै कार्यक्षेत्र बनाएर संकलकहरूलाई तोक्न सकिनेछ।
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-slate-100">
                      <input
                        type="radio"
                        name="multi-opt"
                        checked={uploadMethodType === 'GENERATE_GRID'}
                        onChange={() => setUploadMethodType('GENERATE_GRID')}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-bold text-slate-800 block text-xs">
                          सबै बहुभुजलाई जोडेर नयाँ ग्रिड उत्पादन गर्नुहोस्
                        </span>
                        <span className="text-[10px] text-slate-500">
                          समग्र सिमाना भित्र वर्ग/षट्कोण ग्रिड बनाउनुहोस्।
                        </span>
                      </div>
                    </label>
                  </div>
                ) : (
                  <div className="space-y-2 bg-white p-2.5 rounded border border-slate-200">
                    <div className="text-[11px] font-bold text-slate-800">
                      एकल बहुभुज व्यवस्थापन विकल्प:
                    </div>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="single-opt"
                        checked={uploadMethodType === 'GENERATE_GRID'}
                        onChange={() => setUploadMethodType('GENERATE_GRID')}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-bold text-gov-blue-900 block text-xs">
                          सिमानालाई साना ग्रिडहरूमा विभाजन गर्नुहोस् (Divide into Grids)
                        </span>
                        <span className="text-[10px] text-slate-500">
                          छानिएको आकार र प्रकार अनुसार ग्रिड उत्पादन गरी संकलकहरूलाई तोक्नुहोस्।
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-slate-100">
                      <input
                        type="radio"
                        name="single-opt"
                        checked={uploadMethodType === 'IMPORT_ALL_AS_TASKS'}
                        onChange={() => setUploadMethodType('IMPORT_ALL_AS_TASKS')}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-bold text-slate-800 block text-xs">
                          यस बहुभुजलाई १ एकल कार्यक्षेत्र राख्नुहोस् (Single Task Area)
                        </span>
                      </div>
                    </label>
                  </div>
                )}

                {/* Grid Parameters if GENERATE_GRID is active */}
                {uploadMethodType === 'GENERATE_GRID' && (
                  <div className="p-2.5 bg-gov-blue-50/50 rounded border border-gov-blue-200 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="gov-label text-[10px]">ग्रिड प्रकार (Pattern)</label>
                        <select
                          value={uploadGridType}
                          onChange={(e) => setUploadGridType(e.target.value)}
                          className="gov-input text-xs py-1"
                        >
                          <option value="SQUARE">वर्ग ग्रिड (Square)</option>
                          <option value="HEXAGON">षट्कोण ग्रिड (Hexagon)</option>
                          <option value="TRIANGLE">त्रिकोण ग्रिड (Triangle)</option>
                        </select>
                      </div>
                      <div>
                        <label className="gov-label text-[10px]">ग्रिड आकार (Size in meters)</label>
                        <input
                          type="number"
                          value={uploadGridSize}
                          onChange={(e) => setUploadGridSize(parseFloat(e.target.value))}
                          min="10"
                          max="5000"
                          className="gov-input text-xs py-1"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={uploadSubmitting || !uploadedFile}
              className="btn-gov-primary w-full text-xs py-2 flex items-center justify-center gap-1.5 shadow-sm"
            >
              {uploadSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>अपलोड तथा कार्यक्षेत्र सिर्जना हुँदैछ...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>सिमाना लागू तथा कार्यक्षेत्र सिर्जना गर्नुहोस्</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* ============================================================ */}
        {/* TAB 3: METHOD B — GENERATE GRID FROM CANVAS / BOUNDARY       */}
        {/* ============================================================ */}
        {activeTab === 'methodB' && (
          <form onSubmit={handleMethodBSubmit} className="space-y-3 bg-white p-3.5 rounded-lg border border-slate-200 shadow-xs">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-xs font-bold text-gov-blue-950 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-gov-gold-500" />
                <span>विधि B: क्यानभास / सिमानाबाट ग्रिड उत्पादन (Generate Grid)</span>
              </h3>
              <p className="text-[11px] text-slate-600 mt-0.5">
                नक्सा क्यानभासमा सिधै क्षेत्र कोरेर वा अवस्थित सिमाना प्रयोग गरी ग्रिड उत्पादन गर्नुहोस्।
              </p>
            </div>

            {/* Existing Tasks Warning with Reset Button */}
            {hasTasks && (
              <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span className="text-amber-900 text-[11px]">
                    यस परियोजनामा पहिले नै <strong>{taskList.length}</strong> वटा ग्रिडहरू छन्।
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleResetGrids}
                  disabled={resetLoading}
                  className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold shrink-0 ml-2 shadow-2xs inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>सबै रिसेट गर्नुहोस्</span>
                </button>
              </div>
            )}

            {/* Boundary Source Selection */}
            <div className="space-y-1.5">
              <label className="gov-label text-[11px]">सिमाना स्रोत छान्नुहोस् (Boundary Source)</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMethodBSource('CANVAS')}
                  className={`p-2.5 rounded-lg border text-center flex flex-col items-center gap-1 transition-all ${
                    methodBSource === 'CANVAS'
                      ? 'border-gov-blue-800 bg-gov-blue-50/70 text-gov-blue-950 font-bold ring-1 ring-gov-blue-800'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <Edit3 className="w-4.5 h-4.5 text-gov-blue-800" />
                  <span className="text-xs">नक्सा क्यानभासमा कोर्नुहोस्</span>
                  <span className="text-[9px] text-slate-500 font-normal">Draw directly on map</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMethodBSource('PROJECT_BOUNDARY')}
                  className={`p-2.5 rounded-lg border text-center flex flex-col items-center gap-1 transition-all ${
                    methodBSource === 'PROJECT_BOUNDARY'
                      ? 'border-gov-blue-800 bg-gov-blue-50/70 text-gov-blue-950 font-bold ring-1 ring-gov-blue-800'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <Layers className="w-4.5 h-4.5 text-gov-blue-800" />
                  <span className="text-xs">अवस्थित सिमाना प्रयोग</span>
                  <span className="text-[9px] text-slate-500 font-normal">Existing project boundary</span>
                </button>
              </div>
            </div>

            {/* Canvas Drawing Controls */}
            {methodBSource === 'CANVAS' && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-300 space-y-2.5">
                {isDrawingBoundary ? (
                  <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-300 flex items-center justify-between text-xs animate-pulse">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-amber-700 animate-spin shrink-0" />
                      <div>
                        <span className="font-bold text-amber-900 block">नक्सामा क्षेत्र कोर्नुहोस्...</span>
                        <span className="text-[10px] text-amber-800">नक्सा क्यानभासमा क्लिक गरी बहुभुज कोर्नुहोस् र अन्तिम बिन्दुमा डबल-क्लिक गर्नुहोस्।</span>
                      </div>
                    </div>
                    {onClearDrawnBoundary && (
                      <button
                        type="button"
                        onClick={onClearDrawnBoundary}
                        className="btn-gov-secondary text-[10px] py-1 px-2 shrink-0 ml-2"
                      >
                        रद्द
                      </button>
                    )}
                  </div>
                ) : drawnBoundary ? (
                  <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-300 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>क्यानभास क्षेत्र चयन भयो</span>
                      </span>
                      <div className="flex items-center gap-1">
                        {onStartDrawBoundary && (
                          <button
                            type="button"
                            onClick={() => onStartDrawBoundary('Polygon')}
                            className="text-[10px] text-gov-blue-800 font-bold hover:underline px-2 py-0.5 rounded bg-white border border-slate-300"
                          >
                            पुनः कोर्नुहोस्
                          </button>
                        )}
                        {onClearDrawnBoundary && (
                          <button
                            type="button"
                            onClick={onClearDrawnBoundary}
                            className="text-[10px] text-red-600 font-bold hover:underline px-2 py-0.5 rounded bg-white border border-slate-300"
                          >
                            हटाउनुहोस्
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-emerald-800 block">
                      नक्सामा कोरेको बहुभुज क्षेत्र सुरक्षित गरी सिमाना र ग्रिड उत्पादन गरिनेछ।
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-slate-800">
                      नक्सामा कोर्न ढाँचा छान्नुहोस्:
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => onStartDrawBoundary && onStartDrawBoundary('Polygon')}
                        className="p-2.5 rounded-lg border-2 border-dashed border-gov-blue-400 hover:border-gov-blue-800 bg-white hover:bg-gov-blue-50 text-center flex flex-col items-center gap-1 transition-all"
                      >
                        <Edit3 className="w-5 h-5 text-gov-blue-800" />
                        <span className="text-xs font-bold text-gov-blue-950">बहुभुज (Polygon)</span>
                        <span className="text-[9px] text-slate-500">क्लिक गर्दै बिन्दुहरू जोड्नुहोस्</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onStartDrawBoundary && onStartDrawBoundary('Box')}
                        className="p-2.5 rounded-lg border-2 border-dashed border-gov-blue-400 hover:border-gov-blue-800 bg-white hover:bg-gov-blue-50 text-center flex flex-col items-center gap-1 transition-all"
                      >
                        <Square className="w-5 h-5 text-gov-blue-800" />
                        <span className="text-xs font-bold text-gov-blue-950">आयत / बाकस (Rectangle)</span>
                        <span className="text-[9px] text-slate-500">तानेर बाकस बनाउनुहोस्</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pattern Selection Cards */}
            <div className="space-y-1.5">
              <label className="gov-label text-[11px]">ग्रिड ढाँचा छान्नुहोस् (Grid Pattern)</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setMethodBGridType('SQUARE')}
                  className={`p-2.5 rounded-lg border text-center flex flex-col items-center gap-1 transition-all ${
                    methodBGridType === 'SQUARE'
                      ? 'border-gov-blue-800 bg-gov-blue-50 text-gov-blue-950 font-bold ring-1 ring-gov-blue-800'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <Square className="w-5 h-5 text-gov-blue-800" />
                  <span className="text-[11px]">वर्ग (Square)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMethodBGridType('HEXAGON')}
                  className={`p-2.5 rounded-lg border text-center flex flex-col items-center gap-1 transition-all ${
                    methodBGridType === 'HEXAGON'
                      ? 'border-gov-blue-800 bg-gov-blue-50 text-gov-blue-950 font-bold ring-1 ring-gov-blue-800'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <Hexagon className="w-5 h-5 text-gov-gold-500" />
                  <span className="text-[11px]">षट्कोण (Hexagon)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMethodBGridType('TRIANGLE')}
                  className={`p-2.5 rounded-lg border text-center flex flex-col items-center gap-1 transition-all ${
                    methodBGridType === 'TRIANGLE'
                      ? 'border-gov-blue-800 bg-gov-blue-50 text-gov-blue-950 font-bold ring-1 ring-gov-blue-800'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                  }`}
                >
                  <Triangle className="w-5 h-5 text-teal-600" />
                  <span className="text-[11px]">त्रिकोण (Triangle)</span>
                </button>
              </div>
            </div>

            {/* Grid Size Input & Presets */}
            <div className="space-y-1.5">
              <label className="gov-label text-[11px]">ग्रिड आकार (Cell Size in meters)</label>
              <div className="flex gap-1.5 mb-1.5">
                {[50, 100, 200, 500, 1000].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setMethodBGridSize(size)}
                    className={`flex-1 py-1 rounded text-[10px] font-bold border transition-colors ${
                      methodBGridSize === size
                        ? 'bg-gov-blue-800 text-white border-gov-blue-800'
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    {size}m
                  </button>
                ))}
              </div>
              <input
                type="number"
                value={methodBGridSize}
                onChange={(e) => setMethodBGridSize(parseFloat(e.target.value))}
                min="10"
                max="10000"
                placeholder="100"
                className="gov-input text-xs py-1.5"
                required
              />
            </div>

            <button
              type="submit"
              disabled={methodBSubmitting || (methodBSource === 'CANVAS' && !drawnBoundary)}
              className="btn-gov-primary w-full text-xs py-2 flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {methodBSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>ग्रिड उत्पादन हुँदैछ...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-gov-gold-400" />
                  <span>ग्रिड कार्यक्षेत्रहरू उत्पादन गर्नुहोस्</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* 4. Sticky Footer with Pagination & Reset Grids Action for Tab 1 */}
      {activeTab === 'list' && filteredTasks.length > 0 && (
        <div className="p-2.5 bg-white border-t border-slate-300 shadow-md flex flex-col gap-2 shrink-0">
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-600 font-medium">
                पृष्ठ <strong>{safeCurrentPage}</strong> / <strong>{totalPages}</strong> ({filteredTasks.length} कार्य)
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                  className="px-1.5 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="पहिलो पृष्ठ"
                >
                  «
                </button>
                <button
                  type="button"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ‹ अघिल्लो
                </button>

                <select
                  value={safeCurrentPage}
                  onChange={(e) => setCurrentPage(Number(e.target.value))}
                  className="text-[11px] border border-slate-300 rounded px-1.5 py-0.5 bg-white font-bold text-gov-blue-950"
                >
                  {Array.from({ length: Math.min(totalPages, 150) }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>
                      पृष्ठ {p}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  पछिल्लो ›
                </button>
                <button
                  type="button"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  className="px-1.5 py-0.5 rounded border border-slate-300 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="अन्तिम पृष्ठ"
                >
                  »
                </button>
              </div>
            </div>
          )}

          {/* Quick Reset All Grids Action Button */}
          {isAdmin && (
            <div className="flex items-center justify-between pt-1 border-t border-slate-200">
              <span className="text-[10px] text-slate-500">
                जम्मा कार्यहरू: <strong>{taskList.length}</strong>
              </span>
              <button
                type="button"
                onClick={handleResetGrids}
                disabled={resetLoading}
                className="text-xs text-red-600 hover:text-red-800 font-bold inline-flex items-center gap-1.5 py-1 px-2.5 rounded bg-red-50 hover:bg-red-100 border border-red-200 transition-colors shadow-2xs"
                title="यस परियोजनाका सबै ग्रिड कार्यक्षेत्रहरू मेटाउनुहोस्"
              >
                {resetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-600" /> : <Trash2 className="w-3.5 h-3.5 text-red-600" />}
                <span>सबै ग्रिड रिसेट (Reset All Grids)</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* In-App Confirmation Modal: Reset Grids */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-2xs z-70 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-4 border border-slate-300 space-y-3 animate-fade-in">
            <div className="flex items-center gap-2.5 text-red-600 font-bold text-sm">
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-4.5 h-4.5 text-red-600" />
              </div>
              <span>सबै ग्रिडहरू रिसेट पुष्टि</span>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              के तपाईं परियोजना <strong>"{activeProject?.name}"</strong> का सबै <strong>({taskList.length})</strong> कार्य ग्रिड विभाजनहरू मेटाउन निश्चित हुनुहुन्छ?
            </p>
            <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200 leading-relaxed">
              ⚠️ यो कार्य गरेपछि पुराना सबै ग्रिडहरू हट्नेछन् र तपाईं नयाँ ग्रिड कोर्न वा अपलोड गर्न सक्नुहुन्छ।
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                disabled={resetLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                रद्द गर्नुहोस्
              </button>
              <button
                type="button"
                onClick={confirmResetGrids}
                disabled={resetLoading}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm inline-flex items-center gap-1.5"
              >
                {resetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>हो, सबै मेटाउनुहोस्</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Confirmation Modal: Auto-Distribute */}
      {showAutoDistributeConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-2xs z-70 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-4 border border-slate-300 space-y-3 animate-fade-in">
            <div className="flex items-center gap-2.5 text-gov-blue-900 font-bold text-sm">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <Sparkles className="w-4.5 h-4.5 text-gov-blue-800" />
              </div>
              <span>समान वितरण पुष्टि (Auto-Distribute)</span>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              के तपाईं सबै नतोकिएका <strong>({stats.UNASSIGNED})</strong> कार्यक्षेत्रहरू <strong>{collectors.length}</strong> जना संकलकहरूमा समान रूपमा वितरण गर्न चाहनुहुन्छ?
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowAutoDistributeConfirm(false)}
                disabled={autoDistributeLoading}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                रद्द गर्नुहोस्
              </button>
              <button
                type="button"
                onClick={confirmAutoDistribute}
                disabled={autoDistributeLoading}
                className="btn-gov-primary text-xs py-1.5 px-3.5 flex items-center gap-1.5"
              >
                {autoDistributeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-gov-gold-400" />}
                <span>वितरण गर्नुहोस्</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
