'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Grid3X3, Settings, Layers, PenTool, Circle, Square, Triangle,
  Minus, MapPin, Pencil, Plus, Edit3, Magnet, Sparkles, MousePointerClick,
  Crosshair, Check, CheckCircle2, Move, Undo2, Redo2, RotateCcw, ChevronDown, ChevronUp, X, AlertTriangle,
  Trash2, Link2
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { projectsAPI, tasksAPI, layersAPI, featuresAPI, tilesAPI, trackingAPI } from '../../lib/api';
import { setupOnlineSync } from '../../lib/offlineSync';
import api from '../../lib/api';
import useGeolocation from '../../hooks/useGeolocation';
import Navbar from '../../components/Navbar';
import KmcMap from '../../components/KmcMap';
import LayerControl from '../../components/LayerControl';
import TaskPanel from '../../components/TaskPanel';
import DynamicFormRenderer from '../../components/DynamicFormRenderer';
import FeatureEditPanel from '../../components/FeatureEditPanel';
import FeatureDetailsPanel from '../../components/FeatureDetailsPanel';
import AdminPanel from '../../components/AdminPanel';
import LinkLayersModal from '../../components/LinkLayersModal';
import GpsGuardModal from '../../components/GpsGuardModal';
import LayerEditsModal from '../../components/LayerEditsModal';
import ErrorBoundary from '../../components/ErrorBoundary';
import { getDistanceToGeoJsonGeometry, GEOFENCE_EDIT_RADIUS_METERS } from '../../lib/geoDistance';

