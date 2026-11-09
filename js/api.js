// Data access: Open-Meteo forecast + geocoding (free, no key, CORS-enabled)
// and BigDataCloud's client-side reverse geocoder for "use my location".

import { cacheGet, cacheSet } from './store.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Rate limits. Open-Meteo's free tier allows about 600 requests a minute,
// 5,000 an hour and 10,000 a day per network, where each location in a
// request counts. Once a limit is hit we stop asking until it should have
// reset, instead of piling on more refused requests.

const LIMIT_KEY = 'bpm:ratelimit';
const isMetered = (url) => /\/\/(api|archive-api)\.open-meteo\.com\//.test(url);

export function rateLimit() {
  try {
    const v = JSON.parse(localStorage.getItem(LIMIT_KEY));
    return v && v.until > Date.now() ? v : null;
  } catch { return null; }
}

function noteRateLimit(reason) {
  const r = String(reason || '').toLowerCase();
  const now = Date.now();
  let v;
  if (r.includes('daily') || r.includes('tomorrow')) {
    const d = new Date();
    v = { kind: 'day', until: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5) };
  } else if (r.includes('hour')) {
    v = { kind: 'hour', until: now + 60 * 60e3 };
  } else {
    v = { kind: 'minute', until: now + 65e3 };
  }
  try { localStorage.setItem(LIMIT_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  return v;
}

export function rateLimitMessage(v = rateLimit()) {
  if (!v) return '';
  const mins = Math.max(1, Math.ceil((v.until - Date.now()) / 60e3));
  if (v.kind === 'minute') return 'Lots of weather data was requested in the last minute, so new data is paused briefly. It will load again in about a minute. Saved data is shown where available.';
  if (v.kind === 'hour') return `The free weather service's hourly limit for your network has been reached. New data will load again in about ${mins} minutes. Saved data is shown where available.`;
  return `The free weather service's daily limit for your network has been reached. New data will load again from ${new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(v.until)}. Saved data is shown where available.`;
}

async function getJson(url, { signal } = {}) {
  if (isMetered(url)) {
    const lim = rateLimit();
    if (lim) throw new ApiError(rateLimitMessage(lim), 429);
  }
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(navigator.onLine === false
      ? 'You appear to be offline.'
      : 'Could not reach the weather service. Check your connection and try again.', 0);
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || (body && body.error)) {
    const reason = body && body.reason ? body.reason : `HTTP ${res.status}`;
    if (res.status === 429 || /limit exceeded/i.test(reason)) {
      throw new ApiError(rateLimitMessage(noteRateLimit(reason)), 429);
    }
    throw new ApiError(reason, res.status);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Single-location forecast with history

const HOURLY_VARS = [
  'pressure_msl', 'surface_pressure', 'temperature_2m', 'apparent_temperature',
  'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m', 'wind_direction_10m',
  'wind_gusts_10m', 'precipitation_probability', 'precipitation', 'weather_code', 'cloud_cover',
];
const HOURLY_KEYS = ['msl', 'sp', 'temp', 'feels', 'rh', 'dew', 'ws', 'wd', 'wg', 'pp', 'pr', 'wc', 'cc'];
const CURRENT_VARS = [
  'pressure_msl', 'surface_pressure', 'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'dew_point_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation',
  'weather_code', 'cloud_cover', 'is_day',
];
const DAILY_VARS = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'precipitation_probability_max', 'sunrise', 'sunset', 'wind_speed_10m_max',
];
const DAILY_KEYS = ['wc', 'tmax', 'tmin', 'prsum', 'ppmax', 'sunrise', 'sunset', 'wsmax'];

const PAST_DAYS = 14;
const FORECAST_DAYS = 16;
const inflight = new Map();

function round(n, d = 3) { return Number(Number(n).toFixed(d)); }

export function forecastCacheKey(lat, lon) { return `fc:${round(lat, 2)},${round(lon, 2)}`; }

export async function fetchForecast(lat, lon, { force = false } = {}) {
  const key = forecastCacheKey(lat, lon);
  if (!force) {
    const cached = cacheGet(key, 15 * 60e3);
    if (cached) return cached;
  }
  if (inflight.has(key)) return inflight.get(key);

  const params = new URLSearchParams({
    latitude: round(lat, 4),
    longitude: round(lon, 4),
    hourly: HOURLY_VARS.join(','),
    current: CURRENT_VARS.join(','),
    daily: DAILY_VARS.join(','),
    past_days: PAST_DAYS,
    forecast_days: FORECAST_DAYS,
    timezone: 'auto',
    timeformat: 'unixtime',
  });

  const p = getJson(`${FORECAST}?${params}`)
    .then((raw) => {
      const data = normalizeForecast(raw, lat, lon);
      cacheSet(key, data);
      return data;
    })
    .catch((err) => {
      // Fall back to a stale copy rather than an empty page.
      const stale = cacheGet(key, 7 * 24 * 3600e3);
      if (stale) { stale.stale = true; stale.staleReason = err.message; return stale; }
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function normalizeForecast(raw, lat, lon) {
  const hourly = { time: raw.hourly.time.map((t) => t * 1000) };
  HOURLY_VARS.forEach((v, i) => { hourly[HOURLY_KEYS[i]] = raw.hourly[v] || []; });
  const daily = { time: raw.daily.time.map((t) => t * 1000) };
  DAILY_VARS.forEach((v, i) => {
    const arr = raw.daily[v] || [];
    daily[DAILY_KEYS[i]] = (v === 'sunrise' || v === 'sunset') ? arr.map((t) => (t ? t * 1000 : null)) : arr;
  });
  const c = raw.current || {};
  return {
    lat, lon,
    gridLat: raw.latitude, gridLon: raw.longitude,
    elevation: raw.elevation,
    timezone: raw.timezone,
    tzAbbr: raw.timezone_abbreviation,
    utcOffset: raw.utc_offset_seconds,
    fetchedAt: Date.now(),
    current: {
      time: (c.time || 0) * 1000,
      msl: c.pressure_msl, sp: c.surface_pressure, temp: c.temperature_2m, feels: c.apparent_temperature,
      rh: c.relative_humidity_2m, dew: c.dew_point_2m, ws: c.wind_speed_10m, wd: c.wind_direction_10m,
      wg: c.wind_gusts_10m, pr: c.precipitation, wc: c.weather_code, cc: c.cloud_cover, isDay: c.is_day,
    },
    hourly,
    daily,
  };
}

// ---------------------------------------------------------------------------
// Any date range (reports). Recent and future dates come from the forecast
// API; older dates from the historical archive (ERA5 reanalysis, from 1940).
// Dates are 'YYYY-MM-DD' local dates at the location.

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const RANGE_VARS = [
  'pressure_msl', 'surface_pressure', 'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'dew_point_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation',
  'weather_code', 'cloud_cover',
];
const RANGE_KEYS = ['msl', 'sp', 'temp', 'feels', 'rh', 'dew', 'ws', 'wd', 'wg', 'pr', 'wc', 'cc'];
export const RANGE_LIMITS = { earliest: '1940-01-01', forecastDays: 15, recentDays: 60, archiveLagDays: 6 };
const rangeCache = new Map();

export function isoDay(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export async function fetchRange(lat, lon, startDate, endDate) {
  const key = `${round(lat, 3)},${round(lon, 3)},${startDate},${endDate}`;
  if (rangeCache.has(key)) return rangeCache.get(key);
  const today = isoDay(new Date());
  const archiveEnd = addDays(today, -RANGE_LIMITS.archiveLagDays);
  const segments = [];
  if (startDate >= addDays(today, -RANGE_LIMITS.recentDays)) {
    segments.push({ url: FORECAST, start: startDate, end: endDate, source: 'forecast' });
  } else {
    segments.push({ url: ARCHIVE, start: startDate, end: endDate < archiveEnd ? endDate : archiveEnd, source: 'archive' });
    if (endDate > archiveEnd) segments.push({ url: FORECAST, start: addDays(archiveEnd, 1), end: endDate, source: 'forecast' });
  }
  const parts = await Promise.all(segments.map((sg) => getJson(`${sg.url}?${new URLSearchParams({
    latitude: round(lat, 4),
    longitude: round(lon, 4),
    hourly: RANGE_VARS.join(','),
    start_date: sg.start,
    end_date: sg.end,
    timezone: 'auto',
    timeformat: 'unixtime',
  })}`).then((raw) => ({ raw, source: sg.source }))));

  const first = parts[0].raw;
  const hourly = { time: [] };
  RANGE_KEYS.forEach((k) => { hourly[k] = []; });
  const seen = new Set();
  for (const { raw } of parts) {
    raw.hourly.time.forEach((t, i) => {
      if (seen.has(t)) return;
      seen.add(t);
      hourly.time.push(t * 1000);
      RANGE_VARS.forEach((v, j) => { hourly[RANGE_KEYS[j]].push(raw.hourly[v] ? raw.hourly[v][i] : null); });
    });
  }
  const out = {
    lat, lon,
    gridLat: first.latitude, gridLon: first.longitude,
    elevation: first.elevation,
    timezone: first.timezone,
    tzAbbr: first.timezone_abbreviation,
    sources: [...new Set(parts.map((x) => x.source))],
    hourly,
  };
  rangeCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Many locations at once (map grid, world rankings, favourites)

let useHourWindow = true; // past_hours / forecast_hours; falls back to whole days if rejected

export async function fetchMulti(points, { vars = ['pressure_msl'], pastHours = 24, forecastHours = 72, signal, chunk = 150 } = {}) {
  const chunks = [];
  for (let i = 0; i < points.length; i += chunk) chunks.push(points.slice(i, i + chunk));
  const out = [];
  // Two requests at a time keeps things snappy without hammering the API.
  for (let i = 0; i < chunks.length; i += 2) {
    const batch = chunks.slice(i, i + 2).map((c) => fetchMultiChunk(c, vars, pastHours, forecastHours, signal));
    const results = await Promise.all(batch);
    results.forEach((r) => out.push(...r));
  }
  return out;
}

async function fetchMultiChunk(points, vars, pastHours, forecastHours, signal) {
  const base = {
    latitude: points.map((p) => round(p.lat, 3)).join(','),
    longitude: points.map((p) => round(p.lon, 3)).join(','),
    hourly: vars.join(','),
    timeformat: 'unixtime',
    timezone: 'GMT',
  };
  const build = () => new URLSearchParams(useHourWindow
    ? { ...base, past_hours: pastHours, forecast_hours: forecastHours }
    : { ...base, past_days: Math.ceil(pastHours / 24), forecast_days: Math.min(16, Math.ceil(forecastHours / 24) + 1) });
  let raw;
  try {
    raw = await getJson(`${FORECAST}?${build()}`, { signal });
  } catch (e) {
    if (useHourWindow && e.status === 400) {
      useHourWindow = false;
      raw = await getJson(`${FORECAST}?${build()}`, { signal });
    } else throw e;
  }
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((r) => {
    const series = {};
    vars.forEach((v) => { series[v] = r.hourly[v]; });
    return { time: r.hourly.time.map((t) => t * 1000), series, elevation: r.elevation };
  });
}

// ---------------------------------------------------------------------------
// Geocoding

export async function searchPlaces(query, { signal } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ name: q, count: 10, language: navigator.language?.slice(0, 2) || 'en', format: 'json' });
  const body = await getJson(`${GEOCODE}?${params}`, { signal });
  return (body.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', '),
    country: r.country,
    countryCode: r.country_code,
    lat: r.latitude,
    lon: r.longitude,
    population: r.population,
    elevation: r.elevation,
  }));
}

export async function reverseGeocode(lat, lon) {
  const key = `rg:${round(lat, 2)},${round(lon, 2)}`;
  const cached = cacheGet(key, 30 * 24 * 3600e3);
  if (cached) return cached;
  try {
    const params = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: 'en' });
    const b = await getJson(`${REVERSE}?${params}`);
    const name = b.city || b.locality || b.principalSubdivision || b.countryName;
    const region = [b.principalSubdivision !== name ? b.principalSubdivision : null, b.countryName].filter(Boolean).join(', ');
    const out = name ? { name, region } : null;
    if (out) cacheSet(key, out);
    return out || { name: coordName(lat, lon), region: '' };
  } catch {
    return { name: coordName(lat, lon), region: '' };
  }
}

export function coordName(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

export function parseCoords(text) {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function getPosition({ timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available in this browser.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1
        ? 'Location permission was denied. You can search for a place instead.'
        : 'Could not get your location. Try again or search for a place.')),
      { enableHighAccuracy: false, timeout, maximumAge: 10 * 60e3 },
    );
  });
}
