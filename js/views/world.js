// World rankings, computed in the browser from live data for ~170 cities.

import { settings } from '../store.js';
import { PRESSURE_UNITS, fmtPressure, fmtDelta } from '../units.js';
import { tendency } from '../analysis.js';
import { CITIES } from '../cities.js';
import { esc, relTime, placeHref } from '../ui.js';
import { addBaseLayers, pressureColor } from '../pressure-layer.js';
import { loadWorld } from '../world-data.js';

export async function render(main, params, { isActive }) {
  main.innerHTML = `<div class="page page-wide">
    <div class="page-head">
      <h1>World pressure rankings</h1>
      <p>Live sea-level pressure for ${CITIES.length} cities: where it's highest, lowest and changing fastest right now, and what the next 24 hours will bring.</p>
    </div>
    <div class="world-dash">
      <section class="card w-map"><div class="world-map" id="wmap"></div>
        <div class="chart-caption" id="wmeta"><span class="spinner"></span> Loading live data…</div>
      </section>
      <section class="w-leaders" aria-label="Leaderboards">
        <h2 class="section-title w-leaders-title">Leaderboards</h2>
        <div class="leader-grid" id="leaders">${Array.from({ length: 6 }, () => '<div class="card"><div class="skeleton" style="height:260px"></div></div>').join('')}</div>
      </section>
      <section class="card w-table" aria-label="All cities">
        <div class="card-head"><div><div class="card-title">All cities</div><div class="card-sub">Tap a column to sort</div></div></div>
        <div class="table-tools">
          <input class="input" type="search" id="wfilter" placeholder="Filter cities…" aria-label="Filter cities">
          <select class="input" id="wregion" aria-label="Region"><option value="">All regions</option>${[...new Set(CITIES.map((c) => c.r))].sort().map((r) => `<option>${esc(r)}</option>`).join('')}</select>
        </div>
        <div class="tall-scroll"><table class="data-table" id="wtable"></table></div>
      </section>
    </div>
    <footer class="footer">Rankings are recalculated in your browser from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> model data and cached for 45 minutes.</footer>
  </div>`;

  // Map
  const wide = window.innerWidth >= 1280;
  const map = L.map(main.querySelector('#wmap'), { worldCopyJump: true, minZoom: 1, scrollWheelZoom: false, zoomSnap: 0.5 })
    .setView([25, 10], window.innerWidth < 640 ? 1 : wide ? 2 : 2);
  const unbase = addBaseLayers(map);
  const cleanup = () => { unbase(); map.remove(); };

  let cities, fetchedAt;
  try {
    ({ cities, fetchedAt } = await loadWorld());
  } catch (e) {
    if (!isActive()) return cleanup;
    main.querySelector('#wmeta').innerHTML = `<span class="fall">${esc(e.message)}</span>`;
    main.querySelector('#leaders').innerHTML = '';
    return cleanup;
  }
  if (!isActive()) return cleanup;

  const unit = settings.pressureUnit;
  const U = PRESSURE_UNITS[unit];
  main.querySelector('#wmeta').innerHTML = `<span>Updated ${relTime(fetchedAt)}</span><span>Dot colour = sea-level pressure (blue high, red low). Tap a city for its forecast.</span>`;

  // Map markers
  cities.forEach((c) => {
    const tend = tendency(c.d3);
    L.circleMarker([c.lat, c.lon], { radius: 6, weight: 1.5, color: '#fff', fillColor: pressureColor(c.now), fillOpacity: 0.95 })
      .bindTooltip(`<strong>${esc(c.n)}</strong> ${fmtPressure(c.now, unit)} ${U.label}<br><span style="opacity:.75">${esc(tend.label)} ${fmtDelta(c.d3, unit)}/3 h</span>`, { direction: 'top' })
      .on('click', () => { location.hash = placeHref({ lat: c.lat, lon: c.lon, name: c.n, region: c.c }); })
      .addTo(map);
  });

  // Leaderboards
  const boards = [
    { title: 'Highest pressure now', sort: (a, b) => b.now - a.now, val: (c) => fmtPressure(c.now, unit, { withUnit: true }) },
    { title: 'Lowest pressure now', sort: (a, b) => a.now - b.now, val: (c) => fmtPressure(c.now, unit, { withUnit: true }) },
    { title: 'Rising fastest', sub: 'last 3 hours', filter: (c) => c.d3 != null, sort: (a, b) => b.d3 - a.d3, val: (c) => delta(c.d3, unit) },
    { title: 'Falling fastest', sub: 'last 3 hours', filter: (c) => c.d3 != null, sort: (a, b) => a.d3 - b.d3, val: (c) => delta(c.d3, unit) },
    { title: 'Biggest rise ahead', sub: 'next 24 hours', filter: (c) => c.net24 != null, sort: (a, b) => b.net24 - a.net24, val: (c) => delta(c.net24, unit) },
    { title: 'Biggest drop ahead', sub: 'next 24 hours', filter: (c) => c.net24 != null, sort: (a, b) => a.net24 - b.net24, val: (c) => delta(c.net24, unit) },
    { title: 'Most stable', sub: 'smallest range, next 24 h', filter: (c) => c.next, sort: (a, b) => a.next.range - b.next.range, val: (c) => fmtPressure(c.next.range, unit, { withUnit: true }) },
    { title: 'Wildest swings', sub: 'largest range, next 24 h', filter: (c) => c.next, sort: (a, b) => b.next.range - a.next.range, val: (c) => fmtPressure(c.next.range, unit, { withUnit: true }) },
    { title: 'Biggest change since yesterday', sub: 'vs 24 hours ago, up or down', filter: (c) => c.d24 != null, sort: (a, b) => Math.abs(b.d24) - Math.abs(a.d24), val: (c) => delta(c.d24, unit) },
  ];
  main.querySelector('#leaders').innerHTML = boards.map((b) => {
    const list = cities.filter(b.filter || (() => true)).sort(b.sort).slice(0, wide ? 10 : 8);
    return `<section class="card"><div class="card-head"><div><div class="card-title">${esc(b.title)}</div>${b.sub ? `<div class="card-sub">${esc(b.sub)}</div>` : ''}</div></div>
      <ol class="leader-list">${list.map((c, i) => `<li><span class="rank">${i + 1}</span><a href="${placeHref({ lat: c.lat, lon: c.lon, name: c.n, region: c.c })}">${esc(c.n)}<small>${esc(c.c)}</small></a><span class="lv">${b.val(c)}</span></li>`).join('')}</ol></section>`;
  }).join('');

  // Table
  const cols = [
    { k: 'n', label: 'City', get: (c) => c.n, fmt: (c) => `<a href="${placeHref({ lat: c.lat, lon: c.lon, name: c.n, region: c.c })}">${esc(c.n)}</a> <span class="muted">${esc(c.c)}</span>` },
    { k: 'now', label: `Now (${U.label})`, r: 1, get: (c) => c.now, fmt: (c) => fmtPressure(c.now, unit) },
    { k: 'd3', label: '3 h', r: 1, get: (c) => c.d3 ?? 0, fmt: (c) => delta(c.d3, unit) },
    { k: 'd24', label: '24 h ago', r: 1, get: (c) => c.d24 ?? 0, fmt: (c) => delta(c.d24, unit) },
    { k: 'net24', label: 'Next 24 h', r: 1, get: (c) => c.net24 ?? 0, fmt: (c) => delta(c.net24, unit) },
    { k: 'range', label: 'Range ahead', r: 1, get: (c) => c.next?.range ?? 0, fmt: (c) => fmtPressure(c.next?.range, unit) },
  ];
  let sortKey = 'now', sortDir = -1;
  const filterEl = main.querySelector('#wfilter'), regionEl = main.querySelector('#wregion');
  const renderTable = () => {
    const q = filterEl.value.trim().toLowerCase();
    const reg = regionEl.value;
    const col = cols.find((c) => c.k === sortKey);
    const list = cities
      .filter((c) => (!q || `${c.n} ${c.c}`.toLowerCase().includes(q)) && (!reg || c.r === reg))
      .sort((a, b) => {
        const x = col.get(a), y = col.get(b);
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
      });
    main.querySelector('#wtable').innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c.r ? 'r' : ''}" data-k="${c.k}" ${c.k === sortKey ? `aria-sort="${sortDir > 0 ? 'ascending' : 'descending'}"` : ''}>${esc(c.label)}${c.k === sortKey ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.map((c) => `<tr>${cols.map((col2) => `<td class="${col2.r ? 'r' : ''}">${col2.fmt(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  };
  main.querySelector('#wtable').addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;
    if (sortKey === th.dataset.k) sortDir = -sortDir;
    else { sortKey = th.dataset.k; sortDir = th.dataset.k === 'n' ? 1 : -1; }
    renderTable();
  });
  filterEl.addEventListener('input', renderTable);
  regionEl.addEventListener('change', renderTable);
  renderTable();

  return cleanup;
}

function delta(d, unit) {
  if (d == null) return '–';
  const cls = Math.abs(d) < 0.5 ? 'steady' : d > 0 ? 'rise' : 'fall';
  return `<span class="${cls}">${fmtDelta(d, unit)}</span>`;
}
