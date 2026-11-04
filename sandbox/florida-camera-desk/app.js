const REGIONS = Object.freeze({
  statewide: { label: 'Statewide', code: 'ALL' },
  panhandle: { label: 'Panhandle', code: 'NW' },
  northeast: { label: 'Northeast', code: 'NE' },
  central: { label: 'Central', code: 'CEN' },
  'tampa-bay': { label: 'Tampa Bay', code: 'TB' },
  southwest: { label: 'Southwest', code: 'SW' },
  southeast: { label: 'Southeast', code: 'SE' },
  keys: { label: 'Florida Keys', lat: '24.72', lng: '-81.10', zoom: '9' }
});

const regionSelect = document.querySelector('#region-select');
const frame = document.querySelector('#fl511-map');
const status = document.querySelector('#map-status');
const regionCards = [...document.querySelectorAll('[data-region]')];
const layerInputs = [...document.querySelectorAll('.layer-controls input')];

function selectedRegion() {
  const slug = new URLSearchParams(window.location.search).get('region');
  return Object.hasOwn(REGIONS, slug) ? slug : 'statewide';
}

function buildMapUrl(slug) {
  const region = REGIONS[slug];
  const url = new URL('https://www.fl511.com/Map/EmbeddedMap');
  if (region.code) {
    url.searchParams.set('region', region.code);
  } else {
    url.searchParams.set('lat', region.lat);
    url.searchParams.set('lng', region.lng);
    url.searchParams.set('zoom', region.zoom);
  }
  url.searchParams.set('layers', ['Cameras', ...layerInputs.filter(input => input.checked).map(input => input.value)].join(','));
  url.searchParams.set('size', '4');
  return url.toString();
}

function renderMap(slug, announce = false) {
  const region = REGIONS[slug];
  if (!region) return;
  regionSelect.value = slug;
  regionCards.forEach(card => card.setAttribute('aria-pressed', String(card.dataset.region === slug)));
  frame.title = `FL511 official camera map for ${region.label}`;
  const url = buildMapUrl(slug);
  if (frame.src !== url) frame.src = url;
  if (announce) status.textContent = `Showing ${region.label} on the official FL511 map. Select a camera marker to view its feed.`;
}

function setRegion(slug) {
  if (!Object.hasOwn(REGIONS, slug)) return;
  const url = new URL(window.location.href);
  if (slug === 'statewide') url.searchParams.delete('region');
  else url.searchParams.set('region', slug);
  window.history.pushState(null, '', url);
  renderMap(slug, true);
}

regionSelect.addEventListener('change', () => setRegion(regionSelect.value));
regionCards.forEach(card => card.addEventListener('click', () => {
  setRegion(card.dataset.region);
  document.querySelector('#live-map').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}));
layerInputs.forEach(input => input.addEventListener('change', () => renderMap(regionSelect.value, true)));
window.addEventListener('popstate', () => renderMap(selectedRegion(), true));
renderMap(selectedRegion());
