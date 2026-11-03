import {prepareRoute, extractRouteRefs, haversine} from './geometry.js';

export const PROVIDERS = Object.freeze({
  routing:{id:'valhalla',name:'Valhalla / FOSSGIS',url:'https://valhalla1.openstreetmap.de/route',longDistanceUrl:'https://routing.openstreetmap.de/routed-car/route/v1/driving/',policy:'https://routing.openstreetmap.de/about.html',minimumIntervalMs:1200,trafficAware:false},
  geocoding:{id:'photon',name:'Photon / komoot',url:'https://photon.komoot.io/api/',policy:'https://github.com/komoot/photon#demo-server',minimumIntervalMs:1200},
  notice:'Free community services for light, manual use; no uptime guarantee. Place searches and routes are sent to their providers. Routing avoids are preferences, not guarantees. Estimates do not include live traffic.'
});

let configuration={routing:{...PROVIDERS.routing},geocoding:{...PROVIDERS.geocoding}};
const inflight={routing:Promise.resolve(),geocoding:Promise.resolve()};
const lastRequest={routing:0,geocoding:0};
const memoryCache=new Map();
const MAX_CACHE=60;
const CLIENT='whardy.github.io/sandbox/trip-camera-desk';
const routeError=status=>status===429?'The routing service is busy or its usage limit was reached. Wait and try again.':'The routing service could not calculate this trip. Try a shorter route or another map point.';

export function configureProviders(config={}) {
  for(const kind of ['routing','geocoding'])if(config[kind]){
    const update=config[kind];
    if(update.url){const url=new URL(update.url);if(url.protocol!=='https:')throw new Error('Provider endpoints require HTTPS.');}
    configuration[kind]={...configuration[kind],...update};
  }
  memoryCache.clear();
  return getProviderConfiguration();
}
export function getProviderConfiguration(){return JSON.parse(JSON.stringify(configuration));}

export async function loadProviderConfiguration(url='./providers.json') {
  const response=await fetch(url,{cache:'no-cache'});
  if(!response.ok)throw new Error('Provider configuration could not load.');
  return configureProviders(await response.json());
}

function abortError(){return new DOMException('Request cancelled.','AbortError');}
function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){reject(abortError());return;}let timer;const cancel=()=>{clearTimeout(timer);reject(abortError());};timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);signal?.addEventListener('abort',cancel,{once:true});});}
function cacheRead(key,ttl){const row=memoryCache.get(key);if(row&&Date.now()-row.at<ttl)return row.value;return null;}
function cacheWrite(key,value){memoryCache.delete(key);memoryCache.set(key,{at:Date.now(),value});while(memoryCache.size>MAX_CACHE)memoryCache.delete(memoryCache.keys().next().value);const routes=[...memoryCache].filter(([,entry])=>entry.value.routes);while(routes.length>4)memoryCache.delete(routes.shift()[0]);}

async function requestJSON(kind,url,{signal,headers={}}={}) {
  const previous=inflight[kind];
  let release;inflight[kind]=new Promise(resolve=>{release=resolve;});
  try{
    await previous;
    const delay=Math.max(0,Number(configuration[kind].minimumIntervalMs||1200)-(Date.now()-lastRequest[kind]));
    if(delay)await wait(delay,signal);
    if(signal?.aborted)throw abortError();
    lastRequest[kind]=Date.now();
    const controller=new AbortController();
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch(url,{headers,signal:controller.signal,referrerPolicy:'strict-origin-when-cross-origin'});
      if(!response.ok){
        let details={};try{details=await response.json();}catch{/* HTML error pages do not carry provider details. */}
        const error=new Error(kind==='routing'?routeError(response.status):response.status===429?'Place search is temporarily rate limited. Wait and try again.':'Place search is unavailable. Choose a location on the map instead.');
        error.providerCode=details.error_code||details.code;error.providerMessage=details.error||details.message||'';throw error;
      }
      return await response.json();
    }catch(error){if(error.name==='AbortError'&&!signal?.aborted)throw new Error(`${kind==='routing'?'Routing':'Place search'} timed out. Please try again later.`);throw error;}
    finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }finally{release();}
}

