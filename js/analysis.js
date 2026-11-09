// Pressure analysis: trends, levels, the Zambretti barometer forecast,
// day-to-day variability and alerts. All inputs are in hPa.

export const HOUR = 3600e3;

// Index of the last hourly sample at or before time t.
export function indexAt(times, t) {
  let lo = 0, hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  return lo;
}

// Linear interpolation of a series at time t.
export function valueAt(times, values, t) {
  const i = indexAt(times, t);
  const t0 = times[i], v0 = values[i];
  if (i >= times.length - 1 || t <= t0) return v0;
  const t1 = times[i + 1], v1 = values[i + 1];
  if (v0 == null) return v1;
  if (v1 == null) return v0;
  return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
}

export function changeOver(times, values, t, hours) {
  const a = valueAt(times, values, t - hours * HOUR);
  const b = valueAt(times, values, t);
  return a == null || b == null ? null : b - a;
}

// Pressure tendency over three hours, using the categories from marine
// forecasts (steady / slowly / – / quickly / very rapidly).
export function tendency(dp3) {
  if (dp3 == null) return { key: 'steady', label: 'No trend data', short: '–', strength: 0 };
  const a = Math.abs(dp3);
  const dir = dp3 > 0 ? 'rise' : 'fall';
  const verb = dp3 > 0 ? 'Rising' : 'Falling';
  if (a < 0.5) return { key: 'steady', label: 'Steady', short: 'Steady', strength: 0 };
  if (a < 1.6) return { key: dir, label: `${verb} slowly`, short: verb, strength: 1 };
  if (a < 3.6) return { key: dir, label: verb, short: verb, strength: 2 };
  if (a < 6.0) return { key: dir, label: `${verb} quickly`, short: verb, strength: 3 };
  return { key: dir, label: `${verb} very rapidly`, short: verb, strength: 4 };
}

// Sea-level pressure bands. 1009 / 1023 hPa ≈ 29.8 / 30.2 inHg.
export const LEVELS = [
  { min: 1033, key: 'vhigh', label: 'Very high', color: '#1e4fa3', desc: 'Strong anticyclone: subsiding air, usually dry and settled' },
  { min: 1023, key: 'high', label: 'High', color: '#2f7bd6', desc: 'Anticyclonic: typically settled with light winds' },
  { min: 1009, key: 'normal', label: 'Normal', color: '#7a8699', desc: 'Typical range; the weather depends mostly on the trend' },
  { min: 995, key: 'low', label: 'Low', color: '#d9653f', desc: 'Cyclonic: cloud, wind and rain more likely' },
  { min: 980, key: 'vlow', label: 'Very low', color: '#c2333a', desc: 'Deep depression: usually wet and windy' },
  { min: -Infinity, key: 'storm', label: 'Stormy', color: '#8e1c4e', desc: 'Severe storm or tropical cyclone' },
];
export function level(msl) {
  if (msl == null) return LEVELS[2];
  return LEVELS.find((l) => msl >= l.min);
}

// Zambretti forecaster (simplified, after Negretti & Zambra's 1915 device).
const ZAMBRETTI = [
  'Settled fine', 'Fine weather', 'Fine, becoming less settled', 'Fairly fine, showery later',
  'Showery, becoming more unsettled', 'Unsettled, rain later', 'Rain at times, worse later',
  'Rain at times, becoming very unsettled', 'Very unsettled, rain', 'Settled fine', 'Fine weather',
  'Fine, possibly showers', 'Fairly fine, showers likely', 'Showery, bright intervals',
  'Changeable, some rain', 'Unsettled, rain at times', 'Rain at frequent intervals',
  'Very unsettled, rain', 'Stormy, much rain', 'Settled fine', 'Fine weather', 'Becoming fine',
  'Fairly fine, improving', 'Fairly fine, possibly showers early', 'Showery early, improving',
  'Changeable, mending', 'Rather unsettled, clearing later', 'Unsettled, probably improving',
  'Unsettled, short fine intervals', 'Very unsettled, finer at times', 'Stormy, possibly improving',
  'Stormy, much rain',
];
export function zambretti(msl, dp3) {
  if (msl == null) return null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let z, trend;
  if (dp3 != null && dp3 <= -1.6) { z = clamp(Math.round(127 - 0.12 * msl), 1, 9); trend = 'falling'; }
  else if (dp3 != null && dp3 >= 1.6) { z = clamp(Math.round(185 - 0.16 * msl), 20, 32); trend = 'rising'; }
  else { z = clamp(Math.round(144 - 0.13 * msl), 10, 19); trend = 'steady'; }
  const text = ZAMBRETTI[z - 1];
  const tone = /stormy|very unsettled/i.test(text) ? 'bad' : /rain|unsettled|showery|changeable/i.test(text) ? 'mixed' : 'good';
  return { z, text, trend, tone };
}

