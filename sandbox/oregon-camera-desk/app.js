import {loadLibrary, saveLibrary, cleanBoard, mergeLibrary, encodeShare, decodeShare, newBoard, tripShare} from './boards.js?v=20261104or1';
import {prepareCameras, filterCameras, getFacet, orderCorridor, sliceCorridor} from './filters.js?v=20261104or1';
import {createCameraMap} from './map.js?v=20261104or1';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 25;
const CADENCE = 300_000;
const library = loadLibrary();
const currentBoard = () => library.boards.find(b=>b.id===library.activeBoardId) || library.boards[0];
const nf = new Intl.NumberFormat('en-US');
const time = value => new Date(value).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', second:'2-digit'});
const date = value => new Date(value).toLocaleString('en-US', {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const state = {cameras:[], filters:{query:'',region:'',metro:'',county:'',road:'',delivery:'',direction:'',mediaType:'',stretchStart:'',stretchEnd:'',reverse:false,favorites:false,withinMap:false}, favorites:new Set(), page:1, view:'wall', bounds:null, selected:null, catalog:null};
let cameraMap = null;
let sourceNotice = '';
let loaded = false;
let queued = [];
let running = 0;
let searchTimer;
let mapTimer;
const media = new Set();
const dialog = $('camera-dialog');
let returnFocus = null;
let returnCameraId = null;

function safeURL(value, hosts = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (hosts && !hosts.includes(url.hostname))) return null;
    return url.href;
  } catch {return null;}
}

function imageURL(camera) {
  if (camera.embedMode !== 'image') return null;
  return safeURL(camera.imageUrl, ['www.tripcheck.com','tripcheck.com']);
}

function announce(message) {
  $('source-note').textContent = message;
}

function persistLibrary(){const ok=saveLibrary(library);if(!ok)queueMicrotask(()=>boardMessage('Browser storage is unavailable. Boards are available for this visit; export JSON before leaving.'));return ok;}

function saveFavorites() {
 currentBoard().cameraIds = [...state.favorites];
 if(!persistLibrary()) $('board-status').textContent='Browser storage is unavailable. Export JSON to keep your boards.';
 renderBoards();
}

function toggleFavorite(id) {
  if(!state.favorites.has(id)&&state.favorites.size>=500){announce('This board has 500 cameras. Create another board to add more.');boardMessage('This board has reached its 500-camera limit. Create another board.');return;}
  const focusWasFavorite = Boolean(document.activeElement?.closest('.favorite-button'));
  state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
  saveFavorites();
  render(false);
  if (focusWasFavorite) [...document.querySelectorAll('.camera-card')].find(card=>card.dataset.cameraId===id)?.querySelector('.favorite-button')?.focus();
  if (state.selected) updateDialogFavorite();
}

function updateURL() {
  const params = new URLSearchParams();
  for (const key of ['region','metro','county','road','delivery','direction','mediaType','stretchStart','stretchEnd']) if (state.filters[key]) params.set(key,state.filters[key]);
  if (state.filters.query) params.set('q',state.filters.query);
  if(state.filters.reverse)params.set('reverse','1');
  if (state.filters.favorites) params.set('saved','1');
  if (state.view !== 'wall') params.set('view',state.view);
  if (state.page > 1) params.set('page',String(state.page));
  if (state.selected) params.set('camera',state.selected.id);
  const suffix = params.toString();
  history.replaceState(null,'',`${location.pathname}${suffix?'?'+suffix:''}${location.hash}`);
}

function fillFacet(key, label) {
  const select = $(key);
  const options = getFacet(state.cameras,key,state.filters,state.favorites,state.bounds);
  select.innerHTML = `<option value="">${escape(label)}</option>` + options.map(([value,count]) => `<option value="${escape(value)}">${escape(value)} (${nf.format(count)})</option>`).join('');
  if (state.filters[key] && !options.some(([value]) => value === state.filters[key])) {
    select.add(new Option(`${state.filters[key]} (0)`,state.filters[key]));
  }
  select.value = state.filters[key];
}

