import assert from 'node:assert/strict';
import {prepareRoute,validPosition,haversine,extractRouteRefs,projectPointOnRoute,pointAtDistance,matchRouteCameras,coverageGaps,representativeCameras} from '../geometry.js';
import {decodePolyline,normalizeValhallaTrip,normalizeOSRMRoute,calculateRoutes,searchPlaces} from '../routing.js';

const route=prepareRoute({id:'straight',coordinates:[[-83,40],[-82,40],[-81,40]],distanceMeters:170000,durationSeconds:400,segments:[{startIndex:0,endIndex:1,roadNames:['Interstate 70'],routeRefs:['I-70'],durationSeconds:100},{startIndex:1,endIndex:2,roadNames:['I 70'],routeRefs:['I-70'],durationSeconds:300}]});
assert.ok(validPosition({lat:0,lon:0}));assert.ok(!validPosition({lat:null,lon:null}));
assert.ok(!validPosition({lat:'40',lon:-82}));
assert.ok(haversine([-83,40],[-82,40])>85000);
assert.deepEqual(extractRouteRefs(['Interstate 70','US 50','Maryland Route 32','Ohio 7']),['I-70','US-50','MD-32','OH-7']);
assert.deepEqual(extractRouteRefs(['NY 9A','New York Route 17','I-90']),['NY-9A','NY-17','I-90']);
assert.deepEqual(extractRouteRefs(['CA 99','California Route 58','I-5']),['CA-99','CA-58','I-5']);
assert.deepEqual(extractRouteRefs(['OR 22','ORE 58','Oregon Route 126','Washington Route 14','WA-500']),['OR-22','OR-58','OR-126','WA-14','WA-500']);
assert.throws(()=>prepareRoute({coordinates:[[0,0],[0,0]]}),/zero length/);
assert.throws(()=>prepareRoute({coordinates:[[0,0],[181,0]]}),/invalid coordinate/);
assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@',5),[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]);
assert.throws(()=>decodePolyline('_p~iF~ps|'),/Invalid route geometry/);

const near=projectPointOnRoute(route,{lat:40.005,lon:-82.5});
assert.ok(Math.abs(near.alongMeters-42500)<10);
assert.ok(near.offsetMeters>550&&near.offsetMeters<565);
assert.ok(Math.abs(near.etaSeconds-50)<0.1,'Maneuver travel times, not whole-trip uniform speed');
const later=projectPointOnRoute(route,{lat:40,lon:-81.5});
assert.ok(Math.abs(later.etaSeconds-250)<0.1);
assert.equal(projectPointOnRoute(route,{lat:41,lon:-82},{maxDistanceMeters:1000}),null);
assert.deepEqual(pointAtDistance(route,-20),{lon:-83,lat:40,timeSeconds:0});
assert.deepEqual(pointAtDistance(route,200000),{lon:-81,lat:40,timeSeconds:400});
assert.ok(Math.abs(pointAtDistance(route,85000).lon+82)<1e-8);
assert.ok(Math.abs(pointAtDistance(route,85000).timeSeconds-100)<1e-8);

const cameras=[
 {id:'OH:1',state:'OH',road:'I-70',routeRefs:['I-70'],primaryRouteRefs:['I-70'],lat:40,lon:-82.8,directionBearing:90,imageStatus:'available'},
 {id:'WV:1',state:'WV',road:'I-70',routeRefs:['I-70'],primaryRouteRefs:['I-70'],lat:40,lon:-81.7,directionBearing:270,imageStatus:'available'},
 {id:'crossing',state:'OH',road:'US-50',routeRefs:['US-50','I-70'],primaryRouteRefs:['US-50'],lat:40.001,lon:-82.5},
 {id:'missing',state:'PA',road:'I-70',routeRefs:['I-70'],lat:null,lon:null},
 {id:'far',state:'PA',road:'I-70',routeRefs:['I-70'],lat:41,lon:-82.2},
 {id:'street',state:'OH',road:'High Street',routeRefs:['I-70'],primaryRouteRefs:[],lat:40,lon:-82.4}
];
const matches=matchRouteCameras(cameras,route,{corridorMeters:1600});
assert.deepEqual(matches.map(c=>c.id),['OH:1','crossing','street','WV:1']);
assert.equal(matches[0].routeMatch,'road');
assert.match(matches.find(c=>c.id==='WV:1').routeMatchLabel,/opposite travel direction/);
assert.equal(matches.find(c=>c.id==='crossing').routeMatch,'nearby','Secondary crossing ref cannot claim road match');
assert.equal(matches.find(c=>c.id==='street').routeMatch,'uncertain');
assert.ok(!matchRouteCameras(cameras,route,{corridorMeters:1600,direction:'same'}).some(c=>c.id==='WV:1'));
assert.ok(matches.every((c,i)=>i===0||c.routeDistanceMeters>=matches[i-1].routeDistanceMeters));

