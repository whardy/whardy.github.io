// County/city groups are browsing conveniences, not official metropolitan boundaries.
// All 133 Virginia counties and independent cities are covered; empty groups are hidden.
export const METRO_GROUPS = [
  ['Northern Virginia', ['Arlington County', 'Fairfax County', 'Loudoun County', 'Prince William County', 'Fauquier County', 'Alexandria City', 'Fairfax City', 'Falls Church City', 'Manassas City', 'Manassas Park City']],
  ['Fredericksburg & area', ['Stafford County', 'Spotsylvania County', 'Caroline County', 'King George County', 'Fredericksburg City']],
  ['Richmond & Petersburg', ['Richmond City', 'Henrico County', 'Chesterfield County', 'Hanover County', 'Powhatan County', 'Goochland County', 'New Kent County', 'Charles City County', 'Amelia County', 'Dinwiddie County', 'Prince George County', 'Sussex County', 'Colonial Heights City', 'Hopewell City', 'Petersburg City']],
  ['Hampton Roads', ['Virginia Beach City', 'Chesapeake City', 'Norfolk City', 'Portsmouth City', 'Hampton City', 'Newport News City', 'Poquoson City', 'Suffolk City', 'Williamsburg City', 'Franklin City', 'James City County', 'York County', 'Isle of Wight County', 'Southampton County', 'Surry County']],
  ['Charlottesville & area', ['Albemarle County', 'Greene County', 'Nelson County', 'Fluvanna County', 'Louisa County', 'Charlottesville City']],
  ['Roanoke & Salem', ['Roanoke County', 'Roanoke City', 'Salem City', 'Botetourt County', 'Craig County', 'Franklin County']],
  ['Lynchburg & area', ['Amherst County', 'Appomattox County', 'Bedford County', 'Campbell County', 'Lynchburg City']],
  ['Harrisonburg & Staunton', ['Augusta County', 'Rockingham County', 'Highland County', 'Bath County', 'Harrisonburg City', 'Staunton City', 'Waynesboro City']],
  ['Winchester & Shenandoah Valley', ['Frederick County', 'Clarke County', 'Warren County', 'Shenandoah County', 'Page County', 'Winchester City']],
  ['New River Valley', ['Montgomery County', 'Pulaski County', 'Giles County', 'Floyd County', 'Radford City']],
  ['Bristol & Abingdon', ['Washington County', 'Smyth County', 'Bristol City']],
  ['Wytheville & Galax', ['Bland County', 'Wythe County', 'Carroll County', 'Grayson County', 'Galax City']],
  ['Danville & Martinsville', ['Pittsylvania County', 'Henry County', 'Patrick County', 'Halifax County', 'Danville City', 'Martinsville City']],
  ['Southside', ['Brunswick County', 'Greensville County', 'Mecklenburg County', 'Charlotte County', 'Lunenburg County', 'Nottoway County', 'Prince Edward County', 'Buckingham County', 'Cumberland County', 'Emporia City']],
  ['Eastern Shore', ['Accomack County', 'Northampton County']],
  ['Southwest Virginia', ['Lee County', 'Scott County', 'Wise County', 'Dickenson County', 'Buchanan County', 'Russell County', 'Tazewell County', 'Norton City']],
  ['Lexington & Alleghany Highlands', ['Alleghany County', 'Rockbridge County', 'Buena Vista City', 'Covington City', 'Lexington City']],
  ['Northern Neck & Middle Peninsula', ['Essex County', 'Gloucester County', 'King and Queen County', 'King William County', 'Lancaster County', 'Mathews County', 'Middlesex County', 'Northumberland County', 'Richmond County', 'Westmoreland County']],
  ['Culpeper & northern Piedmont', ['Culpeper County', 'Rappahannock County', 'Madison County', 'Orange County']],
];
const countyMetro = new Map(METRO_GROUPS.flatMap(([metro, counties]) => counties.map(county => [county.toLowerCase(), metro])));
const countyNames = new Map(METRO_GROUPS.flatMap(([, counties]) => counties.map(county => [county.toLowerCase(), county])));
export const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Normalize spelling only: RT, SR, VA and US remain distinct route systems.
// Source typos and bare numbers are preserved rather than assigned a new route.
export function normalizeRoad(value) {
  let road = String(value || 'Other roads').trim().replace(/\s+/g, ' ');
  road = road.replace(/(^|[\s/&(])(US|VA|RT|SR|I)\s*\.?\s*-?\s*(\d+)\b/gi,
    (_, before, prefix, number) => `${before}${prefix.toUpperCase()}-${number}`);
  if (/^(US|VA|RT|SR|I)-\d+\b/.test(road)) {
    road = road.replace(/\b(BUS|ALT|BYP)\b/gi, suffix => suffix.toUpperCase());
  }
  return road.replace(/\.$/, '');
}
export function prepareCameras(cameras, overrides = {}) {
  const seen = new Set();
  return cameras.filter(camera => {
    const id = String(camera.id ?? '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map(camera => {
    // Never infer a locality from 511 jurisdiction: e.g. "Salem" is a large service region.
    const countyLabel = String(overrides[camera.id]?.county || camera.county || '').trim();
    const county = countyNames.get(countyLabel.toLowerCase()) || '';
    const metro = countyMetro.get(county.toLowerCase()) || 'Border & unlocated cameras';
    const sourceRoad = String(camera.sourceRoad || camera.road || 'Other roads');
    const result = {...camera, id:String(camera.id), county, metro, sourceRoad, road:normalizeRoad(sourceRoad)};
    result.searchText = normalize([result.name, result.description, result.id, result.siteId, result.road, result.sourceRoad, result.county, result.metro, result.region, result.jurisdiction].join(' '));
    return result;
  }).sort((a,b) => Number(a.disabled || a.imageStatus==='unavailable') - Number(b.disabled || b.imageStatus==='unavailable') || a.road.localeCompare(b.road, undefined, {numeric:true}) || String(a.name).localeCompare(String(b.name), undefined, {numeric:true}));
}
export function filterCameras(cameras, filters, favorites = new Set(), bounds = null, exclude = '') {
  const words = normalize(filters.query).split(' ').filter(Boolean);
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
export function getFacet(cameras, key, filters, favorites = new Set(), bounds = null) {
  const counts = new Map();
  const facetFilters = {...filters};
  if (key === 'metro') {facetFilters.county='';facetFilters.road='';}
  if (key === 'county') facetFilters.road='';
  filterCameras(cameras, facetFilters, favorites, bounds, key).forEach(camera => {
    if (camera[key]) counts.set(camera[key], (counts.get(camera[key]) || 0) + 1);
  });
  return [...counts].sort((a,b) => a[0].localeCompare(b[0],undefined,{numeric:true}));
}
