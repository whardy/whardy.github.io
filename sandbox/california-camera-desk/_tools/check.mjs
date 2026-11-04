import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {prepareCameras,filterCameras,facet,EMPTY_FILTERS,availabilityMatch,cameraHealth,mediaCheck,summarizeHealth,validCoordinates} from '../filters.js';
import {parseControls,sourceTimestamp} from '../conditions.js';
import {normalizeLibrary,mergeLibrary,encodeShare,decodeShare} from '../store.js';
const ALL={...EMPTY_FILTERS,availability:'all'};
const root=new URL('../',import.meta.url),catalog=JSON.parse(await readFile(new URL('camera-catalog.json',root),'utf8')),cameras=prepareCameras(catalog.cameras);
assert(cameras.length>3000);assert.equal(cameras.length,catalog.cameras.length);assert.equal(new Set(cameras.map(c=>c.id)).size,cameras.length);assert.equal(new Set(cameras.filter(c=>c.provider==='Caltrans').map(c=>c.district)).size,12);
assert(cameras.every(c=>c.state==='CA'&&c.name&&c.searchText));assert(cameras.some(c=>c.videoUrl));assert(cameras.some(c=>c.mediaType==='Official viewer'));
for(const c of cameras)for(const key of ['imageUrl','videoUrl','officialUrl'])if(c[key])assert.equal(new URL(c[key]).protocol,'https:');
const i5=filterCameras(cameras,{...ALL,road:'I-5'});assert(i5.length>100);assert(i5.every(c=>c.road==='I-5'));const miles=i5.filter(c=>Number.isFinite(c.milepost)).map(c=>c.milepost);assert(miles.every((m,i)=>i===0||m>=miles[i-1]));
const around=filterCameras(cameras,{...ALL,road:'I-5',fromMile:'100',toMile:'200'});assert(around.length>0);assert(around.every(c=>c.milepost>=100&&c.milepost<=200));assert.equal(filterCameras(cameras,{...ALL,fromMile:'100'}).length,0);
const elevation=filterCameras(cameras,{...ALL,elevation:'5,000+ ft'});assert(elevation.length>0);assert(elevation.every(c=>c.elevationFeet>=5000));
const district=filterCameras(cameras,{...ALL,district:'District 3'});assert(district.length>0);assert(district.every(c=>c.district==='District 3'));assert.equal(facet(cameras,{...ALL,district:'District 3'},'county').reduce((s,[,n])=>s+n,0),district.filter(c=>c.county).length);
assert.equal(filterCameras(cameras,{...ALL,query:'a phrase that will never appearzzzyx'}).length,0);assert(filterCameras(cameras,{...ALL,query:cameras[0].id}).some(c=>c.id===cameras[0].id));
const noCoords=prepareCameras([{id:'test',name:'Missing location',lat:null,lon:null,imageUrl:'https://example.com/image.jpg'}]);assert.equal(filterCameras(noCoords,ALL).length,1);assert.equal(filterCameras(noCoords,{...ALL,withinMap:true},{south:32,north:43,west:-125,east:-113}).length,0);assert(!validCoordinates(noCoords[0]));
const same=prepareCameras([{id:'a',name:'A',siteId:'shared',road:'I-5',milepost:3},{id:'b',name:'B',siteId:'shared',road:'I-5',milepost:3},{id:'bad',name:'Unknown',road:'I-5',milepost:null}]);assert.equal(same.length,3);assert.equal(same.at(-1).id,'bad');
const checkedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString(),oldExpiry=new Date(Date.now()-1000).toISOString();
const checked=(status,verificationMethod,expiry=expiresAt)=>({status,verificationMethod,checkedAt,expiresAt:expiry});
const healthCases=prepareCameras([
  {id:'snapshot-works-video-fails',imageUrl:'https://example.com/a.jpg',videoUrl:'https://example.com/a.m3u8',mediaHealth:{snapshot:checked('available','image-decoded'),video:checked('unavailable','ffmpeg-decoded-segment')}},
  {id:'video-decoded-snapshot-fails',imageUrl:'https://example.com/b.jpg',videoUrl:'https://example.com/b.m3u8',mediaHealth:{snapshot:checked('unavailable','image-decoded'),video:checked('available','ffmpeg-decoded-segment')}},
  {id:'manifest-only',videoUrl:'https://example.com/c.m3u8',mediaHealth:{video:checked('available','hls-manifest-only')}},
  {id:'expired',imageUrl:'https://example.com/d.jpg',mediaHealth:{snapshot:checked('available','image-decoded',oldExpiry)}},
  {id:'official',officialUrl:'https://example.com/viewer'},
  {id:'provider-out',sourceDisabled:true,imageUrl:'https://example.com/out.jpg'},
  {id:'provider-video-works',sourceDisabled:true,disabled:true,videoUrl:'https://example.com/provider-video.m3u8',mediaHealth:{video:checked('available','ffmpeg-decoded-segment')}},
  {id:'known-placeholder',imageUrl:'https://example.com/placeholder.jpg',videoUrl:'https://example.com/unchecked.m3u8',mediaHealth:{snapshot:{...checked('unavailable','image-decoded'),failureCategory:'placeholder'}}},
  {id:'provider-conflict',sourceDisabled:true,imageUrl:'https://example.com/e.jpg',mediaHealth:{snapshot:checked('available','image-decoded')}}
]);
const byId=id=>healthCases.find(c=>c.id===id);
assert(availabilityMatch(byId('snapshot-works-video-fails'),'working'));
assert(!availabilityMatch(byId('snapshot-works-video-fails'),'video'),'a working JPG must not qualify failed video');
assert(availabilityMatch(byId('video-decoded-snapshot-fails'),'video'));
assert(!availabilityMatch(byId('video-decoded-snapshot-fails'),'working'),'source-decoded segments do not prove browser playback');
byId('video-decoded-snapshot-fails').sessionHealth={video:checked('available','browser-playback')};
assert(availabilityMatch(byId('video-decoded-snapshot-fails'),'working'),'advancing playback in this session qualifies');
assert(availabilityMatch(byId('manifest-only'),'unchecked'));
assert(!availabilityMatch(byId('manifest-only'),'video'));
assert(mediaCheck(byId('expired'),'snapshot').expired);
assert(availabilityMatch(byId('expired'),'unchecked'));
assert(availabilityMatch(byId('official'),'official'));
assert(availabilityMatch(byId('provider-out'),'unavailable'),'provider service metadata is a separate unavailable reason');
assert(availabilityMatch(byId('provider-video-works'),'video'));
assert(!availabilityMatch(byId('provider-video-works'),'unavailable'),'source-decoded video outranks provider metadata for camera health');
assert(availabilityMatch(byId('known-placeholder'),'unavailable'),'known maintenance image is unavailable even if a separate video URL is unchecked');
assert(availabilityMatch(byId('provider-conflict'),'working'),'successful media outranks stale provider service metadata');
assert.equal(filterCameras(healthCases,{...ALL,availability:'working'}).length,3);
assert.deepEqual(summarizeHealth(healthCases),{workingViews:3,decodedSnapshotViews:2,browserPlayedVideoViews:1,sourceDecodedVideoViews:2},'browser playback does not erase independent source-audit counts');
byId('snapshot-works-video-fails').sessionHealth={snapshot:checked('unavailable','browser-snapshot-failed')};
assert(!availabilityMatch(byId('snapshot-works-video-fails'),'working'),'a failed browser decode overrides a dated success for this visit');
byId('snapshot-works-video-fails').sessionHealth={snapshot:checked('unavailable','browser-snapshot-failed',oldExpiry)};
assert(availabilityMatch(byId('snapshot-works-video-fails'),'working'),'expired session failure falls back to still-current dated audit');
const library=normalizeLibrary({boards:[{id:'x',name:'Road <script>',cameraIds:[cameras[0].id,cameras[0].id,'<script>','unknown:id']}]});assert.deepEqual(library.boards[0].cameraIds,[cameras[0].id,'unknown:id']);assert.equal(library.boards[0].name,'Road <script>');
const payload={version:1,boards:library.boards};assert.deepEqual(decodeShare(encodeShare(payload)),payload);assert.throws(()=>decodeShare('x'.repeat(27000)));assert.throws(()=>encodeShare({name:'x'.repeat(20000)}));mergeLibrary(library,payload);assert.equal(library.boards.length,2);assert.notEqual(library.boards[0].id,library.boards[1].id);assert.equal(normalizeLibrary({boards:[]}).boards.length,1);
const conditionRows=parseControls({data:[{cc:{index:'1',location:{route:'I-80',locationName:'Pass',county:'Placer'},recordTimestamp:{recordDate:'2026-11-03',recordTime:'16:00:00'},statusData:{status:'R-0',statusDescription:'No chain controls',statusTimestamp:{statusDate:'2023-01-01',statusTime:'12:00:00'}}}},{cc:{index:'2',location:{route:'US-50'},statusData:{status:'R-2',statusDescription:'Chains required'}}}]});assert.equal(conditionRows[0].status,'R-2');assert(conditionRows[1].recordTime.includes('2026-11-03'));assert(conditionRows[1].changedTime.includes('2023-01-01'));assert.equal(sourceTimestamp(null),'Not reported');assert.throws(()=>parseControls({}));
const html=await readFile(new URL('index.html',root),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"#]*)?"/g)){const path=match[1];if(/^(?:https?:|data:|\.\.\/)/.test(path)||path==='./')continue;if(path==='README.md')continue;await readFile(new URL(path,root));}
assert(html.includes('25 views per page'));assert(html.includes('Search this area'));assert(html.includes('aria-label="Camera pages"'));const app=await readFile(new URL('app.js',root),'utf8');assert(app.includes('const $=id=>document.getElementById(id),PAGE_SIZE=25'));assert(!app.includes('innerHTML=error'));
console.log(`PASS: ${cameras.length} views, 12 districts, IDs, geographic filtering, highway ordering, elevation, facets, boards/import/share bounds and static assets.`);
