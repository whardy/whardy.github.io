export const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function prepareCameras(cameras) {
  const seen = new Set();
  const prepared = cameras.filter(camera => {
    if (!camera.id || seen.has(String(camera.id))) return false;
    seen.add(String(camera.id));
    return true;
  }).map(camera => {
    const result = {...camera, id:String(camera.id), county:camera.county || '', metro:camera.metro || camera.region || 'Other New York', road:camera.road || 'Other roads'};
    result.searchText = normalize([result.name, result.description, result.id, result.road, result.county, result.metro, result.region, result.provider].join(' '));
    return result;
  }).sort((a,b) => Number(a.imageStatus!=='available') - Number(b.imageStatus!=='available') || a.road.localeCompare(b.road,undefined,{numeric:true}) || a.name.localeCompare(b.name,undefined,{numeric:true}));
  // The statewide wall starts with views from across the state, then continues
  // through each area in the same stable order on later pages.
  const order = ['New York City','Long Island','Hudson Valley','Capital Region','Central New York','Finger Lakes','Western New York','Southern Tier','North Country'];
  const groups = new Map(order.map(area => [area,[]]));
  for (const camera of prepared) {
    if (!groups.has(camera.metro)) groups.set(camera.metro,[]);
    groups.get(camera.metro).push(camera);
  }
  const result = [];
  for (let index=0; result.length<prepared.length; index++) {
    for (const group of groups.values()) if (index<group.length) result.push(group[index]);
  }
  return result;
}

export function filterCameras(cameras, filters, favorites = new Set(), bounds = null, exclude = '') {
  const words = normalize(filters.query).split(' ').filter(Boolean);
  return cameras.filter(camera => {
    for (const key of ['metro','county','road','provider']) if (exclude!==key && filters[key] && camera[key]!==filters[key]) return false;
    if (filters.delivery==='video' && camera.videoStatus!=='available') return false;
    if (filters.delivery==='snapshot' && camera.imageStatus!=='available') return false;
    if (filters.delivery==='unavailable' && !(['unavailable','unknown'].includes(camera.imageStatus) || ['unavailable','unknown'].includes(camera.videoStatus))) return false;
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
