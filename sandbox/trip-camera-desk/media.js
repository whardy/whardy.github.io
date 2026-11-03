const safeURL=value=>{try{const url=new URL(value);return url.protocol==='https:'?url:null;}catch{return null;}};
const clock=value=>new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
export function createMediaManager({onChange=()=>{},onMessage=()=>{}}={}){
  const items=new Set(),players=new Set();let queue=[],running=0,auto=true,limit=matchMedia('(max-width:700px)').matches?1:2;
  const videoObserver=new IntersectionObserver(entries=>{for(const entry of entries){const player=[...players].find(p=>p.container===entry.target);if(!player)continue;if(entry.isIntersecting)player.seen=true;else if(player.seen)player.stop('Video stopped offscreen · choose Watch live to resume');}},{threshold:0});
  function status(item,message){if(item.status)item.status.textContent=message;}
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){const item=entry.target._tripMedia;if(!item||item.disposed)continue;item.visible=entry.isIntersecting;
      if(item.visible&&!item.lastLoaded)enqueue(item);
      if(!item.visible&&item.player){item.player.stop();status(item,'Video stopped offscreen · choose Watch live to resume');}
    }
  },{rootMargin:'80px'});
  function enqueue(item,force=false){
    if(item.disposed||item.pending||document.hidden||item.player||(!force&&!item.visible)||!item.camera.imageUrl||item.camera.disabled)return;
    item.pending=true;queue.push(item);drain();
  }
  function drain(){
    while(running<4&&queue.length){const item=queue.shift();
      if(item.disposed||document.hidden||!item.visible||item.player){item.pending=false;continue;}
      const url=safeURL(item.camera.imageUrl);if(!url){item.pending=false;continue;}
      running++;const image=new Image();let finished=false,timer;
      image.alt=`Traffic view: ${item.camera.name}`;image.decoding='async';image.referrerPolicy='no-referrer';
      const finish=success=>{
        if(finished)return;finished=true;clearTimeout(timer);image.onload=image.onerror=null;item.pending=false;item.cancel=null;running--;
        if(!item.disposed&&!item.player){
          item.container.classList.remove('is-loading');
          if(success){item.image?.remove();item.image=image;item.container.prepend(image);item.lastLoaded=Date.now();item.placeholder.hidden=true;status(item,`Fetched ${clock(item.lastLoaded)}`);}
          else {status(item,item.lastLoaded?`Refresh failed · fetched ${clock(item.lastLoaded)}`:'Snapshot unavailable');item.placeholder.textContent='Try Refresh or open the official viewer';item.placeholder.hidden=!!item.lastLoaded;}
        }
        drain();
      };
      image.onload=()=>finish(image.naturalWidth>0);image.onerror=()=>finish(false);
      item.cancel=()=>{image.src='';finish(false);};timer=setTimeout(item.cancel,18000);
      url.searchParams.set('_',String(Date.now()));image.src=url.href;
    }
  }
  function snapshot(container,camera){
    dispose(container);container.replaceChildren();container.classList.add('camera-media');
    const placeholder=document.createElement('span');placeholder.className='media-placeholder';
    placeholder.textContent=camera.imageUrl?'Loading snapshot…':camera.videoUrl?'Choose Watch live to start this video':'Open the official viewer for this camera';
    const label=document.createElement('span');label.className='media-time';label.textContent=camera.imageUrl?'Waiting for visible view':camera.videoUrl?'Live video available':'Official viewer';
    container.append(placeholder,label);
    const item={container,camera,placeholder,status:label,visible:false,lastLoaded:0,pending:false,disposed:false,player:null};
    if(camera.disabled){placeholder.textContent='Unavailable in provider catalog';label.textContent='Check official viewer';}
    container._tripMedia=item;items.add(item);observer.observe(container);return item;
  }
  function dispose(container){
    const removed=[...items].filter(item=>item.container===container||container.contains(item.container));
    for(const item of removed){item.disposed=true;observer.unobserve(item.container);items.delete(item);delete item.container._tripMedia;}
    queue=queue.filter(item=>!item.disposed);
    for(const item of removed){item.player?.stop();item.cancel?.();}
    for(const player of [...players])if(player.container===container||container.contains(player.container))player.stop();
    queue=queue.filter(item=>!item.disposed);
  }
  function play(container,camera,{onStatus=()=>{},onEnd=()=>{}}={}){
    const nativeSupport=document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
    const native=!!nativeSupport&&(!window.Hls?.isSupported()||/iPad|iPhone|iPod/.test(navigator.userAgent));
    const source=safeURL(native?(camera.iosVideoUrl||camera.videoUrl):camera.videoUrl);
    if(!source||camera.disabled){onMessage('This camera has no playable public video.');return null;}
    if(players.size>=limit){onMessage(`The live limit is ${limit}. Stop a video or change Live slots first.`);return null;}
    dispose(container);container.replaceChildren();delete container.dataset.mediaError;container.classList.add('camera-media');
    const video=document.createElement('video');video.controls=true;video.playsInline=true;video.muted=true;video.autoplay=true;video.crossOrigin='anonymous';video.preload='none';video.setAttribute('aria-label',`Live video: ${camera.name}`);
    const label=document.createElement('span');label.className='media-time';label.textContent='Connecting…';container.append(video,label);
    let hls=null,timer,stopped=false;
    const player={container,camera,video,seen:false,stop(message='Video stopped'){
      if(stopped)return;stopped=true;clearTimeout(timer);videoObserver.unobserve(container);hls?.destroy();video.pause();video.removeAttribute('src');video.load();video.remove();label.textContent=message;players.delete(player);onChange(players.size);onEnd(message);
    }};
    players.add(player);videoObserver.observe(container);onChange(players.size);
    const fail=()=>{if(stopped)return;container.dataset.mediaError=video.error?`${video.error.code}: ${video.error.message}`:container.dataset.mediaError||'HLS connection error';player.stop('Live video failed · snapshot fallback');snapshot(container,camera);onStatus('Live video is unavailable. Showing a snapshot where available; retry or open the official viewer.');};
    video.addEventListener('error',fail,{once:true});
    video.addEventListener('playing',()=>{clearTimeout(timer);label.textContent='LIVE · source delay varies';onStatus('Live video connected. Separate feeds are not synchronized.');});
    const attempt=()=>video.play().catch(()=>{if(stopped)return;clearTimeout(timer);label.textContent='Tap the video play control';onStatus('Tap the native video play control to begin.');});
    timer=setTimeout(fail,30000);
    if(native){video.src=source.href;attempt();}
    else if(window.Hls?.isSupported()){
      hls=new window.Hls({maxBufferLength:12,maxMaxBufferLength:24,backBufferLength:0});
      hls.on(window.Hls.Events.MANIFEST_PARSED,attempt);hls.on(window.Hls.Events.ERROR,(_,data)=>{if(data.fatal){container.dataset.mediaError=data.details||data.type;fail();}});hls.loadSource(source.href);hls.attachMedia(video);
    }else fail();
    return stopped?null:player;
  }
  function stopAll(message='Video stopped'){for(const player of [...players])player.stop(message);}
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stopAll('Video stopped while tab was hidden');for(const item of items)item.cancel?.();queue.forEach(item=>item.pending=false);queue=[];}
    else if(auto)for(const item of items)if(item.visible)enqueue(item);
  });
  setInterval(()=>{if(auto&&!document.hidden)for(const item of items)if(item.visible)enqueue(item);},60000);
  return {snapshot,play,dispose,stopAll,setAuto(value){auto=!!value;},refresh(){for(const item of items)if(item.visible)enqueue(item,true);},setLimit(value){limit=[1,2,4].includes(Number(value))?Number(value):2;while(players.size>limit)[...players].at(-1).stop('Stopped after changing live limit');},get count(){return players.size;},get limit(){return limit;},debug(){return {snapshots:items.size,queued:queue.length,running,videos:players.size,visible:[...items].filter(i=>i.visible).length};}};
}
