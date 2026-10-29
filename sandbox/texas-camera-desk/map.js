const TX_BOUNDS = [[25.8, -106.7], [36.6, -93.4]];
const STYLE_ID = 'tx-camera-map-styles';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .tx-camera-marker { background: transparent; border: 0; }
    .tx-camera-marker > span { display: grid; place-items: center; box-sizing: border-box;
      width: 100%; height: 100%; border: 2px solid #fff; border-radius: 50%;
      color: #fff; background: #b65024; box-shadow: 0 2px 8px #0c22364d;
      font: 700 12px/1 system-ui, sans-serif; }
    .tx-camera-marker.tx-cluster > span { border-width: 3px; background: #18232b; }
    .tx-camera-marker.tx-selected > span { background: #ed8c58; color: #112b42; border-color: #112b42; }
    .tx-camera-marker:focus-visible { outline: 3px solid #ed8c58; outline-offset: 4px; border-radius: 50%; }
    .tx-camera-map-tooltip { max-width: 270px; white-space: normal; color: #142b40;
      font: 13px/1.45 system-ui, sans-serif; }
    .tx-camera-map-tooltip strong, .tx-camera-map-tooltip small { display: block; }
    .tx-camera-map-status { max-width: min(230px, 58vw); padding: 7px 10px; border-radius: 7px;
      background: #fff; color: #18364d; box-shadow: 0 1px 5px #102b4026;
      font: 12px/1.35 system-ui, sans-serif; }
    .tx-camera-map-choices { max-height: 240px; overflow-y: auto; min-width: 180px; max-width: 260px; }
    .tx-camera-map-choices p { margin: 0 0 8px; font-weight: 700; color: #18364d; }
    .tx-camera-map-choices button { display: block; width: 100%; text-align: left; margin: 5px 0;
      padding: 8px; border: 1px solid #cdd8df; border-radius: 5px; background: #f4f7fa;
      color: #18364d; font: inherit; cursor: pointer; }
    .tx-camera-map-choices button:focus-visible { outline: 3px solid #d8a529; }
  `;
  document.head.append(style);
}

function validCamera(camera) {
  return camera && camera.id != null && camera.lat != null && camera.lon != null &&
    camera.lat !== '' && camera.lon !== '' &&
    Number.isFinite(Number(camera.lat)) && Number.isFinite(Number(camera.lon)) &&
    Math.abs(Number(camera.lat)) <= 90 && Math.abs(Number(camera.lon)) <= 180;
}

function tooltipFor(camera) {
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = camera.name || 'Traffic camera';
  content.append(title);
  const details = [camera.road, camera.county && `${camera.county} County`].filter(Boolean);
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
export function createCameraMap(element, { onSelect, onBoundsChange } = {}) {
  const L = window.L;
  if (!L) throw new Error('The camera map requires Leaflet to be loaded first.');
  if (!element) throw new Error('A map container is required.');
  installStyles();

  const map = L.map(element, {
    minZoom: 4,
    maxZoom: 19,
    scrollWheelZoom: false,
    keyboard: true,
    zoomControl: true,
    preferCanvas: true,
  });
  element.setAttribute('aria-label', 'Texas traffic camera map. Use arrow keys to pan and plus or minus to zoom.');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.fitBounds(TX_BOUNDS, { padding: [18, 18], animate: false });

  const markers = L.layerGroup().addTo(map);
  const statusControl = L.control({ position: 'topright' });
  const status = document.createElement('div');
  status.className = 'tx-camera-map-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Loading camera locations…';
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
    content.className = 'tx-camera-map-choices';
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
          className: `tx-camera-marker${cluster ? ' tx-cluster' : ''}${selected ? ' tx-selected' : ''}`,
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
      marker.bindTooltip(tooltip, { direction: 'top', className: 'tx-camera-map-tooltip' });
      marker.addTo(markers);
    }

    const count = cameras.length;
    const message = count === 0
      ? 'No camera locations match these filters.'
      : groups.size === 0
        ? `${count.toLocaleString()} camera locations outside this view. Pan or zoom out to find them.`
        : `${count.toLocaleString()} camera ${count === 1 ? 'location' : 'locations'} · select a marker to explore`;
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
      map.invalidateSize({ pan: false });
      const bounds = cameras.length
        ? L.latLngBounds(cameras.map(camera => [Number(camera.lat), Number(camera.lon)]))
        : L.latLngBounds(TX_BOUNDS);
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
      scheduleRender();
    },
    resize() {
      if (destroyed) return;
      map.invalidateSize({ pan: false });
      scheduleRender();
    },
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