function DashboardContent() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading, isAdmin, isCollector, isValidator } = useAuth();
  const {
    position: gpsPosition,
    error: gpsError,
    isTracking: gpsTracking,
    startTracking: restartGps,
  } = useGeolocation();

  // ---- Real-Time Fleet Tracking State ----
  const [collectorLocations, setCollectorLocations] = useState([]);
  const [showCollectorTracking, setShowCollectorTracking] = useState(false);

  // ---- Projects ----
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [taskGrids, setTaskGrids] = useState(null);

  // ---- Server Raster (MBTiles) & Vector (PostGIS) Layers ----
  const [serverRasters, setServerRasters] = useState([]);
  const [serverVectors, setServerVectors] = useState([]);
  const [activeLayerId, setActiveLayerId] = useState(null);

  // ---- UI / Basemap / Zoom State ----
  const [activeBasemap, setActiveBasemap] = useState('google');
  const [basemapOpacity, setBasemapOpacity] = useState(100);
  const [zoomTarget, setZoomTarget] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showLayerControl, setShowLayerControl] = useState(false);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [inspectedFeature, setInspectedFeature] = useState(null);
  const [layerEditsModalTarget, setLayerEditsModalTarget] = useState(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formCollapsed, setFormCollapsed] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [drawMode, setDrawMode] = useState(null);
  const [editingGeometry, setEditingGeometry] = useState(null);
  const [initialFormAttributes, setInitialFormAttributes] = useState({});
  const [activeLayerFormSchema, setActiveLayerFormSchema] = useState(null);
  const [activeLayerLinkingIdField, setActiveLayerLinkingIdField] = useState('_id');
  const [refLayerId, setRefLayerId] = useState('auto');
  const [refLayerLinkingIdField, setRefLayerLinkingIdField] = useState('_id');
  const [enableLayerLinking, setEnableLayerLinking] = useState(false);
  const [pickFeatureMode, setPickFeatureMode] = useState(false);
  const [selectedLinkedFeature, setSelectedLinkedFeature] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // ---- Task Grid Boundary Drawing State ----
  const [drawingTaskBoundary, setDrawingTaskBoundary] = useState(false);
  const [drawnTaskBoundary, setDrawnTaskBoundary] = useState(null);

  const handleStartDrawBoundary = useCallback((mode = 'Polygon') => {
    setDrawingTaskBoundary(true);
    setDrawMode(mode === 'Box' ? 'Box' : 'Polygon');
  }, []);

  const handleClearDrawnBoundary = useCallback(() => {
    setDrawnTaskBoundary(null);
    setDrawingTaskBoundary(false);
    if (drawMode === 'Polygon' || drawMode === 'Box') {
      setDrawMode(null);
    }
  }, [drawMode]);

  // ---- Edit Mode State ----
  const [editMode, setEditMode] = useState(false);
  const [editLayerId, setEditLayerId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [featureSaving, setFeatureSaving] = useState(false);
  const [featureDeleting, setFeatureDeleting] = useState(false);
  const [editToolsCollapsed, setEditToolsCollapsed] = useState(false);
  const [drawToolsCollapsed, setDrawToolsCollapsed] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [editSubMode, setEditSubMode] = useState(null); // null (none selected = all allowed) | 'tane' | 'bistar' | 'metne'

  // ---- Post-Save Edit Confirmation Modal State ----
  const [showPostSaveModal, setShowPostSaveModal] = useState(false);
  const [savedFeatureDetails, setSavedFeatureDetails] = useState(null);

  const handleContinueEditing = useCallback(() => {
    setShowPostSaveModal(false);
    // Keep Edit Mode ON and allow user to continue editing
  }, []);

  const handleFinishEditing = useCallback(() => {
    setShowPostSaveModal(false);
    setEditMode(false);
    setSelectedFeature(null);
    setEditSubMode(null);
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  // ---- Task Grid Outline State ----
  const [outlinedTaskIds, setOutlinedTaskIds] = useState(new Set());
  const [outlineAllTasks, setOutlineAllTasks] = useState(isCollector);

  // By default all grids should be outlined for Data Collectors
  useEffect(() => {
    if (isCollector) {
      setOutlineAllTasks(true);
    }
  }, [isCollector]);

  const handleToggleTaskOutline = useCallback((taskId) => {
    setOutlinedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const handleToggleAllTasksOutline = useCallback((allTaskIds = []) => {
    setOutlineAllTasks((prev) => {
      const nextState = !prev;
      if (!nextState) {
        setOutlinedTaskIds(new Set());
      } else {
        setOutlinedTaskIds(new Set(allTaskIds));
      }
      return nextState;
    });
  }, []);

  // ---- Vector Layer Outline Toggle Handler ----
  const handleVectorOutlineToggle = useCallback((layerId) => {
    setServerVectors((prev) =>
      prev.map((v) =>
        v.id === layerId ? { ...v, outlineOnly: !v.outlineOnly } : v
      )
    );
  }, []);

  // ---- Undo / Redo History State for Edit Mode ----
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [geometryUpdateTrigger, setGeometryUpdateTrigger] = useState(null);

  // ---- Undo / Redo History State for Drawing Mode ----
  const [drawUndoCount, setDrawUndoCount] = useState(0);
  const [drawRedoCount, setDrawRedoCount] = useState(0);
  const [drawUndoTrigger, setDrawUndoTrigger] = useState(null);
  const [drawRedoTrigger, setDrawRedoTrigger] = useState(null);

  const handleDrawUndo = useCallback(() => {
    setDrawUndoTrigger({ timestamp: Date.now() });
  }, []);

  const handleDrawRedo = useCallback(() => {
    setDrawRedoTrigger({ timestamp: Date.now() });
  }, []);

  const handleDrawVertexChange = useCallback(({ undoCount, redoCount }) => {
    setDrawUndoCount(undoCount || 0);
    setDrawRedoCount(redoCount || 0);
  }, []);

  // ---- Vertex Snapping State ----
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [snapTolerance, setSnapTolerance] = useState(15); // tolerance in pixels

  // ---- Auth redirect ----
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  // ---- Online/Offline detection ----
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);
    setupOnlineSync(api);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ---- Load initial projects and global layers ----
  // ---- Load project-scoped or global layers ----
  const loadAllLayers = useCallback(async (project = null) => {
    try {
      let vLayers = [];
      let rTiles = [];

      if (isAdmin) {
        // GIS Admin displays all layers of any projects and all global layers
        const [allLayersRes, allTilesRes] = await Promise.allSettled([
          layersAPI.listAll(),
          tilesAPI.listAll(),
        ]);
        vLayers = allLayersRes.status === 'fulfilled' ? allLayersRes.value.data : [];
        rTiles = allTilesRes.status === 'fulfilled' ? allTilesRes.value.data : [];
      } else if (project && project.id) {
        // Load layers and tiles assigned or specific to this active project
        const [projLayersRes, projTilesRes] = await Promise.allSettled([
          layersAPI.listProject(project.id),
          tilesAPI.listProject(project.id),
        ]);
        vLayers = projLayersRes.status === 'fulfilled' ? projLayersRes.value.data : [];
        rTiles = projTilesRes.status === 'fulfilled' ? projTilesRes.value.data : [];
      } else if (!isCollector) {
        // Non-admin without project: load global catalog
        const [globalLayersRes, globalTilesRes] = await Promise.allSettled([
          layersAPI.listGlobal(),
          tilesAPI.listGlobal(),
        ]);
        vLayers = globalLayersRes.status === 'fulfilled' ? globalLayersRes.value.data : [];
        rTiles = globalTilesRes.status === 'fulfilled' ? globalTilesRes.value.data : [];
      } else {
        // DataCollector with no project selected: no layers
        vLayers = [];
        rTiles = [];
      }

      // Preserve existing visibility and feature data where applicable
      setServerVectors((prev) => {
        const prevMap = new Map(prev.map((l) => [l.id, l]));
        return vLayers.map((l) => {
          const existing = prevMap.get(l.id);
          return {
            ...l,
            visible: existing?.visible || false,
            opacity: existing?.opacity ?? 100,
            features: existing?.features || null,
            viewEdits: existing?.viewEdits ?? false,
            editCollectorId: existing?.editCollectorId ?? 'all',
            selectedCollectors: existing?.selectedCollectors ?? (isAdmin ? ['all'] : ['my_edits']),
          };
        });
      });

      if (vLayers.length > 0) {
        setActiveLayerId((currentActive) => {
          if (currentActive && vLayers.some((l) => l.id === currentActive)) {
            return currentActive;
          }
          return vLayers[0].id;
        });
      } else {
        setActiveLayerId(null);
      }

      setServerRasters((prev) => {
        const prevMap = new Map(prev.map((r) => [r.id, r]));
        return rTiles.map((t) => {
          const existing = prevMap.get(t.id);
          return {
            ...t,
            visible: existing?.visible || false,
            opacity: existing?.opacity ?? 100,
          };
        });
      });
    } catch (err) {
      console.error('Failed to load layers:', err);
    }
  }, [isAdmin, isCollector]);

  // Helper to discover all field names from a vector layer
  const getLayerFields = useCallback((layerId) => {
    if (!layerId) return ['_id'];
    const layer = serverVectors.find((l) => l.id === Number(layerId));
    const features = layer?.features?.features || (Array.isArray(layer?.features) ? layer.features : []);
    const fieldsSet = new Set(['_id']);

    if (layer?.form_schema?.fields) {
      layer.form_schema.fields.forEach((f) => {
        if (f.name) fieldsSet.add(f.name);
      });
    }

    features.slice(0, 50).forEach((f) => {
      const props = f.properties || {};
      Object.keys(props).forEach((k) => {
        if (!['geom', 'the_geom', 'geometry_type'].includes(k)) {
          fieldsSet.add(k);
        }
      });
    });

    return Array.from(fieldsSet);
  }, [serverVectors]);

  const targetLayerFields = useMemo(() => getLayerFields(activeLayerId), [activeLayerId, getLayerFields]);
  const refLayerFields = useMemo(() => (refLayerId !== 'auto' ? getLayerFields(refLayerId) : []), [refLayerId, getLayerFields]);

  // Auto-select preferred linking field when activeLayerId changes
  useEffect(() => {
    if (activeLayerId) {
      const fields = getLayerFields(activeLayerId);
      const preferred = fields.find((f) => ['id', 'code', 'building_id', 'parcel_id', 'ward_no', 'fid', 'house_no'].includes(f.toLowerCase())) || '_id';
      setActiveLayerLinkingIdField(preferred);
    }
  }, [activeLayerId, getLayerFields]);

  // Auto-select preferred linking field when refLayerId changes
  useEffect(() => {
    if (refLayerId && refLayerId !== 'auto') {
      const fields = getLayerFields(refLayerId);
      const preferred = fields.find((f) => ['id', 'code', 'building_id', 'parcel_id', 'ward_no', 'fid', 'house_no'].includes(f.toLowerCase())) || '_id';
      setRefLayerLinkingIdField(preferred);
    }
  }, [refLayerId, getLayerFields]);

  // Load projects on startup
  useEffect(() => {
    if (!isAuthenticated) return;
    projectsAPI.list().then((res) => {
      const projList = res.data || [];
      setProjects(projList);
      if (isCollector && projList.length > 0) {
        // Automatically select the active project for DataCollector so they start with their linked layers
        const defaultProj = projList.find((p) => p.status === 'ACTIVE') || projList[0];
        setActiveProject(defaultProj);
      }
    }).catch(console.error);

    if (!isCollector) {
      loadAllLayers(null);
    }
  }, [isAuthenticated, isCollector, loadAllLayers]);

  // ---- Load project-specific data when activeProject changes ----
  useEffect(() => {
    if (!activeProject) {
      setTaskGrids(null);
      setSelectedTask(null);
      setShowTaskPanel(false);
      if (isCollector) {
        setServerVectors([]);
        setServerRasters([]);
      } else {
        loadAllLayers(null);
      }
      return;
    }

    // Load tasks
    tasksAPI.list(activeProject.id)
      .then((res) => setTaskGrids(res.data))
      .catch(console.error);

    loadAllLayers(activeProject);
  }, [activeProject, isCollector, loadAllLayers]);

  // ---- Layer Toggle & Opacity Handlers ----
  const handleRasterToggle = useCallback((id) => {
    setServerRasters((prev) =>
      prev.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r))
    );
  }, []);

  const handleRasterOpacityChange = useCallback((id, opacity) => {
    setServerRasters((prev) =>
      prev.map((r) => (r.id === id ? { ...r, opacity } : r))
    );
  }, []);

  const handleVectorToggle = useCallback(async (id) => {
    setServerVectors((prev) =>
      prev.map((v) => {
        if (v.id === id) {
          const nextVis = !v.visible;
          if (nextVis && !v.features) {
            // Mark as loading, then fetch features
            featuresAPI.list(id)
              .then((res) => {
                // Normalize: res.data could be the FeatureCollection directly,
                // or it could have features nested inside
                let featureData = res.data;

                // If the response is not a valid FeatureCollection, try to wrap it
                if (featureData && !featureData.type && Array.isArray(featureData)) {
                  featureData = { type: 'FeatureCollection', features: featureData };
                }

                setServerVectors((current) =>
                  current.map((item) =>
                    item.id === id ? { ...item, features: featureData } : item
                  )
                );
              })
              .catch((err) => {
                console.error(`[Dashboard] Failed to load features for layer ${id}:`, err);
                // Reset visible so user can retry
                setServerVectors((current) =>
                  current.map((item) =>
                    item.id === id ? { ...item, visible: false } : item
                  )
                );
              });
          }
          return { ...v, visible: nextVis };
        }
        return v;
      })
    );
  }, []);

  const handleVectorOpacityChange = useCallback((id, opacity) => {
    setServerVectors((prev) =>
      prev.map((v) => (v.id === id ? { ...v, opacity } : v))
    );
  }, []);

  // ---- Zoom to Layer Handlers ----
  const handleZoomToVector = useCallback(async (layer) => {
    if (!layer.visible) {
      handleVectorToggle(layer.id);
    }
    if (!layer.features) {
      try {
        const res = await featuresAPI.list(layer.id);
        setServerVectors((prev) =>
          prev.map((v) => (v.id === layer.id ? { ...v, features: res.data, visible: true } : v))
        );
      } catch (err) {
        console.error('Failed to fetch features for zoom:', err);
      }
    }
    setZoomTarget({ type: 'vector', id: layer.id, timestamp: Date.now() });
  }, [handleVectorToggle]);

  // ---- Admin Toggle Vector Layer Snapping Permission ----
  const handleToggleLayerSnapping = useCallback(async (layerId, newStatus) => {
    try {
      await layersAPI.update(layerId, { allow_snapping: newStatus });
      setServerVectors((prev) =>
        prev.map((l) => (l.id === layerId ? { ...l, allow_snapping: newStatus } : l))
      );
    } catch (err) {
      console.error('[Dashboard] Error toggling layer snapping:', err);
      alert(err.response?.data?.detail || 'स्न्यापिङ स्थिति परिवर्तन गर्न सकिएन');
    }
  }, []);

  // Snapping allowed flags for active layer
  const activeDrawLayer = serverVectors.find((v) => v.id === activeLayerId);
  const isDrawLayerSnappingAllowed = !activeDrawLayer || activeDrawLayer.allow_snapping !== false;

  const activeEditLayer = serverVectors.find((v) => v.id === editLayerId);
  const isEditLayerSnappingAllowed = !activeEditLayer || activeEditLayer.allow_snapping !== false;

  // ---- Zoom to Collector Handler ----
  const handleZoomToCollector = useCallback((col) => {
    if (col && col.latitude && col.longitude) {
      setZoomTarget({
        type: 'collector',
        lat: col.latitude,
        lng: col.longitude,
        timestamp: Date.now(),
      });
    }
  }, []);

  // ---- Compulsory Location Streaming & Presence for Data Collectors ----
  useEffect(() => {
    if (!isAuthenticated || !isCollector) return;

    const getIsActive = () => typeof document !== 'undefined' && document.visibilityState === 'visible';

    const sendLocationPing = async () => {
      const active = getIsActive();
      try {
        if (gpsPosition && gpsPosition.lat && gpsPosition.lng) {
          await trackingAPI.ping({
            latitude: gpsPosition.lat,
            longitude: gpsPosition.lng,
            accuracy: gpsPosition.accuracy || null,
            altitude: gpsPosition.altitude || null,
            heading: gpsPosition.heading || null,
            speed: gpsPosition.speed || null,
            battery_level: null,
            app_state: active ? 'active' : 'inactive',
          });
        } else {
          // If GPS not yet acquired, still report active presence status
          await trackingAPI.setStatus({
            is_online: active,
            app_state: active ? 'active' : 'inactive',
          });
        }
      } catch (e) {
        // Silently handle intermittent network
      }
    };

    // 1. Send initial ping on mount
    sendLocationPing();

    // 2. Regular heartbeat every 10 seconds while tab is active
    const interval = setInterval(() => {
      if (getIsActive()) {
        sendLocationPing();
      }
    }, 10000);

    // 3. Browser minimize / window focus change handler
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      if (isVisible) {
        // Unminimized / focused -> immediately active
        trackingAPI.setStatus({
          is_online: true,
          app_state: 'active',
          latitude: gpsPosition?.lat || null,
          longitude: gpsPosition?.lng || null,
        }).catch(() => {});
        sendLocationPing();
      } else {
        // Minimized / hidden -> immediately inactive
        trackingAPI.sendBeaconStatus({
          is_online: false,
          app_state: 'inactive',
          latitude: gpsPosition?.lat || null,
          longitude: gpsPosition?.lng || null,
        });
      }
    };

    // 4. Browser close / tab close handler
    const handleUnload = () => {
      trackingAPI.sendBeaconStatus({
        is_online: false,
        app_state: 'inactive',
        latitude: gpsPosition?.lat || null,
        longitude: gpsPosition?.lng || null,
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [isAuthenticated, isCollector, gpsPosition]);

  // ---- Live Collector Fleet Tracking Polling (All Users: Admin, Validator, DataCollector) ----
  const loadCollectorLocations = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await trackingAPI.getCollectors(activeProject?.id);
      setCollectorLocations(res.data || []);
    } catch (err) {
      console.error('[Dashboard] Error loading collector locations:', err);
    }
  }, [isAuthenticated, activeProject?.id]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadCollectorLocations();
    const interval = setInterval(loadCollectorLocations, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, loadCollectorLocations]);

  const handleZoomToRaster = useCallback((raster) => {
    if (!raster.visible) {
      handleRasterToggle(raster.id);
    }
    setZoomTarget({
      type: 'raster',
      id: raster.id,
      bounds: raster.bounds,
      timestamp: Date.now(),
    });
  }, [handleRasterToggle]);

  // ---- Select Project ----
  const handleProjectSelect = useCallback((project) => {
    setActiveProject(project);
    setSelectedTask(null);
    setShowTaskPanel(false);
  }, []);

  // ---- Task Lifecycle Actions ----
  const handleTaskAction = useCallback(async (taskId, action) => {
    setActionLoading(true);
    try {
      const gpsData = gpsPosition
        ? { collector_lat: gpsPosition.lat, collector_lng: gpsPosition.lng }
        : {};

      switch (action) {
        case 'lock':
          await tasksAPI.lock(taskId, gpsData);
          break;
        case 'unlock':
          await tasksAPI.unlock(taskId);
          break;
        case 'submit':
          await tasksAPI.submit(taskId);
          break;
        case 'validate':
          await tasksAPI.validate(taskId, 'validate');
          break;
        case 'invalidate':
          await tasksAPI.validate(taskId, 'invalidate');
          break;
      }

      if (activeProject) {
        const res = await tasksAPI.list(activeProject.id);
        setTaskGrids(res.data);
      }
    } catch (err) {
      alert(err.response?.data?.detail || `कार्य असफल भयो: ${err.message}`);
    }
    setActionLoading(false);
  }, [gpsPosition, activeProject]);

  // ---- Feature creation from map drawing ----
  const handleFeatureCreate = useCallback(async (geometry, linkedInfo = null) => {
    if (drawingTaskBoundary) {
      setDrawnTaskBoundary(geometry);
      setDrawingTaskBoundary(false);
      setDrawMode(null);
      setShowTaskPanel(true);
      return;
    }

    if (!activeLayerId) {
      alert('कृपया पहिले बाँया-तल रहेको सूचीबाट सक्रिय भेक्टर तह (Target Vector Layer) छान्नुहोस्');
      return;
    }

    const targetLayer = serverVectors.find((l) => l.id === activeLayerId);
    let layerFields = Array.isArray(targetLayer?.fields_config) && targetLayer.fields_config.length > 0
      ? targetLayer.fields_config
      : [];

    // If layer fields_config is not cached or empty, fetch from API
    if (layerFields.length === 0) {
      try {
        const res = await layersAPI.getFields(activeLayerId);
        if (res.data?.fields && res.data.fields.length > 0) {
          layerFields = res.data.fields;
          setServerVectors((prev) =>
            prev.map((l) => (l.id === activeLayerId ? { ...l, fields_config: layerFields } : l))
          );
        }
      } catch (err) {
        console.warn('Failed to fetch layer fields schema:', err);
      }
    }

    // Fallback: detect keys from existing features in memory if still empty
    if (layerFields.length === 0) {
      const feats = targetLayer?.features?.features || (Array.isArray(targetLayer?.features) ? targetLayer.features : []);
      const keysSet = new Set();
      feats.slice(0, 50).forEach((f) => {
        const props = f.properties || {};
        Object.keys(props).forEach((k) => {
          if (!['geom', 'the_geom', 'geometry_type', '_version', '_created_by', '_updated_by', 'target_id', '_target_feature_id'].includes(k)) {
            keysSet.add(k);
          }
        });
      });
      layerFields = Array.from(keysSet).map((k) => ({
        name: k,
        label: k,
        type: 'text',
        required: false,
      }));
    }

    // Construct the vector layer's dynamic schema
    const dynamicSchema = {
      fields: layerFields.map((f) => ({
        name: f.name,
        label: f.label || f.name,
        type: f.type || 'text',
        required: Boolean(f.required),
        options: f.options || [],
        placeholder: f.placeholder || '',
      })),
    };

    // Initialize all field values strictly empty (""), with NO unrelated fields
    let initialAttrs = {};
    dynamicSchema.fields.forEach((f) => {
      initialAttrs[f.name] = '';
    });

    // ONLY populate linking attributes if the user explicitly enabled Linking Feature
    if (enableLayerLinking) {
      // 1. If user explicitly selected a feature from map canvas to link
      if (selectedLinkedFeature) {
        const chosenField = (refLayerId !== 'auto' && refLayerLinkingIdField)
          ? refLayerLinkingIdField
          : (activeLayerLinkingIdField || '_id');

        let val = null;
        if (chosenField === '_id' || chosenField === 'id') {
          val = selectedLinkedFeature.featureId || selectedLinkedFeature.properties?._id || selectedLinkedFeature.properties?.id;
        } else {
          val = selectedLinkedFeature.properties?.[chosenField] ?? (selectedLinkedFeature.featureId || selectedLinkedFeature.properties?._id);
        }

        if (val !== null && val !== undefined && String(val).trim() !== '') {
          const strVal = String(val).trim();
          const typedVal = (typeof val === 'number' || (/^\d+$/.test(strVal) && !strVal.startsWith('0'))) ? Number(val) : strVal;

          if (chosenField !== '_id' && chosenField !== 'id') {
            initialAttrs[chosenField] = typedVal;
          } else {
            initialAttrs['target_id'] = typedVal;
          }

          if (selectedLinkedFeature.featureId) {
            initialAttrs['_target_feature_id'] = selectedLinkedFeature.featureId;
          }

          const targetLinkedLayer = serverVectors.find((l) => l.id === selectedLinkedFeature.layerId);
          if (targetLinkedLayer) {
            const cleanName = targetLinkedLayer.name.replace(/[^\p{L}\p{N}_]/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
            initialAttrs[`${cleanName || 'target'}_linked_id`] = typedVal;
          }
        }
      }
      // 2. Else if Reference Layer Linking toggle is ON, check snapped/intersected linkedInfo
      else if (linkedInfo) {
        const chosenField = (refLayerId !== 'auto' && refLayerLinkingIdField)
          ? refLayerLinkingIdField
          : (activeLayerLinkingIdField || '_id');

        let val = null;
        if (chosenField === '_id' || chosenField === 'id') {
          val = linkedInfo.featureId || linkedInfo.properties?._id || linkedInfo.properties?.id;
        } else {
          val = linkedInfo.properties?.[chosenField] ?? (linkedInfo.featureId || linkedInfo.properties?._id);
        }

        if (val !== null && val !== undefined && String(val).trim() !== '') {
          const strVal = String(val).trim();
          const typedVal = (typeof val === 'number' || (/^\d+$/.test(strVal) && !strVal.startsWith('0'))) ? Number(val) : strVal;

          if (chosenField !== '_id' && chosenField !== 'id') {
            initialAttrs[chosenField] = typedVal;
          } else {
            initialAttrs['target_id'] = typedVal;
          }

          if (linkedInfo.featureId) {
            initialAttrs['_target_feature_id'] = linkedInfo.featureId;
          }

          const targetLinkedLayer = serverVectors.find((l) => l.id === linkedInfo.layerId);
          if (targetLinkedLayer) {
            const cleanName = targetLinkedLayer.name.replace(/[^\p{L}\p{N}_]/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
            initialAttrs[`${cleanName || 'target'}_linked_id`] = typedVal;
          }
        }
      }
    }

    setEditingGeometry(geometry);
    setActiveLayerFormSchema(dynamicSchema);
    setInitialFormAttributes(initialAttrs);
    setShowForm(true);
  }, [drawingTaskBoundary, activeLayerId, selectedLinkedFeature, enableLayerLinking, refLayerId, refLayerLinkingIdField, activeLayerLinkingIdField, serverVectors]);

  // Reset pick mode, selected linked feature, and linking toggle if drawing mode changes or exits
  useEffect(() => {
    setPickFeatureMode(false);
    setSelectedLinkedFeature(null);
    setEnableLayerLinking(false);
  }, [drawMode]);

  // ---- Form submit ----
  const handleFormSubmit = useCallback(async (attributes) => {
    if (!editingGeometry || !activeLayerId) return;

    setFormSaving(true);
    try {
      const finalAttrs = { ...(attributes || {}) };
      if (isCollector && user?.username) {
        finalAttrs['Kmc_Editor'] = user.username;
      }
      const createRes = await featuresAPI.create({
        layer_id: activeLayerId,
        geom_geojson: editingGeometry,
        properties: finalAttrs,
        collector_lat: gpsPosition?.lat,
        collector_lng: gpsPosition?.lng,
      });

      const newFeature = createRes.data;

      // Optimistically append the newly created feature into serverVectors right away
      if (newFeature) {
        setServerVectors((prev) =>
          prev.map((v) => {
            if (v.id === activeLayerId) {
              const existingFeatures = v.features?.features
                ? [...v.features.features]
                : Array.isArray(v.features)
                ? [...v.features]
                : [];
              return {
                ...v,
                features: {
                  type: 'FeatureCollection',
                  features: [...existingFeatures, newFeature],
                },
              };
            }
            return v;
          })
        );
      }

      // Close form and reset feature capture states immediately without delay
      setShowForm(false);
      setEditingGeometry(null);
      setInitialFormAttributes({});
      setActiveLayerFormSchema(null);
      setSelectedLinkedFeature(null);
      setPickFeatureMode(false);
      setEnableLayerLinking(false);
      setDrawMode(null);

      // Refresh authoritative layer GeoJSON in background without blocking UI
      const linkedLayerId = selectedLinkedFeature?.layerId;
      (async () => {
        try {
          const res = await featuresAPI.list(activeLayerId);
          let featureData = res.data;
          if (Array.isArray(featureData)) {
            featureData = { type: 'FeatureCollection', features: featureData };
          }

          let linkedLayerData = null;
          if (linkedLayerId && linkedLayerId !== activeLayerId) {
            try {
              const lRes = await featuresAPI.list(linkedLayerId);
              linkedLayerData = Array.isArray(lRes.data)
                ? { type: 'FeatureCollection', features: lRes.data }
                : lRes.data;
            } catch (e) {
              console.warn('Failed to refresh linked layer in background:', e);
            }
          }

          setServerVectors((prev) =>
            prev.map((v) => {
              if (v.id === activeLayerId) return { ...v, features: featureData };
              if (linkedLayerData && v.id === linkedLayerId) return { ...v, features: linkedLayerData };
              return v;
            })
          );
        } catch (syncErr) {
          console.warn('Background sync after feature creation:', syncErr);
        }
      })();
    } catch (err) {
      alert(err.response?.data?.detail || 'तथ्याङ्क सुरक्षित गर्न सकिएन');
    } finally {
      setFormSaving(false);
    }
  }, [editingGeometry, activeLayerId, gpsPosition, selectedLinkedFeature, isCollector, user]);

  // ---- Spatial Grid Boundary & Geofence Alert State ----
  const [gridAlert, setGridAlert] = useState(null);
  const gridAlertTimeoutRef = useRef(null);

  const handleFeatureBlocked = useCallback(({ reason, message }) => {
    if (gridAlertTimeoutRef.current) {
      clearTimeout(gridAlertTimeoutRef.current);
    }
    setGridAlert(message);
    gridAlertTimeoutRef.current = setTimeout(() => {
      setGridAlert(null);
    }, 4500);
  }, []);

  // ---- Edit Mode Toggle ----
  const toggleEditMode = useCallback((targetLayerId = null) => {
    setInspectedFeature(null);
    setEditMode((prev) => {
      const nextMode = !prev;
      if (nextMode) {
        if (isCollector && (!gpsPosition || gpsPosition.lat == null || gpsPosition.lng == null)) {
          handleFeatureBlocked({
            reason: 'NO_GPS',
            message: '⚠️ GPS स्थान प्राप्त हुन सकेन। सम्पादन मोड प्रयोग गर्न आफ्नो GPS सक्रिय गर्नुहोस्। (GPS position required to use Edit Mode.)',
          });
          return false;
        }
        setDrawMode(null);
        setEditToolsCollapsed(false);
        setEditSubMode(null);
        const visibleLayers = serverVectors.filter((v) => v.visible !== false);
        const target =
          targetLayerId ||
          (editLayerId && visibleLayers.some((l) => String(l.id) === String(editLayerId)) ? editLayerId : null) ||
          activeLayerId ||
          (visibleLayers[0]?.id || serverVectors[0]?.id || null);
        setEditLayerId(target);
        setUndoStack([]);
        setRedoStack([]);
        if (target) {
          // Ensure target layer is visible & loaded
          setServerVectors((current) =>
            current.map((v) => {
              if (v.id === target) {
                if (!v.features) {
                  featuresAPI.list(target).then((res) => {
                    let featureData = res.data;
                    if (featureData && !featureData.type && Array.isArray(featureData)) {
                      featureData = { type: 'FeatureCollection', features: featureData };
                    }
                    setServerVectors((cur) =>
                      cur.map((item) => (item.id === target ? { ...item, features: featureData } : item))
                    );
                  });
                }
                return { ...v, visible: true };
              }
              return v;
            })
          );
        }
      } else {
        setSelectedFeature(null);
        setEditSubMode(null);
        setUndoStack([]);
        setRedoStack([]);
      }
      return nextMode;
    });
  }, [editLayerId, activeLayerId, serverVectors, isCollector, gpsPosition, handleFeatureBlocked]);

  // ---- Feature Inspection Handlers (Non-Edit Mode) ----
  const handleFeatureInspect = useCallback((feat) => {
    if (editMode || drawMode) return;
    setInspectedFeature(feat);
  }, [editMode, drawMode]);

  const handleEditInspectedFeature = useCallback((layerId, featureId) => {
    if (isCollector) {
      if (!gpsPosition || gpsPosition.lat == null || gpsPosition.lng == null) {
        handleFeatureBlocked({
          reason: 'NO_GPS',
          message: '⚠️ GPS स्थान प्राप्त हुन सकेन। सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ। (GPS position required. Must be within 50m to edit.)',
        });
        return;
      }
      const geom = inspectedFeature?.geometry;
      if (geom) {
        const dist = getDistanceToGeoJsonGeometry(gpsPosition.lat, gpsPosition.lng, geom);
        if (dist > GEOFENCE_EDIT_RADIUS_METERS) {
          handleFeatureBlocked({
            reason: 'OUTSIDE_GPS_50M',
            message: `⚠️ तपाईं यो फिचरबाट ${Math.round(dist)} मिटर टाढा हुनुहुन्छ। सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ। सम्पादन मोड खोलिएन। (You are ${Math.round(dist)}m away from this feature. You must be within 50m to edit.)`,
          });
          return;
        }
      }
    }
    const currentInspected = inspectedFeature;
    // Set editLayerId BEFORE editMode to prevent the auto-sync useEffect
    // from seeing a stale editLayerId and clearing selectedFeature.
    setEditLayerId(layerId);
    setInspectedFeature(null);
    setEditSubMode(null);
    setUndoStack([]);
    setRedoStack([]);
    if (currentInspected) {
      setSelectedFeature({
        id: currentInspected.id || featureId,
        layerId: layerId,
        layerName: currentInspected.layerName,
        geometryType: currentInspected.geometryType,
        properties: currentInspected.properties || {},
        originalGeom: currentInspected.geometry,
        currentGeom: currentInspected.geometry,
        isModified: false,
        isWithinAssignedGrid: true,
      });
    }
    // Set editMode LAST so the auto-sync useEffect sees the correct editLayerId
    setEditMode(true);
  }, [isCollector, gpsPosition, inspectedFeature, handleFeatureBlocked]);

  const handleZoomToInspectedFeature = useCallback((geometry, extent) => {
    if (extent && Array.isArray(extent)) {
      setZoomTarget({ type: 'extent', bounds: extent, timestamp: Date.now() });
      return;
    }
    if (geometry && geometry.coordinates) {
      const coords = [];
      const extractCoords = (c) => {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === 'number') coords.push(c);
        else c.forEach(extractCoords);
      };
      extractCoords(geometry.coordinates);
      if (coords.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        coords.forEach(([lng, lat]) => {
          if (typeof lng !== 'number' || typeof lat !== 'number') return;
          const x = (lng * 20037508.34) / 180;
          const clampedLat = Math.max(-89.9, Math.min(89.9, lat));
          let y = Math.log(Math.tan(((90 + clampedLat) * Math.PI) / 360)) / (Math.PI / 180);
          y = (y * 20037508.34) / 180;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        });
        if (minX !== Infinity && isFinite(minX)) {
          if (minX === maxX && minY === maxY) {
            minX -= 50;
            maxX += 50;
            minY -= 50;
            maxY += 50;
          }
          setZoomTarget({ type: 'extent', bounds: [minX, minY, maxX, maxY], timestamp: Date.now() });
        }
      }
    }
  }, []);

  const handleToggleViewEdits = useCallback((layerId) => {
    setServerVectors((prev) =>
      prev.map((v) => (v.id === layerId ? { ...v, viewEdits: !v.viewEdits } : v))
    );
  }, []);

  const handleToggleMyEdits = useCallback((layerId) => {
    setServerVectors((prev) =>
      prev.map((v) => {
        if (v.id !== layerId) return v;
        const isMyEditsActive = v.viewEdits && Array.isArray(v.selectedCollectors) && v.selectedCollectors.length === 1 && v.selectedCollectors[0] === 'my_edits';
        if (isMyEditsActive) {
          return { ...v, viewEdits: false };
        } else {
          return { ...v, viewEdits: true, selectedCollectors: ['my_edits'], editCollectorId: 'my_edits' };
        }
      })
    );
  }, []);

  const handleToggleCollectorInLayer = useCallback((layerId, collectorKey) => {
    setServerVectors((prev) =>
      prev.map((v) => {
        if (v.id !== layerId) return v;
        const current = Array.isArray(v.selectedCollectors) ? v.selectedCollectors : ['all'];
        let updated;
        if (current.includes('all')) {
          updated = [collectorKey];
        } else if (current.includes(collectorKey)) {
          updated = current.filter((k) => k !== collectorKey);
        } else {
          updated = [...current.filter((k) => k !== 'my_edits'), collectorKey];
        }
        return {
          ...v,
          selectedCollectors: updated,
          editCollectorId: updated[0] || 'all',
          viewEdits: true,
        };
      })
    );
  }, []);

  const handleSetLayerCollectors = useCallback((layerId, collectorKeys) => {
    setServerVectors((prev) =>
      prev.map((v) => {
        if (v.id !== layerId) return v;
        return {
          ...v,
          selectedCollectors: collectorKeys,
          editCollectorId: collectorKeys[0] || 'all',
          viewEdits: true,
        };
      })
    );
  }, []);

  const handleChangeEditCollector = useCallback((layerId, collectorId) => {
    setServerVectors((prev) =>
      prev.map((v) => (v.id === layerId ? { ...v, editCollectorId: collectorId, selectedCollectors: [collectorId] } : v))
    );
  }, []);

  const handleZoomToLayerEditFeature = useCallback((geometry, extent, rawFeature) => {
    handleZoomToInspectedFeature(geometry, extent);
    if (rawFeature && layerEditsModalTarget) {
      setInspectedFeature({
        id: rawFeature.id || rawFeature.properties?._id,
        layerId: layerEditsModalTarget.id,
        layerName: layerEditsModalTarget.name || 'तह',
        geometryType: rawFeature.geometry?.type,
        properties: rawFeature.properties || {},
        geometry: rawFeature.geometry,
        extent: extent,
        isWithinAssignedGrid: true,
      });
    }
  }, [handleZoomToInspectedFeature, layerEditsModalTarget]);

  const activeModalLayer = useMemo(() => {
    if (!layerEditsModalTarget) return null;
    return serverVectors.find((l) => l.id === layerEditsModalTarget.id) || layerEditsModalTarget;
  }, [layerEditsModalTarget, serverVectors]);

  // ---- Vector Layer Feature Linking Modal State & Handlers ----
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkModalSourceLayerId, setLinkModalSourceLayerId] = useState(null);

  const handleOpenLinkModal = useCallback((sourceLayer = null) => {
    setLinkModalSourceLayerId(sourceLayer?.id || null);
    setShowLinkModal(true);
  }, []);

  const handleLayerLinkedSuccess = useCallback(async ({ sourceLayerId, targetLayerId, fieldName, linkedCount }) => {
    try {
      // Refresh features for source layer
      const res = await featuresAPI.list(sourceLayerId);
      let featureData = res.data;
      if (featureData && !featureData.type && Array.isArray(featureData)) {
        featureData = { type: 'FeatureCollection', features: featureData };
      }
      setServerVectors((prev) =>
        prev.map((v) => (v.id === sourceLayerId ? { ...v, features: featureData, visible: true } : v))
      );

      // If inspected feature is from source layer, update its properties
      if (inspectedFeature && inspectedFeature.layerId === sourceLayerId) {
        const updatedFeat = featureData?.features?.find((f) => (f.id || f.properties?._id) === inspectedFeature.id);
        if (updatedFeat) {
          setInspectedFeature((prev) => ({
            ...prev,
            properties: updatedFeat.properties || {},
          }));
        }
      }
    } catch (err) {
      console.error('Failed to reload linked layer features:', err);
    }
  }, [inspectedFeature]);

  const handleInspectLinkedFeature = useCallback(async (linkedItem) => {
    if (!linkedItem) return;
    const targetLayerId = linkedItem.layer_id;
    const targetFeatureId = linkedItem.feature_id;

    if (targetLayerId) {
      let targetFeaturesCollection = null;
      const targetLayer = serverVectors.find((v) => v.id === targetLayerId);
      if (targetLayer && targetLayer.features) {
        targetFeaturesCollection = targetLayer.features;
      } else {
        try {
          const res = await featuresAPI.list(targetLayerId);
          targetFeaturesCollection = res.data?.features ? res.data : { type: 'FeatureCollection', features: res.data || [] };
          setServerVectors((prev) =>
            prev.map((v) => (v.id === targetLayerId ? { ...v, features: targetFeaturesCollection, visible: true } : v))
          );
        } catch (err) {
          console.error('Failed to load target layer for linked inspection:', err);
        }
      }

      setServerVectors((prev) =>
        prev.map((v) => (v.id === targetLayerId ? { ...v, visible: true } : v))
      );

      let targetGeom = linkedItem.geom_geojson;
      if (!targetGeom && targetFeaturesCollection && targetFeaturesCollection.features) {
        const found = targetFeaturesCollection.features.find((f) => (f.id || f.properties?._id) === targetFeatureId);
        if (found) targetGeom = found.geometry;
      }

      if (targetGeom) {
        setZoomTarget({ type: 'geometry', geometry: targetGeom, timestamp: Date.now() });
      }

      if (targetFeaturesCollection && targetFeaturesCollection.features) {
        const found = targetFeaturesCollection.features.find((f) => (f.id || f.properties?._id) === targetFeatureId);
        if (found) {
          setInspectedFeature({
            id: found.id || found.properties?._id,
            layerId: targetLayerId,
            layerName: linkedItem.layer_name || targetLayer?.name || 'Target Layer',
            geometryType: found.geometry?.type,
            properties: found.properties || {},
            geometry: found.geometry,
          });
          return;
        }
      }
    }

    if (linkedItem.geom_geojson) {
      setZoomTarget({ type: 'geometry', geometry: linkedItem.geom_geojson, timestamp: Date.now() });
    }
  }, [serverVectors]);

  // Auto-sync editLayerId to only visible vector layers
  // Uses String() comparison to avoid type mismatches (string vs number IDs)
  useEffect(() => {
    if (editMode) {
      const visibleLayers = serverVectors.filter((v) => v.visible !== false);
      if (visibleLayers.length > 0) {
        const editLayerStr = editLayerId != null ? String(editLayerId) : null;
        if (!editLayerStr || !visibleLayers.some((l) => String(l.id) === editLayerStr)) {
          setEditLayerId(visibleLayers[0].id);
          setSelectedFeature(null);
          setUndoStack([]);
          setRedoStack([]);
        }
      } else if (editLayerId) {
        setEditLayerId(null);
        setSelectedFeature(null);
        setUndoStack([]);
        setRedoStack([]);
      }
    }
  }, [serverVectors, editMode, editLayerId]);

  // ---- Feature Selection & Spatial Modification Handlers ----
  const handleFeatureSelect = useCallback((feat) => {
    if (isCollector && feat) {
      const geom = feat.geometry || feat.originalGeom || feat.currentGeom;
      if (!gpsPosition || gpsPosition.lat == null || gpsPosition.lng == null) {
        handleFeatureBlocked({
          reason: 'NO_GPS',
          message: '⚠️ GPS स्थान प्राप्त हुन सकेन। सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ। (GPS position required. Must be within 50m to edit.)',
        });
        return;
      }
      if (geom) {
        const dist = getDistanceToGeoJsonGeometry(gpsPosition.lat, gpsPosition.lng, geom);
        if (dist > GEOFENCE_EDIT_RADIUS_METERS) {
          handleFeatureBlocked({
            reason: 'OUTSIDE_GPS_50M',
            message: `⚠️ तपाईं यो फिचरबाट ${Math.round(dist)} मिटर टाढा हुनुहुन्छ। सम्पादन गर्न ५० मिटर भित्र हुनुपर्छ। सम्पादन मोड खोलिएन। (You are ${Math.round(dist)}m away from this feature. You must be within 50m to edit.)`,
          });
          return;
        }
      }
    }
    setSelectedFeature(feat);
    setUndoStack([]);
    setRedoStack([]);
  }, [isCollector, gpsPosition, handleFeatureBlocked]);

  const handleFeatureModifyEnd = useCallback((featureId, newGeometry, isWithin = true) => {
    setSelectedFeature((prev) => {
      if (!prev) return null;
      const currentGeom = prev.currentGeom || prev.originalGeom;
      if (currentGeom && JSON.stringify(currentGeom) !== JSON.stringify(newGeometry)) {
        setUndoStack((u) => [...u, currentGeom]);
        setRedoStack([]); // reset redo on new edits
      }
      return {
        ...prev,
        currentGeom: newGeometry,
        isModified: true,
        isWithinAssignedGrid: isWithin,
      };
    });
  }, []);

  // ---- Undo Action (Restores previous geometry state) ----
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !selectedFeature) return;
    const prevGeom = undoStack[undoStack.length - 1];
    const newUndoStack = undoStack.slice(0, -1);
    const currentGeom = selectedFeature.currentGeom || selectedFeature.originalGeom;

    setUndoStack(newUndoStack);
    setRedoStack((r) => [...r, currentGeom]);

    const isStillModified = JSON.stringify(prevGeom) !== JSON.stringify(selectedFeature.originalGeom);

    setSelectedFeature((prev) =>
      prev
        ? {
            ...prev,
            currentGeom: prevGeom,
            isModified: isStillModified,
          }
        : null
    );

    setGeometryUpdateTrigger({
      featureId: selectedFeature.id,
      geometry: prevGeom,
      timestamp: Date.now(),
    });
  }, [undoStack, selectedFeature]);

  // ---- Redo Action (Re-applies undone geometry state) ----
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || !selectedFeature) return;
    const nextGeom = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);
    const currentGeom = selectedFeature.currentGeom || selectedFeature.originalGeom;

    setRedoStack(newRedoStack);
    setUndoStack((u) => [...u, currentGeom]);

    const isStillModified = JSON.stringify(nextGeom) !== JSON.stringify(selectedFeature.originalGeom);

    setSelectedFeature((prev) =>
      prev
        ? {
            ...prev,
            currentGeom: nextGeom,
            isModified: isStillModified,
          }
        : null
    );

    setGeometryUpdateTrigger({
      featureId: selectedFeature.id,
      geometry: nextGeom,
      timestamp: Date.now(),
    });
  }, [redoStack, selectedFeature]);

  const handleFeatureRevert = useCallback(() => {
    if (!selectedFeature) return;
    const currentGeom = selectedFeature.currentGeom || selectedFeature.originalGeom;
    if (currentGeom && JSON.stringify(currentGeom) !== JSON.stringify(selectedFeature.originalGeom)) {
      setUndoStack((u) => [...u, currentGeom]);
      setRedoStack([]);
    }
    setSelectedFeature((prev) =>
      prev ? { ...prev, currentGeom: prev.originalGeom, isModified: false } : null
    );
    setGeometryUpdateTrigger({
      featureId: selectedFeature.id,
      geometry: selectedFeature.originalGeom,
      timestamp: Date.now(),
    });
  }, [selectedFeature]);

  // ---- Remove Last Vertex from Selected Feature (Pop Last Vertex) ----
  const handleRemoveLastVertex = useCallback(() => {
    if (!selectedFeature) return;
    const currentGeom = selectedFeature.currentGeom || selectedFeature.originalGeom;
    if (!currentGeom || !currentGeom.coordinates) return;

    const geomType = currentGeom.type;
    let newCoords = JSON.parse(JSON.stringify(currentGeom.coordinates));

    if (geomType === 'LineString') {
      if (newCoords.length <= 2) return;
      newCoords.pop();
    } else if (geomType === 'Polygon') {
      if (!newCoords[0] || newCoords[0].length <= 4) return;
      newCoords[0].splice(newCoords[0].length - 2, 1);
      newCoords[0][newCoords[0].length - 1] = newCoords[0][0];
    } else {
      return;
    }

    const updatedGeom = { ...currentGeom, coordinates: newCoords };
    handleFeatureModifyEnd(selectedFeature.id, updatedGeom);
    setGeometryUpdateTrigger({
      featureId: selectedFeature.id,
      geometry: updatedGeom,
      timestamp: Date.now(),
    });
  }, [selectedFeature, handleFeatureModifyEnd]);

  // ---- Global Backspace & Keyboard Shortcuts for Undo/Redo in Edit Mode & Draw Mode ----
  useEffect(() => {
    if ((!editMode || !selectedFeature) && (!drawMode || drawUndoCount === 0)) return;

    const handleKeyDown = (e) => {
      // Do not intercept if focus is inside any text input or textarea
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        return;
      }

      // Backspace key for Undo
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (editMode && selectedFeature) {
          handleUndo();
        } else if (drawMode) {
          handleDrawUndo();
        }
        return;
      }

      // Ctrl+Z or Cmd+Z for Undo, Ctrl+Shift+Z for Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (editMode && selectedFeature) handleRedo();
          else if (drawMode) handleDrawRedo();
        } else {
          if (editMode && selectedFeature) handleUndo();
          else if (drawMode) handleDrawUndo();
        }
        return;
      }

      // Ctrl+Y or Cmd+Y for Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (editMode && selectedFeature) handleRedo();
        else if (drawMode) handleDrawRedo();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [editMode, drawMode, selectedFeature, drawUndoCount, handleUndo, handleRedo, handleDrawUndo, handleDrawRedo]);

  const handleSaveFeature = useCallback(async (payload) => {
    if (!payload || !payload.id) return;
    setFeatureSaving(true);
    try {
      const updatedProps = { ...(payload.properties || {}) };
      if (isCollector && user?.username) {
        updatedProps['Kmc_Editor'] = user.username;
      }
      const updateBody = {
        properties: updatedProps,
        geom_geojson: payload.geometry,
        collector_lat: gpsPosition?.lat || null,
        collector_lng: gpsPosition?.lng || null,
      };
      const res = await featuresAPI.update(payload.id, updateBody);

      const returnedProps = res.data?.properties || updatedProps;
      const returnedGeom = res.data?.geometry || payload.geometry;

      // Update in serverVectors state
      setServerVectors((prev) =>
        prev.map((v) => {
          if (v.id === editLayerId && v.features?.features) {
            return {
              ...v,
              features: {
                ...v.features,
                features: v.features.features.map((f) => {
                  const fid = f.id || f.properties?._id;
                  if (String(fid) === String(payload.id)) {
                    return {
                      ...f,
                      geometry: returnedGeom,
                      properties: { ...(f.properties || {}), ...returnedProps },
                    };
                  }
                  return f;
                }),
              },
            };
          }
          return v;
        })
      );

      setSelectedFeature((prev) =>
        prev
          ? {
              ...prev,
              properties: { ...(prev.properties || {}), ...returnedProps },
              originalGeom: returnedGeom,
              currentGeom: returnedGeom,
              isModified: false,
            }
          : null
      );

      // Trigger Post-Save Confirmation Popup
      setSavedFeatureDetails({
        id: payload.id,
        layerName: selectedFeature?.layerName || 'तह',
      });
      setShowPostSaveModal(true);
    } catch (err) {
      console.error('Failed to save feature:', err);
      alert(`विशेषता सुरक्षित गर्न असफल भयो: ${err.response?.data?.detail || err.message}`);
    } finally {
      setFeatureSaving(false);
    }
  }, [editLayerId, gpsPosition, isCollector, user]);

  const handleDeleteFeature = useCallback(async (featureId, layerId = null) => {
    if (!featureId) return;
    setFeatureDeleting(true);
    try {
      await featuresAPI.delete(featureId);
      // Remove from serverVectors
      setServerVectors((prev) =>
        prev.map((v) => {
          const matches = !layerId || String(v.id) === String(layerId);
          if (matches && v.features?.features) {
            return {
              ...v,
              features: {
                ...v.features,
                features: v.features.features.filter((f) => {
                  const fid = f.id || f.properties?._id;
                  return String(fid) !== String(featureId);
                }),
              },
            };
          }
          return v;
        })
      );
      setSelectedFeature(null);
      setInspectedFeature(null);
      setEditMode(false);
    } catch (err) {
      console.error('Failed to delete feature:', err);
      alert(`वस्तु मेटाउन असफल भयो: ${err.response?.data?.detail || err.message}`);
    } finally {
      setFeatureDeleting(false);
    }
  }, []);

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-gov-blue-800 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-700 text-xs font-semibold font-nepali">काठमाडौँ महानगरपालिका भू-सूचना प्रणाली...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-100 overflow-hidden font-sans pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]">
      {/* Official Nepal Government Masthead & Navigation */}
      <Navbar
        activeProject={activeProject}
        onProjectSelect={handleProjectSelect}
        projects={projects}
        onOpenLayers={() => setShowLayerControl((prev) => !prev)}
        onOpenTasks={() => setShowTaskPanel(!showTaskPanel)}
        onOpenAdmin={() => setShowAdminPanel(!showAdminPanel)}
        isOnline={isOnline}
      />

      {/* Main Map Workspace */}
      <div className="flex-1 relative overflow-hidden">
        {/* OpenLayers Map Engine */}
        <KmcMap
          gpsPosition={gpsPosition}
          taskGrids={taskGrids}
          serverVectors={serverVectors}
          serverRasters={serverRasters}
          activeBasemap={activeBasemap}
          basemapOpacity={basemapOpacity}
          zoomTarget={zoomTarget}
          selectedTask={selectedTask}
          currentUser={user}
          isAdmin={isAdmin}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowTaskPanel(true);
          }}
          onFeatureCreate={handleFeatureCreate}
          drawMode={drawMode}
          activeLayerId={activeLayerId}
          editMode={editMode}
          editLayerId={editLayerId}
          selectedFeatureId={selectedFeature?.id}
          onFeatureSelect={handleFeatureSelect}
          onFeatureModifyEnd={handleFeatureModifyEnd}
          snappingEnabled={snappingEnabled}
          snapTolerance={snapTolerance}
          onSnappingToggle={() => setSnappingEnabled((prev) => !prev)}
          geometryUpdateTrigger={geometryUpdateTrigger}
          drawUndoTrigger={drawUndoTrigger}
          drawRedoTrigger={drawRedoTrigger}
          onDrawVertexChange={handleDrawVertexChange}
          onFeatureInspect={handleFeatureInspect}
          inspectedFeatureId={inspectedFeature?.id}
          drawnBoundary={drawnTaskBoundary}
          isCollector={isCollector}
          onFeatureBlocked={handleFeatureBlocked}
          editSubMode={editSubMode}
          outlinedTaskIds={outlinedTaskIds}
          outlineAllTasks={outlineAllTasks}
          pickLinkedFeatureMode={pickFeatureMode}
          selectedLinkedFeatureId={selectedLinkedFeature?.featureId}
          selectedLinkedLayerId={selectedLinkedFeature?.layerId}
          onLinkedFeatureSelect={(featInfo) => {
            setSelectedLinkedFeature(featInfo);
            setPickFeatureMode(false);
          }}
          collectorLocations={collectorLocations}
          showCollectorLocations={showCollectorTracking}
        />

        {/* Spatial Grid Boundary Enforcement Floating Alert */}
        {gridAlert && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-bounce-in max-w-md w-full px-4 pointer-events-none">
            <div className="bg-amber-950/95 backdrop-blur-md text-white border border-amber-500/70 shadow-2xl rounded-xl p-3 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />
              <div className="text-xs font-nepali font-bold leading-relaxed text-amber-100">
                {gridAlert}
              </div>
            </div>
          </div>
        )}

        {/* Multi-Section Layer Control (Top Right) */}
        <LayerControl
          isOpen={showLayerControl}
          onToggle={setShowLayerControl}
          activeBasemap={activeBasemap}
          onBasemapChange={setActiveBasemap}
          basemapOpacity={basemapOpacity}
          onBasemapOpacityChange={setBasemapOpacity}
          rasterLayers={serverRasters}
          onRasterToggle={handleRasterToggle}
          onZoomToRaster={handleZoomToRaster}
          vectorLayers={serverVectors}
          onVectorToggle={handleVectorToggle}
          onVectorOpacityChange={handleVectorOpacityChange}
          onZoomToVector={handleZoomToVector}
          activeEditLayerId={editMode ? editLayerId : null}
          onEditLayer={(layerId) => toggleEditMode(layerId)}
          onVectorOutlineToggle={handleVectorOutlineToggle}
          onOpenLinkLayers={handleOpenLinkModal}
          collectorLocations={collectorLocations}
          showCollectorLocations={showCollectorTracking}
          onToggleCollectorLocations={() => setShowCollectorTracking((prev) => !prev)}
          projects={projects}
          onZoomToCollector={handleZoomToCollector}
          onToggleLayerSnapping={handleToggleLayerSnapping}
          onToggleViewEdits={handleToggleViewEdits}
          onToggleMyEdits={handleToggleMyEdits}
          onToggleCollectorInLayer={handleToggleCollectorInLayer}
          onSetLayerCollectors={handleSetLayerCollectors}
          onChangeEditCollector={handleChangeEditCollector}
          onOpenLayerEditsModal={(layer) => setLayerEditsModalTarget(layer)}
          currentUser={user}
        />

        {/* Drawing & Quick Tools (Left Sidebar) */}
        <div className="absolute top-3 left-3 z-30 flex items-start gap-2 font-sans max-w-[calc(100vw-24px)] max-h-[calc(100dvh-75px)] pointer-events-none" id="left-tools-container">
          {toolsCollapsed ? (
            /* Collapsed to Single Button Mode (Edit Mode / Master Tools Button) */
            <button
              type="button"
              onClick={() => setToolsCollapsed(false)}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl border shadow-md flex items-center justify-center transition-all pointer-events-auto animate-fade-in ${
                editMode
                  ? 'bg-amber-600 text-white font-bold shadow-md ring-2 ring-amber-400 border-amber-500'
                  : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300'
              }`}
              title="उपकरण पट्टी खोल्नुहोस् (Expand Tools)"
            >
              <Edit3 className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          ) : (
            /* Expanded Mode: Single Vertically Aligned Column of All Buttons */
            <div className="pointer-events-auto bg-white rounded-xl border border-slate-300 shadow-md p-1.5 flex flex-col items-center gap-1 shrink-0 animate-fade-in">
              {/* Collapse to Single Button Toggle */}
              <button
                type="button"
                onClick={() => setToolsCollapsed(true)}
                className="w-8 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                title="खुम्च्याउनुहोस् (Collapse to single button)"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>

              {/* 1. Edit Mode Toggle Button */}
              {(isAdmin || isCollector || isValidator) && (
                <button
                  type="button"
                  onClick={() => toggleEditMode()}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                    editMode
                      ? 'bg-amber-600 text-white font-bold shadow-md ring-2 ring-amber-400'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                  title="सम्पादन मोड (Edit Mode: Select & Modify Features)"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              )}

              {/* Capture Tools */}
              {(isAdmin || isCollector || isValidator) && (
                <>
                  <div className="w-6 h-[1px] bg-slate-200 my-0.5" />

                  {/* 2. Draw Point */}
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(false);
                      setSelectedFeature(null);
                      setDrawToolsCollapsed(false);
                      setDrawMode(drawMode === 'Point' ? null : 'Point');
                    }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                      drawMode === 'Point'
                        ? 'bg-gov-blue-800 text-white font-bold shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                    title="बिन्दु संकलन (Capture Point)"
                  >
                    <Circle className="w-4 h-4" />
                  </button>

                  {/* 3. Draw Line */}
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(false);
                      setSelectedFeature(null);
                      setDrawToolsCollapsed(false);
                      setDrawMode(drawMode === 'LineString' ? null : 'LineString');
                    }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                      drawMode === 'LineString'
                        ? 'bg-gov-blue-800 text-white font-bold shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                    title="रेखा संकलन (Capture Line)"
                  >
                    <Minus className="w-4 h-4" />
                  </button>

                  {/* 4. Draw Polygon */}
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(false);
                      setSelectedFeature(null);
                      setDrawToolsCollapsed(false);
                      setDrawMode(drawMode === 'Polygon' ? null : 'Polygon');
                    }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                      drawMode === 'Polygon'
                        ? 'bg-gov-blue-800 text-white font-bold shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                    title="बहुभुज संकलन (Capture Polygon)"
                  >
                    <Triangle className="w-4 h-4" />
                  </button>
                </>
              )}

              {/* 5. Task Grid Shortcut */}
              <div className="w-6 h-[1px] bg-slate-200 my-0.5" />
              <button
                type="button"
                onClick={() => setShowTaskPanel(!showTaskPanel)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                  showTaskPanel
                    ? 'bg-gov-blue-800 text-white font-bold shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title="कार्य ग्रिड व्यवस्थापन (Task Grid)"
              >
                <Grid3X3 className="w-4 h-4" />
              </button>

              {/* 6. Admin Panel Shortcut */}
              {isAdmin && (
                <>
                  {!activeProject && <div className="w-6 h-[1px] bg-slate-200 my-0.5" />}
                  <button
                    type="button"
                    onClick={() => setShowAdminPanel(!showAdminPanel)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                      showAdminPanel
                        ? 'bg-gov-blue-800 text-white font-bold shadow-sm'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                    title="प्रशासनिक प्यानल (Admin Control)"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* New Feature Capture / Drawing Mode Controls Panel with Full Snapping */}
          {serverVectors.length > 0 && drawMode && (
            drawToolsCollapsed ? (
              /* Collapsed State: Sleek Toggle Button */
              <button
                type="button"
                onClick={() => setDrawToolsCollapsed(false)}
                className="pointer-events-auto bg-white hover:bg-gov-blue-50 text-slate-800 border border-gov-blue-300 rounded-lg p-2 sm:px-3 sm:py-2 flex items-center gap-2 shadow-md transition-all shrink-0 animate-fade-in text-left"
                title="अङ्कन नियन्त्रण प्यानल खोल्नुहोस् (Expand Drawing Tools)"
              >
                <div className="w-5 h-5 rounded bg-gov-blue-800 text-white flex items-center justify-center shrink-0">
                  {drawMode === 'Point' && <Circle className="w-3.5 h-3.5" />}
                  {drawMode === 'LineString' && <Minus className="w-3.5 h-3.5" />}
                  {drawMode === 'Polygon' && <Triangle className="w-3.5 h-3.5" />}
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-gov-blue-900 block leading-tight font-nepali">
                      {drawMode === 'Point' && 'बिन्दु संकलन (Point)'}
                      {drawMode === 'LineString' && 'रेखा संकलन (Line)'}
                      {drawMode === 'Polygon' && 'बहुभुज संकलन (Polygon)'}
                    </span>
                    <span className="flex h-1.5 w-1.5 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-gov-blue-600"></span>
                    </span>
                  </div>
                  <span className="text-[10px] text-gov-blue-700/90 block leading-tight truncate max-w-[150px]">
                    तह: {serverVectors.find((v) => v.id === activeLayerId)?.name || 'सक्रिय'}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-gov-blue-800 shrink-0 ml-1" />
              </button>
            ) : (
              /* Expanded State: Full Panel with Layer Selection, Snapping & Guidance */
              <div className="pointer-events-auto w-72 sm:w-80 max-w-[calc(100vw-64px)] max-h-[calc(100dvh-90px)] flex flex-col bg-white border border-gov-blue-300 rounded-xl shadow-2xl text-slate-800 animate-slide-right overflow-hidden shrink min-h-0">
                {/* Pinned Header Banner with Minimize and Close Controls */}
                <div
                  className="bg-gov-blue-800 text-white px-3 py-2 flex items-center justify-between text-xs font-bold font-nepali shrink-0 shadow-sm select-none cursor-pointer"
                  onClick={() => setDrawToolsCollapsed(true)}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    {drawMode === 'Point' && <Circle className="w-3.5 h-3.5 text-gov-gold-400 shrink-0" />}
                    {drawMode === 'LineString' && <Minus className="w-3.5 h-3.5 text-gov-gold-400 shrink-0" />}
                    {drawMode === 'Polygon' && <Triangle className="w-3.5 h-3.5 text-gov-gold-400 shrink-0" />}
                    <span className="truncate">
                      {drawMode === 'Point' && 'बिन्दु संकलन (Capture Point)'}
                      {drawMode === 'LineString' && 'रेखा संकलन (Capture Line)'}
                      {drawMode === 'Polygon' && 'बहुभुज संकलन (Capture Polygon)'}
                    </span>
                    <span className="flex h-2 w-2 relative shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-gov-gold-400"></span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setDrawToolsCollapsed(true)}
                      className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-0.5 rounded transition-colors"
                      title="प्यानल खुम्च्याउनुहोस् (Collapse to Button)"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawMode(null)}
                      className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-0.5 rounded transition-colors"
                      title="अङ्कन बन्द गर्नुहोस् (Cancel Drawing)"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Scrollable Content Body */}
                <div className="overflow-y-auto p-2.5 space-y-2 flex-1 overscroll-contain scrollbar-thin">
                  {/* 1. Target Vector Layer Dropdown & Linking ID Field Selector */}
                  <div className="bg-gov-blue-50/60 p-2 rounded-lg border border-gov-blue-200 space-y-2">
                    <div>
                      <label className="text-[9px] font-bold text-gov-blue-950 block mb-1 font-nepali flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-gov-red-700 shrink-0" />
                        <span>अङ्कन तह (Target Layer):</span>
                      </label>
                      <select
                        value={activeLayerId || ''}
                        onChange={(e) => {
                          setActiveLayerId(parseInt(e.target.value) || null);
                          setSelectedLinkedFeature(null);
                        }}
                        className="w-full bg-white border border-gov-blue-300 rounded-md text-[11px] text-slate-800
                                   px-2 py-1 outline-none focus:border-gov-blue-800 font-medium cursor-pointer"
                      >
                        {serverVectors.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.is_global ? 'महानगर / Global' : `विशेष परियोजना: ${l.project_name || projects.find(p => p.id === l.project_id)?.name || l.project_id}`})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* 2. Feature Linking Option — OFF BY DEFAULT */}
                  <div className="bg-purple-50/60 p-2 rounded-lg border border-purple-200/80 space-y-1.5 transition-all">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Link2 className={`w-3.5 h-3.5 ${enableLayerLinking ? 'text-purple-700' : 'text-slate-400'}`} />
                        <div>
                          <span className="text-[9.5px] font-bold text-purple-950 block font-nepali leading-tight">
                            फिचर लिङ्किङ (Feature Linking)
                          </span>
                          <span className="text-[8.5px] text-slate-500 font-nepali">
                            {enableLayerLinking ? 'सक्रिय (Linking ON)' : 'निष्क्रिय (Default OFF - No Linking)'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !enableLayerLinking;
                          setEnableLayerLinking(next);
                          if (!next) {
                            setSelectedLinkedFeature(null);
                            setPickFeatureMode(false);
                          }
                        }}
                        className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          enableLayerLinking ? 'bg-purple-600' : 'bg-slate-300'
                        }`}
                        title={enableLayerLinking ? 'फिचर लिङ्किङ बन्द गर्नुहोस्' : 'फिचर लिङ्किङ खोल्नुहोस्'}
                      >
                        <span
                          className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            enableLayerLinking ? 'translate-x-3.5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {!enableLayerLinking && (
                      <p className="text-[8.5px] text-slate-500 font-nepali leading-tight pt-1 border-t border-purple-100">
                        नयाँ फिचर स्वतन्त्र रूपमा सिर्जना हुनेछ (कुनै वस्तुसँग स्वचालित सम्बन्ध जोडिने छैन)।
                      </p>
                    )}

                    {/* Expanded Linking Options — ONLY when explicitly enabled by user */}
                    {enableLayerLinking && (
                      <div className="space-y-2 pt-1.5 border-t border-purple-200/80 animate-fade-in">
                        {/* Target Layer Linking ID */}
                        <div>
                          <label className="text-[9px] font-bold text-purple-950 block mb-1 font-nepali flex items-center gap-1">
                            <Link2 className="w-3 h-3 text-purple-700 shrink-0" />
                            <span>लिङ्किङ आइडी (Target Layer Linking ID):</span>
                          </label>
                          <select
                            value={activeLayerLinkingIdField}
                            onChange={(e) => setActiveLayerLinkingIdField(e.target.value)}
                            className="w-full bg-white border border-purple-300 rounded-md text-[10px] text-purple-950
                                       px-2 py-1 outline-none focus:border-purple-700 font-medium cursor-pointer"
                          >
                            {targetLayerFields.map((f) => (
                              <option key={f} value={f}>
                                {f === '_id' ? '_id (प्राथमिक आइडी / Primary ID)' : f}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Pick from Map Option */}
                        <div className="space-y-1.5 pt-1 border-t border-purple-200/60">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={pickFeatureMode}
                              onChange={(e) => setPickFeatureMode(e.target.checked)}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-purple-700 focus:ring-purple-600 cursor-pointer"
                            />
                            <span className="text-[9.5px] font-bold text-slate-800 font-nepali flex items-center gap-1">
                              <Crosshair className={`w-3 h-3 ${pickFeatureMode ? 'text-purple-600 animate-spin' : 'text-slate-500'}`} />
                              <span>नक्साबाट सम्बन्धित फिचर छान्नुहोस् (Pick from Map)</span>
                            </span>
                          </label>

                          {pickFeatureMode && !selectedLinkedFeature && (
                            <div className="bg-purple-100/70 text-purple-900 border border-purple-300 rounded p-1.5 text-[8.5px] font-nepali leading-tight flex items-center gap-1.5 animate-pulse">
                              <Sparkles className="w-3 h-3 text-purple-700 shrink-0" />
                              <span>नक्सा क्यानभासमा रहेको कुनै वस्तु (फिचर) मा क्लिक गरेर छान्नुहोस्।</span>
                            </div>
                          )}

                          {selectedLinkedFeature && (
                            <div className="bg-purple-100/80 border border-purple-300 rounded-md p-1.5 text-[9px] flex items-center justify-between gap-1 animate-fade-in">
                              <div className="min-w-0">
                                <div className="font-bold text-purple-950 font-nepali truncate flex items-center gap-1">
                                  <Link2 className="w-3 h-3 text-purple-700 shrink-0" />
                                  <span>तह: {selectedLinkedFeature.layerName}</span>
                                </div>
                                <span className="text-[8.5px] text-purple-800 font-mono block truncate">
                                  फिचर #{selectedLinkedFeature.featureId}
                                  {selectedLinkedFeature.properties?.[activeLayerLinkingIdField] && ` (${selectedLinkedFeature.properties[activeLayerLinkingIdField]})`}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedLinkedFeature(null);
                                  setPickFeatureMode(false);
                                }}
                                className="text-purple-700 hover:text-gov-red-700 p-1 rounded hover:bg-purple-200 transition-colors shrink-0 cursor-pointer"
                                title="चयन हटाउनुहोस् (Clear Selection)"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Reference Layer Linking if multiple layers */}
                        {serverVectors.length > 1 && (
                          <div className="space-y-1.5 pt-1.5 border-t border-purple-200/60">
                            <div>
                              <label className="text-[8.5px] font-semibold text-purple-900 block mb-0.5 font-nepali">
                                सम्बन्धित तह (Reference Layer):
                              </label>
                              <select
                                value={refLayerId || 'auto'}
                                onChange={(e) => setRefLayerId(e.target.value === 'auto' ? 'auto' : parseInt(e.target.value))}
                                className="w-full bg-white border border-purple-200 rounded-md text-[10px] text-slate-800
                                           px-2 py-1 outline-none focus:border-purple-600 font-medium cursor-pointer"
                              >
                                <option value="auto">⚡ स्वचालित (स्न्याप/स्थान अनुसार - Auto Detect)</option>
                                {serverVectors
                                  .filter((l) => l.id !== activeLayerId)
                                  .map((l) => (
                                    <option key={l.id} value={l.id}>
                                      {l.name} ({l.is_global ? 'महानगर / Global' : `विशेष परियोजना: ${l.project_name || projects.find(p => p.id === l.project_id)?.name || l.project_id}`})
                                    </option>
                                  ))}
                              </select>
                            </div>

                            {refLayerId !== 'auto' && (
                              <div className="pt-1 border-t border-purple-200/60">
                                <label className="text-[8.5px] font-semibold text-purple-900 block mb-0.5 font-nepali">
                                  सम्बन्धित फिल्ड (Linked ID Field):
                                </label>
                                <select
                                  value={refLayerLinkingIdField}
                                  onChange={(e) => setRefLayerLinkingIdField(e.target.value)}
                                  className="w-full bg-white border border-purple-200 rounded-md text-[10px] text-purple-950
                                             px-2 py-1 outline-none focus:border-purple-600 font-medium cursor-pointer"
                                >
                                  {refLayerFields.map((f) => (
                                    <option key={f} value={f}>
                                      {f === '_id' ? '_id (प्राथमिक आइडी / Primary ID)' : f}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 2. Undo & Redo Quick Action Buttons for Drawing Mode */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleDrawUndo}
                      disabled={drawUndoCount === 0}
                      className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all border ${
                        drawUndoCount > 0
                          ? 'bg-white hover:bg-gov-blue-50 text-gov-blue-900 border-gov-blue-300 shadow-xs cursor-pointer active:scale-95'
                          : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                      }`}
                      title="पूर्ववत गर्नुहोस् (Undo / Backspace or Ctrl+Z)"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>पूर्ववत (Undo)</span>
                      {drawUndoCount > 0 && (
                        <span className="px-1 py-0.2 rounded-full text-[8px] bg-gov-blue-200 text-gov-blue-900 font-mono font-bold">
                          {drawUndoCount}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleDrawRedo}
                      disabled={drawRedoCount === 0}
                      className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all border ${
                        drawRedoCount > 0
                          ? 'bg-white hover:bg-gov-blue-50 text-gov-blue-900 border-gov-blue-300 shadow-xs cursor-pointer active:scale-95'
                          : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                      }`}
                      title="पुनः गर्नुहोस् (Redo / Ctrl+Y or Ctrl+Shift+Z)"
                    >
                      <Redo2 className="w-3.5 h-3.5" />
                      <span>पुनः (Redo)</span>
                      {drawRedoCount > 0 && (
                        <span className="px-1 py-0.2 rounded-full text-[8px] bg-gov-blue-200 text-gov-blue-900 font-mono font-bold">
                          {drawRedoCount}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* 3. Snapping ON/OFF Toggle Section */}
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 font-nepali">
                        <Magnet className={`w-3.5 h-3.5 ${isDrawLayerSnappingAllowed && snappingEnabled ? 'text-emerald-600 animate-pulse' : 'text-slate-400'}`} />
                        <span>बिन्दु स्न्यापिङ (Snapping)</span>
                      </div>
                      {!isDrawLayerSnappingAllowed ? (
                        <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-bold font-nepali" title="प्रशासकद्वारा यस तहमा स्न्यापिङ अनुमति दिइएको छैन">
                          स्न्याप बन्द (Admin)
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSnappingEnabled(!snappingEnabled)}
                          className={`relative inline-flex h-4.5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            snappingEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                          }`}
                          title={snappingEnabled ? 'स्न्यापिङ बन्द गर्नुहोस्' : 'स्न्यापिङ चालू गर्नुहोस्'}
                        >
                          <span
                            className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              snappingEnabled ? 'translate-x-4.5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {!isDrawLayerSnappingAllowed ? (
                      <div className="text-[9px] text-rose-600 font-nepali pt-1 border-t border-rose-100 flex items-center gap-1">
                        <span>⚠️ प्रशासकद्वारा यस तहमा स्न्यापिङ निषेध गरिएको छ।</span>
                      </div>
                    ) : (
                      snappingEnabled && (
                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                          <span className="text-[9px] text-slate-500 font-nepali">सहिष्णुता (Tolerance):</span>
                          <div className="flex items-center gap-1">
                            {[10, 15, 20, 30].map((tol) => (
                              <button
                                key={tol}
                                type="button"
                                onClick={() => setSnapTolerance(tol)}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-all ${
                                  snapTolerance === tol
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {tol}px
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {/* 4. Context Guidance Information */}
                  <div className="bg-gov-blue-50/80 rounded-lg p-2 border border-gov-blue-200/80 text-[9px] text-gov-blue-950 font-nepali leading-relaxed flex flex-col gap-1">
                    <div className="font-bold text-gov-blue-900 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-gov-blue-700 shrink-0" />
                      <span>
                        {drawMode === 'Point' && 'बिन्दु संकलन निर्देशन:'}
                        {drawMode === 'LineString' && 'रेखा खिच्ने निर्देशन:'}
                        {drawMode === 'Polygon' && 'बहुभुज बनाउने निर्देशन:'}
                      </span>
                    </div>
                    <div className="text-slate-700 space-y-0.5 pl-1 border-l-2 border-gov-blue-400">
                      {drawMode === 'Point' && (
                        <p>&bull; नक्सामा जहाँ नयाँ बिन्दु राख्न चाहनुहुन्छ, त्यहाँ <strong>क्लिक</strong> गर्नुहोस्।</p>
                      )}
                      {drawMode === 'LineString' && (
                        <>
                          <p>&bull; <strong>क्लिक:</strong> नयाँ बिन्दु थप्दै रेखा विस्तार गर्नुहोस्।</p>
                          <p>&bull; <strong>पूर्ववत:</strong> Backspace वा पूर्ववत बटनले अघिल्लो बिन्दु हटाउँछ।</p>
                          <p>&bull; <strong>समाप्त:</strong> रेखा पूरा गर्न अन्तिम बिन्दुमा <strong>डबल क्लिक</strong> गर्नुहोस्।</p>
                        </>
                      )}
                      {drawMode === 'Polygon' && (
                        <>
                          <p>&bull; <strong>क्लिक:</strong> कुनाहरू जोड्दै बहुभुज कोर्नुहोस्।</p>
                          <p>&bull; <strong>पूर्ववत:</strong> Backspace वा पूर्ववत बटनले अघिल्लो कुना हटाउँछ।</p>
                          <p>&bull; <strong>समाप्त:</strong> सुरुको बिन्दु वा अन्तिम स्थानमा <strong>डबल क्लिक</strong> गर्नुहोस्।</p>
                        </>
                      )}
                      {snappingEnabled && (
                        <p className="text-emerald-700 font-semibold">&bull; <strong>स्न्यापिङ सक्रिय:</strong> मौजुदा बिन्दुहरू स्पष्ट देखिन्छन् र कर्सर स्वतः जोडिन्छ।</p>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            )
          )}

          {/* Edit Mode Master Controls Panel — Fully Collapsible as a Whole */}
          {serverVectors.length > 0 && editMode && (
            editToolsCollapsed ? (
              /* Collapsed State: Sleek Toggle Button (Just like LayerControl) */
              <button
                type="button"
                onClick={() => setEditToolsCollapsed(false)}
                className="pointer-events-auto bg-white hover:bg-amber-50 text-slate-800 border border-amber-300 rounded-lg p-2 sm:px-3 sm:py-2 flex items-center gap-2 shadow-md transition-all shrink-0 animate-fade-in text-left"
                title="सम्पादन नियन्त्रण प्यानल खोल्नुहोस् (Expand Edit Tools)"
              >
                <div className="w-5 h-5 rounded bg-amber-600 text-white flex items-center justify-center shrink-0">
                  <Edit3 className="w-3.5 h-3.5" />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-amber-900 block leading-tight font-nepali">
                      सम्पादन नियन्त्रण (Edit Tools)
                    </span>
                    <span className="flex h-1.5 w-1.5 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                    </span>
                  </div>
                  <span className="text-[10px] text-amber-700/90 block leading-tight truncate max-w-[150px]">
                    तह: {serverVectors.find((v) => v.id === editLayerId)?.name || 'सक्रिय'}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-amber-600 shrink-0 ml-1" />
              </button>
            ) : (
              /* Expanded State: Full Scrollable Panel that Stays Within Viewport */
              <div className="pointer-events-auto w-72 sm:w-80 max-w-[calc(100vw-64px)] max-h-[calc(100dvh-90px)] flex flex-col bg-white border border-amber-300 rounded-xl shadow-2xl text-slate-800 animate-slide-right overflow-hidden shrink min-h-0">
                {/* Pinned Header Banner with Minimize and Close Controls */}
                <div
                  className="bg-amber-600 text-white px-3 py-2 flex items-center justify-between text-xs font-bold font-nepali shrink-0 shadow-sm select-none cursor-pointer"
                  onClick={() => setEditToolsCollapsed(true)}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Edit3 className="w-3.5 h-3.5 text-amber-200 shrink-0" />
                    <span className="truncate">सम्पादन नियन्त्रण (Edit Tools)</span>
                    <span className="flex h-2 w-2 relative shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-200"></span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setEditToolsCollapsed(true)}
                      className="text-white/80 hover:text-white hover:bg-amber-700 p-0.5 rounded transition-colors"
                      title="प्यानल खुम्च्याउनुहोस् (Collapse to Button)"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleEditMode()}
                      className="text-white/80 hover:text-white hover:bg-amber-700 p-0.5 rounded transition-colors"
                      title="सम्पादन मोड बन्द गर्नुहोस् (Exit Edit Mode)"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Scrollable Content Body */}
                <div className="overflow-y-auto p-2.5 space-y-2 flex-1 overscroll-contain scrollbar-thin">
                  {/* Edit Layer Dropdown — ONLY VISIBLE / ON LAYERS */}
                  <div className="bg-amber-50/60 p-2 rounded-lg border border-amber-200">
                    <label className="text-[9px] font-bold text-amber-950 block mb-1 font-nepali">
                      सक्रिय सम्पादन तह (Edit Layer):
                    </label>
                    <select
                      value={editLayerId || ''}
                      onChange={(e) => {
                        const newId = parseInt(e.target.value) || null;
                        setEditLayerId(newId);
                        setSelectedFeature(null);
                        setUndoStack([]);
                        setRedoStack([]);
                        if (newId) {
                          setServerVectors((current) =>
                            current.map((v) => {
                              if (v.id === newId) {
                                if (!v.features) {
                                  featuresAPI.list(newId).then((res) => {
                                    let featureData = res.data;
                                    if (featureData && !featureData.type && Array.isArray(featureData)) {
                                      featureData = { type: 'FeatureCollection', features: featureData };
                                    }
                                    setServerVectors((cur) =>
                                      cur.map((item) => (item.id === newId ? { ...item, features: featureData } : item))
                                    );
                                  });
                                }
                                return { ...v, visible: true };
                              }
                              return v;
                            })
                          );
                        }
                      }}
                      className="w-full bg-white border border-amber-300 rounded-md text-[11px] text-slate-800
                                 px-2 py-1 outline-none focus:border-amber-600 font-medium cursor-pointer"
                    >
                      {serverVectors.filter((v) => v.visible !== false).length === 0 ? (
                        <option value="" disabled>कुनै तह अन छैन (पहिले तह खोल्नुहोस्)</option>
                      ) : (
                        serverVectors
                          .filter((v) => v.visible !== false)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name} ({l.is_global ? 'महानगर' : 'परियोजना'})
                            </option>
                          ))
                      )}
                    </select>
                  </div>

                  {/* Undo & Redo Quick Action Buttons */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={!selectedFeature || undoStack.length === 0}
                      className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all border ${
                        selectedFeature && undoStack.length > 0
                          ? 'bg-white hover:bg-amber-100 text-amber-900 border-amber-300 shadow-xs cursor-pointer active:scale-95'
                          : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                      }`}
                      title="पूर्ववत गर्नुहोस् (Undo / Backspace or Ctrl+Z)"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>पूर्ववत (Undo)</span>
                      {undoStack.length > 0 && (
                        <span className="px-1 py-0.2 rounded-full text-[8px] bg-amber-200 text-amber-900 font-mono font-bold">
                          {undoStack.length}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleRedo}
                      disabled={!selectedFeature || redoStack.length === 0}
                      className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-bold font-nepali flex items-center justify-center gap-1 transition-all border ${
                        selectedFeature && redoStack.length > 0
                          ? 'bg-white hover:bg-amber-100 text-amber-900 border-amber-300 shadow-xs cursor-pointer active:scale-95'
                          : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                      }`}
                      title="पुनः गर्नुहोस् (Redo / Ctrl+Y or Ctrl+Shift+Z)"
                    >
                      <Redo2 className="w-3.5 h-3.5" />
                      <span>पुनः (Redo)</span>
                      {redoStack.length > 0 && (
                        <span className="px-1 py-0.2 rounded-full text-[8px] bg-amber-200 text-amber-900 font-mono font-bold">
                          {redoStack.length}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Snapping ON/OFF Toggle Section */}
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 font-nepali">
                        <Magnet className={`w-3.5 h-3.5 ${isEditLayerSnappingAllowed && snappingEnabled ? 'text-emerald-600 animate-pulse' : 'text-slate-400'}`} />
                        <span>बिन्दु स्न्यापिङ (Snapping)</span>
                      </div>
                      {!isEditLayerSnappingAllowed ? (
                        <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-bold font-nepali" title="प्रशासकद्वारा यस तहमा स्न्यापिङ अनुमति दिइएको छैन">
                          स्न्याप बन्द (Admin)
                        </span>
                      ) : (
                        <button
                          onClick={() => setSnappingEnabled(!snappingEnabled)}
                          className={`relative inline-flex h-4.5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            snappingEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                          }`}
                          title={snappingEnabled ? 'स्न्यापिङ बन्द गर्नुहोस्' : 'स्न्यापिङ चालू गर्नुहोस्'}
                        >
                          <span
                            className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              snappingEnabled ? 'translate-x-4.5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {!isEditLayerSnappingAllowed ? (
                      <div className="text-[9px] text-rose-600 font-nepali pt-1 border-t border-rose-100 flex items-center gap-1">
                        <span>⚠️ प्रशासकद्वारा यस तहमा स्न्यापिङ निषेध गरिएको छ।</span>
                      </div>
                    ) : (
                      snappingEnabled && (
                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                          <span className="text-[9px] text-slate-500 font-nepali">सहिष्णुता (Tolerance):</span>
                          <div className="flex items-center gap-1">
                            {[10, 15, 20, 30].map((tol) => (
                              <button
                                key={tol}
                                onClick={() => setSnapTolerance(tol)}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-all ${
                                  snapTolerance === tol
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {tol}px
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {/* Selected Feature Geometry Sub-Mode Toolbar */}
                  {selectedFeature && (
                    <div className="bg-amber-100/60 p-2 rounded-lg border border-amber-300/80 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[10px] font-bold text-amber-900 font-nepali">
                        <span>सम्पादन उपकरण (Tools):</span>
                        <span className="font-mono bg-amber-200 px-1.5 py-0.2 rounded text-[9px]">#{selectedFeature.id}</span>
                      </div>

                      {/* Mode status indicator */}
                      {!editSubMode ? (
                        <div className="flex items-center justify-between px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-[9.5px] font-nepali text-sky-900">
                          <span className="flex items-center gap-1 font-bold">
                            <Sparkles className="w-2.5 h-2.5 text-sky-600 shrink-0" />
                            <span>सबै खुला (All Allowed)</span>
                          </span>
                          <span className="text-[8.5px] text-sky-700 bg-sky-100 px-1 rounded font-sans">छनौट छैन</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[9.5px] font-nepali text-amber-900">
                          <span className="flex items-center gap-1 font-bold truncate">
                            {editSubMode === 'tane' && 'केवल "ताने" सक्रिय'}
                            {editSubMode === 'bistar' && 'केवल "बिस्तार" सक्रिय'}
                            {editSubMode === 'metne' && 'केवल "मेट्ने" सक्रिय'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditSubMode(null)}
                            className="text-[8.5px] text-amber-800 hover:text-amber-950 font-bold underline shrink-0 cursor-pointer"
                            title="सबै खुला गर्नुहोस्"
                          >
                            सबै खुला
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-1">
                        {/* 1. ताने */}
                        <button
                          type="button"
                          onClick={() => setEditSubMode(editSubMode === 'tane' ? null : 'tane')}
                          disabled={editSubMode && editSubMode !== 'tane'}
                          className={`py-1 px-1 rounded text-[9.5px] font-bold font-nepali flex items-center justify-center gap-0.5 border ${
                            editSubMode === 'tane'
                              ? 'bg-gov-blue-800 text-white border-gov-blue-900 shadow-xs ring-1 ring-gov-blue-400 cursor-pointer'
                              : editSubMode && editSubMode !== 'tane'
                              ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 cursor-not-allowed shadow-none'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer'
                          }`}
                          title={editSubMode && editSubMode !== 'tane' ? 'अहिले अर्को मोड सक्रिय छ (Disabled)' : 'ताने (Move/Drag)'}
                        >
                          <Move className="w-2.5 h-2.5" />
                          <span>ताने</span>
                        </button>

                        {/* 2. बिस्तार */}
                        <button
                          type="button"
                          onClick={() => setEditSubMode(editSubMode === 'bistar' ? null : 'bistar')}
                          disabled={(editSubMode && editSubMode !== 'bistar') || selectedFeature?.geometryType === 'Point'}
                          className={`py-1 px-1 rounded text-[9.5px] font-bold font-nepali flex items-center justify-center gap-0.5 border ${
                            editSubMode === 'bistar'
                              ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs ring-1 ring-emerald-400 cursor-pointer'
                              : (editSubMode && editSubMode !== 'bistar') || selectedFeature?.geometryType === 'Point'
                              ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 cursor-not-allowed shadow-none'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer'
                          }`}
                          title={
                            selectedFeature?.geometryType === 'Point'
                              ? 'एकल बिन्दु विस्तार गर्न मिल्दैन'
                              : editSubMode && editSubMode !== 'bistar'
                              ? 'अहिले अर्को मोड सक्रिय छ (Disabled)'
                              : 'बिस्तार (Extend)'
                          }
                        >
                          <Plus className="w-2.5 h-2.5" />
                          <span>बिस्तार</span>
                        </button>

                        {/* 3. मेट्ने */}
                        <button
                          type="button"
                          onClick={() => setEditSubMode(editSubMode === 'metne' ? null : 'metne')}
                          disabled={editSubMode && editSubMode !== 'metne'}
                          className={`py-1 px-1 rounded text-[9.5px] font-bold font-nepali flex items-center justify-center gap-0.5 border ${
                            editSubMode === 'metne'
                              ? 'bg-gov-red-600 text-white border-gov-red-700 shadow-xs ring-1 ring-gov-red-400 cursor-pointer'
                              : editSubMode && editSubMode !== 'metne'
                              ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 cursor-not-allowed shadow-none'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 cursor-pointer'
                          }`}
                          title={editSubMode && editSubMode !== 'metne' ? 'अहिले अर्को मोड सक्रिय छ (Disabled)' : 'मेट्ने (Delete Vertex)'}
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                          <span>मेट्ने</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Context Guidance Information */}
                  <div className="bg-amber-50/80 rounded-lg p-2 border border-amber-200/80 text-[9px] text-amber-950 font-nepali leading-relaxed flex flex-col gap-1">
                    {!selectedFeature ? (
                      <div className="flex items-start gap-1">
                        <MousePointerClick className="w-3 h-3 text-amber-700 shrink-0 mt-0.5" />
                        <span>नक्सामा रहेको कुनै रेखा वा बहुभुज छोएर छान्नुहोस्।</span>
                      </div>
                    ) : (
                      <>
                        <div className="font-bold text-amber-900 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
                          <span>वस्तु #{selectedFeature.id} चयन गरिएको छ</span>
                        </div>
                        <div className="text-slate-700 space-y-0.5 pl-1 border-l-2 border-amber-400">
                          <p>&bull; <strong>बिन्दु छान्ने:</strong> बिन्दुमा क्लिक गर्दा <strong>रातो (RED)</strong> हुन्छ।</p>
                          <p>&bull; <strong>नयाँ बिन्दु जोड्ने:</strong> नयाँ ठाउँमा क्लिक गर्दा छानिएको बिन्दुसँग जोडिन्छ।</p>
                          <p>&bull; <strong>तान्ने:</strong> बिन्दु समातेर नयाँ ठाउँमा सार्नुहोस्।</p>
                          <p>&bull; <strong>मेट्ने:</strong> Right-Click वा "मेट्ने" मोडबाट क्लिक गर्नुहोस्।</p>
                          {snappingEnabled && (
                            <p className="text-emerald-700">&bull; <strong>स्न्याप:</strong> नजिकका बिन्दुमा स्वतः जोडिन्छ।</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        {/* Task Grid Sidebar */}
        {showTaskPanel && (
          <TaskPanel
            tasks={taskGrids}
            selectedTask={selectedTask}
            onTaskSelect={(taskProps) => {
              setSelectedTask(taskProps);
            }}
            onTaskAction={handleTaskAction}
            onClose={() => setShowTaskPanel(false)}
            loading={actionLoading}
            activeProject={activeProject}
            projects={projects}
            onSelectProject={(proj) => {
              setActiveProject(proj);
            }}
            onRefreshTasks={async () => {
              if (activeProject) {
                try {
                  const res = await tasksAPI.list(activeProject.id);
                  setTaskGrids(res.data);
                  const pRes = await projectsAPI.get(activeProject.id);
                  setActiveProject(pRes.data);
                } catch (err) {
                  console.error('Failed to reload tasks:', err);
                }
              }
            }}
            onStartDrawBoundary={handleStartDrawBoundary}
            drawnBoundary={drawnTaskBoundary}
            isDrawingBoundary={drawingTaskBoundary}
            onClearDrawnBoundary={handleClearDrawnBoundary}
            outlinedTaskIds={outlinedTaskIds}
            outlineAllTasks={outlineAllTasks}
            onToggleTaskOutline={handleToggleTaskOutline}
            onToggleAllTasksOutline={handleToggleAllTasksOutline}
          />
        )}

        {/* Admin Panel Sidebar */}
        {showAdminPanel && (
          <AdminPanel
            onClose={() => {
              setShowAdminPanel(false);
              loadAllLayers(activeProject);
              projectsAPI.list().then((res) => setProjects(res.data)).catch(console.error);
            }}
            onProjectCreated={(p) => {
              setProjects((prev) => [p, ...prev]);
              setActiveProject(p);
              loadAllLayers(p);
            }}
            activeProject={activeProject}
            onOpenLinkLayers={handleOpenLinkModal}
            onZoomToCollector={handleZoomToCollector}
            onLayerUpdate={() => loadAllLayers(activeProject)}
          />
        )}

        {/* Dynamic Attributes Form for New Feature Capture */}
        {showForm && (
          <div
            className={`fixed sm:absolute left-0 right-0 bottom-0 sm:left-auto sm:right-4 sm:bottom-4 landscape:right-2 landscape:top-2 landscape:bottom-2 landscape:w-80 landscape:left-auto landscape:max-h-[calc(100dvh-16px)] landscape:rounded-xl z-40 w-full sm:w-96 sm:max-w-md ${
              formCollapsed ? 'max-h-12' : 'max-h-[85dvh] sm:max-h-[calc(100%-32px)]'
            } flex flex-col min-h-0 bg-white rounded-t-2xl sm:rounded-xl shadow-2xl border-t sm:border border-slate-300 overflow-hidden animate-slide-up pb-[max(0.75rem,calc(env(safe-area-inset-bottom,0px)+0.5rem))] transition-all`}
          >
            {/* Mobile Grab / Drag Handle Pill & Collapsible Header */}
            <div
              className="w-full flex flex-col items-center py-1 sm:hidden cursor-pointer bg-slate-50 border-b border-slate-200 shrink-0 select-none"
              onClick={() => setFormCollapsed(!formCollapsed)}
            >
              <div className="w-10 h-1 bg-slate-300 rounded-full mb-1" />
              <div className="flex items-center justify-between w-full px-3 text-[11px] font-bold text-gov-blue-900 font-nepali">
                <span className="truncate">नयाँ फिचर फारम (Feature Form)</span>
                {formCollapsed ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
              </div>
            </div>
            {!formCollapsed && (
              <div className="overflow-y-auto flex-1 min-h-0 p-4 sm:p-5 overscroll-contain scrollbar-thin">
                <DynamicFormRenderer
                  schema={activeLayerFormSchema || activeProject?.form_schema || null}
                  initialValues={initialFormAttributes}
                  onSubmit={handleFormSubmit}
                  loading={formSaving}
                  onCancel={() => {
                    if (formSaving) return;
                    setShowForm(false);
                    setEditingGeometry(null);
                    setInitialFormAttributes({});
                    setActiveLayerFormSchema(null);
                  }}
                  title={`नयाँ फिचर प्रविष्टि: ${serverVectors.find((l) => l.id === activeLayerId)?.name || 'भेक्टर तह'} (New Feature)`}
                  hideCustomFields={true}
                />
              </div>
            )}
          </div>
        )}

        {/* Interactive Feature Spatial & Attribute Editor Panel */}
        {selectedFeature && (
          <FeatureEditPanel
            feature={selectedFeature}
            onSave={handleSaveFeature}
            onRevertGeometry={handleFeatureRevert}
            onDelete={handleDeleteFeature}
            onClose={() => setSelectedFeature(null)}
            saving={featureSaving}
            deleting={featureDeleting}
            schema={activeProject?.form_schema || null}
            snappingEnabled={snappingEnabled}
            onToggleSnapping={() => setSnappingEnabled((prev) => !prev)}
            snapTolerance={snapTolerance}
            onChangeSnapTolerance={setSnapTolerance}
            layerAllowsSnapping={isEditLayerSnappingAllowed}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            editSubMode={editSubMode}
            onChangeEditSubMode={setEditSubMode}
            onRemoveLastVertex={handleRemoveLastVertex}
            vectorLayers={serverVectors}
            user={user}
            isAdmin={isAdmin}
            isCollector={isCollector}
          />
        )}

        {/* Non-Edit Mode Feature Attribute Inspector Panel */}
        {inspectedFeature && !editMode && !drawMode && (
          <FeatureDetailsPanel
            feature={inspectedFeature}
            onClose={() => setInspectedFeature(null)}
            onEdit={handleEditInspectedFeature}
            onDelete={handleDeleteFeature}
            deleting={featureDeleting}
            onZoomToFeature={handleZoomToInspectedFeature}
            onInspectLinkedFeature={handleInspectLinkedFeature}
            gpsPosition={gpsPosition}
            isCollector={isCollector}
            user={user}
            isAdmin={isAdmin}
            onFeatureBlocked={handleFeatureBlocked}
          />
        )}

        {/* Vector Layer Feature-to-Feature Linking Modal */}
        <LinkLayersModal
          isOpen={showLinkModal}
          onClose={() => setShowLinkModal(false)}
          vectorLayers={serverVectors}
          initialSourceLayerId={linkModalSourceLayerId}
          onLinkedSuccess={handleLayerLinkedSuccess}
        />

        {/* Layer Edits Inspection Modal */}
        <LayerEditsModal
          isOpen={!!layerEditsModalTarget}
          onClose={() => setLayerEditsModalTarget(null)}
          layer={activeModalLayer}
          onZoomToFeature={handleZoomToLayerEditFeature}
          currentUser={user}
          isAdmin={isAdmin}
        />

        {/* Compulsory GPS Requirement Guard for Data Collectors */}
        <GpsGuardModal
          isCollector={isCollector}
          gpsPosition={gpsPosition}
          gpsError={gpsError}
          isTracking={gpsTracking}
          onRetry={restartGps}
        />

        {/* Post-Save Confirmation Popup: "Saved Successfully" & "Do you want to edit more?" */}
        {showPostSaveModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
            <div
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md max-h-[92dvh] overflow-hidden flex flex-col font-sans animate-scale-up"
              role="dialog"
              aria-modal="true"
            >
              {/* Header Banner */}
              <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-5 flex items-center gap-3.5 shadow-sm">
                <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-xs border border-white/30 flex items-center justify-center shrink-0 shadow-inner">
                  <CheckCircle2 className="w-7 h-7 text-emerald-100" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-bold text-emerald-100 uppercase tracking-wider block font-sans">
                    सफलतापूर्वक सुरक्षित गरियो
                  </span>
                  <h3 className="text-base font-bold font-nepali text-white leading-tight">
                    Saved Successfully
                  </h3>
                  {savedFeatureDetails && (
                    <span className="text-xs text-emerald-100/90 truncate block mt-0.5 font-mono">
                      फिचर #{savedFeatureDetails.id} &middot; {savedFeatureDetails.layerName}
                    </span>
                  )}
                </div>
              </div>

              {/* Body Question Content */}
              <div className="p-5 space-y-3.5 bg-slate-50/50">
                <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs space-y-1 text-center">
                  <p className="text-sm font-bold text-slate-800 font-nepali leading-relaxed">
                    के तपाईं थप सम्पादन गर्न चाहनुहुन्छ?
                  </p>
                  <p className="text-xs text-slate-500 font-semibold font-sans">
                    Do you want to edit more?
                  </p>
                </div>

                <p className="text-[11px] text-slate-600 text-center font-nepali leading-relaxed px-2">
                  सम्पादन जारी राख्न <strong>"हो, थप सम्पादन गर्ने"</strong> रोज्नुहोस् वा सामान्य भ्यू मोडमा फर्कन <strong>"होइन, सम्पादन समाप्त गर्ने"</strong> रोज्नुहोस्।
                </p>

                {/* Two Distinct Choice Options */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  {/* Option 1: Yes, Edit More */}
                  <button
                    type="button"
                    onClick={handleContinueEditing}
                    className="p-3 bg-gov-blue-800 hover:bg-gov-blue-900 active:scale-98 text-white rounded-xl shadow-md shadow-gov-blue-900/20 flex flex-col items-center justify-center gap-1 transition-all border border-gov-blue-900 cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs font-nepali">
                      <Edit3 className="w-3.5 h-3.5 text-gov-gold-300 group-hover:rotate-12 transition-transform" />
                      <span>हो, थप सम्पादन गर्ने</span>
                    </div>
                    <span className="text-[10px] text-gov-blue-200 font-sans">
                      Yes, Edit More
                    </span>
                    <span className="text-[9px] bg-gov-blue-700/80 text-gov-blue-100 px-2 py-0.5 rounded-full mt-0.5">
                      सम्पादन मोड सक्रिय राख्नुहोस्
                    </span>
                  </button>

                  {/* Option 2: No, Finish Editing */}
                  <button
                    type="button"
                    onClick={handleFinishEditing}
                    className="p-3 bg-white hover:bg-slate-100 active:scale-98 text-slate-700 rounded-xl border border-slate-300 shadow-xs flex flex-col items-center justify-center gap-1 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs font-nepali text-slate-800">
                      <Check className="w-3.5 h-3.5 text-emerald-600 group-hover:scale-110 transition-transform" />
                      <span>होइन, सम्पादन समाप्त गर्ने</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-sans">
                      No, Finish Editing
                    </span>
                    <span className="text-[9px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full mt-0.5">
                      सामान्य मोडमा फर्कनुहोस्
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ErrorBoundary>
      <DashboardContent />
    </ErrorBoundary>
  );
}
