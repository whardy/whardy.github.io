import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {calculateRoutes} from '../../trip-camera-desk/routing.js';
import {matchRouteCameras, pointAtDistance, projectPointOnRoute, coverageGaps, extractRouteRefs} from '../../trip-camera-desk/geometry.js';

// This integration check uses maintained hub shards. Routine operation is offline;
// --live deliberately sends four serialized driving queries to the current adapter.
const root = new URL('../../trip-camera-desk/data/', import.meta.url);
const cameras = ['OR','WA'].flatMap(state => {
  const path = fileURLToPath(new URL(`${state}.json`, root));
  assert.ok(existsSync(path), `Build the ${state} hub shard before this check.`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return data.cameras;
});
assert.ok(cameras.some(c => c.state === 'OR'));
assert.ok(cameras.some(c => c.state === 'WA'));
assert.equal(new Set(cameras.map(c => c.id)).size, cameras.length);
assert.deepEqual(extractRouteRefs(['ORE 58','Oregon Route 22','OR-99W','Washington Route 14']), ['OR-58','OR-22','OR-99W','WA-14']);
assert.ok(cameras.filter(c => c.state === 'OR' && c.imageUrl).every(c => c.snapshotUpdateSeconds >= 300), 'Oregon cadence must survive hub normalization.');

if (process.argv.includes('--live')) {
  const cases = [
    {name:'Portland → Seattle', points:[{lat:45.5152,lon:-122.6784},{lat:47.6062,lon:-122.3321}], both:true},
    {name:'Short Portland urban trip', points:[{lat:45.5152,lon:-122.6784},{lat:45.5231,lon:-122.6590}]},
    {name:'Bend → Klamath Falls', points:[{lat:44.0582,lon:-121.3153},{lat:42.2249,lon:-121.7817}]},
    {name:'Lakeview → Jordan Valley sparse coverage', points:[{lat:42.1888,lon:-120.3458},{lat:42.9777,lon:-117.0532}], gaps:true}
  ];
  for (const test of cases) {
    const result = await calculateRoutes(test.points);
    assert.ok(result.routes.length, test.name);
    const route = result.routes[0];
    assert.ok(route.distanceMeters > 0 && route.durationSeconds > 0 && !route.trafficAware);
    const matches = matchRouteCameras(cameras, route, {corridorMeters:1609});
    assert.ok(matches.every((c,i) => i === 0 || c.routeDistanceMeters >= matches[i-1].routeDistanceMeters));
    assert.ok(matches.every(c => c.routeDistanceMeters >= 0 && c.routeDistanceMeters <= route.distanceMeters + 1));
    const mid = pointAtDistance(route, route.distanceMeters/2);
    assert.ok(mid.timeSeconds > 0 && mid.timeSeconds < route.durationSeconds);
    const projection = projectPointOnRoute(route, mid, {maxDistanceMeters:100});
    assert.ok(projection && projection.offsetMeters < 1, `${test.name}: midpoint must lie on route`);
    assert.ok(Math.abs(projection.alongMeters-route.distanceMeters/2) < 200, `${test.name}: midpoint progress`);
    const states = [...new Set(matches.map(c => c.state))];
    if (test.both) assert.ok(states.includes('OR') && states.includes('WA'), 'Cross-state route needs actual OR and WA views.');
    const gaps = coverageGaps(route, matches, {radiusMeters:1609, minGapMeters:16093});
    if (test.gaps) assert.ok(gaps.length, 'Sparse route must expose coverage gaps.');
    console.log(`${test.name}: ${(route.distanceMeters/1609.344).toFixed(1)} mi, ${(route.durationSeconds/3600).toFixed(2)} h ordinary estimate, ${matches.length} nearby views (${states.join('/')}), ${gaps.length} gaps over 10 mi, ${result.routes.length} route choice(s).`);
  }
}
console.log(`Passed Oregon/Washington hub identity, road references, and source-specific cadence (${cameras.length} indexed views).`);
