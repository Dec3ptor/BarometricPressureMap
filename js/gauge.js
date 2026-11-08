// Analog aneroid-style barometer dial as an SVG string.

import { PRESSURE_UNITS, convertPressure, niceStep } from './units.js';

const CX = 120, CY = 118, R = 104;
const START = 135, SWEEP = 270; // degrees, clockwise from +x (SVG coords)
const WORDS = [[965, 'Stormy'], [982, 'Rain'], [999, 'Change'], [1016, 'Fair'], [1033, 'Dry']];

const rad = (d) => (d * Math.PI) / 180;
const pt = (a, r) => [CX + r * Math.cos(rad(a)), CY + r * Math.sin(rad(a))];

export function gaugeRange(valueHpa, mode) {
  if (mode === 'msl') return [950, 1050];
  // Station pressure varies with altitude: centre the dial on the value.
  const lo = Math.floor((valueHpa - 50) / 10) * 10;
  return [lo, lo + 100];
}

export function gaugeAngle(vHpa, [lo, hi]) {
  const f = Math.max(-0.02, Math.min(1.02, (vHpa - lo) / (hi - lo)));
  return START + f * SWEEP;
}

export function gaugeSVG({ now, past, future, unit, mode }) {
  const range = gaugeRange(now, mode);
  const [lo, hi] = range;
  const f = PRESSURE_UNITS[unit].factor;
  const uLo = lo * f, uHi = hi * f;
  const major = niceStep(uHi - uLo, 5);
  const minor = major / (String(major).replace(/0|\./g, '').startsWith('2') ? 4 : 5);
  let s = `<svg class="gauge" viewBox="0 0 240 214" role="img" aria-label="Barometer dial">`;
  s += `<circle class="g-face" cx="${CX}" cy="${CY}" r="${R + 6}" stroke-width="1"/>`;

  // Colour band from low (red) to high (blue)
  const bandR = R - 16;
  const N = 54;
  for (let i = 0; i < N; i++) {
    const a0 = START + (i / N) * SWEEP, a1 = START + ((i + 1) / N) * SWEEP + 0.4;
    const t = i / (N - 1);
    const col = t < 0.5
      ? mix([214, 64, 69], [150, 160, 176], t / 0.5)
      : mix([150, 160, 176], [47, 111, 214], (t - 0.5) / 0.5);
    const [x0, y0] = pt(a0, bandR), [x1, y1] = pt(a1, bandR);
    s += `<path d="M${x0.toFixed(2)},${y0.toFixed(2)} A${bandR},${bandR} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}" stroke="rgb(${col})" stroke-width="5" fill="none" opacity=".85"/>`;
  }

  // Ticks + labels in the display unit
  const first = Math.ceil(uLo / minor - 1e-9) * minor;
  for (let v = first; v <= uHi + 1e-9; v += minor) {
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    const a = START + ((v - uLo) / (uHi - uLo)) * SWEEP;
    const [x0, y0] = pt(a, R - (isMajor ? 10 : 5));
    const [x1, y1] = pt(a, R);
    s += `<line class="g-tick${isMajor ? ' major' : ''}" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`;
    if (isMajor) {
      const [lx, ly] = pt(a, R - 28);
      const dp = major < 0.01 ? 3 : major < 0.1 ? 2 : major < 1 ? 1 : 0;
      s += `<text class="g-label" x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle">${v.toFixed(dp)}</text>`;
    }
  }

  // Classic dial words on a curved inner ring (sea-level only; they mean
  // nothing for station pressure).
  if (mode === 'msl') {
    const wr = R - 47;
    const [ax, ay] = pt(START, wr), [bx, by] = pt(START + SWEEP, wr);
    s += `<defs><path id="g-word-arc" d="M${ax.toFixed(2)},${ay.toFixed(2)} A${wr},${wr} 0 1 1 ${bx.toFixed(2)},${by.toFixed(2)}"/></defs>`;
    WORDS.forEach(([p, w]) => {
      const f = (gaugeAngle(p, range) - START) / SWEEP;
      s += `<text class="g-word" dy="3.5"><textPath href="#g-word-arc" startOffset="${(f * 100).toFixed(1)}%" text-anchor="middle">${w}</textPath></text>`;
    });
  }

  // Set hand (24 h ago) and forecast hand (+24 h)
  const hand = (v, cls, r0, r1) => {
    if (v == null) return '';
    const a = gaugeAngle(v, range);
    const [x0, y0] = pt(a, r0), [x1, y1] = pt(a, r1);
    return `<line class="${cls}" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`;
  };
  s += hand(past, 'g-set', R - 22, R + 4);
  s += hand(future, 'g-fore', R - 22, R + 4);

  // Main needle drawn pointing along +x and rotated into place
  const a = gaugeAngle(now, range);
  s += `<g class="g-needle" data-angle="${a.toFixed(2)}" style="transform-origin:${CX}px ${CY}px;transform:rotate(${START}deg)">`;
  s += `<line x1="${CX - 16}" y1="${CY}" x2="${CX + R - 14}" y2="${CY}"/>`;
  s += `<path d="M${CX + R - 8},${CY} l-12,-4.5 v9z" fill="currentColor" stroke="none" class="g-hub"/>`;
  s += `</g>`;
  s += `<circle class="g-hub" cx="${CX}" cy="${CY}" r="6"/>`;
  s += `<circle cx="${CX}" cy="${CY}" r="2.4" fill="var(--surface)"/>`;

  const label = convertPressure(now, unit).toFixed(PRESSURE_UNITS[unit].dp);
  s += `<text class="g-center-v" x="${CX}" y="${CY + 70}" text-anchor="middle">${label}</text>`;
  s += `<text class="g-center-u" x="${CX}" y="${CY + 84}" text-anchor="middle">${PRESSURE_UNITS[unit].label}${mode === 'station' ? ' · station' : ''}</text>`;
  s += `</svg>`;
  return s;
}

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',');
}

// Swing the needle from its rest position to the reading.
export function animateGauge(root) {
  const g = root.querySelector('.g-needle');
  if (!g) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    g.style.transform = `rotate(${g.dataset.angle}deg)`;
  }));
}
