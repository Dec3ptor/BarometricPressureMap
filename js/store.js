// Small persistence layer: settings, favourites and recent places live in
// localStorage on this device only. Nothing is sent anywhere.

import { localeDefaults } from './units.js';

const KEY_SETTINGS = 'bpm:settings';
const KEY_FAVS = 'bpm:favorites';
const KEY_RECENTS = 'bpm:recents';
const KEY_LAST = 'bpm:last';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

const listeners = new Set();

export const settings = {
  theme: 'auto',
  pressureMode: 'msl', // 'msl' (sea level) or 'station' (surface)
  ...localeDefaults(),
  ...read(KEY_SETTINGS, {}),
};

export function updateSettings(patch) {
  Object.assign(settings, patch);
  write(KEY_SETTINGS, settings);
  listeners.forEach((fn) => fn(settings, patch));
}
export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A place: { lat, lon, name, region }
export function placeKey(p) {
  return `${Number(p.lat).toFixed(3)},${Number(p.lon).toFixed(3)}`;
}

export function getFavorites() { return read(KEY_FAVS, []); }
export function isFavorite(p) { return getFavorites().some((f) => placeKey(f) === placeKey(p)); }
export function toggleFavorite(p) {
  const favs = getFavorites();
  const i = favs.findIndex((f) => placeKey(f) === placeKey(p));
  if (i >= 0) favs.splice(i, 1);
  else favs.push({ lat: +p.lat, lon: +p.lon, name: p.name, region: p.region || '' });
  write(KEY_FAVS, favs);
  return i < 0;
}

export function getRecents() { return read(KEY_RECENTS, []); }
export function addRecent(p) {
  const list = getRecents().filter((r) => placeKey(r) !== placeKey(p));
  list.unshift({ lat: +p.lat, lon: +p.lon, name: p.name, region: p.region || '' });
  write(KEY_RECENTS, list.slice(0, 8));
}
export function clearRecents() { write(KEY_RECENTS, []); }

export function getLastPlace() { return read(KEY_LAST, null); }
export function setLastPlace(p) { write(KEY_LAST, { lat: +p.lat, lon: +p.lon, name: p.name, region: p.region || '' }); }

// Short-lived cache for API responses.
export function cacheGet(key, maxAgeMs) {
  const hit = read('bpm:c:' + key, null);
  if (!hit || Date.now() - hit.t > maxAgeMs) return null;
  return hit.v;
}
export function cacheSet(key, value) {
  try {
    localStorage.setItem('bpm:c:' + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    // Probably over quota: drop old cache entries and try once more.
    pruneCache(0);
    try { localStorage.setItem('bpm:c:' + key, JSON.stringify({ t: Date.now(), v: value })); } catch { /* give up */ }
  }
}
export function pruneCache(maxAgeMs = 6 * 3600e3) {
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('bpm:c:')) continue;
      try {
        const { t } = JSON.parse(localStorage.getItem(k));
        if (now - t > maxAgeMs) localStorage.removeItem(k);
      } catch { localStorage.removeItem(k); }
    }
  } catch { /* ignore */ }
}

// Minimal IndexedDB key/value store, used for the bulky map grid cache.
let dbPromise;
function db() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('no idb'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('bpm', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
export async function idbGet(key) {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch { return undefined; }
}
export async function idbSet(key, value) {
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}
