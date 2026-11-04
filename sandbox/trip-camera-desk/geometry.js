// Distances use WGS84-style coordinates and metres. Camera-to-road matching is
// deliberately conservative: location proximity is never a verified road view.
const EARTH = 6371008.8;
const RAD = Math.PI / 180;
const CELL = 0.15;
const prepared = new WeakMap();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function validPosition(point) {
  return point && typeof point.lat === 'number' && typeof point.lon === 'number'
    && Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
}

export function haversine(a, b) {
  const p1 = a[1] * RAD, p2 = b[1] * RAD;
  const dLat = p2 - p1, dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

export function bearing(a, b) {
  const p1 = a[1] * RAD, p2 = b[1] * RAD, d = (b[0] - a[0]) * RAD;
  return (Math.atan2(Math.sin(d) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(d)) / RAD + 360) % 360;
}

export function normalizeRouteRef(value) {
  const text = String(value || '').toUpperCase().trim().replace(/[‐‑–—]/g, '-');
  const m = text.match(/^(?:INTERSTATE|I)[ -]*(\d+[A-Z]?)$/);
  if (m) return `I-${m[1]}`;
  const us = text.match(/^(?:US|U\.S\.|US ROUTE|U\.S\. ROUTE)[ -]*(\d+[A-Z]?)$/);
  if (us) return `US-${us[1]}`;
  return text.replace(/\b(?:STATE ROUTE|STATE ROAD|SR|SH)[ -]*(\d+[A-Z]?)/g, 'SR-$1').replace(/\s+/g, ' ');
}

export function extractRouteRefs(values) {
  const result = new Set();
  for (const raw of Array.isArray(values) ? values : [values]) {
    const text = String(raw || '').toUpperCase().replace(/[‐‑–—]/g, '-').replace(/FARM[ -]+TO[ -]+MARKET(?: ROAD)?/g,'FM').replace(/RANCH[ -]+TO[ -]+MARKET(?: ROAD)?/g,'RM').replace(/BELTWAY/g,'BW').replace(/\bLOOP\b/g,'LP').replace(/\bSPUR\b/g,'SP');
    for (const m of text.matchAll(/\b(INTERSTATE|I|U\.?S\.?|US ROUTE|STATE ROUTE|STATE ROAD|SR|SH|FM|RM|BW|LP|SP|WV|OH|PA|VA|TX|MD|AZ|DC|NY|CA)[ -]*(\d+[A-Z]?)(?!\d)/g)) result.add(normalizeRouteRef(`${m[1]}-${m[2]}`));
    for (const m of text.matchAll(/\b(WEST VIRGINIA|OHIO|PENNSYLVANIA|VIRGINIA|TEXAS|MARYLAND|ARIZONA|DISTRICT OF COLUMBIA|NEW YORK|CALIFORNIA)[ -]*(?:(?:STATE )?(?:ROUTE|HIGHWAY)[ -]*)?(\d+[A-Z]?)(?!\d)/g))result.add(`${{'WEST VIRGINIA':'WV',OHIO:'OH',PENNSYLVANIA:'PA',VIRGINIA:'VA',TEXAS:'TX',MARYLAND:'MD',ARIZONA:'AZ','DISTRICT OF COLUMBIA':'DC','NEW YORK':'NY',CALIFORNIA:'CA'}[m[1]]}-${m[2]}`);
  }
  return [...result];
}

function gridKey(x, y) { return `${x}:${y}`; }

export function prepareRoute(route) {
  if (!route || !Array.isArray(route.coordinates) || route.coordinates.length < 2) throw new Error('A route needs at least two coordinates.');
  if (prepared.has(route)) return route;
  const points = route.coordinates;
  if (points.some(p => !Array.isArray(p) || !validPosition({lon:p[0], lat:p[1]}))) throw new Error('The route has an invalid coordinate.');
  const cumulative = [0], segments = [], grid = new Map();
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  points.forEach(p => {west = Math.min(west,p[0]); east = Math.max(east,p[0]); south = Math.min(south,p[1]); north = Math.max(north,p[1]);});
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i+1], length = haversine(a,b);
    cumulative.push(cumulative[i] + length);
    const segment = {i,a,b,length,bearing:bearing(a,b)};
    segments.push(segment);
    const x0 = Math.floor(Math.min(a[0],b[0])/CELL), x1 = Math.floor(Math.max(a[0],b[0])/CELL);
    const y0 = Math.floor(Math.min(a[1],b[1])/CELL), y1 = Math.floor(Math.max(a[1],b[1])/CELL);
    // Normal routing shapes have short edges. Very sparse imported geometry is
    // queried separately instead of filling millions of empty grid cells.
    if ((x1-x0+1)*(y1-y0+1) > 2000) {segment.sparse = true; continue;}
    for (let x=x0;x<=x1;x++) for (let y=y0;y<=y1;y++) {
      const key=gridKey(x,y); if (!grid.has(key)) grid.set(key,[]); grid.get(key).push(i);
    }
  }
  const shapeLength = cumulative.at(-1);
  if (!(shapeLength > 0)) throw new Error('The route has zero length.');
  if (!(Number(route.distanceMeters)>0)) route.distanceMeters = shapeLength;
  route.durationSeconds = Math.max(0,Number(route.durationSeconds)||0);
  route.bounds = {west,south,east,north};
  const metadata = new Array(segments.length);
  let elapsed = 0;
  for (const s of route.segments || []) {
    const start = clamp(Math.floor(s.startIndex||0),0,points.length-1), end = clamp(Math.floor(s.endIndex||start),start,points.length-1);
    const duration = Math.max(0,Number(s.durationSeconds)||0);
    const item={...s,startIndex:start,endIndex:end,startSeconds:elapsed,durationSeconds:duration,roadNames:s.roadNames||[],routeRefs:s.routeRefs||extractRouteRefs(s.roadNames||[])};
    for (let i=start;i<end;i++) metadata[i]=item;
    elapsed += duration;
  }
  prepared.set(route,{points,cumulative,segments,grid,metadata,shapeLength,scale:route.distanceMeters/shapeLength,sparse:segments.filter(s=>s.sparse).map(s=>s.i),timeScale:elapsed>0?route.durationSeconds/elapsed:1});
  return route;
}

