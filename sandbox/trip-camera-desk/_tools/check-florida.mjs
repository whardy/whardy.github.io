import assert from 'node:assert/strict';
import {floridaRouteRegions} from '../florida.js';

const regions=coordinates=>floridaRouteRegions({coordinates});
assert.deepEqual(regions([[-82.45,27.95],[-81.38,28.54]]),['tampa-bay','central']);
assert.deepEqual(regions([[-87.2,30.42],[-81.65,30.33]]),['panhandle','northeast']);
assert.deepEqual(regions([[-80.19,25.77],[-81.79,24.56]]),['southeast','keys']);
assert.deepEqual(regions([[-77.04,38.90],[-84.39,33.75]]),[]);
assert.deepEqual(regions([[-86.78,36.17],[-82.99,39.96]]),[]);
assert.deepEqual(regions([[-83.28,30.83]]),[]); // Valdosta, Georgia
assert.deepEqual(regions([]),[]);
console.log('Florida official-map route region checks passed.');
