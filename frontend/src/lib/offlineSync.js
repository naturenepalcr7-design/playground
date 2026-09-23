'use client';

import { openDB } from 'idb';

/**
 * Offline Sync Engine
 * Stores pending feature edits in IndexedDB when offline.
 * Background sync on reconnect (last-write-wins).
 */

const DB_NAME = 'kmc_gis_offline';
const DB_VERSION = 1;
const STORE_PENDING = 'pending_operations';
const STORE_CACHE = 'feature_cache';

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const pendingStore = db.createObjectStore(STORE_PENDING, {
          keyPath: 'id',
          autoIncrement: true,
        });
        pendingStore.createIndex('timestamp', 'timestamp');
        pendingStore.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        const cacheStore = db.createObjectStore(STORE_CACHE, { keyPath: 'cacheKey' });
        cacheStore.createIndex('layerId', 'layerId');
        cacheStore.createIndex('updatedAt', 'updatedAt');
      }
    },
  });
}

/**
 * Queue a pending operation for later sync.
 */
export async function queueOperation(operation) {
  const db = await getDB();
  const record = {
    ...operation,
    timestamp: Date.now(),
    status: 'pending',
    retries: 0,
  };
  await db.add(STORE_PENDING, record);
  return record;
}

/**
 * Get all pending operations, ordered by timestamp.
 */
export async function getPendingOperations() {
  const db = await getDB();
  return db.getAllFromIndex(STORE_PENDING, 'status', 'pending');
}

/**
 * Mark an operation as synced (or failed).
 */
export async function markOperationSynced(id, success = true) {
  const db = await getDB();
  const tx = db.transaction(STORE_PENDING, 'readwrite');
  const record = await tx.store.get(id);
  if (record) {
    if (success) {
      await tx.store.delete(id);
    } else {
      record.status = 'failed';
      record.retries += 1;
      await tx.store.put(record);
    }
  }
  await tx.done;
}

/**
 * Cache features for offline access.
 */
export async function cacheFeatures(layerId, features) {
  const db = await getDB();
  const tx = db.transaction(STORE_CACHE, 'readwrite');
  const cacheKey = `layer_${layerId}`;
  await tx.store.put({
    cacheKey,
    layerId,
    features,
    updatedAt: Date.now(),
  });
  await tx.done;
}

/**
 * Get cached features for a layer.
 */
export async function getCachedFeatures(layerId) {
  const db = await getDB();
  const cacheKey = `layer_${layerId}`;
  const record = await db.get(STORE_CACHE, cacheKey);
  return record?.features || null;
}

/**
 * Sync all pending operations when online.
 */
export async function syncPendingOperations(apiClient) {
  if (!navigator.onLine) return { synced: 0, failed: 0 };

  const pending = await getPendingOperations();
  let synced = 0;
  let failed = 0;

  for (const op of pending) {
    try {
      switch (op.type) {
        case 'create_feature':
          await apiClient.post('/features', op.data);
          break;
        case 'update_feature':
          await apiClient.put(`/features/${op.featureId}`, op.data);
          break;
        default:
          break;
      }
      await markOperationSynced(op.id, true);
      synced++;
    } catch (error) {
      await markOperationSynced(op.id, false);
      failed++;
      if (op.retries >= 3) {
        // Stop retrying after 3 failures
        const db = await getDB();
        const tx = db.transaction(STORE_PENDING, 'readwrite');
        const record = await tx.store.get(op.id);
        if (record) {
          record.status = 'abandoned';
          await tx.store.put(record);
        }
        await tx.done;
      }
    }
  }

  return { synced, failed };
}

/**
 * Setup background sync listener.
 */
export function setupOnlineSync(apiClient) {
  if (typeof window === 'undefined') return;

  window.addEventListener('online', async () => {
    console.log('[OfflineSync] Back online — syncing pending operations...');
    const result = await syncPendingOperations(apiClient);
    console.log(`[OfflineSync] Synced: ${result.synced}, Failed: ${result.failed}`);
  });
}