function routeData(route) { prepareRoute(route); return prepared.get(route); }

function candidates(data,point,radius) {
  const latDelta=radius/110500, lonDelta=radius/(111320*Math.max(0.08,Math.cos(point.lat*RAD)));
  const x0=Math.floor((point.lon-lonDelta)/CELL), x1=Math.floor((point.lon+lonDelta)/CELL);
  const y0=Math.floor((point.lat-latDelta)/CELL), y1=Math.floor((point.lat+latDelta)/CELL);
  const result=new Set(data.sparse);
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const index of data.grid.get(gridKey(x,y))||[])result.add(index);
  return result;
}

function projectSegment(point,s) {
  const cos=Math.max(0.0001,Math.cos((s.a[1]+s.b[1]+point.lat)/3*RAD));
  const bx=(s.b[0]-s.a[0])*RAD*EARTH*cos, by=(s.b[1]-s.a[1])*RAD*EARTH;
  const px=(point.lon-s.a[0])*RAD*EARTH*cos, py=(point.lat-s.a[1])*RAD*EARTH;
  const t=(bx*bx+by*by)>0?clamp((px*bx+py*by)/(bx*bx+by*by),0,1):0;
  const coordinate=[s.a[0]+(s.b[0]-s.a[0])*t,s.a[1]+(s.b[1]-s.a[1])*t];
  return {t,coordinate,offsetMeters:haversine([point.lon,point.lat],coordinate)};
}

function timeAtShapeDistance(route,data,shapeDistance,index) {
  const m=data.metadata[index];
  if (m) {
    const from=data.cumulative[m.startIndex], to=data.cumulative[m.endIndex];
    const fraction=to>from?clamp((shapeDistance-from)/(to-from),0,1):0;
    return (m.startSeconds+m.durationSeconds*fraction)*data.timeScale;
  }
  return route.durationSeconds*clamp(shapeDistance/data.shapeLength,0,1);
}