function disposeMedia(within) {
  const removed = [...media].filter(item => within.contains(item.container));
  for (const item of removed) {
    item.disposed = true;
    observer.unobserve(item.container);
    media.delete(item);
  }
  queued = queued.filter(item => !item.disposed);
  for (const item of removed) item.cancel?.();
}

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const item = entry.target._cameraMedia;
    if (!item) return;
    item.visible = entry.isIntersecting;
    if(!item.visible)item.cancel?.();
    if (item.visible && !item.lastLoaded) enqueueImage(item);
  });
}, {rootMargin:'0px'});

function enqueueImage(item, force = false) {
  if (item.disposed || item.pending || (!force && (document.hidden || !item.visible || (state.selected && !item.modal)))) return;
  if (item.camera.disabled) {
    item.container.classList.remove('is-loading');
    item.container.classList.add('has-error');
    item.status.textContent = 'Unavailable in source catalog';
    item.message.textContent = 'The provider has marked this camera unavailable. Open its official viewer for updates.';
    return;
  }
  if (!imageURL(item.camera)) {
    item.container.classList.remove('is-loading');
    item.status.textContent = 'Official viewer';
    item.container.classList.add('official-preview');
    item.message.textContent = 'Open this camera in the official TripCheck viewer ↗';
    return;
  }
  item.pending = true;
  queued.push(item);
  drainImages();
}

function drainImages() {
  while (running < 4 && queued.length) {
    const item = queued.shift();
    if (item.disposed || document.hidden || (!item.visible && !item.modal) || (state.selected && !item.modal)) {item.pending=false;continue;}
    running++;
    const image = new Image();
    image.alt = item.camera.name;
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    const url = new URL(imageURL(item.camera));
    url.searchParams.set('_',String(item.manualRefreshAt || Math.floor(Date.now()/(Math.max(300,Number(item.camera.refreshSeconds)||300)*1000))));
    item.manualRefreshAt = null;
    let complete = false;
    let timer;
    const finish = (success,cancelled=false) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      item.cancel = null;
      image.onload = image.onerror = null;
      item.pending = false;
      running--;
      if (!item.disposed && !cancelled) {
        item.container.classList.remove('is-loading');
        item.container.classList.toggle('has-error',!success);
        if (success) {
          item.lastLoaded = Date.now();
          item.image?.remove();
          item.image = image;
          item.container.prepend(image);
          item.message.hidden = true;
          item.status.textContent = `${item.camera.historical?'Historical daylight · ':''}Fetched ${time(item.lastLoaded)} · capture ${item.camera.captureAt?time(item.camera.captureAt):'unknown'}`;
        } else {
          item.status.textContent = item.lastLoaded ? `Refresh failed · last fetched ${time(item.lastLoaded)}` : 'Snapshot unavailable';
          item.message.hidden = Boolean(item.lastLoaded);
          item.message.textContent = 'Snapshot unavailable · try refresh or open the official viewer';
        }
      }
      drainImages();
    };
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    timer = setTimeout(() => {image.removeAttribute('src');finish(false);},15_000);
    item.cancel = () => {image.removeAttribute('src');finish(false,true);};
    image.src = url.href;
  }
}

function attachMedia(container,camera,modal = false) {
  const status = document.createElement('span');
  status.className = 'image-status';
  status.textContent = 'Loading snapshot…';
  const message = document.createElement('span');
  message.className = 'image-placeholder';
  message.textContent = `Connecting to ${camera.provider}…`;
  container.append(message,status);
  container.classList.add('is-loading');
  const item = {container,camera,status,message,modal,visible:modal,disposed:false,pending:false,lastLoaded:0,image:null,cancel:null};
  container._cameraMedia = item;
  media.add(item);
  observer.observe(container);
  if (modal) enqueueImage(item,true);
}

