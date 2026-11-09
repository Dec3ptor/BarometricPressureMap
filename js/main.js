// App shell: hash router, search palette, settings sheet, theme, PWA.

import { settings, updateSettings, onSettingsChange, getRecents, getFavorites, clearRecents, pruneCache } from './store.js';
import { searchPlaces, parseCoords, getPosition, reverseGeocode, coordName } from './api.js';
import { PRESSURE_UNITS } from './units.js';
import { $, $$, esc, toast, placeHref } from './ui.js';
import { adsOn, adSlot, fillAds } from './ads.js';

const routes = {
  '': () => import('./views/home.js'),
  place: () => import('./views/location.js'),
  map: () => import('./views/map.js'),
  world: () => import('./views/world.js'),
  learn: () => import('./views/learn.js'),
  report: () => import('./views/report.js'),
};

const main = $('#main');
let cleanup = null;
let renderToken = 0;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  return { path: path.replace(/\/$/, ''), params: Object.fromEntries(new URLSearchParams(query)) };
}

async function render({ keepScroll = false } = {}) {
  const { path, params } = parseHash();
  const loader = routes[path] || routes[''];
  const token = ++renderToken;
  const navKey = path === 'place' ? '' : (routes[path] ? path : '');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', (a.dataset.nav === 'home' ? '' : a.dataset.nav) === navKey && path !== 'place'));
  document.body.dataset.route = path || 'home';
  const scrollY = window.scrollY;
  try {
    const mod = await loader();
    if (token !== renderToken) return;
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
    cleanup = null;
    main.innerHTML = '';
    cleanup = await mod.render(main, params, { isActive: () => token === renderToken });
    if (keepScroll) window.scrollTo(0, scrollY); else window.scrollTo(0, 0);
    fillAds(document);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="page"><div class="card error-card"><h2>Something went wrong</h2><p>${esc(err.message || err)}</p><a class="btn" href="#/">Back home</a></div></div>`;
  }
}

window.addEventListener('hashchange', () => render());
onSettingsChange((s, patch) => {
  if ('theme' in patch) applyTheme();
  renderSettings();
  if (Object.keys(patch).some((k) => k !== 'theme')) render({ keepScroll: true });
});

// ---------- Theme ----------

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('is-dark', dark);
  window.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
export function isDark() { return document.documentElement.classList.contains('is-dark'); }

// ---------- Search palette ----------

const dlg = $('#search-dialog');
const input = $('#search-input');
const list = $('#search-results');
let searchAbort = null;
let searchTimer = null;
let activeIndex = -1;

function openSearch(prefill = '') {
  input.value = prefill;
  showDefaultResults();
  if (!dlg.open) dlg.showModal();
  setTimeout(() => input.focus(), 30);
}
function closeSearch() { if (dlg.open) dlg.close(); }
window.openSearch = openSearch;

function resultRow(p, i) {
  const code = (p.countryCode || p.region?.split(', ').pop() || '').slice(0, 2).toUpperCase() || '•';
  return `<li role="option" id="sr-${i}" aria-selected="false"><a href="${placeHref(p)}" data-close>
    <span class="sr-flag">${esc(code)}</span>
    <span><span class="sr-name">${esc(p.name)}</span><br><span class="sr-sub">${esc(p.region || '')}${p.population ? ` · ${Intl.NumberFormat(undefined, { notation: 'compact' }).format(p.population)} people` : ''}</span></span>
  </a></li>`;
}

function showDefaultResults() {
  activeIndex = -1;
  const favs = getFavorites();
  const recents = getRecents();
  let html = '';
  let i = 0;
  if (favs.length) html += '<li class="sr-group">Favourites</li>' + favs.map((p) => resultRow(p, i++)).join('');
  if (recents.length) html += '<li class="sr-group">Recent <button type="button" class="btn btn-sm" style="float:right;height:24px;margin-top:-4px" data-clear-recents>Clear</button></li>' + recents.map((p) => resultRow(p, i++)).join('');
  list.innerHTML = html;
}

let searching = false;
let pendingEnter = false;

function goToRow(row) {
  location.hash = row.querySelector('a').getAttribute('href');
  closeSearch();
}

async function runSearch(q) {
  searchAbort?.abort();
  const coords = parseCoords(q);
  if (coords) {
    const p = { ...coords, name: coordName(coords.lat, coords.lon), region: 'Coordinates' };
    list.innerHTML = resultRow(p, 0);
    activeIndex = -1;
    return;
  }
  if (q.trim().length < 2) { showDefaultResults(); return; }
  searchAbort = new AbortController();
  searching = true;
  list.innerHTML = '<li class="sr-group">Searching…</li>';
  try {
    const results = await searchPlaces(q, { signal: searchAbort.signal });
    activeIndex = -1;
    list.innerHTML = results.length
      ? results.map(resultRow).join('')
      : `<li class="sr-group">No places found for “${esc(q)}”</li>`;
    searching = false;
    // Enter was pressed before results arrived: open the top match.
    if (pendingEnter && results.length) goToRow(list.querySelector('li[role="option"]'));
    pendingEnter = false;
  } catch (e) {
    if (e.name !== 'AbortError') { list.innerHTML = `<li class="sr-group">${esc(e.message)}</li>`; searching = false; pendingEnter = false; }
  }
}

input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  pendingEnter = false;
  searching = input.value.trim().length >= 2 && !parseCoords(input.value);
  searchTimer = setTimeout(() => { searchTimer = null; runSearch(input.value); }, 260);
});
input.addEventListener('keydown', (e) => {
  const rows = $$('li[role="option"]', list);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!rows.length) return;
    activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows.forEach((r, i) => r.setAttribute('aria-selected', i === activeIndex));
    rows[activeIndex].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', rows[activeIndex].id);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIndex >= 0 && rows[activeIndex]) { goToRow(rows[activeIndex]); return; }
    // Results for the typed text are still loading: open the top one when ready.
    if (searching) {
      pendingEnter = true;
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; runSearch(input.value); }
      return;
    }
    if (rows[0]) goToRow(rows[0]);
    else runSearch(input.value);
  }
});
list.addEventListener('click', (e) => {
  if (e.target.closest('[data-clear-recents]')) { clearRecents(); showDefaultResults(); return; }
  if (e.target.closest('[data-close]')) closeSearch();
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSearch(); });

export async function locateAndGo(btn) {
  const label = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Finding you…'; }
  try {
    const pos = await getPosition();
    const place = await reverseGeocode(pos.lat, pos.lon);
    closeSearch();
    location.hash = placeHref({ ...pos, name: place.name, region: place.region, here: 1 });
  } catch (e) {
    toast(e.message, 4200);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
  }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const action = a.dataset.action;
  if (action === 'search') openSearch();
  else if (action === 'settings') openSettings();
  else if (action === 'locate') locateAndGo(a);
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/input|textarea|select/i.test(document.activeElement.tagName)) {
    e.preventDefault();
    openSearch();
  }
});

// ---------- Settings ----------

const settingsDlg = $('#settings-dialog');
function seg(name, options, value) {
  return `<div class="segmented" role="group" data-setting="${name}">${options.map(([v, label]) =>
    `<button type="button" data-value="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join('')}</div>`;
}
function renderSettings() {
  const body = $('#settings-body');
  if (!body) return;
  body.innerHTML = `
    <div class="setting"><span class="setting-label">Pressure unit</span>
      ${seg('pressureUnit', Object.keys(PRESSURE_UNITS).map((k) => [k, PRESSURE_UNITS[k].label]), settings.pressureUnit)}
      <p class="setting-help">${esc(PRESSURE_UNITS[settings.pressureUnit].name)}. 1 hPa is exactly 1 millibar.</p></div>
    <div class="setting"><span class="setting-label">Pressure reading</span>
      ${seg('pressureMode', [['msl', 'Sea level'], ['station', 'Station (actual)']], settings.pressureMode)}
      <p class="setting-help">Sea-level pressure is what weather maps and forecasts use. Station pressure is the actual air pressure at the ground, which drops with altitude. It's useful if you're comparing against a home barometer that hasn't been calibrated.</p></div>
    <div class="setting"><span class="setting-label">Temperature</span>${seg('tempUnit', [['C', '°C'], ['F', '°F']], settings.tempUnit)}</div>
    <div class="setting"><span class="setting-label">Wind speed</span>${seg('windUnit', [['kmh', 'km/h'], ['mph', 'mph'], ['ms', 'm/s'], ['kn', 'knots']], settings.windUnit)}</div>
    <div class="setting"><span class="setting-label">Rainfall</span>${seg('precipUnit', [['mm', 'mm'], ['in', 'inches']], settings.precipUnit)}</div>
    <div class="setting"><span class="setting-label">Clock</span>${seg('hour12', [['false', '24-hour'], ['true', '12-hour']], settings.hour12)}</div>
    <div class="setting"><span class="setting-label">Theme</span>${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], settings.theme)}</div>
    <div class="setting"><p class="setting-help" style="margin:0">Settings, favourites and recent places are stored only in this browser. <a href="privacy.html">Privacy policy</a></p></div>`;
}
function openSettings() {
  renderSettings();
  settingsDlg.showModal();
}
settingsDlg.addEventListener('click', (e) => {
  if (e.target === settingsDlg) { settingsDlg.close(); return; }
  const btn = e.target.closest('.segmented button');
  if (!btn) return;
  const name = btn.parentElement.dataset.setting;
  let value = btn.dataset.value;
  if (name === 'hour12') value = value === 'true';
  updateSettings({ [name]: value });
});

// ---------- PWA ----------

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  window.dispatchEvent(new Event('installavailable'));
});
export function canInstall() { return !!deferredInstall; }
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  return outcome === 'accepted';
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ---------- Ads ----------

if (adsOn()) {
  document.body.classList.add('ads-on');
  $$('.ad-side').forEach((el) => { el.innerHTML = adSlot('rail'); });
  // Slots that only appear at some widths are filled when they become visible.
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => fillAds(document), 400); });
}

// ---------- Boot ----------

applyTheme();
pruneCache();
render();
