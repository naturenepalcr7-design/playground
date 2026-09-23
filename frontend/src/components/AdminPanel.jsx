'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, FolderPlus, Upload, Layers, Image, Database,
  Trash2, Edit3, X, Loader2, UserPlus, MapPin, Grid3X3,
  ChevronDown, ChevronUp, RefreshCw, Link2, ShieldCheck, CheckCircle2,
  Globe, Folder, Unlink, ExternalLink, Check, Sparkles, Filter, Copy,
  UserCheck, UserX, Shield, FolderCheck, Download, FileDown, FileText,
  Radio, Navigation, Crosshair, Clock, Magnet, Sliders, Asterisk,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  usersAPI, projectsAPI, layersAPI, tilesAPI, trackingAPI, triggerFileDownload,
} from '../lib/api';

/**
 * AdminPanel Component — Official Nepal Government WebGIS Standard
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 * GisAdmin Management Console
 * 
 * Supports:
 * - Direct Project-scoped or Global Vector & Raster Upload
 * - Project Layer & MBTiles Linking / Unlinking Management
 * - Data Collector Project Assignment & Access Control
 * - Real-Time Data Collector Location Fleet Tracking
 * - User & Project Administration
 */
export default function AdminPanel({
  onClose,
  onProjectCreated,
  activeProject,
  onOpenLinkLayers = null,
  onZoomToCollector = null,
  onLayerUpdate = null,
}) {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('projects');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  // ---- Main datasets ----
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [allLayers, setAllLayers] = useState([]);
  const [allTiles, setAllTiles] = useState([]);
  const [collectorLocations, setCollectorLocations] = useState([]);
  const [projectAssignments, setProjectAssignments] = useState({}); // { [projectId]: { layer_ids: [], tile_ids: [] } }
  const [projectCollectors, setProjectCollectors] = useState({}); // { [projectId]: [ { user_id, username, full_name, email, assigned_tasks_count } ] }

  // ---- Active UI states ----
  const [expandedProjectId, setExpandedProjectId] = useState(activeProject?.id || null);
  const [projectFilter, setProjectFilter] = useState('ALL'); // 'ALL', 'GLOBAL', or projectId string
  const [searchTerm, setSearchTerm] = useState('');
  const [addingCollectorProjectId, setAddingCollectorProjectId] = useState(null);
  const [selectedCollectorIdToAssign, setSelectedCollectorIdToAssign] = useState('');

  // ---- Modal & Dialog States ----
  const [showUserForm, setShowUserForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showLayerUpload, setShowLayerUpload] = useState(false);
  const [showTileUpload, setShowTileUpload] = useState(false);
  const [assignModal, setAssignModal] = useState(null); // { type: 'layer' | 'tile', item: layer | tile, targetProjectId: null }
  const [layerDownloadModal, setLayerDownloadModal] = useState(null); // { layer: layerObj }
  const [downloadingLayerId, setDownloadingLayerId] = useState(null);
  const [downloadingTileId, setDownloadingTileId] = useState(null);
  const [togglingSnappingLayerId, setTogglingSnappingLayerId] = useState(null);
  const [fieldConfigModal, setFieldConfigModal] = useState(null); // { layer, fields: [], loading: false, saving: false }

  // ---- Form states ----
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '', full_name: '', role: 'DataCollector' });
  const [projectForm, setProjectForm] = useState({ name: '', description: '' });
  const [layerUploadForm, setLayerUploadForm] = useState({ name: '', scope: 'GLOBAL', projectId: '', editable_by_collectors: true, allow_snapping: true });
  const [tileUploadForm, setTileUploadForm] = useState({ name: '', description: '', scope: 'GLOBAL', projectId: '' });
  const [uploadProgress, setUploadProgress] = useState(null);

  if (!isAdmin) return null;

  // ---- Load all data ----
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, projRes, layersRes, tilesRes, trackingRes] = await Promise.allSettled([
        usersAPI.list(),
        projectsAPI.list(),
        layersAPI.listAll(),
        tilesAPI.listAll(),
        trackingAPI.getCollectors(),
      ]);
      if (usersRes.status === 'fulfilled') setUsers(usersRes.value.data);
      if (projRes.status === 'fulfilled') setProjects(projRes.value.data);
      if (layersRes.status === 'fulfilled') setAllLayers(layersRes.value.data);
      if (tilesRes.status === 'fulfilled') setAllTiles(tilesRes.value.data);
      if (trackingRes.status === 'fulfilled') setCollectorLocations(trackingRes.value.data || []);

      // Load assignments and collectors for all projects
      if (projRes.status === 'fulfilled' && Array.isArray(projRes.value.data)) {
        const assignmentsMap = {};
        const collectorsMap = {};
        await Promise.allSettled(
          projRes.value.data.map(async (p) => {
            try {
              const res = await projectsAPI.getAssignments(p.id);
              assignmentsMap[p.id] = {
                layer_ids: res.data.assigned_layer_ids || [],
                tile_ids: res.data.assigned_mbtiles_ids || [],
              };
            } catch (e) {
              assignmentsMap[p.id] = { layer_ids: [], tile_ids: [] };
            }

            try {
              const cRes = await projectsAPI.getCollectors(p.id);
              collectorsMap[p.id] = cRes.data || [];
            } catch (e) {
              collectorsMap[p.id] = [];
            }
          })
        );
        setProjectAssignments(assignmentsMap);
        setProjectCollectors(collectorsMap);
      }
    } catch (err) {
      console.error('[AdminPanel] Error loading data:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync active project if opened from outside
  useEffect(() => {
    if (activeProject && activeProject.id) {
      setExpandedProjectId(activeProject.id);
    }
  }, [activeProject]);

  // ---- User Actions ----
  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await usersAPI.create(userForm);
      setMessage({ type: 'success', text: `नयाँ प्रयोगकर्ता '${userForm.username}' सफलतापूर्वक सिर्जना भयो` });
      setShowUserForm(false);
      setUserForm({ username: '', email: '', password: '', full_name: '', role: 'DataCollector' });
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'प्रयोगकर्ता सिर्जना गर्न सकिएन' });
    }
  };

  // ---- Project Actions ----
  const handleCreateProject = async (e) => {
    e.preventDefault();
    try {
      const res = await projectsAPI.create(projectForm);
      setMessage({ type: 'success', text: `नयाँ परियोजना '${projectForm.name}' सफलतापूर्वक सिर्जना भयो` });
      setShowProjectForm(false);
      setProjectForm({ name: '', description: '' });
      loadData();
      if (onProjectCreated) onProjectCreated(res.data);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'परियोजना सिर्जना गर्न सकिएन' });
    }
  };

  // ---- Upload GeoJSON Layer (Global or Project-Scoped) ----
  const handleLayerUpload = async (e) => {
    e.preventDefault();
    const form = e.target;
    const fileInput = form.file;
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      setMessage({ type: 'error', text: 'कृपया GeoJSON फाइल छान्नुहोस्' });
      return;
    }

    const isGlobal = layerUploadForm.scope === 'GLOBAL';
    const targetProjId = !isGlobal && layerUploadForm.projectId ? parseInt(layerUploadForm.projectId, 10) : null;

    if (!isGlobal && !targetProjId) {
      setMessage({ type: 'error', text: 'कृपया लक्षित परियोजना छान्नुहोस्' });
      return;
    }

    const formData = new FormData();
    formData.append('name', layerUploadForm.name);
    formData.append('is_global', isGlobal ? 'true' : 'false');
    if (targetProjId) {
      formData.append('project_id', String(targetProjId));
    }
    formData.append('editable_by_collectors', layerUploadForm.editable_by_collectors ? 'true' : 'false');
    formData.append('allow_snapping', layerUploadForm.allow_snapping ? 'true' : 'false');
    formData.append('file', fileInput.files[0]);

    try {
      setLoading(true);
      setUploadProgress({ percent: 0, loaded: 0, total: 0 });
      await layersAPI.upload(formData, (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress({
            percent,
            loaded: progressEvent.loaded,
            total: progressEvent.total,
          });
        }
      });

      const scopeText = isGlobal ? 'सार्वजनिक तह (Global Layer)' : 'विशेष परियोजना तह (Project-Scoped Layer)';
      setMessage({ type: 'success', text: `भेक्टर तह (${scopeText}) सफलतापूर्वक अपलोड भयो` });
      setShowLayerUpload(false);
      setLayerUploadForm({ name: '', scope: 'GLOBAL', projectId: '', editable_by_collectors: true, allow_snapping: true });
      loadData();
      if (onLayerUpdate) onLayerUpdate();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'तह अपलोड असफल भयो' });
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  // ---- Toggle Layer Snapping (Admin only) ----
  const handleToggleLayerSnapping = async (layer) => {
    const newStatus = layer.allow_snapping === false;
    try {
      setTogglingSnappingLayerId(layer.id);
      await layersAPI.update(layer.id, { allow_snapping: newStatus });
      setAllLayers((prev) =>
        prev.map((l) => (l.id === layer.id ? { ...l, allow_snapping: newStatus } : l))
      );
      setMessage({
        type: 'success',
        text: `'${layer.name}' तहमा स्न्यापिङ ${newStatus ? 'अनुमति दिइयो (Allowed)' : 'बन्द गरियो (Disabled)'}`,
      });
      if (onLayerUpdate) onLayerUpdate();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.detail || 'स्न्यापिङ अनुमति परिवर्तन गर्न सकिएन',
      });
    } finally {
      setTogglingSnappingLayerId(null);
    }
  };

  // ---- Open Layer Fields & Compulsory Configuration Modal ----
  const handleOpenFieldConfig = async (layer) => {
    const initialFields = Array.isArray(layer.fields_config) && layer.fields_config.length > 0
      ? layer.fields_config.map((f) => ({ ...f }))
      : [];

    setFieldConfigModal({
      layer,
      fields: initialFields,
      loading: initialFields.length === 0,
      saving: false,
    });

    if (initialFields.length === 0) {
      try {
        const res = await layersAPI.getFields(layer.id);
        const fetched = res.data?.fields || [];
        setFieldConfigModal((prev) => (prev && prev.layer?.id === layer.id ? {
          ...prev,
          fields: fetched.map((f) => ({ ...f })),
          loading: false,
        } : prev));
      } catch (e) {
        console.warn('Could not auto-fetch fields:', e);
        setFieldConfigModal((prev) => (prev ? { ...prev, loading: false } : null));
      }
    }
  };

  // ---- Re-scan features to auto-detect fields from existing data ----
  const handleAutoDetectFields = async () => {
    if (!fieldConfigModal?.layer) return;
    setFieldConfigModal((prev) => ({ ...prev, loading: true }));
    try {
      const res = await layersAPI.getFields(fieldConfigModal.layer.id);
      const fetched = res.data?.fields || [];
      setFieldConfigModal((prev) => {
        if (!prev) return null;
        const currentMap = new Map((prev.fields || []).map((f) => [f.name, f]));
        const merged = fetched.map((f) => {
          const exist = currentMap.get(f.name);
          return exist ? { ...f, ...exist } : f;
        });
        const fetchedNames = new Set(fetched.map((f) => f.name));
        (prev.fields || []).forEach((f) => {
          if (!fetchedNames.has(f.name)) {
            merged.push(f);
          }
        });
        return {
          ...prev,
          fields: merged,
          loading: false,
        };
      });
    } catch (e) {
      alert('फिल्ड पहिचान गर्न सकिएन: ' + (e.response?.data?.detail || e.message));
      setFieldConfigModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // ---- Save Layer Fields & Required Configuration ----
  const handleSaveFieldConfig = async () => {
    if (!fieldConfigModal?.layer) return;
    setFieldConfigModal((prev) => ({ ...prev, saving: true }));
    try {
      const cleanedFields = (fieldConfigModal.fields || []).map((f) => ({
        name: (f.name || '').trim().replace(/\s+/g, '_').toLowerCase(),
        label: (f.label || f.name || '').trim(),
        type: f.type || 'text',
        required: Boolean(f.required),
        options: Array.isArray(f.options) ? f.options : [],
      })).filter((f) => f.name.length > 0);

      await layersAPI.updateFields(fieldConfigModal.layer.id, cleanedFields);
      setAllLayers((prev) =>
        prev.map((l) => (l.id === fieldConfigModal.layer.id ? { ...l, fields_config: cleanedFields } : l))
      );
      setMessage({
        type: 'success',
        text: `'${fieldConfigModal.layer.name}' तहका ${cleanedFields.length} फिल्डहरू (अनिवार्य नियम सहित) सुरक्षित गरियो!`,
      });
      setFieldConfigModal(null);
      loadData();
      if (onLayerUpdate) onLayerUpdate();
    } catch (e) {
      alert('फिल्ड कन्फिगरेसन सुरक्षित गर्न सकिएन: ' + (e.response?.data?.detail || e.message));
      setFieldConfigModal((prev) => ({ ...prev, saving: false }));
    }
  };

  // ---- Upload MBTiles (Global or Project-Scoped) ----
  const handleTileUpload = async (e) => {
    e.preventDefault();
    const form = e.target;
    const fileInput = form.file;
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      setMessage({ type: 'error', text: 'कृपया .mbtiles फाइल छान्नुहोस्' });
      return;
    }

    const isGlobal = tileUploadForm.scope === 'GLOBAL';
    const targetProjId = !isGlobal && tileUploadForm.projectId ? parseInt(tileUploadForm.projectId, 10) : null;

    if (!isGlobal && !targetProjId) {
      setMessage({ type: 'error', text: 'कृपया लक्षित परियोजना छान्नुहोस्' });
      return;
    }

    const formData = new FormData();
    formData.append('name', tileUploadForm.name);
    if (tileUploadForm.description) {
      formData.append('description', tileUploadForm.description);
    }
    formData.append('is_global', isGlobal ? 'true' : 'false');
    if (targetProjId) {
      formData.append('project_id', String(targetProjId));
    }
    formData.append('file', fileInput.files[0]);

    try {
      setLoading(true);
      setUploadProgress({ percent: 0, loaded: 0, total: 0 });
      await tilesAPI.upload(formData, (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress({
            percent,
            loaded: progressEvent.loaded,
            total: progressEvent.total,
          });
        }
      });

      const scopeText = isGlobal ? 'सार्वजनिक इमेज्री (Global)' : 'विशेष परियोजना इमेज्री (Project-Scoped)';
      setMessage({ type: 'success', text: `ड्रोन इमेज्री (${scopeText}) सफलतापूर्वक अपलोड भयो र टाइल सर्भरमा सक्रिय गरियो` });
      setShowTileUpload(false);
      setTileUploadForm({ name: '', description: '', scope: 'GLOBAL', projectId: '' });
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'इमेज्री अपलोड असफल भयो' });
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  // ---- Download Vector Layer (GisAdmin only) ----
  const handleDownloadLayer = async (layer, format = 'geojson') => {
    if (!layer || !layer.id) return;
    try {
      setDownloadingLayerId(layer.id);
      const res = await layersAPI.download(layer.id, format);
      const ext = format === 'shapefile' || format === 'shp' ? 'zip' : format;
      const defaultFilename = `${(layer.name || 'layer').replace(/[^a-zA-Z0-9_\-\.]/g, '_')}.${ext}`;
      triggerFileDownload(res, defaultFilename);
      setMessage({
        type: 'success',
        text: `'${layer.name}' (${format.toUpperCase()}) सफलतापूर्वक डाउनलोड भयो`,
      });
      setLayerDownloadModal(null);
    } catch (err) {
      console.error('[AdminPanel] Error downloading layer:', err);
      setMessage({
        type: 'error',
        text: err.response?.data?.detail || 'तह डाउनलोड गर्न सकिएन',
      });
    } finally {
      setDownloadingLayerId(null);
    }
  };

  // ---- Download MBTiles Raster Layer (GisAdmin only) ----
  const handleDownloadTile = async (tile) => {
    if (!tile || !tile.id) return;
    try {
      setDownloadingTileId(tile.id);
      const res = await tilesAPI.download(tile.id);
      const defaultFilename = tile.filename || `${(tile.name || 'tiles').replace(/[^a-zA-Z0-9_\-\.]/g, '_')}.mbtiles`;
      triggerFileDownload(res, defaultFilename);
      setMessage({
        type: 'success',
        text: `'${tile.name}' (.mbtiles) सफलतापूर्वक डाउनलोड भयो`,
      });
    } catch (err) {
      console.error('[AdminPanel] Error downloading MBTiles:', err);
      setMessage({
        type: 'error',
        text: err.response?.data?.detail || 'इमेज्री डाउनलोड गर्न सकिएन',
      });
    } finally {
      setDownloadingTileId(null);
    }
  };

  // ---- Assign Layer to a Project ----
  const handleAssignLayer = async (projectId, layerId) => {
    if (!projectId || !layerId) return;
    try {
      await projectsAPI.assignLayer(projectId, layerId);
      const projObj = projects.find((p) => p.id === projectId);
      setMessage({ type: 'success', text: `तह सफलतापूर्वक '${projObj?.name || 'परियोजना'}' मा समावेश गरियो` });
      setAssignModal(null);
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'परियोजनामा समावेश गर्न सकिएन' });
    }
  };

  // ---- Unassign Layer from a Project ----
  const handleUnassignLayer = async (projectId, layerId) => {
    if (!projectId || !layerId) return;
    try {
      await projectsAPI.unassignLayer(projectId, layerId);
      setMessage({ type: 'success', text: 'तह परियोजनाबाट हटाइयो' });
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'हटाउन सकिएन' });
    }
  };

  // ---- Assign Tiles to a Project ----
  const handleAssignTiles = async (projectId, tilesId) => {
    if (!projectId || !tilesId) return;
    try {
      await projectsAPI.assignTiles(projectId, tilesId);
      const projObj = projects.find((p) => p.id === projectId);
      setMessage({ type: 'success', text: `MBTiles सफलतापूर्वक '${projObj?.name || 'परियोजना'}' मा समावेश गरियो` });
      setAssignModal(null);
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'परियोजनामा समावेश गर्न सकिएन' });
    }
  };

  // ---- Unassign Tiles from a Project ----
  const handleUnassignTiles = async (projectId, tilesId) => {
    if (!projectId || !tilesId) return;
    try {
      await projectsAPI.unassignTiles(projectId, tilesId);
      setMessage({ type: 'success', text: 'MBTiles इमेज्री परियोजनाबाट हटाइयो' });
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'हटाउन सकिएन' });
    }
  };

  // ---- Assign Collector to a Project ----
  const handleAssignCollector = async (projectId, userId) => {
    if (!projectId || !userId) return;
    try {
      await projectsAPI.assignCollectors(projectId, [userId]);
      const projObj = projects.find((p) => p.id === projectId);
      const userObj = users.find((u) => u.id === userId);
      setMessage({
        type: 'success',
        text: `तथ्याङ्क संकलक '${userObj?.full_name || userObj?.username}' सफलतापूर्वक '${projObj?.name || 'परियोजना'}' मा तोकियो`,
      });
      setAddingCollectorProjectId(null);
      setSelectedCollectorIdToAssign('');
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'तथ्याङ्क संकलक तोक्न सकिएन' });
    }
  };

  // ---- Unassign Collector from a Project ----
  const handleUnassignCollector = async (projectId, userId) => {
    if (!projectId || !userId) return;
    try {
      await projectsAPI.unassignCollector(projectId, userId);
      setMessage({ type: 'success', text: 'तथ्याङ्क संकलक परियोजनाबाट सफलतापूर्वक हटाइयो' });
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'हटाउन सकिएन' });
    }
  };

  // Helpers for filtering layers and tiles
  const filteredLayers = allLayers.filter((layer) => {
    if (projectFilter === 'GLOBAL' && !layer.is_global) return false;
    if (projectFilter !== 'ALL' && projectFilter !== 'GLOBAL') {
      const pId = parseInt(projectFilter, 10);
      const isDirectProject = layer.project_id === pId;
      const isAssigned = projectAssignments[pId]?.layer_ids?.includes(layer.id);
      if (!isDirectProject && !isAssigned) return false;
    }
    if (searchTerm.trim()) {
      return (
        layer.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        layer.geometry_type?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return true;
  });

  const filteredTiles = allTiles.filter((tile) => {
    if (projectFilter === 'GLOBAL' && !tile.is_global) return false;
    if (projectFilter !== 'ALL' && projectFilter !== 'GLOBAL') {
      const pId = parseInt(projectFilter, 10);
      const isDirectProject = tile.project_id === pId;
      const isAssigned = projectAssignments[pId]?.tile_ids?.includes(tile.id);
      if (!isDirectProject && !isAssigned) return false;
    }
    if (searchTerm.trim()) {
      return (
        tile.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tile.filename?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return true;
  });

  const tabs = [
    { id: 'projects', label: 'परियोजनाहरू', labelEn: 'Projects', icon: FolderPlus },
    { id: 'tracking', label: 'लाइभ ट्र्याकिङ', labelEn: 'Live Tracking', icon: Radio },
    { id: 'layers', label: 'भेक्टर तहहरू', labelEn: 'Vector Layers', icon: Layers },
    { id: 'tiles', label: 'ड्रोन इमेज्री', labelEn: 'Drone MBTiles', icon: Image },
    { id: 'users', label: 'अधिकृतहरू', labelEn: 'Officers', icon: Users },
    { id: 'services', label: 'GIS सेवा लिङ्कहरू', labelEn: 'GIS Service Links', icon: ExternalLink },
  ];

  return (
    <div className="gov-sidebar font-sans" id="admin-panel">
      {/* Header */}
      <div className="gov-sidebar-header shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-gov-gold-400 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-white font-nepali leading-tight">
              प्रशासनिक नियन्त्रण (Admin Console)
            </h2>
            <span className="text-[10px] text-gov-blue-200 block">
              काठमाडौँ महानगरपालिका WebGIS व्यवस्थापन
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={loadData}
            className="p-1.5 text-gov-blue-200 hover:text-white hover:bg-gov-blue-900 rounded-lg transition-colors"
            title="पुनः लोड (Refresh)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-white/90 hover:text-white hover:bg-gov-red-700/90 rounded-lg transition-colors flex items-center gap-1 text-xs font-bold border border-white/20 hover:border-gov-red-500 shadow-xs"
            title="बन्द गर्नुहोस् (Close Admin Panel)"
          >
            <span className="text-[10px]">बन्द</span>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Alert Message */}
      {message && (
        <div
          className={`mx-3 mt-2 px-3 py-2 rounded-md text-xs font-semibold animate-fade-in flex items-center justify-between border shrink-0 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-gov-red-50 text-gov-red-800 border-gov-red-200'
          }`}
        >
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-slate-400 hover:text-slate-700 ml-2">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white px-2 pt-1.5 overflow-x-auto scrollbar-none shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setSearchTerm('');
              }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-colors whitespace-nowrap font-nepali ${
                isActive
                  ? 'text-gov-blue-800 border-gov-blue-800 bg-gov-blue-50/50'
                  : 'text-slate-500 border-transparent hover:text-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Body Content */}
      <div className="gov-sidebar-body space-y-3 flex-1 overflow-y-auto overscroll-contain p-3">
        {/* ======================================================== */}
        {/* ============ 1. PROJECTS TAB (with Layer Manager) ====== */}
        {/* ======================================================== */}
        {activeTab === 'projects' && (
          <div className="space-y-3 animate-fade-in">
            <button
              type="button"
              onClick={() => setShowProjectForm(!showProjectForm)}
              className="btn-gov-primary w-full text-xs font-bold py-2 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Plus className="w-4 h-4 text-gov-gold-400" />
              <span>नयाँ परियोजना थप्नुहोस् (New Project)</span>
            </button>

            {showProjectForm && (
              <form onSubmit={handleCreateProject} className="bg-white p-3.5 rounded-lg border border-gov-blue-300 shadow-md space-y-2.5 animate-slide-up">
                <div className="text-xs font-bold text-gov-blue-900 font-nepali border-b border-slate-100 pb-1 flex items-center justify-between">
                  <span>परियोजना विवरण (Project Setup)</span>
                  <span className="text-[10px] text-gov-red-600">* अनिवार्य</span>
                </div>
                <div>
                  <label className="gov-label">परियोजनाको नाम (Project Name)</label>
                  <input
                    value={projectForm.name}
                    onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="उदा. वडा नं. ४ तथ्याङ्क संकलन"
                    required
                  />
                </div>
                <div>
                  <label className="gov-label">विवरण (Description)</label>
                  <textarea
                    value={projectForm.description}
                    onChange={(e) => setProjectForm((p) => ({ ...p, description: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="परियोजनाको उद्देश्य र कार्यक्षेत्र..."
                    rows={2}
                  />
                </div>
                <div className="p-2.5 rounded bg-gov-blue-50/70 border border-gov-blue-200 text-[11px] text-gov-blue-900 flex items-start gap-2">
                  <Grid3X3 className="w-4 h-4 text-gov-blue-800 shrink-0 mt-0.5" />
                  <span>
                    <strong>सूचना:</strong> कार्यक्षेत्र विभाजन तथा ग्रिड व्यवस्थापन परियोजना सिर्जना पश्चात् <strong>कार्य विभाजन ग्रिड (Task Grid)</strong> बाट सिमाना अपलोड (Method A) वा ग्रिड उत्पादन (Method B) मार्फत गर्न सकिन्छ।
                  </span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" className="btn-gov-primary flex-1 text-xs py-1.5">
                    सिर्जना गर्नुहोस्
                  </button>
                  <button type="button" onClick={() => setShowProjectForm(false)} className="btn-gov-secondary text-xs py-1.5">
                    रद्द गर्नुहोस्
                  </button>
                </div>
              </form>
            )}

            {/* Projects List with Inline Asset & Collector Manager */}
            <div className="space-y-2.5">
              {projects.map((proj) => {
                const isExpanded = expandedProjectId === proj.id;
                const assignedLayerIds = projectAssignments[proj.id]?.layer_ids || [];
                const assignedTileIds = projectAssignments[proj.id]?.tile_ids || [];
                const assignedCollectors = projectCollectors[proj.id] || [];
                const availableCollectorsToAssign = users.filter(
                  (u) => u.role === 'DataCollector' && u.is_active && !assignedCollectors.some((ac) => ac.user_id === u.id)
                );

                // Directly scoped layers & assigned layers
                const linkedLayers = allLayers.filter(
                  (l) => l.project_id === proj.id || assignedLayerIds.includes(l.id)
                );
                // Directly scoped tiles & assigned tiles
                const linkedTiles = allTiles.filter(
                  (t) => t.project_id === proj.id || assignedTileIds.includes(t.id)
                );

                return (
                  <div
                    key={proj.id}
                    className={`bg-white rounded-lg border transition-all shadow-xs ${
                      isExpanded ? 'border-gov-blue-800 ring-1 ring-gov-blue-800/30' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Project Header Bar */}
                    <div
                      className="p-3 flex items-center justify-between cursor-pointer select-none"
                      onClick={() => setExpandedProjectId(isExpanded ? null : proj.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-gov-blue-50 border border-gov-blue-200 flex items-center justify-center text-gov-blue-800 shrink-0">
                          <Folder className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate font-nepali">
                            {proj.name}
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-2 font-mono">
                            <span className="bg-slate-100 px-1.5 py-0.2 rounded font-semibold text-slate-700">
                              #{proj.id} &middot; {proj.status}
                            </span>
                            <span>{proj.task_count || 0} ग्रिड</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] bg-gov-blue-100/70 text-gov-blue-900 font-bold px-1.5 py-0.5 rounded font-nepali">
                          {linkedLayers.length + linkedTiles.length} तहहरू
                        </span>
                        <span className="text-[10px] bg-emerald-100 text-emerald-900 font-bold px-1.5 py-0.5 rounded font-nepali">
                          {assignedCollectors.length} संकलक
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-500" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Project Details & Asset Linkage Manager */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 p-3 bg-slate-50/50 space-y-3 animate-fade-in text-xs">
                        {proj.description && (
                          <p className="text-[11px] text-slate-600 bg-white p-2 rounded border border-slate-200/70">
                            {proj.description}
                          </p>
                        )}

                        {/* 1. Linked Vector Layers */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 font-nepali">
                            <span className="flex items-center gap-1 text-gov-blue-900">
                              <Layers className="w-3.5 h-3.5 text-gov-blue-700" />
                              <span>संलग्न भेक्टर तहहरू ({linkedLayers.length})</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setAssignModal({ type: 'layer', targetProjectId: proj.id })}
                              className="text-[10px] text-gov-blue-800 hover:text-gov-blue-950 font-bold flex items-center gap-1 bg-gov-blue-100/60 hover:bg-gov-blue-200/70 px-1.5 py-0.5 rounded transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              <span>तह लिङ्क गर्नुहोस्</span>
                            </button>
                          </div>

                          {linkedLayers.length === 0 ? (
                            <div className="text-[10px] text-slate-400 bg-white p-2 rounded border border-dashed border-slate-200 text-center font-nepali">
                              यस परियोजनामा कुनै भेक्टर तह लिङ्क गरिएको छैन
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {linkedLayers.map((l) => {
                                const isDirect = l.project_id === proj.id;
                                return (
                                  <div
                                    key={l.id}
                                    className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-slate-200 text-[11px]"
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="w-2 h-2 rounded-full bg-gov-blue-700 shrink-0" />
                                      <span className="font-semibold text-slate-800 truncate font-nepali">
                                        {l.name}
                                      </span>
                                      <span className="text-[9px] text-slate-500 font-mono">
                                        ({l.geometry_type})
                                      </span>
                                      {isDirect ? (
                                        <span className="text-[9px] bg-amber-100 text-amber-900 font-bold px-1 rounded font-nepali">
                                          विशेष (Direct)
                                        </span>
                                      ) : (
                                        <span className="text-[9px] bg-slate-100 text-slate-700 px-1 rounded font-nepali">
                                          सार्वजनिक (Global)
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setLayerDownloadModal({ layer: l })}
                                        className="text-gov-blue-700 hover:text-gov-blue-900 p-0.5 rounded hover:bg-gov-blue-50 transition-colors"
                                        title="तह डाउनलोड गर्नुहोस् (Download Layer)"
                                      >
                                        <Download className="w-3 h-3" />
                                      </button>
                                      {!isDirect && (
                                        <button
                                          type="button"
                                          onClick={() => handleUnassignLayer(proj.id, l.id)}
                                          className="text-gov-red-600 hover:text-gov-red-800 p-0.5 rounded hover:bg-red-50 transition-colors"
                                          title="परियोजनाबाट हटाउनुहोस् (Unlink)"
                                        >
                                          <Unlink className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* 2. Linked MBTiles Imagery */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 font-nepali">
                            <span className="flex items-center gap-1 text-gov-blue-900">
                              <Image className="w-3.5 h-3.5 text-gov-blue-700" />
                              <span>संलग्न ड्रोन इमेज्री ({linkedTiles.length})</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setAssignModal({ type: 'tile', targetProjectId: proj.id })}
                              className="text-[10px] text-gov-blue-800 hover:text-gov-blue-950 font-bold flex items-center gap-1 bg-gov-blue-100/60 hover:bg-gov-blue-200/70 px-1.5 py-0.5 rounded transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              <span>इमेज्री लिङ्क गर्नुहोस्</span>
                            </button>
                          </div>

                          {linkedTiles.length === 0 ? (
                            <div className="text-[10px] text-slate-400 bg-white p-2 rounded border border-dashed border-slate-200 text-center font-nepali">
                              यस परियोजनामा कुनै ड्रोन इमेज्री लिङ्क गरिएको छैन
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {linkedTiles.map((t) => {
                                const isDirect = t.project_id === proj.id;
                                return (
                                  <div
                                    key={t.id}
                                    className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-slate-200 text-[11px]"
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                                      <span className="font-semibold text-slate-800 truncate font-nepali">
                                        {t.name}
                                      </span>
                                      {isDirect ? (
                                        <span className="text-[9px] bg-amber-100 text-amber-900 font-bold px-1 rounded font-nepali">
                                          विशेष (Direct)
                                        </span>
                                      ) : (
                                        <span className="text-[9px] bg-slate-100 text-slate-700 px-1 rounded font-nepali">
                                          सार्वजनिक (Global)
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={downloadingTileId === t.id}
                                        onClick={() => handleDownloadTile(t)}
                                        className="text-emerald-700 hover:text-emerald-900 p-0.5 rounded hover:bg-emerald-50 transition-colors"
                                        title="MBTiles डाउनलोड गर्नुहोस् (Download .mbtiles)"
                                      >
                                        {downloadingTileId === t.id ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Download className="w-3 h-3" />
                                        )}
                                      </button>
                                      {!isDirect && (
                                        <button
                                          type="button"
                                          onClick={() => handleUnassignTiles(proj.id, t.id)}
                                          className="text-gov-red-600 hover:text-gov-red-800 p-0.5 rounded hover:bg-red-50 transition-colors"
                                          title="परियोजनाबाट हटाउनुहोस् (Unlink)"
                                        >
                                          <Unlink className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* 3. Assigned Data Collectors (तोकिएका तथ्याङ्क संकलकहरू) */}
                        <div className="space-y-1.5 pt-1 border-t border-slate-200/60">
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 font-nepali">
                            <span className="flex items-center gap-1 text-gov-blue-900">
                              <Users className="w-3.5 h-3.5 text-gov-blue-700" />
                              <span>तोकिएका तथ्याङ्क संकलकहरू ({assignedCollectors.length})</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setAddingCollectorProjectId(addingCollectorProjectId === proj.id ? null : proj.id);
                                setSelectedCollectorIdToAssign('');
                              }}
                              className="text-[10px] text-gov-blue-800 hover:text-gov-blue-950 font-bold flex items-center gap-1 bg-gov-blue-100/60 hover:bg-gov-blue-200/70 px-1.5 py-0.5 rounded transition-colors"
                            >
                              <UserPlus className="w-3 h-3" />
                              <span>संकलक तोक्नुहोस्</span>
                            </button>
                          </div>

                          {/* Quick assign collector bar */}
                          {addingCollectorProjectId === proj.id && (
                            <div className="bg-gov-blue-50/80 p-2 rounded-lg border border-gov-blue-200 space-y-1.5 animate-slide-up">
                              <div className="text-[10px] font-bold text-gov-blue-900 font-nepali">
                                यस परियोजनामा तथ्याङ्क संकलक तोक्नुहोस् (Assign Data Collector):
                              </div>
                              {availableCollectorsToAssign.length === 0 ? (
                                <div className="text-[10px] text-slate-500 font-nepali">
                                  सबै तथ्याङ्क संकलकहरू यस परियोजनामा पहिल्यै तोकिएका छन् वा कुनै सक्रिय संकलक उपलब्ध छैन।
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <select
                                    value={selectedCollectorIdToAssign}
                                    onChange={(e) => setSelectedCollectorIdToAssign(e.target.value)}
                                    className="gov-input text-xs py-1 flex-1 bg-white"
                                  >
                                    <option value="">-- संकलक चयन गर्नुहोस् (Select Collector) --</option>
                                    {availableCollectorsToAssign.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.full_name || c.username} (@{c.username})
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={!selectedCollectorIdToAssign}
                                    onClick={() => handleAssignCollector(proj.id, parseInt(selectedCollectorIdToAssign, 10))}
                                    className="btn-gov-primary text-[10px] py-1 px-2.5 font-bold disabled:opacity-50"
                                  >
                                    तोक्नुहोस्
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setAddingCollectorProjectId(null)}
                                    className="btn-gov-secondary text-[10px] py-1 px-1.5"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {assignedCollectors.length === 0 ? (
                            <div className="text-[10px] text-slate-400 bg-white p-2 rounded border border-dashed border-slate-200 text-center font-nepali">
                              यस परियोजनामा कुनै तथ्याङ्क संकलक तोकिएको छैन (Data Collectors cannot access until assigned)
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {assignedCollectors.map((c) => (
                                <div
                                  key={c.user_id}
                                  className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-slate-200 text-[11px]"
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                                    <span className="font-semibold text-slate-800 truncate font-nepali">
                                      {c.full_name || c.username}
                                    </span>
                                    <span className="text-[9px] text-slate-500 font-mono">
                                      (@{c.username})
                                    </span>
                                    <span className="text-[9px] bg-gov-blue-50 text-gov-blue-800 font-semibold px-1 rounded font-nepali">
                                      {c.assigned_tasks_count} ग्रिड तोकिएको
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleUnassignCollector(proj.id, c.user_id)}
                                    className="text-gov-red-600 hover:text-gov-red-800 p-0.5 rounded hover:bg-red-50 transition-colors"
                                    title="परियोजनाबाट संकलक हटाउनुहोस् (Unassign)"
                                  >
                                    <UserX className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Quick Direct Upload Buttons for this specific project */}
                        <div className="pt-2 border-t border-slate-200/80 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setLayerUploadForm({ name: '', scope: 'PROJECT', projectId: String(proj.id), editable_by_collectors: true, allow_snapping: true });
                              setShowLayerUpload(true);
                              setActiveTab('layers');
                            }}
                            className="flex-1 py-1 px-2 rounded bg-white hover:bg-slate-100 text-gov-blue-800 border border-slate-300 text-[10px] font-bold font-nepali flex items-center justify-center gap-1"
                          >
                            <Upload className="w-3 h-3" />
                            <span>यस परियोजनामा भेक्टर अपलोड</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTileUploadForm({ name: '', description: '', scope: 'PROJECT', projectId: String(proj.id) });
                              setShowTileUpload(true);
                              setActiveTab('tiles');
                            }}
                            className="flex-1 py-1 px-2 rounded bg-white hover:bg-slate-100 text-gov-blue-800 border border-slate-300 text-[10px] font-bold font-nepali flex items-center justify-center gap-1"
                          >
                            <Upload className="w-3 h-3" />
                            <span>यस परियोजनामा इमेज्री अपलोड</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ============ LIVE TRACKING TAB (Collector Fleet) ======== */}
        {/* ======================================================== */}
        {activeTab === 'tracking' && (
          <div className="space-y-3 animate-fade-in">
            {/* Header Metrics */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <Radio className="w-4 h-4 animate-pulse" />
                </div>
                <div>
                  <div className="text-[10px] text-emerald-800 font-bold font-nepali">सक्रिय संकलकहरू</div>
                  <div className="text-base font-black text-emerald-950">
                    {collectorLocations.filter((c) => c.is_online).length} <span className="text-[10px] font-normal text-slate-500">/ {collectorLocations.length} जना</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[10px] text-slate-600 font-bold font-nepali">स्थान ट्र्याक स्थिति</div>
                  <div className="text-xs font-bold text-slate-800 font-nepali">
                    {collectorLocations.filter((c) => c.latitude && c.longitude).length} जनाको स्थान उपलब्ध
                  </div>
                </div>
              </div>
            </div>

            {/* Search Input */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="संकलक खोज्नुहोस् (Search collector)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="gov-input text-xs py-1.5 flex-1"
              />
              <button
                type="button"
                onClick={loadData}
                className="btn-gov-secondary text-xs py-1.5 px-2.5 flex items-center gap-1 font-nepali shrink-0"
                title="ताजा गर्नुहोस् (Refresh Locations)"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                <span>रिफ्रेस</span>
              </button>
            </div>

            {/* Collector Cards List */}
            <div className="space-y-2">
              {collectorLocations
                .filter((col) => {
                  if (!searchTerm.trim()) return true;
                  const term = searchTerm.toLowerCase();
                  return (
                    col.full_name?.toLowerCase().includes(term) ||
                    col.username?.toLowerCase().includes(term) ||
                    col.email?.toLowerCase().includes(term)
                  );
                })
                .map((col) => {
                  const hasLocation = col.latitude !== null && col.longitude !== null;
                  return (
                    <div
                      key={col.user_id}
                      className={`bg-white rounded-xl border p-3 shadow-xs space-y-2 transition-all ${
                        col.is_online ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="relative shrink-0">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                              col.is_online ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-400' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {col.full_name ? col.full_name.charAt(0).toUpperCase() : 'U'}
                            </div>
                            {col.is_online && (
                              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse ring-2 ring-white" />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 font-nepali truncate">
                              {col.full_name || col.username}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              @{col.username} &middot; {col.email}
                            </div>
                          </div>
                        </div>

                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 flex items-center gap-1 ${
                          col.is_online
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${col.is_online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                          <span>{col.is_online ? 'सक्रिय (Active)' : (col.app_state === 'background' || col.app_state === 'inactive' ? 'निष्क्रिय (Inactive)' : (col.minutes_ago !== null && col.minutes_ago !== undefined ? `${col.minutes_ago} मिनेट अघि` : 'निष्क्रिय (Inactive)'))}</span>
                        </span>
                      </div>

                      {/* Location & Metadata Details */}
                      <div className="bg-slate-50 rounded-lg p-2 text-[11px] space-y-1 border border-slate-100">
                        {hasLocation ? (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500 font-nepali">स्थान (GPS Coords):</span>
                              <span className="font-mono text-slate-800 font-semibold">
                                {col.latitude.toFixed(6)}°N, {col.longitude.toFixed(6)}°E
                              </span>
                            </div>
                            {col.accuracy && (
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-slate-500 font-nepali">शुद्धता (Accuracy):</span>
                                <span className="font-mono text-slate-600">±{col.accuracy.toFixed(1)} मिटर</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-slate-400 italic text-[10px] text-center font-nepali">
                            कुनै GPS स्थान प्राप्त भएको छैन (No GPS signal received yet)
                          </div>
                        )}

                        {col.assigned_projects?.length > 0 && (
                          <div className="flex items-center gap-1 pt-1 border-t border-slate-200/60 text-[10px]">
                            <span className="text-slate-500 font-nepali shrink-0">परियोजना:</span>
                            <div className="flex flex-wrap gap-1 truncate">
                              {col.assigned_projects.map((p) => (
                                <span key={p.id} className="px-1 rounded bg-gov-blue-100 text-gov-blue-800 font-semibold font-nepali">
                                  {p.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {col.active_task && (
                          <div className="text-[10px] text-amber-800 font-nepali font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 flex items-center justify-between">
                            <span>हाल म्यापिङ गर्दै: ग्रिड #{col.active_task.grid_index}</span>
                            <span className="text-[9px] bg-amber-200 text-amber-900 px-1 rounded">Locked</span>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      {hasLocation && onZoomToCollector && (
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              onZoomToCollector(col);
                              if (onClose) onClose();
                            }}
                            className="btn-gov-primary text-[10px] py-1 px-2.5 flex items-center gap-1 font-nepali"
                          >
                            <Crosshair className="w-3 h-3 text-gov-gold-400" />
                            <span>नक्सामा हेर्नुहोस् (Locate on Map)</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

              {collectorLocations.length === 0 && (
                <div className="text-center py-6 text-slate-400 font-nepali text-xs">
                  कुनै पनि तथ्याङ्क संकलक फेला परेन
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ============ 2. VECTOR LAYERS TAB (Global & Project) === */}
        {/* ======================================================== */}
        {activeTab === 'layers' && (
          <div className="space-y-3 animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowLayerUpload(!showLayerUpload)}
                className="btn-gov-primary text-xs font-bold py-2 flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Upload className="w-4 h-4 text-gov-gold-400" />
                <span>GeoJSON तह अपलोड</span>
              </button>

              {onOpenLinkLayers && (
                <button
                  type="button"
                  onClick={() => onOpenLinkLayers(null)}
                  className="bg-gov-blue-50 hover:bg-gov-blue-100 text-gov-blue-900 border border-gov-blue-300 rounded-lg text-xs font-bold py-2 flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                >
                  <Link2 className="w-4 h-4 text-gov-blue-800" />
                  <span>फिचर सम्बन्ध व्यवस्थापन</span>
                </button>
              )}
            </div>

            {/* Upload Modal / Form */}
            {showLayerUpload && (
              <form onSubmit={handleLayerUpload} className="bg-white p-3.5 rounded-lg border border-gov-blue-300 shadow-md space-y-2.5 animate-slide-up">
                <div className="text-xs font-bold text-gov-blue-900 font-nepali border-b border-slate-100 pb-1 flex items-center justify-between">
                  <span>भेक्टर तह अपलोड (Upload Vector Layer)</span>
                  <span className="text-[10px] text-gov-red-600">* अनिवार्य</span>
                </div>
                <div>
                  <label className="gov-label">तहको नाम (Layer Name)</label>
                  <input
                    name="name"
                    value={layerUploadForm.name}
                    onChange={(e) => setLayerUploadForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="उदा. काठमाडौँ वडा सिमाना"
                    required
                  />
                </div>

                {/* Scope selector: Global vs Project-Specific */}
                <div className="space-y-1">
                  <label className="gov-label">तहको कार्यक्षेत्र (Layer Scope)</label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        layerUploadForm.scope === 'GLOBAL'
                          ? 'border-gov-blue-800 bg-gov-blue-50/70 text-gov-blue-900 font-bold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="layer_scope"
                        checked={layerUploadForm.scope === 'GLOBAL'}
                        onChange={() => setLayerUploadForm((prev) => ({ ...prev, scope: 'GLOBAL', projectId: '' }))}
                        className="accent-gov-blue-800"
                      />
                      <Globe className="w-3.5 h-3.5 text-gov-blue-700" />
                      <span className="font-nepali text-[11px]">सार्वजनिक (Global)</span>
                    </label>

                    <label
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        layerUploadForm.scope === 'PROJECT'
                          ? 'border-gov-blue-800 bg-gov-blue-50/70 text-gov-blue-900 font-bold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="layer_scope"
                        checked={layerUploadForm.scope === 'PROJECT'}
                        onChange={() => setLayerUploadForm((prev) => ({ ...prev, scope: 'PROJECT' }))}
                        className="accent-gov-blue-800"
                      />
                      <Folder className="w-3.5 h-3.5 text-gov-blue-700" />
                      <span className="font-nepali text-[11px]">विशेष परियोजना</span>
                    </label>
                  </div>
                </div>

                {/* Project Selection Dropdown if Project-scoped */}
                {layerUploadForm.scope === 'PROJECT' && (
                  <div className="animate-fade-in">
                    <label className="gov-label text-gov-blue-900 font-bold">
                      लक्षित परियोजना छान्नुहोस् (Select Target Project) *
                    </label>
                    <select
                      value={layerUploadForm.projectId}
                      onChange={(e) => setLayerUploadForm((prev) => ({ ...prev, projectId: e.target.value }))}
                      className="gov-input text-xs"
                      required
                    >
                      <option value="">-- परियोजना चयन गर्नुहोस् --</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (#{p.id})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="gov-label">GeoJSON फाइल (.geojson / .json)</label>
                  <input name="file" type="file" accept=".geojson,.json" className="gov-input text-xs" required />
                </div>

                {/* Snapping Permission Toggle */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-800 font-nepali flex items-center gap-1.5 cursor-pointer">
                      <Magnet className="w-3.5 h-3.5 text-gov-blue-800" />
                      <span>स्न्यापिङ अनुमति दिनुहोस् (Allow Snapping)</span>
                    </label>
                    <p className="text-[10px] text-slate-500 font-nepali mt-0.5">
                      फिचरहरू कोर्दा वा सम्पादन गर्दा बिन्दु स्न्यापिङ (Snapping) गर्न सकिने बनाउनुहोस्
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLayerUploadForm((prev) => ({ ...prev, allow_snapping: !prev.allow_snapping }))}
                    className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      layerUploadForm.allow_snapping ? 'bg-emerald-600' : 'bg-slate-300'
                    }`}
                    title={layerUploadForm.allow_snapping ? 'स्न्यापिङ सक्षम छ' : 'स्न्यापिङ असक्षम छ'}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        layerUploadForm.allow_snapping ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {uploadProgress && (
                  <div className="space-y-1 py-1">
                    <div className="flex justify-between text-xs text-slate-600 font-semibold font-nepali">
                      <span>अपलोड हुँदैछ...</span>
                      <span className="font-mono text-gov-blue-800 font-bold">{uploadProgress.percent}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gov-blue-800 transition-all duration-200"
                        style={{ width: `${uploadProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={loading} className="btn-gov-primary flex-1 text-xs py-1.5 flex items-center justify-center gap-1">
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'अपलोड गर्नुहोस्'}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setShowLayerUpload(false)}
                    className="btn-gov-secondary text-xs py-1.5"
                  >
                    रद्द
                  </button>
                </div>
              </form>
            )}

            {/* Filter & Search Bar */}
            <div className="flex gap-2 text-xs">
              <div className="flex-1">
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="gov-input text-xs py-1"
                >
                  <option value="ALL">सबै तहहरू (All Layers)</option>
                  <option value="GLOBAL">🌐 सार्वजनिक मात्र (Global Only)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      📁 {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                placeholder="तह खोज्नुहोस्..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="gov-input text-xs py-1 w-36"
              />
            </div>

            {/* Layers List */}
            <div className="space-y-2">
              {filteredLayers.map((layer) => {
                const assignedProjNames = projects
                  .filter((p) => projectAssignments[p.id]?.layer_ids?.includes(layer.id))
                  .map((p) => p.name);

                const parentProj = layer.project_id ? projects.find((p) => p.id === layer.project_id) : null;

                return (
                  <div key={layer.id} className="bg-white rounded-lg border border-slate-200 p-3 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800 font-nepali truncate">
                          {layer.name}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                          <span>{layer.geometry_type}</span>
                          <span>&middot;</span>
                          <span>{layer.feature_count} वस्तुहरू</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Admin Snapping Quick Toggle */}
                        <button
                          type="button"
                          disabled={togglingSnappingLayerId === layer.id}
                          onClick={() => handleToggleLayerSnapping(layer)}
                          className={`p-1.5 rounded transition-colors ${
                            layer.allow_snapping !== false
                              ? 'text-emerald-700 hover:bg-emerald-50'
                              : 'text-slate-400 hover:text-emerald-700 hover:bg-slate-100'
                          }`}
                          title={
                            layer.allow_snapping !== false
                              ? 'यस तहमा स्न्यापिङ बन्द गर्नुहोस् (Click to Disable Snapping)'
                              : 'यस तहमा स्न्यापिङ अनुमति दिनुहोस् (Click to Enable Snapping)'
                          }
                        >
                          {togglingSnappingLayerId === layer.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                          ) : (
                            <Magnet className={`w-3.5 h-3.5 ${layer.allow_snapping !== false ? 'text-emerald-700' : 'text-slate-400'}`} />
                          )}
                        </button>
                        {onOpenLinkLayers && (
                          <button
                            type="button"
                            onClick={() => onOpenLinkLayers(layer)}
                            className="p-1.5 text-gov-blue-800 hover:bg-gov-blue-50 rounded transition-colors"
                            title="फिचर सम्बन्ध कायम गर्नुहोस् (Link Features)"
                          >
                            <Link2 className="w-3.5 h-3.5 text-gov-blue-800" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenFieldConfig(layer)}
                          className="p-1.5 text-gov-blue-800 hover:bg-gov-blue-50 rounded transition-colors"
                          title="तहका फिल्ड तथा अनिवार्य नियमहरू कन्फिगर गर्नुहोस् (Configure Fields & Compulsory Rules)"
                        >
                          <Sliders className="w-3.5 h-3.5 text-gov-blue-800" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setLayerDownloadModal({ layer })}
                          className="p-1.5 text-gov-blue-800 hover:bg-gov-blue-50 rounded transition-colors"
                          title="तह डाउनलोड गर्नुहोस् (Download Layer Data)"
                        >
                          {downloadingLayerId === layer.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-gov-blue-800" />
                          ) : (
                            <Download className="w-3.5 h-3.5 text-gov-blue-800" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssignModal({ type: 'layer', item: layer })}
                          className="p-1.5 text-slate-600 hover:text-gov-blue-800 hover:bg-slate-100 rounded transition-colors"
                          title="परियोजनामा समावेश / लिङ्क गर्नुहोस्"
                        >
                          <FolderPlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (window.confirm(`के तपाईं '${layer.name}' तह मेटाउन निश्चित हुनुहुन्छ?`)) {
                              await layersAPI.delete(layer.id);
                              loadData();
                            }
                          }}
                          className="p-1.5 text-gov-red-700 hover:bg-gov-red-50 rounded transition-colors"
                          title="मेटाउनुहोस्"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Badges: Scope, Linked Projects & Snapping Permission & Field Config */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                      {/* Fields & Compulsory Rules Quick Badge */}
                      <button
                        type="button"
                        onClick={() => handleOpenFieldConfig(layer)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold font-nepali bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100 transition-colors"
                        title="तहका फिल्ड तथा अनिवार्य नियमहरू हेर्नुहोस् र मिलाउनुहोस्"
                      >
                        <Sliders className="w-2.5 h-2.5 text-blue-700" />
                        <span>फिल्ड: {layer.fields_config?.length || 0}</span>
                        {layer.fields_config?.some((f) => f.required) && (
                          <span className="text-red-700 font-extrabold ml-0.5">
                            ({layer.fields_config.filter((f) => f.required).length} अनिवार्य)
                          </span>
                        )}
                      </button>

                      {/* Snapping Permission Badge */}
                      <button
                        type="button"
                        onClick={() => handleToggleLayerSnapping(layer)}
                        disabled={togglingSnappingLayerId === layer.id}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold font-nepali transition-all ${
                          layer.allow_snapping !== false
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100'
                        }`}
                        title={
                          layer.allow_snapping !== false
                            ? 'स्न्यापिङ सक्रिय छ — बन्द गर्न क्लिक गर्नुहोस्'
                            : 'स्न्यापिङ बन्द छ — खोल्न क्लिक गर्नुहोस्'
                        }
                      >
                        {togglingSnappingLayerId === layer.id ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Magnet className={`w-2.5 h-2.5 ${layer.allow_snapping !== false ? 'text-emerald-700' : 'text-rose-600'}`} />
                        )}
                        <span>{layer.allow_snapping !== false ? 'स्न्यापिङ: सक्षम' : 'स्न्यापिङ: बन्द'}</span>
                      </button>

                      {layer.is_global ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold font-nepali">
                          <Globe className="w-2.5 h-2.5" />
                          <span>सार्वजनिक (Global)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-50 text-amber-900 border border-amber-200 font-bold font-nepali">
                          <Folder className="w-2.5 h-2.5" />
                          <span>विशेष: {parentProj?.name || layer.project_name || `#${layer.project_id}`}</span>
                        </span>
                      )}

                      {assignedProjNames.length > 0 && (
                        <span className="text-slate-500 font-nepali">
                          संलग्न परियोजनाहरू: {assignedProjNames.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ============ 3. DRONE MBTILES TAB (Global & Project) === */}
        {/* ======================================================== */}
        {activeTab === 'tiles' && (
          <div className="space-y-3 animate-fade-in">
            <button
              type="button"
              onClick={() => setShowTileUpload(!showTileUpload)}
              className="btn-gov-primary w-full text-xs font-bold py-2 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Upload className="w-4 h-4 text-gov-gold-400" />
              <span>MBTiles (ड्रोन इमेज्री) अपलोड गर्नुहोस्</span>
            </button>

            {/* Upload Modal / Form */}
            {showTileUpload && (
              <form onSubmit={handleTileUpload} className="bg-white p-3.5 rounded-lg border border-gov-blue-300 shadow-md space-y-2.5 animate-slide-up">
                <div className="text-xs font-bold text-gov-blue-900 font-nepali border-b border-slate-100 pb-1 flex items-center justify-between">
                  <span>ड्रोन तथा स्याटेलाइट MBTiles अपलोड</span>
                  <span className="text-[10px] text-gov-red-600">* अनिवार्य</span>
                </div>
                <div>
                  <label className="gov-label">इमेज्री तहको नाम</label>
                  <input
                    name="name"
                    value={tileUploadForm.name}
                    onChange={(e) => setTileUploadForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="उदा. काठमाडौँ वडा ४ ड्रोन सर्भे २०२६"
                    required
                  />
                </div>
                <div>
                  <label className="gov-label">विवरण (Optional)</label>
                  <input
                    name="description"
                    value={tileUploadForm.description}
                    onChange={(e) => setTileUploadForm((prev) => ({ ...prev, description: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="विवरण..."
                  />
                </div>

                {/* Scope selector */}
                <div className="space-y-1">
                  <label className="gov-label">इमेज्रीको कार्यक्षेत्र (Imagery Scope)</label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        tileUploadForm.scope === 'GLOBAL'
                          ? 'border-gov-blue-800 bg-gov-blue-50/70 text-gov-blue-900 font-bold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="tile_scope"
                        checked={tileUploadForm.scope === 'GLOBAL'}
                        onChange={() => setTileUploadForm((prev) => ({ ...prev, scope: 'GLOBAL', projectId: '' }))}
                        className="accent-gov-blue-800"
                      />
                      <Globe className="w-3.5 h-3.5 text-gov-blue-700" />
                      <span className="font-nepali text-[11px]">सार्वजनिक (Global)</span>
                    </label>

                    <label
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        tileUploadForm.scope === 'PROJECT'
                          ? 'border-gov-blue-800 bg-gov-blue-50/70 text-gov-blue-900 font-bold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="tile_scope"
                        checked={tileUploadForm.scope === 'PROJECT'}
                        onChange={() => setTileUploadForm((prev) => ({ ...prev, scope: 'PROJECT' }))}
                        className="accent-gov-blue-800"
                      />
                      <Folder className="w-3.5 h-3.5 text-gov-blue-700" />
                      <span className="font-nepali text-[11px]">विशेष परियोजना</span>
                    </label>
                  </div>
                </div>

                {/* Project Selection Dropdown if Project-scoped */}
                {tileUploadForm.scope === 'PROJECT' && (
                  <div className="animate-fade-in">
                    <label className="gov-label text-gov-blue-900 font-bold">
                      लक्षित परियोजना छान्नुहोस् (Select Target Project) *
                    </label>
                    <select
                      value={tileUploadForm.projectId}
                      onChange={(e) => setTileUploadForm((prev) => ({ ...prev, projectId: e.target.value }))}
                      className="gov-input text-xs"
                      required
                    >
                      <option value="">-- परियोजना चयन गर्नुहोस् --</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (#{p.id})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="gov-label">MBTiles फाइल (.mbtiles)</label>
                  <input name="file" type="file" accept=".mbtiles" className="gov-input text-xs" required />
                </div>

                {uploadProgress && (
                  <div className="space-y-1 py-1">
                    <div className="flex justify-between text-xs text-slate-600 font-semibold font-nepali">
                      <span>अपलोड हुँदैछ...</span>
                      <span className="font-mono text-gov-blue-800 font-bold">{uploadProgress.percent}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gov-blue-800 transition-all duration-200"
                        style={{ width: `${uploadProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={loading} className="btn-gov-primary flex-1 text-xs py-1.5 flex items-center justify-center gap-1">
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'अपलोड गर्नुहोस्'}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setShowTileUpload(false)}
                    className="btn-gov-secondary text-xs py-1.5"
                  >
                    रद्द
                  </button>
                </div>
              </form>
            )}

            {/* Filter & Search Bar */}
            <div className="flex gap-2 text-xs">
              <div className="flex-1">
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="gov-input text-xs py-1"
                >
                  <option value="ALL">सबै इमेज्रीहरू (All Tiles)</option>
                  <option value="GLOBAL">🌐 सार्वजनिक मात्र (Global Only)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      📁 {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                placeholder="इमेज्री खोज्नुहोस्..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="gov-input text-xs py-1 w-36"
              />
            </div>

            {/* Tiles List */}
            <div className="space-y-2">
              {filteredTiles.map((tile) => {
                const assignedProjNames = projects
                  .filter((p) => projectAssignments[p.id]?.tile_ids?.includes(tile.id))
                  .map((p) => p.name);

                const parentProj = tile.project_id ? projects.find((p) => p.id === tile.project_id) : null;

                return (
                  <div key={tile.id} className="bg-white rounded-lg border border-slate-200 p-3 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800 font-nepali truncate">
                          {tile.name}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {tile.filename} &middot; {tile.file_size ? `${(tile.file_size / 1024 / 1024).toFixed(1)} MB` : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={downloadingTileId === tile.id}
                          onClick={() => handleDownloadTile(tile)}
                          className="p-1.5 text-emerald-800 hover:bg-emerald-50 rounded transition-colors"
                          title="MBTiles डाउनलोड गर्नुहोस् (Download .mbtiles)"
                        >
                          {downloadingTileId === tile.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-800" />
                          ) : (
                            <Download className="w-3.5 h-3.5 text-emerald-800" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssignModal({ type: 'tile', item: tile })}
                          className="p-1.5 text-gov-blue-800 hover:bg-gov-blue-50 rounded transition-colors"
                          title="परियोजनामा समावेश / लिङ्क गर्नुहोस्"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (window.confirm(`के तपाईं '${tile.name}' इमेज्री मेटाउन निश्चित हुनुहुन्छ?`)) {
                              await tilesAPI.delete(tile.id);
                              loadData();
                            }
                          }}
                          className="p-1.5 text-gov-red-700 hover:bg-gov-red-50 rounded transition-colors"
                          title="मेटाउनुहोस्"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Badges: Scope & Linked Projects */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                      {tile.is_global ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold font-nepali">
                          <Globe className="w-2.5 h-2.5" />
                          <span>सार्वजनिक (Global)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-50 text-amber-900 border border-amber-200 font-bold font-nepali">
                          <Folder className="w-2.5 h-2.5" />
                          <span>विशेष: {parentProj?.name || tile.project_name || `#${tile.project_id}`}</span>
                        </span>
                      )}

                      {assignedProjNames.length > 0 && (
                        <span className="text-slate-500 font-nepali">
                          संलग्न परियोजनाहरू: {assignedProjNames.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ============ 4. USERS MANAGEMENT TAB =================== */}
        {/* ======================================================== */}
        {activeTab === 'users' && (
          <div className="space-y-3 animate-fade-in">
            <button
              type="button"
              onClick={() => setShowUserForm(!showUserForm)}
              className="btn-gov-primary w-full text-xs font-bold py-2 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <UserPlus className="w-4 h-4 text-gov-gold-400" />
              <span>नयाँ अधिकृत थप्नुहोस् (New User)</span>
            </button>

            {showUserForm && (
              <form onSubmit={handleCreateUser} className="bg-white p-3.5 rounded-lg border border-gov-blue-300 shadow-md space-y-2.5 animate-slide-up">
                <div className="text-xs font-bold text-gov-blue-900 font-nepali border-b border-slate-100 pb-1 flex items-center justify-between">
                  <span>अधिकृत विवरण (Officer Setup)</span>
                  <span className="text-[10px] text-gov-red-600">* अनिवार्य</span>
                </div>
                <div>
                  <label className="gov-label">प्रयोगकर्ता नाम (Username)</label>
                  <input
                    value={userForm.username}
                    onChange={(e) => setUserForm((u) => ({ ...u, username: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="username"
                    required
                  />
                </div>
                <div>
                  <label className="gov-label">इमेल (Email)</label>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm((u) => ({ ...u, email: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="officer@kathmandu.gov.np"
                    required
                  />
                </div>
                <div>
                  <label className="gov-label">पूरा नाम (Full Name)</label>
                  <input
                    value={userForm.full_name}
                    onChange={(e) => setUserForm((u) => ({ ...u, full_name: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="राम बहादुर श्रेष्ठ"
                    required
                  />
                </div>
                <div>
                  <label className="gov-label">पासवर्ड (Password)</label>
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm((u) => ({ ...u, password: e.target.value }))}
                    className="gov-input text-xs"
                    placeholder="न्यूनतम ८ अक्षर"
                    required
                    minLength={8}
                  />
                </div>
                <div>
                  <label className="gov-label">पद / भूमिका (Role)</label>
                  <select
                    value={userForm.role}
                    onChange={(e) => setUserForm((u) => ({ ...u, role: e.target.value }))}
                    className="gov-input text-xs"
                  >
                    <option value="DataCollector">तथ्याङ्क संकलक (DataCollector)</option>
                    <option value="Validator">प्रमाणीकरणकर्ता (Validator)</option>
                    <option value="GisAdmin">GIS अधिकृत (GisAdmin)</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" className="btn-gov-primary flex-1 text-xs py-1.5">
                    सिर्जना गर्नुहोस्
                  </button>
                  <button type="button" onClick={() => setShowUserForm(false)} className="btn-gov-secondary text-xs py-1.5">
                    रद्द गर्नुहोस्
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2">
              {users.map((u) => {
                // Find all projects where this user is assigned
                const userProjects = projects.filter((p) =>
                  (projectCollectors[p.id] || []).some((c) => c.user_id === u.id)
                );

                return (
                  <div key={u.id} className="bg-white rounded-lg border border-slate-200 p-3 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-slate-800">{u.full_name || u.username}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          @{u.username} &middot; <strong className="text-gov-blue-800">{u.role}</strong>
                        </div>
                      </div>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border font-nepali ${
                          u.is_active
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-red-50 text-gov-red-700 border-red-200'
                        }`}
                      >
                        {u.is_active ? 'सक्रिय' : 'निष्क्रिय'}
                      </span>
                    </div>

                    {/* Show Project Assignments for Data Collectors */}
                    {u.role === 'DataCollector' ? (
                      <div className="bg-slate-50 p-2 rounded border border-slate-100 space-y-1">
                        <div className="text-[10px] font-bold text-slate-600 font-nepali flex items-center justify-between">
                          <span>तोकिएका परियोजनाहरू ({userProjects.length}):</span>
                        </div>
                        {userProjects.length === 0 ? (
                          <div className="text-[10px] text-amber-700 font-nepali italic">
                            कुनै परियोजना तोकिएको छैन (पहुँच प्रतिबन्धित)
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {userProjects.map((p) => {
                              const collectorInfo = (projectCollectors[p.id] || []).find((c) => c.user_id === u.id);
                              return (
                                <span
                                  key={p.id}
                                  className="inline-flex items-center gap-1 bg-gov-blue-50 text-gov-blue-900 border border-gov-blue-200 text-[10px] font-bold px-1.5 py-0.5 rounded font-nepali"
                                >
                                  <span>{p.name}</span>
                                  {collectorInfo?.assigned_tasks_count > 0 && (
                                    <span className="bg-gov-blue-200/70 text-gov-blue-950 text-[9px] px-1 rounded-full">
                                      {collectorInfo.assigned_tasks_count} ग्रिड
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 font-nepali bg-slate-50 px-2 py-1 rounded border border-slate-100">
                        {u.role === 'GisAdmin' ? 'पूर्ण प्रशासनिक पहुँच (Full Administrative Access)' : 'प्रमाणीकरणकर्ता पहुँच (Validator Access)'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ============ 5. GIS SERVICE LINKS TAB ================== */}
        {/* ======================================================== */}
        {activeTab === 'services' && (() => {
          const serverOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://103.69.126.226';
          return (
          <div className="space-y-4 animate-fade-in">
            {/* Connection Info */}
            <div className="bg-gov-blue-50 border border-gov-blue-200 rounded-lg p-3 text-xs space-y-2">
              <div className="font-bold text-gov-blue-800 flex items-center gap-1.5 font-nepali">
                <ExternalLink className="w-4 h-4 text-gov-blue-600" />
                QGIS कनेक्शन गाइड (Connection Guide)
              </div>
              <div className="text-gov-blue-700 space-y-1.5">
                <p className="font-semibold">OGC API – Features (Vector Layers):</p>
                <p>QGIS → Layer → Add Layer → WFS / OGC API Features →</p>
                <div className="flex items-center gap-1">
                  <code className="bg-white px-2 py-0.5 rounded border text-[10px] font-mono flex-1 truncate select-all font-semibold text-slate-800">
                    {serverOrigin}/ogc/
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${serverOrigin}/ogc/`);
                      setMessage({ type: 'success', text: 'OGC URL कपि भयो!' });
                      setTimeout(() => setMessage(null), 2000);
                    }}
                    className="text-gov-blue-600 hover:text-gov-blue-800 p-0.5"
                    title="Copy"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">Open (no auth) — anyone with the URL can view and edit</p>
                <div className="flex items-center gap-1 mt-1">
                  <code className="bg-white px-2 py-0.5 rounded border text-[10px] font-mono flex-1 truncate select-all font-semibold text-slate-800">
                    {serverOrigin}/ogc-secure/
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${serverOrigin}/ogc-secure/`);
                      setMessage({ type: 'success', text: 'Secure OGC URL कपि भयो!' });
                      setTimeout(() => setMessage(null), 2000);
                    }}
                    className="text-gov-blue-600 hover:text-gov-blue-800 p-0.5"
                    title="Copy"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">Secure — requires Bearer token authentication</p>
              </div>
            </div>

            {/* Vector Layers Section */}
            <div>
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2 font-nepali">
                <Layers className="w-4 h-4 text-gov-blue-600" />
                भेक्टर तहहरू (Vector Layers) — {allLayers.length}
              </h3>
              <div className="space-y-1.5">
                {allLayers.length === 0 && (
                  <div className="text-xs text-slate-400 italic text-center py-3 font-nepali">
                    कुनै भेक्टर तह छैन (No vector layers)
                  </div>
                )}
                {allLayers.map((layer) => {
                  const ogcItemsUrl = `${serverOrigin}/ogc/collections/${layer.id}/items`;
                  return (
                    <div key={layer.id} className="bg-white border border-slate-200 rounded-lg p-2.5 hover:border-gov-blue-300 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-800 truncate">{layer.name}</span>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-mono">
                          {layer.geometry_type}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mb-1.5">
                        {layer.feature_count ?? 0} features • {layer.is_global ? 'Global' : `Project #${layer.project_id}`}
                      </div>
                      <div className="flex items-center gap-1">
                        <code className="bg-slate-50 px-1.5 py-0.5 rounded border text-[9px] font-mono flex-1 truncate select-all text-slate-700 font-semibold">
                          {ogcItemsUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(ogcItemsUrl);
                            setMessage({ type: 'success', text: `${layer.name} URL कपि भयो!` });
                            setTimeout(() => setMessage(null), 2000);
                          }}
                          className="text-slate-400 hover:text-gov-blue-600 p-0.5 shrink-0"
                          title="Copy URL"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Raster/Tile Layers Section */}
            <div>
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2 font-nepali">
                <Image className="w-4 h-4 text-amber-600" />
                र्यास्टर/टाइल तहहरू (Raster/Tile Layers) — {allTiles.length}
              </h3>
              <div className="space-y-1.5">
                {allTiles.length === 0 && (
                  <div className="text-xs text-slate-400 italic text-center py-3 font-nepali">
                    कुनै MBTiles छैन (No MBTiles)
                  </div>
                )}
                {allTiles.map((tile) => {
                  const xyzUrl = `${serverOrigin}/api/tiles/${tile.id}/{z}/{x}/{y}.png`;
                  const tileJsonUrl = `${serverOrigin}/api/tiles/${tile.id}/tilejson.json`;
                  return (
                    <div key={tile.id} className="bg-white border border-slate-200 rounded-lg p-2.5 hover:border-amber-300 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-800 truncate">{tile.name}</span>
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-mono">
                          z{tile.min_zoom ?? 0}-{tile.max_zoom ?? 22}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mb-1.5">
                        {tile.file_size ? `${(tile.file_size / 1024 / 1024).toFixed(1)} MB` : 'N/A'} • {tile.is_global ? 'Global' : `Project #${tile.project_id}`}
                      </div>
                      {/* XYZ URL */}
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-[9px] text-slate-400 w-7 shrink-0">XYZ</span>
                        <code className="bg-slate-50 px-1.5 py-0.5 rounded border text-[9px] font-mono flex-1 truncate select-all text-slate-700 font-semibold">
                          {xyzUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(xyzUrl);
                            setMessage({ type: 'success', text: `${tile.name} XYZ URL कपि भयो!` });
                            setTimeout(() => setMessage(null), 2000);
                          }}
                          className="text-slate-400 hover:text-amber-600 p-0.5 shrink-0"
                          title="Copy XYZ URL"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      {/* TileJSON URL */}
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-400 w-7 shrink-0">JSON</span>
                        <code className="bg-slate-50 px-1.5 py-0.5 rounded border text-[9px] font-mono flex-1 truncate select-all text-slate-700 font-semibold">
                          {tileJsonUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(tileJsonUrl);
                            setMessage({ type: 'success', text: `${tile.name} TileJSON URL कपि भयो!` });
                            setTimeout(() => setMessage(null), 2000);
                          }}
                          className="text-slate-400 hover:text-amber-600 p-0.5 shrink-0"
                          title="Copy TileJSON URL"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          );
        })()}
      </div>

      {/* ======================================================== */}
      {/* ============ ASSET LINKAGE POPUP MODAL ================= */}
      {/* ======================================================== */}
      {assignModal && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in font-sans">
          <div className="bg-white rounded-xl shadow-2xl border border-gov-blue-400 w-full max-w-sm overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-gov-blue-800 text-white px-3.5 py-2.5 flex items-center justify-between text-xs font-bold font-nepali">
              <div className="flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-gov-gold-400" />
                <span>
                  {assignModal.type === 'layer' ? 'भेक्टर तह लिङ्क गर्नुहोस्' : 'MBTiles इमेज्री लिङ्क गर्नुहोस्'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAssignModal(null)}
                className="text-white/80 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 space-y-3 flex-1 overflow-y-auto text-xs">
              {/* Scenario A: Linking a specific Project to an Asset from Layers/Tiles Tab */}
              {assignModal.item && !assignModal.targetProjectId && (
                <div className="space-y-2">
                  <div className="bg-gov-blue-50 p-2 rounded border border-gov-blue-200 text-[11px] text-gov-blue-950 font-bold font-nepali">
                    तह: {assignModal.item.name}
                  </div>
                  <label className="gov-label font-nepali font-bold">
                    कुन परियोजनामा लिङ्क गर्ने? (Select Target Project)
                  </label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {projects.map((p) => {
                      const isAlreadyAssigned =
                        assignModal.type === 'layer'
                          ? projectAssignments[p.id]?.layer_ids?.includes(assignModal.item.id)
                          : projectAssignments[p.id]?.tile_ids?.includes(assignModal.item.id);

                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2 rounded border border-slate-200 hover:bg-slate-50 text-[11px]"
                        >
                          <span className="font-semibold text-slate-800 font-nepali truncate">
                            {p.name}
                          </span>
                          {isAlreadyAssigned ? (
                            <span className="text-[10px] text-emerald-700 font-bold font-nepali flex items-center gap-1">
                              <Check className="w-3 h-3" /> पहिले नै लिङ्क
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (assignModal.type === 'layer') {
                                  handleAssignLayer(p.id, assignModal.item.id);
                                } else {
                                  handleAssignTiles(p.id, assignModal.item.id);
                                }
                              }}
                              className="btn-gov-primary text-[10px] py-1 px-2 font-nepali"
                            >
                              लिङ्क गर्नुहोस्
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Scenario B: Linking an available Asset to a Project from Projects Tab */}
              {assignModal.targetProjectId && (
                <div className="space-y-2">
                  <div className="bg-gov-blue-50 p-2 rounded border border-gov-blue-200 text-[11px] text-gov-blue-950 font-bold font-nepali">
                    परियोजना: {projects.find((p) => p.id === assignModal.targetProjectId)?.name}
                  </div>
                  <label className="gov-label font-nepali font-bold">
                    उपलब्ध {assignModal.type === 'layer' ? 'सार्वजनिक तहहरू' : 'ड्रोन इमेज्रीहरू'}
                  </label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {(assignModal.type === 'layer' ? allLayers : allTiles)
                      .filter((item) => item.is_global)
                      .map((item) => {
                        const isAlreadyAssigned =
                          assignModal.type === 'layer'
                            ? projectAssignments[assignModal.targetProjectId]?.layer_ids?.includes(item.id)
                            : projectAssignments[assignModal.targetProjectId]?.tile_ids?.includes(item.id);

                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-2 rounded border border-slate-200 hover:bg-slate-50 text-[11px]"
                          >
                            <span className="font-semibold text-slate-800 font-nepali truncate">
                              {item.name}
                            </span>
                            {isAlreadyAssigned ? (
                              <span className="text-[10px] text-emerald-700 font-bold font-nepali flex items-center gap-1">
                                <Check className="w-3 h-3" /> लिङ्क गरिएको
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  if (assignModal.type === 'layer') {
                                    handleAssignLayer(assignModal.targetProjectId, item.id);
                                  } else {
                                    handleAssignTiles(assignModal.targetProjectId, item.id);
                                  }
                                }}
                                className="btn-gov-primary text-[10px] py-1 px-2 font-nepali"
                              >
                                लिङ्क गर्नुहोस्
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 px-3.5 py-2 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setAssignModal(null)}
                className="btn-gov-secondary text-xs py-1 px-3"
              >
                बन्द गर्नुहोस्
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ============ VECTOR LAYER DOWNLOAD MODAL =============== */}
      {/* ======================================================== */}
      {layerDownloadModal && layerDownloadModal.layer && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in font-sans">
          <div className="bg-white rounded-xl shadow-2xl border border-gov-blue-400 w-full max-w-sm overflow-hidden flex flex-col max-h-[85vh] animate-slide-up">
            <div className="bg-gov-blue-800 text-white px-3.5 py-2.5 flex items-center justify-between text-xs font-bold font-nepali">
              <div className="flex items-center gap-1.5">
                <Download className="w-4 h-4 text-gov-gold-400" />
                <span>तह डाउनलोड गर्नुहोस् (Download Layer)</span>
              </div>
              <button
                type="button"
                onClick={() => setLayerDownloadModal(null)}
                className="text-white/80 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 space-y-3 flex-1 overflow-y-auto text-xs">
              <div className="bg-gov-blue-50 p-2.5 rounded-lg border border-gov-blue-200">
                <div className="text-xs font-bold text-gov-blue-950 font-nepali">
                  {layerDownloadModal.layer.name}
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                  प्रकार: {layerDownloadModal.layer.geometry_type} &middot; वस्तु संख्या: {layerDownloadModal.layer.feature_count ?? '-'}
                </div>
              </div>

              <div className="space-y-1">
                <label className="gov-label font-nepali font-bold">
                  डाउनलोड ढाँचा चयन गर्नुहोस् (Choose Export Format):
                </label>

                <div className="space-y-2 pt-1">
                  {/* GeoJSON */}
                  <button
                    type="button"
                    disabled={downloadingLayerId === layerDownloadModal.layer.id}
                    onClick={() => handleDownloadLayer(layerDownloadModal.layer, 'geojson')}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-left group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-center font-bold text-[10px] shrink-0">
                        JSON
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 font-nepali text-xs group-hover:text-gov-blue-900">
                          GeoJSON (.geojson)
                        </div>
                        <div className="text-[10px] text-slate-500">
                          मानक GIS तथा वेब नक्साङ्कन ढाँचा (RFC 7946)
                        </div>
                      </div>
                    </div>
                    {downloadingLayerId === layerDownloadModal.layer.id ? (
                      <Loader2 className="w-4 h-4 text-gov-blue-800 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 text-slate-400 group-hover:text-gov-blue-800 shrink-0" />
                    )}
                  </button>

                  {/* ESRI Shapefile */}
                  <button
                    type="button"
                    disabled={downloadingLayerId === layerDownloadModal.layer.id}
                    onClick={() => handleDownloadLayer(layerDownloadModal.layer, 'shapefile')}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-left group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-center font-bold text-[10px] shrink-0">
                        SHP
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 font-nepali text-xs group-hover:text-gov-blue-900">
                          ESRI Shapefile (.zip)
                        </div>
                        <div className="text-[10px] text-slate-500">
                          ArcGIS, QGIS, तथा डेस्कटप GIS बन्डल
                        </div>
                      </div>
                    </div>
                    {downloadingLayerId === layerDownloadModal.layer.id ? (
                      <Loader2 className="w-4 h-4 text-gov-blue-800 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 text-slate-400 group-hover:text-gov-blue-800 shrink-0" />
                    )}
                  </button>

                  {/* KML */}
                  <button
                    type="button"
                    disabled={downloadingLayerId === layerDownloadModal.layer.id}
                    onClick={() => handleDownloadLayer(layerDownloadModal.layer, 'kml')}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-left group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 flex items-center justify-center font-bold text-[10px] shrink-0">
                        KML
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 font-nepali text-xs group-hover:text-gov-blue-900">
                          KML (.kml)
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Google Earth तथा थ्री-डी नक्सा ढाँचा
                        </div>
                      </div>
                    </div>
                    {downloadingLayerId === layerDownloadModal.layer.id ? (
                      <Loader2 className="w-4 h-4 text-gov-blue-800 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 text-slate-400 group-hover:text-gov-blue-800 shrink-0" />
                    )}
                  </button>

                  {/* CSV */}
                  <button
                    type="button"
                    disabled={downloadingLayerId === layerDownloadModal.layer.id}
                    onClick={() => handleDownloadLayer(layerDownloadModal.layer, 'csv')}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-left group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 flex items-center justify-center font-bold text-[10px] shrink-0">
                        CSV
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 font-nepali text-xs group-hover:text-gov-blue-900">
                          CSV स्प्रेडसिट (.csv)
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Microsoft Excel तथा WKT ज्यामिति सहित
                        </div>
                      </div>
                    </div>
                    {downloadingLayerId === layerDownloadModal.layer.id ? (
                      <Loader2 className="w-4 h-4 text-gov-blue-800 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 text-slate-400 group-hover:text-gov-blue-800 shrink-0" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 px-3.5 py-2 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setLayerDownloadModal(null)}
                className="btn-gov-secondary text-xs py-1 px-3"
              >
                रद्द
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Field Configuration & Compulsory Rules Modal */}
      {fieldConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="bg-gov-blue-900 text-white px-4 py-3 flex items-center justify-between shrink-0 shadow-sm">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-gov-blue-200" />
                <div>
                  <h3 className="text-sm font-bold font-nepali">
                    तहका विशेषता तथा अनिवार्य नियमहरू (Layer Fields & Compulsory Rules)
                  </h3>
                  <p className="text-[11px] text-gov-blue-200 font-nepali">
                    लक्षित तह: <span className="text-white font-bold">{fieldConfigModal.layer.name}</span> ({fieldConfigModal.layer.geometry_type})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFieldConfigModal(null)}
                className="text-white/80 hover:text-white p-1 rounded hover:bg-gov-blue-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Instruction Notice */}
            <div className="bg-blue-50/80 px-4 py-2.5 border-b border-blue-200 text-xs text-blue-950 font-nepali flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-gov-blue-800 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                यस तहमा नयाँ फिचर (बिन्दु, रेखा वा बहुभुज) सिर्जना गर्दा फारममा <strong>यहाँ तोकिएका फिल्डहरू मात्र</strong> स्वतः देखिनेछन्। प्रशासकले <strong>'अनिवार्य'</strong> चिन्ह लगाएका फिल्डहरू नभरी कसैले पनि फिचर सुरक्षित गर्न पाउने छैनन्।
              </div>
            </div>

            {/* Modal Body & Fields Table */}
            <div className="p-4 flex-1 overflow-y-auto space-y-3 scrollbar-thin">
              {/* Action Toolbar */}
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div className="text-xs font-bold text-slate-700 font-nepali flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-gov-blue-800" />
                  <span>फिल्ड सूची ({fieldConfigModal.fields.length}):</span>
                  {fieldConfigModal.fields.filter((f) => f.required).length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 font-bold border border-rose-300">
                      {fieldConfigModal.fields.filter((f) => f.required).length} अनिवार्य
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={fieldConfigModal.loading}
                    onClick={handleAutoDetectFields}
                    className="btn-gov-secondary py-1 px-2.5 text-xs flex items-center gap-1 font-nepali"
                    title="तहमा रहेका मौजुदा फिचरहरूबाट फिल्ड नामहरू पहिचान गर्नुहोस्"
                  >
                    {fieldConfigModal.loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-gov-blue-800" />
                    )}
                    <span>स्वतः पहिचान (Auto-Detect)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFieldConfigModal((prev) => ({
                        ...prev,
                        fields: [
                          ...prev.fields,
                          {
                            name: `field_${prev.fields.length + 1}`,
                            label: `नयाँ फिल्ड ${prev.fields.length + 1}`,
                            type: 'text',
                            required: false,
                          },
                        ],
                      }));
                    }}
                    className="btn-gov-primary py-1 px-2.5 text-xs flex items-center gap-1 font-nepali"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>नयाँ फिल्ड थप्नुहोस्</span>
                  </button>
                </div>
              </div>

              {/* Loading State */}
              {fieldConfigModal.loading && (
                <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-2 font-nepali">
                  <Loader2 className="w-6 h-6 animate-spin text-gov-blue-800" />
                  <span>तहका विशेषताहरू लोड हुँदैछन्...</span>
                </div>
              )}

              {/* Empty Fields State */}
              {!fieldConfigModal.loading && fieldConfigModal.fields.length === 0 && (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-2">
                  <Database className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs font-bold text-slate-700 font-nepali">
                    यस तहमा हालसम्म कुनै विशेषता फिल्डहरू छैनन्।
                  </p>
                  <p className="text-[11px] text-slate-500 font-nepali">
                    मौजुदा फिचरबाट पहिचान गर्न 'स्वतः पहिचान' थिच्नुहोस् वा 'नयाँ फिल्ड थप्नुहोस्' बाट थप्नुहोस्।
                  </p>
                </div>
              )}

              {/* Fields Table */}
              {!fieldConfigModal.loading && fieldConfigModal.fields.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-x-auto shadow-xs">
                  <div className="min-w-[560px]">
                    <div className="bg-slate-100 px-3 py-2 grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-700 font-nepali border-b border-slate-200">
                      <div className="col-span-3">फिल्ड नाम (Key)</div>
                      <div className="col-span-3">नेपाली लेबल (Display Label)</div>
                      <div className="col-span-2">प्रकार (Type)</div>
                      <div className="col-span-3 text-center">अनिवार्यता (Compulsory)</div>
                      <div className="col-span-1 text-right">हटाउनुहोस्</div>
                    </div>

                    <div className="divide-y divide-slate-200 max-h-[50vh] overflow-y-auto">
                      {fieldConfigModal.fields.map((f, idx) => (
                        <div key={idx} className="px-3 py-2 grid grid-cols-12 gap-2 items-center hover:bg-slate-50 transition-colors text-xs">
                          {/* 1. Field Key/Name */}
                          <div className="col-span-3">
                            <input
                              type="text"
                              value={f.name}
                              onChange={(e) => {
                                const newName = e.target.value.replace(/\s+/g, '_').toLowerCase();
                                setFieldConfigModal((prev) => {
                                  const next = [...prev.fields];
                                  next[idx] = { ...next[idx], name: newName };
                                  return { ...prev, fields: next };
                                });
                              }}
                              placeholder="e.g. ward_no"
                              className="gov-input py-1 px-2 text-xs font-mono"
                            />
                          </div>

                          {/* 2. Display Label */}
                          <div className="col-span-3">
                            <input
                              type="text"
                              value={f.label || ''}
                              onChange={(e) => {
                                const newLabel = e.target.value;
                                setFieldConfigModal((prev) => {
                                  const next = [...prev.fields];
                                  next[idx] = { ...next[idx], label: newLabel };
                                  return { ...prev, fields: next };
                                });
                              }}
                              placeholder="e.g. वडा नं."
                              className="gov-input py-1 px-2 text-xs font-nepali"
                            />
                          </div>

                          {/* 3. Field Type */}
                          <div className="col-span-2">
                            <select
                              value={f.type || 'text'}
                              onChange={(e) => {
                                const newType = e.target.value;
                                setFieldConfigModal((prev) => {
                                  const next = [...prev.fields];
                                  next[idx] = { ...next[idx], type: newType };
                                  return { ...prev, fields: next };
                                });
                              }}
                              className="gov-input py-1 px-1.5 text-[11px] cursor-pointer"
                            >
                              <option value="text">Text (अक्षर)</option>
                              <option value="number">Number (संख्या)</option>
                              <option value="date">Date (मिति)</option>
                              <option value="select">Select (छनौट)</option>
                              <option value="textarea">Textarea (लामो)</option>
                              <option value="checkbox">Checkbox (हो/होइन)</option>
                              <option value="file">Photo/File (फोटो)</option>
                            </select>
                          </div>

                          {/* 4. Compulsory Toggle Switch */}
                          <div className="col-span-3 flex justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                setFieldConfigModal((prev) => {
                                  const next = [...prev.fields];
                                  next[idx] = { ...next[idx], required: !next[idx].required };
                                  return { ...prev, fields: next };
                                });
                              }}
                              className={`px-2.5 py-1 rounded-full text-[10.5px] font-bold font-nepali flex items-center gap-1.5 transition-all cursor-pointer border ${
                                f.required
                                  ? 'bg-rose-100 text-rose-900 border-rose-300 shadow-xs ring-1 ring-rose-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200/70'
                              }`}
                              title={f.required ? 'क्लिक गरी ऐच्छिक (Optional) बनाउनुहोस्' : 'क्लिक गरी अनिवार्य (Compulsory) बनाउनुहोस्'}
                            >
                              <span className={`w-2 h-2 rounded-full ${f.required ? 'bg-rose-600 animate-pulse' : 'bg-slate-400'}`} />
                              <span>{f.required ? 'अनिवार्य (Compulsory)' : 'ऐच्छिक (Optional)'}</span>
                            </button>
                          </div>

                          {/* 5. Delete Field Button */}
                          <div className="col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setFieldConfigModal((prev) => ({
                                  ...prev,
                                  fields: prev.fields.filter((_, i) => i !== idx),
                                }));
                              }}
                              className="p-1 text-slate-400 hover:text-gov-red-700 hover:bg-red-50 rounded transition-colors"
                              title="फिल्ड हटाउनुहोस्"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between shrink-0">
              <div className="text-[11px] text-slate-500 font-nepali">
                {fieldConfigModal.fields.length} फिल्डहरूमध्ये{' '}
                <span className="font-bold text-rose-700">
                  {fieldConfigModal.fields.filter((f) => f.required).length} अनिवार्य
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFieldConfigModal(null)}
                  className="btn-gov-secondary text-xs py-1.5 px-3.5 font-nepali"
                >
                  रद्द (Cancel)
                </button>
                <button
                  type="button"
                  disabled={fieldConfigModal.saving || fieldConfigModal.loading}
                  onClick={handleSaveFieldConfig}
                  className="btn-gov-primary text-xs py-1.5 px-4 font-nepali flex items-center gap-1.5 shadow-sm"
                >
                  {fieldConfigModal.saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>{fieldConfigModal.saving ? 'सुरक्षित गरिँदैछ...' : 'कन्फिगरेसन सुरक्षित गर्नुहोस् (Save)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