function renderCards(cameras) {
  const grid = $('camera-grid');
  disposeMedia(grid);
  grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const camera of cameras) {
    const saved = state.favorites.has(camera.id);
    const card = document.createElement('article');
    card.className = `camera-card${saved?' is-saved':''}`;
    card.dataset.cameraId = camera.id;
    card.innerHTML = `<header class="card-top"><span class="road-badge">${escape(camera.road)}</span><button class="favorite-button ${saved?'is-saved':''}" type="button" aria-pressed="${saved}" aria-label="${saved?'Remove from board':'Add to board'} ${escape(camera.name)}"><span aria-hidden="true">${saved?'★':'☆'}</span></button></header><button class="card-image" type="button" aria-label="Enlarge ${escape(camera.name)}"></button><div class="card-content"><button class="camera-name" type="button">${escape(camera.name)}<span aria-hidden="true">↗</span></button><p class="camera-place">${escape(camera.county?camera.county+' County':camera.region)} · ${escape(camera.metro)}${camera.physicalState && camera.physicalState!=='OR'?' · '+(camera.physicalState==='Unresolved'?'Location unverified':escape(camera.physicalState)+' border view'):''}</p><div class="card-bottom"><span class="camera-id">${escape(camera.direction||'Direction unknown')} · ${camera.embedMode==='image'?'Snapshot':'Official viewer'}</span><button class="open-camera" type="button">View camera <span aria-hidden="true">↗</span></button></div></div>`;
    if(state.filters.road&&camera.road!==state.filters.road){const crossing=document.createElement('p');crossing.className='source-warning';crossing.textContent='Road alias / crossing-road match; view of selected road uncertain';card.querySelector('.camera-place').after(crossing);}
    if (camera.disabled || camera.imageStatus === 'unavailable' || camera.imageStatus === 'stale') {
      const warning = document.createElement('p');
      warning.className = 'source-warning';
      warning.textContent = camera.disabled ? 'Unavailable in source catalog' : camera.imageStatus === 'stale' ? 'Source image was old at last check' : 'Unavailable at last image check';
      warning.title = camera.checkedAt ? `Checked ${date(camera.checkedAt)}` : 'Status from saved source catalog';
      card.querySelector('.camera-place').after(warning);
    }
    card.querySelector('.favorite-button').addEventListener('click',() => toggleFavorite(camera.id));
    for (const button of card.querySelectorAll('.card-image,.camera-name,.open-camera')) button.addEventListener('click',() => openCamera(camera.id));
    attachMedia(card.querySelector('.card-image'),camera);
    fragment.append(card);
  }
  grid.append(fragment);
}

function activeFilters() {
  const node = $('active-filters');
  node.replaceChildren();
  const values = [
    ['query',state.filters.query ? `Search: ${state.filters.query}` : ''],
    ['region',state.filters.region],['metro',state.filters.metro],['county',state.filters.county],['road',state.filters.road],['direction',state.filters.direction],['mediaType',state.filters.mediaType==='image'?'Refreshing snapshots':state.filters.mediaType==='official'?'Official viewers':''],['delivery',state.filters.delivery === 'available' ? 'Available at last check' : state.filters.delivery === 'unavailable' ? 'Unavailable or old at last check' : ''],
    ['favorites',state.filters.favorites?'Board cameras':''],['withinMap',state.filters.withinMap?'Within map':'']
  ];
  for (const [key,label] of values) if (label) {
    const button = document.createElement('button');
    button.className = 'filter-chip';
    button.textContent = `${label} ×`;
    button.setAttribute('aria-label',`Remove ${label} filter`);
    button.addEventListener('click',() => {
      state.filters[key] = typeof state.filters[key] === 'boolean' ? false : '';
      if (key==='metro') state.filters.county='';
      syncInputs();
      state.page=1;
      render(key!=='withinMap');
    });
    node.append(button);
  }
  node.hidden = !node.childElementCount;
}

function syncInputs() {
  $('search').value = state.filters.query;
  $('delivery').value = state.filters.delivery;
  $('media-type').value=state.filters.mediaType;
  $('road-order').value=state.filters.reverse?'reverse':'forward';
  $('map-scope').checked = state.filters.withinMap;
  $('favorites-toggle').setAttribute('aria-pressed',String(state.filters.favorites));
  $('favorites-toggle').classList.toggle('active',state.filters.favorites);
}

