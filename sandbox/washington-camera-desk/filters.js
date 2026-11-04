export const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const roadRank = value => /^I[- ]\d/i.test(value) ? 0 : /^US \d/i.test(value) ? 1 : /^SR \d/i.test(value) ? 2 : /ferr/i.test(value) ? 4 : /airport/i.test(value) ? 5 : 3;
export function prepareCameras(cameras, overrides = {}) {
  const seen = new Set();
  return cameras.filter(camera => {
    const id = String(camera.id ?? '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(camera => {
    const override = overrides[camera.id];
    const countyMatch = override && override.lat === camera.lat && override.lon === camera.lon;
    const rawCounty = String((countyMatch ? override.county : camera.county) || '').trim();
    const county = /^(unspecified|unknown)( county)?$/i.test(rawCounty) ? '' : rawCounty.replace(/\s+county$/i, '').trim();
    const metro = camera.metro || camera.region || 'Other Washington';
    const road = String(camera.road || 'Other roads');
    const roads = [...new Set([road, ...(Array.isArray(camera.roads) ? camera.roads : [])].filter(Boolean).map(String))];
    const result = {...camera, id:String(camera.id), county, metro, road, roads};
    result.searchText = normalize([result.name, (result.aliases || []).join(' '), result.id, result.siteId, result.roads.join(' '), result.county, result.metro, result.region, result.crossStreet, result.provider].join(' '));
    return result;
  }).sort((a,b) => Number(a.embedMode==='official') - Number(b.embedMode==='official') || Number(a.disabled || a.imageStatus==='unavailable' || a.imageStatus==='stale') - Number(b.disabled || b.imageStatus==='unavailable' || b.imageStatus==='stale') || roadRank(a.road) - roadRank(b.road) || a.road.localeCompare(b.road, undefined, {numeric:true}) || a.name.localeCompare(b.name, undefined, {numeric:true}));
}
export function filterCameras(cameras, filters, favorites = new Set(), bounds = null, exclude = '') {
  const query = normalize(filters.query);
  const words = query.split(' ').filter(Boolean);
  return cameras.filter(camera => {
    if (exclude !== 'metro' && filters.metro && camera.metro !== filters.metro) return false;
    if (exclude !== 'county' && filters.county && camera.county !== filters.county) return false;
    if (exclude !== 'road' && filters.road && !(camera.roads || [camera.road]).includes(filters.road)) return false;
    if (filters.delivery === 'available' && camera.imageStatus !== 'available') return false;
    if (filters.delivery === 'unavailable' && !['unavailable','disabled','stale'].includes(camera.imageStatus)) return false;
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
    const values = key === 'road' ? (camera.roads || [camera.road]) : [camera[key]];
    for (const value of new Set(values.filter(Boolean))) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts].sort((a,b) => (key === 'road' ? roadRank(a[0]) - roadRank(b[0]) : 0) || a[0].localeCompare(b[0],undefined,{numeric:true}));
}
