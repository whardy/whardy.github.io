import {prepareCameras, filterCameras, getFacet} from './filters.js?v=20261103md1';
import {createCameraMap} from './map.js?v=20261104preview1';
import {createPreviewLayout} from './preview-layout.js?v=20261104preview1';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 25;
const CADENCE = 60_000;
const STORAGE_KEY = 'maryland-camera-desk-favorites-v1';
const nf = new Intl.NumberFormat('en-US');
const time = value => new Date(value).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', second:'2-digit'});
const date = value => new Date(value).toLocaleString('en-US', {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const state = {cameras:[], filters:{query:'',metro:'',county:'',road:'',delivery:'',favorites:false,withinMap:false}, favorites:new Set(), page:1, view:'wall', bounds:null, selected:null, catalog:null};
let cameraMap = null;
let sourceNotice = '';
let loaded = false;
let queued = [];
let running = 0;
let searchTimer;
let mapTimer;
let displayedCardIds = '';
const media = new Set();
const dialog = $('camera-dialog');
const preview = $('camera-preview');
const previewLayout = createPreviewLayout({onResize:() => cameraMap?.resize(), onCollapse:collapsed => {
  if (collapsed && videoElement && state.selected) showSnapshot('Live playback stopped while the preview is collapsed. Expand it and select Watch live to resume.');
}});
let returnFocus = null;
let returnCameraId = null;
let videoElement = null;
let hlsPlayer = null;
let playbackTimer = null;
const VIDEO_HOSTS = ['strmr3.sha.maryland.gov','strmr5.sha.maryland.gov','strmr10.sha.maryland.gov'];

function stopVideo() {
  clearTimeout(playbackTimer);
  playbackTimer = null;
  hlsPlayer?.destroy();
  hlsPlayer = null;
  if (videoElement) {
    videoElement.pause();
    videoElement.removeAttribute('src');
    videoElement.load();
    videoElement.remove();
    videoElement = null;
  }
}

function showSnapshot(message = '') {
  stopVideo();
  disposeMedia($('dialog-media'));
  $('dialog-media').replaceChildren();
  $('dialog-play').setAttribute('aria-pressed','false');
  $('dialog-play').disabled = !safeURL(state.selected?.videoUrl,VIDEO_HOSTS) || Boolean(state.selected?.disabled);
  $('dialog-snapshot').setAttribute('aria-pressed','true');
  $('dialog-video-status').textContent = message;
  if (state.selected) attachMedia($('dialog-media'),state.selected,true);
}

function playVideo() {
  const camera = state.selected;
  const url = safeURL(camera?.videoUrl,VIDEO_HOSTS);
  if (!url || camera.disabled) return;
  stopVideo();
  disposeMedia($('dialog-media'));
  const container = $('dialog-media');
  container.replaceChildren();
  container.classList.remove('is-loading','has-error');
  const video = document.createElement('video');
  videoElement = video;
  video.controls = true;
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.crossOrigin = 'anonymous';
  video.setAttribute('aria-label',`Live traffic video: ${camera.name}`);
  container.append(video);
  $('dialog-play').setAttribute('aria-pressed','true');
  $('dialog-snapshot').setAttribute('aria-pressed','false');
  $('dialog-video-status').textContent = 'Connecting to the Maryland CHART video stream…';
  const fail = () => {
    if (videoElement !== video) return;
    showSnapshot('Live video is unavailable right now. Showing the snapshot; you can retry or open Maryland CHART.');
  };
  video.addEventListener('error',fail,{once:true});
  video.addEventListener('playing',() => {
    if (videoElement !== video) return;
    clearTimeout(playbackTimer);
    $('dialog-video-status').textContent = 'Live stream connected · source delays and interruptions are possible.';
  });
  const play = () => video.play().catch(() => {
    if (videoElement !== video) return;
    clearTimeout(playbackTimer);
    $('dialog-video-status').textContent = 'Tap the video play control to start playback.';
  });
  playbackTimer = setTimeout(fail,25_000);
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    play();
  } else if (window.Hls?.isSupported()) {
    const player = new window.Hls({maxBufferLength:15,maxMaxBufferLength:30,backBufferLength:0});
    hlsPlayer = player;
    player.on(window.Hls.Events.ERROR,(_,data) => {if(data.fatal) fail();});
    player.on(window.Hls.Events.MANIFEST_PARSED,play);
    player.loadSource(url);
    player.attachMedia(video);
  } else {
    showSnapshot('This browser cannot play this live stream. Use the snapshot or open Maryland CHART.');
  }
}

function safeURL(value, hosts = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (hosts && !hosts.includes(url.hostname))) return null;
    return url.href;
  } catch {return null;}
}