function render(refit = false) {
  if (!loaded) return;
  for (const [key,label] of [['region','All regions'],['metro','All cities & areas'],['county','All counties'],['road','All roads & types'],['direction','All published directions']]) fillFacet(key,label);
  let matching = filterCameras(state.cameras,state.filters,state.favorites,state.bounds);
  const corridor=orderCorridor(matching,state.filters.road,state.filters.reverse);
  updateStretch(corridor.cameras);
  matching=sliceCorridor(corridor.cameras,state.filters.stretchStart,state.filters.stretchEnd);
  if(state.filters.favorites&&!state.filters.road)matching.sort((a,b)=>currentBoard().cameraIds.indexOf(a.id)-currentBoard().cameraIds.indexOf(b.id));
  $('corridor-note').textContent=state.filters.road?corridor.basis+(state.filters.reverse?' (reversed)':'')+'. Viewing direction may differ from traffic direction.':'Select a road to browse a stretch. Camera viewing direction may differ from traffic direction.';
  state.matching=matching;
  const pageCount = Math.max(1,Math.ceil(matching.length / PAGE_SIZE));
  state.page = Math.max(1,Math.min(state.page,pageCount));
  const start = (state.page-1)*PAGE_SIZE;
  $('result-count').textContent = nf.format(matching.length);
  $('result-detail').textContent = `${matching.length===1?'camera':'cameras'}${state.filters.metro?' in '+state.filters.metro:' across Oregon'}`;
  $('pagination-summary').textContent = matching.length ? `${nf.format(start+1)}–${nf.format(Math.min(start+PAGE_SIZE,matching.length))} of ${nf.format(matching.length)} cameras · 25 per page` : 'No matching cameras';
  for (const prefix of ['','top-']) {
    if ($(prefix+'page-label')) $(prefix+'page-label').textContent = `${state.page} / ${pageCount}`;
    if ($(prefix+'previous-page')) $(prefix+'previous-page').disabled = state.page===1;
    if ($(prefix+'next-page')) $(prefix+'next-page').disabled = state.page>=pageCount;
  }
  $('empty-state').hidden = matching.length>0;
  document.body.classList.remove('view-wall','view-split','view-map');
  document.body.classList.add(`view-${state.view}`);
  $('results').dataset.view = state.view;
  $('map-section').hidden = state.view==='wall';
  $('camera-grid').hidden = state.view==='map';
  for (const mode of ['wall','split','map']) {
    $('view-'+mode).setAttribute('aria-pressed',String(state.view===mode));
    $('view-'+mode).classList.toggle('active',state.view===mode);
  }
  renderCards(state.view==='map'?[]:matching.slice(start,start+PAGE_SIZE));
  activeFilters();
  syncInputs();
  if (state.view!=='wall') {
    try {
      const fresh = !cameraMap;
      if (!cameraMap) cameraMap = createCameraMap($('map'), {
        onSelect:openCamera,
        onBoundsChange:bounds => {
          state.bounds = bounds;
          if (!state.filters.withinMap) return;
          clearTimeout(mapTimer);
          mapTimer = setTimeout(() => {state.page=1;render(false);},180);
        }
      });
      cameraMap.update(matching,state.selected?.id);
      requestAnimationFrame(() => {
        cameraMap.resize();
        if ((fresh||refit) && !state.filters.withinMap) cameraMap.fit();
      });
    } catch {
      $('map').textContent = 'The map could not load. Camera cards and filters are still available.';
    }
  }
  updateURL();
}

function updateDialogFavorite() {
  const saved = state.favorites.has(state.selected?.id);
  $('dialog-save').textContent = saved ? '★ Remove from board' : '☆ Add to board';
  $('dialog-save').setAttribute('aria-pressed',String(saved));
}

function openCamera(id) {
  const camera = state.cameras.find(camera => camera.id===id);
  if (!camera) return;
  if (!dialog.open) {returnFocus = document.activeElement;returnCameraId=id;}
  disposeMedia($('dialog-media'));
  $('dialog-media').replaceChildren();
  state.selected = camera;
  state.daylight=false;
  $('dialog-daylight').hidden=!safeURL(camera.daylightUrl,['www.tripcheck.com']);
  $('dialog-daylight').textContent='Show last daylight';
  $('dialog-title').textContent = camera.name;
  $('dialog-subtitle').textContent = `${camera.road} · ${camera.county?camera.county+' County':camera.region} · ${camera.id}`;
  const url = safeURL(camera.officialUrl||camera.sourceUrl,['www.tripcheck.com','tripcheck.com']) || 'https://www.tripcheck.com/';
  $('dialog-source').href = url;
  $('dialog-source').textContent = 'Open official TripCheck viewer ↗';
  $('dialog-trip').href=`https://whardy.github.io/sandbox/trip-camera-desk/?view=explore&state=OR&camera=${encodeURIComponent('OR:tripcheck:'+camera.id)}`;
  $('dialog-status').textContent = (camera.description?camera.description+'. ':'') + (camera.disabled?'Marked unavailable in the dated source catalog. ':camera.imageStatus==='unavailable'?'Unavailable at the dated image check; the source may have recovered. ':'') + (camera.embedMode === 'official' ? 'This camera is available in the official TripCheck viewer. Use the camera name shown above to locate it.' : `Snapshot from ${camera.provider}. Fetched time is not capture time; the source image may be delayed.`);
  updateDialogFavorite();
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('dialog-open');
  for(const item of media)if(!item.modal)item.cancel?.();
  attachMedia($('dialog-media'),camera,true);
  cameraMap?.update(state.matching||[],camera.id);
  updateURL();
}

