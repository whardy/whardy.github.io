export const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function prepareCameras(cameras, overrides = {}) {
  const seen = new Set();
  return cameras.filter(camera => {
    const id = String(camera.id ?? '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(camera => {
    const rawCounty = String(overrides[camera.id]?.county || camera.county || '').trim();
    const county = /^(unspecified|unknown)( county)?$/i.test(rawCounty) ? '' : rawCounty.replace(/\s+county$/i, '').trim();
    const metro = camera.metro || camera.region || 'Other Texas';
    const result = {...camera, id:String(camera.id), county, metro, road:String(camera.road || 'Other roads')};
    result.searchText = normalize([result.name, result.id, result.siteId, result.road, result.county, result.metro, result.region, result.crossStreet, result.provider].join(' '));
    return result;
  }).sort((a,b) => Number(a.embedMode==='official') - Number(b.embedMode==='official') || Number(a.disabled || a.imageStatus==='unavailable' || a.imageStatus==='stale') - Number(b.disabled || b.imageStatus==='unavailable' || b.imageStatus==='stale') || a.road.localeCompare(b.road, undefined, {numeric:true}) || a.name.localeCompare(b.name, undefined, {numeric:true}));
}
export function filterCameras(cameras, filters, favorites = new Set(), bounds = null, exclude = '') {
  const query = normalize(filters.query);
  const words = query.split(' ').filter(Boolean);
  return cameras.filter(camera => {
    if (exclude !== 'metro' && filters.metro && camera.metro !== filters.metro) return false;
    if (exclude !== 'county' && filters.county && camera.county !== filters.county) return false;
    if (exclude !== 'road' && filters.road && camera.road !== filters.road) return false;
    if (filters.delivery === 'snapshot' && camera.embedMode === 'official') return false;
    if (filters.delivery === 'official' && camera.embedMode !== 'official') return false;
    if (filters.favorites && !favorites.has(camera.id)) return false;
    if (words.some(word => !camera.searchText.includes(word))) return false;
    if (filters.withinMap && bounds && !(Number.isFinite(camera.lat) && Number.isFinite(camera.lon) && camera.lat >= bounds.south && camera.lat <= bounds.north && camera.lon >= bounds.west && camera.lon <= bounds.east)) return false;
    return true;
  });
}
export function getFacet(cameras, key, filters, favorites, bounds) {
  const counts = new Map();
  const facetFilters = {...filters};
  if (key === 'metro') {facetFilters.county='';facetFilters.road='';}
  if (key === 'county') facetFilters.road='';
  filterCameras(cameras, facetFilters, favorites, bounds, key).forEach(camera => {
    if (camera[key]) counts.set(camera[key], (counts.get(camera[key]) || 0) + 1);
  });
  return [...counts].sort((a,b) => a[0].localeCompare(b[0],undefined,{numeric:true}));
}
