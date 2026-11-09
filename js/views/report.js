// Conditions report builder: pick a place and a day, time window or date
// range, preview the report and download it as PDF or CSV.

import { fetchRange, searchPlaces, parseCoords, coordName, getPosition, reverseGeocode, isoDay, addDays, RANGE_LIMITS } from '../api.js';
import { settings, getLastPlace } from '../store.js';
import { buildReport, dailyBreakdown, zonedToEpoch, sourceText, DISCLAIMER } from '../report-data.js';
import { formatters, chartImages, hourlyColumns, summaryRows, highlights, dailyColumns, toCSV, toPDF } from '../report-export.js';
import { esc, icon, toast, dayKey, slug } from '../ui.js';
import { adSlot } from '../ads.js';

const STORE = 'bpm:report';
const MAX_DAYS = 31;

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* ignore */ }
}

const INCLUDE_DEFAULTS = { station: true, temp: true, wind: true, rain: true, summary: true, charts: true, daily: true, table: true };

export async function render(main, params) {
  const prefs = loadPrefs();
  const include = { ...INCLUDE_DEFAULTS, ...(prefs.include || {}) };
  const meta = { title: 'Environmental conditions report', site: '', preparedBy: '', notes: '', ...(prefs.meta || {}) };
  let place = params.lat && params.lon
    ? { lat: +params.lat, lon: +params.lon, name: params.name || coordName(+params.lat, +params.lon), region: params.region || '' }
    : prefs.place || getLastPlace();

  const today = isoDay(new Date());
  const check = (k, label) => `<label class="rf-check"><input type="checkbox" data-inc="${k}" ${include[k] ? 'checked' : ''}> ${label}</label>`;

  main.innerHTML = `<div class="page page-wide">
    <div class="page-head">
      <h1>Conditions report</h1>
      <p>Export pressure and weather for a place on a given day, during a time window (such as a site visit or monitoring round) or across a date range. Download it as a PDF or CSV.</p>
    </div>
    <div class="report-layout">
      <form class="card report-form" novalidate>
        <fieldset>
          <legend>Location</legend>
          <div class="rf-place" id="rf-place"></div>
          <div class="rf-search">
            <input class="input" id="rf-q" type="search" autocomplete="off" placeholder="Search a place or coordinates" aria-label="Search for a place">
            <ul class="rf-results" id="rf-results" hidden></ul>
          </div>
          <button type="button" class="btn btn-sm" id="rf-locate">${icon.locate} Use my location</button>
        </fieldset>

        <fieldset>
          <legend>When</legend>
          <div class="segmented rf-presets" role="group" aria-label="Quick periods">
            <button type="button" data-preset="today">Today</button>
            <button type="button" data-preset="yesterday">Yesterday</button>
            <button type="button" data-preset="last24">Last 24 h</button>
            <button type="button" data-preset="week">Last 7 days</button>
            <button type="button" data-preset="next24">Next 24 h</button>
          </div>
          <div class="rf-when">
            <label class="rf-field"><span>From</span><span class="rf-dt"><input class="input" type="date" id="rf-d0" min="${RANGE_LIMITS.earliest}" max="${addDays(today, RANGE_LIMITS.forecastDays)}"><input class="input" type="time" id="rf-t0" step="60"></span></label>
            <label class="rf-field"><span>To</span><span class="rf-dt"><input class="input" type="date" id="rf-d1" min="${RANGE_LIMITS.earliest}" max="${addDays(today, RANGE_LIMITS.forecastDays)}"><input class="input" type="time" id="rf-t1" step="60"></span></label>
          </div>
          <label class="rf-check"><input type="checkbox" id="rf-whole"> Whole days (midnight to midnight)</label>
          <p class="rf-help">Times are local to the location. Records go back to 1940, and forecasts up to ${RANGE_LIMITS.forecastDays} days ahead. Up to ${MAX_DAYS} days per report.</p>
        </fieldset>

        <fieldset>
          <legend>Include</legend>
          <div class="rf-checks">
            <label class="rf-check"><input type="checkbox" checked disabled> Sea-level pressure</label>
            ${check('station', 'Station pressure')}
            ${check('temp', 'Temperature and humidity')}
            ${check('wind', 'Wind')}
            ${check('rain', 'Rain, cloud and weather')}
          </div>
          <div class="rf-checks rf-sections">
            ${check('summary', 'Summary')}
            ${check('charts', 'Charts')}
            ${check('daily', 'Day-by-day table')}
            ${check('table', 'Hourly table')}
          </div>
        </fieldset>

        <details class="rf-details" ${meta.site || meta.preparedBy || meta.notes ? 'open' : ''}>
          <summary>Report details <span class="muted">(optional)</span></summary>
          <label class="rf-field"><span>Title</span><input class="input" id="rf-title" maxlength="80" value="${esc(meta.title)}"></label>
          <label class="rf-field"><span>Site or project</span><input class="input" id="rf-site" maxlength="80" placeholder="e.g. Site 4, quarterly round" value="${esc(meta.site)}"></label>
          <label class="rf-field"><span>Prepared by</span><input class="input" id="rf-by" maxlength="60" value="${esc(meta.preparedBy)}"></label>
          <label class="rf-field"><span>Notes</span><textarea class="input" id="rf-notes" rows="3" maxlength="1500" placeholder="Observations, sampling IDs, conditions on site…">${esc(meta.notes)}</textarea></label>
        </details>

        <p class="rf-error" id="rf-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary rf-submit">${icon.doc} Create report</button>
      </form>

      <section class="report-out" id="report-out" aria-live="polite">
        <div class="card report-empty">
          <div class="re-icon">${icon.doc}</div>
          <h2>Your report will appear here</h2>
          <p>Choose a place and a period, then select <strong>Create report</strong>. You can then download it as a PDF or a CSV spreadsheet, or print it.</p>
        </div>
      </section>
    </div>
    ${adSlot('banner', 'report-ad')}
  </div>`;

  const $ = (s) => main.querySelector(s);
  const d0 = $('#rf-d0'), d1 = $('#rf-d1'), t0 = $('#rf-t0'), t1 = $('#rf-t1'), whole = $('#rf-whole');
  const errEl = $('#rf-error');

  // ----- Place -----
  const renderPlace = () => {
    $('#rf-place').innerHTML = place
      ? `<span class="rf-pin">${icon.locate}</span><div><strong>${esc(place.name)}</strong><div class="muted small">${esc(place.region || '')}${place.region ? ' · ' : ''}${Math.abs(place.lat).toFixed(3)}°${place.lat >= 0 ? 'N' : 'S'}, ${Math.abs(place.lon).toFixed(3)}°${place.lon >= 0 ? 'E' : 'W'}</div></div>`
      : '<div class="muted">No place chosen yet. Search below or use your location.</div>';
  };
  renderPlace();

  const q = $('#rf-q'), results = $('#rf-results');
  let timer, abort;
  const pick = (p) => {
    place = p;
    renderPlace();
    results.hidden = true;
    q.value = '';
    savePrefs({ ...loadPrefs(), place });
  };
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const text = q.value.trim();
      const c = parseCoords(text);
      if (c) {
        results.innerHTML = `<li><button type="button" data-i="0">${esc(coordName(c.lat, c.lon))}<small>Coordinates</small></button></li>`;
        results.hidden = false;
        results._items = [{ ...c, name: coordName(c.lat, c.lon), region: '' }];
        return;
      }
      if (text.length < 2) { results.hidden = true; return; }
      abort?.abort();
      abort = new AbortController();
      try {
        const list = await searchPlaces(text, { signal: abort.signal });
        results._items = list;
        results.innerHTML = list.length
          ? list.map((p, i) => `<li><button type="button" data-i="${i}">${esc(p.name)}<small>${esc(p.region)}</small></button></li>`).join('')
          : `<li class="muted small" style="padding:8px 12px">No places found</li>`;
        results.hidden = false;
      } catch (e) { if (e.name !== 'AbortError') { results.innerHTML = `<li class="muted small" style="padding:8px 12px">${esc(e.message)}</li>`; results.hidden = false; } }
    }, 260);
  });
  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) pick(results._items[+b.dataset.i]);
  });
  $('#rf-locate').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const pos = await getPosition();
      const r = await reverseGeocode(pos.lat, pos.lon);
      pick({ ...pos, name: r.name, region: r.region });
    } catch (err) { toast(err.message, 4000); }
    b.disabled = false;
  };

  // ----- When -----
  const pad = (n) => String(n).padStart(2, '0');
  const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const setWhole = (on) => {
    whole.checked = on;
    t0.disabled = t1.disabled = on;
    if (on) { t0.value = '00:00'; t1.value = '23:59'; }
  };
  const presets = {
    today: () => { d0.value = d1.value = today; setWhole(true); },
    yesterday: () => { d0.value = d1.value = addDays(today, -1); setWhole(true); },
    last24: () => { setWhole(false); d0.value = addDays(today, -1); d1.value = today; t0.value = t1.value = nowHM(); },
    week: () => { d0.value = addDays(today, -6); d1.value = today; setWhole(true); },
    next24: () => { setWhole(false); d0.value = today; d1.value = addDays(today, 1); t0.value = t1.value = nowHM(); },
  };
  const markPreset = (k) => main.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.preset === k));
  main.querySelector('.rf-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    presets[b.dataset.preset]();
    markPreset(b.dataset.preset);
  });
  [d0, d1, t0, t1].forEach((el) => el.addEventListener('input', () => markPreset(null)));
  whole.addEventListener('change', () => { setWhole(whole.checked); markPreset(null); });
  d0.addEventListener('change', () => { if (d1.value && d1.value < d0.value) d1.value = d0.value; });

  // Start from the URL if it names a period, otherwise today.
  if (params.from && params.to) {
    const [a, at] = params.from.split('T'), [b, bt] = params.to.split('T');
    d0.value = a; d1.value = b; setWhole(!at && !bt); if (at) t0.value = at; if (bt) t1.value = bt;
  } else { presets.today(); markPreset('today'); }

  // ----- Include + details -----
  main.querySelectorAll('[data-inc]').forEach((cb) => cb.addEventListener('change', () => {
    include[cb.dataset.inc] = cb.checked;
    savePrefs({ ...loadPrefs(), include });
  }));
  const readMeta = () => ({
    title: $('#rf-title').value.trim() || 'Environmental conditions report',
    site: $('#rf-site').value.trim(),
    preparedBy: $('#rf-by').value.trim(),
    notes: $('#rf-notes').value.trim(),
  });
  main.querySelector('.rf-details').addEventListener('change', () => savePrefs({ ...loadPrefs(), meta: readMeta() }));

  // ----- Create -----
  let current = null;
  const showError = (msg) => { errEl.textContent = msg; errEl.hidden = !msg; };

  main.querySelector('.report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (!place) { showError('Choose a place first.'); q.focus(); return; }
    const a = d0.value, b = d1.value;
    const ta = whole.checked ? '00:00' : (t0.value || '00:00');
    const tb = whole.checked ? '23:59' : (t1.value || '23:59');
    if (!a || !b) { showError('Enter a start and end date.'); return; }
    if (b < a || (a === b && tb <= ta)) { showError('The end must be after the start.'); return; }
    if (a < RANGE_LIMITS.earliest) { showError('Records start on 1 January 1940.'); return; }
    if (b > addDays(today, RANGE_LIMITS.forecastDays)) { showError(`Forecasts only go ${RANGE_LIMITS.forecastDays} days ahead.`); return; }
    const days = (Date.parse(b) - Date.parse(a)) / 864e5 + 1;
    if (days > MAX_DAYS) { showError(`Please choose ${MAX_DAYS} days or fewer. For longer periods, make one report per month.`); return; }

    const m = readMeta();
    savePrefs({ ...loadPrefs(), meta: m, include, place });
    const btn = main.querySelector('.rf-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Fetching data…';
    const out = $('#report-out');
    try {
      const data = await fetchRange(place.lat, place.lon, a, b);
      const win = { t0: zonedToEpoch(a, ta, data.timezone), t1: zonedToEpoch(b, tb, data.timezone) };
      const report = buildReport(data, win);
      if (!report.rows.length && report.summary.msl.start == null) throw new Error('No data is available for that period.');
      const daily = dailyBreakdown(data, report, (t) => dayKey(t, data.timezone));
      const images = include.charts ? chartImages(data, report, settings, include) : [];
      const fullMeta = { ...m, placeName: place.name, region: place.region, source: sourceText(data.sources) };
      current = { data, report, settings, include: { ...include }, meta: fullMeta, images, daily, a, b };
      out.innerHTML = previewHTML(current);
      out.querySelector('[data-pdf]').onclick = downloadPDF;
      out.querySelector('[data-csv]').onclick = downloadCSV;
      out.querySelector('[data-print]').onclick = () => window.print();
      if (window.innerWidth < 1200) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon.doc} Create report`;
    }
  });

  const fileBase = () => {
    const c = current;
    return `conditions-report_${slug(c.meta.placeName) || 'location'}_${c.a}${c.b !== c.a ? `_to_${c.b}` : ''}`;
  };
  async function downloadPDF(e) {
    const b = e.currentTarget;
    const label = b.innerHTML;
    b.disabled = true;
    b.innerHTML = '<span class="spinner"></span> Building PDF…';
    try {
      const doc = await toPDF(current);
      doc.save(`${fileBase()}.pdf`);
    } catch (err) { toast(err.message || 'Could not create the PDF.', 4500); }
    b.disabled = false;
    b.innerHTML = label;
  }
  function downloadCSV() {
    const blob = new Blob([toCSV(current)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

function previewHTML(c) {
  const { data, report, settings, include, meta, images, daily } = c;
  const f = formatters(settings, data.timezone);
  const hcols = hourlyColumns(f, include);
  const dcols = dailyColumns(f, include);
  const span = report.hoursSpan < 48 ? `${+report.hoursSpan.toFixed(1)} hours` : `${+(report.hoursSpan / 24).toFixed(1)} days`;
  const info = [
    ['Location', `${meta.placeName}${meta.region ? `, ${meta.region}` : ''}`],
    ['Coordinates', `${Math.abs(data.lat).toFixed(4)}°${data.lat >= 0 ? 'N' : 'S'}, ${Math.abs(data.lon).toFixed(4)}°${data.lon >= 0 ? 'E' : 'W'} · ${Math.round(data.elevation)} m`],
    ['Period', f.period(report.t0, report.t1)],
    ['Duration', `${span} · ${report.rows.length} hourly values · ${data.timezone}`],
    ['Prepared by', meta.preparedBy || '–'],
    ['Data source', meta.source],
  ];
  return `
    <div class="card report-actions">
      <div><strong>Report ready</strong><div class="muted small">${esc(meta.placeName)} · ${esc(f.date(report.t0))}${report.hoursSpan > 24 ? ` to ${esc(f.date(report.t1))}` : ''}</div></div>
      <div class="ra-buttons">
        <button type="button" class="btn btn-primary btn-sm" data-pdf>${icon.download} Download PDF</button>
        <button type="button" class="btn btn-sm" data-csv>${icon.download} CSV</button>
        <button type="button" class="btn btn-sm" data-print>${icon.printer} Print</button>
      </div>
    </div>
    <article class="report-sheet">
      <header class="rs-head">
        <div><h2>${esc(meta.title)}</h2><div class="rs-sub">${esc(meta.site ? `${meta.site} · ${meta.placeName}` : meta.placeName)}</div></div>
      </header>
      <dl class="rs-info">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${include.summary ? `
        <h3>Summary</h3>
        <ul class="rs-highlights">${highlights(report, f, include).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
        <div class="table-scroll"><table class="rs-table">
          <thead><tr><th>Measure</th><th>Start</th><th>End</th><th>Min</th><th>Max</th><th>Mean</th><th>Change</th></tr></thead>
          <tbody>${summaryRows(report, f, include).map((r) => `<tr>${r.map((v, i) => (i ? `<td>${esc(v)}</td>` : `<th scope="row">${esc(v)}</th>`)).join('')}</tr>`).join('')}</tbody>
        </table></div>` : ''}
      ${include.charts && images.length ? `<h3>Charts</h3>${images.map((im) => `<img class="rs-chart" src="${im.src}" alt="${esc(im.title)} chart">`).join('')}` : ''}
      ${include.daily && daily.length > 1 ? `
        <h3>Day by day</h3>
        <div class="table-scroll"><table class="rs-table">
          <thead><tr>${dcols.map((col) => `<th>${esc(col.head)}</th>`).join('')}</tr></thead>
          <tbody>${daily.map((d) => `<tr>${dcols.map((col, i) => (i ? `<td>${esc(col.get(d))}</td>` : `<th scope="row">${esc(col.get(d))}</th>`)).join('')}</tr>`).join('')}</tbody>
        </table></div>` : ''}
      ${include.table ? `
        <h3>Hourly values</h3>
        <div class="table-scroll rs-hourly"><table class="rs-table">
          <thead><tr>${hcols.map((col) => `<th>${esc(col.head)}</th>`).join('')}</tr></thead>
          <tbody>${report.rows.map((r) => `<tr>${hcols.map((col, i) => (i ? `<td>${esc(col.get(r))}</td>` : `<th scope="row">${esc(col.get(r))}</th>`)).join('')}</tr>`).join('') || `<tr><td colspan="${hcols.length}">No whole hours fall inside this window. See the start and end values in the summary.</td></tr>`}</tbody>
        </table></div>` : ''}
      ${meta.notes ? `<h3>Notes</h3><p class="rs-notes">${esc(meta.notes)}</p>` : ''}
      <h3>About this data</h3>
      <p class="rs-about">${esc(DISCLAIMER)} Data: ${esc(meta.source)}. Licensed CC BY 4.0 by Open-Meteo.</p>
    </article>`;
}