function closeCamera() {
  disposeMedia($('dialog-media'));
  $('dialog-media').replaceChildren();
  state.selected = null;
  cameraMap?.update(state.matching||[],null);
  document.body.classList.remove('dialog-open');
  if (dialog.open) dialog.close();
  if (returnFocus?.isConnected) returnFocus.focus();
  else [...document.querySelectorAll('.camera-card')].find(card=>card.dataset.cameraId===returnCameraId)?.querySelector('.card-image')?.focus();
  returnFocus = null;
  returnCameraId = null;
  updateURL();
  for (const item of media) if (!item.lastLoaded || $('auto-refresh').checked) enqueueImage(item);
}

function refreshImages(manual = false) {
  for (const item of media) if (item.visible && (!state.selected||item.modal)) {
    if (manual && !item.pending) item.manualRefreshAt = Date.now();
    if(item.camera.historical&&!manual)continue;
    if(manual || !item.lastLoaded || Date.now()-item.lastLoaded>=Math.max(300,Number(item.camera.refreshSeconds)||300)*1000)enqueueImage(item);
  }
}

function changePage(delta) {
  state.page+=delta;
  render(false);
  $('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}

$('search').addEventListener('input',() => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {state.filters.query=$('search').value;state.page=1;render(true);},180);
});
for (const key of ['region','metro','county','road','delivery','direction']) $(key).addEventListener('change',() => {
  state.filters[key]=$(key).value;
  // Changing geography starts a fresh slice rather than trapping incompatible roads.
  if (key==='metro') {state.filters.county='';state.filters.road='';}
  if(key==='region'){state.filters.metro='';state.filters.county='';state.filters.road='';}
  if(['region','metro','county','road'].includes(key)){state.filters.stretchStart='';state.filters.stretchEnd='';}
  if (key==='county') state.filters.road='';
  state.page=1;
  render(true);
});
$('favorites-toggle').addEventListener('click',() => {state.filters.favorites=!state.filters.favorites;state.page=1;render(true);});
function resetFilters() {
  clearTimeout(searchTimer);
  state.filters={query:'',region:'',metro:'',county:'',road:'',delivery:'',direction:'',mediaType:'',stretchStart:'',stretchEnd:'',reverse:false,favorites:false,withinMap:false};
  state.page=1;
  syncInputs();
  render(true);
}
$('reset-filters').addEventListener('click',resetFilters);
$('empty-state').querySelector('button')?.addEventListener('click',resetFilters);
$('refresh-button').addEventListener('click',() => {
  if (!loaded) {loadCatalog();return;}
  refreshImages(true);
  announce('Refreshing visible snapshots. Fetched time records retrieval, not capture time.');
});
$('auto-refresh').addEventListener('change',() => {
  announce($('auto-refresh').checked ? sourceNotice : 'Automatic refresh paused. Use Refresh now to load current images.');
  if ($('auto-refresh').checked) refreshImages();
});
for (const mode of ['wall','split','map']) $('view-'+mode).addEventListener('click',() => {
  state.view=mode;
  if (mode==='wall') state.filters.withinMap=false;
  render(true);
});
$('map-scope').addEventListener('change',() => {state.filters.withinMap=$('map-scope').checked;state.page=1;render(false);});
$('fit-map').addEventListener('click',() => {
  if (state.filters.withinMap) {state.filters.withinMap=false;render(false);}
  cameraMap?.fit();
});
for (const prefix of ['','top-']) {
  $(prefix+'previous-page')?.addEventListener('click',() => changePage(-1));
  $(prefix+'next-page')?.addEventListener('click',() => changePage(1));
}
$('dialog-close').addEventListener('click',closeCamera);
$('dialog-daylight').addEventListener('click',()=>{const camera=state.selected;if(!camera)return;state.daylight=!state.daylight;disposeMedia($('dialog-media'));$('dialog-media').replaceChildren();attachMedia($('dialog-media'),state.daylight?{...camera,imageUrl:camera.daylightUrl,historical:true}:camera,true);$('dialog-daylight').textContent=state.daylight?'Show current image':'Show last daylight';$('dialog-status').textContent=state.daylight?'Historical last-daylight image supplied by TripCheck. Capture time is unknown; availability is provider-controlled. This is not the current camera image.':'Current source snapshot. Fetched time is retrieval, not capture time.';});
$('dialog-save').addEventListener('click',() => {if(state.selected)toggleFavorite(state.selected.id);});
dialog.addEventListener('cancel',event => {event.preventDefault();closeCamera();});
dialog.addEventListener('close',() => {if(state.selected)closeCamera();});
let backdropDown = false;
dialog.addEventListener('pointerdown',event => {backdropDown=event.target===dialog;});
dialog.addEventListener('click',event => {if(backdropDown && event.target===dialog)closeCamera();backdropDown=false;});
document.addEventListener('visibilitychange',() => {if(document.hidden){for(const item of media)item.cancel?.();for(const item of queued)item.pending=false;queued=[];}else if($('auto-refresh').checked)refreshImages();});
setInterval(() => {if($('auto-refresh').checked && !document.hidden)refreshImages();},10_000);