export function projectPointOnRoute(route,point,options={}) {
  if (!validPosition(point)) return null;
  const data=routeData(route), maxDistance=Number(options.maxDistanceMeters);
  const indices=Number.isFinite(maxDistance)?candidates(data,point,Math.max(1,maxDistance)):data.segments.map(s=>s.i);
  let best=null;
  for(const index of indices) {
    const s=data.segments[index], projection=projectSegment(point,s);
    const shapeDistance=data.cumulative[index]+s.length*projection.t;
    if(!best||projection.offsetMeters<best.offsetMeters-0.01||(Math.abs(projection.offsetMeters-best.offsetMeters)<0.01&&shapeDistance<best.shapeDistance))best={...projection,index,shapeDistance,bearing:s.bearing};
  }
  if(!best || (Number.isFinite(maxDistance)&&best.offsetMeters>maxDistance))return null;
  const m=data.metadata[best.index];
  return {...best,alongMeters:best.shapeDistance*data.scale,distanceMeters:best.shapeDistance*data.scale,etaSeconds:timeAtShapeDistance(route,data,best.shapeDistance,best.index),roadNames:m?.roadNames||[],routeRefs:m?.routeRefs||[]};
}

export function pointAtDistance(route,meters) {
  const data=routeData(route), target=clamp(Number(meters)||0,0,route.distanceMeters)/data.scale;
  let low=0,high=data.cumulative.length-1;
  while(low<high){const middle=Math.floor((low+high)/2);if(data.cumulative[middle]<target)low=middle+1;else high=middle;}
  const i=clamp(low-1,0,data.segments.length-1),s=data.segments[i];
  const t=s.length?clamp((target-data.cumulative[i])/s.length,0,1):0;
  return {lon:s.a[0]+(s.b[0]-s.a[0])*t,lat:s.a[1]+(s.b[1]-s.a[1])*t,timeSeconds:timeAtShapeDistance(route,data,target,i)};
}

function plainRoad(value) {
  return String(value||'').toLowerCase().replace(/\b(north|south|east|west|northbound|southbound|eastbound|westbound|nb|sb|eb|wb)\b/g,'').replace(/\b(street|st)\b/g,'st').replace(/\b(avenue|ave)\b/g,'ave').replace(/\b(road|rd)\b/g,'rd').replace(/\b(boulevard|blvd)\b/g,'blvd').replace(/[^a-z0-9]/g,'');
}

function refsForMatching(refs,state) {
  const normalized=new Set((refs||[]).map(normalizeRouteRef));
  // Valhalla usually spells a state route with the state's abbreviation. SR
  // metadata can only be expanded within this camera's own state.
  for(const value of [...normalized])if(/^SR-\d/.test(value)&&state)normalized.add(value.replace('SR-',`${state}-`));
  return normalized;
}

function directionBearing(camera) {
  if(typeof camera.directionBearing==='number'&&Number.isFinite(camera.directionBearing))return camera.directionBearing;
  const key=String(camera.direction||'').trim().toUpperCase().replace(/BOUND$/,'').trim();
  return {N:0,NORTH:0,NE:45,NORTHEAST:45,E:90,EAST:90,SE:135,SOUTHEAST:135,S:180,SOUTH:180,SW:225,SOUTHWEST:225,W:270,WEST:270,NW:315,NORTHWEST:315,NB:0,EB:90,SB:180,WB:270}[key]??null;
}

