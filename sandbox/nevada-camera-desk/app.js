import {prepareCameras, filterCameras, facet, FILTER_KEYS, EMPTY_FILTERS, validCoordinates} from './filters.js';
import {createCameraMap} from './map.js';
import {createMediaManager} from './media.js';
import {loadLibrary, saveLibrary, mergeLibrary, normalizeLibrary, encodeShare, decodeShare, newId} from './store.js';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 25, nf = new Intl.NumberFormat('en-US');
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp = value => {const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}):'Not reported';};
const safeURL = value => {try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const model = {cameras:[],catalog:null,filters:{...EMPTY_FILTERS},page:1,view:'wall',library:loadLibrary(),selected:null,mapBounds:null,searchBounds:null};
const activeBoard = () => model.library.boards.find(b=>b.id===model.library.activeBoardId)||model.library.boards[0];
let map=null,ready=false,lastFocus=null,dialogPlayer=null,nameAction=null,confirmAction=null,searchTimer=null;
const readAutoplay = () => {try{return localStorage.getItem('nevada-camera-desk-autoplay')!=='off';}catch{return true;}};
const media = createMediaManager({autoplayNV:readAutoplay(),onChange:count=>{$('live-count').textContent=`${count} active`;},onMessage:announce});

function announce(message){$('source-note').textContent=message;}
function persist(){if(!saveLibrary(model.library))announce('Browser storage is unavailable. Export your boards to keep them.');}
function setAutoplay(value){$('autoplay').checked=!!value;media.setNVAutoplay(value);try{localStorage.setItem('nevada-camera-desk-autoplay',value?'on':'off');}catch{/* Playback remains available. */}}
function syncLiveLimit(){
  const mobile=matchMedia('(max-width:700px)').matches;
  for(const option of $('live-limit').options)option.disabled=mobile&&Number(option.value)>1;
  if(mobile){media.setLimit(1);$('live-limit').value='1';}
}
function tripId(camera){return `NV:nv511:${camera.viewId}`;}

function updateURL(){
  const p=new URLSearchParams();
  for(const key of ['query',...FILTER_KEYS])if(model.filters[key])p.set(key,model.filters[key]);
  if(model.filters.withinMap)p.set('withinMap','1');
  if(model.view!=='wall')p.set('view',model.view);
  if(model.page>1)p.set('page',String(model.page));
  if(model.selected)p.set('camera',model.selected.id);
  history.replaceState(null,'',`${location.pathname}${p.size?'?'+p:''}${location.hash}`);
}

function readURL(){
  const p=new URLSearchParams(location.search);
  for(const key of ['query',...FILTER_KEYS])if(p.has(key))model.filters[key]=p.get(key).slice(0,220);
  model.page=Math.max(1,Math.min(100000,Number(p.get('page'))||1));
  $('query').value=model.filters.query;
  return {view:['wall','map','board'].includes(p.get('view'))?p.get('view'):'wall',camera:p.get('camera')};
}

function fillFacets(){
  for(const [key,label] of [['metro','All regions'],['county','All jurisdictions'],['city','All nearby places'],['road','All roads'],['direction','All facings'],['providerSource','All source systems'],['mediaType','All media'],['availability','All checks']]){
    const choices=facet(model.cameras,model.filters,key,model.searchBounds);
    const node=$(key);
    node.replaceChildren(new Option(label,''),...choices.map(([value,count])=>new Option(`${value} (${nf.format(count)})`,value)));
    if(model.filters[key]&&!choices.some(([value])=>value===model.filters[key]))node.add(new Option(`${model.filters[key]} (0)`,model.filters[key]));
    node.value=model.filters[key];
    node.closest('label').hidden=choices.length===0&&!model.filters[key];
  }
}

function renderChips(){
  const root=$('active-filters');root.replaceChildren();
  for(const key of ['query',...FILTER_KEYS,'withinMap']){
    const value=model.filters[key];if(!value)continue;
    const chip=document.createElement('button');chip.type='button';chip.className='filter-chip';
    chip.textContent=`${key==='withinMap'?'Map area':key==='query'?'Search: '+value:value} ×`;
    chip.setAttribute('aria-label',`Remove ${key} filter`);
    chip.addEventListener('click',()=>{model.filters[key]=key==='withinMap'?false:'';if(key==='withinMap')model.searchBounds=null;model.page=1;render();});
    root.append(chip);
  }
}

function renderBoards(){
  $('board-count').textContent=String(activeBoard().cameraIds.length);
  const select=$('board-select');select.replaceChildren(...model.library.boards.map(b=>new Option(`${b.name} (${b.cameraIds.length})`,b.id)));select.value=activeBoard().id;
  $('board-notice').textContent=`${model.library.boards.length} saved ${model.library.boards.length===1?'board':'boards'} · ${activeBoard().cameraIds.length} pinned ${activeBoard().cameraIds.length===1?'view':'views'}. Boards stay in this browser until deliberately shared or exported.`;
}

function pin(camera){
  const board=activeBoard(),index=board.cameraIds.indexOf(camera.id);
  if(index>=0)board.cameraIds.splice(index,1);
  else if(board.cameraIds.length<500)board.cameraIds.push(camera.id);
  else {announce('This board has reached 500 cameras. Create another board.');return;}
  persist();render();if(model.selected)updateDialogPin();
}

function move(id,step){
  const ids=activeBoard().cameraIds,index=ids.indexOf(id),to=index+step;
  if(index<0||to<0||to>=ids.length)return;
  [ids[index],ids[to]]=[ids[to],ids[index]];persist();render();
}

function results(){
  const filtered=filterCameras(model.cameras,model.filters,model.searchBounds);
  if(model.view!=='board')return filtered;
  const byId=new Map(filtered.map(c=>[c.id,c]));
  return activeBoard().cameraIds.map(id=>byId.get(id)).filter(Boolean);
}

function mediaLabel(camera){return camera.videoUrl?'Live video':camera.imageUrl?'Refreshing snapshot':'Official viewer';}

function renderCards(cameras){
  const grid=$('camera-grid');media.dispose(grid);grid.replaceChildren();
  const fragment=document.createDocumentFragment();
  for(const camera of cameras){
    const pinned=activeBoard().cameraIds.includes(camera.id);
    const card=document.createElement('article');card.className=`camera-card${pinned?' is-pinned':''}`;card.dataset.cameraId=camera.id;
    card.innerHTML=`<header class="card-top"><span class="road-badge">${escape(camera.road)}</span><button class="pin-button" type="button" aria-label="${pinned?'Unpin':'Pin'} ${escape(camera.name)}" aria-pressed="${pinned}">${pinned?'★':'☆'}</button></header><div class="card-media"></div><div class="card-content"><div class="capability"><span class="cap-dot ${camera.videoUrl?'video':''}"></span>${escape(mediaLabel(camera))}<span>${escape(camera.county)}</span></div><button class="camera-name" type="button">${escape(camera.name)} <span aria-hidden="true">↗</span></button><p class="camera-place">${escape([camera.city&&'Near '+camera.city,camera.metro].filter(Boolean).join(' · '))}</p><p class="camera-side">${escape(camera.direction==='Unknown'?'Facing not reported':`Facing: ${camera.direction}`)} · ${escape(camera.providerSource||'Nevada 511')}</p><p class="audit-note">${escape(camera.availability)}${camera.checkedAt?' · '+escape(stamp(camera.checkedAt)):''}${camera.disabled?' · Provider disabled':''}</p><div class="card-actions"><button class="watch-button" type="button">Watch live</button><button class="stop-button" type="button" hidden>Stop video</button><button class="enlarge-button" type="button">Enlarge ↗</button><a class="official-button" target="_blank" rel="noopener noreferrer">Official ↗</a></div>${model.view==='board'?'<div class="reorder-actions"><button class="move-up" type="button">↑ Earlier</button><button class="move-down" type="button">↓ Later</button><button class="remove-pin" type="button">Remove</button></div>':''}</div>`;
    const box=card.querySelector('.card-media'),watch=card.querySelector('.watch-button'),stop=card.querySelector('.stop-button');let player=null;
    const ended=()=>{player=null;watch.hidden=!camera.videoUrl;stop.hidden=true;};
    const attach=allowAuto=>media.snapshot(box,camera,{autoplay:allowAuto,onPlay:p=>{player=p;watch.hidden=true;stop.hidden=false;},onEnd:ended,onStatus:announce});
    attach(true);watch.hidden=!camera.videoUrl;
    watch.addEventListener('click',()=>{player=media.play(box,camera,{onStatus:announce,onEnd:ended});if(player){watch.hidden=true;stop.hidden=false;}});
    stop.addEventListener('click',()=>{player?.stop();ended();attach(false);});
    card.querySelector('.pin-button').addEventListener('click',()=>pin(camera));
    for(const button of card.querySelectorAll('.camera-name,.enlarge-button'))button.addEventListener('click',()=>openCamera(camera.id));
    card.querySelector('.official-button').href=safeURL(camera.officialUrl)||'https://www.nvroads.com/cctv';
    if(model.view==='board'){
      const index=activeBoard().cameraIds.indexOf(camera.id);
      card.querySelector('.move-up').disabled=index===0;
      card.querySelector('.move-down').disabled=index===activeBoard().cameraIds.length-1;
      card.querySelector('.move-up').addEventListener('click',()=>move(camera.id,-1));
      card.querySelector('.move-down').addEventListener('click',()=>move(camera.id,1));
      card.querySelector('.remove-pin').addEventListener('click',()=>pin(camera));
    }
    fragment.append(card);
  }
  grid.append(fragment);
}

function render(){
  if(!ready)return;
  const cameras=results();model.page=Math.max(1,Math.min(model.page,Math.ceil(cameras.length/PAGE_SIZE)||1));
  fillFacets();renderBoards();renderChips();
  const first=(model.page-1)*PAGE_SIZE;
  renderCards(cameras.slice(first,first+PAGE_SIZE));
  $('result-count').textContent=nf.format(cameras.length);
  $('results-note').textContent=model.view==='board'?`Pinned to ${activeBoard().name} · current conditions, not arrival predictions`:'Published camera views · facing may change when operators pan a camera';
  $('empty-state').hidden=cameras.length>0;
  $('page-summary').textContent=cameras.length?`${nf.format(first+1)}–${nf.format(Math.min(first+PAGE_SIZE,cameras.length))} of ${nf.format(cameras.length)} · 25 per page`:'No matching views';
  $('page-label').textContent=`${model.page} / ${Math.ceil(cameras.length/PAGE_SIZE)||1}`;
  $('previous-page').disabled=model.page<=1;$('next-page').disabled=first+PAGE_SIZE>=cameras.length;
  $('clear-map').hidden=!model.filters.withinMap;
  map?.update(cameras,model.selected?.id);
  updateURL();
}

function setView(value){
  model.view=['wall','map','board'].includes(value)?value:'wall';model.page=1;
  for(const v of ['wall','map','board'])$('view-'+v).setAttribute('aria-pressed',String(model.view===v));
  $('board-panel').hidden=model.view!=='board';$('map-section').hidden=model.view!=='map';
  if(model.view==='map'){
    if(!map)map=createCameraMap($('map'),{onSelect:openCamera,onBoundsChange:bounds=>{model.mapBounds=bounds;}});
    requestAnimationFrame(()=>{map.resize();map.fit();});
  }
  render();
}

function updateDialogPin(){const pinned=activeBoard().cameraIds.includes(model.selected?.id);$('dialog-pin').textContent=pinned?'Unpin from board':'Pin to board';$('dialog-pin').setAttribute('aria-pressed',String(pinned));}
function attachDialog(camera,allowAuto=true){
  media.snapshot($('dialog-media'),camera,{autoplay:allowAuto,onPlay:p=>{dialogPlayer=p;$('dialog-watch').hidden=true;$('dialog-stop').hidden=false;},onEnd:()=>{dialogPlayer=null;$('dialog-watch').hidden=!camera.videoUrl;$('dialog-stop').hidden=true;},onStatus:message=>$('dialog-status').textContent=message});
}
function openCamera(id){
  const camera=model.cameras.find(c=>c.id===id);if(!camera)return;
  const dialog=$('camera-dialog');if(!dialog.open){lastFocus=document.activeElement;dialog.showModal();}
  else media.dispose($('dialog-media'));
  model.selected=camera;
  $('dialog-title').textContent=camera.name;
  $('dialog-location').textContent=[camera.road,camera.county,camera.metro].filter(Boolean).join(' · ');
  $('dialog-watch').hidden=!camera.videoUrl;$('dialog-stop').hidden=true;
  $('dialog-status').textContent='Current provider media. Capture time is unknown; separate feeds are not synchronized.';
  $('dialog-source').href=safeURL(camera.officialUrl)||'https://www.nvroads.com/cctv';
  updateDialogPin();
  const details=[['Provider',camera.provider],['Source system',camera.providerSource],['Parent camera ID',camera.parentId],['View ID',camera.viewId],['Source ID',camera.sourceId],['Jurisdiction',camera.county||'Not verified'],['Nearby place',camera.city?camera.city+' (approximate)':'Not verified'],['Published facing',camera.direction||'Unknown'],['Original roadway',camera.sourceRoad],['Provider updated',stamp(camera.sourceUpdatedAt)],['Catalog fetched',stamp(model.catalog.fetchedAt)],['Dated availability',camera.availability+(camera.checkedAt?' · '+stamp(camera.checkedAt):'')],['Image check',camera.imageStatus],['Video check',camera.videoStatus],['Capture time','Unknown']];
  $('dialog-details').innerHTML=details.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value||'Not reported')}</dd></div>`).join('');
  media.setAutoplayScope(dialog);attachDialog(camera);map?.update(results(),camera.id);updateURL();
}
function closeCamera(){
  media.dispose($('dialog-media'));dialogPlayer=null;model.selected=null;media.setAutoplayScope(null);
  if($('camera-dialog').open)$('camera-dialog').close();map?.update(results(),null);updateURL();
  if(lastFocus?.isConnected)lastFocus.focus();
}

function confirm(title,copy,button,action){$('confirm-title').textContent=title;$('confirm-copy').textContent=copy;$('confirm-yes').textContent=button;confirmAction=action;$('confirm-dialog').showModal();}
function nameBoard(action){nameAction=action;$('name-title').textContent=action==='rename'?'Rename your board':'Create a watchboard';$('board-name').value=action==='rename'?activeBoard().name:'';$('name-dialog').showModal();$('board-name').focus();}
function shareBoard(){
  try{const url=new URL(location.href);url.search='';url.hash='board='+encodeShare({version:1,boards:[activeBoard()]});$('share-url').value=url.href;$('share-status').textContent='';$('share-dialog').showModal();$('share-url').focus();$('share-url').select();}
  catch(error){announce(error.message);}
}
function exportBoards(){const url=URL.createObjectURL(new Blob([JSON.stringify(model.library,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='nevada-camera-watchboards.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function importValue(value){
  if(!value||!Array.isArray(value.boards)||!value.boards.length||value.boards.length>30)throw new Error('Choose a Nevada board export with 1–30 boards.');
  if(value.boards.some(b=>!b||!Array.isArray(b.cameraIds)||b.cameraIds.length>500))throw new Error('Invalid board or too many camera IDs.');
  const valid=new Set(model.cameras.map(c=>c.id));
  const cleaned=normalizeLibrary(value),missing=cleaned.boards.reduce((n,b)=>n+b.cameraIds.filter(id=>!valid.has(id)).length,0),before=model.library.boards.length;
  mergeLibrary(model.library,cleaned);model.library.activeBoardId=model.library.boards[before]?.id||model.library.activeBoardId;
  persist();setView('board');announce(`Imported ${model.library.boards.length-before} board(s).${missing?' Unknown IDs remain saved but make no media requests.':''}`);
}
function openTripBoard(){
  try{const board={...activeBoard(),cameraIds:activeBoard().cameraIds.map(id=>`NV:${id}`)};const url=new URL('../trip-camera-desk/',location.href);url.hash='share='+encodeShare({type:'board',board});location.assign(url.href);}
  catch(error){announce(error.message);}
}

function wire(){
  $('query').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{model.filters.query=$('query').value;model.page=1;render();},180);});
  for(const key of FILTER_KEYS)$(key).addEventListener('change',()=>{model.filters[key]=$(key).value;model.page=1;render();});
  for(const view of ['wall','map','board'])$('view-'+view).addEventListener('click',()=>setView(view));
  $('reset-filters').addEventListener('click',()=>{model.filters={...EMPTY_FILTERS};model.searchBounds=null;$('query').value='';model.page=1;render();});
  for(const [id,step] of [['previous-page',-1],['next-page',1]])$(id).addEventListener('click',()=>{model.page+=step;render();$('results').scrollIntoView({block:'start'});});
  $('autoplay').addEventListener('change',()=>setAutoplay($('autoplay').checked));
  $('refresh-auto').addEventListener('change',()=>media.setAuto($('refresh-auto').checked));
  $('refresh-now').addEventListener('click',()=>media.refresh());
  $('live-limit').addEventListener('change',()=>media.setLimit($('live-limit').value));window.addEventListener('resize',syncLiveLimit);
  $('stop-all').addEventListener('click',()=>{setAutoplay(false);media.stopAll('Stopped by you · choose Watch live to resume');announce('All live videos stopped. Autoplay is off until you enable it.');});
  $('search-map').addEventListener('click',()=>{if(model.mapBounds){model.searchBounds={...model.mapBounds};model.filters.withinMap=true;model.page=1;render();}});
  $('clear-map').addEventListener('click',()=>{model.searchBounds=null;model.filters.withinMap=false;render();});
  $('fit-map').addEventListener('click',()=>map?.fit());
  $('board-select').addEventListener('change',()=>{model.library.activeBoardId=$('board-select').value;persist();render();});
  $('new-board').addEventListener('click',()=>nameBoard('new'));
  $('rename-board').addEventListener('click',()=>nameBoard('rename'));
  $('delete-board').addEventListener('click',()=>confirm('Delete this watchboard?',`${activeBoard().name} and its saved selection will be removed.`,'Delete board',()=>{model.library.boards=model.library.boards.filter(b=>b.id!==activeBoard().id);model.library=normalizeLibrary(model.library);persist();render();}));
  $('name-form').addEventListener('submit',event=>{event.preventDefault();const name=$('board-name').value.trim();if(!name)return;if(nameAction==='rename')activeBoard().name=name;else{if(model.library.boards.length>=30){announce('You have 30 watchboards.');return;}const b={id:newId(),name,cameraIds:[]};model.library.boards.push(b);model.library.activeBoardId=b.id;}persist();$('name-dialog').close();setView('board');});
  for(const id of ['name-close','name-cancel'])$(id).addEventListener('click',()=>$('name-dialog').close());
  $('share-board').addEventListener('click',shareBoard);$('share-close').addEventListener('click',()=>$('share-dialog').close());
  $('copy-share').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('share-url').value);$('share-status').textContent='Link copied.';}catch{$('share-url').focus();$('share-url').select();$('share-status').textContent='Select and copy the link above.';}});
  $('export-boards').addEventListener('click',exportBoards);
  $('import-boards').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async()=>{const file=$('import-file').files[0];$('import-file').value='';if(!file)return;try{if(file.size>1024*1024)throw new Error('Import files must be under 1 MB.');const value=JSON.parse(await file.text());confirm('Import watchboards?',`Add boards from ${file.name} to this browser? Existing boards will be kept.`,'Import boards',()=>importValue(value));}catch(error){announce(error.message);}});
  $('trip-board').addEventListener('click',openTripBoard);
  $('confirm-yes').addEventListener('click',()=>{const action=confirmAction;confirmAction=null;$('confirm-dialog').close();try{action?.();}catch(error){announce(error.message);}});
  $('confirm-no').addEventListener('click',()=>{confirmAction=null;$('confirm-dialog').close();});
  $('dialog-close').addEventListener('click',closeCamera);$('camera-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCamera();});
  $('dialog-pin').addEventListener('click',()=>{if(model.selected)pin(model.selected);});
  $('dialog-watch').addEventListener('click',()=>{const camera=model.selected;if(!camera)return;dialogPlayer=media.play($('dialog-media'),camera,{onStatus:message=>$('dialog-status').textContent=message,onEnd:()=>{dialogPlayer=null;$('dialog-watch').hidden=false;$('dialog-stop').hidden=true;}});if(dialogPlayer){$('dialog-watch').hidden=true;$('dialog-stop').hidden=false;}});
  $('dialog-stop').addEventListener('click',()=>{dialogPlayer?.stop();dialogPlayer=null;if(model.selected)attachDialog(model.selected,false);$('dialog-watch').hidden=!model.selected?.videoUrl;$('dialog-stop').hidden=true;});
  $('dialog-trip').addEventListener('click',()=>{if(model.selected){const url=new URL('../trip-camera-desk/',location.href);url.searchParams.set('view','explore');url.searchParams.set('state','NV');url.searchParams.set('camera',tripId(model.selected));location.assign(url.href);}});
}

async function start(){
  wire();$('autoplay').checked=readAutoplay();$('live-limit').value=String(media.limit);syncLiveLimit();
  try{
    const response=await fetch('./camera-catalog.json',{cache:'no-cache'});if(!response.ok)throw new Error('Nevada camera catalog could not load.');
    const catalog=await response.json();if(!Array.isArray(catalog.cameras))throw new Error('Invalid Nevada camera catalog.');
    model.catalog=catalog;model.cameras=prepareCameras(catalog.cameras);ready=true;
    const initial=readURL();
    $('total-count').textContent=nf.format(model.cameras.length);
    $('location-count').textContent=nf.format(new Set(model.cameras.map(c=>c.siteId)).size);
    $('area-count').textContent=`${new Set(model.cameras.map(c=>c.metro)).size} browsing regions`;
    $('video-count').textContent=`${nf.format(model.cameras.filter(c=>c.videoUrl).length)} video-capable views`;
    const checked=model.cameras.filter(c=>c.checkedAt).length;
    $('source-details').innerHTML=`<p>Catalog fetched ${escape(stamp(catalog.fetchedAt))}. ${nf.format(model.cameras.length)} listed views at ${nf.format(new Set(model.cameras.map(c=>c.siteId)).size)} source locations; ${nf.format(model.cameras.filter(validCoordinates).length)} have usable coordinates. Source locations are not verified physical-device counts.</p><p>Capabilities overlap: ${nf.format(model.cameras.filter(c=>c.videoUrl).length)} video URLs and ${nf.format(model.cameras.filter(c=>c.imageUrl).length)} snapshot URLs. ${nf.format(checked)} dated media checks; untested feeds remain unverified.</p><p>Catalog source: Nevada 511 public camera listing. <a href="camera-catalog.json">Catalog JSON ↗</a> · <a href="source-audit.json">Dated audit ↗</a></p>`;
    const roads=new Set(model.cameras.map(c=>c.road));
    for(const road of ['I-15','I-80','I-11','I-580','US-95','US-93','US-50','US-395','I-215','CC-215'])if(roads.has(road)){
      const button=document.createElement('button');button.type='button';button.className='corridor-button';button.textContent=road;
      button.addEventListener('click',()=>{model.filters={...EMPTY_FILTERS,road};$('query').value='';model.page=1;render();});$('corridor-shortcuts').append(button);
    }
    setView(initial.view);model.page=Number(new URLSearchParams(location.search).get('page'))||1;render();
    if(initial.camera)openCamera(initial.camera);
    if(location.hash.startsWith('#board='))try{const value=decodeShare(location.hash.slice(7));if(!Array.isArray(value.boards)||!value.boards.length)throw new Error('Shared link has no board.');confirm('Import shared board?',`Add ${value.boards.length} shared board(s) to this browser?`,'Import board',()=>importValue(value));}catch(error){announce(error.message);}
  }catch(error){$('results-note').textContent=error.message;announce(error.message);$('empty-state').hidden=false;$('empty-state').querySelector('h3').textContent='Catalog unavailable';}
}
start();
