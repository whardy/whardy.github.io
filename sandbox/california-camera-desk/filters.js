export const normalize=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const FILTER_KEYS=['metro','district','county','road','direction','mediaType','availability','elevation'];
export const EMPTY_FILTERS={query:'',metro:'',district:'',county:'',road:'',direction:'',mediaType:'',availability:'',elevation:'',fromMile:'',toMile:'',withinMap:false};
export function validCoordinates(c){return typeof c.lat==='number'&&typeof c.lon==='number'&&Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&c.lat>=32&&c.lat<=43&&c.lon>=-125&&c.lon<=-113;}
export function prepareCameras(cameras){
  const seen=new Set();return cameras.filter(c=>c.id&&!seen.has(String(c.id))&&seen.add(String(c.id))).map(c=>{
    const imageUrl=c.imageUrl||c.snapshotUrl||null,videoUrl=c.videoUrl||null;
    const elevationFeet=Number.isFinite(Number(c.elevationFeet))&&c.elevationFeet!==null&&c.elevationFeet!==''?Number(c.elevationFeet):null;
    const raw=String(c.direction||'').trim(),direction=/^(north|n|nb|northbound)$/i.test(raw)?'Northbound':/^(south|s|sb|southbound)$/i.test(raw)?'Southbound':/^(east|e|eb|eastbound)$/i.test(raw)?'Eastbound':/^(west|w|wb|westbound)$/i.test(raw)?'Westbound':/^median$/i.test(raw)?'Median':'Unknown';
    const disabled=typeof c.disabled==='boolean'?c.disabled:((c.inService===false||String(c.inService).toLowerCase()==='false')&&![c.imageStatus,c.videoStatus].includes('available'));
    const mediaType=videoUrl?'Live video':imageUrl?'Refreshing snapshot':'Official viewer';
    const statuses=[c.videoStatus,c.imageStatus,c.availability,c.status];
    const availability=disabled?'Provider unavailable':!imageUrl&&!videoUrl?'Official viewer only':statuses.some(s=>['available','working','valid'].includes(s))?'Checked available':statuses.some(s=>['unavailable','disabled'].includes(s))?'Unavailable at check':statuses.some(s=>s==='stale')?'Older image at check':'Not checked';
    const district=c.district?`District ${Number(String(c.district).replace(/\D/g,''))||c.district}`:'Other provider';
    const result={...c,id:String(c.id),state:'CA',name:String(c.name||c.locationName||c.id),metro:c.metro||c.region||'Other California',county:String(c.county||'').replace(/ County$/i,''),road:c.road||c.route||'Local roads',direction,sourceDirection:raw,district,elevationFeet,imageUrl,videoUrl,disabled,mediaType,availability,elevation:elevationFeet===null?'Not reported':elevationFeet>=5000?'5,000+ ft':elevationFeet>=3000?'3,000–4,999 ft':elevationFeet>=1000?'1,000–2,999 ft':'Below 1,000 ft'};
    result.searchText=normalize([result.id,result.name,result.sourceRoad,result.road,result.metro,result.county,result.district,result.nearbyPlace,result.provider,result.imageDescription,...(result.aliases||[])].join(' '));
    return result;
  }).sort((a,b)=>Number(a.disabled)-Number(b.disabled)||Number(a.mediaType==='Official viewer')-Number(b.mediaType==='Official viewer')||a.road.localeCompare(b.road,undefined,{numeric:true})||Number(!Number.isFinite(a.milepost))-Number(!Number.isFinite(b.milepost))||((Number.isFinite(a.milepost)&&Number.isFinite(b.milepost))?a.milepost-b.milepost:0)||a.county.localeCompare(b.county)||a.name.localeCompare(b.name));
}
export function filterCameras(cameras,filters,bounds=null,exclude=''){
  const words=normalize(filters.query).split(' ').filter(Boolean);
  const output=cameras.filter(c=>{
    if(words.some(w=>!c.searchText.includes(w)))return false;
    for(const key of FILTER_KEYS)if(key!==exclude&&filters[key]&&c[key]!==filters[key])return false;
    if(filters.withinMap&&bounds&&(!validCoordinates(c)||c.lat<bounds.south||c.lat>bounds.north||c.lon<bounds.west||c.lon>bounds.east))return false;
    if(filters.fromMile!==''||filters.toMile!==''){
      if(!filters.road||!Number.isFinite(c.milepost))return false;
      if(filters.fromMile!==''&&c.milepost<Number(filters.fromMile))return false;
      if(filters.toMile!==''&&c.milepost>Number(filters.toMile))return false;
    }
    return true;
  });
  return filters.road?output.sort((a,b)=>Number(!Number.isFinite(a.milepost))-Number(!Number.isFinite(b.milepost))||((Number.isFinite(a.milepost)&&Number.isFinite(b.milepost))?a.milepost-b.milepost:0)||a.name.localeCompare(b.name)):output;
}
export function facet(cameras,filters,key,bounds){const values=new Map();for(const c of filterCameras(cameras,filters,bounds,key)){const value=c[key];if(value)values.set(value,(values.get(value)||0)+1);}return [...values].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));}
