// Report output: chart images, PDF (jsPDF + AutoTable, loaded on demand)
// and CSV.

import { PRESSURE_UNITS, TEMP_UNITS, WIND_UNITS, PRECIP_UNITS, convertPressure, convertTemp, convertWind, compass } from './units.js';
import { wxText } from './wx.js';
import { DISCLAIMER } from './report-data.js';
import { valueAt } from './analysis.js';

const H = 3600e3;

// ---------- Formatting helpers (unit-aware, plain text) ----------

export function formatters(settings, tz) {
  const pu = settings.pressureUnit, tu = settings.tempUnit, wu = settings.windUnit, ru = settings.precipUnit;
  const P = PRESSURE_UNITS[pu];
  const dtf = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour12: settings.hour12, ...opts });
  const fDateTime = dtf({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fDate = dtf({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const fTime = dtf({ hour: 'numeric', minute: '2-digit' });
  const fRowTime = dtf({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const num = (v, dp) => (v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(dp).replace('-', '−'));
  return {
    pu, tu, wu, ru,
    pLabel: P.label, tLabel: TEMP_UNITS[tu].label, wLabel: WIND_UNITS[wu].label, rLabel: PRECIP_UNITS[ru].label,
    p: (hpa) => num(convertPressure(hpa, pu), P.dp),
    pd: (d) => (d == null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d * P.factor).toFixed(P.ddp)}`),
    t: (c) => num(convertTemp(c, tu), 1),
    td: (d) => (d == null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(tu === 'F' ? d * 1.8 : d).toFixed(1)}`),
    w: (k) => num(convertWind(k, wu), 0),
    r: (mm) => (mm == null ? '–' : ru === 'in' ? (mm / 25.4).toFixed(2) : mm.toFixed(1)),
    pct: (v) => (v == null ? '–' : `${Math.round(v)}`),
    dateTime: (t) => fDateTime.format(t),
    date: (t) => fDate.format(t),
    time: (t) => fTime.format(t),
    rowTime: (t) => fRowTime.format(t),
    period: (a, b) => (fDate.format(a) === fDate.format(b)
      ? `${fDateTime.format(a)} to ${fTime.format(b)}`
      : `${fDateTime.format(a)} to ${fDateTime.format(b)}`),
  };
}

// ---------- Charts rendered to images (shared by preview and PDF) ----------

const CHART_W = 1600, CHART_H = 500;

const tickNum = (v) => Number(v).toLocaleString(undefined, { useGrouping: false, maximumFractionDigits: 3 });

function makeChart(datasets, { y, y2, t0, t1, tz, settings, title, yOpts = {}, y2Opts = {} }) {
  const canvas = document.createElement('canvas');
  canvas.width = CHART_W;
  canvas.height = CHART_H;
  const span = (t1 - t0) / H;
  const tickStep = span <= 12 ? 1 : span <= 30 ? 3 : span <= 72 ? 6 : span <= 24 * 8 ? 24 : 48;
  const tickFmt = new Intl.DateTimeFormat(undefined, span <= 36
    ? { timeZone: tz, hour: 'numeric', minute: span <= 6 ? '2-digit' : undefined, hour12: settings.hour12 }
    : { timeZone: tz, day: 'numeric', month: 'short' });
  const chart = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    plugins: [{
      id: 'bg',
      beforeDraw(c) { const { ctx } = c; ctx.save(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); },
    }],
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: 1,
      parsing: false,
      layout: { padding: { top: 10, right: 20, left: 8, bottom: 4 } },
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { font: { size: 22 }, color: '#334155', boxWidth: 30, boxHeight: 3 } },
        title: { display: !!title, text: title, align: 'start', font: { size: 26, weight: '700' }, color: '#0f172a', padding: { bottom: 6 } },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          type: 'linear', min: t0, max: t1, offset: false,
          afterBuildTicks: (scale) => {
            const ticks = [];
            const startH = Math.ceil(t0 / H) * H;
            // Align ticks to local midnight / round hours
            for (let t = startH; t <= t1; t += H) {
              const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(t);
              if (Number(parts) % (tickStep >= 24 ? 24 : tickStep) === 0) ticks.push({ value: t });
            }
            if (tickStep >= 24 && ticks.length > 1) scale.ticks = ticks.filter((_, i) => i % (tickStep / 24) === 0);
            else scale.ticks = ticks.length ? ticks : [{ value: t0 }, { value: t1 }];
          },
          ticks: { autoSkip: false, maxRotation: 0, font: { size: 20 }, color: '#475569', callback: (v) => tickFmt.format(v) },
          grid: { color: '#e5e9f0' },
        },
        y: { position: 'left', grace: '8%', ...yOpts, title: { display: true, text: y, font: { size: 20 }, color: '#475569' }, ticks: { font: { size: 20 }, color: '#475569', callback: tickNum }, grid: { color: '#eef1f5' } },
        ...(y2 ? { y2: { position: 'right', grace: '8%', ...y2Opts, title: { display: true, text: y2, font: { size: 20 }, color: '#475569' }, ticks: { font: { size: 20 }, color: '#475569', callback: tickNum }, grid: { display: false } } } : {}),
      },
    },
  });
  const url = canvas.toDataURL('image/png');
  chart.destroy();
  return url;
}

