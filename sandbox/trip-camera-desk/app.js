import {getIndex,loadStates,allCameras,loadedStates,statesAlongRoute,statesForCameraIds,filterCameras,facet} from './catalog.js?v=20261104or2';
import {searchPlaces,calculateRoutes,PROVIDERS} from './routing.js';
import {prepareRoute,matchRouteCameras,coverageGaps,representativeCameras,pointAtDistance} from './geometry.js?v=20261104or2';
import {loadLibrary,saveLibrary,cleanTrip,cleanBoard,cleanPoint,mergeLibrary,encodeShare,decodeShare,newId} from './store.js';
import {createCameraMap} from './map.js?v=20261104ordraft1';
import {createMediaManager} from './media.js?v=20261104or2';

const $=id=>document.getElementById(id), nf=new Intl.NumberFormat('en-US');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const miles=meters=>`${nf.format(Math.round(meters/1609.344))} mi`;
const duration=seconds=>{const min=Math.round(seconds/60);return min>=60?`${Math.floor(min/60)}h ${min%60}m`:`${min} min`;};
const date=value=>value?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'not checked';
const emptyFilters=()=>({query:'',state:'',metro:'',jurisdiction:'',road:'',media:'',status:''});
const model={index:null,mode:'plan',library:loadLibrary(),points:[{key:'from',name:'Columbus, Ohio',lat:39.9623,lon:-82.9991},{key:'to',name:'Washington, DC',lat:38.9072,lon:-77.0369}],routes:[],route:null,routeWarnings:[],matches:[],gaps:[],filters:emptyFilters(),page:1,corridorMeters:1609.344,lookahead:0,highway:'',direction:'',selected:null,liveSlots:[],busy:false,dirty:false};
let cameraMap=null, routeAbort=null, searchAbort=new Map(), modalReturn=null, modalPlayer=null, filtersTimer;
const readAutoplay=state=>{try{return localStorage.getItem(`trip-camera-desk-${state.toLowerCase()}-autoplay`)!=='off';}catch{return true;}};
const readWVAutoplay=()=>readAutoplay('WV');
const media=createMediaManager({autoplayWV:readWVAutoplay(),autoplayCA:readAutoplay('CA'),onMessage:announce,onChange:count=>{$('live-count').textContent=`${count} active`;}});
function setWVAutoplay(value){$('wv-autoplay').checked=!!value;media.setWVAutoplay(value);try{localStorage.setItem('trip-camera-desk-wv-autoplay',value?'on':'off');}catch{/* Playback works without browser storage. */}}
function setCAAutoplay(value){$('ca-autoplay').checked=!!value;media.setCAAutoplay(value);try{localStorage.setItem('trip-camera-desk-ca-autoplay',value?'on':'off');}catch{/* Playback works without browser storage. */}}
function announce(message){$('app-status').textContent=message;}
function persist(){if(!saveLibrary(model.library))announce('Changes are available for this visit. Browser storage is full or unavailable; use Export to keep a copy.');}
const board=()=>model.library.boards.find(b=>b.id===model.library.activeBoardId)||model.library.boards[0];
const cameraById=id=>allCameras().find(c=>c.id===id||(c.catalogAliases||[]).includes(id));
const boardIndex=id=>{const camera=cameraById(id);return board().cameraIds.findIndex(value=>value===id||camera&&(value===camera.id||(camera.catalogAliases||[]).includes(value)));};
function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:'#';}catch{return '#';}}
function currentTrip(){return cleanTrip({name:$('saved-trip-name')?.value||`${model.points[0].name} → ${model.points.at(-1).name}`,points:model.points,avoidTolls:$('avoid-tolls').checked,avoidHighways:$('avoid-highways').checked,corridorMeters:model.corridorMeters});}

