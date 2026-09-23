/**
 * Deterministic color palette and utilities for Multi-Collector Edit Visualization
 */

export const COLLECTOR_PALETTE = [
  {
    id: 'emerald',
    name: 'Emerald (हरियो)',
    hex: '#10b981',
    fill: 'rgba(16, 185, 129, 0.42)',
    stroke: '#059669',
    darkStroke: '#064e3b',
    text: '#065f46',
    bg: '#ecfdf5',
    border: '#a7f3d0',
  },
  {
    id: 'purple',
    name: 'Purple (बैजनी)',
    hex: '#8b5cf6',
    fill: 'rgba(139, 92, 246, 0.42)',
    stroke: '#7c3aed',
    darkStroke: '#4c1d95',
    text: '#5b21b6',
    bg: '#f5f3ff',
    border: '#c4b5fd',
  },
  {
    id: 'amber',
    name: 'Amber (सुन्तला/पहेंलो)',
    hex: '#f59e0b',
    fill: 'rgba(245, 158, 11, 0.42)',
    stroke: '#d97706',
    darkStroke: '#78350f',
    text: '#92400e',
    bg: '#fffbeb',
    border: '#fde68a',
  },
  {
    id: 'cyan',
    name: 'Cyan (नीलो/सियान)',
    hex: '#06b6d4',
    fill: 'rgba(6, 182, 212, 0.42)',
    stroke: '#0891b2',
    darkStroke: '#164e63',
    text: '#155e75',
    bg: '#ecfeff',
    border: '#a5f3fc',
  },
  {
    id: 'rose',
    name: 'Rose (गुलाबी)',
    hex: '#f43f5e',
    fill: 'rgba(244, 63, 94, 0.42)',
    stroke: '#e11d48',
    darkStroke: '#881337',
    text: '#9f1239',
    bg: '#fff1f2',
    border: '#fecdd3',
  },
  {
    id: 'indigo',
    name: 'Indigo (इन्डिगो)',
    hex: '#6366f1',
    fill: 'rgba(99, 102, 241, 0.42)',
    stroke: '#4f46e5',
    darkStroke: '#312e81',
    text: '#3730a3',
    bg: '#eef2ff',
    border: '#c7d2fe',
  },
  {
    id: 'lime',
    name: 'Lime (कागती हरियो)',
    hex: '#84cc16',
    fill: 'rgba(132, 204, 22, 0.42)',
    stroke: '#65a30d',
    darkStroke: '#365314',
    text: '#3f6212',
    bg: '#f7fee7',
    border: '#d9f99d',
  },
  {
    id: 'fuchsia',
    name: 'Fuchsia (गाढा गुलाफी)',
    hex: '#d946ef',
    fill: 'rgba(217, 70, 239, 0.42)',
    stroke: '#c026d3',
    darkStroke: '#701a75',
    text: '#86198f',
    bg: '#fdf4ff',
    border: '#f5d0fe',
  },
  {
    id: 'teal',
    name: 'Teal (टील हरियो)',
    hex: '#14b8a6',
    fill: 'rgba(20, 184, 166, 0.42)',
    stroke: '#0d9488',
    darkStroke: '#134e4a',
    text: '#115e59',
    bg: '#f0fdfa',
    border: '#99f6e4',
  },
  {
    id: 'orange',
    name: 'Orange (गाढा सुन्तला)',
    hex: '#ea580c',
    fill: 'rgba(234, 88, 12, 0.42)',
    stroke: '#c2410c',
    darkStroke: '#7c2d12',
    text: '#9a3412',
    bg: '#fff7ed',
    border: '#fed7aa',
  },
];

/**
 * Deterministically get color for a collector based on their key/username/id
 */
export function getCollectorColor(collectorKey, indexHint = null) {
  if (!collectorKey) {
    return COLLECTOR_PALETTE[0];
  }

  if (typeof indexHint === 'number' && indexHint >= 0) {
    return COLLECTOR_PALETTE[indexHint % COLLECTOR_PALETTE.length];
  }

  const str = String(collectorKey).toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % COLLECTOR_PALETTE.length;
  return COLLECTOR_PALETTE[index];
}

/**
 * Extract editor information from feature properties
 */
export function extractFeatureCollector(properties = {}) {
  const p = properties || {};
  const createdById = p._created_by;
  const updatedById = p._updated_by;
  const createdByUsername = p._created_by_username || '';
  const updatedByUsername = p._updated_by_username || '';
  const createdByName = p._created_by_name || '';
  const updatedByName = p._updated_by_name || '';
  const kmcEditor = p.Kmc_Editor || p.username || '';

  const version = p._version || 1;
  const isUpdated = version > 1 || updatedById != null || p._edit_type === 'update';

  // Primary editor is the updater if updated, else creator, else kmcEditor
  let key = '';
  let username = '';
  let fullName = '';
  let userId = null;

  if (isUpdated && (updatedByUsername || updatedById != null)) {
    key = updatedByUsername || String(updatedById);
    username = updatedByUsername;
    fullName = updatedByName;
    userId = updatedById;
  } else if (createdByUsername || createdById != null) {
    key = createdByUsername || String(createdById);
    username = createdByUsername;
    fullName = createdByName;
    userId = createdById;
  } else if (kmcEditor) {
    key = kmcEditor;
    username = kmcEditor;
    fullName = kmcEditor;
  }

  const hasEdit = !!key;

  return {
    hasEdit,
    key: key.toLowerCase(),
    displayKey: key,
    username,
    fullName: fullName || username || key,
    userId,
    isUpdated,
    version,
    createdById,
    updatedById,
    createdByUsername,
    updatedByUsername,
    kmcEditor,
  };
}
