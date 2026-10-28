// County groups are browsing conveniences, not official metropolitan boundaries.
export const METRO_GROUPS = [
  ['Philadelphia & suburbs', ['Philadelphia', 'Bucks', 'Chester', 'Delaware', 'Montgomery']],
  ['Pittsburgh & southwest', ['Allegheny', 'Armstrong', 'Beaver', 'Butler', 'Fayette', 'Greene', 'Lawrence', 'Washington', 'Westmoreland']],
  ['Harrisburg & Carlisle', ['Dauphin', 'Cumberland', 'Perry']],
  ['Lancaster', ['Lancaster']],
  ['York & Hanover', ['York', 'Adams']],
  ['Lehigh Valley', ['Lehigh', 'Northampton', 'Carbon']],
  ['Reading', ['Berks']],
  ['Scranton & Wilkes-Barre', ['Lackawanna', 'Luzerne', 'Wyoming']],
  ['Poconos', ['Monroe', 'Pike', 'Wayne']],
  ['Erie & northwest', ['Erie', 'Crawford', 'Warren', 'Forest', 'Venango', 'Clarion', 'Mercer']],
  ['State College', ['Centre']],
  ['Altoona & Johnstown', ['Bedford', 'Blair', 'Cambria', 'Somerset', 'Indiana']],
  ['Williamsport & north central', ['Clinton', 'Lycoming', 'Sullivan', 'Tioga', 'Potter', 'Cameron', 'Elk', 'McKean']],
  ['Susquehanna Valley', ['Columbia', 'Montour', 'Northumberland', 'Snyder', 'Union']],
  ['Lebanon & Schuylkill', ['Lebanon', 'Schuylkill']],
  ['Northern Tier', ['Bradford', 'Susquehanna']],
  ['DuBois & Clearfield', ['Clearfield', 'Jefferson']],
  ['Chambersburg & central valleys', ['Franklin', 'Fulton', 'Huntingdon', 'Juniata', 'Mifflin']],
];
const countyMetro = new Map(METRO_GROUPS.flatMap(([metro, counties]) => counties.map(county => [county.toLowerCase(), metro])));
export const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function prepareCameras(cameras, overrides = {}) {
  const seen = new Set();
  return cameras.filter(camera => {
    const id = String(camera.id ?? '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(camera => {
    const county = String(overrides[camera.id]?.county || camera.county || '').replace(/\s+county$/i, '').trim();
    const metro = countyMetro.get(county.toLowerCase()) || (camera.region && camera.region !== 'Pennsylvania' ? camera.region : 'Border & unlocated cameras');
    const result = {...camera, id:String(camera.id), county, metro, road:String(camera.road || 'Other roads')};
    result.searchText = normalize([result.name, result.id, result.siteId, result.road, result.county, result.metro, result.region].join(' '));
    return result;
  }).sort((a,b) => Number(a.disabled || a.imageStatus==='unavailable') - Number(b.disabled || b.imageStatus==='unavailable') || a.road.localeCompare(b.road, undefined, {numeric:true}) || a.name.localeCompare(b.name, undefined, {numeric:true}));
}
export function filterCameras(cameras, filters, favorites = new Set(), bounds = null, exclude = '') {
  const query = normalize(filters.query);
  const words = query.split(' ').filter(Boolean);
  return cameras.filter(camera => {
    if (exclude !== 'metro' && filters.metro && camera.metro !== filters.metro) return false;
    if (exclude !== 'county' && filters.county && camera.county !== filters.county) return false;
    if (exclude !== 'road' && filters.road && camera.road !== filters.road) return false;
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
