export const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function prepareCameras(cameras) {
  const seen = new Set();
  return cameras.filter(camera => {
    if (!camera.id || seen.has(String(camera.id))) return false;
    seen.add(String(camera.id));
    return true;
  }).map(camera => {
    const result = {...camera, id:String(camera.id), county:camera.county || '', metro:camera.metro || camera.region || 'Unassigned quadrant', road:camera.road || 'Other roads'};
    result.searchText = normalize([result.name, result.description, result.id, result.road, result.county, result.metro, result.region, result.provider].join(' '));
    return result;
  }).sort((a,b) => Number(a.disabled || a.imageStatus==='unavailable' || a.imageStatus==='stale') - Number(b.disabled || b.imageStatus==='unavailable' || b.imageStatus==='stale') || a.road.localeCompare(b.road,undefined,{numeric:true}) || a.name.localeCompare(b.name,undefined,{numeric:true}));
}

export function filterCameras(cameras, filters, favorites = new Set(), bounds = null, exclude = '') {
  const words = normalize(filters.query).split(' ').filter(Boolean);
  return cameras.filter(camera => {
    for (const key of ['metro','county','road']) if (exclude!==key && filters[key] && camera[key]!==filters[key]) return false;
    if (filters.delivery==='snapshot' && camera.imageStatus!=='available') return false;
    if (filters.delivery==='unavailable' && !(camera.imageStatus==='unavailable' || camera.disabled)) return false;
    if (filters.favorites && !favorites.has(camera.id)) return false;
    if (words.some(word => !camera.searchText.includes(word))) return false;
    if (filters.withinMap && bounds && !(Number.isFinite(camera.lat) && Number.isFinite(camera.lon) && camera.lat>=bounds.south && camera.lat<=bounds.north && camera.lon>=bounds.west && camera.lon<=bounds.east)) return false;
    return true;
  });
}

export function getFacet(cameras, key, filters, favorites = new Set(), bounds = null) {
  const counts = new Map();
  const facetFilters = {...filters};
  if (key==='metro') {facetFilters.county='';facetFilters.road='';}
  if (key==='county') facetFilters.road='';
  for (const camera of filterCameras(cameras,facetFilters,favorites,bounds,key)) {
    if (camera[key]) counts.set(camera[key],(counts.get(camera[key])||0)+1);
  }
  return [...counts].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));
}
