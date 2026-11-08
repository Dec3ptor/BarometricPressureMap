# Barometric Pressure Map

Barometric pressure for anywhere on Earth: two weeks of history, a 16-day
forecast, trend alerts, a classic barometer dial and a live isobar map.
A static site with no build step, no backend and no API keys, hosted on
GitHub Pages.

## Features

- **Place dashboard**: current sea-level or station pressure, 3-hour trend in
  standard forecast terms (steady / slowly / quickly / very rapidly), an
  aneroid-style dial with 24 h-ago and +24 h hands, and high/low bands.
- **History and forecast chart**: 14 days back and 16 days ahead, hourly. Includes
  a 3-hour-change panel, normal-range band, forecast shown dashed, and optional
  temperature, humidity, wind or rain-chance overlays.
- **Live pressure map**: smooth isobars with labels, H/L centres, colour
  shading or 3-hour change, wind arrows and city readings. Has a 4-day time
  slider with play, and you can tap anywhere for a reading.
- **Outlooks**: Zambretti barometer forecast, pressure-swing outlook for
  weather-sensitive people, angler's outlook, a 48-hour summary, and alerts for
  sharp drops or rises and explosive storm deepening.
- **Day-by-day table** with daily pressure range, change and weather.
- **World rankings**: highest, lowest, fastest rising and falling, and most
  stable pressure across ~170 cities, computed live in the browser.
- **Learn**: a practical guide to reading pressure, plus a unit converter.
- Units: hPa/mb, inHg, mmHg, kPa, psi and atm; °C/°F; km/h, mph, m/s, knots.
- Favourites, recent places, light/dark theme, installable PWA with offline
  shell, and shareable links.

## Data sources

| What | Source |
| --- | --- |
| Forecast, history, map grid | [Open-Meteo](https://open-meteo.com/) forecast API (free, no key, CC BY 4.0) |
| Place search | Open-Meteo geocoding API |
| "Use my location" place name | BigDataCloud client-side reverse geocoding |
| Base map | Esri World Gray Canvas (keyless), © OpenStreetMap contributors |

All requests go straight from the browser to these services. Settings and
favourites are kept in `localStorage`, and the map grid cache in IndexedDB.

## Hosting on GitHub Pages

The site is plain static files at the repository root, so no build is needed.

1. Merge this branch into `main`.
2. In the repo, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   then choose **`main`** and **`/ (root)`** and save.
4. After a minute the site is live at
   `https://<your-username>.github.io/BarometricPressureMap/`.

The `.nojekyll` file stops GitHub from running Jekyll over the files.

## Running locally

Any static file server works. For example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Project layout

```
index.html              App shell (top bar, tab bar, search + settings dialogs)
css/app.css             All styles, light + dark themes
js/main.js              Router, search, settings, PWA install
js/api.js               Open-Meteo / geocoding clients with caching
js/analysis.js          Trends, levels, Zambretti, swings, alerts
js/pressure-layer.js    Map grid fetching + canvas isobar renderer
js/charts.js            Chart.js history/forecast chart
js/gauge.js             SVG barometer dial
js/views/*.js           Home, place, map, world and learn pages
vendor/                 Leaflet 1.9.4 and Chart.js 4.4.7 (vendored)
sw.js                   Service worker for the offline app shell
```

## Licences

Leaflet (BSD-2-Clause), Chart.js (MIT) and the Inter font (SIL OFL 1.1) are
included under their own licences in `vendor/` and `assets/fonts/`.
