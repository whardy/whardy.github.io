import {californiaHealth,recordMediaResult} from './health.js?v=20261104cahealth2';
const safeURL=value=>{try{const url=new URL(value);return url.protocol==='https:'?url:null;}catch{return null;}};
const captureLabel=camera=>{if(!['OR','WA','FL'].includes(camera.state))return '';const value=camera.state==='FL'?camera.sourceCaptureTime:camera.sourceTimestamp;if(!value||!Number.isFinite(Date.parse(value)))return ' · capture time unknown';try{return ` · captured ${new Date(value).toLocaleString('en-US',camera.timezone?{timeZone:camera.timezone,timeZoneName:'short'}:undefined)}`;}catch{return ' · capture time unknown';}};
const clock=value=>new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
// Six visually verified Caltrans 320×260 notices share two upper-image
// patterns. Their lower timestamp strips change; allow JPEG decoder rounding.
const CA_PLACEHOLDER_PROFILES=[
  // Temporarily Unavailable.
  [[10,10,255,255,255],[160,40,255,255,255],[300,200,255,255,255],[20,120,255,255,255],[300,120,255,255,255],[160,180,255,255,255],[63,97,4,1,118],[97,106,0,0,113],[133,96,0,2,110],[169,100,0,2,110],[203,101,4,1,119],[239,92,0,3,118],[59,146,0,0,109],[86,144,0,0,120],[132,146,0,4,112],[183,149,0,1,116],[204,150,0,1,112],[237,148,0,0,118]],
  // Down for Construction.
  [[10,10,255,255,255],[160,40,255,255,255],[300,200,255,255,255],[20,120,255,255,255],[300,120,255,255,255],[160,180,255,255,255],[82,108,5,2,119],[87,109,0,3,110],[147,106,1,3,115],[161,103,3,2,118],[197,93,0,1,118],[231,96,1,1,121],[62,149,0,0,108],[87,146,0,0,112],[141,137,1,2,114],[181,137,0,2,117],[213,137,1,3,116],[226,139,1,0,115]]
];
export function classifyCaltransPlaceholder(image){
  if(!Number.isFinite(image.naturalWidth)||!Number.isFinite(image.naturalHeight))return null;
  if(image.naturalWidth!==320||image.naturalHeight!==260)return false;
  try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=220;const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;context.drawImage(image,0,0);const rgba=context.getImageData(0,0,320,220).data;
    return CA_PLACEHOLDER_PROFILES.some(probes=>probes.every(([x,y,r,g,b])=>{const offset=(y*320+x)*4;return Math.abs(rgba[offset]-r)<=15&&Math.abs(rgba[offset+1]-g)<=15&&Math.abs(rgba[offset+2]-b)<=15;}));
  }catch{return null;}
}
export function createMediaManager({onChange=()=>{},onHealth=()=>{},onMessage=()=>{},autoplayWV=true,autoplayCA=true,autoplayNV=true,autoplayFL=true}={}){
  const items=new Set(),players=new Set(),caRetryAfter=new Map();let queue=[],running=0,auto=true,limit=matchMedia('(max-width:700px)').matches?1:2,autoplayScope=null,autoScheduled=false;
  const stateAutoplay=state=>state==='WV'?autoplayWV:state==='CA'?autoplayCA:state==='NV'?autoplayNV:state==='FL'?autoplayFL:false;
  const inlineVideo=camera=>['WV','CA','NV','FL'].includes(camera.state);
  const snapshotInterval=camera=>Math.max(60,Number(camera.snapshotUpdateSeconds)||60)*1000;
  function eligible(item){
    const camera=item.camera;
    const caReady=camera.state==='CA'?californiaHealth(camera).checkedVideo&&camera.mediaHealth?.video?.browserCors!==false:true;
    const flReady=camera.state!=='FL'||camera.videoStatus==='available'&&camera.videoAutoplayAllowed!==false;
    return stateAutoplay(camera.state)&&item.autoplay&&caReady&&flReady&&!(camera.state!=='WV'&&camera.state!=='CA'&&camera.videoStatus==='unavailable')&&camera.videoUrl&&(!camera.disabled||camera.state==='CA'&&caReady)&&item.visible&&!item.disposed&&!item.blocked&&!item.suspended&&(!autoplayScope||autoplayScope.contains(item.container));
  }
  function scheduleAutoplay(){
    if(autoScheduled)return;autoScheduled=true;
    queueMicrotask(()=>{autoScheduled=false;if(document.hidden||(!autoplayWV&&!autoplayCA&&!autoplayNV&&!autoplayFL))return;
      for(const item of items){
        if(players.size>=limit)break;
        if(!eligible(item)||item.player||[...players].some(player=>player.camera.videoUrl===item.camera.videoUrl))continue;
        play(item.container,item.camera,{autoItem:item,onStatus:message=>item.onStatus?.(message),onEnd:message=>item.onEnd?.(message)});
      }
      for(const item of items)if(eligible(item)&&!item.player){
        const shared=[...players].some(player=>player.camera.videoUrl===item.camera.videoUrl);
        if(shared&&item.status?.textContent!=='Same feed playing in another view'){status(item,'Same feed playing in another view');item.onStatus?.('This source is already playing in another view.');}
        else if(!shared&&players.size>=limit&&item.status?.textContent!=='Waiting for a video slot'){status(item,'Waiting for a video slot');item.onStatus?.('Waiting for a video slot; the source has not failed.');}
      }
    });
  }
  function restorePreview(item,message){
    if(item.disposed)return;
    const placeholder=document.createElement('span');placeholder.className='media-placeholder';placeholder.textContent=message;
    const label=document.createElement('span');label.className='media-time';label.textContent=`${item.camera.state} live view`;
    item.container.replaceChildren(placeholder,label);item.placeholder=placeholder;item.status=label;
    if(item.image){item.container.prepend(item.image);placeholder.hidden=true;label.textContent=item.placeholderImage?'Provider maintenance image · check official source':`Snapshot fetched ${clock(item.lastLoaded)}`;}
    else if(item.camera.imageUrl&&item.visible&&!item.suspended)enqueue(item);
  }
  const videoObserver=new IntersectionObserver(entries=>{for(const entry of entries){const player=[...players].find(p=>p.container===entry.target);if(!player||player.autoItem)continue;if(entry.isIntersecting)player.seen=true;else if(player.seen)player.stop('Video stopped offscreen · choose Watch live to resume');}},{threshold:0});
  function status(item,message){if(item.status)item.status.textContent=message;}
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){const item=entry.target._tripMedia;if(!item||item.disposed)continue;item.visible=entry.isIntersecting;
      if(item.visible){item.suspended=false;if(!item.lastLoaded)enqueue(item);}
      if(!item.visible)item.cancel?.();
      if(!item.visible&&item.player)item.player.stop('Video stopped offscreen · returns automatically when visible');
    }
    scheduleAutoplay();
  },{rootMargin:'0px'});
  function enqueue(item,force=false){
    if(item.disposed||item.pending||document.hidden||item.player||(!force&&!item.visible)||(!force&&item.lastAttempt&&Date.now()-item.lastAttempt<snapshotInterval(item.camera))||(!force&&item.camera.state==='CA'&&Date.now()<(caRetryAfter.get(item.camera.imageUrl)||0))||!item.camera.imageUrl||(item.camera.disabled&&item.camera.state!=='CA'))return;
    item.pending=true;item.forceRefresh=force;queue.push(item);drain();
  }
  function drain(){
    while(running<4&&queue.length){const item=queue.shift();
      if(item.disposed||document.hidden||!item.visible||item.player){item.pending=false;continue;}
      const url=safeURL(item.camera.imageUrl);if(!url){item.pending=false;continue;}
      running++;item.lastAttempt=Date.now();let image=null,finished=false,cancelled=false,corsFallback=false,timer;
      const finish=(success,observedPlaceholder=null)=>{
        if(finished)return;finished=true;clearTimeout(timer);image.onload=image.onerror=null;item.pending=false;item.cancel=null;running--;
        if(!item.disposed&&!item.player){
          item.container.classList.remove('is-loading');
          if(success){
            item.image?.remove();item.image=image;item.container.prepend(image);item.lastLoaded=Date.now();item.placeholder.hidden=true;
            const auditedPlaceholder=item.camera.mediaHealth?.snapshot?.failureCategory==='placeholder';
            const placeholder=observedPlaceholder===true||(auditedPlaceholder&&observedPlaceholder===null);
            item.placeholderImage=placeholder;
            if(item.camera.state==='CA'){
              if(placeholder)caRetryAfter.set(item.camera.imageUrl,Date.now()+Math.max(snapshotInterval(item.camera),300000));
              else caRetryAfter.delete(item.camera.imageUrl);
            }
            status(item,placeholder?'Provider maintenance image · check official source':`Fetched ${clock(item.lastLoaded)}${captureLabel(item.camera)}`);
            if(observedPlaceholder===true){recordMediaResult(item.camera,'snapshot','unavailable','placeholder',{verificationMethod:'browser-placeholder-probes',failureCategory:'placeholder'});onHealth(item.camera,'snapshot','unavailable');}
            else if(!placeholder){recordMediaResult(item.camera,'snapshot','available','',{verifiedNonPlaceholder:observedPlaceholder===false});onHealth(item.camera,'snapshot','available');}
          }
          else if(!cancelled){if(item.camera.state==='CA')caRetryAfter.set(item.camera.imageUrl,Date.now()+Math.max(snapshotInterval(item.camera),300000));status(item,item.lastLoaded?`Refresh failed · last image fetched ${clock(item.lastLoaded)}`:'Snapshot unavailable');item.placeholder.textContent='Try Refresh or open the official viewer';item.placeholder.hidden=!!item.lastLoaded;if(item.camera.state==='CA'){recordMediaResult(item.camera,'snapshot','unavailable',item.lastLoaded?'image-refresh-error':'image-decode-or-network');onHealth(item.camera,'snapshot','unavailable');}}
        }
        drain();
      };
      if(item.camera.state!=='FL'||item.camera.snapshotCacheBustAllowed===true)url.searchParams.set('_',String(item.forceRefresh?Date.now():Math.floor(Date.now()/snapshotInterval(item.camera))));
      const load=withCors=>{
        image=new Image();image.alt=`Traffic view: ${item.camera.name}`;image.decoding='async';if(item.camera.referrerPolicy)image.referrerPolicy=item.camera.referrerPolicy;else if(item.camera.state!=='FL')image.referrerPolicy='no-referrer';
        if(withCors)image.crossOrigin='anonymous';
        image.onload=()=>finish(image.naturalWidth>0,item.camera.state==='CA'&&item.camera.providerKey==='caltrans'?classifyCaltransPlaceholder(image):false);
        image.onerror=()=>{if(withCors&&!corsFallback){corsFallback=true;load(false);}else finish(false);};
        image.src=url.href;
      };
      item.cancel=()=>{cancelled=true;image.removeAttribute('src');finish(false);};timer=setTimeout(()=>{image.removeAttribute('src');finish(false);},18000);
      load(item.camera.state==='CA'&&item.camera.providerKey==='caltrans'&&url.hostname==='cwwp2.dot.ca.gov');
    }
  }
  function snapshot(container,camera,{autoplay=true,onPlay=()=>{},onEnd=()=>{},onStatus=()=>{}}={}){
    dispose(container);container.replaceChildren();container.classList.add('camera-media');
    const placeholder=document.createElement('span');placeholder.className='media-placeholder';
    placeholder.textContent=camera.imageUrl?'Loading snapshot…':camera.videoUrl?'Choose Watch live to start this video':'Open the official viewer for this camera';
    const label=document.createElement('span');label.className='media-time';label.textContent=camera.imageUrl?'Waiting for visible view':camera.videoUrl?'Video available · not playing':'Official viewer';
    container.append(placeholder,label);
    const item={container,camera,placeholder,status:label,visible:false,lastLoaded:0,lastAttempt:0,placeholderImage:false,pending:false,disposed:false,player:null,autoplay,blocked:false,suspended:false,onPlay,onEnd,onStatus};
    if(camera.disabled&&camera.state!=='CA'){placeholder.textContent='Unavailable in provider catalog';label.textContent='Check official viewer';}
    else if(camera.disabled){label.textContent='Provider reports unavailable · verify this view';}
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
    if(!source||(camera.disabled&&camera.state!=='CA')){onMessage('This camera has no playable public video.');return null;}
    if(!autoItem)for(const player of [...players])if(player.camera.videoUrl===camera.videoUrl)player.stop('Moved to the selected view');
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
    let hls=null,timer,watchdog,retryTimer,stopped=false,reconnecting=false,retries=0,progressAt=0,lastTime=0,lastHealthAt=0,verified=false;
    const player={container,camera,video,autoItem,seen:false,stop(message='Video stopped'){
      if(stopped)return;stopped=true;clearTimeout(timer);clearTimeout(watchdog);clearTimeout(retryTimer);videoObserver.unobserve(container);hls?.destroy();video.pause();video.removeAttribute('src');video.load();video.remove();label.textContent=message;players.delete(player);
      if(autoItem){autoItem.player=null;restorePreview(autoItem,message);}
      onChange(players.size);onEnd(message);scheduleAutoplay();
    }};
    players.add(player);if(autoItem){autoItem.player=player;autoItem.onPlay(player);}else videoObserver.observe(container);onChange(players.size);
    const progress=()=>{
      if(stopped||camera.state!=='CA')return;
      const time=Number(video.currentTime)||0;
      if(time<=lastTime+0.2||video.readyState<2||video.videoWidth<=0||video.videoHeight<=0)return;
      lastTime=time;progressAt=Date.now();
      const newlyVerified=!verified;
      if(newlyVerified){verified=true;player.verified=true;label.textContent='LIVE · advancing video';onChange(players.size);onStatus('Video is advancing in this browser. Separate feeds are not synchronized.');}
      if(newlyVerified||Date.now()-lastHealthAt>=5*60000){lastHealthAt=Date.now();recordMediaResult(camera,'video','available');onHealth(camera,'video','available');}
    };
    const checkProgress=()=>{
      if(stopped||camera.state!=='CA'||document.hidden)return;
      progress();
      if(Date.now()-progressAt>18000){fail('playback-stalled');return;}
      watchdog=setTimeout(checkProgress,5000);
    };
    const connect=()=>{
      if(stopped)return;
      reconnecting=false;verified=false;player.verified=false;lastTime=Number(video.currentTime)||0;progressAt=Date.now();lastHealthAt=0;
      clearTimeout(timer);timer=setTimeout(()=>fail('connection-timeout'),30000);
      if(native){video.src=source.href;attempt();}
      else if(window.Hls?.isSupported()){
        hls=new window.Hls({maxBufferLength:12,maxMaxBufferLength:24,backBufferLength:0});
        hls.on(window.Hls.Events.MANIFEST_PARSED,attempt);
        hls.on(window.Hls.Events.ERROR,(_,data)=>{if(data.fatal){container.dataset.mediaError=data.details||data.type;fail(data.details||data.type||'hls-error');}});
        hls.loadSource(source.href);hls.attachMedia(video);
      }else fail('unsupported-browser');
    };
    const fail=reason=>{
      if(stopped||reconnecting)return;
      container.dataset.mediaError=video.error?`${video.error.code}: ${video.error.message}`:container.dataset.mediaError||reason||'HLS connection error';
      clearTimeout(timer);clearTimeout(watchdog);
      if(camera.state==='CA'&&retries<1&&reason!=='unsupported-browser'){
        retries++;reconnecting=true;verified=false;player.verified=false;label.textContent='Reconnecting video once…';onChange(players.size);onStatus('Video stopped advancing. Trying the source once more.');
        hls?.destroy();hls=null;video.pause();video.removeAttribute('src');video.load();
        retryTimer=setTimeout(connect,3000);return;
      }
      if(camera.state==='CA'){recordMediaResult(camera,'video','unavailable',reason||'browser-playback');onHealth(camera,'video','unavailable');}
      if(autoItem){autoItem.blocked=true;autoItem.lastAttempt=0;}
      player.stop('Video failed · snapshot fallback');
      if(!autoItem)snapshot(container,camera,{autoplay:false});
      onStatus('Video failed in this browser. Showing a snapshot where available; retry or open the official viewer.');
    };
    video.addEventListener('error',()=>fail('video-element-error'));
    video.addEventListener('pause',()=>{if(stopped||camera.state!=='CA'||!verified)return;verified=false;player.verified=false;label.textContent='Playback paused · checking feed';onChange(players.size);});
    video.addEventListener('timeupdate',progress);
    video.addEventListener('playing',()=>{if(stopped)return;clearTimeout(timer);if(camera.state==='CA'){label.textContent='Video started · checking progress…';progressAt=Date.now();lastTime=Number(video.currentTime)||0;clearTimeout(watchdog);watchdog=setTimeout(checkProgress,5000);}else{player.verified=true;label.textContent='LIVE · source delay varies';onChange(players.size);onStatus('Live video connected. Separate feeds are not synchronized.');}});
    video.addEventListener('waiting',()=>{if(!stopped&&camera.state==='CA'){verified=false;player.verified=false;label.textContent='Buffering video…';onChange(players.size);}});
    video.addEventListener('stalled',()=>{if(!stopped&&camera.state==='CA'){verified=false;player.verified=false;label.textContent='Video stalled · checking connection…';onChange(players.size);}});
    const attempt=()=>Promise.resolve().then(()=>video.play()).catch(error=>{if(stopped||reconnecting)return;if(error?.name!=='NotAllowedError'){fail(error?.name==='NotSupportedError'?'unsupported-media':'playback-error');return;}clearTimeout(timer);clearTimeout(watchdog);if(inlineVideo(camera)){if(autoItem){autoItem.blocked=true;autoItem.lastAttempt=0;}player.stop('Autoplay needs a tap · choose Watch live');onStatus('Your browser paused autoplay. Choose Watch live to start the muted inline feed.');}else{label.textContent='Tap the native video play control';onStatus('Tap the native video play control to begin.');}});
    connect();
    return stopped?null:player;
  }
  function stopAll(message='Video stopped'){for(const item of items)item.suspended=true;for(const player of [...players])player.stop(message);}
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stopAll('Video stopped while tab was hidden');for(const item of items)item.cancel?.();queue.forEach(item=>item.pending=false);queue=[];}
    else {for(const item of items){item.suspended=false;if(auto&&item.visible)enqueue(item);}scheduleAutoplay();}
  });
  setInterval(()=>{if(auto&&!document.hidden)for(const item of items)if(item.visible)enqueue(item);},60000);
  function setStateAutoplay(state,value){
    if(state==='WV')autoplayWV=!!value;else if(state==='CA')autoplayCA=!!value;else if(state==='NV')autoplayNV=!!value;else if(state==='FL')autoplayFL=!!value;else return;
    for(const item of items)if(item.camera.state===state){item.suspended=false;if(value)item.blocked=false;}
    if(!value)for(const player of [...players])if(player.autoItem&&player.camera.state===state)player.stop(`${state} autoplay paused`);
    scheduleAutoplay();
  }
  return {snapshot,play,dispose,stopAll,setAuto(value){auto=!!value;},setWVAutoplay(value){setStateAutoplay('WV',value);},setCAAutoplay(value){setStateAutoplay('CA',value);},setNVAutoplay(value){setStateAutoplay('NV',value);},setFLAutoplay(value){setStateAutoplay('FL',value);},setStateAutoplay,setAutoplayScope(scope=null){autoplayScope=scope;for(const player of [...players])if(scope&&!scope.contains(player.container))player.stop('Preview paused while a camera is open');scheduleAutoplay();},refresh(){for(const item of items)if(item.visible){item.blocked=false;item.suspended=false;enqueue(item,true);}scheduleAutoplay();},setLimit(value){limit=[1,2,4].includes(Number(value))?Number(value):2;while(players.size>limit)[...players].at(-1).stop('Stopped after changing live limit');scheduleAutoplay();},isPlaying(id){return [...players].some(player=>player.camera.id===id&&player.verified&&!player.video.paused);},get count(){return players.size;},get limit(){return limit;},debug(){return {snapshots:items.size,queued:queue.length,running,videos:players.size,visible:[...items].filter(i=>i.visible).length};}};
}
