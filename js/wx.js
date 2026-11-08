// WMO weather codes → description and a small SVG icon.

const CODES = {
  0: ['Clear sky', 'clear'], 1: ['Mainly clear', 'clear'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Heavy freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'showers'], 81: ['Showers', 'showers'], 82: ['Heavy showers', 'showers'],
  85: ['Snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm, hail', 'storm'], 99: ['Severe thunderstorm, hail', 'storm'],
};

export function wxText(code) { return (CODES[code] || ['–'])[0]; }

const SUN = '<circle class="sun" cx="12" cy="12" r="4.6"/><g class="rain" style="stroke:#f5b301" stroke-width="1.8"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g>';
const MOON = '<path class="moon" d="M15.5 3.5a8.5 8.5 0 1 0 5 13.4A7 7 0 0 1 15.5 3.5z"/>';
const CLOUD = (cls = 'cloud', dx = 0, dy = 0) => `<path class="${cls}" transform="translate(${dx} ${dy})" d="M7 19a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.6 19z"/>`;

export function wxIcon(code, isDay = 1, cls = 'wx-icon') {
  const kind = (CODES[code] || [null, 'cloud'])[1];
  let body = '';
  const sky = isDay ? SUN : MOON;
  switch (kind) {
    case 'clear': body = sky; break;
    case 'partly': body = `<g transform="translate(-3 -3) scale(.8)">${sky}</g>${CLOUD('cloud', 1, 2)}`; break;
    case 'cloud': body = `${CLOUD('cloud-dark', 3, -3)}${CLOUD('cloud', -1, 1)}`; break;
    case 'fog': body = `${CLOUD('cloud', 0, -3)}<path class="fog" d="M4 19h16M6 22h12"/>`; break;
    case 'drizzle': body = `${CLOUD('cloud', 0, -4)}<path class="rain" d="M8 18.5v1M12 19.5v1M16 18.5v1"/>`; break;
    case 'rain': body = `${CLOUD('cloud-dark', 0, -4)}<path class="rain" d="M8 17.5 7 21M12 17.5 11 21M16 17.5 15 21"/>`; break;
    case 'showers': body = `<g transform="translate(-3 -4) scale(.75)">${sky}</g>${CLOUD('cloud', 1, -3)}<path class="rain" d="M9 18 8 21M13 18l-1 3M17 18l-1 3"/>`; break;
    case 'snow': body = `${CLOUD('cloud', 0, -4)}<circle class="snow" cx="8" cy="19" r="1.3"/><circle class="snow" cx="12" cy="21" r="1.3"/><circle class="snow" cx="16" cy="19" r="1.3"/>`; break;
    case 'storm': body = `${CLOUD('cloud-dark', 0, -4)}<path class="bolt" d="M12.5 14 9 19.5h3l-1 4 4-6h-3l1.5-3.5z"/>`; break;
    default: body = CLOUD();
  }
  return `<svg class="${cls}" viewBox="0 0 24 24" role="img" aria-label="${wxText(code)}">${body}</svg>`;
}