function announce(message) {
  $('source-note').textContent = message;
}

function saveFavorites() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.favorites])); }
  catch {announce('Saved cameras are available for this visit. Browser storage is unavailable.');}
}

function toggleFavorite(id) {
  const focusWasFavorite = document.activeElement?.classList.contains('favorite-button');
  state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
  saveFavorites();
  render(false);
  if (focusWasFavorite) ([...document.querySelectorAll('.camera-card')].find(card=>card.dataset.cameraId===id)?.querySelector('.favorite-button') || $('favorites-toggle')).focus();
  if (state.selected) updateDialogFavorite();
}

function updateURL() {
  const params = new URLSearchParams();
  for (const key of ['metro','county','road','delivery']) if (state.filters[key]) params.set(key,state.filters[key]);
  if (state.filters.query) params.set('q',state.filters.query);
  if (state.filters.favorites) params.set('saved','1');
  if (state.view !== 'wall') params.set('view',state.view);
  if (state.page > 1) params.set('page',String(state.page));
  if (state.selected) params.set('camera',state.selected.id);
  const suffix = params.toString();
  history.replaceState(null,'',`${location.pathname}${suffix?'?'+suffix:''}`);
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
    if (item.visible && !item.lastLoaded) enqueueImage(item);
  });
}, {rootMargin:'100px'});

function enqueueImage(item, force = false) {
  if (item.disposed || item.pending || (!force && (document.hidden || !item.visible))) return;
  if (item.camera.disabled) {
    item.container.classList.remove('is-loading');
    item.container.classList.add('has-error');
    item.status.textContent = 'Unavailable in source catalog';
    item.message.textContent = 'Maryland CHART has marked this camera unavailable. Check its official page for updates.';
    return;
  }
  if (!safeURL(item.camera.imageUrl,['chart.maryland.gov'])) {
    item.container.classList.remove('is-loading');
    item.status.textContent = 'Snapshot unavailable';
    item.container.classList.add('has-error');
    item.message.textContent = 'Open this camera on Maryland CHART';
    return;
  }
  item.pending = true;
  queued.push(item);
  drainImages();
}

function drainImages() {
  while (running < 4 && queued.length) {
    const item = queued.shift();
    if (item.disposed || document.hidden || (!item.visible && !item.modal)) {item.pending=false;continue;}
    running++;
    const image = new Image();
    image.alt = item.camera.name;
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    const url = new URL(item.camera.imageUrl);
    url.searchParams.set('_',String(Date.now()));
    let complete = false;
    let timer;
    const finish = success => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      item.cancel = null;
      image.onload = image.onerror = null;
      item.pending = false;
      running--;
      if (!item.disposed) {
        item.container.classList.remove('is-loading');
        item.container.classList.toggle('has-error',!success);
        if (success) {
          item.lastLoaded = Date.now();
          item.image?.remove();
          item.image = image;
          item.container.prepend(image);
          item.message.hidden = true;
          item.status.textContent = `Fetched ${time(item.lastLoaded)}`;
        } else {
          item.status.textContent = item.lastLoaded ? `Refresh failed · last fetched ${time(item.lastLoaded)}` : 'Snapshot unavailable';
          item.message.hidden = Boolean(item.lastLoaded);
          item.message.textContent = 'Snapshot unavailable · try refresh or open Maryland CHART';
        }
      }
      drainImages();
    };
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    timer = setTimeout(() => {image.src='';finish(false);},15_000);
    item.cancel = () => {image.src='';finish(false);};
    image.src = url.href;
  }
}

