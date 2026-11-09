// Guide to barometric pressure + unit converter.

import { settings } from '../store.js';
import { PRESSURE_UNITS, fmtPressure, toHpa } from '../units.js';
import { LEVELS } from '../analysis.js';
import { esc } from '../ui.js';
import { ADS, adSlot } from '../ads.js';

const SECTIONS = [
  ['what', 'What is it?'],
  ['levels', 'High, normal, low'],
  ['trends', 'Reading trends'],
  ['station', 'Sea level vs station'],
  ['maps', 'Reading the map'],
  ['health', 'Pressure & health'],
  ['fishing', 'Pressure & fishing'],
  ['zambretti', 'The Zambretti forecaster'],
  ['units', 'Units & converter'],
  ['about', 'About this site'],
];

export async function render(main) {
  const unit = settings.pressureUnit;
  const U = PRESSURE_UNITS[unit];
  const p = (hpa, o) => fmtPressure(hpa, unit, { withUnit: true, ...o });
  const lvls = LEVELS.map((l, i) => {
    const hi = i === 0 ? null : LEVELS[i - 1].min;
    const range = i === 0 ? `above ${p(l.min)}` : l.min === -Infinity ? `below ${p(hi)}` : `${p(l.min)} – ${p(hi)}`;
    return `<tr><td><span class="swatch" style="background:${l.color}"></span>${esc(l.label)}</td><td class="num">${range}</td><td>${esc(l.desc)}</td></tr>`;
  }).join('');

  main.innerHTML = `<div class="page page-learn">
    <div class="page-head"><h1>Understanding barometric pressure</h1><p>A short, practical guide to what the numbers on this site mean and how to use them. Values below are shown in your chosen unit (${esc(U.label)}).</p></div>
    <div class="learn-layout">
      <nav class="learn-toc" aria-label="On this page">${SECTIONS.map(([id, t]) => `<a href="javascript:void 0" data-goto="${id}">${esc(t)}</a>`).join('')}</nav>
      <article class="prose">
        <h2 id="what">What is barometric pressure?</h2>
        <p>Barometric (atmospheric) pressure is the weight of the column of air above you, pressing down on every surface. At sea level it averages <strong>${p(1013.25)}</strong>, which is one "standard atmosphere".</p>
        <p>It's never quite still. Air rises in some places and sinks in others, so pressure differs from place to place and from hour to hour. Those differences drive the wind, and how they change tells you a lot about the weather on its way.</p>

        <h2 id="levels">High, normal and low pressure</h2>
        <p>These bands apply to <em>sea-level</em> pressure, the standard used on weather maps:</p>
        <table class="ref-table"><thead><tr><th>Band</th><th>${esc(U.label)}</th><th>Typical weather</th></tr></thead><tbody>${lvls}</tbody></table>
        <p>Most of the time, in most inhabited places, pressure stays between about ${p(995, { withUnit: false })} and ${p(1035)}. The extremes are far wider. The highest sea-level pressure on record is <strong>${p(1084.8)}</strong> (Tosontsengel, Mongolia, December 2001). The lowest is <strong>${p(870)}</strong>, measured in the eye of Typhoon Tip in October 1979.</p>

        <h2 id="trends">Trends matter more than the number</h2>
        <p>A single reading tells you less than the direction it's moving. Forecasters describe the change over the last <strong>three hours</strong> using standard terms, and this site uses the same ones:</p>
        <table class="ref-table"><thead><tr><th>Term</th><th>Change in 3 hours</th><th>What it often means</th></tr></thead><tbody>
          <tr><td>Steady</td><td class="num">under ${p(0.5)}</td><td>No change in the weather pattern</td></tr>
          <tr><td>Rising / falling slowly</td><td class="num">${p(0.5, { withUnit: false })} – ${p(1.5)}</td><td>Gradual improvement or deterioration</td></tr>
          <tr><td>Rising / falling</td><td class="num">${p(1.6, { withUnit: false })} – ${p(3.5)}</td><td>A clear change is on the way</td></tr>
          <tr><td>Rising / falling quickly</td><td class="num">${p(3.6, { withUnit: false })} – ${p(6)}</td><td>Fronts passing; strong winds likely</td></tr>
          <tr><td>Very rapidly</td><td class="num">over ${p(6)}</td><td>Storm conditions likely</td></tr>
        </tbody></table>
        <p>As a rule of thumb, <strong>falling</strong> pressure signals clouds, wind and rain on the way, and <strong>rising</strong> pressure signals clearing, drier weather. A drop of 24 hPa or more in 24 hours (scaled for latitude) is called <em>bombogenesis</em>: a storm is deepening explosively. The location page warns you when the forecast shows one.</p>
        <div class="callout">Marine forecasts call a change under 0.1 hPa "steady". Computer models are smoother than real barometers, so this site treats anything under ${p(0.5)} in three hours as steady.</div>

        ${adSlot('banner', 'learn-ad-inline')}

        <h2 id="station">Sea-level vs station pressure</h2>
        <p>Pressure falls as you climb, by roughly <strong>${p(12)} for every 100 m</strong> near sea level. In Denver, about 1,600 m up, the air pressure at the ground is typically only around ${p(835)}.</p>
        <p>To compare places fairly, weather services convert readings to what the pressure <em>would be</em> at sea level. That's <strong>sea-level pressure</strong> (MSLP). It's the default on this site and on every weather map.</p>
        <p><strong>Station pressure</strong> is the actual, unadjusted pressure where you are. Switch to it (in Settings or on the chart) if you're comparing with a home barometer that hasn't been calibrated for your altitude, or if you're curious how much thinner the air is in the mountains. The ear-popping you feel on a drive up a hill is station pressure changing.</p>

        <h2 id="maps">Reading the pressure map</h2>
        <ul>
          <li><strong>Isobars</strong> are lines joining places with the same pressure. This site draws them at round values in your unit, usually every 4 hPa.</li>
          <li><strong>H</strong> marks a high-pressure centre and <strong>L</strong> a low. Lows bring weather; highs bring calm.</li>
          <li><strong>Closely spaced isobars mean strong wind.</strong> Wind blows roughly along the isobars, turning slightly toward low pressure.</li>
          <li>Around a low, wind circulates <em>anticlockwise</em> in the Northern Hemisphere and <em>clockwise</em> in the Southern. <em>Buys Ballot's law</em>: with your back to the wind in the Northern Hemisphere, low pressure is on your left (on your right in the Southern).</li>
          <li>The <strong>3 h change</strong> layer shows where pressure is falling (red) or rising (blue). Bands of falling pressure often run just ahead of approaching fronts.</li>
        </ul>

        <h2 id="health">Pressure and health</h2>
        <p>Many people say changing weather triggers <strong>migraines, headaches, joint or arthritis pain, or sinus pressure</strong>, and several studies have found links between falling pressure and symptoms in some people. Results vary, and not everyone is affected. If you're one of the sensitive ones, the trend and timing of changes matter more than the absolute number.</p>
        <ul>
          <li>The <strong>Pressure swings</strong> card on each location rates the next 24 hours and the coming days as Calm, Moderate or Big swing, based on the total range and the fastest 3-hour change.</li>
          <li>The lower panel of the chart shows the 3-hour change as bars. Tall red bars are the sharp drops many people notice.</li>
          <li>Keeping a symptom diary next to the chart can show whether pressure is a factor for you.</li>
        </ul>
        <p class="muted small">This is general information, not medical advice. Talk to a healthcare professional about managing your symptoms.</p>

        <h2 id="fishing">Pressure and fishing</h2>
        <p>Anglers have long watched the barometer. Common wisdom says fish feed actively while pressure is <strong>falling slowly</strong> ahead of a front, go quiet just after a front as pressure rises sharply, and pick up again once it stabilises. Stable high pressure with bright skies often pushes fish deeper. The <strong>Angler's outlook</strong> card applies these rules of thumb to the current trend.</p>

        <h2 id="zambretti">The Zambretti forecaster</h2>
        <p>In 1915 the instrument makers Negretti &amp; Zambra sold a pocket device that turned a barometer reading into a forecast. It uses the sea-level pressure, whether it's rising, falling or steady, and (originally) the season and wind direction. The result is one of 26 short forecasts, from "Settled fine" to "Stormy, much rain".</p>
        <p>This site uses a widely published simplified version of the method. It was designed for the British Isles and works best in mid-latitudes for the next 12 hours or so. Treat it as a fun, surprisingly decent second opinion next to the model forecast.</p>

        <h2 id="units">Units and converter</h2>
        <p>Pressure is quoted in many units. Hectopascals (hPa) and millibars (mb) are identical. Type in any box:</p>
        <div id="conv-slot"><div class="converter" id="converter">${Object.entries(PRESSURE_UNITS).map(([k, u]) => `<label>${esc(u.label)}<input class="input" inputmode="decimal" data-unit="${k}" value="${fmtPressure(1013.25, k)}"></label>`).join('')}</div></div>
        <p class="rail-note muted small">On wide screens the converter sits in the column on the right.</p>
        <table class="ref-table"><thead><tr><th>Unit</th><th>Standard atmosphere</th><th>Used mainly by</th></tr></thead><tbody>
          <tr><td>hPa / mb</td><td class="num">1013.25</td><td>Most of the world, aviation, meteorology</td></tr>
          <tr><td>inHg</td><td class="num">29.92</td><td>United States TV weather, US aviation</td></tr>
          <tr><td>mmHg</td><td class="num">760</td><td>Russia and parts of Eastern Europe, medicine</td></tr>
          <tr><td>kPa</td><td class="num">101.325</td><td>Canada (weather reports), engineering</td></tr>
          <tr><td>psi</td><td class="num">14.696</td><td>Engineering, tyres, diving</td></tr>
          <tr><td>atm</td><td class="num">1</td><td>Chemistry and physics</td></tr>
        </tbody></table>

        <h2 id="about">About this site</h2>
        <ul>
          <li><strong>Data:</strong> forecasts and recent history come from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, which blends national weather-service models (ECMWF, NOAA GFS/HRRR, DWD ICON, Météo-France, JMA and others) and picks the best one for each location. "History" is model analysis from the past 14 days, not a station observation, so it can differ slightly from a nearby airport report.</li>
          <li><strong>Place search</strong> uses Open-Meteo's geocoder. "Use my location" asks your browser for your position, and <a href="https://www.bigdatacloud.com/" target="_blank" rel="noopener">BigDataCloud</a> turns it into a place name.</li>
          <li><strong>Privacy:</strong> no accounts or analytics. Settings, favourites and report details stay in your browser's local storage. The weather services only receive the coordinates and dates needed to fetch data.${ADS.mode === 'adsense' ? ' This site shows ads from Google, which may use cookies to personalise ads. See <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">how Google uses data</a>.' : ''} Full details are in the <a href="privacy.html">privacy policy</a>.</li>
          <li><strong>Install it:</strong> it's a Progressive Web App. On iPhone or iPad, tap Share, then <em>Add to Home Screen</em>. On Android, open the Chrome menu and tap <em>Install app</em>. On desktop Chrome or Edge, use the install icon in the address bar.</li>
          <li><strong>Limits:</strong> Open-Meteo's free tier allows about 10,000 requests per day per network. The map loads up to ~180 grid points per view and caches them for an hour, so normal use stays well within that. Very fast panning across the globe can briefly hit the per-minute limit. If that happens the map keeps showing cached data and catches up a minute later.</li>
        </ul>
      </article>
      <aside class="learn-rail" aria-label="Quick reference">
        <section class="card">
          <div class="card-title">Unit converter</div>
          <div class="card-sub" style="margin-bottom:10px">Type in any box</div>
          <div id="conv-rail"></div>
        </section>
        <section class="card">
          <div class="card-title" style="margin-bottom:8px">Pressure bands <span class="muted small" style="font-weight:500">sea level</span></div>
          <ul class="rail-bands">${LEVELS.map((l, i) => {
            const hi = i === 0 ? null : LEVELS[i - 1].min;
            const range = i === 0 ? `above ${p(l.min)}` : l.min === -Infinity ? `below ${p(hi)}` : `${p(l.min, { withUnit: false })}–${p(hi)}`;
            return `<li><span class="chip" style="--dot:${l.color}">${esc(l.label)}</span><span class="num">${range}</span></li>`;
          }).join('')}</ul>
        </section>
        <section class="card">
          <div class="card-title" style="margin-bottom:8px">Trend in 3 hours</div>
          <ul class="rail-bands">
            <li><span>Steady</span><span class="num">under ${p(0.5)}</span></li>
            <li><span>Slowly</span><span class="num">${p(0.5, { withUnit: false })}–${p(1.5)}</span></li>
            <li><span>Rising / falling</span><span class="num">${p(1.6, { withUnit: false })}–${p(3.5)}</span></li>
            <li><span>Quickly</span><span class="num">${p(3.6, { withUnit: false })}–${p(6)}</span></li>
            <li><span>Very rapidly</span><span class="num">over ${p(6)}</span></li>
          </ul>
        </section>
        ${adSlot('box')}
      </aside>
    </div>
    <footer class="footer">Map tiles © Esri, HERE, Garmin, © OpenStreetMap contributors. Weather data © Open-Meteo (CC BY 4.0). · <a href="privacy.html">Privacy</a></footer>
  </div>`;

  main.querySelector('.learn-toc').addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    main.querySelector('#' + a.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const conv = main.querySelector('#converter');
  // The converter lives in the side column on wide screens, in the text otherwise.
  const rail = main.querySelector('.learn-rail');
  const placeConv = () => {
    const target = getComputedStyle(rail).display !== 'none' ? main.querySelector('#conv-rail') : main.querySelector('#conv-slot');
    if (conv.parentElement !== target) target.appendChild(conv);
  };
  placeConv();
  const ro = new ResizeObserver(placeConv);
  ro.observe(main);
  conv.addEventListener('input', (e) => {
    const inp = e.target.closest('input');
    if (!inp) return;
    const v = parseFloat(inp.value.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    const hpa = toHpa(v, inp.dataset.unit);
    conv.querySelectorAll('input').forEach((o) => { if (o !== inp) o.value = fmtPressure(hpa, o.dataset.unit); });
  });
  return () => ro.disconnect();
}
