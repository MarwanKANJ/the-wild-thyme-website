(function () {
  const apiBase = '/.netlify/functions/content';
  const pendingQueueStorageKey = 'wt_pending_sync_queue_v1';
  let syncState = 'checking';
  let syncMessage = 'Sync: checking';
  let syncBadge = null;
  let isFlushingPendingQueue = false;

  function setSyncStatus(state, message) {
    syncState = state;
    syncMessage = message;

    if (!syncBadge && document.body) {
      syncBadge = document.createElement('div');
      syncBadge.id = 'wt-sync-status';
      syncBadge.setAttribute('role', 'status');
      syncBadge.style.position = 'fixed';
      syncBadge.style.right = '16px';
      syncBadge.style.bottom = '16px';
      syncBadge.style.zIndex = '9999';
      syncBadge.style.padding = '8px 12px';
      syncBadge.style.borderRadius = '9999px';
      syncBadge.style.fontSize = '10px';
      syncBadge.style.letterSpacing = '0.16em';
      syncBadge.style.textTransform = 'uppercase';
      syncBadge.style.fontFamily = 'Inter, sans-serif';
      syncBadge.style.border = '1px solid rgba(255,255,255,0.12)';
      syncBadge.style.backdropFilter = 'blur(12px)';
      syncBadge.style.boxShadow = '0 12px 32px rgba(0,0,0,0.35)';
      document.body.appendChild(syncBadge);
    }

    if (syncBadge) {
      syncBadge.textContent = syncMessage;
      syncBadge.style.background = state === 'online'
        ? 'rgba(16, 185, 129, 0.16)'
        : state === 'offline'
          ? 'rgba(249, 115, 22, 0.18)'
          : 'rgba(255, 255, 255, 0.08)';
      syncBadge.style.color = state === 'online'
        ? '#86efac'
        : state === 'offline'
          ? '#fdba74'
          : '#e5e7eb';
    }
  }

  function ensureBadge() {
    if (syncBadge || !document.body) return;
    setSyncStatus(syncState, syncMessage);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBadge, { once: true });
  } else {
    ensureBadge();
  }

  function readCache(storageKey, fallbackValue) {
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return fallbackValue;
      return JSON.parse(stored);
    } catch (_error) {
      return fallbackValue;
    }
  }

  function writeCache(storageKey, value) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (_error) {
      /* ignore cache errors */
    }
  }

  function normalizeList(items, normalizeItem) {
    return (Array.isArray(items) ? items : []).map((item, index) => normalizeItem(item, index));
  }

  function isMeaningfulObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
  }

  function readPendingQueue() {
    return readCache(pendingQueueStorageKey, {});
  }

  function writePendingQueue(queue) {
    writeCache(pendingQueueStorageKey, queue && typeof queue === 'object' ? queue : {});
  }

  function hasPendingChange(bucket) {
    const queue = readPendingQueue();
    return Boolean(queue && queue[bucket]);
  }

  function enqueuePendingChange(change) {
    const queue = readPendingQueue();
    queue[change.bucket] = {
      bucket: change.bucket,
      storageKey: change.storageKey,
      items: change.items,
      queuedAt: Date.now()
    };
    writePendingQueue(queue);
  }

  function clearPendingChange(bucket) {
    const queue = readPendingQueue();
    if (!queue[bucket]) return;
    delete queue[bucket];
    writePendingQueue(queue);
  }

  async function flushPendingChanges() {
    if (isFlushingPendingQueue) return;

    const queue = readPendingQueue();
    const buckets = Object.keys(queue);
    if (buckets.length === 0) return;

    isFlushingPendingQueue = true;
    try {
      for (const bucket of buckets) {
        const queued = queue[bucket];
        if (!queued || !Array.isArray(queued.items)) continue;

        try {
          await requestContent('PUT', {
            bucket: queued.bucket,
            items: queued.items
          });
          clearPendingChange(bucket);
        } catch (_error) {
          setSyncStatus('offline', 'Sync: local fallback');
        }
      }
    } finally {
      isFlushingPendingQueue = false;
    }
  }

  async function requestContent(method, payload) {
    const url = method === 'GET' && payload && payload.bucket
      ? `${apiBase}?bucket=${encodeURIComponent(payload.bucket)}`
      : apiBase;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: payload && method !== 'GET' ? JSON.stringify(payload) : undefined
    });

    if (!response.ok) {
      setSyncStatus('offline', 'Sync: local fallback');
      throw new Error(`Content sync request failed (${response.status})`);
    }

    setSyncStatus('online', 'Sync: online');

    return response.json();
  }

  async function hydrateList(options) {
    const {
      bucket,
      storageKey,
      seedItems = [],
      normalizeItem = (value) => value
    } = options;

    const cached = readCache(storageKey, []);
    const localItems = Array.isArray(cached) && cached.length > 0 ? normalizeList(cached, normalizeItem) : normalizeList(seedItems, normalizeItem);
    writeCache(storageKey, localItems);

    await flushPendingChanges();
    if (hasPendingChange(bucket)) {
      return localItems;
    }

    try {
      const data = await requestContent('GET', { bucket });
      const remoteItems = Array.isArray(data.items) ? data.items.map((item) => item.payload) : [];

      if (remoteItems.length > 0) {
        const normalizedRemoteItems = normalizeList(remoteItems, normalizeItem);
        writeCache(storageKey, normalizedRemoteItems);
        return normalizedRemoteItems;
      }

      if (localItems.length > 0) {
        await saveList({ bucket, storageKey, items: localItems, normalizeItem });
      }
    } catch (_error) {
      setSyncStatus(navigator.onLine ? 'offline' : 'offline', 'Sync: local fallback');
    }

    return localItems;
  }

  async function saveList(options) {
    const {
      bucket,
      storageKey,
      items,
      normalizeItem = (value) => value
    } = options;

    const normalizedItems = normalizeList(items, normalizeItem);
    writeCache(storageKey, normalizedItems);

    try {
      await requestContent('PUT', {
        bucket,
        items: normalizedItems
      });
      clearPendingChange(bucket);
    } catch (_error) {
      enqueuePendingChange({
        bucket,
        storageKey,
        items: normalizedItems
      });
      setSyncStatus('offline', 'Sync: local fallback');
    }

    return normalizedItems;
  }

  async function hydrateObject(options) {
    const {
      bucket,
      storageKey,
      seedValue = {},
      normalizeValue = (value) => value
    } = options;

    const cached = readCache(storageKey, {});
    const localValue = isMeaningfulObject(cached) ? normalizeValue(cached) : normalizeValue(seedValue);
    writeCache(storageKey, localValue);

    await flushPendingChanges();
    if (hasPendingChange(bucket)) {
      return localValue;
    }

    try {
      const data = await requestContent('GET', { bucket });
      const remoteItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0].payload : null;

      if (isMeaningfulObject(remoteItem)) {
        const normalizedRemoteValue = normalizeValue(remoteItem);
        writeCache(storageKey, normalizedRemoteValue);
        return normalizedRemoteValue;
      }

      if (isMeaningfulObject(localValue)) {
        await saveObject({ bucket, storageKey, value: localValue, normalizeValue });
      }
    } catch (_error) {
      setSyncStatus('offline', 'Sync: local fallback');
    }

    return localValue;
  }

  async function saveObject(options) {
    const {
      bucket,
      storageKey,
      value,
      normalizeValue = (item) => item
    } = options;

    const normalizedValue = normalizeValue(value);
    writeCache(storageKey, normalizedValue);

    try {
      await requestContent('PUT', {
        bucket,
        items: [normalizedValue]
      });
      clearPendingChange(bucket);
    } catch (_error) {
      enqueuePendingChange({
        bucket,
        storageKey,
        items: [normalizedValue]
      });
      setSyncStatus('offline', 'Sync: local fallback');
    }

    return normalizedValue;
  }

  window.WTContentSync = {
    hydrateList,
    saveList,
    hydrateObject,
    saveObject
  };

  window.addEventListener('online', () => {
    flushPendingChanges();
  });

  if (navigator.onLine) {
    flushPendingChanges();
  }
})();