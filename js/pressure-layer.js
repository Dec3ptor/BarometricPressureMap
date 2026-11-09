// Pressure map engine.
//
// GridSource fetches sea-level pressure + wind for a lattice of points that
// covers the visible map (via Open-Meteo's multi-location API), caches the
// points in IndexedDB and assembles a time-indexed field.
//
// PressureLayer is a Leaflet layer that renders that field on a canvas:
// colour shading, smooth isobars with labels, H/L centres, wind arrows and
// city readings.

import { fetchMulti } from './api.js';
import { idbGet, idbSet, settings } from './store.js';
import { PRESSURE_UNITS, convertPressure } from './units.js';
import { CITIES } from './cities.js';

const HOUR = 3600e3;
export const PAST_H = 24;
export const FUTURE_H = 72;
const MAX_POINTS = 48;
const FRESH_MS = 60 * 60e3;
// Grid spacings in degrees. All divide 90, so rows never fall outside ±90°.
const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4.5, 5, 6, 7.5, 9, 10, 15, 18, 22.5, 30, 45];
// Only pressure is drawn on the preview maps; each grid point is one API call.
const VARS = ['pressure_msl'];

const floorHour = (t) => Math.floor(t / HOUR) * HOUR;
const normLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const keyOf = (lat, lon) => `${lat.toFixed(2)},${normLon(lon).toFixed(2)}`;

// ---------------------------------------------------------------------------
// Colour maps

const P_STOPS = [
  [950, [84, 16, 74]], [970, [140, 24, 58]], [985, [198, 56, 54]], [997, [236, 132, 92]],
  [1006, [248, 205, 160]], [1013, [242, 238, 230]], [1019, [196, 222, 236]], [1026, [128, 184, 220]],
  [1034, [64, 132, 196]], [1044, [30, 78, 158]], [1056, [22, 38, 102]],
];
const C_STOPS = [
  [-8, [150, 20, 60]], [-4, [226, 78, 72]], [-1.5, [250, 186, 150]], [0, [238, 238, 238]],
  [1.5, [170, 208, 238]], [4, [70, 140, 216]], [8, [28, 62, 160]],
];

