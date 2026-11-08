// Full-screen pressure map with time slider, layer toggles and tap-to-read.

import { grid, createPressureLayer, addBaseLayers, sampleAt, legendGradient, LEGEND_RANGE, PAST_H, FUTURE_H } from '../pressure-layer.js';
import { settings, getLastPlace } from '../store.js';
import { PRESSURE_UNITS, convertPressure, fmtPressure, fmtDelta, fmtWind, compass } from '../units.js';
import { getPosition, coordName } from '../api.js';
import { tendency } from '../analysis.js';
import { esc, icon, toast, placeHref, fmtDateTime } from '../ui.js';

const HOUR = 3600e3;
const LAYER_KEY = 'bpm:maplayers';

export async function render(main, params) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LAYER_KEY)) || {}; } catch { return {}; } })();
  const state = {
    mode: saved.mode || 'pressure',
    isobars: saved.isobars ?? true,
    centers: saved.centers ?? true,
    wind: saved.wind ?? false,
    cities: saved.cities ?? true,
  };
  const persist = () => { try { localStorage.setItem(LAYER_KEY, JSON.stringify(state)); } catch { /* ignore */ } };

  main.innerHTML = `<div class="map-view">
    <div id="pmap" aria-label="Interactive pressure map"></div>
    <div class="map-panel map-layers" role="group" aria-label="Map layers">
      <div class="row">
        <button class="toggle-chip" data-mode="pressure"><span class="dot"></span>Pressure</button>
        <button class="toggle-chip" data-mode="change"><span class="dot"></span>3 h change</button>
        <button class="toggle-chip" data-mode="none"><span class="dot"></span>No colour</button>
      </div>
      <div class="row">
        <button class="toggle-chip" data-toggle="isobars"><span class="dot"></span>Isobars</button>
        <button class="toggle-chip" data-toggle="centers"><span class="dot"></span>H / L</button>
        <button class="toggle-chip" data-toggle="wind"><span class="dot"></span>Wind</button>
        <button class="toggle-chip" data-toggle="cities"><span class="dot"></span>Cities</button>
      </div>
    </div>
    <div class="map-panel map-tools">
      <button type="button" data-locate aria-label="Show my location" title="My location">${icon.locate}</button>
      <button type="button" data-legend aria-label="Toggle legend" title="Legend">${icon.layers}</button>
    </div>
    <div class="map-panel map-status" role="status"><span class="spinner"></span><span class="txt">Loading…</span></div>
    <div class="map-panel map-legend"><div class="lg-title"></div><div class="lg-bar"></div><div class="lg-ticks"></div></div>
    <div class="map-panel map-timebar">
      <button class="play" type="button" aria-label="Play forecast animation">${icon.play}</button>
      <div class="tlabel"><strong class="t-when">–</strong><span class="t-rel muted"></span></div>
      <input type="range" min="0" max="${PAST_H + FUTURE_H}" step="1" value="${PAST_H}" aria-label="Forecast time">
    </div>
  </div>`;

  const last = getLastPlace();
  const lat = Number(params.lat ?? last?.lat ?? 30);
  const lon = Number(params.lon ?? last?.lon ?? 0);
  const z = Number(params.z ?? (params.lat || last ? 5 : 2));

  const map = L.map(main.querySelector('#pmap'), {
    zoomControl: window.innerWidth > 640,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 10,
    zoomSnap: 0.5,
  }).setView([lat, lon], z);
  if (map.zoomControl) map.zoomControl.setPosition('bottomleft');
  const unbase = addBaseLayers(map);
  const layer = createPressureLayer({ ...state, opacity: 0.6 }).addTo(map);

  const statusEl = main.querySelector('.map-status');
  const status = (txt, kind) => {
    if (!txt) { statusEl.classList.remove('show', 'error'); return; }
    statusEl.classList.add('show');
    statusEl.classList.toggle('error', kind === 'error');
    statusEl.querySelector('.spinner').style.display = kind === 'error' ? 'none' : '';
    statusEl.querySelector('.txt').textContent = txt;
  };

  // ----- Time -----
  const slider = main.querySelector('input[type="range"]');
  const nowIndex = () => PAST_H + Math.round((Date.now() - (grid.base + PAST_H * HOUR)) / HOUR);
  let tIndex = params.t != null ? Number(params.t) + PAST_H : nowIndex();
  const setT = (i) => {
    tIndex = Math.max(0, Math.min(PAST_H + FUTURE_H, i));
    slider.value = tIndex;
    layer.setTime(tIndex);
    const t = grid.base + tIndex * HOUR;
    main.querySelector('.t-when').textContent = fmtDateTime(t, undefined);
    const rel = Math.round((t - Date.now()) / HOUR);
    main.querySelector('.t-rel').textContent = Math.abs(rel) < 1 ? 'now' : rel > 0 ? `+${rel} h forecast` : `${rel} h`;
  };
  slider.addEventListener('input', () => { stop(); setT(Number(slider.value)); });

  let playing = null;
  const playBtn = main.querySelector('.play');
  const stop = () => {
    if (!playing) return;
    clearInterval(playing);
    playing = null;
    playBtn.innerHTML = icon.play;
    playBtn.setAttribute('aria-label', 'Play forecast animation');
  };
  playBtn.onclick = () => {
    if (playing) { stop(); return; }
    if (tIndex >= PAST_H + FUTURE_H) setT(0);
    playBtn.innerHTML = icon.pause;
    playBtn.setAttribute('aria-label', 'Pause animation');
    playing = setInterval(() => {
      if (tIndex >= PAST_H + FUTURE_H) { stop(); return; }
      setT(tIndex + 1);
    }, 260);
  };

  // ----- Layers -----
  const syncChips = () => {
    main.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === state.mode));
    main.querySelectorAll('[data-toggle]').forEach((b) => b.setAttribute('aria-pressed', !!state[b.dataset.toggle]));
    renderLegend();
  };
  main.querySelector('.map-layers').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) state.mode = b.dataset.mode;
    if (b.dataset.toggle) state[b.dataset.toggle] = !state[b.dataset.toggle];
    persist();
    syncChips();
    layer.setOptions(state);
  });

  const legendEl = main.querySelector('.map-legend');
  function renderLegend() {
    const unit = settings.pressureUnit;
    const U = PRESSURE_UNITS[unit];
    if (state.mode === 'none') { legendEl.style.visibility = 'hidden'; return; }
    legendEl.style.visibility = '';
    const [lo, hi] = LEGEND_RANGE[state.mode];
    legendEl.querySelector('.lg-title').textContent = state.mode === 'change' ? `3-hour change (${U.label})` : `Sea-level pressure (${U.label})`;
    legendEl.querySelector('.lg-bar').style.background = legendGradient(state.mode);
    const ticks = state.mode === 'change' ? [-6, -3, 0, 3, 6] : [965, 990, 1013, 1036];
    legendEl.querySelector('.lg-ticks').innerHTML = ticks.map((v) => {
      const pos = ((v - lo) / (hi - lo)) * 100;
      const txt = state.mode === 'change' ? fmtDelta(v, unit) : fmtPressure(v, unit, { dp: unit === 'hPa' ? 0 : U.dp });
      return `<span style="position:absolute;left:${pos}%;transform:translateX(-50%)">${txt}</span>`;
    }).join('');
    legendEl.querySelector('.lg-ticks').style.position = 'relative';
    legendEl.querySelector('.lg-ticks').style.height = '14px';
  }
  main.querySelector('[data-legend]').onclick = () => legendEl.classList.toggle('show-sm');

  // ----- Data loading -----
  let ctrl = null;
  let loadSeq = 0;
  const load = async () => {
    ctrl?.abort();
    ctrl = new AbortController();
    const seq = ++loadSeq;
    try {
      const field = await grid.field(map.getBounds().pad(0.2), { signal: ctrl.signal, onStatus: (s) => status(s) });
      if (seq !== loadSeq) return;
      layer.setField(field);
      if (field.error) status(field.have ? `Showing cached data. ${field.error.message}` : field.error.message, 'error');
      else status(null);
    } catch (e) {
      if (e.name !== 'AbortError') status(e.message, 'error');
    }
  };
  const debouncedLoad = debounce(load, 380);
  map.on('moveend', () => {
    debouncedLoad();
    const c = map.getCenter();
    const q = new URLSearchParams({ lat: c.lat.toFixed(3), lon: c.wrap().lng.toFixed(3), z: map.getZoom() });
    history.replaceState(null, '', `#/map?${q}`);
  });

  // ----- Tap to read -----
  map.on('click', (e) => {
    const F = layer.getField();
    if (!F) return;
    const P = F.p[tIndex];
    const v = sampleAt(F, P, e.latlng.lat, e.latlng.lng);
    if (Number.isNaN(v)) return;
    const prev = tIndex >= 3 ? sampleAt(F, F.p[tIndex - 3], e.latlng.lat, e.latlng.lng) : NaN;
    const d3 = Number.isNaN(prev) ? null : v - prev;
    const tend = tendency(d3);
    const ws = sampleAt(F, F.ws[tIndex], e.latlng.lat, e.latlng.lng);
    const unit = settings.pressureUnit;
    const ll = e.latlng.wrap();
    const name = coordName(ll.lat, ll.lng);
    const href = placeHref({ lat: ll.lat, lon: ll.lng, name: '' });
    L.popup({ maxWidth: 260 })
      .setLatLng(e.latlng)
      .setContent(`<div class="map-popup">
        <div class="mp-v">${fmtPressure(v, unit)} <small>${PRESSURE_UNITS[unit].label}</small></div>
        <div class="mp-sub">${esc(name)}<br>${esc(tend.label)}${d3 != null ? ` (${fmtDelta(d3, unit)} / 3 h)` : ''}${Number.isNaN(ws) ? '' : ` · wind ${fmtWind(ws, settings.windUnit)}`}</div>
        <a class="btn btn-primary" href="${href}">Forecast for this spot</a>
      </div>`)
      .openOn(map);
  });

  // ----- Locate -----
  let meMarker = null;
  main.querySelector('[data-locate]').onclick = async () => {
    try {
      status('Finding you…');
      const pos = await getPosition();
      status(null);
      meMarker?.remove();
      meMarker = L.marker([pos.lat, pos.lon], { icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map);
      map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), 6));
    } catch (e) { status(null); toast(e.message, 4000); }
  };

  const onKey = (e) => {
    if (/input|textarea/i.test(document.activeElement.tagName) && document.activeElement !== slider) return;
    if (e.key === 'ArrowRight' && document.activeElement !== slider) { stop(); setT(tIndex + 1); }
    if (e.key === 'ArrowLeft' && document.activeElement !== slider) { stop(); setT(tIndex - 1); }
    if (e.key === ' ' && document.activeElement === document.body) { e.preventDefault(); playBtn.click(); }
  };
  document.addEventListener('keydown', onKey);

  syncChips();
  setT(tIndex);
  load();

  return () => {
    stop();
    ctrl?.abort();
    document.removeEventListener('keydown', onKey);
    unbase();
    map.remove();
  };
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