function attachMedia(container,camera,modal = false) {
  const status = document.createElement('span');
  status.className = 'image-status';
  status.textContent = 'Loading snapshot…';
  const message = document.createElement('span');
  message.className = 'image-placeholder';
  message.textContent = 'Connecting to Maryland CHART…';
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
    card.className = 'camera-card';
    card.classList.toggle('is-selected',camera.id===state.selected?.id);
    card.dataset.cameraId = camera.id;
    card.innerHTML = `<header class="card-top"><span class="road-badge">${escape(camera.road)}</span><button class="favorite-button ${saved?'is-saved':''}" type="button" aria-pressed="${saved}" aria-label="${saved?'Unsave':'Save'} ${escape(camera.name)}"><span aria-hidden="true">${saved?'★':'☆'}</span></button></header><button class="card-image" type="button" aria-label="Preview ${escape(camera.name)}"></button><div class="card-content"><button class="camera-name" type="button">${escape(camera.name)}<span aria-hidden="true">↗</span></button><p class="camera-place">${escape(camera.county || camera.region)} · ${escape(camera.metro)}</p><div class="card-bottom"><span class="camera-id">${camera.videoUrl?'Live video + snapshot':'Snapshot'}</span><button class="open-camera" type="button">View camera <span aria-hidden="true">↗</span></button></div></div>`;
    if (camera.disabled || camera.imageStatus === 'unavailable' || camera.imageStatus === 'stale' || camera.videoStatus === 'unavailable') {
      const warning = document.createElement('p');
      warning.className = 'source-warning';
      warning.textContent = camera.disabled ? 'Unavailable in source catalog' : camera.imageStatus === 'unavailable' ? 'Snapshot unavailable at last check' : camera.imageStatus === 'stale' ? 'Older thumbnail at last check · try live video' : 'Video unavailable at last check';
      warning.title = camera.checkedAt ? `Checked ${date(camera.checkedAt)}` : 'Status from saved source catalog';
      card.querySelector('.camera-place').after(warning);
    }
    card.querySelector('.favorite-button').addEventListener('click',() => toggleFavorite(camera.id));
    for (const button of card.querySelectorAll('.card-image,.camera-name,.open-camera')) button.addEventListener('click',event => openCamera(camera.id,{focusPreview:event.detail===0}));
    attachMedia(card.querySelector('.card-image'),camera);
    for (const button of card.querySelectorAll('.card-image,.camera-name,.open-camera')) {
      button.setAttribute('aria-controls','camera-dialog');
      button.setAttribute('aria-expanded',String(camera.id===state.selected?.id));
    }
    if (camera.id===state.selected?.id) card.setAttribute('aria-current','true');
    fragment.append(card);
  }
  grid.append(fragment);
  const nextCardIds = cameras.map(camera => camera.id).join(',');
  if (nextCardIds!==displayedCardIds) grid.parentElement.scrollTop=0;
  displayedCardIds=nextCardIds;
}

