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
  ['tendency', 'Tendency codes & tide'],
  ['altitude', 'Air density & altitude'],
  ['moisture', 'Humidity measures'],
  ['maps', 'Reading the maps'],
  ['health', 'Pressure & health'],
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
    <div class="page-head"><h1>Understanding barometric pressure</h1><p>What the numbers on this site mean and how they are calculated. Values are shown in your chosen unit (${esc(U.label)}).</p></div>
    <div class="learn-layout">
      <nav class="learn-toc" aria-label="On this page">${SECTIONS.map(([id, t]) => `<a href="javascript:void 0" data-goto="${id}">${esc(t)}</a>`).join('')}</nav>
      <article class="prose">
        <h2 id="what">What is barometric pressure?</h2>
        <p>Barometric (atmospheric) pressure is the force per unit area exerted by the weight of the air above a point. The International Standard Atmosphere (ISA) defines sea-level pressure as <strong>${p(1013.25)}</strong>, with a temperature of 15 °C and an air density of 1.225 kg/m³.</p>
        <p>Pressure differences between places drive the wind, and changes over time track the movement of highs, lows and fronts.</p>

        <h2 id="levels">High, normal and low pressure</h2>
        <p>These bands apply to <em>sea-level</em> pressure, the standard used on weather maps:</p>
        <table class="ref-table"><thead><tr><th>Band</th><th>${esc(U.label)}</th><th>Typical weather</th></tr></thead><tbody>${lvls}</tbody></table>
        <p>Most of the time, in most inhabited places, pressure stays between about ${p(995, { withUnit: false })} and ${p(1035)}. The extremes are far wider. The highest sea-level pressure on record is <strong>${p(1084.8)}</strong> (Tosontsengel, Mongolia, December 2001). The lowest is <strong>${p(870)}</strong>, measured in the eye of Typhoon Tip in October 1979.</p>

        <h2 id="trends">Reading trends</h2>
        <p>For forecasting, the change in pressure is usually more informative than the value. Observers report the change over the last <strong>three hours</strong>. This site describes it with these terms:</p>
        <table class="ref-table"><thead><tr><th>Term</th><th>Change in 3 hours</th><th>What it often means</th></tr></thead><tbody>
          <tr><td>Steady</td><td class="num">under ${p(0.5)}</td><td>No change in the weather pattern</td></tr>
          <tr><td>Rising / falling slowly</td><td class="num">${p(0.5, { withUnit: false })} – ${p(1.5)}</td><td>Gradual improvement or deterioration</td></tr>
          <tr><td>Rising / falling</td><td class="num">${p(1.6, { withUnit: false })} – ${p(3.5)}</td><td>A clear change is on the way</td></tr>
          <tr><td>Rising / falling quickly</td><td class="num">${p(3.6, { withUnit: false })} – ${p(6)}</td><td>Fronts passing; strong winds likely</td></tr>
          <tr><td>Very rapidly</td><td class="num">over ${p(6)}</td><td>Storm conditions likely</td></tr>
        </tbody></table>
        <p><strong>Falling</strong> pressure generally precedes cloud, wind and rain; <strong>rising</strong> pressure generally precedes clearing. A fall of 24 hPa or more in 24 hours at 60° latitude (scaled by sin φ / sin 60° elsewhere) defines <em>explosive cyclogenesis</em> ("bombogenesis"); the place page flags it when the forecast shows one.</p>
        <div class="callout">The values here come from weather models, which are smoother than a real barometer, so a change under ${p(0.5)} in three hours is treated as steady.</div>

        ${adSlot('banner', 'learn-ad-inline')}

        <h2 id="station">Sea-level vs station pressure</h2>
        <p>Pressure falls with height, by about <strong>${p(12)} per 100 m</strong> near sea level. At Denver (about 1,600 m) the pressure at the ground is typically around ${p(835)}.</p>
        <p><strong>Sea-level pressure</strong> (MSLP) is the station value reduced to sea level so places at different heights can be compared. Weather maps use it, and it is this site's default. In aviation, the altimeter setting <strong>QNH</strong> is closely related.</p>
        <p><strong>Station pressure</strong> (<strong>QFE</strong>) is the actual pressure at the ground. Use it to compare with an uncalibrated home barometer, or for anything that depends on the real air pressure, such as air density or boiling point.</p>

        <h2 id="tendency">Tendency codes and the daily tide</h2>
        <p>Synoptic weather reports (SYNOP) describe the last three hours with a <strong>tendency code</strong> from WMO code table 0200. It records the shape of the barograph trace as well as the net change:</p>
        <table class="ref-table"><thead><tr><th>Code</th><th>Trace over the last 3 hours</th></tr></thead><tbody>
          <tr><td>0</td><td>Rising, then falling; same or higher than 3 h ago</td></tr>
          <tr><td>1</td><td>Rising, then steady; or rising, then rising more slowly</td></tr>
          <tr><td>2</td><td>Rising steadily or unsteadily</td></tr>
          <tr><td>3</td><td>Falling or steady, then rising; or rising, then rising more quickly</td></tr>
          <tr><td>4</td><td>Steady</td></tr>
          <tr><td>5</td><td>Falling, then rising; same or lower than 3 h ago</td></tr>
          <tr><td>6</td><td>Falling, then steady; or falling, then falling more slowly</td></tr>
          <tr><td>7</td><td>Falling steadily or unsteadily</td></tr>
          <tr><td>8</td><td>Steady or rising, then falling; or falling, then falling more quickly</td></tr>
        </tbody></table>
        <p>Pressure also rises and falls twice a day with the <strong>semidiurnal atmospheric tide</strong>, driven by solar heating. It peaks near 10:00 and 22:00 local solar time, with an amplitude of about 1.16 · cos³(latitude) hPa: roughly ±1.2 hPa at the equator, ±0.5 hPa at 40°. In the tropics this daily rhythm can be larger than weather-driven changes. The place page shows the 3-hour change with the tide removed so the weather signal is easier to see.</p>

        <h2 id="altitude">Air density and altitude</h2>
        <p>These are calculated from the station pressure, temperature and dew point at the place:</p>
        <ul>
          <li><strong>Air density</strong> (kg/m³) is the sum of the dry-air and water-vapour partial densities, ρ = p<sub>d</sub>/(R<sub>d</sub>T) + e/(R<sub>v</sub>T). Moist air is slightly less dense than dry air. Density affects engine and propeller performance, aircraft and drone lift, wind-turbine output and ballistics.</li>
          <li><strong>Density altitude</strong> is the height in the standard atmosphere that has the same air density. On a hot day at an inland airfield it can be thousands of feet above the field elevation, which lengthens take-off rolls and reduces climb rate.</li>
          <li><strong>Pressure altitude</strong> is the height in the standard atmosphere with the same pressure as the station. It is what an altimeter reads when set to 1013.25 hPa (29.92 inHg).</li>
          <li><strong>Boiling point of water</strong> falls about 1 °C for every 285 m of height (Antoine equation). It matters for cooking and for the time needed to sterilise water.</li>
          <li><strong>Oxygen</strong> is shown as the oxygen partial pressure relative to standard sea level. The air is always 20.9% oxygen, but at lower pressure each breath contains less of it.</li>
        </ul>

        <h2 id="moisture">Humidity measures</h2>
        <ul>
          <li><strong>Relative humidity</strong> is the vapour pressure as a percentage of the saturation vapour pressure at the current temperature, so it changes with temperature even when the amount of moisture doesn't.</li>
          <li><strong>Dew point</strong> is the temperature at which the air would become saturated. It measures the actual moisture content and changes only when air masses change.</li>
          <li><strong>Vapour pressure</strong>, <strong>absolute humidity</strong> (grams of water per cubic metre) and <strong>mixing ratio</strong> (grams of water per kilogram of dry air) are other measures of that moisture content.</li>
          <li><strong>Dew-point spread</strong> (temperature minus dew point) below about 2.5 °C makes fog or low cloud likely. The base of cumulus cloud is roughly 125 m above the ground per °C of spread (Espy's rule).</li>
        </ul>

        <h2 id="maps">Reading the pressure maps</h2>
        <ul>
          <li><strong>Isobars</strong> are lines joining places with the same pressure. This site draws them at round values in your unit, usually every 4 hPa.</li>
          <li><strong>H</strong> marks a high-pressure centre and <strong>L</strong> a low. Air rises in a low, giving cloud and rain; it sinks in a high, giving settled conditions.</li>
          <li><strong>Closely spaced isobars mean strong wind.</strong> Wind blows roughly along the isobars, turning slightly toward low pressure.</li>
          <li>Around a low, wind circulates <em>anticlockwise</em> in the Northern Hemisphere and <em>clockwise</em> in the Southern. <em>Buys Ballot's law</em>: with your back to the wind in the Northern Hemisphere, low pressure is on your left (on your right in the Southern).</li>
          <li>Shading shows the pressure itself: <strong>blue</strong> for high, <strong>red</strong> for low. The labels give the current reading at nearby cities.</li>
        </ul>

        <h2 id="health">Pressure and health</h2>
        <p>Some studies have found associations between falling pressure and headache, migraine or joint pain in some people; results are mixed. The chart's lower panel shows the 3-hour change, and the day-by-day table's <strong>Variability</strong> column rates each day from the daily range and the fastest 3-hour change (low: under 5 hPa range; high: 10 hPa or more, or 3.6 hPa or more in 3 hours).</p>

        <h2 id="zambretti">The Zambretti forecaster</h2>
        <p>Negretti &amp; Zambra's 1915 forecaster maps sea-level pressure and its trend (and originally the season and wind direction) to one of 26 short forecasts, from "Settled fine" to "Stormy, much rain". Many home weather stations use it. This site uses the common simplified form without wind and season. It was devised for the British Isles and applies to the next 12 hours or so in mid-latitudes; the model forecast is more reliable.</p>

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
          <li><strong>Limits:</strong> Open-Meteo's free tier allows about 10,000 requests per day per network. Each map on the site loads its data once (up to about 50 points) and keeps it for an hour, so normal use stays well within that.</li>
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
    ${adSlot('multiplex', 'mx-ad')}
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
