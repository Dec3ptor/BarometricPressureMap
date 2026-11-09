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
- **Conditions reports**: pick a place and a day, a time window (such as a
  site visit or environmental monitoring round) or a date range of up to 31
  days, anywhere from 1940 to 15 days ahead. Download a PDF with a summary,
  charts, a day-by-day table, hourly values, your notes and a data
  disclaimer, or a CSV of the hourly values.
- **Learn**: a practical guide to reading pressure, plus a unit converter.
- Units: hPa/mb, inHg, mmHg, kPa, psi and atm; °C/°F; km/h, mph, m/s, knots.
- Favourites, recent places, light/dark theme, installable PWA with offline
  shell, and shareable links.
- Layouts that make use of large screens: a two-column place dashboard
  with a sticky map, a home page with a live map preview and world
  snapshot, a map side panel listing highs, lows and city readings in view,
  and a quick-reference column on the Learn page.

## Data sources

| What | Source |
| --- | --- |
| Forecast, history, map grid | [Open-Meteo](https://open-meteo.com/) forecast API (free, no key, CC BY 4.0) |
| Report data older than ~60 days | Open-Meteo Historical Weather API (ERA5 reanalysis, from 1940) |
| Place search | Open-Meteo geocoding API |
| "Use my location" place name | BigDataCloud client-side reverse geocoding |
| Base map | Esri World Gray Canvas (keyless), © OpenStreetMap contributors |

All requests go straight from the browser to these services. Settings and
favourites are kept in `localStorage`, and the map grid cache in IndexedDB.

## Ads

Ad spaces are reserved with fixed sizes so ads never shift the page when
they load. Everything is controlled from the `ADS` object at the top of
`js/ads.js`:

| `mode` | What visitors see |
| --- | --- |
| `'placeholder'` (default) | Labelled empty boxes showing where ads will go |
| `'adsense'` | Google AdSense units in those boxes |
| `'off'` | No ad space; layouts close up |

Where the spaces are:

| Screen | Spaces |
| --- | --- |
| PC, 1280 px and wider | A 160×600 rail fixed to the right of the page, and a second rail on the left from 1600 px. They become 300×600 from 2200 px. Content moves over so nothing sits under them. |
| PC side columns | 300×250 boxes under the place page map, below the Explore links on Home, in the Learn page's reference column and at the foot of the map page's side panel |
| All screens | A banner (728×90 on wide screens, 320×100 on phones) between sections. Phones get at most two per page and none on the full-screen map. |

To go live with AdSense:

1. Set `mode: 'adsense'` and `client` to your publisher ID (`ca-pub-…`).
2. Optionally create *rail*, *banner* and *box* ad units in AdSense and put
   their IDs in `slots`. Empty IDs use auto-sized units.
3. Add an `ads.txt` file at the site root as AdSense instructs. A GitHub
   Pages project site lives under `/BarometricPressureMap/`, but `ads.txt`
   must be at the domain root, so use a custom domain or a
   `<username>.github.io` repository for it.
4. For visitors in the EEA, UK and Switzerland, AdSense requires a consent
   message. Turn on Google's consent management in your AdSense account.

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
js/world-data.js        Shared live data for the ~170 tracked cities
js/charts.js            Chart.js history/forecast chart
js/gauge.js             SVG barometer dial
js/ads.js               Ad slot settings and AdSense loader
js/report-data.js       Report calculations (time windows, summaries)
js/report-export.js     Report charts, PDF and CSV output
js/views/*.js           Home, place, map, world, report and learn pages
vendor/                 Leaflet 1.9.4, Chart.js 4.4.7, jsPDF 2.5.2 and
                        jsPDF-AutoTable 3.8.4 (vendored; PDF tools load
                        only when a PDF is made)
sw.js                   Service worker for the offline app shell
```

## Licences

Leaflet (BSD-2-Clause), Chart.js (MIT), jsPDF (MIT), jsPDF-AutoTable (MIT)
and the Inter font (SIL OFL 1.1) are included under their own licences in
`vendor/` and `assets/fonts/`.
