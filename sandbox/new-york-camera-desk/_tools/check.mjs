import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCameras, filterCameras, getFacet} from '../filters.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(resolve(root,file),'utf8');
const catalog=JSON.parse(read('camera-catalog.json'));
const cameras=prepareCameras(catalog.cameras);
const audit=JSON.parse(read('source-audit.json'));
assert.ok(cameras.length>=2500);
assert.equal(cameras.length,catalog.cameraCount);
assert.equal(new Set(cameras.map(camera=>camera.id)).size,cameras.length);
assert.equal(catalog.sourceFeatureCount-catalog.excludedFeatureCount<=cameras.length,true);
assert.equal(audit.entries.length,cameras.length);
assert.equal(new Set(audit.entries.map(entry=>entry.id)).size,cameras.length);
assert.equal(new Set(cameras.map(camera=>camera.metro)).size,9);
assert.ok(new Set(cameras.map(camera=>camera.county)).size>=40);
const allowedImageHosts=new Set(['nyctmc.org','public.carsprogram.org']);
const videoHosts=new Set(['s7.nysdot.skyvdn.com','s9.nysdot.skyvdn.com','s51.nysdot.skyvdn.com','s52.nysdot.skyvdn.com','s53.nysdot.skyvdn.com']);
for(const camera of cameras){
  assert.match(camera.id,/^\d+(?::[1-3])?$/);
  assert.ok(camera.name&&camera.metro&&camera.county&&camera.road&&camera.provider);
  assert.ok(camera.lat>=40.4&&camera.lat<=45.1&&camera.lon>=-79.9&&camera.lon<=-71.7);
  const image=new URL(camera.imageUrl),official=new URL(camera.officialUrl);
  assert.equal(image.protocol,'https:');
  assert.ok(allowedImageHosts.has(image.hostname));
  assert.equal(image.search+image.hash+image.username+image.password,'');
  assert.equal(official.href,`https://511ny.org/camera/${camera.sourceId}`);
  if(camera.videoUrl){
    const video=new URL(camera.videoUrl);
    assert.equal(video.protocol,'https:');
    assert.ok(videoHosts.has(video.hostname));
    assert.match(video.pathname,/^\/rtplive\/[A-Za-z0-9_-]+\/playlist\.m3u8$/);
    assert.equal(video.search+video.hash+video.username+video.password,'');
    assert.equal(camera.type,'video');
  }else assert.equal(camera.type,'snapshot');
}
for(const [status,count] of Object.entries(catalog.auditCounts))assert.equal(cameras.filter(c=>c.imageStatus===status).length,count);
for(const [status,count] of Object.entries(catalog.videoAuditCounts))assert.equal(cameras.filter(c=>c.videoUrl&&c.videoStatus===status).length,count);
const empty={query:'',metro:'',county:'',road:'',provider:'',delivery:'',favorites:false,withinMap:false};
const sample=prepareCameras([
  {id:'a',name:'I-87 at Albany',metro:'Capital Region',county:'Albany',road:'I-87',provider:'NYSDOT',lat:42.7,lon:-73.8,imageStatus:'available',videoStatus:'available'},
  {id:'b',name:'Broadway @ 42 St',metro:'New York City',county:'Manhattan',road:'City streets & crossings',provider:'NYC DOT',lat:40.7,lon:-73.9,imageStatus:'available',videoStatus:'none'},
  {id:'c',name:'BQE at Bridge',metro:'New York City',county:'Brooklyn',road:'BQE / I-278',provider:'NYSDOT',lat:40.6,lon:-73.9,imageStatus:'unavailable',videoStatus:'unavailable'},
]);
const ids=rows=>rows.map(camera=>camera.id).sort();
assert.deepEqual(ids(filterCameras(sample,{...empty,query:'albany i-87'})),['a']);
assert.deepEqual(ids(filterCameras(sample,{...empty,provider:'NYC DOT'})),['b']);
assert.deepEqual(ids(filterCameras(sample,{...empty,metro:'New York City',county:'Brooklyn'})),['c']);
assert.deepEqual(ids(filterCameras(sample,{...empty,delivery:'video'})),['a']);
assert.deepEqual(ids(filterCameras(sample,{...empty,delivery:'snapshot'})),['a','b']);
assert.deepEqual(ids(filterCameras(sample,{...empty,delivery:'unavailable'})),['c']);
assert.deepEqual(ids(filterCameras(sample,{...empty,favorites:true},new Set(['b']))),['b']);
assert.deepEqual(ids(filterCameras(sample,{...empty,withinMap:true},new Set(),{south:42.6,north:42.8,west:-73.9,east:-73.7})),['a']);
assert.deepEqual(getFacet(sample,'county',{...empty,metro:'New York City',county:'Albany'}),[['Brooklyn',1],['Manhattan',1]]);
const pages=Array.from({length:Math.ceil(cameras.length/25)},(_,i)=>cameras.slice(i*25,i*25+25));
assert.ok(pages.every(page=>page.length<=25));
assert.equal(new Set(pages.flat().map(camera=>camera.id)).size,cameras.length);
const html=read('index.html'),app=read('app.js');
const domIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert.equal(new Set(domIds).size,domIds.length);
for(const [,id] of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(domIds.includes(id),id);
for(const [,url] of html.matchAll(/(?:src|href)="([^"#]+)"/g))if(!/^(https?:|data:)/.test(url))assert.ok(existsSync(resolve(root,url.split(/[?#]/)[0])),url);
assert.match(app,/const PAGE_SIZE = 25;/);
assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
assert.equal((html.match(/class="state-abbr"/g)||[]).length,9);
assert.doesNotMatch(app,/chatgpt\.site|RELAY_ORIGIN|maryland\.gov/);
console.log(`Passed: ${cameras.length} camera views, 9 areas, ${catalog.excludedFeatureCount} locations excluded, complete audits, source URLs, filters, map bounds, 25/page and assets.`);