// Stats for a time window [t0, t1).
export function windowStats(times, values, t0, t1) {
  let min = Infinity, max = -Infinity, sum = 0, n = 0, tMin = null, tMax = null;
  let first = null, last = null;
  let maxDrop = 0, maxRise = 0, tDrop = null, tRise = null;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t < t0 || t >= t1) continue;
    const v = values[i];
    if (v == null) continue;
    if (first == null) first = v;
    last = v;
    sum += v; n++;
    if (v < min) { min = v; tMin = t; }
    if (v > max) { max = v; tMax = t; }
    if (i >= 3 && values[i - 3] != null) {
      const d = v - values[i - 3];
      if (d < maxDrop) { maxDrop = d; tDrop = t; }
      if (d > maxRise) { maxRise = d; tRise = t; }
    }
  }
  if (!n) return null;
  return { min, max, tMin, tMax, avg: sum / n, range: max - min, net: last - first, maxDrop, maxRise, tDrop, tRise, n };
}

// 1 = calm, 2 = moderate, 3 = big swing
export function swingLevel(s) {
  if (!s) return 0;
  const rate = Math.max(-s.maxDrop, s.maxRise);
  if (s.range >= 10 || rate >= 3.6) return 3;
  if (s.range >= 5 || rate >= 1.6) return 2;
  return 1;
}
export const SWING_LABELS = ['–', 'Low', 'Moderate', 'High'];


// Notable events in the next 48 hours.
export function alerts(times, msl, now, lat) {
  const out = [];
  const next24 = windowStats(times, msl, now, now + 24 * HOUR);
  const next48 = windowStats(times, msl, now, now + 48 * HOUR);
  if (!next48) return out;
  // "Bomb" cyclogenesis: a fall of 24 hPa in 24 h, scaled by latitude.
  const bombThreshold = 24 * Math.abs(Math.sin((lat * Math.PI) / 180)) / Math.sin(Math.PI / 3);
  let worst24 = 0, tWorst = null;
  for (let i = 0; i < times.length; i++) {
    if (times[i] < now || times[i] > now + 48 * HOUR) continue;
    const t = times[i];
    const d = changeOver(times, msl, t + 24 * HOUR, 24);
    if (d != null && d < worst24) { worst24 = d; tWorst = t; }
  }
  if (Math.abs(lat) > 25 && bombThreshold > 8 && -worst24 >= bombThreshold) {
    out.push({ level: 'warn', title: 'Rapidly deepening storm possible', text: `Pressure is forecast to drop about ${(-worst24).toFixed(0)} hPa in 24 hours, a rate meteorologists call "bombogenesis".`, t: tWorst, d: worst24 });
  } else if (next48.maxDrop <= -3.6) {
    out.push({ level: 'warn', title: 'Sharp pressure drop ahead', kind: 'drop', t: next48.tDrop, d: next48.maxDrop });
  }
  if (next48.maxRise >= 3.6) {
    out.push({ level: 'info', title: 'Sharp pressure rise ahead', kind: 'rise', t: next48.tRise, d: next48.maxRise });
  }
  if (next24 && next24.range >= 10 && !out.length) {
    out.push({ level: 'info', title: 'Big pressure swing in the next 24 hours', kind: 'swing', d: next24.range });
  }
  return out;
}
