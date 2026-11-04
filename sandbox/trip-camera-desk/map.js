import {pointAtDistance} from './geometry.js?v=20261104or2';
const START_BOUNDS = [[36.5, -84.7], [41.8, -75.0]];
const STYLE_ID = 'trip-camera-map-styles';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .trip-camera-marker { background: transparent; border: 0; }
    .trip-camera-marker > span { display: grid; place-items: center; box-sizing: border-box;
      width: 100%; height: 100%; border: 2px solid #fff; border-radius: 50%;
      color: #fff; background: #19464c; box-shadow: 0 2px 8px #0c22364d;
      font: 700 12px/1 system-ui, sans-serif; }
    .trip-camera-marker.trip-cluster > span { border-width: 3px; background: #183033; }
    .trip-camera-marker.trip-selected > span { background: #e4b947; color: #112b42; border-color: #112b42; }
    .trip-camera-marker:focus-visible { outline: 3px solid #e4b947; outline-offset: 4px; border-radius: 50%; }
    .trip-camera-map-tooltip { max-width: 270px; white-space: normal; color: #142b40;
      font: 13px/1.45 system-ui, sans-serif; }
    .trip-camera-map-tooltip strong, .trip-camera-map-tooltip small { display: block; }
    .trip-camera-map-status { max-width: min(230px, 58vw); padding: 7px 10px; border-radius: 7px;
      background: #fff; color: #18364d; box-shadow: 0 1px 5px #102b4026;
      font: 12px/1.35 system-ui, sans-serif; }
    .trip-camera-map-choices { max-height: 240px; overflow-y: auto; min-width: 180px; max-width: 260px; }
    .trip-camera-map-choices p { margin: 0 0 8px; font-weight: 700; color: #18364d; }
    .trip-camera-map-choices button { display: block; width: 100%; text-align: left; margin: 5px 0;
      padding: 8px; border: 1px solid #cdd8df; border-radius: 5px; background: #f4f7fa;
      color: #18364d; font: inherit; cursor: pointer; }
    .trip-camera-map-choices button:focus-visible { outline: 3px solid #16a28f; }
  `;
  document.head.append(style);
}

function validCamera(camera) {
  return camera && camera.id != null && camera.lat != null && camera.lon != null &&
    camera.lat !== '' && camera.lon !== '' &&
    Number.isFinite(Number(camera.lat)) && Number.isFinite(Number(camera.lon)) &&
    Math.abs(Number(camera.lat)) <= 90 && Math.abs(Number(camera.lon)) <= 180;
}

export function validWaypoint(point) {
  return point && ['number','string'].includes(typeof point.lat) && ['number','string'].includes(typeof point.lon) &&
    String(point.lat).trim() !== '' && String(point.lon).trim() !== '' &&
    Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon)) &&
    Math.abs(Number(point.lat)) <= 85 && Math.abs(Number(point.lon)) <= 180;
}

function tooltipFor(camera) {
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = camera.name || 'Traffic camera';
  content.append(title);
  const details = [camera.road, camera.county].filter(Boolean);
  if (details.length) {
    const detail = document.createElement('small');
    detail.textContent = details.join(' · ');
    content.append(detail);
  }
  return content;
}

/**
 * Camera shape: { id, name, lat, lon, road, county, metro }.
 * update() never changes the viewport; call fit() explicitly after filtering.
 */
export function createCameraMap(element, { onSelect, onBoundsChange, onPick, onRoute } = {}) {
  const L = window.L;
  if (!L) throw new Error('The camera map requires Leaflet to be loaded first.');
  if (!element) throw new Error('A map container is required.');
  installStyles();

  const map = L.map(element, {
    minZoom: 3,
    maxZoom: 19,
    scrollWheelZoom: false,
    keyboard: true,
    zoomControl: true,
    preferCanvas: true,
  });
  element.setAttribute('aria-label', 'Trip Camera Desk map. Use arrow keys to pan and plus or minus to zoom.');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.fitBounds(START_BOUNDS, { padding: [18, 18], animate: false });

  const markers = L.layerGroup().addTo(map);
  const routeLayers=L.layerGroup().addTo(map);
  const waypointLayers=L.layerGroup().addTo(map);
  let activeRoute=null, routeList=[], routePoints=[], pickTarget=null, cursor=null;
  element.addEventListener('click',event=>{
    if(pickTarget===null||event.target.closest('.leaflet-control'))return;
    const point=map.mouseEventToLatLng(event),target=pickTarget;pickTarget=null;element.classList.remove('is-picking');
    event.preventDefault();event.stopImmediatePropagation();
    onPick?.(target,{lat:point.lat,lon:point.lng,name:`Map point (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`});
  },true);
  map.on('click',event=>{if(pickTarget!==null){const target=pickTarget;pickTarget=null;element.classList.remove('is-picking');onPick?.(target,{lat:event.latlng.lat,lon:event.latlng.lng,name:`Map point (${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)})`});}});
  function drawRoutes(gaps=[]){
    routeLayers.clearLayers();waypointLayers.clearLayers();
    for(const route of [...routeList].sort((a,b)=>Number(a.id===activeRoute?.id)-Number(b.id===activeRoute?.id))){
      const active=route.id===activeRoute?.id;
      L.polyline(route.coordinates.map(p=>[p[1],p[0]]),{color:active?'#14796f':'#627a80',weight:active?6:4,opacity:active?.92:.5}).on('click',()=>onRoute?.(route.id)).addTo(routeLayers);
    }
    if(activeRoute)for(const gap of gaps){
      const start=gap.startMeters??gap.start??0,end=gap.endMeters??gap.end??0;
      const samples=[];for(let d=start;d<end;d+=Math.max(500,(end-start)/80)){const p=pointAtDistance(activeRoute,d);samples.push([p.lat,p.lon]);}
      const p=pointAtDistance(activeRoute,end);samples.push([p.lat,p.lon]);
      L.polyline(samples,{color:'#a64d3e',weight:4,opacity:.9,dashArray:'6 7',interactive:false}).addTo(routeLayers);
    }
    routePoints.forEach((point,index)=>{if(!validWaypoint(point))return;
      const marker=L.marker([Number(point.lat),Number(point.lon)],{icon:L.divIcon({className:'trip-waypoint',html:`<span>${index===0?'A':index===routePoints.length-1?'B':index}</span>`,iconSize:[28,28],iconAnchor:[14,14]}),title:point.name,keyboard:true}).addTo(waypointLayers);
      const label=document.createElement('span');label.textContent=point.name;marker.bindTooltip(label);
    });
  }

  const statusControl = L.control({ position: 'topright' });
  const status = document.createElement('div');
  status.className = 'trip-camera-map-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Loading camera views…';
  statusControl.onAdd = () => {
    L.DomEvent.disableClickPropagation(status);
    return status;
  };
  statusControl.addTo(map);

  let cameras = [];
  let selectedId = null;
  let frame = null;
  let destroyed = false;

  const select = (id) => {
    if (!destroyed && typeof onSelect === 'function') onSelect(id);
  };

  function showChoices(group, latlng) {
    const content = document.createElement('div');
    content.className = 'trip-camera-map-choices';
    const heading = document.createElement('p');
    heading.textContent = `${group.length} cameras here`;
    content.append(heading);
    for (const camera of group) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = camera.name || 'Traffic camera';
      button.addEventListener('click', () => {
        map.closePopup();
        select(camera.id);
      });
      content.append(button);
    }
    L.popup({ maxWidth: 290 }).setLatLng(latlng).setContent(content).openOn(map);
  }

  function render() {
    frame = null;
    if (destroyed) return;
    markers.clearLayers();
    const bounds = map.getBounds().pad(0.18);
    const zoom = map.getZoom();
    const gridSize = zoom < 10 ? 64 : zoom < 14 ? 48 : 36;
    const groups = new Map();
    for (const camera of cameras) {
      const latlng = L.latLng(Number(camera.lat), Number(camera.lon));
      if (!bounds.contains(latlng)) continue;
      const point = map.project(latlng, zoom);
      const cell = `${Math.floor(point.x / gridSize)}:${Math.floor(point.y / gridSize)}`;
      if (!groups.has(cell)) groups.set(cell, []);
      groups.get(cell).push(camera);
    }

    for (const group of groups.values()) {
      const cluster = group.length > 1;
      const selected = selectedId != null && group.some(camera => String(camera.id) === String(selectedId));
      const center = L.latLng(
        group.reduce((sum, camera) => sum + Number(camera.lat), 0) / group.length,
        group.reduce((sum, camera) => sum + Number(camera.lon), 0) / group.length,
      );
      const size = cluster ? (group.length > 99 ? 44 : 38) : 24;
      const label = cluster
        ? `${group.length} traffic cameras. Activate to zoom in or choose a camera.`
        : `${group[0].name || 'Traffic camera'}. Activate to view feed.`;
      const marker = L.marker(center, {
        title: label,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : 0,
        icon: L.divIcon({
          className: `trip-camera-marker${cluster ? ' trip-cluster' : ''}${selected ? ' trip-selected' : ''}`,
          html: `<span aria-hidden="true">${cluster ? group.length : '●'}</span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
      });

      const activate = () => {
        if (!cluster) {
          select(group[0].id);
          return;
        }
        const clusterBounds = L.latLngBounds(group.map(camera => [Number(camera.lat), Number(camera.lon)]));
        const spread = clusterBounds.getSouthWest().distanceTo(clusterBounds.getNorthEast());
        if (zoom >= 17 || spread < 30) {
          showChoices(group, center);
        } else {
          map.fitBounds(clusterBounds, { padding: [55, 55], maxZoom: Math.min(zoom + 3, 18) });
        }
      };
      marker.on('click', activate);
      marker.on('add', () => {
        const icon = marker.getElement();
        if (!icon) return;
        icon.setAttribute('role', 'button');
        icon.setAttribute('aria-label', label);
        if (selected) icon.setAttribute('aria-current', 'true');
        // Leaflet already activates focused markers with Enter; add Space support.
        icon.addEventListener('keydown', event => {
          if (event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            activate();
          }
        });
      });
      const tooltip = cluster ? document.createElement('span') : tooltipFor(group[0]);
      if (cluster) tooltip.textContent = `${group.length} cameras · select to explore`;
      marker.bindTooltip(tooltip, { direction: 'top', className: 'trip-camera-map-tooltip' });
      marker.addTo(markers);
    }

    const count = cameras.length;
    const message = count === 0
      ? 'No camera views match these filters.'
      : groups.size === 0
        ? `${count.toLocaleString()} camera views outside this view. Pan or zoom out to find them.`
        : `${count.toLocaleString()} camera ${count === 1 ? 'view' : 'views'} · select a marker to explore`;
    if (status.textContent !== message) status.textContent = message;
  }

  function scheduleRender() {
    if (!destroyed && frame === null) frame = requestAnimationFrame(render);
  }

  function reportBounds() {
    if (destroyed) return;
    scheduleRender();
    if (typeof onBoundsChange === 'function') {
      const bounds = map.getBounds();
      onBoundsChange({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      });
    }
  }
  map.on('moveend', reportBounds);
  map.on('zoomend', scheduleRender);
  // Report the starting viewport after the caller has received this controller.
  queueMicrotask(reportBounds);

  return {
    update(nextCameras, nextSelectedId = null) {
      if (destroyed) return;
      cameras = Array.isArray(nextCameras) ? nextCameras.filter(validCamera) : [];
      selectedId = nextSelectedId;
      scheduleRender();
    },
    fit() {
      if (destroyed) return;
      map.stop();
      map.invalidateSize({ pan: false });
      const bounds = cameras.length
        ? L.latLngBounds(cameras.map(camera => [Number(camera.lat), Number(camera.lon)]))
        : L.latLngBounds(START_BOUNDS);
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14, animate: false });
      scheduleRender();
    },
    resize() {
      if (destroyed) return;
      map.invalidateSize({ pan: false });
      scheduleRender();
    },
    setRoutes(routes, selectedRoute, points=[], gaps=[]) {
      routeList=routes||[];activeRoute=selectedRoute;routePoints=Array.isArray(points)?points:[];drawRoutes(gaps);
    },
    setPoints(points=[]) {routePoints=Array.isArray(points)?points:[];drawRoutes();},
    fitRoute() {
      map.invalidateSize({pan:false});
      if(activeRoute?.coordinates?.length)map.fitBounds(L.latLngBounds(activeRoute.coordinates.map(p=>[p[1],p[0]])),{padding:[30,30],maxZoom:14,animate:false});else this.fit();
    },
    pick(target) {pickTarget=target;element.classList.add('is-picking');map.closePopup();},
    cancelPick() {pickTarget=null;element.classList.remove('is-picking');},
    setCursor(distanceMeters) {
      if(cursor){map.removeLayer(cursor);cursor=null;}
      if(activeRoute&&Number.isFinite(distanceMeters)){
        const p=pointAtDistance(activeRoute,distanceMeters);cursor=L.circleMarker([p.lat,p.lon],{radius:9,color:'#172d32',weight:3,fillColor:'#e5df8b',fillOpacity:1}).addTo(map);
      }
    },
    focus(camera) {if(validCamera(camera)){selectedId=camera.id;map.setView([camera.lat,camera.lon],Math.max(13,map.getZoom()),{animate:false});scheduleRender();}},
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      map.off('moveend', reportBounds);
      map.off('zoomend', scheduleRender);
      map.remove();
    },
  };
}
