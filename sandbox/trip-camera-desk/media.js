const safeURL=value=>{try{const url=new URL(value);return url.protocol==='https:'?url:null;}catch{return null;}};
const captureLabel=camera=>{if(!['OR','WA','FL'].includes(camera.state))return '';const value=camera.state==='FL'?camera.sourceCaptureTime:camera.sourceTimestamp;if(!value||!Number.isFinite(Date.parse(value)))return ' · capture time unknown';try{return ` · captured ${new Date(value).toLocaleString('en-US',camera.timezone?{timeZone:camera.timezone,timeZoneName:'short'}:undefined)}`;}catch{return ' · capture time unknown';}};
const clock=value=>new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
export function createMediaManager({onChange=()=>{},onMessage=()=>{},autoplayWV=true,autoplayCA=true,autoplayNV=true,autoplayFL=true}={}){
  const items=new Set(),players=new Set();let queue=[],running=0,auto=true,limit=matchMedia('(max-width:700px)').matches?1:2,autoplayScope=null,autoScheduled=false;
  const stateAutoplay=state=>state==='WV'?autoplayWV:state==='CA'?autoplayCA:state==='NV'?autoplayNV:state==='FL'?autoplayFL:false;
  const inlineVideo=camera=>['WV','CA','NV','FL'].includes(camera.state);
  const snapshotInterval=camera=>Math.max(60,Number(camera.snapshotUpdateSeconds)||60)*1000;
  function eligible(item){return stateAutoplay(item.camera.state)&&item.autoplay&&!(['CA','NV','FL'].includes(item.camera.state)&&item.camera.videoStatus==='unavailable')&&(item.camera.state!=='FL'||item.camera.videoStatus==='available'&&item.camera.videoAutoplayAllowed!==false)&&item.camera.videoUrl&&!item.camera.disabled&&item.visible&&!item.disposed&&!item.blocked&&!item.suspended&&(!autoplayScope||autoplayScope.contains(item.container));}
  function scheduleAutoplay(){
    if(autoScheduled)return;autoScheduled=true;
    queueMicrotask(()=>{autoScheduled=false;if(document.hidden||(!autoplayWV&&!autoplayCA&&!autoplayNV&&!autoplayFL))return;
      for(const item of items){
        if(players.size>=limit)break;
        if(!eligible(item)||item.player||[...players].some(player=>player.camera.id===item.camera.id))continue;
        play(item.container,item.camera,{autoItem:item,onStatus:message=>item.onStatus?.(message),onEnd:message=>item.onEnd?.(message)});
      }
    });
  }
  function restorePreview(item,message){
    if(item.disposed)return;
    const placeholder=document.createElement('span');placeholder.className='media-placeholder';placeholder.textContent=message;
    const label=document.createElement('span');label.className='media-time';label.textContent=`${item.camera.state} live view`;
    item.container.replaceChildren(placeholder,label);item.placeholder=placeholder;item.status=label;
    if(item.image){item.container.prepend(item.image);placeholder.hidden=true;label.textContent=`Snapshot fetched ${clock(item.lastLoaded)}`;}
    else if(item.camera.imageUrl&&item.visible&&!item.suspended)enqueue(item);
  }
  const videoObserver=new IntersectionObserver(entries=>{for(const entry of entries){const player=[...players].find(p=>p.container===entry.target);if(!player||player.autoItem)continue;if(entry.isIntersecting)player.seen=true;else if(player.seen)player.stop('Video stopped offscreen · choose Watch live to resume');}},{threshold:0});
  function status(item,message){if(item.status)item.status.textContent=message;}
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){const item=entry.target._tripMedia;if(!item||item.disposed)continue;item.visible=entry.isIntersecting;
      if(item.visible){item.suspended=false;if(!item.lastLoaded)enqueue(item);}
      if(!item.visible){item.cancel?.();if(!item.lastLoaded)item.lastAttempt=0;}
      if(!item.visible&&item.player)item.player.stop('Video stopped offscreen · returns automatically when visible');
    }
    scheduleAutoplay();
  },{rootMargin:'0px'});
  function enqueue(item,force=false){
    if(item.disposed||item.pending||document.hidden||item.player||(!force&&!item.visible)||(!force&&item.lastAttempt&&Date.now()-item.lastAttempt<snapshotInterval(item.camera))||!item.camera.imageUrl||item.camera.disabled)return;
    item.pending=true;item.forceRefresh=force;queue.push(item);drain();
  }
  function drain(){
    while(running<4&&queue.length){const item=queue.shift();
      if(item.disposed||document.hidden||!item.visible||item.player){item.pending=false;continue;}
      const url=safeURL(item.camera.imageUrl);if(!url){item.pending=false;continue;}
      running++;item.lastAttempt=Date.now();const image=new Image();let finished=false,timer;
      image.alt=`Traffic view: ${item.camera.name}`;image.decoding='async';if(item.camera.referrerPolicy)image.referrerPolicy=item.camera.referrerPolicy;else if(item.camera.state!=='FL')image.referrerPolicy='no-referrer';
      const finish=success=>{
        if(finished)return;finished=true;clearTimeout(timer);image.onload=image.onerror=null;item.pending=false;item.cancel=null;running--;
        if(!item.disposed&&!item.player){
          item.container.classList.remove('is-loading');
          if(success){item.image?.remove();item.image=image;item.container.prepend(image);item.lastLoaded=Date.now();item.placeholder.hidden=true;status(item,`Fetched ${clock(item.lastLoaded)}${captureLabel(item.camera)}`);}
          else {status(item,item.lastLoaded?`Refresh failed · fetched ${clock(item.lastLoaded)}`:'Snapshot unavailable');item.placeholder.textContent='Try Refresh or open the official viewer';item.placeholder.hidden=!!item.lastLoaded;}
        }
        drain();
      };
      image.onload=()=>finish(image.naturalWidth>0);image.onerror=()=>finish(false);
      item.cancel=()=>{image.src='';finish(false);};timer=setTimeout(item.cancel,18000);
      if(item.camera.state!=='FL'||item.camera.snapshotCacheBustAllowed===true)url.searchParams.set('_',String(item.forceRefresh?Date.now():Math.floor(Date.now()/snapshotInterval(item.camera))));image.src=url.href;
    }
  }
  function snapshot(container,camera,{autoplay=true,onPlay=()=>{},onEnd=()=>{},onStatus=()=>{}}={}){
    dispose(container);container.replaceChildren();container.classList.add('camera-media');
    const placeholder=document.createElement('span');placeholder.className='media-placeholder';
    placeholder.textContent=camera.imageUrl?'Loading snapshot…':camera.videoUrl?'Choose Watch live to start this video':'Open the official viewer for this camera';
    const label=document.createElement('span');label.className='media-time';label.textContent=camera.imageUrl?'Waiting for visible view':camera.videoUrl?'Live video available':'Official viewer';
    container.append(placeholder,label);
    const item={container,camera,placeholder,status:label,visible:false,lastLoaded:0,lastAttempt:0,pending:false,disposed:false,player:null,autoplay,blocked:false,suspended:false,onPlay,onEnd,onStatus};
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
  function play(container,camera,{onStatus=()=>{},onEnd=()=>{},autoItem=null}={}){
    const nativeSupport=document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
    const native=!!nativeSupport&&(!window.Hls?.isSupported()||/iPad|iPhone|iPod/.test(navigator.userAgent));
    const source=safeURL(native?(camera.iosVideoUrl||camera.videoUrl):camera.videoUrl);
    if(!source||camera.disabled){onMessage('This camera has no playable public video.');return null;}
    if(!autoItem)for(const player of [...players])if(player.camera.id===camera.id)player.stop('Playing in the selected view');
    if(!autoItem&&players.size>=limit)[...players].find(player=>player.autoItem)?.stop('Waiting for a free video slot');
    if(players.size>=limit){if(!autoItem)onMessage(`The live limit is ${limit}. Stop a video or change Live slots first.`);return null;}
    if(camera.state==='FL'){
      const providerCap=Number.isFinite(Number(camera.maxSimultaneousStreams))&&Number(camera.maxSimultaneousStreams)>0?Math.min(4,Math.floor(Number(camera.maxSimultaneousStreams))):2;
      const floridaCap=Math.min(providerCap,matchMedia('(max-width:700px)').matches?1:4);
      const floridaCount=[...players].filter(player=>player.camera.state==='FL').length;
      const providerCount=[...players].filter(player=>player.camera.state==='FL'&&player.camera.providerKey===camera.providerKey).length;
      if(floridaCount>=2&&camera.videoStatus!=='available'){if(!autoItem)onMessage('Additional Florida streams require verified playback. Stop a feed to continue.');return null;}
      if(providerCount>=floridaCap){if(!autoItem)onMessage(`This Florida provider allows ${floridaCap} simultaneous stream${floridaCap===1?'':'s'} here. Stop another feed to start this one.`);return null;}
    }
    if(autoItem)autoItem.cancel?.();else dispose(container);
    container.replaceChildren();delete container.dataset.mediaError;container.classList.add('camera-media');
    const video=document.createElement('video');video.controls=!inlineVideo(camera);video.playsInline=true;video.muted=true;video.defaultMuted=true;video.autoplay=true;if(camera.state!=='FL'||!native||camera.videoCrossOrigin==='anonymous')video.crossOrigin='anonymous';video.preload='none';video.setAttribute('muted','');video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.setAttribute('autoplay','');video.setAttribute('aria-label',`Live traffic video: ${camera.name}`);
    if(inlineVideo(camera)){video.disablePictureInPicture=true;video.disableRemotePlayback=true;video.classList.add(`${camera.state.toLowerCase()}-inline-video`);}
    const label=document.createElement('span');label.className='media-time';label.textContent='Connecting…';container.append(video,label);
    let hls=null,timer,stopped=false;
    const player={container,camera,video,autoItem,seen:false,stop(message='Video stopped'){
      if(stopped)return;stopped=true;clearTimeout(timer);videoObserver.unobserve(container);hls?.destroy();video.pause();video.removeAttribute('src');video.load();video.remove();label.textContent=message;players.delete(player);
      if(autoItem){autoItem.player=null;restorePreview(autoItem,message);}
      onChange(players.size);onEnd(message);scheduleAutoplay();
    }};
    players.add(player);if(autoItem){autoItem.player=player;autoItem.onPlay(player);}else videoObserver.observe(container);onChange(players.size);
    const fail=()=>{if(stopped)return;container.dataset.mediaError=video.error?`${video.error.code}: ${video.error.message}`:container.dataset.mediaError||'HLS connection error';if(autoItem)autoItem.blocked=true;player.stop('Feed unavailable · choose Watch live to retry');if(!autoItem)snapshot(container,camera,{autoplay:false});onStatus('Live video is unavailable. Showing a snapshot where available; retry or open the official viewer.');};
    video.addEventListener('error',fail,{once:true});
    video.addEventListener('playing',()=>{if(stopped)return;clearTimeout(timer);label.textContent='LIVE · source delay varies';onStatus('Live video connected. Separate feeds are not synchronized.');});
    const attempt=()=>video.play().catch(()=>{if(stopped)return;clearTimeout(timer);if(inlineVideo(camera)){if(autoItem)autoItem.blocked=true;player.stop('Autoplay needs a tap · choose Watch live');onStatus('Your browser paused autoplay. Choose Watch live to start the muted inline feed.');}else{label.textContent='Tap the video play control';onStatus('Tap the native video play control to begin.');}});
    timer=setTimeout(fail,30000);
    if(native){video.src=source.href;attempt();}
    else if(window.Hls?.isSupported()){
      hls=new window.Hls({maxBufferLength:12,maxMaxBufferLength:24,backBufferLength:0});
      hls.on(window.Hls.Events.MANIFEST_PARSED,attempt);hls.on(window.Hls.Events.ERROR,(_,data)=>{if(data.fatal){container.dataset.mediaError=data.details||data.type;fail();}});hls.loadSource(source.href);hls.attachMedia(video);
    }else fail();
    return stopped?null:player;
  }
  function stopAll(message='Video stopped'){for(const item of items)item.suspended=true;for(const player of [...players])player.stop(message);}
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stopAll('Video stopped while tab was hidden');for(const item of items){item.cancel?.();if(!item.lastLoaded)item.lastAttempt=0;}queue.forEach(item=>item.pending=false);queue=[];}
    else {for(const item of items){item.suspended=false;if(auto&&item.visible)enqueue(item);}scheduleAutoplay();}
  });
  setInterval(()=>{if(auto&&!document.hidden)for(const item of items)if(item.visible)enqueue(item);},60000);
  function setStateAutoplay(state,value){
    if(state==='WV')autoplayWV=!!value;else if(state==='CA')autoplayCA=!!value;else if(state==='NV')autoplayNV=!!value;else if(state==='FL')autoplayFL=!!value;else return;
    for(const item of items)if(item.camera.state===state){item.suspended=false;if(value)item.blocked=false;}
    if(!value)for(const player of [...players])if(player.autoItem&&player.camera.state===state)player.stop(`${state} autoplay paused`);
    scheduleAutoplay();
  }
  return {snapshot,play,dispose,stopAll,setAuto(value){auto=!!value;},setWVAutoplay(value){setStateAutoplay('WV',value);},setCAAutoplay(value){setStateAutoplay('CA',value);},setNVAutoplay(value){setStateAutoplay('NV',value);},setFLAutoplay(value){setStateAutoplay('FL',value);},setStateAutoplay,setAutoplayScope(scope=null){autoplayScope=scope;for(const player of [...players])if(scope&&!scope.contains(player.container))player.stop('Preview paused while a camera is open');scheduleAutoplay();},refresh(){for(const item of items)if(item.visible){item.blocked=false;item.suspended=false;enqueue(item,true);}scheduleAutoplay();},setLimit(value){limit=[1,2,4].includes(Number(value))?Number(value):2;while(players.size>limit)[...players].at(-1).stop('Stopped after changing live limit');scheduleAutoplay();},get count(){return players.size;},get limit(){return limit;},debug(){return {snapshots:items.size,queued:queue.length,running,videos:players.size,visible:[...items].filter(i=>i.visible).length};}};
}
