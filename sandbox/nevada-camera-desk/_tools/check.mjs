import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCameras,filterCameras,facet,EMPTY_FILTERS} from '../filters.js';
import {normalizeLibrary,encodeShare,decodeShare} from '../store.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(resolve(root,file),'utf8');
const catalog=JSON.parse(read('camera-catalog.json'));
const audit=JSON.parse(read('source-audit.json'));
const cameras=prepareCameras(catalog.cameras);
assert.equal(cameras.length,catalog.counts.views);
assert.ok(cameras.length>=300);
assert.equal(new Set(cameras.map(c=>c.id)).size,cameras.length);
assert.equal(new Set(cameras.map(c=>c.viewId)).size,cameras.length);
assert.equal(new Set(cameras.map(c=>c.siteId)).size,catalog.counts.sourceLocations);
assert.equal(cameras.filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon)).length,catalog.counts.withCoordinates);
assert.ok(cameras.some(c=>c.county==='Carson City'));
assert.ok(cameras.some(c=>c.road==='I-11')&&cameras.some(c=>c.road==='I-515'));
assert.ok(cameras.some(c=>c.road==='I-215')&&cameras.some(c=>c.road==='CC-215'));
assert.ok(cameras.every(c=>c.id===`nv511:${c.viewId}`&&c.siteId===`nv511:${c.parentId}`));
assert.ok(cameras.every(c=>c.directionType==='camera-facing'));
for(const c of cameras){
  for(const key of ['imageUrl','videoUrl','officialUrl'])if(c[key]){
    const url=new URL(c[key]);assert.equal(url.protocol,'https:');assert.ok(!url.username&&!url.password);
  }
  assert.ok(c.road&&c.name&&c.county&&c.metro);
}
assert.equal(filterCameras(cameras,{...EMPTY_FILTERS}).length,cameras.length);
assert.ok(filterCameras(cameras,{...EMPTY_FILTERS,road:'I-80'}).length>30);
assert.ok(filterCameras(cameras,{...EMPTY_FILTERS,query:'Wendover'}).length>0);
assert.ok(facet(cameras,{...EMPTY_FILTERS,county:'Carson City'},'road').length>0);
assert.equal(filterCameras(cameras,{...EMPTY_FILTERS,query:'no-camera-has-this-string'}).length,0);
const board={id:'test',name:'Nevada test',cameraIds:[cameras[0].id]};
assert.deepEqual(decodeShare(encodeShare({version:1,boards:[board]})).boards[0],board);
const library=normalizeLibrary({boards:[board]});assert.equal(library.boards[0].cameraIds[0],board.cameraIds[0]);
assert.equal(audit.totalViews,cameras.length);
assert.ok(audit.results.every(r=>cameras.some(c=>c.id===r.id)));
const html=read('index.html'),app=read('app.js');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
for(const [,id]of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(id),`Missing ${id}`);
for(const [,href]of html.matchAll(/(?:src|href)="([^"#]+)"/g))if(!/^(?:https?:|data:)/.test(href)){
  const path=href.split(/[?#]/)[0];if(!path.startsWith('../'))assert.ok(existsSync(resolve(root,path)),`Missing ${href}`);
}
assert.ok(html.includes('25 views per page')&&app.includes('const PAGE_SIZE = 25'));
console.log(`Nevada catalog and UI checks passed: ${cameras.length} views, ${catalog.counts.sourceLocations} source locations, ${audit.sampleSize} dated media samples.`);
