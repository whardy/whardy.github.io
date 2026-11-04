import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {calculateRoutes} from '../routing.js';
import {statesAlongRoute} from '../catalog.js';
import {prepareRoute,matchRouteCameras,coverageGaps,representativeCameras} from '../geometry.js';
import {floridaRouteRegions} from '../florida.js';

// Live, user-triggered validation. The routing adapter spaces FOSSGIS requests;
// this script downloads no camera media and stores only route summaries.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const index=JSON.parse(readFileSync(join(root,'data/index.json'),'utf8'));
const cases=[
  ['Tampa → Orlando',[[27.9506,-82.4572],[28.5384,-81.3789]]],
  ['Miami → Key West',[[25.7617,-80.1918],[24.5551,-81.7800]]],
  ['Jacksonville → Miami',[[30.3322,-81.6557],[25.7617,-80.1918]]],
  ['Pensacola → Jacksonville',[[30.4213,-87.2169],[30.3322,-81.6557]]],
  ['Miami → Washington, DC',[[25.7617,-80.1918],[38.9072,-77.0369]]],
  ['Downtown Miami → Miami Beach',[[25.7617,-80.1918],[25.7907,-80.1300]]],
  ['Apalachicola → Perry',[[29.7258,-84.9832],[30.1174,-83.5818]]],
  ['Valdosta → Macon, Georgia',[[30.8327,-83.2785],[32.8407,-83.6324]]],
  ['Orlando → Sanford via I-4',[[28.5384,-81.3789],[28.8029,-81.2695]],{avoidTolls:true}],
];
const shards=new Map();
function camerasFor(codes){
  return codes.flatMap(code=>{
    if(!shards.has(code))shards.set(code,JSON.parse(readFileSync(join(root,'data',`${code}.json`),'utf8')).cameras);
    return shards.get(code);
  });
}
const summaries=[];
for(const [name,coords,options={}] of cases){
  const points=coords.map(([lat,lon])=>({lat,lon}));
  const result=await calculateRoutes(points,{alternatives:false,...options});
  assert.ok(result.routes.length,name);
  const route=prepareRoute(result.routes[0]);
  const states=statesAlongRoute(index,route,1609.344);
  const matches=matchRouteCameras(camerasFor(states),route,{corridorMeters:1609.344});
  assert.ok(matches.every((camera,i)=>i===0||camera.routeDistanceMeters>=matches[i-1].routeDistanceMeters),`${name}: camera order`);
  assert.ok(matches.every(camera=>Number.isFinite(camera.routeTimeSeconds)),`${name}: route elapsed time`);
  const gaps=coverageGaps(route,matches,{radiusMeters:1609.344,minGapMeters:3218.688});
  const representatives=representativeCameras(matches,{intervalMeters:16093.44,route});
  const florida=matches.filter(camera=>camera.state==='FL');
  const directionalPairIds=['FL:fdot-d5:865','FL:fdot-d5:5918'];
  const summary={name,provider:route.provider,distanceKm:Math.round(route.distanceMeters/100)/10,durationMinutes:Math.round(route.durationSeconds/60),ordinaryEstimate:route.trafficAware!==true,warnings:result.warnings||[],loadedStates:states,floridaRegions:floridaRouteRegions(route),views:matches.length,floridaViews:florida.length,floridaRoadMatches:florida.filter(camera=>camera.routeMatch==='road').length,floridaNearbyOrUncertain:florida.filter(camera=>camera.routeMatch!=='road').length,oppositeDirection:florida.filter(camera=>/opposite travel direction/.test(camera.routeMatchLabel)).length,representativeViews:representatives.length,coverageGaps:gaps.length,gapKilometers:Math.round(gaps.reduce((sum,gap)=>sum+gap.lengthMeters,0)/100)/10,firstFloridaIds:florida.slice(0,8).map(camera=>camera.id),directionalPairMatched:directionalPairIds.filter(id=>florida.some(camera=>camera.id===id))};
  summaries.push(summary);
  console.log(`${name}: ${route.provider}, ${summary.distanceKm} km, ${summary.floridaViews} FL views, ${summary.coverageGaps} gaps`);
}
assert.ok(summaries[0].floridaViews>0,'Tampa–Orlando should include Florida cameras');
assert.ok(summaries[1].floridaViews>0,'Miami–Key West should include Florida cameras');
assert.ok(summaries[2].floridaViews>0,'Jacksonville–Miami should include Florida cameras');
assert.ok(summaries[3].floridaViews>0,'Pensacola–Jacksonville should include Florida cameras');
assert.ok(summaries[4].floridaViews>0,'Florida–DC should retain Florida cameras');
assert.ok(summaries[7].coverageGaps>0&&summaries[7].floridaViews===0,'Georgia-only route should retain a genuine coverage gap');
assert.deepEqual(summaries[8].directionalPairMatched,['FL:fdot-d5:865','FL:fdot-d5:5918'],'Orlando–Sanford route should retain both directional views at one source location');
const report={checkedAt:new Date().toISOString(),note:'Real driving routes and ordinary estimates, without live traffic. Counts use listed camera locations within one mile; they do not establish the road a camera overlooks or prove continuous visual coverage.',summaries};
const output=join(root,'docs/florida-route-validation.json');
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(`Wrote ${output}`);
