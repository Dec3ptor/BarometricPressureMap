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
//
// To go live with AdSense: set mode to 'adsense', put your publisher ID in
// client (ca-pub-...) and the ad unit IDs from your AdSense account in
// slots. Unit IDs left empty fall back to AdSense auto-sized units.

export const ADS = {
  mode: 'placeholder',
  adsense: {
    client: 'ca-pub-0000000000000000',
    slots: { rail: '', banner: '', box: '' },
  },
};

export const adsOn = () => ADS.mode === 'placeholder' || ADS.mode === 'adsense';

const SIZES = {
  rail: 'Ad space · 160×600',
  banner: 'Ad space · 728×90 / 320×100',
  box: 'Ad space · 300×250',
};

// HTML for a slot. `cls` adds extra classes for placement/visibility.
export function adSlot(kind, cls = '') {
  if (!adsOn()) return '';
  return `<div class="ad ad-${kind} ${cls}" data-ad="${kind}" role="complementary" aria-label="Advertisement">
    <span class="ad-label">Advertisement</span>
    <div class="ad-body">${ADS.mode === 'placeholder' ? `<span class="ad-ph">${SIZES[kind]}</span>` : ''}</div>
  </div>`;
}

let scriptLoaded = false;
function loadAdsense() {
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
    const format = kind === 'rail' ? 'vertical' : kind === 'banner' ? 'horizontal' : 'rectangle';
    el.querySelector('.ad-body').innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%;height:100%"
      data-ad-client="${ADS.adsense.client}" ${unit ? `data-ad-slot="${unit}"` : ''} data-ad-format="${format}"
      data-full-width-responsive="false"></ins>`;
    el.dataset.filled = '1';
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked */ }
  }
}