export function chartImages(data, report, settings, include) {
  const f = formatters(settings, data.timezone);
  const { t0, t1 } = report;
  // Hourly points inside the window plus interpolated values at its edges.
  const Hh = data.hourly;
  const pts = (key, conv) => {
    const out = [];
    const edge = (t) => { const v = valueAt(Hh.time, Hh[key], t); if (v != null) out.push({ x: t, y: conv(v) }); };
    edge(t0);
    Hh.time.forEach((t, i) => { if (t > t0 && t < t1 && Hh[key][i] != null) out.push({ x: t, y: conv(Hh[key][i]) }); });
    edge(t1);
    return out;
  };
  // Keep small changes from looking dramatic: minimum span around the data.
  const minSpan = (arr, span) => {
    const ys = arr.map((p) => p.y).filter((v) => v != null);
    if (!ys.length) return {};
    const lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo >= span) return {};
    const mid = (lo + hi) / 2;
    return { suggestedMin: mid - span / 2, suggestedMax: mid + span / 2 };
  };
  const pConv = (v) => convertPressure(v, settings.pressureUnit);
  const images = [];
  const line = (label, d, color, extra = {}) => ({ label, data: d, borderColor: color, backgroundColor: color, borderWidth: 4, pointRadius: d.length <= 30 ? 5 : 0, tension: 0.25, ...extra });

  const pData = pts('msl', pConv);
  images.push({
    key: 'pressure',
    title: 'Sea-level pressure',
    src: makeChart([line(`Sea-level pressure (${f.pLabel})`, pData, '#4f46e5', { fill: false })], {
      y: f.pLabel, t0, t1, tz: data.timezone, settings, title: 'Sea-level pressure', yOpts: minSpan(pData, convertPressure(4, settings.pressureUnit)),
    }),
  });

  if (include.temp) {
    images.push({
      key: 'temp',
      title: 'Temperature and humidity',
      src: makeChart([
        line(`Temperature (${f.tLabel})`, pts('temp', (v) => convertTemp(v, settings.tempUnit)), '#e8590c'),
        line(`Dew point (${f.tLabel})`, pts('dew', (v) => convertTemp(v, settings.tempUnit)), '#f59f00', { borderDash: [10, 6] }),
        line('Relative humidity (%)', pts('rh', (v) => v), '#1098ad', { yAxisID: 'y2' }),
      ], { y: f.tLabel, y2: '%', t0, t1, tz: data.timezone, settings, title: 'Temperature and humidity', y2Opts: { min: 0, max: 100, grace: 0 } }),
    });
  }
  if (include.wind) {
    images.push({
      key: 'wind',
      title: 'Wind',
      src: makeChart([
        line(`Wind speed (${f.wLabel})`, pts('ws', (v) => convertWind(v, settings.windUnit)), '#2b8a3e'),
        line(`Gusts (${f.wLabel})`, pts('wg', (v) => convertWind(v, settings.windUnit)), '#94d82d', { borderDash: [10, 6] }),
      ], { y: f.wLabel, t0, t1, tz: data.timezone, settings, title: 'Wind', yOpts: { beginAtZero: true, suggestedMax: convertWind(20, settings.windUnit) } }),
    });
  }
  return images;
}