export async function searchPlaces(query,{signal,center,limit=5}={}) {
  const q=String(query||'').trim();
  if(q.length<3)throw new Error('Enter at least three characters, then select Search.');
  if(q.length>300)throw new Error('Use a shorter place or address search.');
  const url=new URL(configuration.geocoding.url);
  url.searchParams.set('q',q);url.searchParams.set('limit',String(Math.min(6,Math.max(1,limit))));url.searchParams.set('lang','en');
  if(center&&Number.isFinite(center.lat)&&Number.isFinite(center.lon)){url.searchParams.set('lat',String(center.lat));url.searchParams.set('lon',String(center.lon));}
  const key=url.href,cached=cacheRead(key,3600000);if(cached)return structuredClone(cached);
  const data=await requestJSON('geocoding',url.href,{signal});
  const places=(data.features||[]).filter(f=>Array.isArray(f.geometry?.coordinates)).map(f=>{
    const p=f.properties||{},[lon,lat]=f.geometry.coordinates;
    const first=p.name||[p.housenumber,p.street].filter(Boolean).join(' ')||p.city||p.county||'Map location';
    const parts=[first,p.city,p.state,p.country].filter(Boolean);
    return {label:[...new Set(parts)].join(', '),name:first,lat:Number(lat),lon:Number(lon)};
  }).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  cacheWrite(key,places);return structuredClone(places);
}

export function decodePolyline(encoded,precision=6) {
  const points=[],factor=10**precision;let index=0,lat=0,lon=0;
  while(index<encoded.length){
    const values=[];
    for(let dimension=0;dimension<2;dimension++){
      let result=0,shift=0,byte;
      do{if(index>=encoded.length||shift>35)throw new Error('Invalid route geometry.');byte=encoded.charCodeAt(index++)-63;if(byte<0||byte>63)throw new Error('Invalid route geometry.');result+=(byte&31)*2**shift;shift+=5;}while(byte>=32);
      values.push(result%2?-(Math.floor(result/2)+1):Math.floor(result/2));
    }
    lat+=values[0];lon+=values[1];points.push([lon/factor,lat/factor]);
  }
  return points;
}

export function normalizeValhallaTrip(trip,index=0,options={}) {
  if(!trip?.legs?.length)throw new Error('Routing returned no usable driving route.');
  const coordinates=[],segments=[],junctions=[];let legMeters=0;
  for(const leg of trip.legs){
    const shape=decodePolyline(leg.shape,6);if(shape.length<2)continue;
    const joins=coordinates.length>0&&haversine(coordinates.at(-1),shape[0])<1;
    const offset=coordinates.length-(joins?1:0);
    coordinates.push(...(joins?shape.slice(1):shape));
    let maneuverMeters=0;
    for(const m of leg.maneuvers||[]){
      const roadNames=[...(m.street_names||[]),...(m.begin_street_names||[])];
      segments.push({startIndex:offset+Number(m.begin_shape_index||0),endIndex:offset+Number(m.end_shape_index||0),roadNames,routeRefs:extractRouteRefs(roadNames),durationSeconds:Number(m.time)||0,instruction:m.instruction||'',type:m.type});
      if([20,21,22,23,24,25].includes(m.type))junctions.push({distanceMeters:legMeters+maneuverMeters,name:m.instruction||'Highway junction'});
      maneuverMeters+=(Number(m.length)||0)*1000;
    }
    legMeters+=(Number(leg.summary?.length)||0)*1000;
  }
  const summary=trip.summary||{};
  const warnings=[];
  if(options.avoidTolls&&summary.has_toll)warnings.push('This route still contains toll roads despite the avoid preference.');
  if(options.avoidHighways&&summary.has_highway)warnings.push('This route still contains highways despite the avoid preference.');
  return prepareRoute({id:`valhalla-${index}`,name:index===0?'Recommended route':`Alternative ${index}`,coordinates,distanceMeters:(Number(summary.length)||0)*1000,durationSeconds:Number(summary.time)||0,segments,junctions,trafficAware:false,provider:configuration.routing.name,hasTolls:Boolean(summary.has_toll),hasHighways:Boolean(summary.has_highway),warnings,calculatedAt:new Date().toISOString()});
}

export function normalizeOSRMRoute(raw,index=0) {
  const coordinates=[],segments=[],junctions=[];let traveled=0;
  for(const leg of raw.legs||[])for(const step of leg.steps||[]){
    const shape=step.geometry?.coordinates||[];if(!shape.length)continue;
    const joins=coordinates.length>0&&haversine(coordinates.at(-1),shape[0])<1;
    const startIndex=coordinates.length-(joins?1:0);
    coordinates.push(...(joins?shape.slice(1):shape));
    const roadNames=[step.name,step.ref].filter(Boolean);
    segments.push({startIndex,endIndex:coordinates.length-1,roadNames,routeRefs:extractRouteRefs(roadNames),durationSeconds:Number(step.duration)||0,instruction:step.maneuver?.type||'',type:step.maneuver?.type});
    if(['on ramp','off ramp','fork','merge'].includes(step.maneuver?.type))junctions.push({distanceMeters:traveled,name:step.name||'Highway junction'});
    traveled+=Number(step.distance)||0;
  }
  if(coordinates.length<2)coordinates.push(...(raw.geometry?.coordinates||[]));
  return prepareRoute({id:`osrm-${index}`,name:index===0?'Recommended route':`Alternative ${index}`,coordinates,distanceMeters:Number(raw.distance)||0,durationSeconds:Number(raw.duration)||0,segments,junctions,trafficAware:false,provider:'OSRM / FOSSGIS',hasTolls:null,hasHighways:null,warnings:[],calculatedAt:new Date().toISOString()});
}

