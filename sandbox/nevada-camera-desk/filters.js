export const FILTER_KEYS = ['metro','county','city','road','direction','providerSource','mediaType','availability'];
export const EMPTY_FILTERS = {query:'',metro:'',county:'',city:'',road:'',direction:'',providerSource:'',mediaType:'',availability:'',withinMap:false};
const clean = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export function validCoordinates(c) {
  return Number.isFinite(c.lat) && Number.isFinite(c.lon) &&
    c.lat >= 34.5 && c.lat <= 42.2 && c.lon >= -120.2 && c.lon <= -113.5;
}

export function prepareCameras(cameras) {
  const ids = new Set();
  return cameras.filter(c => c?.id && !ids.has(c.id) && ids.add(c.id)).map(c => {
    const videoUrl = c.videoUrl || null, imageUrl = c.imageUrl || null;
    const mediaType = videoUrl ? 'Live video' : imageUrl ? 'Refreshing snapshot' : 'Official viewer';
    const availability = c.disabled ? 'Provider unavailable' : c.videoStatus === 'available' || c.imageStatus === 'available' ? 'Checked available' : c.videoStatus === 'unavailable' && c.imageStatus === 'unavailable' ? 'Unavailable at check' : 'Not checked';
    return {...c, state:'NV', mediaType, availability,
      searchText:clean([c.id,c.viewId,c.parentId,c.sourceId,c.name,c.description,c.sourceRoad,c.road,c.metro,c.county,c.city,c.providerSource,...(c.aliases||[])].join(' '))};
  }).sort((a,b)=>Number(a.disabled)-Number(b.disabled)||a.road.localeCompare(b.road,undefined,{numeric:true})||a.name.localeCompare(b.name));
}

export function filterCameras(cameras, filters, bounds=null, except='') {
  const words = clean(filters.query).split(' ').filter(Boolean);
  return cameras.filter(c => {
    if(words.some(w=>!c.searchText.includes(w)))return false;
    for(const key of FILTER_KEYS)if(key!==except&&filters[key]&&c[key]!==filters[key])return false;
    if(filters.withinMap&&bounds&&(!validCoordinates(c)||c.lat<bounds.south||c.lat>bounds.north||c.lon<bounds.west||c.lon>bounds.east))return false;
    return true;
  });
}

export function facet(cameras, filters, key, bounds=null) {
  const counts=new Map();
  for(const c of filterCameras(cameras,filters,bounds,key))if(c[key])counts.set(c[key],(counts.get(c[key])||0)+1);
  return [...counts].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));
}