function inputFor(key){return key==='from'?$('from-input'):key==='to'?$('to-input'):$(`input-${key}`);}
function resultsFor(key){return key==='from'?$('from-results'):key==='to'?$('to-results'):$(`results-${key}`);}
function dirtyRoute(){model.dirty=!!model.route;if(model.route)$('routing-status').textContent='Trip inputs changed. Find my route to update the map and cameras.';}
function bindPoint(key){
  const input=inputFor(key);input.addEventListener('input',()=>{const point=model.points.find(p=>p.key===key);point.name=input.value;point.lat=point.lon=null;cameraMap?.setPoints(model.points);dirtyRoute();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();findPlace(key);}if(event.key==='Escape')resultsFor(key).replaceChildren();});
  const search=key==='from'?$('from-search'):key==='to'?$('to-search'):$(`search-${key}`);search.addEventListener('click',()=>findPlace(key));
  const pick=key==='from'?$('from-map'):key==='to'?$('to-map'):$(`map-${key}`);pick.addEventListener('click',()=>pickPoint(key));
}
function renderStops(){
  const list=$('stops-list');list.replaceChildren();
  model.points.slice(1,-1).forEach((point,index)=>{
    const row=document.createElement('div');row.className='place-field stop-field';
    row.innerHTML=`<div class="field-label-row"><label for="input-${point.key}">Stop ${index+1}</label><span><button class="map-pick" id="map-${point.key}" type="button">Pick on map</button><button class="text-button" data-remove-stop="${point.key}" type="button" aria-label="Remove stop ${index+1}">Remove</button></span></div><div class="place-input-row"><input id="input-${point.key}" value="${esc(point.name)}" placeholder="City, address or coordinates" autocomplete="off"><button class="small-button" id="search-${point.key}" type="button" aria-label="Search stop ${index+1}">Search</button></div><div class="place-results" id="results-${point.key}"></div>`;
    list.append(row);bindPoint(point.key);row.querySelector('[data-remove-stop]').addEventListener('click',()=>{model.points=model.points.filter(p=>p.key!==point.key);renderStops();dirtyRoute();cameraMap?.setPoints(model.points);});
  });
  $('add-stop').disabled=model.points.length>=8;
}
function syncPoints(){inputFor('from').value=model.points[0].name;inputFor('to').value=model.points.at(-1).name;renderStops();cameraMap?.setPoints(model.points);}
function choosePoint(key,point){
  const target=model.points.find(p=>p.key===key);if(!target)return;
  Object.assign(target,point,{name:point.name||point.label});inputFor(key).value=target.name;resultsFor(key)?.replaceChildren();
  $('map-select-hint').hidden=true;cameraMap?.cancelPick();cameraMap?.setPoints(model.points);dirtyRoute();
  $('routing-status').textContent=`${key==='from'?'Start':key==='to'?'Destination':'Stop'} selected: ${target.name}`;
}
function parseCoordinates(query){const m=query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);return m?cleanPoint({lat:m[1],lon:m[2],name:query.trim()}):null;}
async function findPlace(key){
  const query=inputFor(key).value.trim(),container=resultsFor(key);if(query.length<3){announce('Enter at least three characters or latitude, longitude.');return;}
  const coords=parseCoordinates(query);if(coords){choosePoint(key,coords);return;}
  searchAbort.get(key)?.abort();const controller=new AbortController();searchAbort.set(key,controller);
  container.textContent='Searching…';
  try{
    const results=await searchPlaces(query,{signal:controller.signal,limit:5});container.replaceChildren();
    if(!results.length){container.textContent='No places found. Try a nearby city or pick on the map.';return;}
    for(const place of results){const button=document.createElement('button');button.type='button';button.textContent=place.label||place.name;button.addEventListener('click',()=>choosePoint(key,{...place,name:place.label||place.name}));container.append(button);}
    $('routing-status').textContent=`Choose the correct ${key==='from'?'start':key==='to'?'destination':'stop'} from the search results.`;
  }catch(error){if(error.name!=='AbortError'){container.textContent='Place search is temporarily unavailable. Use latitude, longitude or Pick on map.';announce(error.message);}}
}
function pickPoint(key){setMode('plan');cameraMap?.pick(key);$('map-select-hint').hidden=false;$('map-select-hint').textContent=`Select the ${key==='from'?'start':key==='to'?'destination':'stop'} on the map. Escape cancels.`;$('map').focus();}
function resolveTypedCoordinates(){for(const point of model.points)if(!cleanPoint(point)){const coords=parseCoordinates(inputFor(point.key).value);if(coords)Object.assign(point,coords);}cameraMap?.setPoints(model.points);}
async function planTrip(event){
  event?.preventDefault();if(model.busy)return;
  resolveTypedCoordinates();
  const missing=model.points.find(p=>!cleanPoint(p));if(missing){announce('Choose a search result or map location for each stop before finding a route.');await findPlace(missing.key);inputFor(missing.key).focus();return;}
  routeAbort?.abort();routeAbort=new AbortController();model.busy=true;$('calculate-route').disabled=true;$('routing-status').textContent='Calculating a real driving route…';
  announce('Finding routes and cameras along your journey…');
  try{
    const result=await calculateRoutes(model.points,{avoidTolls:$('avoid-tolls').checked,avoidHighways:$('avoid-highways').checked,alternatives:true,signal:routeAbort.signal});
    model.routes=result.routes.map(prepareRoute);model.routeWarnings=result.warnings||[];model.dirty=false;model.page=1;model.highway='';model.direction='';$('highway-select').value='';$('travel-direction').value='';
    if(!model.routes.length)throw new Error('The routing service found no drivable route.');
    await activateRoute(model.routes[0].id,true);
    setMode('plan');announce(`${model.matches.length.toLocaleString()} camera views found near your route. Choose Route wall to view them in travel order.`);
  }catch(error){if(error.name!=='AbortError'){$('routing-status').textContent=error.message||'Routing is temporarily unavailable. Try again later.';announce('Route calculation failed. Existing saved boards and Explore remain available.');}}
  finally{model.busy=false;$('calculate-route').disabled=false;}
}
async function activateRoute(id,fit=false){
  const route=model.routes.find(r=>r.id===id);if(!route)return;model.route=route;model.lookahead=0;model.page=1;
  $('routing-status').textContent=`${route.provider||'Public routing'} · ordinary driving estimate, no live traffic. ${[...model.routeWarnings,...(route.warnings||[])].join(' ')}`;
  await loadStates(model.index,statesAlongRoute(model.index,route,model.corridorMeters));updateHighways();recomputeRoute();render();if(fit)cameraMap.fitRoute();
}
function recomputeRoute(){
  if(!model.route){model.matches=[];model.gaps=[];return;}
  const codes=new Set(statesAlongRoute(model.index,model.route,model.corridorMeters));
  model.matches=matchRouteCameras(allCameras().filter(c=>codes.has(c.state)),model.route,{corridorMeters:model.corridorMeters});
  model.gaps=coverageGaps(model.route,model.matches,{radiusMeters:1609.344,minGapMeters:3218.688});
}
function updateHighways(){
  const value=$('highway-select').value,refs=new Set();
  for(const camera of allCameras())for(const ref of camera.routeRefs||[])refs.add(ref);
  $('highway-select').innerHTML='<option value="">Choose a highway</option>'+[...refs].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(ref=>`<option>${esc(ref)}</option>`).join('');
  $('highway-select').value=value;
}
function renderRoute(){
  const r=model.route;$('route-distance').textContent=r?miles(r.distanceMeters):'—';$('route-duration').textContent=r?duration(r.durationSeconds):'—';
  $('route-camera-count').textContent=r?nf.format(model.matches.length):'—';
  $('route-coverage').textContent=r?`${model.gaps.length} gaps over 2 mi`:'Plan a trip to begin';
  $('route-coverage').title='Gaps have no listed camera within one mile along the route. This does not describe what a camera can actually see.';
  $('coverage-details').hidden=!r;
  $('coverage-summary').textContent=r?`${model.gaps.length} route stretches without nearby listed cameras`:'';
  const gapList=$('coverage-gaps');gapList.replaceChildren();
  for(const gap of model.gaps){const item=document.createElement('li');const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=`${miles(gap.startMeters)}–${miles(gap.endMeters)} from start · ${miles(gap.lengthMeters)} gap`;button.addEventListener('click',()=>{model.lookahead=(gap.startMeters+gap.endMeters)/2/r.distanceMeters;renderLookahead();setMode('plan');});item.append(button);gapList.append(item);}
  const alternatives=$('route-alternatives');alternatives.replaceChildren();
  for(const [i,route]of model.routes.entries()){
    const button=document.createElement('button');button.type='button';button.className='route-choice'+(route.id===r?.id?' is-active':'');button.setAttribute('aria-pressed',String(route.id===r?.id));
    button.innerHTML=`<strong>${i===0?'Main route':`Alternative ${i}`}</strong><span>${miles(route.distanceMeters)} · ${duration(route.durationSeconds)}</span>`;
    button.addEventListener('click',()=>activateRoute(route.id,true).catch(error=>announce(error.message)));alternatives.append(button);
  }
  cameraMap?.setRoutes(model.routes,r,model.points,model.gaps);
  $('lookahead-panel').hidden=!r||!['plan','wall'].includes(model.mode);
  renderLookahead();
}
function renderLookahead(){
  if(!model.route)return;
  const distance=model.lookahead*model.route.distanceMeters;
  $('lookahead-range').value=String(Math.round(model.lookahead*1000));
  const point=pointAtDistance(model.route,distance);
  $('lookahead-label').textContent=`${miles(distance)} from start${Number.isFinite(point.timeSeconds)?' · '+duration(point.timeSeconds):''}`;
  cameraMap?.setCursor(distance);
  const near=[...model.matches].sort((a,b)=>Math.abs(a.routeDistanceMeters-distance)-Math.abs(b.routeDistanceMeters-distance)).slice(0,5);
  $('lookahead-count').textContent=near.length?'Nearest listed camera views along the journey':'No camera views near this route';
  const container=$('lookahead-cameras');container.replaceChildren();
  for(const camera of near){const button=document.createElement('button');button.type='button';button.className='lookahead-camera';button.textContent=`${camera.state} · ${camera.name} · ${miles(camera.routeDistanceMeters)}`;button.addEventListener('click',()=>openCamera(camera.id));container.append(button);}
}
function clearRoute(){
  routeAbort?.abort();model.route=null;model.routes=[];model.matches=[];model.gaps=[];model.highway='';model.direction='';model.dirty=false;model.page=1;
  $('routing-status').textContent='Trip cleared. Choose locations and Find my route.';render();cameraMap?.fit();
}
function baseCameras(){
  if(model.mode==='board')return board().cameraIds.map(id=>cameraById(id)).filter(Boolean);
  if(model.mode==='explore')return allCameras();
  if(!model.route)return [];
  let cameras=model.matches;
  if(model.highway)cameras=cameras.filter(c=>(c.routeRefs||[]).includes(model.highway));
  if(model.direction)cameras=cameras.filter(c=>!c.direction||c.direction===model.direction||c.direction.startsWith(model.direction));
  if($('sample-cameras').checked)cameras=representativeCameras(cameras,{intervalMeters:Number($('sample-spacing').value)*1609.344,route:model.route});
  return cameras;
}
function renderFilters(base){
  for(const [key,label]of [['state','All states + DC'],['metro','All cities / areas'],['jurisdiction','All jurisdictions'],['road','All roads']]){
    const select=$(key);let choices;
    if(key==='state')choices=model.mode==='explore'?model.index.states.map(s=>[s.state,s.views,s.stateName]):facet(base,model.filters,key).map(([code,count])=>[code,count,model.index.states.find(s=>s.state===code)?.stateName||code]);
    else choices=facet(base,model.filters,key);
    select.innerHTML=`<option value="">${label}</option>`+choices.map(([value,count,name])=>`<option value="${esc(value)}">${esc(name||value)} (${nf.format(count)})</option>`).join('');
    if(model.filters[key]&&!choices.some(([value])=>value===model.filters[key]))select.add(new Option(`${model.filters[key]} (0)`,model.filters[key]));
    select.value=model.filters[key];
  }
  $('query').value=model.filters.query;$('media').value=model.filters.media;$('status').value=model.filters.status;
  const chips=$('active-filters');chips.replaceChildren();
  for(const [key,value]of Object.entries(model.filters))if(value){const button=document.createElement('button');button.type='button';button.className='filter-chip';button.textContent=`${key}: ${value} ×`;button.setAttribute('aria-label',`Remove ${key} filter`);button.addEventListener('click',()=>{model.filters[key]='';model.page=1;renderResults();updateURL();});chips.append(button);}
  if(model.highway){const button=document.createElement('button');button.type='button';button.className='filter-chip';button.textContent=`Highway: ${model.highway} ${model.direction||''} ×`;button.addEventListener('click',()=>{model.highway='';model.direction='';$('highway-select').value='';$('travel-direction').value='';renderResults();});chips.append(button);}
}
function cardMarkup(camera,index){
  if(model.mode==='board')index=boardIndex(camera.id);
  const pinned=boardIndex(camera.id)>=0,hasVideo=!!camera.videoUrl&&!camera.disabled;
  const label=camera.disabled?'Unavailable':camera.mediaType==='video'?'Live video':camera.mediaType==='official'?'Official viewer':'Refreshing snapshot';
  const caMetadata=camera.state==='CA'?[camera.district?`Caltrans ${camera.district}`:'',Number.isFinite(camera.elevationFeet)?`${nf.format(camera.elevationFeet)} ft`:'',camera.direction?`${camera.direction} travel side`:'Travel direction unreported',camera.facingDirection?`Looking ${camera.facingDirection}`:''].filter(Boolean).join(' · '):'';
  const routeLabel=Number.isFinite(camera.routeDistanceMeters)?`${miles(camera.routeDistanceMeters)} from start · ~${duration(camera.routeTimeSeconds||0)} · ${camera.routeMatchLabel||'Nearby, road uncertain'}`:'';
  const describe=value=>value==='available'?'checked available':value==='unavailable'?'unavailable at check':value==='stale'?'older image at check':'not checked';
  const check=camera.disabled?'Disabled in source catalog':camera.videoUrl?`Video ${describe(camera.videoStatus)}${camera.imageUrl?' · Snapshot '+describe(camera.imageStatus):''}`:camera.imageUrl?`Snapshot ${describe(camera.imageStatus)}`:'Official viewer only';
  return `<div class="card-top"><span class="state-tag">${esc(camera.state)}</span><span class="media-badge ${camera.mediaType}">${label}</span><button class="pin-camera" type="button" data-action="pin" aria-pressed="${pinned}" aria-label="${pinned?'Unpin':'Pin'} ${esc(camera.name)}">${pinned?'★':'☆'}</button></div><button class="card-media" type="button" data-action="open" aria-label="Open ${esc(camera.name)}"></button><div class="card-content"><button class="card-title" type="button" data-action="open">${esc(camera.name)}</button><p class="card-meta">${esc([camera.jurisdiction,camera.metro,camera.physicalState&&camera.physicalState!==camera.state?`Located in ${camera.physicalState}`:''].filter(Boolean).join(' · ')||camera.stateName)}</p>${caMetadata?`<p class="card-meta">${esc(caMetadata)}</p>`:''}${routeLabel?`<p class="route-label">${esc(routeLabel)}</p>`:''}<p class="availability-badge" title="Checked ${esc(date(camera.auditCheckedAt||camera.videoCheckedAt))}">${esc(check)} · ${esc(date(camera.auditCheckedAt||camera.videoCheckedAt))}</p><div class="card-actions">${hasVideo?'<button class="small-button" type="button" data-action="play">Watch live</button>':''}<a class="text-button" href="${esc(safeLink(camera.officialUrl))}" target="_blank" rel="noopener noreferrer">Official ↗</a><button class="text-button" type="button" data-action="locate" ${camera.lat==null?'disabled':''}>Map</button></div>${model.mode==='board'?`<div class="board-order"><button class="text-button" type="button" data-action="up" aria-label="Move ${esc(camera.name)} earlier" ${index===0?'disabled':''}>↑ Earlier</button><button class="text-button" type="button" data-action="down" aria-label="Move ${esc(camera.name)} later" ${index===board().cameraIds.length-1?'disabled':''}>↓ Later</button><button class="text-button danger-link" type="button" data-action="remove">Remove</button></div>`:''}</div>`;
}
function renderResults(){
  if(!model.index)return;
  const base=baseCameras();renderFilters(base);let matches=filterCameras(base,model.filters);
  if(model.mode==='explore')matches.sort((a,b)=>Number(a.availability!=='available')-Number(b.availability!=='available')||a.state.localeCompare(b.state)||a.road.localeCompare(b.road,undefined,{numeric:true})||a.name.localeCompare(b.name,undefined,{numeric:true}));
  const totalPages=Math.max(1,Math.ceil(matches.length/25));model.page=Math.max(1,Math.min(totalPages,model.page));
  $('result-count').textContent=nf.format(matches.length);$('result-detail').textContent=model.mode==='board'?'pinned camera views':model.mode==='explore'?'camera views':'camera views along your route';
  $('results-eyebrow').textContent=model.mode==='board'?board().name:model.mode==='explore'?'EXPLORE THE CAMERA NETWORK':'CAMERAS FOR YOUR JOURNEY';
  $('empty-state').hidden=matches.length>0;$('empty-state').querySelector('p').textContent=model.mode==='board'?'Pin cameras from Plan or Explore to build this watchboard.':!model.route&&model.mode!=='explore'?'Enter your trip and select Find my route, or choose Explore to browse cameras.':'Try another filter, a wider route corridor, or a different route.';
  const start=(model.page-1)*25;$('pagination-summary').textContent=matches.length?`${nf.format(start+1)}–${nf.format(Math.min(start+25,matches.length))} of ${nf.format(matches.length)} · 25 per page`:'No matching camera views';
  $('page-label').textContent=`${model.page} / ${totalPages}`;$('previous-page').disabled=model.page===1;$('next-page').disabled=model.page===totalPages;
  const grid=$('camera-grid');media.dispose(grid);grid.replaceChildren();
  for(const [i,camera]of matches.slice(start,start+25).entries()){
    const card=document.createElement('article');card.className='camera-card';card.dataset.cameraId=camera.id;card.innerHTML=cardMarkup(camera,start+i);let previewPlayer=null;
    const playback=()=>card.querySelector('[data-action="play"]');
    media.snapshot(card.querySelector('.card-media'),camera,{onPlay:player=>{previewPlayer=player;if(playback())playback().textContent='Stop video';},onEnd:()=>{previewPlayer=null;if(playback())playback().textContent='Watch live';}});
    card.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
      if(action==='open')openCamera(camera.id);else if(action==='pin'||action==='remove')togglePin(camera.id);else if(action==='play'){if(previewPlayer){previewPlayer.stop();previewPlayer=null;media.snapshot(card.querySelector('.card-media'),camera,{autoplay:false});if(playback())playback().textContent='Watch live';}else addLive(camera.id);}else if(action==='locate'){setMode('plan');cameraMap.focus(camera);}else if(action==='up'||action==='down')moveCamera(camera.id,action==='up'?-1:1);
    });grid.append(card);
  }
  if(model.mode==='plan'||model.mode==='explore')cameraMap?.update(matches.length?matches:(!model.route&&model.mode==='plan'?allCameras():[]),model.selected?.id);
}
function render(){
  document.body.className=`mode-${model.mode}`;
  for(const mode of ['plan','wall','board','explore']){$(`mode-${mode}`).setAttribute('aria-pressed',String(mode===model.mode));$(`mode-${mode}`).classList.toggle('is-active',mode===model.mode);}
  $('board-panel').hidden=model.mode!=='board';$('map-section').hidden=!['plan','explore'].includes(model.mode);$('live-tray').hidden=model.mode!=='board';
  $('map-title').textContent=model.mode==='explore'?'Explore the camera network':'The road ahead';$('fit-route').textContent=model.mode==='explore'?'Fit cameras ⌖':'Fit route ⌖';
  renderRoute();renderLibrary();renderResults();requestAnimationFrame(()=>cameraMap?.resize());updateURL();
}
async function setMode(mode){
  if(!['plan','wall','board','explore'].includes(mode))return;
  if(model.mode===mode){if(mode==='board'){await ensureBoardCameras();renderLibrary();renderResults();if(!model.liveSlots.length)renderLiveSlots();}return;}
  if(model.mode!==mode){media.stopAll('Stopped after changing view');model.liveSlots.forEach(slot=>slot.player=null);}
  model.mode=mode;model.page=1;
  if(mode==='explore'){
    announce('Loading camera catalogs for Explore…');
    try{await loadStates(model.index,model.filters.state?[model.filters.state]:model.index.states.map(s=>s.state));announce(`${nf.format(allCameras().length)} listed camera views loaded. Availability checks are dated.`);}catch(error){announce(error.message);}
  }
  if(mode==='board')await ensureBoardCameras();updateHighways();render();if(mode==='board')renderLiveSlots();if(mode==='explore')cameraMap.fit();
}
function renderLibrary(){
  $('saved-trip-select').innerHTML='<option value="">Choose a saved trip</option>'+model.library.trips.map(trip=>`<option value="${esc(trip.id)}">${esc(trip.name)}</option>`).join('');
  $('board-select').innerHTML=model.library.boards.map(b=>`<option value="${esc(b.id)}">${esc(b.name)} (${b.cameraIds.length})</option>`).join('');$('board-select').value=board().id;
  $('board-name').value=board().name;$('board-note').textContent=`${board().cameraIds.length} pinned views. Saved in this browser; export a copy to move between devices.`;
}
async function ensureBoardCameras(){const codes=statesForCameraIds(model.index,board().cameraIds);await loadStates(model.index,codes);const seen=new Set(),ids=board().cameraIds;board().cameraIds=ids.filter(id=>{const canonical=cameraById(id)?.id||id;if(seen.has(canonical))return false;seen.add(canonical);return true;});if(ids.length!==board().cameraIds.length)persist();}
function togglePin(id){
  const b=board(),index=boardIndex(id);if(index>=0)b.cameraIds.splice(index,1);else {if(b.cameraIds.length>=500){announce('This board is full. Create another watchboard.');return;}b.cameraIds.push(id);}
  persist();renderLibrary();renderResults();updateDialogPin();announce(index>=0?'Camera removed from watchboard.':`Camera pinned to ${b.name}.`);
}
function moveCamera(id,offset){const ids=board().cameraIds,index=boardIndex(id),target=index+offset;if(index<0||target<0||target>=ids.length)return;[ids[index],ids[target]]=[ids[target],ids[index]];persist();renderResults();[...document.querySelectorAll('.camera-card')].find(c=>c.dataset.cameraId===id)?.querySelector(`[data-action="${offset<0?'up':'down'}"]`)?.focus();}
function updateDialogPin(){if(!model.selected)return;const pinned=boardIndex(model.selected.id)>=0;$('dialog-pin').textContent=pinned?'★ Pinned to watchboard':'☆ Pin to watchboard';$('dialog-pin').setAttribute('aria-pressed',String(pinned));}
function openCamera(id){
  const camera=cameraById(id);if(!camera)return;
  if(!$('camera-dialog').open)modalReturn=document.activeElement;
  modalPlayer?.stop();modalPlayer=null;model.selected=camera;
  $('dialog-title').textContent=camera.name;$('dialog-subtitle').textContent=[camera.stateName,camera.road,camera.jurisdiction].filter(Boolean).join(' · ');
  $('dialog-status').textContent=`${camera.provider}. ${camera.description||''} Availability checked ${date(camera.auditCheckedAt||camera.videoCheckedAt)}. Fetched time is retrieval time.${camera.state==='CA'?` Image capture time ${camera.sourceCaptureTime?date(camera.sourceCaptureTime):'unknown'}. Caltrans record timestamps describe catalog metadata.`:''}${camera.state==='OR'?' Camera courtesy of ODOT and TripCheck partner agencies. Viewing direction does not establish traffic direction.':''}`;
  $('dialog-source').href=safeLink(camera.officialUrl);$('dialog-play').hidden=!camera.videoUrl;$('dialog-play').disabled=!!camera.disabled;$('dialog-play').textContent='Watch live';
  media.setAutoplayScope($('dialog-media'));
  media.snapshot($('dialog-media'),camera,{onPlay:player=>{modalPlayer=player;$('dialog-play').textContent='Stop video';},onEnd:message=>{modalPlayer=null;$('dialog-play').textContent='Watch live';$('dialog-status').textContent=message;}});updateDialogPin();if(!$('camera-dialog').open)$('camera-dialog').showModal();cameraMap?.update(baseCameras(),camera.id);updateURL();
}
function closeCamera(){const id=model.selected?.id;modalPlayer?.stop();modalPlayer=null;media.dispose($('dialog-media'));model.selected=null;$('camera-dialog').close();media.setAutoplayScope(null);if(modalReturn?.isConnected)modalReturn.focus();else ([...document.querySelectorAll('.camera-card')].find(card=>card.dataset.cameraId===id)?.querySelector('.card-title')||$(`mode-${model.mode}`)).focus();updateURL();}
function renderLiveSlots(){
  const container=$('live-slots');media.dispose(container);container.replaceChildren();
  if(!model.liveSlots.length){container.innerHTML='<p class="live-empty">Choose Watch live on a supported camera to add it here. Your pinned camera cards appear below.</p>';return;}
  for(const slot of model.liveSlots){
    const camera=cameraById(slot.id);if(!camera)continue;slot.player=null;
    const article=document.createElement('article');article.className='live-slot';article.dataset.cameraId=camera.id;
    article.innerHTML=`<div class="card-top"><span class="state-tag">${esc(camera.state)}</span><strong>${esc(camera.name)}</strong><button class="text-button" data-live="remove" type="button" aria-label="Remove ${esc(camera.name)} from video slots">✕</button></div><div class="live-slot-media"></div><p class="small-note live-slot-status">Choose Watch live to connect.</p><div class="live-slot-actions"><button class="small-button" type="button" data-live="play">Watch live</button><button class="text-button" type="button" data-live="pin">${board().cameraIds.includes(camera.id)?'Pinned':'Pin camera'}</button><a class="text-button" href="${esc(safeLink(camera.officialUrl))}" target="_blank" rel="noopener noreferrer">Official ↗</a></div>`;
    container.append(article);media.snapshot(article.querySelector('.live-slot-media'),camera,{onPlay:player=>{slot.player=player;slot.wanted=true;article.querySelector('[data-live="play"]').textContent='Stop video';},onEnd:message=>{slot.player=null;if(!message.includes('offscreen'))slot.wanted=false;article.querySelector('[data-live="play"]').textContent='Watch live';article.querySelector('.live-slot-status').textContent=message;},onStatus:message=>article.querySelector('.live-slot-status').textContent=message});
    article.addEventListener('click',event=>{const action=event.target.closest('[data-live]')?.dataset.live;if(action==='remove'){slot.player?.stop();media.dispose(article);model.liveSlots=model.liveSlots.filter(s=>s!==slot);article.remove();}else if(action==='pin'){if(!board().cameraIds.includes(camera.id))togglePin(camera.id);event.target.textContent='Pinned';}else if(action==='play')playSlot(slot,article);});
  }
}
function playSlot(slot,article){
  const container=article.querySelector('.live-slot-media'),button=article.querySelector('[data-live="play"]'),status=article.querySelector('.live-slot-status');
  if(slot.player){slot.wanted=false;slot.player.stop();slot.player=null;media.snapshot(container,cameraById(slot.id),{autoplay:false});button.textContent='Watch live';return;}
  slot.wanted=true;
  slot.player=media.play(container,cameraById(slot.id),{onStatus:message=>status.textContent=message,onEnd:message=>{slot.player=null;if(!message.includes('offscreen'))slot.wanted=false;button.textContent='Watch live';status.textContent=message;}});
  if(slot.player)button.textContent='Stop video';
}
async function addLive(id){
  const camera=cameraById(id);if(!camera?.videoUrl){announce('This camera provides a snapshot or official viewer.');return;}
  if(model.liveSlots.some(slot=>slot.id===id)){await setMode('board');$('live-tray').scrollIntoView({block:'start'});const slot=model.liveSlots.find(s=>s.id===id);if(!slot.player){const article=[...$('live-slots').children].find(el=>el.dataset.cameraId===id);playSlot(slot,article);}return;}
  if(model.liveSlots.length>=media.limit){announce(`All ${media.limit} video slots are filled. Remove a slot or increase Video slots on the Watchboard.`);await setMode('board');return;}
  // Preserve existing players when adding a slot: setMode only stops video if the mode changes.
  if(model.mode!=='board')await setMode('board');
  const runningIds=model.liveSlots.filter(slot=>slot.player||slot.wanted).map(slot=>slot.id);
  model.liveSlots.push({id,player:null});renderLiveSlots();$('live-tray').scrollIntoView({block:'start'});
  for(const slot of model.liveSlots)if(runningIds.includes(slot.id)||slot.id===id){const article=[...$('live-slots').children].find(el=>el.dataset.cameraId===slot.id);playSlot(slot,article);}
}
function updateURL(){
  const params=new URLSearchParams();if(model.mode!=='plan')params.set('view',model.mode);for(const [key,value]of Object.entries(model.filters))if(value)params.set(key,value);if(model.selected)params.set('camera',model.selected.id);
  history.replaceState(null,'',`${location.pathname}${params.size?'?'+params:''}${location.hash.startsWith('#share=')?location.hash:''}`);
}
function showShare(payload){
  try{const url=new URL(location.href);url.search='';url.hash='share='+encodeShare(payload);$('share-url').value=url.href;$('share-dialog').showModal();$('share-url').focus();$('share-url').select();}
  catch(error){announce(error.message);}
}
async function consumeShare(){
  if(!location.hash.startsWith('#share='))return;
  try{
    const value=decodeShare(location.hash.slice(7));
    if(value.type==='trip'){const trip=cleanTrip(value.trip);if(!trip)throw new Error('Invalid shared trip.');loadTrip(trip);announce('Shared trip loaded. Select Find my route to calculate current directions.');}
    else if(value.type==='board'){const b=cleanBoard(value.board);if(!b)throw new Error('Invalid shared board.');if(model.library.boards.length>=30)throw new Error('Your 30 watchboard slots are full. Export or remove one before adding a shared board.');b.id=newId();model.library.boards.push(b);model.library.activeBoardId=b.id;persist();await setMode('board');announce('Shared watchboard added to this browser.');}
    else throw new Error('Unrecognized share link.');
  }catch(error){announce(`The share link could not load: ${error.message}`);}
  history.replaceState(null,'',location.pathname+location.search);
}
function loadTrip(trip){
  const valid=cleanTrip(trip);if(!valid){announce('This saved trip has invalid locations. Choose a start and destination to continue.');return false;}trip=valid;
  model.points=trip.points.map((p,index)=>({...p,key:index===0?'from':index===trip.points.length-1?'to':`stop-${newId()}`}));
  $('avoid-tolls').checked=trip.avoidTolls;$('avoid-highways').checked=trip.avoidHighways;model.corridorMeters=trip.corridorMeters||1609.344;
  const width=String(model.corridorMeters/1609.344);if(![...$('corridor-width').options].some(option=>option.value===width))$('corridor-width').add(new Option(`${Number(width).toFixed(2)} miles`,width));$('corridor-width').value=width;
  if($('saved-trip-name'))$('saved-trip-name').value=trip.name;syncPoints();dirtyRoute();setMode('plan');
}
function bindEvents(){
  for(const mode of ['plan','wall','board','explore'])$(`mode-${mode}`).addEventListener('click',()=>setMode(mode).catch(error=>announce(error.message)));
  bindPoint('from');bindPoint('to');$('trip-form').addEventListener('submit',planTrip);
  $('add-stop').addEventListener('click',()=>{if(model.points.length>=8)return;model.points.splice(-1,0,{key:`stop-${newId()}`,name:'',lat:null,lon:null});renderStops();dirtyRoute();inputFor(model.points.at(-2).key).focus();});
  $('avoid-tolls').addEventListener('change',dirtyRoute);$('avoid-highways').addEventListener('change',dirtyRoute);$('clear-route').addEventListener('click',clearRoute);$('fit-route').addEventListener('click',()=>model.mode==='explore'?cameraMap.fit():cameraMap.fitRoute());
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){cameraMap?.cancelPick();$('map-select-hint').hidden=true;}});
  $('lookahead-range').addEventListener('input',()=>{model.lookahead=Number($('lookahead-range').value)/1000;renderLookahead();});
  for(const id of ['sample-cameras','sample-spacing'])$(id).addEventListener('change',()=>{model.page=1;renderResults();});
  $('corridor-width').addEventListener('change',async()=>{model.corridorMeters=Number($('corridor-width').value)*1609.344;if(model.route){await loadStates(model.index,statesAlongRoute(model.index,model.route,model.corridorMeters));recomputeRoute();}model.page=1;render();});
  $('query').addEventListener('input',()=>{clearTimeout(filtersTimer);filtersTimer=setTimeout(()=>{model.filters.query=$('query').value;model.page=1;renderResults();updateURL();},180);});
  for(const key of ['state','metro','jurisdiction','road','media','status'])$(key).addEventListener('change',async()=>{
    model.filters[key]=$(key).value;if(key==='state'){model.filters.metro='';model.filters.jurisdiction='';model.filters.road='';if(model.mode==='explore')try{await loadStates(model.index,model.filters.state?[model.filters.state]:model.index.states.map(s=>s.state));}catch(error){announce(error.message);}}
    model.page=1;updateHighways();renderResults();if(key==='state'&&model.mode==='explore')cameraMap.fit();updateURL();
  });
  $('reset-filters').addEventListener('click',()=>{model.filters=emptyFilters();model.highway='';model.direction='';$('highway-select').value='';$('travel-direction').value='';model.page=1;renderResults();updateURL();});
  $('apply-corridor').addEventListener('click',()=>{if(!model.route){announce('Find a route between your start and destination, then apply the highway filter to that stretch.');return;}model.highway=$('highway-select').value;model.direction=$('travel-direction').value;model.page=1;renderResults();announce('Highway filter applied to your selected route. Unknown camera direction is retained and labeled.');});
  $('previous-page').addEventListener('click',()=>{model.page--;renderResults();$('camera-results').scrollIntoView({block:'start'});});$('next-page').addEventListener('click',()=>{model.page++;renderResults();$('camera-results').scrollIntoView({block:'start'});});
  $('snapshot-refresh').addEventListener('change',()=>media.setAuto($('snapshot-refresh').checked));$('refresh-visible').addEventListener('click',()=>media.refresh());$('wv-autoplay').checked=readWVAutoplay();$('wv-autoplay').addEventListener('change',()=>setWVAutoplay($('wv-autoplay').checked));$('ca-autoplay').checked=readAutoplay('CA');$('ca-autoplay').addEventListener('change',()=>setCAAutoplay($('ca-autoplay').checked));
  $('board-select').addEventListener('change',async()=>{model.library.activeBoardId=$('board-select').value;await ensureBoardCameras();persist();renderLibrary();renderResults();});
  $('new-board').addEventListener('click',()=>{if(model.library.boards.length>=30){announce('You can keep 30 boards. Export or remove a board first.');return;}const name=$('board-name').value.trim()||'My watchboard';const b={id:newId(),name,cameraIds:[]};model.library.boards.push(b);model.library.activeBoardId=b.id;persist();renderLibrary();renderResults();});
  $('rename-board').addEventListener('click',()=>{const name=$('board-name').value.trim();if(name){board().name=name;persist();renderLibrary();renderResults();}});
  $('delete-board').addEventListener('click',()=>{model.library.boards=model.library.boards.filter(b=>b.id!==board().id);if(!model.library.boards.length)model.library.boards.push({id:newId(),name:'My watchboard',cameraIds:[]});model.library.activeBoardId=model.library.boards[0].id;persist();renderLibrary();renderResults();});
  $('board-add-route').addEventListener('click',()=>{if(!model.route){announce('Plan a route first to add representative cameras.');return;}const chosen=representativeCameras(filterCameras(model.matches,model.filters),{intervalMeters:Number($('sample-spacing').value)*1609.344,route:model.route});board().cameraIds=[...new Set([...board().cameraIds,...chosen.map(c=>c.id)])].slice(0,500);persist();renderLibrary();renderResults();announce(`${chosen.length} representative route views added to ${board().name}.`);});
  $('save-trip').addEventListener('click',()=>{const trip=currentTrip();if(!trip){announce('Choose valid start, destination and stops before saving.');return;}if(model.library.trips.length>=50){announce('You can save 50 trips. Export or delete one first.');return;}model.library.trips.push(trip);persist();renderLibrary();$('saved-trip-select').value=trip.id;announce(`Saved ${trip.name}.`);});
  $('load-trip').addEventListener('click',()=>{const trip=model.library.trips.find(t=>t.id===$('saved-trip-select').value);if(trip){loadTrip(trip);announce('Saved trip loaded. Find my route to refresh directions.');}});
  $('delete-trip').addEventListener('click',()=>{const id=$('saved-trip-select').value;if(!id)return;model.library.trips=model.library.trips.filter(t=>t.id!==id);persist();renderLibrary();});
  $('share-trip').addEventListener('click',()=>{if(model.mode==='board'){showShare({type:'board',board:board()});return;}const trip=currentTrip();if(!trip){announce('Select valid trip locations before sharing.');return;}showShare({type:'trip',trip});});$('board-share').addEventListener('click',()=>showShare({type:'board',board:board()}));
  $('share-close').addEventListener('click',()=>$('share-dialog').close());$('share-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('share-url').value);$('share-status').textContent='Link copied.';}catch{$('share-url').select();$('share-status').textContent='Select and copy the link above.';}});
  $('export-data').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({format:'trip-camera-desk',version:1,exportedAt:new Date().toISOString(),...model.library},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='trip-camera-desk-saved.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('import-data').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',async()=>{const file=$('import-file').files[0];if(!file)return;try{if(file.size>2_000_000)throw new Error('Import is larger than 2 MB.');const value=JSON.parse(await file.text());if(value.format!=='trip-camera-desk'||value.version!==1||!Array.isArray(value.boards)||!Array.isArray(value.trips))throw new Error('Choose a Trip Camera Desk export.');mergeLibrary(model.library,value);persist();await ensureBoardCameras();renderLibrary();renderResults();announce('Import complete. Existing items were kept; new items were added up to the 30-board and 50-trip limits.');}catch(error){announce(error.message);}$('import-file').value='';});
  $('live-limit').value=String(media.limit);$('live-limit').addEventListener('change',()=>{media.setLimit($('live-limit').value);while(model.liveSlots.length>media.limit)model.liveSlots.pop().player?.stop();renderLiveSlots();});
  $('stop-all-video').addEventListener('click',()=>{setWVAutoplay(false);setCAAutoplay(false);media.stopAll();for(const slot of model.liveSlots){slot.player=null;slot.wanted=false;}renderLiveSlots();});
  $('dialog-close').addEventListener('click',closeCamera);$('camera-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCamera();});
  $('dialog-pin').addEventListener('click',()=>model.selected&&togglePin(model.selected.id));$('dialog-play').addEventListener('click',()=>{
    if(modalPlayer){modalPlayer.stop();modalPlayer=null;media.snapshot($('dialog-media'),model.selected,{autoplay:false});$('dialog-play').textContent='Watch live';return;}
    modalPlayer=media.play($('dialog-media'),model.selected,{onStatus:message=>$('dialog-status').textContent=message,onEnd:message=>{modalPlayer=null;$('dialog-play').textContent='Watch live';$('dialog-status').textContent=message;}});if(modalPlayer)$('dialog-play').textContent='Stop video';
  });
}
async function init(){
  try{
    model.index=await getIndex();$('catalog-total').textContent=nf.format(model.index.totals.views);$('catalog-sites').textContent=nf.format(model.index.totals.locations);$('catalog-states').textContent=String(model.index.totals.statesAndDistricts);
    const params=new URLSearchParams(location.search);for(const key of Object.keys(model.filters))model.filters[key]=params.get(key)||'';
    model.mode=['plan','wall','board','explore'].includes(params.get('view'))?params.get('view'):'plan';
    cameraMap=createCameraMap($('map'),{onSelect:openCamera,onPick:(key,point)=>choosePoint(key,point),onRoute:id=>activateRoute(id,true).catch(error=>announce(error.message))});
    bindEvents();syncPoints();
    await loadStates(model.index,model.mode==='explore'?(model.filters.state?[model.filters.state]:model.index.states.map(s=>s.state)):['OH','WV','MD']);
    updateHighways();
    if(model.mode==='board')await ensureBoardCameras();
    $('catalog-date').textContent=`Camera metadata compiled ${date(model.index.builtAt)}. Provider checks range from ${date(model.index.auditDateRange?.oldest||model.index.states.map(s=>s.auditCheckedAt).filter(Boolean).sort()[0])} to ${date(model.index.auditDateRange?.newest||model.index.states.map(s=>s.auditCheckedAt).filter(Boolean).sort().at(-1))}.`;
    $('provider-information').insertAdjacentHTML('beforeend','<p>Routing: <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">FOSSGIS Valhalla and OSRM</a>, public best-effort services, at most one request per second. Valhalla supports trips up to 1,500 km; longer ordinary trips use OSRM. The long-distance fallback does not support toll/highway avoidance. Alternatives depend on the provider; Valhalla alternatives require a trip without intermediate stops. Place search: <a href="https://photon.komoot.io/" target="_blank" rel="noopener">Photon</a>, manual searches only, no bulk requests. Map: <a href="https://operations.osmfoundation.org/policies/tiles/" target="_blank" rel="noopener">OpenStreetMap standard tiles</a>, normal interactive viewing. These free public services have no uptime guarantee and may limit requests. High-traffic use needs a dedicated provider.</p><p>Route estimates do not include live traffic. Avoid tolls/highways are routing preferences and may not exclude every such road. Red dashed route stretches have no listed camera within a one-mile interval; markers do not describe the camera’s field of view. Shared links include the selected trip locations or camera IDs. Saved data stays in this browser until exported or deliberately shared.</p><p>California: <a href="https://cwwp2.dot.ca.gov/closed-circuit-television-cameras.html" target="_blank" rel="noopener">Caltrans CWWP2</a>, subject to fair-use limits. Nominal snapshot update intervals are respected; record timestamps describe catalog metadata, not image capture. Travel-side direction is separate from camera-facing description. California county postmiles are not statewide journey distances.</p><p><a href="data/index.json" target="_blank" rel="noopener">Catalog counts and source dates ↗</a> · <a href="https://github.com/whardy/whardy.github.io/blob/master/sandbox/trip-camera-desk/README.md" target="_blank" rel="noopener">Site operation and service limits ↗</a></p>');
    $('provider-information').insertAdjacentHTML('beforeend','<p>Oregon: <a href="https://www.tripcheck.com/" target="_blank" rel="noopener">Camera courtesy of ODOT and TripCheck partner agencies</a>. Most snapshots update about every five minutes; the camera inventory is a separate dated catalog. Capture time may be unknown. PTZ/viewing direction does not establish traffic direction. Washington: public WSDOT and partner cameras. Exact shared border image URLs are counted once with catalog aliases retained; different views remain separate. <a href="https://www.tripcheck.com/" target="_blank" rel="noopener">Official Oregon road and weather conditions ↗</a>.</p>');
    $('source-note').textContent=`Public transportation cameras from ${model.index.totals.statesAndDistricts-1} states and the District of Columbia. Feed access, image quality and availability vary by provider.`;
    render();if(model.mode==='explore')cameraMap.fit();announce(`${nf.format(model.index.totals.views)} listed views across ${model.index.totals.statesAndDistricts-1} states and DC. Start with the example locations or plan your own trip.`);
    await consumeShare();if(params.get('camera')){await loadStates(model.index,statesForCameraIds(model.index,[params.get('camera')]));openCamera(params.get('camera'));}
    window.addEventListener('hashchange',consumeShare);
  }catch(error){announce(error.message||'Trip Camera Desk could not load. Reload to try again.');console.error(error);}
}
init();
