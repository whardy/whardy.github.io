import assert from 'node:assert/strict';
import {californiaHealth,mediaCheck,matchesCaliforniaHealth,recordMediaResult} from '../health.js?v=20261104cahealth2';
import {filterCameras,loadStates,matchingRouteViews} from '../catalog.js';
import {prepareRoute,coverageGaps} from '../geometry.js';

const now=Date.now(),stamp=offset=>new Date(now+offset).toISOString();
const check=(status,verificationMethod,expired=false)=>({status,verificationMethod,checkedAt:stamp(-3600_000),expiresAt:stamp(expired?-1000:86400_000)});
const camera=(id,video,snapshot)=>({id:`CA:caltrans:D03:${id}`,state:'CA',name:id,searchText:id.toLowerCase(),
  videoUrl:`https://example.org/${id}.m3u8`,imageUrl:`https://example.org/${id}.jpg`,
  mediaHealth:{video,snapshot}});
const videoWorks=camera('video-works',check('available','ffmpeg-decoded-segment'),check('unavailable','image-decoded'));
const imageWorks=camera('image-works',check('unavailable','hls-segment-structure'),check('available','image-decoded'));
const manifestOnly=camera('manifest-only',check('available','hls-segment-structure'),check('unavailable','image-decoded'));
const expired=camera('expired',check('available','ffmpeg-decoded-segment',true),check('available','image-decoded',true));
const unavailable=camera('unavailable',check('unavailable','ffmpeg-decoded-segment'),check('unavailable','image-decoded'));
const providerFlagConflict={...camera('provider-flag-conflict',check('available','ffmpeg-decoded-segment'),check('unavailable','image-decoded')),disabled:true};
const sourceFlagConflict={...camera('source-flag-conflict',check('available','ffmpeg-decoded-segment'),check('unavailable','image-decoded')),sourceDisabled:true};
const maintenanceWithUncheckedVideo=camera('maintenance',check('unchecked','hls-segment-structure'),{...check('unavailable','image-decoded'),failureCategory:'placeholder'});
const sourceUnavailable={...camera('source-unavailable',check('unchecked','hls-segment-structure'),check('unchecked','image-structure')),sourceDisabled:true};
const official={id:'CA:sccroads:123',state:'CA',name:'County regional view',searchText:'county',videoUrl:null,imageUrl:null,officialUrl:'https://example.org/map'};
const cameras=[videoWorks,imageWorks,manifestOnly,expired,unavailable,official];
const filters={query:'',state:'',metro:'',jurisdiction:'',road:'',media:'',status:'',caHealth:'working'};

assert.equal(californiaHealth(videoWorks).checkedVideo,true,'A decoded segment is a recent video check');
assert.equal(californiaHealth(videoWorks).working,false,'A decoded segment alone is not browser-verified playback');
assert.equal(californiaHealth(imageWorks).working,true,'A decoded snapshot is usable even if its video failed');
assert.equal(californiaHealth(imageWorks).checkedVideo,false,'A working JPG never qualifies as working video');
assert.equal(californiaHealth(manifestOnly).checkedVideo,false,'Manifest and segment structure do not prove decodable video');
assert.equal(californiaHealth(expired).working,false,'Expired checks are not currently working');
assert.equal(mediaCheck(expired,'snapshot').status,'expired');
assert.equal(californiaHealth(unavailable).unavailable,true);
assert.equal(californiaHealth(providerFlagConflict).checkedVideo,true);
assert.equal(californiaHealth(providerFlagConflict).unavailable,false,'Provider service flag must not override a successful endpoint check');
assert.equal(californiaHealth(sourceFlagConflict).unavailable,false,'Decoded video overrides source service metadata');
assert.equal(californiaHealth(maintenanceWithUncheckedVideo).unavailable,true,'A verified maintenance image remains unavailable while video is unchecked');
assert.equal(californiaHealth(sourceUnavailable).unavailable,true,'A provider outage with no decoded media belongs in Unavailable');
assert.equal(californiaHealth(official).official,true);
assert.deepEqual(filterCameras(cameras,filters).map(c=>c.id),[imageWorks.id]);
assert.deepEqual(filterCameras(cameras,{...filters,caHealth:'video'}).map(c=>c.id),[videoWorks.id]);
assert.deepEqual(filterCameras(cameras,{...filters,caHealth:'official'}).map(c=>c.id),[official.id]);
assert.equal(matchesCaliforniaHealth({state:'WV'},'working'),true,'California health choice leaves other states unchanged');

const route=prepareRoute({coordinates:[[-122,37],[-121.9,37]],distanceMeters:9000,durationSeconds:600});
const along=[{...imageWorks,routeDistanceMeters:2000,routeOffsetMeters:200},
  {...unavailable,routeDistanceMeters:6000,routeOffsetMeters:200},
  {...manifestOnly,routeDistanceMeters:6000,routeOffsetMeters:5000}];
const workingNear=matchingRouteViews(along,filters,{maxOffsetMeters:1609.344});
const allNear=matchingRouteViews(along,{...filters,caHealth:'all'},{maxOffsetMeters:1609.344});
assert.deepEqual(workingNear.map(c=>c.id),[imageWorks.id],'Route coverage follows Working here');
assert.deepEqual(allNear.map(c=>c.id),[imageWorks.id,unavailable.id],'A camera beyond one mile cannot erase a coverage gap');
assert.equal(coverageGaps(route,workingNear,{radiusMeters:1609.344,minGapMeters:3218.688}).length,1);
assert.equal(coverageGaps(route,allNear,{radiusMeters:1609.344,minGapMeters:3218.688}).length,0);

recordMediaResult(videoWorks,'video','available');
assert.equal(californiaHealth(videoWorks).working,true,'Advancing browser playback qualifies during this session');
recordMediaResult(videoWorks,'video','unavailable','playback-stalled');
assert.equal(californiaHealth(videoWorks).checkedVideo,false,'A session stall overrides a dated successful audit');
recordMediaResult(imageWorks,'video','blocked','autoplay-policy');
assert.equal(californiaHealth(imageWorks).video.status,'unavailable','Autoplay policy is not recorded as a new source failure');
recordMediaResult(unavailable,'snapshot','available');
assert.equal(californiaHealth(unavailable).working,true,'A decoded image overrides conflicting provider service metadata for this visit');
const nativeFetch=globalThis.fetch,fetches=[];
try{
  globalThis.fetch=async url=>{fetches.push(String(url));return new Response(JSON.stringify({cameras:[]}));};
  await loadStates({states:[{state:'CA',stateName:'California',file:'data/CA.json',sha256:'a'.repeat(64)}]},['CA']);
  assert.deepEqual(fetches,['./data/CA.json?v=aaaaaaaaaaaa'],'A new index hash versions the California shard URL');
}finally{globalThis.fetch=nativeFetch;}
console.log('Passed California health separation, expiry, working filters, browser-session overrides, policy exception, and official-viewer classification.');
