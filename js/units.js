// Unit definitions and conversions. All data is stored internally in
// hPa, °C, km/h and mm, and converted only for display.

export const PRESSURE_UNITS = {
  hPa:  { label: 'hPa',  name: 'Hectopascals / millibars', factor: 1,            dp: 1, ddp: 1 },
  inHg: { label: 'inHg', name: 'Inches of mercury',        factor: 1 / 33.8639,  dp: 2, ddp: 2 },
  mmHg: { label: 'mmHg', name: 'Millimetres of mercury',   factor: 0.750062,     dp: 1, ddp: 1 },
  kPa:  { label: 'kPa',  name: 'Kilopascals',              factor: 0.1,          dp: 2, ddp: 2 },
  psi:  { label: 'psi',  name: 'Pounds per square inch',   factor: 0.0145038,    dp: 3, ddp: 3 },
  atm:  { label: 'atm',  name: 'Atmospheres',              factor: 1 / 1013.25,  dp: 4, ddp: 4 },
};

export const TEMP_UNITS = { C: { label: '°C' }, F: { label: '°F' } };
export const WIND_UNITS = {
  kmh: { label: 'km/h', factor: 1 },
  mph: { label: 'mph', factor: 0.621371 },
  ms:  { label: 'm/s', factor: 1 / 3.6 },
  kn:  { label: 'kn', factor: 0.539957 },
};
export const PRECIP_UNITS = { mm: { label: 'mm', factor: 1 }, in: { label: 'in', factor: 1 / 25.4 } };

export function convertPressure(hpa, unit) {
  if (hpa == null || Number.isNaN(hpa)) return null;
  return hpa * PRESSURE_UNITS[unit].factor;
}
export function toHpa(value, unit) {
  return value / PRESSURE_UNITS[unit].factor;
}

export function fmtPressure(hpa, unit, { withUnit = false, dp } = {}) {
  const v = convertPressure(hpa, unit);
  if (v == null) return '–';
  const s = v.toFixed(dp ?? PRESSURE_UNITS[unit].dp);
  return withUnit ? `${s} ${PRESSURE_UNITS[unit].label}` : s;
}

// Format a pressure change (delta) with an explicit sign.
export function fmtDelta(dhpa, unit, { withUnit = false } = {}) {
  if (dhpa == null || Number.isNaN(dhpa)) return '–';
  const u = PRESSURE_UNITS[unit];
  const v = dhpa * u.factor;
  const s = Math.abs(v).toFixed(u.ddp);
  const zero = Number(s) === 0;
  const sign = zero ? '±' : v > 0 ? '+' : '−';
  return `${sign}${s}${withUnit ? ' ' + u.label : ''}`;
}

export function convertTemp(c, unit) {
  if (c == null) return null;
  return unit === 'F' ? c * 9 / 5 + 32 : c;
}
export function fmtTemp(c, unit, { withUnit = true } = {}) {
  const v = convertTemp(c, unit);
  if (v == null) return '–';
  const n = Math.round(v);
  return `${n < 0 ? '−' : ''}${Math.abs(n)}${withUnit ? '°' : ''}`;
}
export function convertWind(kmh, unit) {
  if (kmh == null) return null;
  return kmh * WIND_UNITS[unit].factor;
}
export function fmtWind(kmh, unit, { withUnit = true } = {}) {
  const v = convertWind(kmh, unit);
  if (v == null) return '–';
  return `${Math.round(v)}${withUnit ? ' ' + WIND_UNITS[unit].label : ''}`;
}
export function fmtPrecip(mm, unit) {
  if (mm == null) return '–';
  const v = mm * PRECIP_UNITS[unit].factor;
  return `${unit === 'in' ? v.toFixed(2) : v.toFixed(1)} ${PRECIP_UNITS[unit].label}`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg) {
  if (deg == null) return '';
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// Pick a "nice" step for axis/gauge ticks in a given unit.
export function niceStep(range, targetCount = 5) {
  const raw = range / targetCount;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return m * pow;
}

// Sensible defaults from the browser locale.
export function localeDefaults() {
  const lang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-GB';
  const region = (lang.split('-')[1] || '').toUpperCase();
  const imperial = ['US', 'LR', 'MM'].includes(region);
  return {
    pressureUnit: imperial ? 'inHg' : 'hPa',
    tempUnit: imperial ? 'F' : 'C',
    windUnit: imperial ? 'mph' : region === 'GB' ? 'mph' : 'kmh',
    precipUnit: imperial ? 'in' : 'mm',
    hour12: ['US', 'CA', 'AU', 'NZ', 'IN', 'PH'].includes(region),
  };
}
