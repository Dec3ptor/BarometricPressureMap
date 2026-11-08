// Home: search, "use my location", favourites with live readings, shortcuts.

import { fetchMulti } from '../api.js';
import { settings, getFavorites, getRecents, getLastPlace, placeKey, cacheGet, cacheSet } from '../store.js';
import { PRESSURE_UNITS, fmtPressure, fmtDelta } from '../units.js';
import { HOUR, valueAt, changeOver, tendency, level } from '../analysis.js';
import { esc, icon, trendIcon, sparkline, placeHref } from '../ui.js';
import { canInstall, promptInstall } from '../main.js';

const STARTERS = [
  { name: 'London', region: 'England, United Kingdom', lat: 51.507, lon: -0.128 },
  { name: 'New York', region: 'New York, United States', lat: 40.713, lon: -74.006 },
  { name: 'Tokyo', region: 'Japan', lat: 35.69, lon: 139.692 },
  { name: 'Sydney', region: 'New South Wales, Australia', lat: -33.869, lon: 151.209 },
  { name: 'Denver', region: 'Colorado, United States', lat: 39.739, lon: -104.99 },
  { name: 'Reykjavík', region: 'Iceland', lat: 64.147, lon: -21.943 },
];

export async function render(main) {
  const favs = getFavorites();
  const last = getLastPlace();
  const recents = getRecents().filter((r) => !favs.some((f) => placeKey(f) === placeKey(r))).slice(0, 4);

  main.innerHTML = `<div class="page">
    <section class="home-hero">
      <svg class="hero-isobars" viewBox="0 0 420 300" aria-hidden="true">
        ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${-20 + i * 10},${300 - i * 18} C ${90 + i * 20},${190 - i * 30} ${150 + i * 14},${250 - i * 34} ${250 - i * 4},${150 - i * 10} S ${360 - i * 10},${40 + i * 8} ${440},${30 + i * 26}"/>`).join('')}
        <circle cx="300" cy="105" r="22" style="fill:none;stroke:var(--accent);stroke-width:1.4;opacity:.35"/>
        <circle cx="300" cy="105" r="44" style="fill:none;stroke:var(--accent);stroke-width:1.4;opacity:.25"/>
      </svg>
      <h1>Barometric pressure, anywhere on Earth.</h1>
      <p class="lead">Two weeks of history, a 16-day forecast, trend alerts and a live isobar map, for any place you choose.</p>
      <div class="hero-search">
        <button type="button" class="fake-input" data-action="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <span>Search a city or town</span>
        </button>
        <button type="button" class="btn btn-primary" data-action="locate">${icon.locate} Use my location</button>
      </div>
    </section>

    ${last && !favs.some((f) => placeKey(f) === placeKey(last)) ? `
      <h2 class="section-title">Last viewed</h2>
      <div class="place-cards" data-group="last">${cardShell(last)}</div>` : ''}

    <h2 class="section-title">${favs.length ? 'Favourites' : 'Popular places <span class="muted">tap ☆ on any place to pin it here instead</span>'}</h2>
    ${favs.length
      ? `<div class="place-cards" data-group="favs">${favs.map(cardShell).join('')}</div>`
      : `<div class="place-cards" data-group="starters">${STARTERS.map(cardShell).join('')}</div>`}

    ${recents.length ? `<h2 class="section-title">Recent</h2><div class="place-cards" data-group="recents">${recents.map(cardShell).join('')}</div>` : ''}

    <h2 class="section-title">Explore</h2>
    <div class="quick-links">
      <a class="quick-link" href="#/map"><span class="ql-icon">${icon.map}</span><span><strong>Live pressure map</strong><span>Isobars, highs and lows, wind, and a 4-day animation</span></span></a>
      <a class="quick-link" href="#/world"><span class="ql-icon">${icon.globe}</span><span><strong>World rankings</strong><span>Highest, lowest and fastest-changing pressure today</span></span></a>
      <a class="quick-link" href="#/learn"><span class="ql-icon">${icon.book}</span><span><strong>Understanding pressure</strong><span>What the numbers mean, plus a unit converter</span></span></a>
    </div>

    <div id="install-slot"></div>

    <footer class="footer">Free and open source, with no ads and no tracking. Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</footer>
  </div>`;

  const showInstall = () => {
    if (!canInstall()) return;
    const slot = main.querySelector('#install-slot');
    if (!slot) return;
    slot.innerHTML = `<h2 class="section-title">Install</h2><div class="card install-card"><p>Add Pressure Map to your home screen for one-tap access. It opens like a native app.</p><button class="btn btn-primary" type="button">Install app</button></div>`;
    slot.querySelector('button').onclick = async () => { if (await promptInstall()) slot.innerHTML = ''; };
  };
  showInstall();
  window.addEventListener('installavailable', showInstall, { once: true });

  const all = [...main.querySelectorAll('.place-card')];
  const unique = [];
  all.forEach((el) => { if (!unique.some((u) => u.dataset.key === el.dataset.key)) unique.push(el); });
  const points = unique.map((el) => ({ lat: +el.dataset.lat, lon: +el.dataset.lon, key: el.dataset.key }));
  if (!points.length) return;

  const cacheKey = 'cards:' + points.map((p) => p.key).join('|');
  let results = cacheGet(cacheKey, 15 * 60e3);
  if (!results) {
    try {
      const r = await fetchMulti(points, { vars: ['pressure_msl', 'surface_pressure'], pastHours: 24, forecastHours: 48 });
      results = r.map((x, i) => ({ key: points[i].key, time: x.time, msl: x.series.pressure_msl, sp: x.series.surface_pressure }));
      cacheSet(cacheKey, results);
    } catch (e) {
      all.forEach((el) => { el.querySelector('.pc-trend').textContent = 'unavailable'; });
      main.querySelector('.place-cards')?.insertAdjacentHTML('beforebegin', `<div class="alert info" style="margin-bottom:12px">${icon.info}<div>${esc(e.message)}</div></div>`);
      return;
    }
  }
  const unit = settings.pressureUnit;
  const now = Date.now();
  results.forEach((r) => {
    const series = settings.pressureMode === 'station' ? r.sp : r.msl;
    const v = valueAt(r.time, series, now);
    const d3 = changeOver(r.time, series, now, 3);
    const tend = tendency(d3);
    const lvl = level(valueAt(r.time, r.msl, now));
    const nowIndex = r.time.findIndex((t) => t > now) - 1;
    main.querySelectorAll(`.place-card[data-key="${r.key}"]`).forEach((el) => {
      el.querySelector('.pc-value').innerHTML = `${fmtPressure(v, unit)}<small>${PRESSURE_UNITS[unit].label}</small><span class="pc-trend ${tend.key}">${trendIcon(tend).replace('<svg', '<svg width="13" height="13" style="display:inline;vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round"')} ${esc(tend.short)} ${fmtDelta(d3, unit)}</span>`;
      el.querySelector('.pc-spark').innerHTML = sparkline(series, { nowIndex: Math.max(0, nowIndex), color: lvl.key === 'normal' ? 'var(--accent)' : lvl.color });
      el.setAttribute('aria-label', `${el.dataset.name}: ${fmtPressure(v, unit, { withUnit: true })}, ${tend.label}`);
    });
  });
}

function cardShell(p) {
  return `<a class="place-card" href="${placeHref(p)}" data-key="${placeKey(p)}" data-lat="${p.lat}" data-lon="${p.lon}" data-name="${esc(p.name)}">
    <span class="pc-name">${esc(p.name)}</span>
    <span class="pc-value"><span class="skeleton" style="display:inline-block;width:64px;height:22px"></span><span class="pc-trend muted">&nbsp;</span></span>
    <span class="pc-region">${esc(p.region || '')}</span>
    <span class="pc-spark"></span>
  </a>`;
}
