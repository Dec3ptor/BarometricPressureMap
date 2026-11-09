// Ad slots. Everything about ads is controlled from the ADS object below.
//
//   mode: 'placeholder'  Shows labelled empty boxes where ads will go.
//         'adsense'      Fills the boxes with Google AdSense units.
//         'off'          No ad space at all; the layout closes up.
//
// Slot types and the sizes they reserve:
//   rail    160x600 skyscraper fixed beside the page on large screens
//           (300x600 on very large screens)
//   banner  responsive horizontal unit inside pages
//           (728x90 on desktop, 320x100 on phones)
//   box     300x250 rectangle in side columns on large screens
//   multiplex  full-width grid of ad tiles at the end of longer pages
//
// To go live with AdSense: set mode to 'adsense', put your publisher ID in
// client (ca-pub-...) and the ad unit IDs from your AdSense account in
// slots. The AdSense script tag must also be in the <head> of index.html
// and privacy.html (Google checks for it there). In 'adsense' mode a space
// whose unit ID is empty is left out entirely, so no empty boxes show;
// AdSense Auto ads, if switched on in your account, still work.

export const ADS = {
  mode: 'adsense',
  adsense: {
    client: 'ca-pub-9990772667977184',
    // The "HorAd" unit is a responsive display unit, so it adapts to each
    // space. Separate units per space would give separate earnings reports.
    slots: { rail: '5608118035', banner: '5608118035', box: '5608118035', multiplex: '3257286869' },
  },
};

export const adsOn = () => ADS.mode === 'placeholder' || ADS.mode === 'adsense';

// Whether a given kind of space should be shown.
export const slotOn = (kind) => ADS.mode === 'placeholder' || (ADS.mode === 'adsense' && !!ADS.adsense.slots[kind]);

const SIZES = {
  rail: 'Ad space · 160×600',
  banner: 'Ad space · 728×90 / 320×100',
  box: 'Ad space · 300×250',
  multiplex: 'Ad space · multiplex (full width)',
};

// HTML for a slot. `cls` adds extra classes for placement/visibility.
export function adSlot(kind, cls = '') {
  if (!slotOn(kind)) return '';
  return `<div class="ad ad-${kind} ${cls}" data-ad="${kind}" role="complementary" aria-label="Advertisement">
    <span class="ad-label">Advertisement</span>
    <div class="ad-body">${ADS.mode === 'placeholder' ? `<span class="ad-ph">${SIZES[kind]}</span>` : ''}</div>
  </div>`;
}

let scriptLoaded = false;
function loadAdsense() {
  // Normally already in the page <head>; only add it if it's missing.
  if (!scriptLoaded && document.querySelector('script[src*="adsbygoogle.js"]')) scriptLoaded = true;
  if (scriptLoaded) return;
  scriptLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS.adsense.client)}`;
  document.head.appendChild(s);
}

// Fill any unfilled, visible slots under root. Hidden slots (for example a
// desktop-only box on a phone) are skipped so no ad loads where it can't be seen.
export function fillAds(root = document) {
  if (ADS.mode !== 'adsense') return;
  const slots = [...root.querySelectorAll('.ad[data-ad]:not([data-filled])')].filter((el) => el.offsetParent !== null);
  if (!slots.length) return;
  loadAdsense();
  for (const el of slots) {
    const kind = el.dataset.ad;
    const unit = ADS.adsense.slots[kind];
    if (!unit) continue;
    el.querySelector('.ad-body').innerHTML = kind === 'multiplex'
      ? `<ins class="adsbygoogle" style="display:block;width:100%" data-ad-format="autorelaxed"
          data-ad-client="${ADS.adsense.client}" data-ad-slot="${unit}"></ins>`
      : `<ins class="adsbygoogle" style="display:block;width:100%;height:100%"
          data-ad-client="${ADS.adsense.client}" data-ad-slot="${unit}"
          data-ad-format="${kind === 'rail' ? 'vertical' : kind === 'banner' ? 'horizontal' : 'rectangle'}"
          data-full-width-responsive="false"></ins>`;
    el.dataset.filled = '1';
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked */ }
  }
}
