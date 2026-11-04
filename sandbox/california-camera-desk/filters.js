export const normalize=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const FILTER_KEYS=['metro','district','county','road','direction','mediaType','availability','elevation'];
export const EMPTY_FILTERS={query:'',metro:'',district:'',county:'',road:'',direction:'',mediaType:'',availability:'working',elevation:'',fromMile:'',toMile:'',withinMap:false};
export const AVAILABILITY_OPTIONS=[['working','Working here'],['video','Recently checked video'],['snapshot','Working snapshots'],['all','All catalog entries'],['unchecked','Unchecked or expired'],['unavailable','Unavailable'],['official','Official viewers']];
const VIDEO_DECODED=new Set(['browser-playback','browser-video-decoded','ffmpeg-decoded-segment']);
const SNAPSHOT_DECODED=new Set(['browser-image-decoded','image-decoded']);
const stamp=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?n:0;};
export function mediaCheck(camera,kind,now=Date.now()){
  const session=camera.sessionHealth?.[kind],audit=camera.mediaHealth?.[kind]||{};
  const legacy=kind==='video'?camera.videoStatus:camera.imageStatus;
  const sessionExpiry=stamp(session?.expiresAt)||stamp(session?.checkedAt)+30*60000;
  const source=session?.status&&now<sessionExpiry?session:audit.status?audit:{status:legacy||'unchecked',verificationMethod:kind==='video'?'hls-manifest-only':'image-structure',checkedAt:camera.checkedAt};
  const checked=stamp(source.checkedAt),expiry=stamp(source.expiresAt)||checked+(source.status==='unavailable'?6:24)*3600000;
  const recent=!!checked&&now<expiry,method=source.verificationMethod||'not-reported';
  return {...source,verificationMethod:method,recent,expired:!!checked&&!recent,decoded:source.status==='available'&&recent&&(kind==='video'?VIDEO_DECODED:SNAPSHOT_DECODED).has(method)};
}
export function cameraHealth(camera,now=Date.now()){
  const video=mediaCheck(camera,'video',now),snapshot=mediaCheck(camera,'snapshot',now);
  const hasVideo=!!camera.videoUrl,hasSnapshot=!!(camera.imageUrl||camera.snapshotUrl),official=!hasVideo&&!hasSnapshot;
  const workingSnapshot=hasSnapshot&&snapshot.decoded,recentlyCheckedVideo=hasVideo&&video.decoded;
  const browserVideo=recentlyCheckedVideo&&video.verificationMethod==='browser-playback';
  const working=workingSnapshot||browserVideo;
  const unavailable=!official&&!working&&!recentlyCheckedVideo&&(camera.sourceDisabled||hasSnapshot&&snapshot.recent&&snapshot.status==='unavailable'&&snapshot.failureCategory==='placeholder'||[hasVideo?video:null,hasSnapshot?snapshot:null].filter(Boolean).every(check=>check.recent&&check.status==='unavailable'));
  return {video,snapshot,hasVideo,hasSnapshot,official,workingSnapshot,recentlyCheckedVideo,browserVideo,working,unavailable,unchecked:!official&&!working&&!recentlyCheckedVideo&&!unavailable};
}
export function summarizeHealth(cameras,now=Date.now()){
  const summary={workingViews:0,decodedSnapshotViews:0,browserPlayedVideoViews:0,sourceDecodedVideoViews:0};
  for(const camera of cameras){const health=cameraHealth(camera,now),auditedVideo=mediaCheck({...camera,sessionHealth:undefined},'video',now);if(health.working)summary.workingViews++;if(health.workingSnapshot)summary.decodedSnapshotViews++;if(health.browserVideo)summary.browserPlayedVideoViews++;if(auditedVideo.decoded&&auditedVideo.verificationMethod==='ffmpeg-decoded-segment')summary.sourceDecodedVideoViews++;}
  return summary;
}
export function availabilityMatch(camera,value,now=Date.now()){
  if(!value||value==='all')return true;
  const h=cameraHealth(camera,now);
  return value==='working'?h.working:value==='video'?h.recentlyCheckedVideo:value==='snapshot'?h.workingSnapshot:value==='official'?h.official:value==='unavailable'?h.unavailable:value==='unchecked'?h.unchecked:false;
}
export function validCoordinates(c){return typeof c.lat==='number'&&typeof c.lon==='number'&&Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&c.lat>=32&&c.lat<=43&&c.lon>=-125&&c.lon<=-113;}
export function prepareCameras(cameras){
  const seen=new Set();return cameras.filter(c=>c.id&&!seen.has(String(c.id))&&seen.add(String(c.id))).map(c=>{
    const imageUrl=c.imageUrl||c.snapshotUrl||null,videoUrl=c.videoUrl||null;
    const elevationFeet=Number.isFinite(Number(c.elevationFeet))&&c.elevationFeet!==null&&c.elevationFeet!==''?Number(c.elevationFeet):null;
    const raw=String(c.direction||'').trim(),direction=/^(north|n|nb|northbound)$/i.test(raw)?'Northbound':/^(south|s|sb|southbound)$/i.test(raw)?'Southbound':/^(east|e|eb|eastbound)$/i.test(raw)?'Eastbound':/^(west|w|wb|westbound)$/i.test(raw)?'Westbound':/^median$/i.test(raw)?'Median':'Unknown';
    const disabled=typeof c.disabled==='boolean'?c.disabled:((c.inService===false||String(c.inService).toLowerCase()==='false')&&![c.imageStatus,c.videoStatus].includes('available'));
    const mediaType=videoUrl?'Video capable':imageUrl?'Snapshot only':'Official viewer';
    const district=c.district?`District ${Number(String(c.district).replace(/\D/g,''))||c.district}`:'Other provider';
    const result={...c,id:String(c.id),state:'CA',name:String(c.name||c.locationName||c.id),metro:c.metro||c.region||'Other California',county:String(c.county||'').replace(/ County$/i,''),road:c.road||c.route||'Local roads',direction,sourceDirection:raw,district,elevationFeet,imageUrl,videoUrl,disabled,mediaType,elevation:elevationFeet===null?'Not reported':elevationFeet>=5000?'5,000+ ft':elevationFeet>=3000?'3,000–4,999 ft':elevationFeet>=1000?'1,000–2,999 ft':'Below 1,000 ft'};
    result.searchText=normalize([result.id,result.name,result.sourceRoad,result.road,result.metro,result.county,result.district,result.nearbyPlace,result.provider,result.imageDescription,...(result.aliases||[])].join(' '));
    return result;
  }).sort((a,b)=>Number(a.disabled)-Number(b.disabled)||Number(a.mediaType==='Official viewer')-Number(b.mediaType==='Official viewer')||a.road.localeCompare(b.road,undefined,{numeric:true})||Number(!Number.isFinite(a.milepost))-Number(!Number.isFinite(b.milepost))||((Number.isFinite(a.milepost)&&Number.isFinite(b.milepost))?a.milepost-b.milepost:0)||a.county.localeCompare(b.county)||a.name.localeCompare(b.name));
}
export function filterCameras(cameras,filters,bounds=null,exclude=''){
  const words=normalize(filters.query).split(' ').filter(Boolean);
  const output=cameras.filter(c=>{
    if(words.some(w=>!c.searchText.includes(w)))return false;
    for(const key of FILTER_KEYS)if(key!==exclude&&filters[key]&&(key==='availability'?!availabilityMatch(c,filters[key]):c[key]!==filters[key]))return false;
    if(filters.withinMap&&bounds&&(!validCoordinates(c)||c.lat<bounds.south||c.lat>bounds.north||c.lon<bounds.west||c.lon>bounds.east))return false;
    if(filters.fromMile!==''||filters.toMile!==''){
      if(!filters.road||!Number.isFinite(c.milepost))return false;
      if(filters.fromMile!==''&&c.milepost<Number(filters.fromMile))return false;
      if(filters.toMile!==''&&c.milepost>Number(filters.toMile))return false;
    }
    return true;
  });
  return filters.road?output.sort((a,b)=>Number(!Number.isFinite(a.milepost))-Number(!Number.isFinite(b.milepost))||((Number.isFinite(a.milepost)&&Number.isFinite(b.milepost))?a.milepost-b.milepost:0)||a.name.localeCompare(b.name)):output;
}
export function facet(cameras,filters,key,bounds){const values=new Map(),eligible=filterCameras(cameras,filters,bounds,key);if(key==='availability')return AVAILABILITY_OPTIONS.map(([value])=>[value,eligible.filter(c=>availabilityMatch(c,value)).length]);for(const c of eligible){const value=c[key];if(value)values.set(value,(values.get(value)||0)+1);}return [...values].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));}
