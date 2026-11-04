export const normalize = value => String(value ?? '').toLowerCase().replace(/\b(ore?|us|i)\s*[-.]?\s*(\d+[a-z]?)\b/g,(_,prefix,number)=>(prefix==='ore'?'or':prefix)+' '+number).replace(/[^a-z0-9]+/g,' ').trim();
const roadRank = value => /^I[- ]\d/i.test(value) ? 0 : /^US[- ]\d/i.test(value) ? 1 : /^OR[- ]\d/i.test(value) ? 2 : 3;
export function prepareCameras(cameras) {
 const seen=new Set();
 return cameras.filter(c=>{const id=String(c.id??'');if(!id||seen.has(id))return false;seen.add(id);return true;}).map(c=>{
  const county=String(c.county||'').replace(/\s+county$/i,'').replace(/^unknown$/i,'').trim();
  const roads=[...new Set([c.road,...(c.roads||[])].filter(Boolean).map(String))];
  const result={...c,id:String(c.id),county,metro:c.metro||c.region||'Other Oregon',road:roads[0]||'Local roads',roads,direction:c.direction||'',embedMode:c.embedMode||'official'};
  result.searchText=normalize([result.name,(result.aliases||[]).join(' '),result.id,result.siteId,roads.join(' '),county,result.metro,result.region,result.provider,result.physicalState,result.direction].join(' '));return result;
 }).sort((a,b)=>roadRank(a.road)-roadRank(b.road)||a.road.localeCompare(b.road,undefined,{numeric:true})||a.name.localeCompare(b.name,undefined,{numeric:true}));
}
export function filterCameras(cameras,filters,favorites=new Set(),bounds=null,exclude=''){
 const words=normalize(filters.query).split(' ').filter(Boolean);
 return cameras.filter(c=>{
  for(const key of ['metro','county','direction'])if(exclude!==key&&filters[key]&&c[key]!==filters[key])return false;
  if(exclude!=='region'&&filters.region&&!(c.regions||[c.region]).includes(filters.region))return false;
  if(exclude!=='road'&&filters.road&&!c.roads.includes(filters.road))return false;
  if(filters.mediaType&&c.embedMode!==filters.mediaType)return false;
  if(filters.delivery==='available'&&c.imageStatus!=='available')return false;
  if(filters.delivery==='unavailable'&&!['unavailable','disabled','stale'].includes(c.imageStatus))return false;
  if(filters.favorites&&!favorites.has(c.id))return false;
  if(words.some(w=>!c.searchText.includes(w)))return false;
  if(filters.withinMap&&bounds&&!(Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&c.lat>=bounds.south&&c.lat<=bounds.north&&c.lon>=bounds.west&&c.lon<=bounds.east))return false;
  return true;
 });
}
export function getFacet(cameras,key,filters={},favorites,bounds){
 const f={...filters};if(key==='metro'){f.county='';f.road='';}if(key==='county')f.road='';
 const counts=new Map();for(const c of filterCameras(cameras,f,favorites,bounds,key))for(const v of new Set((key==='road'?c.roads:key==='region'?(c.regions||[c.region]):[c[key]]).filter(Boolean)))counts.set(v,(counts.get(v)||0)+1);
 return [...counts].sort((a,b)=>(key==='road'?roadRank(a[0])-roadRank(b[0]):0)||a[0].localeCompare(b[0],undefined,{numeric:true}));
}
function validPoint(c){return Number.isFinite(c.lat)&&Number.isFinite(c.lon);}
// Prefer published milepoints. Geographic progression is an explicit fallback,
// never a routing assertion; duplicated views at a site stay adjacent.
export function orderCorridor(cameras,road,reverse=false){
 if(!road)return {cameras:[...cameras],basis:'Catalog order'};
 const oneState=new Set(cameras.map(c=>c.physicalState||'unknown')).size===1;
 const allHaveMiles=oneState&&cameras.length>0&&cameras.every(c=>normalize(c.road)===normalize(road)&&c.milepoint!==null&&c.milepoint!==''&&Number.isFinite(Number(c.milepoint)));
 const points=cameras.filter(validPoint);let axis='lat';
 if(points.length){const latRange=Math.max(...points.map(c=>c.lat))-Math.min(...points.map(c=>c.lat));const lonRange=Math.max(...points.map(c=>c.lon))-Math.min(...points.map(c=>c.lon));axis=lonRange>latRange?'lon':'lat';}
 const rows=[...cameras].sort((a,b)=>{
  const av=allHaveMiles?Number(a.milepoint):validPoint(a)?a[axis]:Infinity;
  const bv=allHaveMiles?Number(b.milepoint):validPoint(b)?b[axis]:Infinity;
  return (av-bv||String(a.siteId||a.id).localeCompare(String(b.siteId||b.id))||a.id.localeCompare(b.id,undefined,{numeric:true}))*(reverse?-1:1);
 });
 return {cameras:rows,basis:allHaveMiles?'Published milepoint order':`Approximate geographic order (${axis==='lat'?'south → north':'west → east'}); winding roads and crossing-road views may differ`};
}
export function sliceCorridor(rows,start,end){
 const ai=start?rows.findIndex(c=>c.id===start):-1,bi=end?rows.findIndex(c=>c.id===end):-1;
 if(ai<0&&bi<0)return rows;const a=ai<0?0:ai,b=bi<0?rows.length-1:bi;return rows.slice(Math.min(a,b),Math.max(a,b)+1);
}