export function matchRouteCameras(cameras,route,{corridorMeters=1609.344,direction=''}={}) {
  const data=routeData(route),radius=clamp(Number(corridorMeters)||1609.344,25,50000);
  const matches=[];
  for(const camera of cameras) {
    if(!validPosition(camera))continue;
    const latDelta=radius/110500,lonDelta=radius/(111320*Math.max(0.08,Math.cos(camera.lat*RAD)));
    if(camera.lon<route.bounds.west-lonDelta||camera.lon>route.bounds.east+lonDelta||camera.lat<route.bounds.south-latDelta||camera.lat>route.bounds.north+latDelta)continue;
    const projection=projectPointOnRoute(route,camera,{maxDistanceMeters:radius});
    if(!projection)continue;
    const cameraRefs=refsForMatching(camera.primaryRouteRefs??(camera.routeRefs?.length?camera.routeRefs:extractRouteRefs(camera.road)),camera.state);
    const routeRefs=refsForMatching(projection.routeRefs,camera.state);
    const referenceMatch=[...cameraRefs].some(ref=>routeRefs.has(ref));
    const sourceRoad=plainRoad(camera.road);
    const nameMatch=sourceRoad.length>=5&&projection.roadNames.some(name=>plainRoad(name)===sourceRoad);
    const roadMatch=referenceMatch||nameMatch;
    const publishedBearing=directionBearing(camera);
    const angle=publishedBearing===null?null:Math.abs(((publishedBearing-projection.bearing+540)%360)-180);
    let routeMatch='uncertain',routeMatchLabel='Near route · road and direction unverified';
    if(roadMatch){routeMatch='road';routeMatchLabel=angle===null?'Road metadata match · direction unverified':angle<=65?'Road and direction metadata match':angle>=115?'Road metadata match · opposite travel direction':'Road metadata match · direction differs';}
    else if(cameraRefs.size&&routeRefs.size){routeMatch='nearby';routeMatchLabel='Nearby crossing or parallel road · not confirmed on route';}
    if(direction==='same'&&roadMatch&&angle!==null&&angle>=115)continue;
    matches.push({...camera,routeDistanceMeters:projection.alongMeters,routeTimeSeconds:projection.etaSeconds,routeOffsetMeters:projection.offsetMeters,routeMatch,routeMatchLabel,routeBearing:projection.bearing,routeDirectionAngle:angle,routeCoordinate:projection.coordinate,alongMeters:projection.alongMeters,offsetMeters:projection.offsetMeters,etaSeconds:projection.etaSeconds,matchType:routeMatch,matchLabel:routeMatchLabel});
  }
  return matches.sort((a,b)=>a.routeDistanceMeters-b.routeDistanceMeters||a.routeOffsetMeters-b.routeOffsetMeters||String(a.id).localeCompare(String(b.id)));
}

export function coverageGaps(route,matches,{radiusMeters=8046.72,minGapMeters=8046.72}={}) {
  prepareRoute(route);
  const radius=Math.max(0,Number(radiusMeters)||0), min=Math.max(0,Number(minGapMeters)||0),total=route.distanceMeters;
  const positions=matches.map(c=>Number(c.routeDistanceMeters??c.alongMeters)).filter(Number.isFinite).map(v=>clamp(v,0,total)).sort((a,b)=>a-b);
  const gaps=[];let coveredUntil=0;
  for(const position of positions){const start=Math.max(0,position-radius),end=Math.min(total,position+radius);if(start-coveredUntil>=min)gaps.push({startMeters:coveredUntil,endMeters:start,lengthMeters:start-coveredUntil});coveredUntil=Math.max(coveredUntil,end);}
  if(total-coveredUntil>=min)gaps.push({startMeters:coveredUntil,endMeters:total,lengthMeters:total-coveredUntil});
  return gaps;
}

export function representativeCameras(matches,{intervalMeters=16093.44,route=null}={}) {
  if(!matches.length)return [];
  const interval=Math.max(500,Number(intervalMeters)||16093.44),groups=new Map();
  const score=(camera,target)=>(camera.disabled||camera.availability==='unavailable'||camera.imageStatus==='unavailable'?5:0)+(camera.mediaType==='official'?1:0)+(camera.routeMatch==='road'?0:1)+Math.abs(camera.routeDistanceMeters-target)/interval;
  for(const camera of matches){const bin=Math.floor(camera.routeDistanceMeters/interval),target=(bin+.5)*interval,old=groups.get(bin);if(!old||score(camera,target)<score(old,target))groups.set(bin,camera);}
  const selected=new Map([...groups.values()].map(c=>[c.id,c]));
  for(const junction of route?.junctions||[]){const distance=Number(junction.distanceMeters);if(!Number.isFinite(distance))continue;const nearby=matches.filter(c=>Math.abs(c.routeDistanceMeters-distance)<=Math.min(interval/3,3218.688));if(nearby.length){const best=nearby.reduce((a,b)=>score(a,distance)<=score(b,distance)?a:b);selected.set(best.id,best);}}
  return [...selected.values()].sort((a,b)=>a.routeDistanceMeters-b.routeDistanceMeters);
}

export const matchCameras=(route,cameras,options)=>matchRouteCameras(cameras,route,options);