function lerpStops(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t));
    }
  }
  return stops[stops.length - 1][1];
}
function buildLut(stops, lo, hi, res) {
  const n = Math.round((hi - lo) / res) + 1;
  const lut = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) lut.set(lerpStops(stops, lo + i * res), i * 3);
  return { lut, lo, res, n };
}
const P_LUT = buildLut(P_STOPS, 940, 1066, 0.25);
const C_LUT = buildLut(C_STOPS, -10, 10, 0.05);
function lutColor({ lut, lo, res, n }, v) {
  let i = Math.round((v - lo) / res);
  if (i < 0) i = 0; else if (i >= n) i = n - 1;
  return i * 3;
}
export function pressureColor(v) {
  const o = lutColor(P_LUT, v);
  return `rgb(${P_LUT.lut[o]},${P_LUT.lut[o + 1]},${P_LUT.lut[o + 2]})`;
}
export function legendGradient(mode) {
  const stops = mode === 'change' ? C_STOPS : P_STOPS;
  const lo = stops[0][0], hi = stops[stops.length - 1][0];
  return `linear-gradient(90deg, ${stops.map(([v, c]) => `rgb(${c}) ${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(', ')})`;
}
export const LEGEND_RANGE = { pressure: [950, 1056], change: [-8, 8] };

// ---------------------------------------------------------------------------
// Data: lattice, cache and field

export class GridSource {
  constructor() {
    this.cache = new Map();
    this.ready = this._load();
    this._saveTimer = null;
    this.base = floorHour(Date.now()) - PAST_H * HOUR;
    this.nt = PAST_H + FUTURE_H + 1;
  }

  async _load() {
    const stored = await idbGet('grid-v1');
    if (stored && Array.isArray(stored)) {
      const cutoff = Date.now() - 6 * HOUR;
      stored.forEach((e) => { if (e.fetchedAt > cutoff) this.cache.set(e.k, e); });
    }
  }

  _persist() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      const entries = [...this.cache.values()].sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, 2500);
      idbSet('grid-v1', entries);
    }, 1500);
  }

  // Choose a lattice for the (padded) bounds.
  lattice(bounds, maxPoints = MAX_POINTS) {
    const s = Math.max(-84, bounds.getSouth());
    const n = Math.min(84, bounds.getNorth());
    const w = bounds.getWest();
    const e = bounds.getEast();
    for (const step of STEPS) {
      const j0 = Math.max(Math.floor(s / step), -Math.round(90 / step));
      const j1 = Math.min(Math.ceil(n / step), Math.round(90 / step));
      const i0 = Math.floor(w / step), i1 = Math.ceil(e / step);
      const nx = Math.min(i1 - i0 + 1, Math.round(360 / step));
      const ny = j1 - j0 + 1;
      if (nx * ny <= maxPoints || step === STEPS[STEPS.length - 1]) {
        return { step, lat0: j0 * step, lon0: i0 * step, nx, ny, wrap: nx * step >= 360 - 1e-9 };
      }
    }
  }

  async field(bounds, { signal, maxPoints, onStatus } = {}) {
    await this.ready;
    this.base = floorHour(Date.now()) - PAST_H * HOUR;
    const L = this.lattice(bounds, maxPoints);
    const now = Date.now();
    const pts = [];
    for (let j = 0; j < L.ny; j++) {
      for (let i = 0; i < L.nx; i++) {
        const lat = +(L.lat0 + j * L.step).toFixed(3);
        const lon = +(L.lon0 + i * L.step).toFixed(3);
        pts.push({ lat, lon, k: keyOf(lat, lon) });
      }
    }
    const missing = [];
    const seen = new Set();
    for (const p of pts) {
      const e = this.cache.get(p.k);
      if ((!e || now - e.fetchedAt > FRESH_MS) && !seen.has(p.k)) {
        seen.add(p.k);
        missing.push({ lat: p.lat, lon: normLon(p.lon), k: p.k });
      }
    }
    let error = null;
    if (missing.length) {
      onStatus?.(`Loading ${missing.length} pressure points…`);
      try {
        const res = await fetchMulti(missing, { vars: VARS, pastHours: PAST_H, forecastHours: FUTURE_H + 1, signal });
        const t = Date.now();
        res.forEach((r, idx) => {
          const m = missing[idx];
          if (!m || !r.time.length) return;
          this.cache.set(m.k, {
            k: m.k,
            t0: r.time[0],
            p: Float32Array.from(r.series.pressure_msl, (v) => (v == null ? NaN : v)),
            ws: Float32Array.from(r.series.wind_speed_10m || [], (v) => (v == null ? NaN : v)),
            wd: Float32Array.from(r.series.wind_direction_10m || [], (v) => (v == null ? NaN : v)),
            fetchedAt: t,
          });
        });
        this._persist();
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        error = e;
      }
    }
    return this._assemble(L, pts, error);
  }

  _assemble(L, pts, error) {
    const { nx, ny } = L;
    const nt = this.nt;
    const p = [], ws = [], wd = [];
    for (let t = 0; t < nt; t++) {
      p.push(new Float32Array(nx * ny).fill(NaN));
      ws.push(new Float32Array(nx * ny).fill(NaN));
      wd.push(new Float32Array(nx * ny).fill(NaN));
    }
    let have = 0;
    pts.forEach((pt, idx) => {
      const e = this.cache.get(pt.k);
      if (!e) return;
      have++;
      const off = Math.round((this.base - e.t0) / HOUR);
      for (let t = 0; t < nt; t++) {
        const s = off + t;
        if (s < 0 || s >= e.p.length) continue;
        p[t][idx] = e.p[s];
        ws[t][idx] = e.ws[s];
        wd[t][idx] = e.wd[s];
      }
    });
    const times = Array.from({ length: nt }, (_, t) => this.base + t * HOUR);
    return { ...L, nt, times, p, ws, wd, error, complete: have === pts.length, have, total: pts.length };
  }
}

export const grid = new GridSource();

// Sample a lattice field (Catmull-Rom, falling back to bilinear near gaps).
function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
const mod = (a, n) => ((a % n) + n) % n;

export function sampleField(F, arr, fx, fy) {
  const { nx, ny, wrap } = F;
  if (nx < 2 || ny < 2) return arr[0];
  if (wrap) fx = mod(fx, nx);
  if (fy < 0 || fy > ny - 1 || fx < 0 || (!wrap && fx > nx - 1)) return NaN;
  // A globe-wrapping lattice has a cell between its last and first column.
  const i = wrap ? Math.floor(fx) : Math.min(Math.floor(fx), nx - 2);
  const j = Math.min(Math.floor(fy), ny - 2);
  const tx = fx - i, ty = fy - j;
  const col = wrap ? (ii) => mod(ii, nx) : (ii) => Math.max(0, Math.min(nx - 1, ii));
  const g = (ii, jj) => arr[Math.max(0, Math.min(ny - 1, jj)) * nx + col(ii)];
  const r = [];
  let ok = true;
  for (let m = -1; m <= 2 && ok; m++) {
    const a = g(i - 1, j + m), b = g(i, j + m), c = g(i + 1, j + m), d = g(i + 2, j + m);
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) ok = false;
    else r.push(cr(a, b, c, d, tx));
  }
  if (ok) return cr(r[0], r[1], r[2], r[3], ty);
  const a = g(i, j), b = g(i + 1, j), c = g(i, j + 1), d = g(i + 1, j + 1);
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) {
    // Nearest neighbour as a last resort.
    return g(Math.round(fx), Math.round(fy));
  }
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
export function sampleAt(F, arr, lat, lon) {
  return sampleField(F, arr, lonToX(F, lon), (lat - F.lat0) / F.step);
}

// Fractional lattice column for a longitude, allowing for world copies.
function lonToX(F, lon) {
  let x = (lon - F.lon0) / F.step;
  const span = 360 / F.step;
  if (F.wrap) return mod(x, F.nx);
  while (x < 0 && x + span <= F.nx - 1) x += span;
  while (x > F.nx - 1 && x - span >= 0) x -= span;
  return x;
}

// Isobar interval in hPa, picked as a round number in the display unit.
export function isobarLevels(minHpa, maxHpa, unit, dense) {
  const per = {
    hPa: dense ? 2 : 4, inHg: dense ? 0.05 : 0.1, mmHg: dense ? 1.5 : 3, kPa: dense ? 0.2 : 0.4,
    psi: dense ? 0.025 : 0.05, atm: dense ? 0.002 : 0.004,
  }[unit] || 4;
  const f = PRESSURE_UNITS[unit].factor;
  const lo = Math.ceil((minHpa * f) / per) * per;
  const out = [];
  for (let v = lo; v <= maxHpa * f + 1e-9 && out.length < 80; v += per) {
    const r = +v.toFixed(4);
    out.push({ hpa: r / f, label: r.toFixed(unit === 'hPa' ? 0 : unit === 'mmHg' ? (dense ? 1 : 0) : PRESSURE_UNITS[unit].dp), major: Math.abs((r / (per * 5)) - Math.round(r / (per * 5))) < 1e-6 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Leaflet layer

export function createPressureLayer(opts = {}) {
  return new (L.Layer.extend({
    options: {
      mode: 'pressure', // 'pressure' | 'change' | 'none'
      isobars: true,
      centers: true,
      wind: false,
      cities: false,
      sample: 4,
      opacity: 0.62,
      ...opts,
    },

    initialize(options) { L.setOptions(this, options); this._field = null; this._t = PAST_H; },

    onAdd(map) {
      this._map = map;
      // Colour shading sits under the basemap labels; isobars, H/L, wind and
      // city readings sit above them so they stay legible.
      for (const [name, z] of [['pressure', 350], ['pressureTop', 460]]) {
        if (!map.getPane(name)) {
          map.createPane(name);
          map.getPane(name).style.zIndex = z;
          map.getPane(name).style.pointerEvents = 'none';
          map.getPane(name).classList.add('leaflet-pressure-pane');
          if (name === 'pressure') map.getPane(name).classList.add('leaflet-shade-pane');
        }
      }
      this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated');
      this._canvasTop = L.DomUtil.create('canvas', 'leaflet-zoom-animated');
      map.getPane('pressure').appendChild(this._canvas);
      map.getPane('pressureTop').appendChild(this._canvasTop);
      map.on('moveend zoomend resize viewreset', this._redraw, this);
      map.on('zoomanim', this._animateZoom, this);
      this._redraw();
    },

    onRemove(map) {
      L.DomUtil.remove(this._canvas);
      L.DomUtil.remove(this._canvasTop);
      map.off('moveend zoomend resize viewreset', this._redraw, this);
      map.off('zoomanim', this._animateZoom, this);
    },

    setField(field) { this._field = field; this._redraw(); },
    setTime(t) { this._t = t; this._redraw(); },
    setOptions(o) { L.setOptions(this, o); this._redraw(); },
    getField() { return this._field; },

    _animateZoom(e) {
      if (!this._topLeft) return;
      const scale = this._map.getZoomScale(e.zoom);
      const offset = this._map._latLngToNewLayerPoint(this._topLeft, e.zoom, e.center);
      L.DomUtil.setTransform(this._canvas, offset, scale);
      L.DomUtil.setTransform(this._canvasTop, offset, scale);
    },

    _redraw() {
      if (!this._map) return;
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._draw());
    },

    _draw() {
      const map = this._map;
      if (!map) return;
      const size = map.getSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      this._topLeft = map.containerPointToLatLng([0, 0]);
      const prep = (cv) => {
        if (cv.width !== size.x * dpr || cv.height !== size.y * dpr) {
          cv.width = size.x * dpr;
          cv.height = size.y * dpr;
          cv.style.width = size.x + 'px';
          cv.style.height = size.y + 'px';
        }
        L.DomUtil.setPosition(cv, topLeft);
        const c = cv.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, size.x, size.y);
        return c;
      };
      const shade = prep(this._canvas);
      const ctx = prep(this._canvasTop);
      const F = this._field;
      if (!F) return;
      const t = Math.max(0, Math.min(F.nt - 1, this._t));
      const P = F.p[t];
      const o = this.options;
      const dark = document.documentElement.classList.contains('is-dark');

      // Sample the field on a coarse screen grid.
      const S = o.sample;
      const cols = Math.ceil(size.x / S) + 1;
      const rows = Math.ceil(size.y / S) + 1;
      const fxs = new Float32Array(cols);
      const fys = new Float32Array(rows);
      for (let c = 0; c < cols; c++) fxs[c] = lonToX(F, map.containerPointToLatLng([c * S, 0]).lng);
      for (let r = 0; r < rows; r++) fys[r] = (map.containerPointToLatLng([0, r * S]).lat - F.lat0) / F.step;
      const vals = new Float32Array(cols * rows);
      let vmin = Infinity, vmax = -Infinity;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = sampleField(F, P, fxs[c], fys[r]);
          vals[r * cols + c] = v;
          if (v < vmin) vmin = v;
          if (v > vmax) vmax = v;
        }
      }
      this._lastSample = { vals, cols, rows, S };

      // 1. Colour shading
      if (o.mode !== 'none') {
        const img = new ImageData(cols, rows);
        const d = img.data;
        let prev = null;
        if (o.mode === 'change') prev = F.p[Math.max(0, t - 3)];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            let v = vals[idx];
            if (Number.isNaN(v)) continue;
            let off, a;
            if (o.mode === 'change') {
              const pv = sampleField(F, prev, fxs[c], fys[r]);
              if (Number.isNaN(pv) || t < 3) continue;
              v -= pv;
              off = lutColor(C_LUT, v);
              a = 0.12 + 0.62 * Math.min(1, Math.abs(v) / 4);
              d[idx * 4] = C_LUT.lut[off]; d[idx * 4 + 1] = C_LUT.lut[off + 1]; d[idx * 4 + 2] = C_LUT.lut[off + 2];
            } else {
              off = lutColor(P_LUT, v);
              a = o.opacity;
              d[idx * 4] = P_LUT.lut[off]; d[idx * 4 + 1] = P_LUT.lut[off + 1]; d[idx * 4 + 2] = P_LUT.lut[off + 2];
            }
            d[idx * 4 + 3] = Math.round(a * 255);
          }
        }
        this._offCanvas ??= document.createElement('canvas');
        const off = this._offCanvas;
        off.width = cols; off.height = rows;
        off.getContext('2d').putImageData(img, 0, 0);
        shade.imageSmoothingEnabled = true;
        shade.imageSmoothingQuality = 'high';
        shade.drawImage(off, 0, 0, cols, rows, 0, 0, cols * S, rows * S);
      }

      const ink = dark ? 'rgba(235,240,250,0.82)' : 'rgba(20,28,45,0.72)';
      const halo = dark ? 'rgba(10,15,28,0.85)' : 'rgba(255,255,255,0.9)';

      // 2. Isobars
      if (o.isobars && Number.isFinite(vmin)) {
        const dense = vmax - vmin < 14 || map.getZoom() >= 7;
        const levels = isobarLevels(vmin, vmax, settings.pressureUnit, dense);
        const labels = [];
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const lv of levels) {
          const segs = marchingSquares(vals, cols, rows, lv.hpa, S);
          if (!segs.length) continue;
          ctx.beginPath();
          for (let k = 0; k < segs.length; k += 4) {
            ctx.moveTo(segs[k], segs[k + 1]);
            ctx.lineTo(segs[k + 2], segs[k + 3]);
          }
          ctx.strokeStyle = ink;
          ctx.lineWidth = lv.major ? 1.9 : 1.1;
          ctx.stroke();
          // Label candidates spaced along the line.
          for (let k = 0; k < segs.length; k += 4 * 9) {
            const x = (segs[k] + segs[k + 2]) / 2, y = (segs[k + 1] + segs[k + 3]) / 2;
            if (x < 30 || y < 20 || x > size.x - 30 || y > size.y - 20) continue;
            if (labels.some((l) => (l.x - x) ** 2 + (l.y - y) ** 2 < (l.label === lv.label ? 220 : 70) ** 2)) continue;
            labels.push({ x, y, label: lv.label, ang: Math.atan2(segs[k + 3] - segs[k + 1], segs[k + 2] - segs[k]) });
            if (labels.length > 60) break;
          }
        }
        ctx.font = '600 10.5px InterVariable, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const l of labels) {
          let a = l.ang;
          if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
          ctx.save();
          ctx.translate(l.x, l.y);
          ctx.rotate(a);
          const w = ctx.measureText(l.label).width + 8;
          ctx.fillStyle = halo;
          roundRect(ctx, -w / 2, -7.5, w, 15, 7.5);
          ctx.fill();
          ctx.fillStyle = ink;
          ctx.fillText(l.label, 0, 0.5);
          ctx.restore();
        }
      }

      // 3. Wind arrows
      if (o.wind) drawWind(ctx, map, F, t, size, dark);

      // 4. City readings (kept clear of H/L centres), then 5. highs and lows
      const centers = o.centers ? findCenters(map, F, P, size) : [];
      if (o.cities) drawCities(ctx, map, F, P, size, dark, halo, centers);
      drawCenters(ctx, centers, dark, halo);

      // Let the page know what's on screen (highs and lows found).
      const allCenters = o.centers ? centers : findCenters(map, F, P, size);
      this.fire('drawn', {
        t,
        time: F.times[t],
        centers: allCenters.map((c) => ({ type: c.type, v: c.v, latlng: map.containerPointToLatLng([c.x, c.y]) })),
      });
    },
  }))(opts);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Marching squares → flat array of line segments [x1,y1,x2,y2,...].
function marchingSquares(v, cols, rows, L, S) {
  const out = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      const a = v[i], b = v[i + 1], cc = v[i + cols + 1], d = v[i + cols];
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(cc) || Number.isNaN(d)) continue;
      const code = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (d > L ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const x = c * S, y = r * S;
      const top = () => [x + S * ((L - a) / (b - a)), y];
      const right = () => [x + S, y + S * ((L - b) / (cc - b))];
      const bottom = () => [x + S * ((L - d) / (cc - d)), y + S];
      const left = () => [x, y + S * ((L - a) / (d - a))];
      const seg = (p, q) => out.push(p[0], p[1], q[0], q[1]);
      switch (code) {
        case 1: case 14: seg(left(), bottom()); break;
        case 2: case 13: seg(bottom(), right()); break;
        case 3: case 12: seg(left(), right()); break;
        case 4: case 11: seg(top(), right()); break;
        case 6: case 9: seg(top(), bottom()); break;
        case 7: case 8: seg(left(), top()); break;
        case 5: case 10: {
          const center = (a + b + cc + d) / 4 > L;
          if ((code === 5) === center) { seg(left(), top()); seg(bottom(), right()); }
          else { seg(top(), right()); seg(left(), bottom()); }
          break;
        }
        default: break;
      }
    }
  }
  return out;
}

// Screen point for a lat/lon, choosing whichever world copy is on screen.
function visiblePoint(map, lat, lon, size) {
  let best = null;
  for (const shift of [0, -360, 360, -720, 720]) {
    const pt = map.latLngToContainerPoint([lat, lon + shift]);
    if (pt.x >= 0 && pt.x <= size.x) return pt;
    if (!best || Math.abs(pt.x - size.x / 2) < Math.abs(best.x - size.x / 2)) best = pt;
  }
  return best;
}

function findCenters(map, F, P, size) {
  const { nx, ny, wrap } = F;
  const r = nx >= 10 && ny >= 8 ? 2 : 1;
  const at = (i, j) => P[j * nx + (wrap ? mod(i, nx) : i)];
  const found = [];
  for (let j = r; j < ny - r; j++) {
    for (let i = wrap ? 0 : r; i < (wrap ? nx : nx - r); i++) {
      const v = P[j * nx + i];
      if (Number.isNaN(v)) continue;
      let isMax = true, isMin = true, sum = 0, n = 0;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (!di && !dj) continue;
          const w = at(i + di, j + dj);
          if (Number.isNaN(w)) { isMax = isMin = false; continue; }
          if (w >= v) isMax = false;
          if (w <= v) isMin = false;
          sum += w; n++;
        }
      }
      if (!n) continue;
      const prom = Math.abs(v - sum / n);
      if ((isMax || isMin) && prom >= 0.6) {
        // Refine the centre with a parabolic fit in each axis.
        const fx = (a, b, c) => { const den = a - 2 * b + c; return den ? 0.5 * (a - c) / den : 0; };
        const ox = Math.max(-0.5, Math.min(0.5, fx(at(i - 1, j), v, at(i + 1, j))));
        const oy = Math.max(-0.5, Math.min(0.5, fx(at(i, j - 1), v, at(i, j + 1))));
        const pt = visiblePoint(map, F.lat0 + (j + oy) * F.step, F.lon0 + (i + ox) * F.step, size);
        if (pt.x < 12 || pt.y < 12 || pt.x > size.x - 12 || pt.y > size.y - 12) continue;
        found.push({ type: isMax ? 'H' : 'L', v, prom, x: pt.x, y: pt.y });
      }
    }
  }
  found.sort((a, b) => b.prom - a.prom);
  const placed = [];
  for (const f of found) {
    if (placed.some((p) => (p.x - f.x) ** 2 + (p.y - f.y) ** 2 < 90 ** 2)) continue;
    placed.push(f);
  }
  return placed;
}

function drawCenters(ctx, placed, dark, halo) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of placed) {
    const color = f.type === 'H' ? (dark ? '#6fb0ff' : '#1d5fc4') : (dark ? '#ff7a7e' : '#c8262c');
    ctx.font = '800 26px InterVariable, system-ui, sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = halo;
    ctx.strokeText(f.type, f.x, f.y);
    ctx.fillStyle = color;
    ctx.fillText(f.type, f.x, f.y);
    const label = convertPressure(f.v, settings.pressureUnit).toFixed(settings.pressureUnit === 'hPa' ? 0 : PRESSURE_UNITS[settings.pressureUnit].dp);
    ctx.font = '700 11px InterVariable, system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeText(label, f.x, f.y + 19);
    ctx.fillStyle = color;
    ctx.fillText(label, f.x, f.y + 19);
  }
}

function drawWind(ctx, map, F, t, size, dark) {
  const WS = F.ws[t], WD = F.wd[t];
  const spacing = 46;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let y = spacing / 2; y < size.y; y += spacing) {
    for (let x = spacing / 2; x < size.x; x += spacing) {
      const ll = map.containerPointToLatLng([x, y]);
      const sp = sampleAt(F, WS, ll.lat, ll.lng);
      if (Number.isNaN(sp)) continue;
      // Interpolate direction via vector components of neighbouring samples.
      const dir = sampleDirection(F, WS, WD, ll.lat, ll.lng);
      if (dir == null) continue;
      const len = 7 + Math.min(16, sp / 4);
      const ang = ((dir + 180) * Math.PI) / 180; // direction the wind blows towards
      const dx = Math.sin(ang), dy = -Math.cos(ang);
      const x2 = x + dx * len, y2 = y + dy * len;
      const x1 = x - dx * len * 0.4, y1 = y - dy * len * 0.4;
      const strong = sp >= 50;
      ctx.strokeStyle = dark ? (strong ? 'rgba(255,214,120,0.95)' : 'rgba(240,244,255,0.75)') : (strong ? 'rgba(160,60,0,0.9)' : 'rgba(25,35,55,0.6)');
      ctx.lineWidth = strong ? 2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      const hx = 4.5, back = 0.5;
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - dx * hx + dy * hx * back * 1.4, y2 - dy * hx - dx * hx * back * 1.4);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - dx * hx - dy * hx * back * 1.4, y2 - dy * hx + dx * hx * back * 1.4);
      ctx.stroke();
    }
  }
}

function sampleDirection(F, WS, WD, lat, lon) {
  // Build u/v arrays lazily per field+time and interpolate those.
  const key = WD;
  if (!F._uv || F._uvKey !== key) {
    const u = new Float32Array(WD.length), v = new Float32Array(WD.length);
    for (let k = 0; k < WD.length; k++) {
      const rad = (WD[k] * Math.PI) / 180;
      u[k] = -WS[k] * Math.sin(rad);
      v[k] = -WS[k] * Math.cos(rad);
    }
    F._uv = { u, v };
    F._uvKey = key;
  }
  const u = sampleAt(F, F._uv.u, lat, lon), v = sampleAt(F, F._uv.v, lat, lon);
  if (Number.isNaN(u) || Number.isNaN(v) || (u === 0 && v === 0)) return null;
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

function drawCities(ctx, map, F, P, size, dark, halo, centers) {
  const z = map.getZoom();
  // Zoomed out, the basemap shows few city names, so label in full.
  // Zoomed in it names cities itself, so show compact value tags above them.
  const full = z <= 3.5;
  const limit = z <= 3 ? 16 : z <= 4 ? 28 : 44;
  const minDist = full ? 90 : 56;
  const placed = [];
  const unit = settings.pressureUnit;
  const nameFont = '600 10.5px InterVariable, system-ui, sans-serif';
  const valFont = '750 10.5px InterVariable, system-ui, sans-serif';
  const pillBg = dark ? 'rgba(18,26,43,0.9)' : 'rgba(255,255,255,0.94)';
  const ink = dark ? '#e7ebf3' : '#0f172a';
  const accent = dark ? '#a5a1ff' : '#4f46e5';
  ctx.textBaseline = 'middle';
  for (const city of CITIES) {
    if (placed.length >= limit) break;
    const pt = visiblePoint(map, city.lat, city.lon, size);
    if (pt.x < 30 || pt.y < 30 || pt.x > size.x - (full ? 100 : 30) || pt.y > size.y - 12) continue;
    if (placed.some((p) => (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2 < minDist ** 2)) continue;
    if (centers.some((c) => Math.abs(c.x - pt.x) < (full ? 60 : 34) && Math.abs(c.y + 8 - pt.y) < 30)) continue;
    const v = sampleAt(F, P, city.lat, city.lon);
    if (Number.isNaN(v)) continue;
    placed.push(pt);
    const val = convertPressure(v, unit).toFixed(unit === 'hPa' ? 0 : PRESSURE_UNITS[unit].dp);
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = pillBg;
    if (full) {
      ctx.font = nameFont;
      const wn = ctx.measureText(city.n).width;
      ctx.font = valFont;
      const wv = ctx.measureText(val).width;
      const x0 = pt.x + 5, h = 17;
      roundRect(ctx, x0, pt.y - h / 2, wn + wv + 16, h, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      ctx.font = nameFont;
      ctx.fillStyle = dark ? '#c3cbda' : '#334155';
      ctx.fillText(city.n, x0 + 6, pt.y + 0.5);
      ctx.font = valFont;
      ctx.fillStyle = accent;
      ctx.fillText(val, x0 + 10 + wn, pt.y + 0.5);
    } else {
      ctx.font = valFont;
      const w = ctx.measureText(val).width + 10, h = 16, by = pt.y - 7;
      roundRect(ctx, pt.x - w / 2, by - h, w, h, 5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(pt.x - 4, by - 0.5);
      ctx.lineTo(pt.x + 4, by - 0.5);
      ctx.lineTo(pt.x, by + 4);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.fillText(val, pt.x, by - h / 2 + 0.5);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = halo;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Base map helpers

// Leaflet options for the fixed preview maps: no dragging or zooming, so a
// map loads its pressure data once and the page scrolls normally over it.
export const STATIC_MAP = {
  zoomControl: false,
  dragging: false,
  touchZoom: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
  attributionControl: true,
  worldCopyJump: true,
};

export function addBaseLayers(map) {
  // Esri's gray canvas basemaps: keyless, muted, and they come as separate
  // base + label layers so labels can sit above the pressure shading.
  const attribution = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors · Data <a href="https://open-meteo.com/">Open-Meteo</a>';
  const esri = (name) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`;
  if (!map.getPane('labels')) {
    map.createPane('labels');
    map.getPane('labels').style.zIndex = 450;
    map.getPane('labels').style.pointerEvents = 'none';
  }
  let base, labels;
  const apply = () => {
    const dark = document.documentElement.classList.contains('is-dark');
    const style = dark ? 'Dark' : 'Light';
    if (base) map.removeLayer(base);
    if (labels) map.removeLayer(labels);
    base = L.tileLayer(esri(`World_${style}_Gray_Base`), { maxZoom: 16, attribution }).addTo(map);
    labels = L.tileLayer(esri(`World_${style}_Gray_Reference`), { maxZoom: 16, pane: 'labels', opacity: dark ? 0.8 : 0.9 }).addTo(map);
  };
  apply();
  window.addEventListener('themechange', apply);
  return () => window.removeEventListener('themechange', apply);
}
