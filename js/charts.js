// History + forecast chart (Chart.js): pressure line on top, 3-hour change
// bars underneath (stacked axes in one chart, so hover and zoom stay in sync),
// and an optional overlay series on the right axis.

import { fmtDateTime, fmtHour, fmtWeekday, fmtDayMonth } from './ui.js';

const H = 3600e3;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function alpha(hex, a) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function createPressureChart(canvas, cfg) {
  const C = {
    accent: cssVar('--accent') || '#4f46e5',
    rise: cssVar('--rise') || '#1f6fd1',
    fall: cssVar('--fall') || '#d93a3f',
    text: cssVar('--text') || '#0f172a',
    muted: cssVar('--muted') || '#5d6779',
    border: cssVar('--border') || '#dde2ea',
    surface: cssVar('--surface') || '#fff',
    surface2: cssVar('--surface-2') || '#eef1f6',
  };
  const { times, values, change3, now, tz, dayStarts, band, unitLabel, dp, ddp, thresholds } = cfg;
  let overlay = cfg.overlay;
  let [t0, t1] = cfg.range;

  const pData = times.map((t, i) => ({ x: t, y: values[i] }));
  const cData = times.map((t, i) => ({ x: t, y: change3[i] }));

  const datasets = [
    {
      label: 'Pressure',
      data: pData,
      yAxisID: 'y',
      borderColor: C.accent,
      borderWidth: 2.4,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: C.accent,
      pointHoverBorderColor: C.surface,
      pointHoverBorderWidth: 2,
      tension: 0.25,
      fill: 'start',
      backgroundColor: (ctx) => {
        const { chart } = ctx;
        const y = chart.scales.y;
        if (!y || !chart.chartArea || !Number.isFinite(y.top) || !Number.isFinite(y.bottom) || y.bottom <= y.top) return alpha(C.accent, 0.1);
        const g = chart.ctx.createLinearGradient(0, y.top, 0, y.bottom);
        g.addColorStop(0, alpha(C.accent, 0.24));
        g.addColorStop(1, alpha(C.accent, 0.0));
        return g;
      },
      segment: {
        borderDash: (ctx) => (ctx.p0.parsed.x >= now ? [6, 4] : undefined),
      },
      fmt: (v) => `${v.toFixed(dp)} ${unitLabel}`,
      order: 1,
    },
    {
      label: '3 h change',
      type: 'bar',
      data: cData,
      yAxisID: 'yc',
      barPercentage: 1,
      categoryPercentage: 1,
      borderWidth: 0,
      backgroundColor: (ctx) => {
        const v = ctx.raw?.y;
        if (v == null) return 'transparent';
        const base = v < 0 ? C.fall : C.rise;
        const m = Math.abs(v);
        const a = m >= thresholds[1] ? 0.95 : m >= thresholds[0] ? 0.7 : 0.38;
        return alpha(base, ctx.raw.x > now ? a * 0.7 : a);
      },
      fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(ddp)} ${unitLabel}`,
      order: 3,
    },
  ];

  function overlayDataset(o) {
    if (!o) return null;
    const isBar = o.type === 'bar';
    return {
      label: o.label,
      type: isBar ? 'bar' : 'line',
      data: times.map((t, i) => ({ x: t, y: o.values[i] })),
      yAxisID: 'y2',
      borderColor: o.color,
      backgroundColor: isBar ? alpha(o.color, 0.28) : 'transparent',
      borderWidth: isBar ? 0 : 1.8,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.3,
      barPercentage: 1,
      categoryPercentage: 1,
      fmt: o.fmt,
      order: 2,
    };
  }
  if (overlay) datasets.push(overlayDataset(overlay));

  // Local-time ticks: midnights, plus noon / 6-hourly when there is room.
  function buildTicks(scale) {
    const min = scale.min, max = scale.max;
    const width = scale.width || 600;
    const days = (max - min) / (24 * H);
    const pxPerDay = width / Math.max(days, 0.01);
    const subs = pxPerDay > 300 ? [6, 12, 18] : pxPerDay > 150 ? [12] : [];
    const step = pxPerDay < 38 ? Math.ceil(46 / pxPerDay) : 1;
    const ticks = [];
    dayStarts.forEach((d, i) => {
      if (d >= min && d <= max && i % step === 0) ticks.push({ value: d, major: true });
      subs.forEach((h) => {
        const t = d + h * H;
        if (t > min && t < max) ticks.push({ value: t, major: false });
      });
    });
    ticks.sort((a, b) => a.value - b.value);
    scale.ticks = ticks;
  }

  // Visible-range y bounds.
  function yBounds(arr, minPad) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < times.length; i++) {
      if (times[i] < t0 || times[i] > t1) continue;
      const v = arr[i];
      if (v == null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo)) return [undefined, undefined];
    const pad = Math.max((hi - lo) * 0.14, minPad);
    return [lo - pad, hi + pad];
  }

  const plugins = [
    {
      id: 'dayStripes',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { x } } = chart;
        ctx.save();
        ctx.beginPath();
        ctx.rect(a.left, a.top, a.width, a.height);
        ctx.clip();
        dayStarts.forEach((d, i) => {
          if (i % 2) return;
          const x0 = x.getPixelForValue(d), x1 = x.getPixelForValue(d + 24 * H);
          if (x1 < a.left || x0 > a.right) return;
          ctx.fillStyle = alpha(C.muted, 0.045);
          ctx.fillRect(x0, a.top, x1 - x0, a.height);
        });
        // Normal pressure band (sea-level only)
        if (band) {
          const y = chart.scales.y;
          const yTop = y.getPixelForValue(band[1]), yBot = y.getPixelForValue(band[0]);
          const top = Math.max(y.top, yTop), bot = Math.min(y.bottom, yBot);
          if (bot > top) {
            ctx.fillStyle = alpha(C.accent, 0.06);
            ctx.fillRect(a.left, top, a.width, bot - top);
            if (bot - top > 22) {
              ctx.fillStyle = alpha(C.accent, 0.55);
              ctx.font = '600 10px InterVariable, system-ui, sans-serif';
              ctx.textBaseline = 'top';
              ctx.fillText('NORMAL RANGE', a.left + 6, top + 5);
            }
          }
        }
        ctx.restore();
      },
    },
    {
      id: 'nowLine',
      afterDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { x } } = chart;
        if (now < x.min || now > x.max) return;
        const px = x.getPixelForValue(now);
        ctx.save();
        ctx.strokeStyle = alpha(C.text, 0.55);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, a.top + 14);
        ctx.lineTo(px, a.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '700 10px InterVariable, system-ui, sans-serif';
        const w = ctx.measureText('NOW').width + 10;
        ctx.fillStyle = C.text;
        const bx = Math.min(Math.max(px - w / 2, a.left), a.right - w);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(bx, a.top, w, 14, 7) : ctx.rect(bx, a.top, w, 14);
        ctx.fill();
        ctx.fillStyle = C.surface;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('NOW', bx + w / 2, a.top + 7.5);
        ctx.restore();
      },
    },
    {
      id: 'crosshair',
      afterDraw(chart) {
        const act = chart.tooltip?.getActiveElements?.() || [];
        if (!act.length) return;
        const { ctx, chartArea: a } = chart;
        const px = act[0].element.x;
        ctx.save();
        ctx.strokeStyle = alpha(C.muted, 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, a.top);
        ctx.lineTo(px, a.bottom);
        ctx.stroke();
        ctx.restore();
      },
    },
  ];

  const [pyMin, pyMax] = yBounds(values, cfg.minPad);
  const chart = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    plugins,
    options: {
      parsing: false,
      normalized: true,
      maintainAspectRatio: false,
      responsive: true,
      animation: { duration: 450 },
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      layout: { padding: { top: 4, right: 2 } },
      scales: {
        x: {
          type: 'linear',
          // Bar datasets switch on edge padding by default, which skews
          // the time window; keep the axis exactly min..max.
          offset: false,
          min: t0,
          max: t1,
          afterBuildTicks: buildTicks,
          grid: {
            color: (ctx) => (ctx.tick?.major ? alpha(C.muted, 0.22) : alpha(C.muted, 0.07)),
            drawTicks: false,
          },
          border: { display: false },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            padding: 6,
            color: C.muted,
            font: (ctx) => ({ size: 11, weight: ctx.tick?.major ? 650 : 450 }),
            callback: (v, i, ticks) => {
              const tk = ticks[i];
              if (tk.major) {
                const span = (t1 - t0) / (24 * H);
                return span > 10 ? fmtDayMonth(v, tz) : `${fmtWeekday(v, tz)} ${new Date(v).toLocaleDateString(undefined, { day: 'numeric', timeZone: tz })}`;
              }
              return fmtHour(v, tz);
            },
          },
        },
        // Left-side stacked axes are laid out in reverse order, so the
        // change panel (yc) is defined first to sit below the pressure axis.
        yc: {
          position: 'left',
          stack: 'L',
          stackWeight: 1.15,
          grid: {
            color: (ctx) => (ctx.tick?.value === 0 ? alpha(C.muted, 0.35) : 'transparent'),
            drawTicks: false,
          },
          border: { display: false },
          ticks: {
            includeBounds: false,
            color: C.muted,
            padding: 6,
            font: { size: 10 },
            maxTicksLimit: 3,
            callback: (v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(ddp)}`),
          },
          afterFit: (s) => { s.width = 50; },
        },
        y: {
          position: 'left',
          stack: 'L',
          stackWeight: 4,
          min: pyMin,
          max: pyMax,
          grid: { color: alpha(C.muted, 0.1), drawTicks: false },
          border: { display: false },
          ticks: {
            includeBounds: false,
            color: C.muted,
            padding: 6,
            font: { size: 11 },
            maxTicksLimit: 6,
            callback: (v) => Number(v).toFixed(dp >= 2 ? dp : dp === 1 ? 0 : 0),
          },
          afterFit: (s) => { s.width = 50; },
        },
        y2: {
          display: !!overlay,
          position: 'right',
          stack: 'R',
          stackWeight: 4,
          grid: { display: false },
          border: { display: false },
          ticks: { includeBounds: false, color: overlay?.color || C.muted, font: { size: 11 }, maxTicksLimit: 5, padding: 4, callback: (v) => overlay?.tick ? overlay.tick(v) : v },
          afterFit: (s) => { s.width = 40; },
        },
        y2pad: {
          display: !!overlay,
          position: 'right',
          stack: 'R',
          stackWeight: 1.15,
          grid: { display: false },
          border: { display: false },
          ticks: { display: false },
          afterFit: (s) => { s.width = 40; },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.surface,
          titleColor: C.text,
          bodyColor: C.text,
          borderColor: C.border,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 10,
          boxPadding: 4,
          usePointStyle: true,
          titleFont: { weight: 700 },
          callbacks: {
            title: (items) => {
              const x = items[0]?.parsed.x;
              return x == null ? '' : `${fmtDateTime(x, tz)}${x > now ? ' · forecast' : ''}`;
            },
            label: (item) => {
              const v = item.parsed.y;
              if (v == null) return null;
              return ` ${item.dataset.label}: ${item.dataset.fmt ? item.dataset.fmt(v) : v}`;
            },
            labelColor: (item) => {
              const c = item.dataset.yAxisID === 'yc'
                ? (item.parsed.y < 0 ? C.fall : C.rise)
                : item.dataset.borderColor;
              return { borderColor: c, backgroundColor: c, borderRadius: 3 };
            },
          },
        },
      },
    },
  });

  function applyChangeBounds() {
    let m = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i] < t0 || times[i] > t1) continue;
      const v = change3[i];
      if (v != null && Math.abs(v) > m) m = Math.abs(v);
    }
    m = Math.max(m, thresholds[0] * 1.2) * 1.12;
    chart.options.scales.yc.min = -m;
    chart.options.scales.yc.max = m;
  }
  function applyOverlayBounds() {
    if (!overlay) return;
    const ys = chart.options.scales.y2;
    if (overlay.fixed) { ys.min = overlay.fixed[0]; ys.max = overlay.fixed[1]; return; }
    const [lo, hi] = yBounds(overlay.values, overlay.minPad || 1);
    ys.min = overlay.floor != null ? Math.max(overlay.floor, lo) : lo;
    ys.max = hi;
  }
  applyChangeBounds();
  applyOverlayBounds();
  chart.update('none');

  return {
    chart,
    setRange(a, b) {
      t0 = a; t1 = b;
      const [lo, hi] = yBounds(values, cfg.minPad);
      Object.assign(chart.options.scales.x, { min: a, max: b });
      Object.assign(chart.options.scales.y, { min: lo, max: hi });
      applyChangeBounds();
      applyOverlayBounds();
      chart.update();
    },
    setOverlay(o) {
      overlay = o;
      chart.data.datasets = chart.data.datasets.filter((d) => d.yAxisID !== 'y2');
      if (o) chart.data.datasets.push(overlayDataset(o));
      chart.options.scales.y2.display = !!o;
      chart.options.scales.y2pad.display = !!o;
      chart.options.scales.y2.ticks.color = o?.color || C.muted;
      applyOverlayBounds();
      chart.update();
    },
    destroy() { chart.destroy(); },
  };
}
