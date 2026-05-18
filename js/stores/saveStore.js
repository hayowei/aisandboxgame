// ============================================
// Save Store - 存档槽位 IndexedDB 封装
// 对标 backgroundImageStore.js；配额远高于 localStorage（通常 50MB+）
// key 沿用 saveManager 既有格式 `ai_adventure_save_world_{worldCardId}_slot_{N}`
// value 直接存对象（IDB 原生 structured clone，不用 JSON 字符串）
// ============================================

(function () {
  const DB_NAME = 'ai_adventure_save_store';
  const DB_VERSION = 1;
  const STORE_SAVES = 'saves';
  const STORE_META = 'meta';

  let _dbPromise = null;
  let _available = typeof indexedDB !== 'undefined';

  function _openDB() {
    if (!_available) return Promise.reject(new Error('IndexedDB not available'));
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        _available = false;
        reject(e);
        return;
      }
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_SAVES)) {
          db.createObjectStore(STORE_SAVES);
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        _dbPromise = null;
        _available = false;
        reject(req.error);
      };
      req.onblocked = () => {
        console.warn('[SaveStore] IDB open blocked (other tab holding older version)');
      };
    });
    return _dbPromise;
  }

  function _tx(store, mode) {
    return _openDB().then(db => {
      const tx = db.transaction(store, mode);
      return { tx, store: tx.objectStore(store) };
    });
  }

  async function getSave(key) {
    const { tx, store } = await _tx(STORE_SAVES, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function putSave(key, value) {
    const { tx, store } = await _tx(STORE_SAVES, 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        store.put(value, key);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }

  async function deleteSave(key) {
    const { tx, store } = await _tx(STORE_SAVES, 'readwrite');
    return new Promise((resolve, reject) => {
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function listKeys(prefix) {
    const { tx, store } = await _tx(STORE_SAVES, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const all = Array.isArray(req.result) ? req.result : [];
        resolve(
          typeof prefix === 'string' && prefix
            ? all.filter(k => typeof k === 'string' && k.startsWith(prefix))
            : all
        );
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getMeta(key) {
    const { tx, store } = await _tx(STORE_META, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function putMeta(key, value) {
    const { tx, store } = await _tx(STORE_META, 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        store.put(value, key);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }

  async function deleteMeta(key) {
    const { tx, store } = await _tx(STORE_META, 'readwrite');
    return new Promise((resolve, reject) => {
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function isAvailable() {
    return _available;
  }

  async function probe() {
    if (!_available) return false;
    try {
      await _openDB();
      return true;
    } catch (_e) {
      return false;
    }
  }

  // 请求持久化（iOS Safari 低磁盘时减少被驱逐的风险）
  try {
    if (navigator?.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch (_) { /* ignore */ }

  window.saveStore = {
    getSave,
    putSave,
    deleteSave,
    listKeys,
    getMeta,
    putMeta,
    deleteMeta,
    isAvailable,
    probe,
  };
})();
