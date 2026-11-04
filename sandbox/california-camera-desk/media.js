import {cameraHealth} from './filters.js?v=20261104ca3';
const safeURL=value=>{try{const url=new URL(value);return url.protocol==='https:'?url:null;}catch{return null;}};
const clock=value=>new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
// Pixel probes were taken from a visually verified Caltrans 320×260
// "Temporarily Unavailable" image. Its lower timestamp bar changes; all
// probes stay in the 320×220 upper region. Allow JPEG decoder rounding.
const UNAVAILABLE_PROBES=[
  [10,10,255,255,255],[160,40,255,255,255],[300,200,255,255,255],
  [240,95,0,0,124],[130,100,2,4,113],[120,105,5,4,124],
  [170,135,1,2,108],[60,140,0,3,118],[100,140,1,0,117],
  [150,140,10,12,115],[230,145,0,0,127],[250,150,0,0,117]
];
export function classifyCaltransPlaceholder(image){
  if(!Number.isFinite(image.naturalWidth)||!Number.isFinite(image.naturalHeight))return null;
  if(image.naturalWidth!==320||image.naturalHeight!==260)return false;
  try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=220;const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;context.drawImage(image,0,0);const rgba=context.getImageData(0,0,320,220).data;
    return UNAVAILABLE_PROBES.every(([x,y,r,g,b])=>{const offset=(y*320+x)*4;return Math.abs(rgba[offset]-r)<=15&&Math.abs(rgba[offset+1]-g)<=15&&Math.abs(rgba[offset+2]-b)<=15;});
  }catch{return null;}
}
export function createMediaManager({onChange=()=>{},onMessage=()=>{},onHealth=()=>{},autoplayWV=true,autoplayCA=true}={}){
  const items=new Set(),players=new Set();let queue=[],running=0,auto=true,limit=matchMedia('(max-width:700px)').matches?1:2,autoplayScope=null,autoScheduled=false;
  const stateAutoplay=state=>state==='WV'?autoplayWV:state==='CA'?autoplayCA:false;
  const inlineVideo=camera=>camera.state==='WV'||camera.state==='CA';
  const snapshotInterval=camera=>Math.max(60,Number(camera.snapshotUpdateSeconds)||60)*1000;
  const report=(camera,kind,phase,details={})=>onHealth({camera,kind,phase,...details});
  function eligible(item){const c=item.camera,h=cameraHealth(c);return stateAutoplay(c.state)&&item.autoplay&&(c.state!=='CA'||h.recentlyCheckedVideo&&c.mediaHealth?.video?.browserCors!==false)&&c.videoUrl&&(!c.disabled||h.video.recent&&h.video.status==='available')&&item.visible&&!item.disposed&&!item.blocked&&!item.suspended&&(!autoplayScope||autoplayScope.contains(item.container));}
  function scheduleAutoplay(){
    if(autoScheduled)return;autoScheduled=true;
    queueMicrotask(()=>{autoScheduled=false;if(document.hidden||(!autoplayWV&&!autoplayCA))return;
      for(const item of items){
        if(players.size>=limit)break;
        if(!eligible(item)||item.player||[...players].some(player=>player.camera.videoUrl===item.camera.videoUrl))continue;
        play(item.container,item.camera,{autoItem:item,onStatus:message=>item.onStatus?.(message),onEnd:message=>item.onEnd?.(message)});
      }
      for(const item of items)if(eligible(item)&&!item.player){
        const same=[...players].some(player=>player.camera.videoUrl===item.camera.videoUrl);
        status(item,same?'Shared stream playing in another view':'Waiting for a video slot · choose Watch live to prioritize');
        report(item.camera,'video','waiting',{reason:same?'shared-stream':'slot-limit'});
      }
    });
  }
  function restorePreview(item,message){
    if(item.disposed)return;
    const placeholder=document.createElement('span');placeholder.className='media-placeholder';placeholder.textContent=message;
    const label=document.createElement('span');label.className='media-time';label.textContent=message;
    item.container.replaceChildren(placeholder,label);item.placeholder=placeholder;item.status=label;
    if(item.image){item.container.prepend(item.image);placeholder.hidden=true;label.textContent=item.placeholderIdentified?'Provider maintenance image · check official source':`Snapshot fetched ${clock(item.lastLoaded)}`;}
    else if(item.camera.imageUrl&&item.visible&&!item.suspended)enqueue(item);
  }
  const videoObserver=new IntersectionObserver(entries=>{for(const entry of entries){const player=[...players].find(p=>p.container===entry.target);if(!player||player.autoItem)continue;if(entry.isIntersecting)player.seen=true;else if(player.seen)player.stop('Video stopped offscreen · choose Watch live to resume');}},{threshold:0});
  function status(item,message){if(item.status)item.status.textContent=message;}
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){const item=entry.target._tripMedia;if(!item||item.disposed)continue;item.visible=entry.isIntersecting;
      if(item.visible){item.suspended=false;enqueue(item);}
      if(!item.visible&&item.player)item.player.stop('Video stopped offscreen · returns automatically when visible');
    }
    scheduleAutoplay();
  },{rootMargin:'0px'});
  function enqueue(item,force=false){
    if(item.disposed||item.pending||document.hidden||item.player||(!force&&!item.visible)||(!force&&item.lastAttempt&&Date.now()-item.lastAttempt<snapshotInterval(item.camera))||!item.camera.imageUrl)return;
    item.pending=true;queue.push(item);drain();
  }
  function drain(){
    while(running<4&&queue.length){const item=queue.shift();
      if(item.disposed||document.hidden||!item.visible||item.player){item.pending=false;continue;}
      const url=safeURL(item.camera.imageUrl);if(!url){item.pending=false;continue;}
      running++;item.lastAttempt=Date.now();let image=null,finished=false,cancelled=false,timer,corsFallback=false;
      const finish=(success,observedPlaceholder=null)=>{
        if(finished)return;finished=true;clearTimeout(timer);image.onload=image.onerror=null;if(!success)image.removeAttribute('src');item.pending=false;item.cancel=null;running--;
        if(!item.disposed&&!item.player){
          item.container.classList.remove('is-loading');
          if(success){item.image?.remove();item.image=image;item.container.prepend(image);item.lastLoaded=Date.now();item.placeholder.hidden=true;const auditedPlaceholder=item.camera.mediaHealth?.snapshot?.failureCategory==='placeholder',placeholder=observedPlaceholder===true||auditedPlaceholder&&observedPlaceholder===null;item.placeholderIdentified=placeholder;
            status(item,placeholder?'Provider maintenance image · check official source':`Snapshot fetched ${clock(item.lastLoaded)}`);
            if(observedPlaceholder===true)report(item.camera,'snapshot','known-placeholder',{status:'unavailable',verificationMethod:'browser-placeholder-probes',failureCategory:'placeholder'});
            else if(placeholder)report(item.camera,'snapshot','known-placeholder');
            else report(item.camera,'snapshot','decoded',{status:'available',verificationMethod:'browser-image-decoded',verifiedNonPlaceholder:observedPlaceholder===false});
          }
          else if(!cancelled){const retained=!!item.lastLoaded;status(item,retained?`Refresh failed · ${item.placeholderIdentified?'maintenance image':'last fetched '+clock(item.lastLoaded)}`:'Snapshot unavailable');item.placeholder.textContent='Try Refresh or open the official viewer';item.placeholder.hidden=retained;report(item.camera,'snapshot',retained?'refresh-failed':'failed',retained?{failureCategory:'browser-image-error'}:{status:'unavailable',failureCategory:'browser-image-error'});}
        }
        drain();
      };
      const load=withCors=>{image=new Image();image.alt=`Traffic view: ${item.camera.name}`;image.decoding='async';image.referrerPolicy='no-referrer';if(withCors)image.crossOrigin='anonymous';
        image.onload=()=>finish(image.naturalWidth>0,item.camera.providerKey==='caltrans'&&url.hostname==='cwwp2.dot.ca.gov'?classifyCaltransPlaceholder(image):false);
        image.onerror=()=>{if(withCors&&!corsFallback){corsFallback=true;load(false);}else finish(false);};
        url.searchParams.set('_',`${Date.now()}${corsFallback?'-fallback':''}`);image.src=url.href;
      };
      item.cancel=()=>{cancelled=true;image.removeAttribute('src');finish(false);};timer=setTimeout(()=>finish(false),18000);
      load(item.camera.providerKey==='caltrans'&&url.hostname==='cwwp2.dot.ca.gov');
    }
  }
  function snapshot(container,camera,{autoplay=true,onPlay=()=>{},onEnd=()=>{},onStatus=()=>{}}={}){
    dispose(container);container.replaceChildren();container.classList.add('camera-media');
    const placeholder=document.createElement('span');placeholder.className='media-placeholder';
    placeholder.textContent=camera.imageUrl?'Loading snapshot…':camera.videoUrl?'Choose Watch live to start this video':camera.providerKey==='sccroads'?'Regional county viewer · cameras under maintenance':'Open the official camera page';
    const label=document.createElement('span');label.className='media-time';label.textContent=camera.imageUrl?'Waiting for visible view':camera.videoUrl?'Video candidate · choose Watch live':'Official viewer only';
    container.append(placeholder,label);
    const item={container,camera,placeholder,status:label,visible:false,lastLoaded:0,lastAttempt:0,placeholderIdentified:false,pending:false,disposed:false,player:null,autoplay,blocked:false,suspended:false,onPlay,onEnd,onStatus};
    if(camera.disabled&&!cameraHealth(camera).working){placeholder.textContent='Provider reports out of service · try official viewer';label.textContent='Provider status is separate from media checks';}
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
    if(!source){onMessage('This camera has no playable public video URL. Try its official viewer.');return null;}
    if(!autoItem)for(const player of [...players])if(player.camera.videoUrl===camera.videoUrl)player.stop('This shared stream moved to the selected view');
    if(!autoItem&&players.size>=limit)[...players].find(player=>player.autoItem)?.stop('Waiting for a free video slot');
    if(players.size>=limit){if(!autoItem)onMessage(`The live limit is ${limit}. Stop a video or change Live slots first.`);report(camera,'video','waiting',{reason:'slot-limit'});return null;}
    if(autoItem){autoItem.cancel?.();autoItem.lastAttempt=0;}else dispose(container);
    container.replaceChildren();delete container.dataset.mediaError;container.classList.add('camera-media');
    const video=document.createElement('video');video.controls=!inlineVideo(camera);video.playsInline=true;video.muted=true;video.defaultMuted=true;video.autoplay=true;video.crossOrigin='anonymous';video.preload='none';video.setAttribute('muted','');video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.setAttribute('autoplay','');video.setAttribute('aria-label',`Live traffic video: ${camera.name}`);
    if(inlineVideo(camera)){video.disablePictureInPicture=true;video.disableRemotePlayback=true;video.classList.add(camera.state==='WV'?'wv-inline-video':'ca-inline-video');}
    const label=document.createElement('span');label.className='media-time';label.textContent='Connecting…';container.append(video,label);
    let hls=null,timer,watchdog,reconnectTimer,stopped=false,started=false,reportedPlaying=false,buffering=false,retries=0,lastTime=NaN,lastProgressAt=Date.now(),lastHealthAt=0,connectionAt=Date.now();
    const player={container,camera,video,autoItem,seen:false,stop(message='Video stopped'){
      if(stopped)return;stopped=true;clearTimeout(timer);clearTimeout(watchdog);clearTimeout(reconnectTimer);videoObserver.unobserve(container);hls?.destroy();video.pause();video.removeAttribute('src');video.load();video.remove();label.textContent=message;players.delete(player);
      if(autoItem){autoItem.player=null;restorePreview(autoItem,message);}
      report(camera,'video','stopped',{reason:message});onChange(players.size);onEnd(message);scheduleAutoplay();
    }};
    players.add(player);if(autoItem){autoItem.player=player;autoItem.onPlay(player);}else videoObserver.observe(container);onChange(players.size);
    const terminalFailure=category=>{if(stopped)return;container.dataset.mediaError=video.error?`${video.error.code}: ${video.error.message}`:category;if(autoItem)autoItem.blocked=true;report(camera,'video','failed',{status:'unavailable',failureCategory:category});player.stop('Video failed · snapshot fallback');if(!autoItem)snapshot(container,camera,{autoplay:false});onStatus('Video failed in this browser. Showing a snapshot where available; choose Watch live to retry or use the official viewer.');};
    const attempt=()=>video.play().catch(error=>{if(stopped)return;if(error?.name==='NotAllowedError'){if(autoItem)autoItem.blocked=true;report(camera,'video','blocked',{reason:'autoplay-policy'});player.stop('Autoplay needs a tap · choose Watch live');if(!autoItem)snapshot(container,camera,{autoplay:false});onStatus('Autoplay needs a tap in this browser. Choose Watch live to start the muted inline feed.');}else reconnect('playback-error');});
    const connect=()=>{if(stopped)return;reconnectTimer=null;clearTimeout(timer);hls?.destroy();hls=null;video.pause();video.removeAttribute('src');video.load();lastTime=NaN;started=false;reportedPlaying=false;buffering=false;lastProgressAt=Date.now();lastHealthAt=0;connectionAt=Date.now();label.textContent=retries?'Reconnecting…':'Connecting…';report(camera,'video',retries?'reconnecting':'connecting');timer=setTimeout(()=>reconnect('connection-timeout'),30000);watchdog=setTimeout(checkProgress,3500);if(native){video.src=source.href;attempt();}else if(window.Hls?.isSupported()){hls=new window.Hls({maxBufferLength:12,maxMaxBufferLength:24,backBufferLength:0});hls.on(window.Hls.Events.MANIFEST_PARSED,attempt);hls.on(window.Hls.Events.ERROR,(_,data)=>{if(data.fatal){container.dataset.mediaError=data.details||data.type;reconnect(data.details||data.type||'hls-error');}});hls.loadSource(source.href);hls.attachMedia(video);}else terminalFailure('unsupported-browser');};
    const reconnect=category=>{if(stopped||reconnectTimer)return;if(retries>=1){terminalFailure(category);return;}retries++;clearTimeout(timer);clearTimeout(watchdog);hls?.stopLoad?.();video.pause();label.textContent='Reconnecting after a playback interruption…';report(camera,'video','reconnecting',{reason:category});reconnectTimer=setTimeout(connect,3500);};
    const progress=()=>{if(stopped||video.paused||video.readyState<2||video.videoWidth===0)return;const current=Number(video.currentTime);if(!Number.isFinite(current))return;if(Number.isFinite(lastTime)&&current>lastTime+0.15){lastProgressAt=Date.now();started=true;const resumed=!reportedPlaying||buffering;if(resumed){reportedPlaying=true;buffering=false;clearTimeout(timer);label.textContent='LIVE · source delay varies';onStatus('Video is advancing in this browser. Separate feeds are not synchronized.');}if(resumed||Date.now()-lastHealthAt>=5*60000){lastHealthAt=Date.now();report(camera,'video','playing',{status:'available',verificationMethod:'browser-playback'});}}lastTime=current;};
    const checkProgress=()=>{if(stopped)return;progress();if(started&&Date.now()-lastProgressAt>12000){label.textContent='Video stalled · reconnecting';reconnect('playback-stall');return;}if(!started&&Date.now()-connectionAt>30000){reconnect('no-decoded-progress');return;}watchdog=setTimeout(checkProgress,3500);};
    video.addEventListener('error',()=>reconnect(video.error?.code===4?'unsupported-format':'media-error'));
    video.addEventListener('playing',()=>{if(stopped)return;label.textContent='Decoding video…';progress();});
    for(const eventName of ['stalled','waiting'])video.addEventListener(eventName,()=>{if(stopped||!reportedPlaying)return;buffering=true;label.textContent='Buffering · checking feed progress';report(camera,'video','buffering',{reason:eventName});});
    video.addEventListener('timeupdate',progress);
    connect();
    return stopped?null:player;
  }
  function stopAll(message='Video stopped'){for(const item of items)item.suspended=true;for(const player of [...players])player.stop(message);}
  function stopEndpoint(url){if(!url)return;for(const item of items)if(item.camera.videoUrl===url)item.blocked=true;for(const player of [...players])if(player.camera.videoUrl===url)player.stop('Stopped by you · choose Watch live to resume');}
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stopAll('Video stopped while tab was hidden');for(const item of items){item.cancel?.();item.lastAttempt=0;}queue.forEach(item=>item.pending=false);queue=[];}
    else {for(const item of items){item.suspended=false;if(auto&&item.visible)enqueue(item);}scheduleAutoplay();}
  });
  setInterval(()=>{if(auto&&!document.hidden)for(const item of items)if(item.visible)enqueue(item);},60000);
  function setStateAutoplay(state,value){
    if(state==='WV')autoplayWV=!!value;else if(state==='CA')autoplayCA=!!value;else return;
    for(const item of items)if(item.camera.state===state){item.suspended=false;if(value)item.blocked=false;}
    if(!value)for(const player of [...players])if(player.autoItem&&player.camera.state===state)player.stop(`${state} autoplay paused`);
    scheduleAutoplay();
  }
  return {snapshot,play,dispose,stopAll,stopEndpoint,setAuto(value){auto=!!value;},setWVAutoplay(value){setStateAutoplay('WV',value);},setCAAutoplay(value){setStateAutoplay('CA',value);},setStateAutoplay,setAutoplayScope(scope=null){autoplayScope=scope;for(const player of [...players])if(scope&&!scope.contains(player.container))player.stop('Preview paused while a camera is open');scheduleAutoplay();},refresh(){for(const item of items)if(item.visible){item.blocked=false;item.suspended=false;enqueue(item,true);}scheduleAutoplay();},setLimit(value){limit=[1,2,4].includes(Number(value))?Number(value):2;while(players.size>limit)[...players].at(-1).stop('Stopped after changing live limit');scheduleAutoplay();},get count(){return players.size;},get limit(){return limit;},debug(){return {snapshots:items.size,queued:queue.length,running,videos:players.size,visible:[...items].filter(i=>i.visible).length};}};
}