// ---------- Table definitions (shared by preview, PDF and CSV) ----------

export function hourlyColumns(f, include) {
  const cols = [
    { key: 'time', head: 'Time', get: (r) => f.rowTime(r.t) },
    { key: 'msl', head: `Sea-level (${f.pLabel})`, get: (r) => f.p(r.msl) },
  ];
  if (include.station) cols.push({ key: 'sp', head: `Station (${f.pLabel})`, get: (r) => f.p(r.sp) });
  if (include.temp) {
    cols.push({ key: 'temp', head: `Temp (${f.tLabel})`, get: (r) => f.t(r.temp) });
    cols.push({ key: 'rh', head: 'RH (%)', get: (r) => f.pct(r.rh) });
    cols.push({ key: 'dew', head: `Dew pt (${f.tLabel})`, get: (r) => f.t(r.dew) });
  }
  if (include.wind) {
    cols.push({ key: 'ws', head: `Wind (${f.wLabel})`, get: (r) => f.w(r.ws) });
    cols.push({ key: 'wd', head: 'Dir', get: (r) => (r.wd == null ? '–' : compass(r.wd)) });
    cols.push({ key: 'wg', head: `Gust (${f.wLabel})`, get: (r) => f.w(r.wg) });
  }
  if (include.rain) {
    cols.push({ key: 'pr', head: `Rain (${f.rLabel})`, get: (r) => f.r(r.pr) });
    cols.push({ key: 'cc', head: 'Cloud (%)', get: (r) => f.pct(r.cc) });
    cols.push({ key: 'wc', head: 'Weather', get: (r) => (r.wc == null ? '–' : wxText(r.wc)) });
  }
  return cols;
}

