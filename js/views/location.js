// Place dashboard: current reading, dial, history/forecast chart, outlooks,
// daily breakdown, current conditions and a local isobar map.

import { fetchForecast, reverseGeocode, coordName } from '../api.js';
import { settings, updateSettings, isFavorite, toggleFavorite, addRecent, setLastPlace } from '../store.js';
import { PRESSURE_UNITS, convertPressure, fmtPressure, fmtDelta, fmtTemp, fmtWind, fmtPrecip, compass, convertTemp, convertWind, TEMP_UNITS, WIND_UNITS } from '../units.js';
import { HOUR, indexAt, valueAt, changeOver, tendency, level, zambretti, windowStats, swingLevel, SWING_LABELS, fishing, alerts } from '../analysis.js';
import { esc, icon, trendIcon, toast, fmtClock, fmtHour, fmtDayFull, fmtWeekday, fmtDayHour, fmtDateTime, relTime, dayKey, placeHref } from '../ui.js';
import { wxIcon, wxText } from '../wx.js';
import { gaugeSVG, animateGauge } from '../gauge.js';
import { createPressureChart } from '../charts.js';
import { grid, createPressureLayer, addBaseLayers, PAST_H, STATIC_MAP } from '../pressure-layer.js';
import { adSlot } from '../ads.js';

const RANGES = {
  '3d': { label: '3 days', back: 1, fwd: 2 },
  '7d': { label: 'Week', back: 2, fwd: 5 },
  '14d': { label: '2 weeks', back: 7, fwd: 7 },
  '30d': { label: 'Month', back: 14, fwd: 16 },
};
const OVERLAYS = {
  none: 'Pressure only',
  temp: 'Temperature',
  rh: 'Humidity',
  wind: 'Wind',
  pp: 'Rain chance',
};