async function loadCatalog() {
  try {
    announce('Loading the Oregon camera catalog…');
    const response = await fetch('./camera-catalog.json',{cache:'no-cache'});
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.cameras)||!catalog.cameras.length) throw new Error('Empty catalog');
    state.catalog=catalog;
    state.cameras=prepareCameras(catalog.cameras);
    $('county').closest('.field').hidden=!state.cameras.some(camera=>camera.county);
    loaded=true;
    for (const id of ['search','region','metro','county','road','delivery','direction','media-type','favorites-toggle','reset-filters','view-wall','view-split','view-map']) $(id).disabled=false;
    $('catalog-count').textContent=nf.format(state.cameras.length);
    $('metro-count').textContent=nf.format(new Set(state.cameras.map(camera => camera.metro)).size);
    $('catalog-date').textContent=date(catalog.fetchedAt);
    if ($('audit-summary') && catalog.auditCounts) $('audit-summary').textContent=`Image check ${date(catalog.auditCompletedAt)}: ${nf.format(catalog.auditCounts.available||0)} image responses; ${nf.format((catalog.auditCounts.disabled||0)+(catalog.auditCounts.unavailable||0))} disabled or unavailable; ${nf.format(catalog.auditCounts.stale||0)} old source images; ${nf.format(catalog.officialOnlyCount||0)} official-viewer cameras. Image age and availability can change.`;
    sourceNotice='Camera courtesy of ODOT and TripCheck partners. Visible snapshots refresh every 5 minutes. Fetched time is retrieval; capture time may be unknown.';
    announce(sourceNotice);
    const params = new URLSearchParams(location.search);
    for (const key of ['region','metro','county','road','delivery','direction','mediaType','stretchStart','stretchEnd']) state.filters[key] = params.get(key) || '';
    state.filters.query=params.get('q') || '';
    state.filters.favorites=params.get('saved')==='1';
    const requestedPage=Number(params.get('page'));
    state.page=Number.isFinite(requestedPage)?Math.max(1,Math.floor(requestedPage)):1;
    if (!['','available','unavailable'].includes(state.filters.delivery)) state.filters.delivery='';
    state.view=['wall','split','map'].includes(params.get('view'))?params.get('view'):'wall';
    state.favorites=new Set(currentBoard().cameraIds);
    state.filters.reverse=params.get('reverse')==='1';
    renderBoards();
    applyIncomingShare();
    renderPasses();
    const locations=new Set(state.cameras.map(c=>c.siteId||c.id)).size;
    const mapped=state.cameras.filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon)).length;
    $('catalog-summary').textContent=`${nf.format(state.cameras.length)} listed views at ${nf.format(locations)} source locations; ${nf.format(mapped)} geocoded; ${nf.format(state.cameras.length-mapped)} unmapped. Locations are source identifiers, not independently verified physical devices. ${state.cameras.filter(c=>c.embedMode==='image').length} snapshot-capable views; ${state.cameras.filter(c=>c.embedMode==='official').length} official-viewer entries. No independently verified embedded live video.`;
    const initialCamera=params.get('camera');
    render(true);
    if (initialCamera) openCamera(initialCamera);
  } catch {
    announce('The camera catalog could not load. Select Refresh now to retry, or visit TripCheck.');
    $('empty-state').hidden=false;
    $('result-count').textContent='—';
    $('result-detail').textContent='Catalog unavailable';
  }
}

