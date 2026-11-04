const loaded=new Map(),pending=new Map();
export async function getIndex(){const response=await fetch('./data/index.json',{cache:'no-cache'});if(!response.ok)throw new Error('Camera index could not load.');return response.json();}
export async function loadStates(index,codes){
  const entries=index.states.filter(s=>codes.includes(s.state));
  await Promise.all(entries.map(async entry=>{
    if(loaded.has(entry.state))return;
    if(!pending.has(entry.state))pending.set(entry.state,(async()=>{
      const response=await fetch('./'+entry.file);if(!response.ok)throw new Error(`${entry.stateName} catalog could not load.`);
      const data=await response.json();
      if(!Array.isArray(data.cameras))throw new Error('Invalid camera catalog.');
      loaded.set(entry.state,data.cameras.map(camera=>({...camera,searchText:[camera.id,camera.sourceId,camera.name,camera.road,camera.sourceRoad,camera.state,camera.stateName,camera.metro,camera.jurisdiction,camera.district,camera.nearbyPlace,camera.description,camera.facingDirection,...(camera.routeRefs||[])].join(' ').toLowerCase()})));
    })().finally(()=>pending.delete(entry.state)));
    await pending.get(entry.state);
  }));
  return allCameras();
}
export function allCameras(){return [...loaded.values()].flat();}
export function loadedStates(){return [...loaded.keys()];}
export function statesAlongRoute(index,route,corridorMeters=1609){
  const coords=route.coordinates,latPad=corridorMeters/111000+0.02;
  const bounds=coords.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
  const lonPad=latPad/Math.max(0.2,Math.cos(bounds[3]*Math.PI/180));
  const west=bounds[0]-lonPad,east=bounds[2]+lonPad,south=bounds[1]-latPad,north=bounds[3]+latPad;
  return index.states.filter(s=>s.bounds&&s.bounds[0]<=east&&s.bounds[2]>=west&&s.bounds[1]<=north&&s.bounds[3]>=south).map(s=>s.state);
}
export function filterCameras(cameras,filters,exclude=''){
  const words=String(filters.query||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return cameras.filter(c=>{
    if(exclude!=='query'&&words.some(w=>!c.searchText.includes(w)))return false;
    for(const key of ['state','metro','jurisdiction','road'])if(exclude!==key&&filters[key]&&c[key]!==filters[key])return false;
    if(exclude!=='media'&&filters.media&&c.mediaType!==filters.media)return false;
    if(exclude!=='status'&&filters.status&&c.availability!==filters.status)return false;
    return true;
  });
}
export function facet(cameras,filters,key){
  const counts=new Map();for(const camera of filterCameras(cameras,filters,key)){const value=camera[key];if(value)counts.set(value,(counts.get(value)||0)+1);}
  return [...counts].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));
}