export async function render(main, params, { isActive }) {
  const lat = Number(params.lat), lon = Number(params.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    main.innerHTML = `<div class="page"><div class="card error-card"><h2>Unknown place</h2><p>That link doesn't contain valid coordinates.</p><button class="btn btn-primary" data-action="search">Search for a place</button></div></div>`;
    return;
  }
  const place = { lat, lon, name: params.name || '', region: params.region || '', here: params.here === '1' };
  const cleanups = [];

  main.innerHTML = skeleton(place);

  // Fill in a name if the link didn't carry one.
  if (!place.name || /^-?\d/.test(place.name)) {
    reverseGeocode(lat, lon).then((r) => {
      if (!isActive() || !r) return;
      place.name = r.name; place.region = r.region;
      const h = main.querySelector('.loc-head h1');
      if (h) h.textContent = place.name;
      const rg = main.querySelector('.loc-region');
      if (rg) rg.textContent = place.region;
      history.replaceState(null, '', placeHref(place));
      addRecent(place);
      setLastPlace(place);
    });
  }
  if (place.name) { addRecent(place); setLastPlace(place); }

  let data;
  try {
    data = await fetchForecast(lat, lon);
  } catch (e) {
    if (!isActive()) return;
    main.innerHTML = `<div class="page"><div class="card error-card"><h2>Couldn't load the forecast</h2><p>${esc(e.message)}</p><button class="btn btn-primary" id="retry">${icon.refresh} Try again</button></div></div>`;
    main.querySelector('#retry').onclick = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if (!isActive()) return;

  const view = buildView(main, place, data, cleanups);
  cleanups.push(view);
  return () => cleanups.forEach((fn) => { try { typeof fn === 'function' ? fn() : fn?.destroy?.(); } catch { /* ignore */ } });
}

function skeleton(place) {
  return `<div class="page page-wide">
    <div class="loc-head"><div><h1>${esc(place.name || 'Loading…')}</h1><div class="loc-meta"><span class="loc-region">${esc(place.region)}</span></div></div></div>
    <div class="card"><div class="skeleton" style="height:210px"></div></div>
    <div class="card" style="margin-top:16px"><div class="skeleton" style="height:320px"></div></div>
  </div>`;
}

function buildView(main, place, data, cleanups) {
  const unit = settings.pressureUnit;
  const U = PRESSURE_UNITS[unit];
  const mode = settings.pressureMode;
  const tz = data.timezone;
  const H = data.hourly;
  const times = H.time;
  const series = mode === 'station' ? H.sp : H.msl;
  const msl = H.msl;
  const now = Math.min(Math.max(Date.now(), times[0]), times[times.length - 1]);

  const cur = data.current;
  const nowP = (mode === 'station' ? cur.sp : cur.msl) ?? valueAt(times, series, now);
  const nowMsl = cur.msl ?? valueAt(times, msl, now);
  const dp3 = changeOver(times, series, now, 3);
  const tend = tendency(dp3);
  const lvl = level(nowMsl);
  const past24 = valueAt(times, series, now - 24 * HOUR);
  const fut24 = valueAt(times, series, now + 24 * HOUR);
  const next24 = windowStats(times, series, now, now + 24 * HOUR);
  const next48 = windowStats(times, series, now, now + 48 * HOUR);
  const zam = zambretti(nowMsl, changeOver(times, msl, now, 3));
  const fish = fishing(lvl, tend, next24?.net);
  const notes = alerts(times, msl, now, place.lat);
  const fav = isFavorite(place);

  const meta = [
    place.region ? `<span class="loc-region">${esc(place.region)}</span>` : '<span class="loc-region"></span>',
    `<span>${fmtClock(Date.now(), tz)} local · ${esc(data.tzAbbr || '')}</span>`,
    `<span>${Math.abs(place.lat).toFixed(2)}°${place.lat >= 0 ? 'N' : 'S'}, ${Math.abs(place.lon).toFixed(2)}°${place.lon >= 0 ? 'E' : 'W'}</span>`,
    data.elevation != null ? `<span>${Math.round(data.elevation)} m elevation</span>` : '',
  ].join('');

  const deltaChip = (d) => {
    if (d == null) return '';
    const cls = Math.abs(d) < 0.5 ? 'steady' : d > 0 ? 'rise' : 'fall';
    return `<span class="d ${cls}">${fmtDelta(d, unit)}</span>`;
  };

  const notesHtml = notes.map((n) => {
    const when = n.t ? ` around <strong style="display:inline">${esc(fmtDayHour(n.t, tz))}</strong>` : '';
    let text = n.text;
    if (!text && n.kind === 'drop') text = `Pressure is forecast to fall ${fmtDelta(n.d, unit, { withUnit: true })} in three hours${when}. Expect wind and unsettled weather. If pressure changes affect your health, plan ahead.`;
    if (!text && n.kind === 'rise') text = `A rise of ${fmtDelta(n.d, unit, { withUnit: true })} in three hours is forecast${when}, typically clearing weather behind a front, often with gusty winds.`;
    if (!text && n.kind === 'swing') text = `Pressure will move through a ${fmtPressure(n.d, unit)} ${U.label} range over the next day.`;
    return `<div class="alert ${n.level === 'info' ? 'info' : ''}">${n.level === 'info' ? icon.info : icon.alert}<div><strong>${esc(n.title)}</strong>${text}</div></div>`;
  }).join('');

  const staleHtml = data.stale
    ? `<div class="alert info">${icon.info}<div><strong>Showing saved data from ${relTime(data.fetchedAt)}</strong>${esc(data.staleReason || '')}</div></div>`
    : '';

  // Daily rows
  const todayKey = dayKey(Date.now(), tz);
  const days = data.daily.time.map((t, i) => {
    const end = data.daily.time[i + 1] || t + 24 * HOUR;
    const s = windowStats(times, series, t, end);
    return { i, t, end, s, key: dayKey(t + 12 * HOUR, tz) };
  }).filter((d) => d.s);
  const todayIdx = Math.max(0, days.findIndex((d) => d.key === todayKey));

  main.innerHTML = `<div class="page page-wide">
    <div class="loc-head">
      <div>
        <div class="now-label">${place.here ? `${icon.locate.replace('<svg', '<svg width="14" height="14" style="display:inline;vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:2"')} Your location` : 'Barometric pressure'}</div>
        <h1>${esc(place.name || coordName(place.lat, place.lon))}</h1>
        <div class="loc-meta">${meta}</div>
      </div>
      <div class="loc-actions">
        <button class="icon-btn fav-btn" type="button" aria-pressed="${fav}" aria-label="${fav ? 'Remove from' : 'Add to'} favourites" title="Favourite">${icon.star}</button>
        <a class="btn btn-sm report-btn" href="#/report?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}&name=${encodeURIComponent(place.name || '')}${place.region ? `&region=${encodeURIComponent(place.region)}` : ''}" title="Create a PDF report for a date or time window">${icon.doc} Report</a>
        <button class="icon-btn" type="button" data-share aria-label="Share" title="Share">${icon.share}</button>
        <button class="icon-btn" type="button" data-refresh aria-label="Refresh" title="Refresh">${icon.refresh}</button>
      </div>
    </div>

    <div class="dash">
    ${staleHtml ? `<div class="dash-stale">${staleHtml}</div>` : ''}

    <section class="card hero-card dash-hero" aria-label="Current pressure">
      <div class="hero-main">
        <div class="now-label">Now · ${mode === 'station' ? 'station pressure' : 'sea-level pressure'} <span class="chip" style="--dot:${lvl.color}">${esc(lvl.label)}</span></div>
        <div class="big-value"><span class="v">${fmtPressure(nowP, unit)}</span><span class="u">${U.label}</span></div>
        <div class="trend-line ${tend.key}">
          <span class="trend-arrow ${tend.key}">${trendIcon(tend)}</span>
          <span>${esc(tend.label)}</span>
          <span class="muted small num">${fmtDelta(dp3, unit, { withUnit: true })} in 3 h</span>
        </div>
        <p class="muted small" style="margin:10px 0 0;max-width:46ch">${esc(lvl.desc)}</p>
        <div class="mini-stats">
          <div class="mini-stat"><div class="k">24 h ago</div><div class="val">${fmtPressure(past24, unit)}</div>${deltaChip(past24 != null ? nowP - past24 : null)}</div>
          <div class="mini-stat"><div class="k">In 24 h</div><div class="val">${fmtPressure(fut24, unit)}</div>${deltaChip(fut24 != null ? fut24 - nowP : null)}</div>
          <div class="mini-stat"><div class="k">Next 24 h</div><div class="val">${next24 ? `${fmtPressure(next24.min, unit)}–${fmtPressure(next24.max, unit, { dp: U.dp })}` : '–'}</div><span class="d muted">range ${next24 ? fmtPressure(next24.range, unit) : '–'}</span></div>
        </div>
      </div>
      <div class="gauge-wrap">
        ${gaugeSVG({ now: nowP, past: past24, future: fut24, unit, mode })}
        <div class="gauge-legend"><span><i style="background:#c79a2b"></i>24 h ago</span><span><i style="background:var(--accent)"></i>In 24 h (forecast)</span></div>
      </div>
      <div class="hourly-wrap">
        <div class="hourly-label">Next 24 hours</div>
        <div class="hourly" id="hourly"></div>
      </div>
    </section>


    <section class="card dash-cond" aria-label="Current conditions">
      <div class="card-head"><div><div class="card-title">Current conditions</div><div class="card-sub">Updated ${relTime(data.fetchedAt)}</div></div></div>
      <div class="wx-now">${wxIcon(cur.wc, cur.isDay, 'wx-icon')}<div><div class="t">${fmtTemp(cur.temp, settings.tempUnit)}</div><div class="desc">${esc(wxText(cur.wc))} · feels like ${fmtTemp(cur.feels, settings.tempUnit)}</div></div></div>
      <div class="conditions">
        ${cond(icon.gauge, 'Sea-level pressure', fmtPressure(cur.msl, unit, { withUnit: true }), 'used on weather maps')}
        ${cond(icon.mountain, 'Station pressure', fmtPressure(cur.sp, unit, { withUnit: true }), data.elevation != null ? `at ${Math.round(data.elevation)} m` : '')}
        ${cond(icon.drop, 'Humidity', cur.rh != null ? `${Math.round(cur.rh)}%` : '–', 'relative humidity')}
        ${cond(icon.thermo, 'Dew point', fmtTemp(cur.dew, settings.tempUnit), cur.temp != null && cur.dew != null && cur.temp - cur.dew < 2.5 ? 'fog or mist likely' : 'moisture in the air')}
        ${cond(icon.wind, 'Wind', `${fmtWind(cur.ws, settings.windUnit)}`, `${compass(cur.wd)} · gusts ${fmtWind(cur.wg, settings.windUnit)}`)}
        ${cond(icon.cloud, 'Cloud cover', cur.cc != null ? `${Math.round(cur.cc)}%` : '–', '')}
        ${cond(icon.drop, 'Precipitation', fmtPrecip(cur.pr, settings.precipUnit), 'last 15 min')}
        ${data.daily.sunrise[todayIdxIn(data, tz)] ? cond(icon.sunrise, 'Sunrise / sunset', `${fmtClock(data.daily.sunrise[todayIdxIn(data, tz)], tz)}`, `sets ${fmtClock(data.daily.sunset[todayIdxIn(data, tz)], tz)}`) : ''}
      </div>
      <p class="today-sum">Today: high <strong>${fmtTemp(data.daily.tmax[todayIdxIn(data, tz)], settings.tempUnit)}</strong>, low <strong>${fmtTemp(data.daily.tmin[todayIdxIn(data, tz)], settings.tempUnit)}</strong> · ${esc(wxText(data.daily.wc[todayIdxIn(data, tz)]).toLowerCase())} · rain chance ${data.daily.ppmax[todayIdxIn(data, tz)] ?? '–'}% · wind up to ${fmtWind(data.daily.wsmax[todayIdxIn(data, tz)], settings.windUnit)}</p>
    </section>

    ${notesHtml ? `<div class="dash-alerts">${notesHtml}</div>` : ''}

    <section class="card dash-chart" aria-label="Pressure chart">
      <div class="card-head">
        <div><div class="card-title">History &amp; forecast</div><div class="card-sub">Past 14 days and next 16 days, hourly. Tap or hover for values.</div></div>
        <div class="spacer"></div>
      </div>
      <div class="chart-controls">
        <div class="segmented" role="group" aria-label="Time range" data-ctl="range">${Object.entries(RANGES).map(([k, r]) => `<button type="button" data-v="${k}" aria-pressed="${k === (settings.chartRange || '7d')}">${r.label}</button>`).join('')}</div>
        <div class="segmented" role="group" aria-label="Overlay" data-ctl="overlay">${Object.entries(OVERLAYS).map(([k, label]) => `<button type="button" data-v="${k}" aria-pressed="${k === (settings.chartOverlay || 'none')}">${label}</button>`).join('')}</div>
        <div class="segmented" role="group" aria-label="Pressure type" data-ctl="mode"><button type="button" data-v="msl" aria-pressed="${mode === 'msl'}">Sea level</button><button type="button" data-v="station" aria-pressed="${mode === 'station'}">Station</button></div>
      </div>
      <div class="chart-box main"><canvas id="pchart" aria-label="Pressure history and forecast chart" role="img"></canvas></div>
      <div class="chart-caption">
        <span><i></i>Observed / analysed</span>
        <span><i class="dash"></i>Forecast</span>
        ${mode === 'msl' ? '<span><i class="band"></i>Normal range</span>' : ''}
        <span><i class="bars"></i>3-hour change (lower panel)</span>
      </div>
    </section>

    ${adSlot('banner', 'dash-ad1')}

    <section class="dash-outlook" aria-label="Outlook">
    <h2 class="section-title" style="margin-top:8px">Outlook</h2>
    <div class="outlook-grid">
      ${zam ? `<section class="card outlook">
        <div class="o-kicker">${icon.gauge} Barometer says</div>
        <div class="o-title">${esc(zam.text)}</div>
        <p>From ${zam.trend} pressure of ${fmtPressure(nowMsl, unit, { withUnit: true })}, using the Zambretti method, a forecasting rule built into Victorian brass barometers.</p>
        <div class="o-foot">Best for the next ~12 hours in mid-latitudes. Compare with the model forecast below.</div>
      </section>` : ''}
      <section class="card outlook">
        <div class="o-kicker">${icon.heart} Pressure swings</div>
        <div class="o-title">${SWING_LABELS[swingLevel(next24)]} next 24 h</div>
        <ul class="swing-list" aria-label="Pressure swing by day">${days.slice(todayIdx, todayIdx + 5).map((d) => {
          const l = swingLevel(d.s);
          return `<li><span class="sw-day">${d.key === todayKey ? 'Today' : esc(fmtWeekday(d.t + 12 * HOUR, tz))}</span>${meter(l)}<span class="sw-label">${SWING_LABELS[l]}</span><span class="sw-range num">${fmtPressure(d.s.range, unit)} ${U.label}</span></li>`;
        }).join('')}</ul>
        <p>${swingText(next24, unit)}</p>
        <div class="o-foot">For people sensitive to weather: migraines, joint pain, sinus pressure. This is a heads-up, not medical advice.</div>
      </section>
      <section class="card outlook">
        <div class="o-kicker">${icon.fish} Angler's outlook</div>
        <div class="o-title">${esc(fish.rating)}</div>
        <p>${esc(fish.text)}</p>
        <div class="o-foot">Angler lore. Water temperature, light and tides matter too.</div>
      </section>
      <section class="card outlook">
        <div class="o-kicker">${icon.wave} Next 48 hours</div>
        ${next48 ? `<div class="o-title">${next48.net > 0.5 ? 'Rising' : next48.net < -0.5 ? 'Falling' : 'Little change'} overall, ${fmtDelta(next48.net, unit, { withUnit: true })}</div>
        <p>Low of <strong>${fmtPressure(next48.min, unit, { withUnit: true })}</strong> ${esc(fmtDayHour(next48.tMin, tz))}, high of <strong>${fmtPressure(next48.max, unit, { withUnit: true })}</strong> ${esc(fmtDayHour(next48.tMax, tz))}.</p>
        <p>${next48.maxDrop < -0.5 ? `Fastest fall ${fmtDelta(next48.maxDrop, unit)} per 3 h, by ${esc(fmtDayHour(next48.tDrop, tz))}. ` : ''}${next48.maxRise > 0.5 ? `Fastest rise ${fmtDelta(next48.maxRise, unit)} per 3 h, by ${esc(fmtDayHour(next48.tRise, tz))}.` : ''}</p>` : '<p>No forecast data.</p>'}
      </section>
    </div>
    </section>

    <section class="card dash-daily" aria-label="Day by day">
      <div class="card-head"><div><div class="card-title">Day by day</div><div class="card-sub">${mode === 'station' ? 'Station' : 'Sea-level'} pressure, ${U.label}</div></div></div>
      <div class="table-scroll"><table class="daily" id="daily"></table></div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-sm" type="button" id="toggle-past">Show past 2 weeks</button>
      </div>
    </section>

    ${adSlot('banner', 'dash-ad2')}

    <div class="dash-side">
    <section class="card dash-map" aria-label="Pressure map">
      <div class="card-head"><div><div class="card-title">Pressure map</div><div class="card-sub">Isobars around ${esc(place.name || 'this place')}</div></div></div>
      <div class="mini-map" id="minimap"><div class="skeleton" style="height:100%"></div></div>
      <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center">
        <span class="muted small">Blue = high pressure, red = low. Lines join points of equal pressure.</span>
      </div>
    </section>
    ${adSlot('box', 'dash-adbox')}
    </div>
    </div>

    <footer class="footer">Weather data from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (national weather service models), updated hourly. Times shown in ${esc(tz)}. · <a href="privacy.html">Privacy</a></footer>
  </div>`;

  animateGauge(main);

  // ----- Chart -----
  const f = U.factor;
  const conv = (arr) => arr.map((v) => (v == null ? null : v * f));
  const values = conv(series);
  const change3 = series.map((v, i) => (i >= 3 && v != null && series[i - 3] != null ? (v - series[i - 3]) * f : null));
  const overlayFor = (key) => {
    switch (key) {
      case 'temp': return { label: 'Temperature', color: '#f08c2e', values: H.temp.map((v) => convertTemp(v, settings.tempUnit)), fmt: (v) => `${Math.round(v)}${TEMP_UNITS[settings.tempUnit].label}`, tick: (v) => `${Math.round(v)}°`, minPad: 1 };
      case 'rh': return { label: 'Humidity', color: '#14a3b8', values: H.rh, fmt: (v) => `${Math.round(v)}%`, tick: (v) => `${v}%`, fixed: [0, 100] };
      case 'wind': return { label: 'Wind', color: '#22a06b', values: H.ws.map((v) => convertWind(v, settings.windUnit)), fmt: (v) => `${Math.round(v)} ${WIND_UNITS[settings.windUnit].label}`, tick: (v) => `${Math.round(v)}`, floor: 0, minPad: 2 };
      case 'pp': return { label: 'Rain chance', color: '#3b82f6', type: 'bar', values: H.pp, fmt: (v) => `${Math.round(v)}%`, tick: (v) => `${v}%`, fixed: [0, 100] };
      default: return null;
    }
  };
  const rangeFor = (k) => {
    const r = RANGES[k] || RANGES['7d'];
    return [Math.max(times[0], now - r.back * 24 * HOUR), Math.min(times[times.length - 1], now + r.fwd * 24 * HOUR)];
  };
  let rangeKey = RANGES[settings.chartRange] ? settings.chartRange : '7d';
  let overlayKey = OVERLAYS[settings.chartOverlay] ? settings.chartOverlay : 'none';
  let chart;
  const makeChart = () => {
    chart?.destroy();
    chart = createPressureChart(main.querySelector('#pchart'), {
      times, values, change3, now, tz,
      dayStarts: data.daily.time,
      band: mode === 'msl' ? [1009 * f, 1023 * f] : null,
      unitLabel: U.label, dp: U.dp, ddp: U.ddp,
      thresholds: [1.6 * f, 3.6 * f],
      minPad: 1.5 * f,
      range: rangeFor(rangeKey),
      overlay: overlayFor(overlayKey),
    });
  };
  makeChart();
  const onTheme = () => makeChart();
  window.addEventListener('themechange', onTheme);
  cleanups.push(() => window.removeEventListener('themechange', onTheme));
  cleanups.push(() => chart?.destroy());

  main.querySelectorAll('.chart-controls .segmented').forEach((segEl) => {
    segEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const ctl = segEl.dataset.ctl, v = b.dataset.v;
      if (ctl === 'mode') { updateSettings({ pressureMode: v }); return; }
      segEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      if (ctl === 'range') { rangeKey = v; settings.chartRange = v; updateSilently({ chartRange: v }); chart.setRange(...rangeFor(v)); }
      if (ctl === 'overlay') { overlayKey = v; updateSilently({ chartOverlay: v }); chart.setOverlay(overlayFor(v)); }
    });
  });

  // ----- Daily table -----
  let showPast = false;
  const renderDaily = () => {
    const rows = days.filter((d, i) => (showPast ? true : i >= todayIdx - 1));
    const gmin = Math.min(...rows.map((d) => d.s.min));
    const gmax = Math.max(...rows.map((d) => d.s.max));
    const pct = (v) => ((v - gmin) / Math.max(0.1, gmax - gmin)) * 100;
    main.querySelector('#daily').innerHTML = `<thead><tr><th>Day</th><th>Weather</th><th class="hide-sm">Temp</th><th>Pressure range</th><th>Change</th><th class="hide-sm">Swing</th></tr></thead><tbody>${rows.map((d) => {
      const cls = d.key === todayKey ? 'today' : d.i < days[todayIdx].i ? 'past' : '';
      const net = d.s.net;
      const ncls = Math.abs(net) < 1 ? 'steady' : net > 0 ? 'rise' : 'fall';
      const l = swingLevel(d.s);
      const wc = data.daily.wc[d.i];
      return `<tr class="${cls}">
        <td class="day">${d.key === todayKey ? 'Today' : esc(fmtWeekday(d.t + 12 * HOUR, tz))}<small>${esc(fmtDayFull(d.t + 12 * HOUR, tz).replace(/^\S+\s/, ''))}</small></td>
        <td><div class="wx">${wxIcon(wc, 1)}<span class="hide-sm">${esc(wxText(wc))}</span></div></td>
        <td class="hide-sm num">${fmtTemp(data.daily.tmax[d.i], settings.tempUnit)} <span class="muted">${fmtTemp(data.daily.tmin[d.i], settings.tempUnit)}</span></td>
        <td><div class="range-cell"><span class="lo num">${fmtPressure(d.s.min, unit)}</span><span class="range-bar"><i style="left:${pct(d.s.min).toFixed(1)}%;right:${(100 - pct(d.s.max)).toFixed(1)}%"></i></span><span class="hi num">${fmtPressure(d.s.max, unit)}</span></div></td>
        <td class="num ${ncls}" style="font-weight:650;white-space:nowrap">${fmtDelta(net, unit)}</td>
        <td class="hide-sm"><span class="swing-cell">${meter(l)}${SWING_LABELS[l]}</span></td>
      </tr>`;
    }).join('')}</tbody>`;
    main.querySelector('#toggle-past').textContent = showPast ? 'Hide past days' : 'Show past 2 weeks';
  };
  renderDaily();
  main.querySelector('#toggle-past').onclick = () => { showPast = !showPast; renderDaily(); };

  // ----- Next 24 hours strip -----
  const hourlyEl = main.querySelector('#hourly');
  if (hourlyEl) {
    const i0 = indexAt(times, now);
    const cells = [];
    for (let k = 1; k <= 8; k++) {
      const i = i0 + k * 3;
      if (i >= times.length) break;
      const t = times[i];
      const di = data.daily.time.findIndex((d, n) => t >= d && t < (data.daily.time[n + 1] ?? Infinity));
      const rise = data.daily.sunrise[di], set = data.daily.sunset[di];
      const isDay = rise && set ? t >= rise && t < set : 1;
      const d3 = series[i] != null && series[i - 3] != null ? series[i] - series[i - 3] : null;
      const cls = d3 == null || Math.abs(d3) < 0.5 ? 'steady' : d3 > 0 ? 'rise' : 'fall';
      cells.push(`<div class="hr"><span class="hr-t">${esc(fmtHour(t, tz))}</span>${wxIcon(H.wc[i], isDay ? 1 : 0)}<span class="hr-temp">${fmtTemp(H.temp[i], settings.tempUnit)}</span><span class="hr-p num">${fmtPressure(series[i], unit)}</span><span class="hr-d num ${cls}">${fmtDelta(d3, unit)}</span></div>`);
    }
    hourlyEl.innerHTML = cells.join('');
  }

  // ----- Header actions -----
  const favBtn = main.querySelector('.fav-btn');
  favBtn.onclick = () => {
    const on = toggleFavorite(place);
    favBtn.setAttribute('aria-pressed', on);
    favBtn.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} favourites`);
    toast(on ? `★ ${place.name} added to favourites` : `Removed ${place.name} from favourites`);
  };
  main.querySelector('[data-share]').onclick = async () => {
    const url = location.href;
    const text = `${place.name}: ${fmtPressure(nowP, unit, { withUnit: true })}, ${tend.label.toLowerCase()}`;
    try {
      if (navigator.share) await navigator.share({ title: `Pressure in ${place.name}`, text, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    } catch { /* cancelled */ }
  };
  main.querySelector('[data-refresh]').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await fetchForecast(place.lat, place.lon, { force: true });
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) { toast(err.message, 4000); b.disabled = false; }
  };

  // ----- Mini map (loads when scrolled into view) -----
  const mapEl = main.querySelector('#minimap');
  let map = null;
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((en) => en.isIntersecting)) return;
    io.disconnect();
    mapEl.innerHTML = '';
    // A fixed view: one data load, no panning or zooming (keeps API use low).
    map = L.map(mapEl, STATIC_MAP).setView([place.lat, place.lon], 5);
    cleanups.push(addBaseLayers(map));
    const layer = createPressureLayer({ isobars: true, centers: true, cities: true }).addTo(map);
    L.marker([place.lat, place.lon], { icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map);
    let ctrl = null;
    const load = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const field = await grid.field(map.getBounds().pad(0.1), { signal: ctrl.signal, maxPoints: 36 });
        layer.setTime(PAST_H + Math.round((Date.now() - (grid.base + PAST_H * HOUR)) / HOUR));
        layer.setField(field);
      } catch (e) { if (e.name !== 'AbortError') console.warn(e); }
    };
    map.on('resize', debounce(load, 450));
    load();
  }, { rootMargin: '200px' });
  io.observe(mapEl);
  cleanups.push(() => { io.disconnect(); map?.remove(); });

  return null;
}

function todayIdxIn(data, tz) {
  const k = dayKey(Date.now(), tz);
  const i = data.daily.time.findIndex((t) => dayKey(t + 12 * HOUR, tz) === k);
  return i < 0 ? 0 : i;
}

// Three-segment swing meter (1 = calm, 2 = moderate, 3 = big swing).
function meter(l) {
  return `<span class="meter l${l}" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

function cond(ic, k, val, sub) {
  return `<div class="cond"><div class="k">${ic}${esc(k)}</div><div class="val">${esc(val)}</div><div class="sub">${esc(sub || '')}</div></div>`;
}

function swingText(s, unit) {
  const l = swingLevel(s);
  if (!s) return '';
  const r = fmtPressure(s.range, unit, { withUnit: true });
  if (l === 3) return `A big swing is coming: pressure moves through ${r} over the next day, with the fastest change ${fmtDelta(Math.abs(s.maxDrop) > s.maxRise ? s.maxDrop : s.maxRise, unit, { withUnit: true })} in 3 hours.`;
  if (l === 2) return `Moderate change: pressure moves through ${r} over the next day.`;
  return `Calm: pressure stays within ${r} over the next day.`;
}

function updateSilently(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem('bpm:settings', JSON.stringify(settings)); } catch { /* ignore */ }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
