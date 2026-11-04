import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCameras,filterCameras,getFacet,orderCorridor,sliceCorridor} from '../filters.js';
import {cleanBoard,normalizeLibrary,mergeLibrary,encodeShare,decodeShare,tripShare} from '../boards.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const catalog=JSON.parse(read('camera-catalog.json'));
const cameras=prepareCameras(catalog.cameras);
assert.equal(cameras.length,catalog.cameras.length,'No catalog entries silently discarded');
assert.equal(cameras.length,catalog.viewCount);
assert.equal(new Set(cameras.map(c=>c.id)).size,cameras.length);
assert.equal(new Set(cameras.map(c=>c.siteId)).size,catalog.locationCount);
assert.equal(cameras.filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon)).length,catalog.geocodedCount);
assert.equal(cameras.filter(c=>!Number.isFinite(c.lat)||!Number.isFinite(c.lon)).length,catalog.unmappedCount);
for(const c of cameras){
 assert.equal(c.id,String(c.publishedImageId));assert.ok(c.name&&c.road&&c.metro&&c.region);
 assert.equal(new URL(c.imageUrl).hostname,'www.tripcheck.com');assert.equal(new URL(c.imageUrl).protocol,'https:');
 assert.equal(new URL(c.officialUrl).protocol,'https:');assert.equal(c.refreshSeconds,300);
 assert.equal(c.captureAt,null,'Do not invent source capture timestamps');assert.equal(c.videoUrl,null,'Rapid-image official sessions are not embedded video');
 if(c.direction)assert.ok(['NB','SB','EB','WB','N','S','E','W','NE','NW','SE','SW'].includes(c.direction));
}
const fixture=prepareCameras([
 {id:'a',name:'OR22 Santiam Pass NB',siteId:'site1',road:'OR-22',roads:['OR-22'],region:'Central',regions:['Central','West'],metro:'Sisters',county:'Deschutes County',direction:'NB',physicalState:'OR',milepoint:80,lat:44.4,lon:-121.8,embedMode:'image',imageStatus:'available'},
 {id:'b',name:'OR22 crossing US20',siteId:'site1',road:'US-20',roads:['US-20','OR-22'],region:'Central',metro:'Sisters',county:'Deschutes',direction:'SB',physicalState:'OR',milepoint:81,lat:44.4,lon:-121.8,embedMode:'image',imageStatus:'unavailable'},
 {id:'c',name:'Coastal camera',siteId:'site2',road:'US-101',region:'Coast',metro:'Newport',county:'Lincoln',direction:'',physicalState:'OR',milepoint:null,lat:44.6,lon:-124.0,embedMode:'official',imageStatus:'unchecked'},
 {id:'d',name:'Unmapped camera',siteId:'site3',road:'OR-22',region:'Unknown',metro:'Unknown',lat:null,lon:null,embedMode:'image',imageStatus:'unchecked'},
]);
const ids=rows=>rows.map(c=>c.id).sort();
const orderedIds=rows=>rows.map(c=>c.id);
const corridorFixture=['a','b','c','d'].map(id=>fixture.find(c=>c.id===id));
assert.deepEqual(ids(filterCameras(fixture,{query:'ORE 22 santiam'})),['a']);
assert.deepEqual(ids(filterCameras(fixture,{query:'OR22 santiam'})),['a'],'Compact route names are searchable');
assert.deepEqual(ids(filterCameras(fixture,{region:'West'})),['a'],'All listed region aliases remain discoverable');
assert.deepEqual(ids(filterCameras(fixture,{road:'OR-22',direction:'SB'})),['b']);
assert.deepEqual(ids(filterCameras(fixture,{mediaType:'official'})),['c']);
assert.deepEqual(ids(filterCameras(fixture,{favorites:true},new Set(['b','unknown']))),['b']);
assert.deepEqual(ids(filterCameras(fixture,{withinMap:true},new Set(),{south:44.3,north:44.5,west:-122,east:-121})),['a','b'],'Unmapped entries stay out of spatial matches');
assert.equal(filterCameras(fixture,{}).length,4,'Unmapped entries stay in ordinary lists');
assert.equal(getFacet(fixture,'road',{}).find(([v])=>v==='OR-22')[1],3);
assert.deepEqual(getFacet(fixture,'county',{metro:'Sisters',county:'Lincoln',road:'US-101'}),[['Deschutes',2]],'County facet clears incompatible narrower selections');
const primaryRoadFixture=corridorFixture.slice(0,2).map(c=>({...c,road:'OR-22'}));
const ordered=orderCorridor(primaryRoadFixture,'OR-22');assert.match(ordered.basis,/milepoint/);assert.deepEqual(orderedIds(ordered.cameras),['a','b']);
assert.deepEqual(orderedIds(orderCorridor(primaryRoadFixture,'OR-22',true).cameras),['b','a']);
assert.deepEqual(ids(sliceCorridor(corridorFixture,'b','c')),['b','c']);
assert.deepEqual(ids(sliceCorridor(corridorFixture,'c','a')),['a','b','c']);
assert.match(orderCorridor([{...corridorFixture[0],physicalState:'OR'},{...corridorFixture[1],physicalState:'WA'}],'I-5').basis,/geographic/i,'Never compare milepoints across state systems');
assert.match(orderCorridor([corridorFixture[0],{...corridorFixture[1],milepoint:undefined}],'OR-22').basis,/geographic/i);
assert.match(orderCorridor(corridorFixture.slice(0,2),'OR-22').basis,/geographic/i,'Do not compare milepoints belonging to different primary roads');
const library=normalizeLibrary({boards:[{id:'mine',name:'雪 / Siskiyou',cameraIds:['a','a','b','https://evil.test/image.jpg']}],activeBoardId:'mine'});
assert.deepEqual(library.boards[0].cameraIds,['a','b'],'Only IDs are imported; arbitrary URLs are rejected');
assert.equal(decodeShare(encodeShare(library)).boards[0].name,'雪 / Siskiyou','Unicode survives sharing');
assert.equal(cleanBoard({cameraIds:null}),null);
const before=JSON.stringify(library);assert.throws(()=>mergeLibrary(library,{boards:[{cameraIds:['x']},{cameraIds:null}]}));assert.equal(JSON.stringify(library),before,'Invalid import is atomic');
assert.equal(mergeLibrary(library,{boards:[{id:'mine',name:'Other',cameraIds:['c']}]}),1);assert.equal(library.boards.length,2);assert.notEqual(library.boards[1].id,'mine');assert.deepEqual(library.boards[0].cameraIds,['a','b'],'Import preserves existing boards');
assert.equal(normalizeLibrary({boards:Array.from({length:50},(_,i)=>({id:String(i),cameraIds:[]}))}).boards.length,30);
assert.equal(cleanBoard({cameraIds:Array.from({length:600},(_,i)=>String(i))}).cameraIds.length,500);
assert.deepEqual(tripShare({name:'Board',cameraIds:['533']}),{type:'board',board:{name:'Board',cameraIds:['OR:tripcheck:533']}});
assert.throws(()=>decodeShare('a'.repeat(18001)));
assert.throws(()=>encodeShare({x:'a'.repeat(13000)}));
const html=read('index.html'),app=read('app.js');
const htmlIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(htmlIds).size,htmlIds.length);
for(const [,id]of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(htmlIds.includes(id),'Missing DOM target '+id);
for(const [,url]of html.matchAll(/(?:src|href)="([^"#]+)"/g)){if(/^(https?:|data:)/.test(url))continue;assert.ok(existsSync(resolve(root,'.',url.split(/[?#]/)[0])),'Missing asset '+url);}
const nav=html.match(/<nav class="state-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
const navUrls=[...nav.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(navUrls).size,navUrls.length);assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
for(const slug of ['wv511-camera-desk','ohio-road-atlas','pennsylvania-camera-desk','virginia-camera-desk','texas-camera-desk','maryland-camera-desk','arizona-camera-desk','dc-camera-desk','new-york-camera-desk','washington-camera-desk','oregon-camera-desk','trip-camera-desk'])assert.ok(navUrls.includes(`https://whardy.github.io/sandbox/${slug}/`));
assert.ok(!/texas-camera-relay|chatgpt\.site|api[-_]?key\s*[:=]/i.test(app),'No unrelated relay or credentials');
const pages=Array.from({length:Math.ceil(cameras.length/25)},(_,i)=>cameras.slice(i*25,i*25+25));assert.equal(new Set(pages.flat().map(c=>c.id)).size,cameras.length);
if(existsSync(resolve(root,'source-audit.json'))){const audit=JSON.parse(read('source-audit.json'));const rows=audit.checks||audit.cameras||audit.results||[];assert.equal(rows.length,cameras.length,'Audit covers every published view');assert.equal(new Set(rows.map(c=>c.id)).size,cameras.length);assert.ok(!rows.some(r=>/CERTIFICATE_VERIFY_FAILED/i.test(r.error||'')),'A local certificate failure is not a valid provider audit');}
console.log(`Passed: ${cameras.length} Oregon views, stable IDs, region/road/direction/media/spatial filters, corridor ordering, local boards and safe import/sharing, pagination, assets, navigation.`);