function updateStretch(rows){
 for(const [id,key] of [['corridor-start','stretchStart'],['corridor-end','stretchEnd']]){
  const select=$(id);select.disabled=!state.filters.road;
  select.innerHTML='<option value="">Full road</option>'+(state.filters.road?rows:[]).map(c=>`<option value="${escape(c.id)}">${escape(c.name)}</option>`).join('');
  if(state.filters[key]&&!rows.some(c=>c.id===state.filters[key]))state.filters[key]='';
  select.value=state.filters[key];
 }
}
for(const [id,key] of [['corridor-start','stretchStart'],['corridor-end','stretchEnd']])$(id).addEventListener('change',()=>{state.filters[key]=$(id).value;state.page=1;render(true);});
$('road-order').addEventListener('change',()=>{state.filters.reverse=$('road-order').value==='reverse';state.page=1;render(false);});
$('media-type').addEventListener('change',()=>{state.filters.mediaType=$('media-type').value;state.page=1;render(true);});
function renderPasses(){
 const passes=[['Government Camp','government camp'],['Santiam Pass','santiam pass'],['Willamette Pass','willamette pass'],['Siskiyou Summit','siskiyou'],['Blue Mountains','meacham']];
 $('pass-shortcuts').replaceChildren();
 for(const [label,query] of passes){if(!filterCameras(state.cameras,{query}).length)continue;const b=document.createElement('button');b.type='button';b.className='filter-chip';b.textContent=label+' ↗';b.addEventListener('click',()=>{resetFilters();state.filters.query=query;state.page=1;render(true);});$('pass-shortcuts').append(b);}
}
function boardMessage(message){$('board-status').textContent=message;}
function renderBoards(){
 const board=currentBoard();
 $('board-select').innerHTML=library.boards.map(b=>`<option value="${escape(b.id)}">${escape(b.name)} (${b.cameraIds.length})</option>`).join('');
 $('board-select').value=board.id;$('board-name').value=board.name;$('board-total').textContent=`· ${library.boards.length} saved`;
 $('board-delete').disabled=board.cameraIds.length>0||library.boards.length<2;
 $('board-list').replaceChildren();
 for(const [index,id] of board.cameraIds.entries()){
  const camera=state.cameras.find(c=>c.id===id);const row=document.createElement('li');
  const name=document.createElement('button');name.type='button';name.className='board-camera-name';name.textContent=camera?.name||`Camera ${id} (not in this catalog)`;name.disabled=!camera;name.addEventListener('click',()=>openCamera(id));row.append(name);
  for(const [label,delta] of [['Move up',-1],['Move down',1],['Remove',0]]){
   const b=document.createElement('button');b.className='board-order-button';b.type='button';b.textContent=delta<0?'↑':delta>0?'↓':'×';b.setAttribute('aria-label',`${label} ${camera?.name||id}`);b.disabled=(delta<0&&index===0)||(delta>0&&index===board.cameraIds.length-1);
   b.addEventListener('click',()=>{
    if(delta){const swap=index+delta;[board.cameraIds[index],board.cameraIds[swap]]=[board.cameraIds[swap],board.cameraIds[index]];}else board.cameraIds.splice(index,1);
    state.favorites=new Set(board.cameraIds);persistLibrary();renderBoards();if(state.filters.favorites)render(false);updateDialogFavorite();
    $('board-list').children[Math.min(index,board.cameraIds.length-1)]?.querySelector('button')?.focus();
   });row.append(b);
  }
  $('board-list').append(row);
 }
 const tripURL=new URL('https://whardy.github.io/sandbox/trip-camera-desk/');try{tripURL.hash='share='+encodeShare(tripShare(board));$('board-trip').title='Share this board with Trip Camera Desk';}catch{tripURL.search='?view=explore&state=OR';$('board-trip').title='Large board: use JSON export to transfer its cameras';}$('board-trip').href=tripURL.href;
}
$('board-select').addEventListener('change',()=>{library.activeBoardId=$('board-select').value;state.favorites=new Set(currentBoard().cameraIds);persistLibrary();renderBoards();render(false);});
$('board-create').addEventListener('click',()=>{if(library.boards.length>=30){boardMessage('This browser supports up to 30 boards. Export before removing old boards.');return;}const board=newBoard($('board-name').value||'New watchboard');library.boards.push(board);library.activeBoardId=board.id;state.favorites=new Set();persistLibrary();renderBoards();render(false);boardMessage('New empty board created. Add cameras using the star on each card.');});
$('board-rename').addEventListener('click',()=>{currentBoard().name=$('board-name').value.trim().slice(0,100)||'My watchboard';persistLibrary();renderBoards();boardMessage('Board renamed.');});
$('board-delete').addEventListener('click',()=>{if(currentBoard().cameraIds.length||library.boards.length<2)return;library.boards=library.boards.filter(b=>b.id!==library.activeBoardId);library.activeBoardId=library.boards[0].id;state.favorites=new Set(currentBoard().cameraIds);persistLibrary();renderBoards();render(false);});
$('board-show').addEventListener('click',()=>{resetFilters();state.filters.favorites=true;state.page=1;render(true);$('results').scrollIntoView({block:'start'});});
$('board-share').addEventListener('click',()=>{try{const url=new URL(location.pathname,location.origin);url.hash='share='+encodeShare({type:'oregon-board',board:currentBoard()});$('share-url').value=url.href;$('share-wrap').hidden=false;$('share-url').focus();$('share-url').select();boardMessage('Copy this link to share the current board. It contains camera IDs and the board name.');}catch(e){boardMessage(e.message);}});
$('board-export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(library,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='oregon-camera-watchboards.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);boardMessage('Exported all boards. The file contains names and camera IDs, no camera footage.');});
$('board-import').addEventListener('change',async()=>{const file=$('board-import').files[0];if(!file)return;try{if(file.size>500000)throw new Error('Choose a JSON export smaller than 500 KB.');const incoming=JSON.parse(await file.text());const count=mergeLibrary(library,incoming);persistLibrary();renderBoards();boardMessage(`Imported ${count} board${count===1?'':'s'}; existing boards were preserved. Maximum 30 boards and 500 cameras per board.`);}catch(e){boardMessage('Import failed: '+e.message);}finally{$('board-import').value='';}});
function applyIncomingShare(){
 document.getElementById('incoming-share')?.remove();
 const encoded=new URLSearchParams(location.hash.slice(1)).get('share');if(!encoded)return;
 try{const payload=decodeShare(encoded);const board=payload?.type==='oregon-board'?cleanBoard(payload.board):null;if(!board)throw new Error('This link does not contain an Oregon board.');
  const button=document.createElement('button');button.id='incoming-share';button.type='button';button.className='button primary-button';button.textContent=`Save shared board: ${board.name}`;
  button.addEventListener('click',()=>{const count=mergeLibrary(library,{boards:[board]});if(count){library.activeBoardId=library.boards.at(-1).id;state.favorites=new Set(currentBoard().cameraIds);persistLibrary();renderBoards();render(false);button.remove();history.replaceState(null,'',location.pathname+location.search);boardMessage('Shared board saved in this browser.');}else boardMessage('Board limit reached. Export or remove an empty board first.');});
  $('board-status').after(button);$('board-status').closest('details').open=true;boardMessage(`Shared board “${board.name}” contains ${board.cameraIds.length} camera IDs. Save it to add a local copy.`);
 }catch(e){boardMessage('Unable to read shared board: '+e.message);}
}

window.addEventListener('hashchange',()=>{if(loaded)applyIncomingShare();});
loadCatalog();