function activeFilters() {
  const node = $('active-filters');
  node.replaceChildren();
  const values = [
    ['query',state.filters.query ? `Search: ${state.filters.query}` : ''],
    ['metro',state.filters.metro],['county',state.filters.county],['road',state.filters.road],
    ['delivery',state.filters.delivery==='video'?'Video checked available':state.filters.delivery==='snapshot'?'Snapshot checked available':state.filters.delivery==='unavailable'?'Unavailable at last check':''],
    ['favorites',state.filters.favorites?'Saved cameras':''],['withinMap',state.filters.withinMap?'Within map':'']
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
  $('map-scope').checked = state.filters.withinMap;
  $('favorites-toggle').setAttribute('aria-pressed',String(state.filters.favorites));
  $('favorites-toggle').classList.toggle('active',state.filters.favorites);
}

function render(refit = false) {
  if (!loaded) return;
  for (const [key,label] of [['metro','All metros & regions'],['county','All counties & cities'],['road','All roads']]) fillFacet(key,label);
  const matching = filterCameras(state.cameras,state.filters,state.favorites,state.bounds);
  const pageCount = Math.max(1,Math.ceil(matching.length / PAGE_SIZE));
  state.page = Math.max(1,Math.min(state.page,pageCount));
  const start = (state.page-1)*PAGE_SIZE;
  $('result-count').textContent = nf.format(matching.length);
  $('result-detail').textContent = `${matching.length===1?'camera':'cameras'}${state.filters.metro?' in '+state.filters.metro:' across Maryland'}`;
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
        onBoundsChange:(bounds,change) => {
          state.bounds = bounds;
          if (change?.reason==='resize') return;
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
  previewLayout.refresh();
  updateURL();
}

function updateDialogFavorite() {
  const saved = state.favorites.has(state.selected?.id);
  $('dialog-save').textContent = saved ? '★ Saved camera' : '☆ Save camera';
  $('dialog-save').setAttribute('aria-pressed',String(saved));
}

function updateSelection() {
  for (const card of document.querySelectorAll('.camera-card')) {
    const selected = card.dataset.cameraId===state.selected?.id;
    card.classList.toggle('is-selected',selected);
    if (selected) card.setAttribute('aria-current','true');
    else card.removeAttribute('aria-current');
    for (const button of card.querySelectorAll('.card-image,.camera-name,.open-camera')) button.setAttribute('aria-expanded',String(selected));
  }
  cameraMap?.select(state.selected?.id || null);
}

function revealCameraWorkspace() {
  if (!state.selected) return;
  if (!matchMedia('(max-width: 850px)').matches) {
    const previewRect = preview.getBoundingClientRect();
    if (previewRect.top < 0 || previewRect.bottom > innerHeight) document.querySelector('.results-layout').scrollIntoView({block:'start',behavior:'instant'});
    return;
  }
  const rect = $('map-section').getBoundingClientRect();
  if (rect.top < 0 || rect.top > innerHeight * .3) $('map-section').scrollIntoView({block:'start',behavior:'instant'});
}

function openCamera(id,{focusPreview=false} = {}) {
  const camera = state.cameras.find(camera => camera.id===id);
  if (!camera) return;
  const trigger = document.activeElement;
  if (!preview.contains(trigger)) {returnFocus=trigger;returnCameraId=id;}
  stopVideo();
  disposeMedia($('dialog-media'));
  $('dialog-media').replaceChildren();
  state.selected = camera;
  // Opening from the wall reveals the map without changing the current slice.
  if (state.view==='wall') {state.view='split';render(false);}
  $('dialog-title').textContent = camera.name;
  $('dialog-subtitle').textContent = `${camera.road} · ${camera.county || camera.region} · ${camera.metro}`;
  const url = safeURL(camera.officialUrl,['chart.maryland.gov']) || 'https://chart.maryland.gov/TrafficCameras/GetTrafficCameras';
  $('dialog-source').href = url;
  $('dialog-source').textContent = 'Open official camera ↗';
  $('dialog-status').textContent = (camera.description?camera.description+'. ':'') + (camera.disabled?'Marked unavailable in the dated source catalog. ':camera.imageStatus==='unavailable'?'Unavailable at the dated image check; the source may have recovered. ':'') + (camera.videoStatus==='unavailable'?'Video was unavailable at the last check; you can retry. ':'') + (camera.imageStatus==='stale'?'The thumbnail was older than one hour at the last check. ':'') + 'Fetched time is not capture time. Select Watch live to open the public video stream.';
  updateDialogFavorite();
  preview.hidden = false;
  document.body.classList.add('has-camera-preview');
  previewLayout.expand();
  updateSelection();
  showSnapshot();
  updateURL();
  revealCameraWorkspace();
  // The wall-to-split transition rebuilds its cards; keep keyboard focus usable.
  if (trigger && !trigger.isConnected) {
    const card = [...document.querySelectorAll('.camera-card')].find(card => card.dataset.cameraId===id);
    const replacement = card?.querySelector('.card-image');
    if (!focusPreview) (replacement || $('dialog-close')).focus({preventScroll:true});
    returnFocus = replacement || null;
  }
  if (focusPreview) $('dialog-title').focus({preventScroll:true});
}

function closeCamera({restoreFocus=true} = {}) {
  if (!state.selected) return;
  const focusInPreview = preview.contains(document.activeElement);
  const selectedMarker = document.querySelector('.md-selected');
  stopVideo();
  disposeMedia($('dialog-media'));
  $('dialog-media').replaceChildren();
  state.selected = null;
  preview.hidden = true;
  document.body.classList.remove('has-camera-preview','preview-collapsed');
  updateSelection();
  previewLayout.refresh();
  if (restoreFocus && focusInPreview) {
    if (returnFocus?.isConnected && returnFocus!==document.body) returnFocus.focus({preventScroll:true});
    else ([...document.querySelectorAll('.camera-card')].find(card=>card.dataset.cameraId===returnCameraId)?.querySelector('.card-image') || selectedMarker || $('view-'+state.view)).focus({preventScroll:true});
  }
  returnFocus = null;
  returnCameraId = null;
  updateURL();
  for (const item of media) if (!item.lastLoaded || $('auto-refresh').checked) enqueueImage(item);
}

function refreshImages() {
  for (const item of media) if (item.visible) enqueueImage(item);
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
for (const key of ['metro','county','road','delivery']) $(key).addEventListener('change',() => {
  state.filters[key]=$(key).value;
  // Changing geography starts a fresh slice rather than trapping incompatible roads.
  if (key==='metro') {state.filters.county='';state.filters.road='';}
  if (key==='county') state.filters.road='';
  state.page=1;
  render(true);
});
$('favorites-toggle').addEventListener('click',() => {state.filters.favorites=!state.filters.favorites;state.page=1;render(true);});
function resetFilters() {
  clearTimeout(searchTimer);
  state.filters={query:'',metro:'',county:'',road:'',delivery:'',favorites:false,withinMap:false};
  state.page=1;
  syncInputs();
  render(true);
}
$('reset-filters').addEventListener('click',resetFilters);
$('empty-state').querySelector('button')?.addEventListener('click',resetFilters);
$('refresh-button').addEventListener('click',() => {
  if (!loaded) {loadCatalog();return;}
  refreshImages();
  announce('Refreshing visible snapshots. Fetched time records retrieval, not capture time.');
});
$('auto-refresh').addEventListener('change',() => {
  announce($('auto-refresh').checked ? sourceNotice : 'Automatic refresh paused. Use Refresh snapshots to load current images.');
  if ($('auto-refresh').checked) refreshImages();
});
for (const mode of ['wall','split','map']) $('view-'+mode).addEventListener('click',() => {
  state.view=mode;
  if (mode==='wall') {state.filters.withinMap=false;closeCamera({restoreFocus:false});}
  render(false);
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
$('dialog-play').addEventListener('click',playVideo);
$('dialog-snapshot').addEventListener('click',() => showSnapshot());
$('dialog-close').addEventListener('click',closeCamera);
$('dialog-save').addEventListener('click',() => {if(state.selected)toggleFavorite(state.selected.id);});
document.addEventListener('keydown',event => {
  if (event.key==='Escape' && state.selected && (preview.contains(document.activeElement) || document.activeElement===$('map-divider'))) {
    event.preventDefault();
    closeCamera();
  }
});
matchMedia('(max-width: 850px)').addEventListener('change',event => {
  if (event.matches) requestAnimationFrame(revealCameraWorkspace);
});
document.addEventListener('visibilitychange',() => {
  if (document.hidden && videoElement && state.selected) showSnapshot('Live playback stopped while this tab was hidden. Select Watch live to resume.');
  if (!document.hidden) for (const item of media) if (!item.lastLoaded || $('auto-refresh').checked) enqueueImage(item);
});
setInterval(() => {if($('auto-refresh').checked && !document.hidden)refreshImages();},CADENCE);

async function loadCatalog() {
  try {
    announce('Loading the Maryland camera catalog…');
    const response = await fetch('./camera-catalog.json',{cache:'no-cache'});
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.cameras)||!catalog.cameras.length) throw new Error('Empty catalog');
    state.catalog=catalog;
    state.cameras=prepareCameras(catalog.cameras);
    loaded=true;
    $('catalog-count').textContent=nf.format(state.cameras.length);
    $('metro-count').textContent=nf.format(new Set(state.cameras.map(camera => camera.metro)).size);
    $('catalog-date').textContent=date(catalog.fetchedAt);
    if ($('audit-summary') && catalog.auditCounts) $('audit-summary').textContent=`Source check ${date(catalog.auditCompletedAt)}: ${nf.format(catalog.auditCounts.available||0)} usable snapshots; ${nf.format(catalog.auditCounts.stale||0)} older thumbnails; ${nf.format((catalog.auditCounts.disabled||0)+(catalog.auditCounts.unavailable||0))} unavailable. ${catalog.videoAuditCounts ? `Video playlists: ${nf.format(catalog.videoAuditCounts.available||0)} available; ${nf.format(catalog.videoAuditCounts.unavailable||0)} unavailable. ` : ''}These are dated checks, not a guarantee of current availability or image freshness.`;
    sourceNotice='Snapshots refresh every 60 seconds while visible. Open a camera and select Watch live for video. Thumbnails can lag behind the live feed.';
    announce(sourceNotice);
    const params = new URLSearchParams(location.search);
    for (const key of ['metro','county','road','delivery']) state.filters[key] = params.get(key) || '';
    state.filters.query=params.get('q') || '';
    state.filters.favorites=params.get('saved')==='1';
    state.page=Math.max(1,Math.floor(Number(params.get('page'))||1));
    state.view=['wall','split','map'].includes(params.get('view'))?params.get('view'):'wall';
    try {
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
      if(Array.isArray(saved)) state.favorites=new Set(saved.filter(id => typeof id==='string'));
    } catch { /* Browsing does not require local storage. */ }
    const initialCamera=params.get('camera');
    render(true);
    if (initialCamera) openCamera(initialCamera);
  } catch {
    announce('The camera catalog could not load. Select Refresh snapshots to retry, or visit Maryland CHART.');
    $('empty-state').hidden=false;
    $('result-count').textContent='—';
    $('result-detail').textContent='Catalog unavailable';
  }
}

loadCatalog();
