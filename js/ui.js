// Shared UI helpers: escaping, formatting, toasts, icons and sparklines.

import { settings } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Date/time in a given IANA time zone ----------

const fmtCache = new Map();
function dtf(tz, opts) {
  const key = tz + JSON.stringify(opts) + settings.hour12;
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, hour12: settings.hour12, ...opts });
    } catch {
      f = new Intl.DateTimeFormat(undefined, { hour12: settings.hour12, ...opts });
    }
    fmtCache.set(key, f);
  }
  return f;
}
export const fmtClock = (t, tz) => dtf(tz, { hour: 'numeric', minute: '2-digit' }).format(t);
export const fmtHour = (t, tz) => dtf(tz, { hour: 'numeric' }).format(t);
export const fmtWeekday = (t, tz) => dtf(tz, { weekday: 'short' }).format(t);
export const fmtDayMonth = (t, tz) => dtf(tz, { day: 'numeric', month: 'short' }).format(t);
export const fmtDayFull = (t, tz) => dtf(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(t);
export const fmtDateTime = (t, tz) => dtf(tz, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(t);
export const fmtDayHour = (t, tz) => dtf(tz, { weekday: 'short', hour: 'numeric' }).format(t);

// Calendar day key (YYYY-MM-DD) in the zone.
export function dayKey(t, tz) {
  const p = dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t);
  const get = (type) => p.find((x) => x.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function relTime(t, now = Date.now()) {
  const m = Math.round((now - t) / 60e3);
  if (Math.abs(m) < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function relHours(t, now = Date.now()) {
  const h = Math.round((t - now) / 3600e3);
  if (h === 0) return 'now';
  return h > 0 ? `in ${h} h` : `${-h} h ago`;
}

// ---------- Icons ----------

const S = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
export const icon = {
  up: S('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  down: S('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
  upSlow: S('<path d="M7 17 17 7M9 7h8v8"/>'),
  downSlow: S('<path d="M7 7l10 10M17 9v8H9"/>'),
  flat: S('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  star: S('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  share: S('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  refresh: S('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  locate: S('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>'),
  map: S('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  globe: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  book: S('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h7"/>'),
  alert: S('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>'),
  gauge: S('<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5"/>'),
  heart: S('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  fish: S('<path d="M3 12c3-4 7-5 11-5 3 0 5 2 7 5-2 3-4 5-7 5-4 0-8-1-11-5z"/><path d="M3 12 1 9M3 12l-2 3"/><circle cx="16" cy="11" r=".6"/>'),
  wave: S('<path d="M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1"/><path d="M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1"/>'),
  thermo: S('<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>'),
  drop: S('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  wind: S('<path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h7"/>'),
  cloud: S('<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4 4 0 1 1 17 18z"/>'),
  sunrise: S('<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 4v4M5 9l1.5 1.5M19 9l-1.5 1.5"/>'),
  mountain: S('<path d="m3 20 6.5-11 4 6.5L16 12l5 8z"/>'),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="4" width="4.5" height="16" rx="1"/><rect x="14" y="4" width="4.5" height="16" rx="1"/></svg>',
  layers: S('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
};

export function trendIcon(tend) {
  if (tend.key === 'steady') return icon.flat;
  if (tend.key === 'rise') return tend.strength >= 2 ? icon.up : icon.upSlow;
  return tend.strength >= 2 ? icon.down : icon.downSlow;
}

// ---------- Sparkline ----------

export function sparkline(values, { width = 240, height = 44, nowIndex = null, color = 'var(--accent)' } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return '';
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const pad = Math.max(0.6, (max - min) * 0.12);
  const lo = min - pad, hi = max + pad;
  const x = (i) => (i / (values.length - 1)) * width;
  const y = (v) => height - ((v - lo) / (hi - lo)) * height;
  const path = (arr) => arr.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const past = nowIndex != null ? pts.filter(([i]) => i <= nowIndex) : pts;
  const future = nowIndex != null ? pts.filter(([i]) => i >= nowIndex) : [];
  const area = `${path(pts)}L${x(pts[pts.length - 1][0]).toFixed(1)},${height}L${x(pts[0][0]).toFixed(1)},${height}Z`;
  const id = 'sg' + Math.random().toString(36).slice(2, 8);
  let s = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">`;
  s += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
  s += `<path d="${area}" fill="url(#${id})" stroke="none"/>`;
  s += `<path d="${path(past)}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  if (future.length > 1) s += `<path d="${path(future)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" opacity=".8"/>`;
  if (nowIndex != null && values[nowIndex] != null) {
    s += `<line x1="${x(nowIndex)}" x2="${x(nowIndex)}" y1="0" y2="${height}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" opacity=".6"/>`;
  }
  s += '</svg>';
  return s;
}

export function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
}

// Hash route for a place page.
export function placeHref(p) {
  const q = new URLSearchParams({ lat: (+p.lat).toFixed(4), lon: (+p.lon).toFixed(4), name: p.name || '' });
  if (p.region) q.set('region', p.region);
  return `#/place?${q}`;
}
