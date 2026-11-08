// Live pressure for the tracked cities, shared by the World page and the
// home page's "World right now" panel. Cached for 45 minutes.

import { fetchMulti } from './api.js';
import { cacheGet, cacheSet } from './store.js';
import { HOUR, valueAt, changeOver, windowStats } from './analysis.js';
import { CITIES } from './cities.js';

const CACHE_KEY = 'world-v1';
let inflight = null;

export async function loadWorld() {
  let rows = cacheGet(CACHE_KEY, 45 * 60e3);
  if (!rows) {
    inflight ??= fetchMulti(CITIES, { vars: ['pressure_msl'], pastHours: 24, forecastHours: 48 })
      .then((res) => {
        const r = { t: Date.now(), data: res.map((x) => ({ time: x.time, p: x.series.pressure_msl })) };
        cacheSet(CACHE_KEY, r);
        return r;
      })
      .finally(() => { inflight = null; });
    try {
      rows = await inflight;
    } catch (e) {
      rows = cacheGet(CACHE_KEY, 7 * 24 * 3600e3);
      if (!rows) throw e;
      rows.stale = true;
    }
  }
  const now = Date.now();
  const cities = CITIES.map((c, i) => {
    const r = rows.data[i];
    if (!r) return null;
    const v = valueAt(r.time, r.p, now);
    const next = windowStats(r.time, r.p, now, now + 24 * HOUR);
    return {
      ...c,
      now: v,
      d3: changeOver(r.time, r.p, now, 3),
      d24: changeOver(r.time, r.p, now, 24),
      next,
      net24: next ? valueAt(r.time, r.p, now + 24 * HOUR) - v : null,
    };
  }).filter((c) => c && c.now != null);
  return { cities, fetchedAt: rows.t, stale: !!rows.stale };
}