const loop=prepareRoute({coordinates:[[-83,40],[-82,40],[-82,41],[-83,41],[-83,40]],durationSeconds:1000});
assert.equal(projectPointOnRoute(loop,{lon:-83,lat:40}).alongMeters,0,'A revisited location is assigned to first encounter deterministically');
const gapRoute=prepareRoute({coordinates:[[0,0],[1,0]],distanceMeters:100000,durationSeconds:1000});
assert.deepEqual(coverageGaps(gapRoute,[{routeDistanceMeters:25000},{routeDistanceMeters:75000}],{radiusMeters:10000,minGapMeters:20000}),[{startMeters:35000,endMeters:65000,lengthMeters:30000}]);
assert.deepEqual(coverageGaps(gapRoute,[],{minGapMeters:1}),[{startMeters:0,endMeters:100000,lengthMeters:100000}]);
const representatives=representativeCameras(matches,{intervalMeters:100000,route});
assert.ok(representatives.length<matches.length);
assert.ok(representatives.every((c,i)=>i===0||c.routeDistanceMeters>=representatives[i-1].routeDistanceMeters));

// Full server responses may be supplied as fixtures without another request.
if(process.env.TRIP_ROUTE_FIXTURE){
 const {readFileSync}=await import('node:fs');const response=JSON.parse(readFileSync(process.env.TRIP_ROUTE_FIXTURE,'utf8'));
 const real=normalizeValhallaTrip(response.trip);assert.ok(real.coordinates.length>2);assert.ok(real.distanceMeters>0);assert.ok(real.durationSeconds>0);
 const middle=pointAtDistance(real,real.distanceMeters/2);const projection=projectPointOnRoute(real,middle);
 assert.ok(Math.abs(projection.alongMeters-real.distanceMeters/2)<100);assert.ok(projection.etaSeconds>0&&projection.etaSeconds<real.durationSeconds);
 console.log(`Fixture passed: ${real.coordinates.length} coordinates, ${(real.distanceMeters/1000).toFixed(1)} km, ${real.segments.length} timed maneuvers.`);
}
if(process.env.TRIP_OSRM_FIXTURE){
 const {readFileSync}=await import('node:fs');const response=JSON.parse(readFileSync(process.env.TRIP_OSRM_FIXTURE,'utf8'));
 const real=normalizeOSRMRoute(response.routes[0]);assert.ok(real.coordinates.length>2);assert.ok(real.distanceMeters>0);assert.ok(real.durationSeconds>0);
 const midpoint=pointAtDistance(real,real.distanceMeters/2);assert.ok(midpoint.timeSeconds>0&&midpoint.timeSeconds<real.durationSeconds);
 const end=pointAtDistance(real,real.distanceMeters);assert.ok(Math.abs(end.timeSeconds-real.durationSeconds)<1);
 console.log(`OSRM fixture passed: ${real.coordinates.length} coordinates, ${(real.distanceMeters/1000).toFixed(1)} km, ${real.segments.length} timed steps.`);
}

if(process.argv.includes('--live')){
 const places=await searchPlaces('Columbus Ohio');assert.ok(places.some(p=>p.label.includes('Ohio')));
 const cases=[
  ['short DC',[{lat:38.9072,lon:-77.0369},{lat:38.8895,lon:-77.0353}],{}],
  ['OH → WV → DC',[{lat:39.9612,lon:-82.9988},{lat:40.06396,lon:-80.72091},{lat:38.9072,lon:-77.0369}],{avoidTolls:true}],
  ['Phoenix → Washington DC',[{lat:33.4484,lon:-112.0740},{lat:38.9072,lon:-77.0369}],{}]
 ];
 for(const [name,points,options]of cases){const result=await calculateRoutes(points,options);assert.ok(result.routes.length);assert.ok(result.routes.every(r=>r.distanceMeters>0&&r.coordinates.length>2&&!r.trafficAware));console.log(`${name}: ${result.routes.length} route(s), ${(result.routes[0].distanceMeters/1000).toFixed(1)} km; ${result.warnings.join(' ')}`);}
}
console.log('Passed route geometry, timed interpolation, cross-state identity, direction/road uncertainty, coverage gaps, representative selection, missing coordinates, and loop handling.');
