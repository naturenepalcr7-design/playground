'use client';

import axios from 'axios';

/**
 * KMC-GIS-SERVER API Client
 * Axios instance with JWT interceptor and error handling.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ---- Request Interceptor: Attach JWT ----
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('kmc_access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ---- Response Interceptor: Handle 401 + Token Refresh ----
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Do not attempt token refresh for login or refresh requests
    const isAuthEndpoint = originalRequest?.url?.includes('/auth/login') ||
                           originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem('kmc_refresh_token');
        if (!refreshToken) throw new Error('No refresh token');

        const res = await axios.post(`${API_BASE}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token: newRefresh } = res.data;
        localStorage.setItem('kmc_access_token', access_token);
        localStorage.setItem('kmc_refresh_token', newRefresh);

        processQueue(null, access_token);
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        localStorage.removeItem('kmc_access_token');
        localStorage.removeItem('kmc_refresh_token');
        localStorage.removeItem('kmc_user');
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// ---- Auth API ----
export const authAPI = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  refresh: (refresh_token) => api.post('/auth/refresh', { refresh_token }),
  me: () => api.get('/auth/me'),
};

// ---- Users API ----
export const usersAPI = {
  list: () => api.get('/users'),
  get: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  getProjects: (userId) => api.get(`/users/${userId}/projects`),
};

// ---- Projects API ----
export const projectsAPI = {
  list: () => api.get('/projects'),
  get: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  uploadBoundary: (id, formData) =>
    api.post(`/projects/${id}/boundary/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  generateGrid: (id, data) => api.post(`/projects/${id}/generate-grid`, data),
  getAssignments: (id) => api.get(`/projects/${id}/assignments`),
  assignLayer: (id, layerId) => api.post(`/projects/${id}/assign-layer`, { layer_id: layerId }),
  assignTiles: (id, mbtilesId) => api.post(`/projects/${id}/assign-tiles`, { mbtiles_id: mbtilesId }),
  unassignLayer: (id, layerId) => api.delete(`/projects/${id}/unassign-layer/${layerId}`),
  unassignTiles: (id, mbtilesId) => api.delete(`/projects/${id}/unassign-tiles/${mbtilesId}`),
  getCollectors: (id) => api.get(`/projects/${id}/collectors`),
  assignCollectors: (id, userIds) =>
    api.post(`/projects/${id}/collectors`, { user_ids: Array.isArray(userIds) ? userIds : [userIds] }),
  unassignCollector: (id, userId) => api.delete(`/projects/${id}/collectors/${userId}`),
};

// ---- Tasks API ----
export const tasksAPI = {
  list: (projectId, statusFilter, collectorFilter) => {
    const params = {};
    if (statusFilter && statusFilter !== 'ALL') params.status_filter = statusFilter;
    if (collectorFilter && collectorFilter !== 'ALL') params.collector_filter = collectorFilter;
    return api.get(`/projects/${projectId}/tasks`, { params });
  },
  assign: (projectId, taskIds, userId) =>
    api.post(`/projects/${projectId}/tasks/assign`, { task_ids: Array.isArray(taskIds) ? taskIds : [taskIds], user_id: userId }),
  autoDistribute: (projectId, userIds) =>
    api.post(`/projects/${projectId}/tasks/auto-distribute`, { user_ids: userIds }),
  lock: (taskId, data) => api.post(`/tasks/${taskId}/lock`, data || {}),
  unlock: (taskId) => api.post(`/tasks/${taskId}/unlock`),
  submit: (taskId) => api.post(`/tasks/${taskId}/submit`),
  validate: (taskId, action) => api.post(`/tasks/${taskId}/validate?action=${action}`),
  reset: (projectId) => api.delete(`/projects/${projectId}/tasks/reset`),
};

// ---- Layers API ----
export const layersAPI = {
  listGlobal: () => api.get('/layers'),
  listAll: (params = {}) => api.get('/layers', { params: { all_layers: true, ...params } }),
  listProject: (projectId) => api.get(`/projects/${projectId}/layers`),
  create: (data) => api.post('/layers', data),
  createProject: (projectId, data) => api.post(`/projects/${projectId}/layers`, data),
  update: (id, data) => api.put(`/layers/${id}`, data),
  delete: (id) => api.delete(`/layers/${id}`),
  download: (layerId, format = 'geojson') =>
    api.get(`/layers/${layerId}/download`, {
      params: { format },
      responseType: 'blob',
    }),
  link: (sourceLayerId, data) => api.post(`/layers/${sourceLayerId}/link`, data),
  getRelationships: (layerId) => api.get(`/layers/${layerId}/relationships`),
  getFields: (layerId) => api.get(`/layers/${layerId}/fields`),
  updateFields: (layerId, fields) => api.put(`/layers/${layerId}/fields`, fields),
  upload: (formData, onUploadProgress) => api.post('/layers/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress,
  }),
  getAuditEdits: (layerId, limit = 100) => api.get(`/layers/${layerId}/audit-edits`, { params: { limit } }),
};

// ---- Features API ----
export const featuresAPI = {
  list: (layerId, bbox) => {
    const params = bbox ? { bbox } : {};
    return api.get(`/layers/${layerId}/features`, { params });
  },
  create: (data) => api.post('/features', data),
  update: (id, data) => api.put(`/features/${id}`, data),
  delete: (id) => api.delete(`/features/${id}`),
  getLinked: (featureId) => api.get(`/features/${featureId}/linked`),
  link: (featureId, data) => api.post(`/features/${featureId}/link`, data),
  unlink: (featureId, params) => api.delete(`/features/${featureId}/link`, { params }),
};

// ---- Tiles API ----
export const tilesAPI = {
  listGlobal: () => api.get('/tiles'),
  listAll: (params = {}) => api.get('/tiles', { params: { all_tiles: true, ...params } }),
  listProject: (projectId) => api.get(`/projects/${projectId}/tiles`),
  download: (tileId) =>
    api.get(`/tiles/${tileId}/download`, {
      responseType: 'blob',
    }),
  upload: (formData, onUploadProgress) => api.post('/tiles/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress,
  }),
  uploadProject: (projectId, formData, onUploadProgress) => api.post(`/projects/${projectId}/tiles/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress,
  }),
  delete: (id) => api.delete(`/tiles/${id}`),
};

// ---- Media API ----
export const mediaAPI = {
  upload: (formData) => api.post('/media/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  get: (id) => api.get(`/media/${id}`),
};

// ---- Helper: Trigger Browser Blob File Download ----
export const triggerFileDownload = (response, defaultFilename = 'download') => {
  if (!response || !response.data) return;
  const blob = new Blob([response.data], {
    type: response.headers?.['content-type'] || 'application/octet-stream',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  let filename = defaultFilename;
  const disposition = response.headers?.['content-disposition'];
  if (disposition && disposition.includes('filename=')) {
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) filename = match[1].trim();
  }
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.parentNode.removeChild(link);
  window.URL.revokeObjectURL(url);
};

// ---- Real-Time Tracking API ----
export const trackingAPI = {
  ping: (data) => api.post('/tracking/ping', data),
  setStatus: (data) => api.post('/tracking/status', data),
  sendBeaconStatus: (statusData) => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('kmc_access_token');
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
    const url = `${baseUrl}/tracking/status`;
    const payload = JSON.stringify(statusData);

    // 1. Try fetch with keepalive: true (keeps request alive during unload and supports headers)
    try {
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch (e) {
      // 2. Fallback to navigator.sendBeacon
      try {
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          const beaconUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
          navigator.sendBeacon(beaconUrl, blob);
        }
      } catch (err) {}
    }
  },
  getCollectors: (projectId = null, onlineOnly = false) => {
    const params = {};
    if (projectId) params.project_id = projectId;
    if (onlineOnly) params.online_only = true;
    return api.get('/tracking/collectors', { params });
  },
  getCollectorsGeoJSON: (projectId = null) => {
    const params = {};
    if (projectId) params.project_id = projectId;
    return api.get('/tracking/collectors/geojson', { params });
  },
  getHistory: (userId, limit = 200) =>
    api.get(`/tracking/collectors/${userId}/history`, { params: { limit } }),
};




// ---- Unified House Numbering API (same PostGIS as Field Collection) ----
export const houseNumberingAPI = {
  health: () => api.get('/v1/house-numbering/health'),
  catalog: () => api.get('/v1/house-numbering/catalog'),
  wards: () => api.get('/v1/wards'),
  roads: (params = {}) => api.get('/v1/roads', { params }),
  buildings: (params = {}) => api.get('/v1/buildings', { params }),
  gates: (params = {}) => api.get('/v1/gates', { params }),
  summary: (params = {}) => api.get('/v1/dashboard/summary', { params }),
  search: (q, limit = 50) => api.get('/v1/search', { params: { q: q, limit: limit } }),
  policies: () => api.get('/v1/numbering/policies'),
  assignmentPreview: (data) => api.post('/v1/assignments/preview', data),
  assignmentCommit: (data) => api.post('/v1/assignments/commit', data),
  assignment: (buildingId) => api.get('/v1/assignments/' + buildingId),
  numberingPreview: (data) => api.post('/v1/numbering/preview', data),
  numberingCommit: (runId) => api.post('/v1/numbering/commit', { run_id: runId }),
  runs: (limit = 50) => api.get('/v1/numbering/runs', { params: { limit: limit } }),
  detail: (houseNumberId) => api.get('/v1/numbering/' + houseNumberId),
  updateBuilding: (id, data) => api.patch('/v1/buildings/' + id, data),
  updateRoad: (id, data) => api.patch('/v1/roads/' + id, data),
  updateGate: (id, data) => api.patch('/v1/gates/' + id, data),
  importDryRun: (formData) => api.post('/v1/imports/dry-run', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  }),
  importCommit: (formData) => api.post('/v1/imports', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  }),
  importStatus: (jobId) => api.get('/v1/imports/' + jobId),
  audit: (params = {}) => api.get('/v1/audit', { params }),
  jobStatus: (jobId) => api.get('/v1/jobs/' + jobId),
};