export function summaryRows(report, f, include) {
  const s = report.summary;
  const rows = [];
  const add = (label, st, fmt, dfmt) => {
    if (!st || (st.n == null && st.start == null)) return;
    rows.push([label, fmt(st.start), fmt(st.end), fmt(st.min), fmt(st.max), fmt(st.mean), dfmt ? dfmt(st.change) : '']);
  };
  add(`Sea-level pressure (${f.pLabel})`, s.msl, f.p, f.pd);
  if (include.station) add(`Station pressure (${f.pLabel})`, s.sp, f.p, f.pd);
  if (include.temp) {
    add(`Temperature (${f.tLabel})`, s.temp, f.t, f.td);
    add(`Feels like (${f.tLabel})`, s.feels, f.t, f.td);
    add('Relative humidity (%)', s.rh, f.pct, (d) => (d == null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(Math.round(d))}`));
    add(`Dew point (${f.tLabel})`, s.dew, f.t, f.td);
  }
  if (include.wind) {
    add(`Wind speed (${f.wLabel})`, s.ws, f.w);
    add(`Wind gusts (${f.wLabel})`, s.wg, f.w);
  }
  if (include.rain) add('Cloud cover (%)', s.cc, f.pct);
  return rows;
}

export function highlights(report, f, include) {
  const out = [];
  const p = report.pressure;
  const s = report.summary.msl;
  if (s && s.n) {
    const range = s.n ? `, ranging from ${f.p(s.min)} to ${f.p(s.max)} ${f.pLabel}` : '';
    if (report.hoursSpan <= 12) {
      // Short windows: the forecasters' 3-hour tendency terms are meaningful.
      out.push(`Pressure was ${p.tendency.label.toLowerCase()} (${f.pd(s.change)} ${f.pLabel} over the period)${range}.`);
    } else {
      const c = s.change ?? 0;
      const verb = c >= 1 ? `rose ${f.pd(c).slice(1)}` : c <= -1 ? `fell ${f.pd(c).slice(1)}` : `was little changed (${f.pd(c)}`;
      out.push(`Pressure ${verb} ${f.pLabel}${Math.abs(c) < 1 ? ')' : ''} over the period${range}.`);
    }
    if (p.maxFall <= -0.5) out.push(`Fastest fall: ${f.pd(p.maxFall)} ${f.pLabel} in 3 hours, to ${f.dateTime(p.tFall)}.`);
    if (p.maxRise >= 0.5) out.push(`Fastest rise: ${f.pd(p.maxRise)} ${f.pLabel} in 3 hours, to ${f.dateTime(p.tRise)}.`);
  }
  if (include.rain) {
    out.push(report.rain.total >= 0.1
      ? `Rain: ${f.r(report.rain.total)} ${f.rLabel} in total, with ${report.rain.wetHours} wet hour${report.rain.wetHours === 1 ? '' : 's'}.`
      : 'No measurable rain.');
    if (report.weather.length) out.push(`Weather: ${report.weather.slice(0, 3).map((w) => w.text.toLowerCase()).join(', ')}.`);
  }
  if (include.wind && report.summary.ws?.n) {
    out.push(`Wind mostly from the ${report.wind.prevailingText}, averaging ${f.w(report.summary.ws.mean)} ${f.wLabel} with gusts up to ${f.w(report.summary.wg.max)} ${f.wLabel}.`);
  }
  return out;
}

export function dailyColumns(f, include) {
  const cols = [
    { head: 'Day', get: (d) => f.date(d.t) },
    { head: `Pressure min (${f.pLabel})`, get: (d) => f.p(d.pMin) },
    { head: `max`, get: (d) => f.p(d.pMax) },
    { head: `mean`, get: (d) => f.p(d.pMean) },
    { head: 'Change', get: (d) => f.pd(d.pChange) },
  ];
  if (include.temp) { cols.push({ head: `Temp min (${f.tLabel})`, get: (d) => f.t(d.tMin) }); cols.push({ head: 'max', get: (d) => f.t(d.tMax) }); }
  if (include.rain) cols.push({ head: `Rain (${f.rLabel})`, get: (d) => f.r(d.rain) });
  if (include.wind) cols.push({ head: `Max gust (${f.wLabel})`, get: (d) => f.w(d.gust) });
  return cols;
}

// ---------- CSV ----------

export function toCSV(ctx) {
  const { data, report, settings, include, meta } = ctx;
  const f = formatters(settings, data.timezone);
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const isoLocal = (t) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
    const g = (k) => p.find((x) => x.type === k).value;
    return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
  };
  const raw = (v, conv, dp) => (v == null ? '' : Number(conv ? conv(v) : v).toFixed(dp));
  const cols = [
    ['time_local', (r) => isoLocal(r.t)],
    ['time_utc', (r) => new Date(r.t).toISOString().slice(0, 16).replace('T', ' ')],
    [`pressure_sea_level_${f.pu}`, (r) => raw(r.msl, (v) => convertPressure(v, f.pu), PRESSURE_UNITS[f.pu].dp + 1)],
    [`pressure_station_${f.pu}`, (r) => raw(r.sp, (v) => convertPressure(v, f.pu), PRESSURE_UNITS[f.pu].dp + 1)],
    [`temperature_${f.tu}`, (r) => raw(r.temp, (v) => convertTemp(v, f.tu), 1)],
    [`feels_like_${f.tu}`, (r) => raw(r.feels, (v) => convertTemp(v, f.tu), 1)],
    ['relative_humidity_pct', (r) => raw(r.rh, null, 0)],
    [`dew_point_${f.tu}`, (r) => raw(r.dew, (v) => convertTemp(v, f.tu), 1)],
    [`wind_speed_${f.wu}`, (r) => raw(r.ws, (v) => convertWind(v, f.wu), 1)],
    ['wind_direction_deg', (r) => raw(r.wd, null, 0)],
    [`wind_gust_${f.wu}`, (r) => raw(r.wg, (v) => convertWind(v, f.wu), 1)],
    [`precipitation_${f.ru}`, (r) => raw(r.pr, (v) => (f.ru === 'in' ? v / 25.4 : v), 2)],
    ['cloud_cover_pct', (r) => raw(r.cc, null, 0)],
    ['weather', (r) => (r.wc == null ? '' : wxText(r.wc))],
  ];
  const lines = [
    `# ${meta.title}`,
    meta.site ? `# Site / project: ${meta.site}` : null,
    meta.preparedBy ? `# Prepared by: ${meta.preparedBy}` : null,
    `# Location: ${meta.placeName} (${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}), elevation ${Math.round(data.elevation)} m, time zone ${data.timezone}`,
    `# Period: ${f.period(report.t0, report.t1)}`,
    `# Source: ${meta.source}. ${DISCLAIMER}`,
    cols.map((c) => c[0]).join(','),
    ...report.rows.map((r) => cols.map((c) => esc(c[1](r))).join(',')),
  ].filter((l) => l != null);
  return '﻿' + lines.join('\r\n');
}

// ---------- PDF ----------

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the PDF tools. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

// Standard PDF fonts only cover Latin-1 + a few extras; map the rest.
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function pdfText(str) {
  return String(str ?? '')
    .replace(/−/g, '-').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/ | /g, ' ')
    .replace(/[^\u0000-ÿ]/g, (ch) => {
      if (WINANSI_EXTRA.includes(ch)) return ch;
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      return /^[\u0000-ÿ]+$/.test(base) ? base : '?';
    });
}

export async function toPDF(ctx) {
  await loadScript('vendor/jspdf/jspdf.umd.min.js');
  await loadScript('vendor/jspdf/jspdf.plugin.autotable.min.js');
  const { jsPDF } = window.jspdf;
  const { data, report, settings, include, meta, images, daily } = ctx;
  const f = formatters(settings, data.timezone);
  const T = pdfText;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, M = 14, CW = W - 2 * M;
  const ACCENT = [79, 70, 229], INK = [15, 23, 42], MUTED = [93, 103, 121], LINE = [221, 226, 234];

  doc.setProperties({ title: T(meta.title), subject: T(`Conditions report for ${meta.placeName}`), creator: 'Barometric Pressure Map' });

  // Header band
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(T(meta.title), M, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(T(meta.site ? `${meta.site} · ${meta.placeName}` : meta.placeName), M, 19);
  doc.setFontSize(8.5);
  doc.text(T(`Generated ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(Date.now())}`), W - M, 12, { align: 'right' });

  // Details
  let y = 34;
  const info = [
    ['Location', `${meta.placeName}${meta.region ? `, ${meta.region}` : ''}`],
    ['Coordinates', `${Math.abs(data.lat).toFixed(4)}°${data.lat >= 0 ? 'N' : 'S'}, ${Math.abs(data.lon).toFixed(4)}°${data.lon >= 0 ? 'E' : 'W'} · elevation ${Math.round(data.elevation)} m`],
    ['Period', f.period(report.t0, report.t1)],
    ['Duration', `${report.hoursSpan < 48 ? `${+report.hoursSpan.toFixed(1)} hours` : `${+(report.hoursSpan / 24).toFixed(1)} days`} · ${report.rows.length} hourly values · times in ${data.timezone}`],
    ['Prepared by', meta.preparedBy || '–'],
    ['Data source', meta.source],
  ];
  doc.autoTable({
    startY: y,
    body: info.map(([k, v]) => [T(k), T(v)]),
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: { top: 1.2, bottom: 1.2, left: 0, right: 2 }, textColor: INK },
    columnStyles: { 0: { cellWidth: 32, textColor: MUTED, fontStyle: 'bold' } },
    margin: { left: M, right: M },
  });
  y = doc.lastAutoTable.finalY + 5;

  const section = (title) => {
    y += 3;
    if (y > 260) { doc.addPage(); y = 18; }
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text(T(title), M, y);
    doc.setDrawColor(...LINE);
    doc.line(M, y + 1.8, W - M, y + 1.8);
    y += 6;
  };

  if (include.summary) {
    section('Summary');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    for (const line of highlights(report, f, include)) {
      const wrapped = doc.splitTextToSize(T(`• ${line}`), CW);
      if (y + wrapped.length * 4.6 > 282) { doc.addPage(); y = 18; }
      doc.text(wrapped, M, y);
      y += wrapped.length * 4.6 + 0.6;
    }
    y += 2;
    doc.autoTable({
      startY: y,
      head: [['Measure', 'Start', 'End', 'Min', 'Max', 'Mean', 'Change'].map(T)],
      body: summaryRows(report, f, include).map((r) => r.map(T)),
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 1.6, textColor: INK, lineColor: LINE, halign: 'right' },
      headStyles: { fillColor: [238, 241, 246], textColor: INK, fontStyle: 'bold', halign: 'right' },
      columnStyles: { 0: { halign: 'left', cellWidth: 52 } },
      didParseCell: (d) => { if (d.section === 'head' && d.column.index === 0) d.cell.styles.halign = 'left'; },
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (include.charts && images.length) {
    section('Charts');
    const h = (CW * CHART_H) / CHART_W;
    for (const img of images) {
      if (y + h > 284) { doc.addPage(); y = 18; }
      doc.addImage(img.src, 'PNG', M, y, CW, h, undefined, 'FAST');
      y += h + 4;
    }
  }

  if (include.daily && daily.length > 1) {
    section('Day by day');
    const cols = dailyColumns(f, include);
    doc.autoTable({
      startY: y,
      head: [cols.map((c) => T(c.head))],
      body: daily.map((d) => cols.map((c) => T(c.get(d)))),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 1.4, textColor: INK, halign: 'right' },
      headStyles: { fillColor: ACCENT, textColor: 255, halign: 'right' },
      columnStyles: { 0: { halign: 'left' } },
      didParseCell: (d) => { if (d.section === 'head' && d.column.index === 0) d.cell.styles.halign = 'left'; },
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (include.table) {
    section('Hourly values');
    const cols = hourlyColumns(f, include);
    doc.autoTable({
      startY: y,
      head: [cols.map((c) => T(c.head))],
      body: report.rows.map((r) => cols.map((c) => T(c.get(r)))),
      theme: 'striped',
      styles: { fontSize: cols.length > 9 ? 6.8 : 7.6, cellPadding: 1.1, textColor: INK, halign: 'right', overflow: 'linebreak' },
      headStyles: { fillColor: ACCENT, textColor: 255, halign: 'right', fontSize: cols.length > 9 ? 6.6 : 7.4 },
      columnStyles: { 0: { halign: 'left', cellWidth: 28 } },
      didParseCell: (d) => {
        if (d.column.index === 0 && d.section === 'head') d.cell.styles.halign = 'left';
        if (cols[d.column.index]?.key === 'wc' && d.section === 'body') d.cell.styles.halign = 'left';
      },
      margin: { left: M, right: M, top: 16 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (meta.notes) {
    section('Notes');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const wrapped = doc.splitTextToSize(T(meta.notes), CW);
    for (const line of wrapped) {
      if (y > 282) { doc.addPage(); y = 18; }
      doc.text(line, M, y);
      y += 4.6;
    }
    y += 2;
  }

  // About the data
  section('About this data');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const about = doc.splitTextToSize(T(`${DISCLAIMER} Data: ${meta.source}. Licensed CC BY 4.0 by Open-Meteo (open-meteo.com).`), CW);
  if (y + about.length * 4 > 284) { doc.addPage(); y = 18; }
  doc.text(about, M, y);

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.line(M, 288, W - M, 288);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(T(`${meta.title} · ${meta.placeName} · ${f.date(report.t0)}`), M, 292);
    doc.text(`Page ${i} of ${pages}`, W - M, 292, { align: 'right' });
  }
  return doc;
}

export const CHART_SIZE = { w: CHART_W, h: CHART_H };
