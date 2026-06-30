// ============================================
// World Card Store - 世界卡 IndexedDB 封装
// 对标 saveStore.js；配额远高于 localStorage（通常 50MB+）
// stores: cards（key=cardId → 整卡对象，IDB 原生 structured clone，不用 JSON 字符串）
//         meta （key → value，存 index 数组 / active 指针 / 迁移 flag）
// 读源由 worldCardManager 内存缓存承担，本封装只管持久化；公开 API 与 saveStore 同形。
// ============================================

(function () {
  const DB_NAME = 'ai_adventure_worldcard_store';
  const DB_VERSION = 1;
  const STORE_CARDS = 'cards';
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
        if (!db.objectStoreNames.contains(STORE_CARDS)) {
          db.createObjectStore(STORE_CARDS);
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // iOS Safari 挂机/退后台会主动关掉 IDB 连接。连接关闭后作废缓存,
        // 下次操作经 _openDB 自动重开,避免在死连接上反复抛 "connection is closing"。
        db.onclose = () => { _dbPromise = null; };
        db.onversionchange = () => {
          try { db.close(); } catch (_) { /* ignore */ }
          _dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        _dbPromise = null;
        _available = false;
        reject(req.error);
      };
      req.onblocked = () => {
        console.warn('[WorldCardStore] IDB open blocked (other tab holding older version)');
      };
    });
    return _dbPromise;
  }

  function _tx(store, mode, _retried) {
    return _openDB().then(db => {
      try {
        const tx = db.transaction(store, mode);
        return { tx, store: tx.objectStore(store) };
      } catch (e) {
        // 缓存的连接已被系统关闭(死连接)→ 作废缓存,重开一次再试
        if (!_retried && e && (e.name === 'InvalidStateError' || /closing/i.test(e.message || ''))) {
          _dbPromise = null;
          return _tx(store, mode, true);
        }
        throw e;
      }
    });
  }

  async function getCard(id) {
    const { tx, store } = await _tx(STORE_CARDS, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function putCard(id, value) {
    const { tx, store } = await _tx(STORE_CARDS, 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        store.put(value, id);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }

  async function deleteCard(id) {
    const { tx, store } = await _tx(STORE_CARDS, 'readwrite');
    return new Promise((resolve, reject) => {
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllCards() {
    const { tx, store } = await _tx(STORE_CARDS, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
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

  window.worldCardStore = {
    getCard,
    putCard,
    deleteCard,
    getAllCards,
    getMeta,
    putMeta,
    deleteMeta,
    isAvailable,
    probe,
  };
})();
