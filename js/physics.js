// Atmospheric physics used on the place page. Inputs are SI-ish:
// pressure in hPa, temperature and dew point in °C, heights in metres.
// Each formula notes its source so results can be checked.

const RD = 287.058;   // J/(kg·K), dry air
const RV = 461.495;   // J/(kg·K), water vapour
const P0 = 1013.25;   // hPa, ISA sea-level pressure
const T0 = 288.15;    // K, ISA sea-level temperature
const RHO0 = 1.225;   // kg/m³, ISA sea-level density

// Saturation vapour pressure over water, hPa (Bolton 1980).
export function satVapourPressure(tC) {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

// Actual vapour pressure from the dew point, hPa.
export const vapourPressure = (dewC) => satVapourPressure(dewC);

// Moist air density, kg/m³: dry-air and vapour partial pressures.
export function airDensity(pHpa, tC, dewC) {
  const e = dewC == null ? 0 : vapourPressure(dewC);
  const T = tC + 273.15;
  return ((pHpa - e) * 100) / (RD * T) + (e * 100) / (RV * T);
}

// Altitude in the International Standard Atmosphere with this density, m
// (the definition of density altitude, as used by the US NWS).
export function densityAltitude(rho) {
  return (T0 / 0.0065) * (1 - Math.pow(rho / RHO0, 0.234969));
}

// Altitude in the ISA where pressure equals this value, m (pressure altitude).
export function pressureAltitude(pHpa) {
  return 44330.77 * (1 - Math.pow(pHpa / P0, 0.190263));
}

// Boiling point of water at this pressure, °C (Antoine equation, water).
export function boilingPoint(pHpa) {
  const mmHg = pHpa * 0.750062;
  return 1730.63 / (8.07131 - Math.log10(mmHg)) - 233.426;
}

// Oxygen partial pressure relative to standard sea level, %.
export const oxygenPercent = (pHpa) => (pHpa / P0) * 100;

// Absolute humidity, g/m³.
export const absoluteHumidity = (eHpa, tC) => (216.7 * eHpa) / (tC + 273.15);

// Mixing ratio, g of water per kg of dry air.
export const mixingRatio = (eHpa, pHpa) => (621.97 * eHpa) / (pHpa - eHpa);

// Height of cumulus cloud base above the ground, m (Espy's rule:
// about 125 m per °C of temperature–dew point spread).
export const cloudBase = (tC, dewC) => Math.max(0, 125 * (tC - dewC));

// ---------------------------------------------------------------------------
// Semidiurnal atmospheric tide (S2): pressure rises and falls twice a day,
// peaking near 10:00 and 22:00 local solar time. Amplitude ≈ 1.16·cos³(lat)
// hPa (Haurwitz 1956). Used to separate weather from the daily rhythm.

export function tideAmplitude(lat) {
  return 1.16 * Math.pow(Math.cos((lat * Math.PI) / 180), 3);
}

export function tideAt(tMs, lat, lon) {
  const solarHours = ((tMs / 3600e3 + lon / 15) % 24 + 24) % 24;
  return tideAmplitude(lat) * Math.cos((2 * Math.PI * (solarHours - 10)) / 12);
}

// ---------------------------------------------------------------------------
// WMO pressure tendency (code table 0200, "a" in SYNOP reports): the shape
// of the barograph trace over the last 3 hours, plus the net change.
// p = [p(-3h), p(-2h), p(-1h), p(0)] in hPa.

export const WMO_TENDENCY = [
  'Rising, then falling (now the same or higher than 3 h ago)',
  'Rising, then steady; or rising, then rising more slowly',
  'Rising steadily or unsteadily',
  'Falling or steady, then rising; or rising, then rising more quickly',
  'Steady',
  'Falling, then rising (now the same or lower than 3 h ago)',
  'Falling, then steady; or falling, then falling more slowly',
  'Falling steadily or unsteadily',
  'Steady or rising, then falling; or falling, then falling more quickly',
];

export function wmoTendency(p) {
  if (!p || p.length < 4 || p.some((v) => v == null)) return null;
  const net = p[3] - p[0];
  const first = (p[1] - p[0] + (p[2] - p[1]) / 2);   // first half of the period
  const second = ((p[2] - p[1]) / 2 + p[3] - p[2]); // second half
  const flat = 0.15; // hPa: below this a half-period counts as steady
  const up = (d) => d >= flat, down = (d) => d <= -flat, level = (d) => !up(d) && !down(d);
  let code;
  if (Math.abs(net) < 0.1 && level(first) && level(second)) code = 4;
  else if (net >= 0) {
    if (up(first) && down(second)) code = 0;
    else if (up(first) && (level(second) || second < first * 0.5)) code = 1;
    else if ((level(first) || down(first)) && up(second)) code = 3;
    else if (up(first) && up(second) && second > first * 1.5) code = 3;
    else if (down(first) && level(second)) code = 5;
    else code = Math.abs(net) < 0.1 ? 4 : 2;
  } else {
    if (down(first) && up(second)) code = 5;
    else if (down(first) && (level(second) || second > first * 0.5)) code = 6;
    else if ((level(first) || up(first)) && down(second)) code = 8;
    else if (down(first) && down(second) && second < first * 1.5) code = 8;
    else code = 7;
  }
  return { code, text: WMO_TENDENCY[code], net };
}
