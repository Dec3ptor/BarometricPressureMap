// Builds the content of a conditions report: rows inside the chosen time
// window, summary statistics, a daily breakdown and plain-language
// highlights. Everything here is unit-agnostic (hPa, °C, km/h, mm); the
// view and exporters convert for display.

import { HOUR, valueAt, tendency } from './analysis.js';
import { compass } from './units.js';
import { wxText } from './wx.js';

// Offset of a time zone from UTC at instant t, in ms.
function tzOffsetMs(t, tz) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(t);
  const g = (k) => Number(p.find((x) => x.type === k).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
}

// Wall-clock date + time at a location → epoch ms.
export function zonedToEpoch(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall;
  for (let i = 0; i < 3; i++) t = wall - tzOffsetMs(t, tz);
  return t;
}

const VARS = ['msl', 'sp', 'temp', 'feels', 'rh', 'dew', 'ws', 'wg', 'cc'];

function stats(times, arr, t0, t1) {
  let min = Infinity, max = -Infinity, sum = 0, n = 0, tMin = null, tMax = null;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t < t0 || t > t1) continue;
    const v = arr[i];
    if (v == null) continue;
    sum += v; n++;
    if (v < min) { min = v; tMin = t; }
    if (v > max) { max = v; tMax = t; }
  }
  if (!n) return null;
  return { min, max, mean: sum / n, tMin, tMax, n };
}

export function buildReport(data, { t0, t1 }) {
  const H = data.hourly;
  const times = H.time;
  const idx = [];
  for (let i = 0; i < times.length; i++) if (times[i] >= t0 && times[i] <= t1) idx.push(i);

  const rows = idx.map((i) => {
    const r = { t: times[i] };
    for (const k of ['msl', 'sp', 'temp', 'feels', 'rh', 'dew', 'ws', 'wd', 'wg', 'pr', 'wc', 'cc']) r[k] = H[k][i];
    return r;
  });

  // Window statistics, with start/end values interpolated to the exact times.
  const summary = {};
  for (const k of VARS) {
    const s = stats(times, H[k], t0, t1) || {};
    const start = valueAt(times, H[k], t0);
    const end = valueAt(times, H[k], t1);
    summary[k] = { ...s, start, end, change: start != null && end != null ? end - start : null };
  }

  // Fastest 3-hour pressure changes inside the window.
  let maxFall = 0, maxRise = 0, tFall = null, tRise = null;
  for (const i of idx) {
    if (i < 3 || H.msl[i] == null || H.msl[i - 3] == null || times[i - 3] < t0 - 3 * HOUR) continue;
    const d = H.msl[i] - H.msl[i - 3];
    if (d < maxFall) { maxFall = d; tFall = times[i]; }
    if (d > maxRise) { maxRise = d; tRise = times[i]; }
  }

  // Precipitation: hourly values are totals for the preceding hour.
  let rain = 0, wetHours = 0;
  for (const i of idx) {
    if (times[i] <= t0) continue;
    const p = H.pr[i] || 0;
    rain += p;
    if (p >= 0.1) wetHours++;
  }

  // Prevailing wind: speed-weighted vector mean of directions.
  let u = 0, v = 0;
  for (const i of idx) {
    const s = H.ws[i], d = H.wd[i];
    if (s == null || d == null) continue;
    u += s * Math.sin((d * Math.PI) / 180);
    v += s * Math.cos((d * Math.PI) / 180);
  }
  const prevailing = u || v ? ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360 : null;

  // Weather codes, most frequent first.
  const counts = new Map();
  for (const i of idx) if (H.wc[i] != null) counts.set(H.wc[i], (counts.get(H.wc[i]) || 0) + 1);
  const weather = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, text: wxText(code), hours: n }));

  const hoursSpan = (t1 - t0) / HOUR;
  const pChange = summary.msl.change;
  const per3h = pChange != null && hoursSpan > 0 ? (pChange / hoursSpan) * 3 : null;

  return {
    t0, t1, hoursSpan, rows,
    summary,
    pressure: { maxFall, tFall, maxRise, tRise, tendency: tendency(per3h), per3h },
    rain: { total: rain, wetHours },
    wind: { prevailing, prevailingText: prevailing == null ? '–' : compass(prevailing) },
    weather,
  };
}

// One row per local calendar day in the window.
export function dailyBreakdown(data, report, dayKeyFn) {
  const H = data.hourly;
  const byDay = new Map();
  H.time.forEach((t, i) => {
    if (t < report.t0 || t > report.t1) return;
    const k = dayKeyFn(t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(i);
  });
  return [...byDay.entries()].map(([day, list]) => {
    const pick = (k) => list.map((i) => H[k][i]).filter((x) => x != null);
    const msl = pick('msl'), temp = pick('temp'), wg = pick('wg');
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return {
      day,
      t: H.time[list[0]],
      pMin: msl.length ? Math.min(...msl) : null,
      pMax: msl.length ? Math.max(...msl) : null,
      pMean: mean(msl),
      pChange: msl.length > 1 ? msl[msl.length - 1] - msl[0] : null,
      tMin: temp.length ? Math.min(...temp) : null,
      tMax: temp.length ? Math.max(...temp) : null,
      rain: list.reduce((s, i) => s + (H.pr[i] || 0), 0),
      gust: wg.length ? Math.max(...wg) : null,
    };
  });
}

export function sourceText(sources) {
  const s = [];
  if (sources.includes('archive')) s.push('ERA5 reanalysis via the Open-Meteo Historical Weather API');
  if (sources.includes('forecast')) s.push('national weather-service models via the Open-Meteo Forecast API');
  return s.join(' and ');
}

export const DISCLAIMER = 'Values are modelled estimates for the model grid cell nearest this location, not readings from an on-site instrument. ' +
  'Hourly values are model output; start and end values are interpolated to the exact times. ' +
  'Where measured values are required (for example for compliance), use calibrated on-site instruments.';
