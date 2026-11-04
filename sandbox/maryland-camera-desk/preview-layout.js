const STORAGE_KEY = 'maryland-camera-desk-map-share-v1';
const DEFAULT_SHARE = 46;

export function createPreviewLayout({onResize = () => {}, onCollapse = () => {}} = {}) {
  const layout = document.querySelector('.results-layout');
  const divider = document.getElementById('map-divider');
  const toggle = document.getElementById('preview-toggle');
  const content = document.getElementById('preview-content');
  const mobile = matchMedia('(max-width: 850px)');
  let share = DEFAULT_SHARE;
  let frame = null;
  let pointer = null;
  let sheetPointer = null;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= 20 && stored <= 80) share = stored;
  } catch { /* Resizing works when browser storage is unavailable. */ }

  function limits() {
    const available = Math.max(620,layout.clientWidth - 12);
    return {min:Math.max(20,300 / available * 100), max:Math.min(80,(available - 320) / available * 100)};
  }

  function save() {
    try {localStorage.setItem(STORAGE_KEY,String(share));} catch { /* Session-only layout. */ }
  }

  function refresh() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const {min,max} = limits();
      const effective = Math.max(min,Math.min(max,share));
      layout.style.setProperty('--map-share',`${effective}%`);
      layout.style.setProperty('--map-width',`${Math.max(0,layout.clientWidth-12) * effective / 100}px`);
      divider.setAttribute('aria-valuemin',String(Math.round(min)));
      divider.setAttribute('aria-valuemax',String(Math.round(max)));
      divider.setAttribute('aria-valuenow',String(Math.round(effective)));
      divider.setAttribute('aria-valuetext',`Map ${Math.round(effective)} percent, cameras ${100-Math.round(effective)} percent`);
      onResize();
    });
  }

  function setShare(value) {
    const {min,max} = limits();
    share = Math.max(min,Math.min(max,value));
    refresh();
  }

  function setCollapsed(collapsed) {
    const next = mobile.matches && collapsed;
    // Move focus before hiding the sheet's controls from keyboard navigation.
    if (next && content.contains(document.activeElement)) toggle.focus({preventScroll:true});
    document.body.classList.toggle('preview-collapsed',next);
    content.hidden = next;
    toggle.setAttribute('aria-expanded',String(!next));
    toggle.setAttribute('aria-label',next?'Expand camera preview':'Collapse camera preview');
    toggle.querySelector('.preview-toggle-label').textContent = next?'Expand':'Collapse';
    onCollapse(next);
    refresh();
  }

  divider.addEventListener('pointerdown',event => {
    if (mobile.matches || event.button!==0) return;
    event.preventDefault();
    pointer = event.pointerId;
    divider.setPointerCapture(pointer);
    divider.focus({preventScroll:true});
    document.body.classList.add('is-resizing-map');
  });
  divider.addEventListener('pointermove',event => {
    if (event.pointerId!==pointer) return;
    const rect = layout.getBoundingClientRect();
    setShare((event.clientX - rect.left - 6) / (rect.width - 12) * 100);
  });
  const finishDrag = event => {
    if (event.pointerId!==pointer) return;
    pointer = null;
    document.body.classList.remove('is-resizing-map');
    save();
  };
  divider.addEventListener('pointerup',finishDrag);
  divider.addEventListener('pointercancel',finishDrag);
  divider.addEventListener('lostpointercapture',finishDrag);
  divider.addEventListener('keydown',event => {
    const {min,max} = limits();
    const value = Number(divider.getAttribute('aria-valuenow')) || share;
    const step = event.shiftKey?10:2;
    const next = {'ArrowLeft':value-step,'ArrowRight':value+step,'Home':min,'End':max};
    if (event.key in next) {
      event.preventDefault();
      setShare(next[event.key]);
      save();
    } else if (event.key==='Enter') {
      event.preventDefault();
      share=DEFAULT_SHARE;
      save();
      refresh();
    }
  });
  const reset = () => {share=DEFAULT_SHARE;save();refresh();};
  divider.addEventListener('dblclick',reset);
  document.getElementById('reset-layout').addEventListener('click',reset);
  toggle.addEventListener('click',() => setCollapsed(!document.body.classList.contains('preview-collapsed')));
  // Only the dedicated sheet handle owns vertical gestures; the map keeps its own touch handlers.
  toggle.addEventListener('pointerdown',event => {
    if (!mobile.matches || event.button!==0) return;
    sheetPointer={id:event.pointerId,y:event.clientY};
    toggle.setPointerCapture(event.pointerId);
  });
  toggle.addEventListener('pointerup',event => {
    if (sheetPointer?.id!==event.pointerId) return;
    const delta = event.clientY-sheetPointer.y;
    sheetPointer=null;
    if (Math.abs(delta)<35) return;
    event.preventDefault();
    setCollapsed(delta>0);
    // A dragged handle should not immediately toggle again via a synthesized click.
    toggle.addEventListener('click',event => {event.preventDefault();event.stopImmediatePropagation();},{once:true,capture:true});
  });
  toggle.addEventListener('pointercancel',() => {sheetPointer=null;});
  mobile.addEventListener('change',() => setCollapsed(false));
  new ResizeObserver(refresh).observe(layout);
  refresh();
  return {refresh,expand:() => setCollapsed(false)};
}
