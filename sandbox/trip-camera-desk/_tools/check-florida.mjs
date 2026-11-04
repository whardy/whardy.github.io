import assert from 'node:assert/strict';
import {floridaRouteRegions,pointInFlorida} from '../florida.js';
import {extractRouteRefs,normalizeRouteRef,prepareRoute,matchRouteCameras,coverageGaps} from '../geometry.js';

const regions=coordinates=>floridaRouteRegions({coordinates});
assert.deepEqual(regions([[-82.45,27.95],[-81.38,28.54]]),['tampa-bay','central']);
assert.deepEqual(regions([[-87.2,30.42],[-81.65,30.33]]),['panhandle','northeast']);
assert.deepEqual(regions([[-80.19,25.77],[-81.79,24.56]]),['southeast','keys']);
assert.deepEqual(regions([[-77.04,38.90],[-84.39,33.75]]),[]);
assert.deepEqual(regions([[-86.78,36.17],[-82.99,39.96]]),[]);
assert.deepEqual(regions([[-83.28,30.83]]),[]); // Valdosta, Georgia
assert.deepEqual(regions([]),[]);
assert.ok(pointInFlorida(-82.45,27.95));
assert.ok(!pointInFlorida(-83.28,30.83));
assert.equal(normalizeRouteRef('Florida State Road 46'),'FL-46');
assert.deepEqual(extractRouteRefs('I-95 at US-1 and County Road 210'),['I-95','US-1','CR-210']);
assert.equal(normalizeRouteRef("Florida's Turnpike"),'FL-TURNPIKE');
assert.deepEqual(extractRouteRefs('Florida’s Turnpike at FL-CR-210'),['CR-210','FL-TURNPIKE','FL-CR-210']);
assert.equal(normalizeRouteRef('Florida State Road A1A'),'FL-A1A');
assert.deepEqual(extractRouteRefs('FL A1A / State Road A1A'),['FL-A1A','SR-A1A']);

const route=prepareRoute({coordinates:[[-82.45,27.95],[-82.2,28.09],[-81.8,28.31],[-81.38,28.54]],distanceMeters:160000,durationSeconds:7200,segments:[{startIndex:0,endIndex:3,roadNames:['I-4'],routeRefs:['I-4'],durationSeconds:7200}]});
const cameras=[
  {id:'FL:fdot:D07:100:EB',state:'FL',lat:28.09,lon:-82.2,road:'I-4',primaryRouteRefs:['I-4'],routeRefs:['I-4'],direction:'Eastbound',directionBearing:90,directionConfidence:'verified'},
  {id:'FL:fdot:D07:100:WB',state:'FL',lat:28.09,lon:-82.2,road:'I-4',primaryRouteRefs:['I-4'],routeRefs:['I-4'],direction:'Westbound',directionBearing:270,directionConfidence:'verified'},
  {id:'FL:fdot:D05:200',state:'FL',lat:28.31,lon:-81.8,road:'US-92',primaryRouteRefs:['US-92'],routeRefs:['US-92','I-4'],direction:'',directionBearing:null},
  {id:'FL:fdot:D05:missing',state:'FL',lat:null,lon:null,road:'I-4',primaryRouteRefs:['I-4'],routeRefs:['I-4']},
];
const matched=matchRouteCameras(cameras,route,{corridorMeters:2000});
assert.deepEqual(matched.map(camera=>camera.id),cameras.slice(0,3).map(camera=>camera.id));
assert.equal(matched[0].routeMatch,'road');
assert.match(matched[1].routeMatchLabel,/opposite travel direction/);
const uncertainDirection=matchRouteCameras([{...cameras[1],directionConfidence:'uncertain'}],route,{corridorMeters:2000});
assert.match(uncertainDirection[0].routeMatchLabel,/direction unverified/);
assert.equal(matched[2].routeMatch,'nearby');
assert.ok(matched[0].routeTimeSeconds<matched[2].routeTimeSeconds);
assert.ok(coverageGaps(route,matched,{radiusMeters:1609,minGapMeters:3200}).length>0);

const georgiaRoute=prepareRoute({coordinates:[[-83.05,30.625],[-82.95,30.625]],distanceMeters:10000,durationSeconds:600,segments:[{startIndex:0,endIndex:1,roadNames:['State Road 4'],routeRefs:['SR-4'],durationSeconds:600}]});
const nearBorder={id:'FL:fdot:D02:border',state:'FL',lat:30.615,lon:-83,road:'FL-4',primaryRouteRefs:['FL-4'],routeRefs:['FL-4']};
assert.ok(pointInFlorida(nearBorder.lon,nearBorder.lat));
assert.deepEqual(matchRouteCameras([nearBorder],georgiaRoute,{corridorMeters:2000}),[],'Nearby Georgia route must not receive a Florida camera');
console.log('Florida boundary, road, directional view, route ordering, gap, and Georgia exclusion checks passed.');