async function calculateLongDistance(points,{alternatives,signal,reason}) {
  const endpoint=configuration.routing.longDistanceUrl;
  if(!endpoint)throw new Error('This trip exceeds the routing service’s distance limit. Choose a shorter trip.');
  const url=new URL(endpoint.replace(/\/?$/,'/')+points.map(p=>`${p.lon},${p.lat}`).join(';'));
  url.searchParams.set('overview','full');url.searchParams.set('geometries','geojson');url.searchParams.set('steps','true');url.searchParams.set('alternatives',alternatives?'2':'false');
  const data=await requestJSON('routing',url.href,{signal});
  if(data.code!=='Ok'||!data.routes?.length)throw new Error(data.message||'No long-distance driving route was found.');
  const routes=data.routes.map(normalizeOSRMRoute);
  const warnings=[reason||'OSRM was used for this long-distance trip. Its route estimates do not include live traffic.'];
  if(alternatives&&routes.length===1)warnings.push('The routing service did not return a suitable alternative for this trip.');
  return {routes,provider:'OSRM / FOSSGIS',warnings,trafficAware:false};
}

export async function calculateRoutes(points,{avoidTolls=false,avoidHighways=false,alternatives=true,signal}={}) {
  if(!Array.isArray(points)||points.length<2||points.length>8)throw new Error('Choose a start, destination, and up to six stops.');
  if(points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180))throw new Error('Choose each trip location from search results or the map.');
  const locations=points.map(p=>({lat:p.lat,lon:p.lon,type:'break'}));
  const payload={locations,costing:'auto',units:'kilometers',language:'en-US',alternates:alternatives&&points.length===2?2:0,costing_options:{auto:{use_tolls:avoidTolls?0:0.5,use_highways:avoidHighways?0:0.5}},shape_format:'polyline6'};
  const url=new URL(configuration.routing.url);url.searchParams.set('json',JSON.stringify(payload));
  const key=url.href,cached=cacheRead(key,15*60000);if(cached)return structuredClone(cached);
  const straightDistance=points.slice(1).reduce((sum,p,i)=>sum+haversine([points[i].lon,points[i].lat],[p.lon,p.lat]),0);
  const longAvoidError=()=>new Error('This trip exceeds Valhalla’s 1,500 km limit. Avoid-toll and avoid-highway preferences are unavailable on the long-distance fallback. Choose a shorter trip or turn off those preferences.');
  if(straightDistance>1450000){
    if(avoidTolls||avoidHighways)throw longAvoidError();
    const result=await calculateLongDistance(points,{alternatives,signal});cacheWrite(key,result);return result;
  }
  let data;
  try{data=await requestJSON('routing',url.href,{signal,headers:{'X-Client-Id':CLIENT}});}
  catch(error){
    if(Number(error.providerCode)!==154)throw error;
    if(avoidTolls||avoidHighways)throw longAvoidError();
    const result=await calculateLongDistance(points,{alternatives,signal,reason:'Valhalla’s 1,500 km route limit was reached. OSRM was used for this trip; its estimates do not include live traffic.'});cacheWrite(key,result);return result;
  }
  if(data.error)throw new Error(String(data.error));
  const trips=[data.trip,...(data.alternates||[]).map(row=>row.trip)].filter(Boolean);
  const routes=trips.map((trip,index)=>normalizeValhallaTrip(trip,index,{avoidTolls,avoidHighways}));
  const warnings=[];
  if(points.length>2&&alternatives)warnings.push('This routing service supports alternatives only for trips without intermediate stops.');
  if(routes.length===1&&alternatives&&points.length===2)warnings.push('The routing service did not return a suitable alternative for this trip.');
  if(!routes.length)throw new Error('No driving route was found between these locations.');
  const result={routes,provider:configuration.routing.name,warnings,trafficAware:false};
  cacheWrite(key,result);return result;
}

export const geocode=searchPlaces;
export async function routeTrip(points,options){return (await calculateRoutes(points,options)).routes;}
