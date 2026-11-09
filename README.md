# BaroCast

Barometric pressure for anywhere on Earth: two weeks of history, a 16-day
forecast, trend alerts, a classic barometer dial, isobar maps and
conditions reports.
A static site with no build step, no backend and no API keys, hosted on
GitHub Pages.

## Features

- **Place dashboard**: current sea-level or station pressure, 3-hour trend in
  standard forecast terms (steady / slowly / quickly / very rapidly), an
  aneroid-style dial with 24 h-ago and +24 h hands, and high/low bands.
- **History and forecast chart**: 14 days back and 16 days ahead, hourly. Includes
  a 3-hour-change panel, normal-range band, forecast shown dashed, and optional
  temperature, humidity, wind or rain-chance overlays.
- **Isobar maps**: fixed preview maps on the home and place pages show
  pressure shading, isobars with labels, highs and lows, and city readings.
  Each loads its data once, with no panning or zooming, to keep API use low.
  (A full interactive map was removed for now, since heavy use would need a
  paid weather API plan.)
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
  with a sticky map, a home page with a map preview and world snapshot,
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
| `'placeholder'` | Labelled empty boxes showing where ads will go |
| `'adsense'` (current) | Google AdSense units in those boxes |
| `'off'` | No ad space; layouts close up |

Where the spaces are:

| Screen | Spaces |
| --- | --- |
| PC, 1280 px and wider | A 160×600 rail fixed to the right of the page, and a second rail on the left from 1600 px. They become 300×600 from 2200 px. Content moves over so nothing sits under them. |
| PC side columns | 300×250 boxes under the place page map, below the Explore links on Home, and in the Learn page's reference column |
| All screens | A banner (728×90 on wide screens, 320×100 on phones) between sections. Phones get at most two per page. |
| End of pages | A full-width Multiplex unit at the end of the Home, place, World and Learn pages |

To go live with AdSense:

1. Set `mode: 'adsense'` and `client` to your publisher ID (`ca-pub-…`).
2. Create three display ad units in AdSense (Ads → By ad unit → Display
   ads): a vertical one for the side rails, a horizontal one for banners and
   a square one for boxes. Put their IDs in `slots`. A space with no unit ID
   is left out, and AdSense Auto ads (if on) places its own ads instead.
   Add the AdSense `<script>` tag from **Get code** to the `<head>` of
   `index.html` and `privacy.html`.
3. Add an `ads.txt` file at the site root (https://barocast.nz/ads.txt)
   with the line AdSense gives you.
4. For visitors in the EEA, UK and Switzerland, AdSense requires a consent
   message. Turn on Google's consent management in your AdSense account.

## Hosting on GitHub Pages

The site is plain static files at the repository root, so no build is needed.
It deploys from **`main`** / **`/ (root)`** (Settings → Pages → Deploy from a
branch) and is served at **https://barocast.nz/**. The `.nojekyll` file stops
GitHub from running Jekyll over the files.

### Custom domain (barocast.nz)

DNS records at the domain registrar (Crazy Domains):

| Type | Name | Value |
| --- | --- | --- |
| A | `@` (barocast.nz) | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA (optional) | `@` | `2606:50c0:8000::153`, `…8001::153`, `…8002::153`, `…8003::153` |
| CNAME | `www` | `dec3ptor.github.io` |
| TXT (domain verification) | `_github-pages-challenge-dec3ptor` | value shown by GitHub |

Then in the repo: Settings → Pages → Custom domain → `barocast.nz` → Save,
and tick **Enforce HTTPS** once GitHub has issued the certificate. Saving the
domain makes GitHub commit a `CNAME` file to `main`; keep that file. The old
`dec3ptor.github.io/BarometricPressureMap/` address redirects automatically.

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
js/pressure-layer.js    Map grid fetching + canvas isobar renderer (preview maps)
js/world-data.js        Shared live data for the ~170 tracked cities
js/charts.js            Chart.js history/forecast chart
js/gauge.js             SVG barometer dial
js/ads.js               Ad slot settings and AdSense loader
js/report-data.js       Report calculations (time windows, summaries)
js/report-export.js     Report charts, PDF and CSV output
js/views/*.js           Home, place, world, report and learn pages
vendor/                 Leaflet 1.9.4, Chart.js 4.4.7, jsPDF 2.5.2 and
                        jsPDF-AutoTable 3.8.4 (vendored; PDF tools load
                        only when a PDF is made)
sw.js                   Service worker for the offline app shell
```

## Licences

Leaflet (BSD-2-Clause), Chart.js (MIT), jsPDF (MIT), jsPDF-AutoTable (MIT)
and the Inter font (SIL OFL 1.1) are included under their own licences in
`vendor/` and `assets/fonts/`.
