import {FLORIDA_RINGS} from './florida-boundary.js';

// Regions provide browsing shortcuts. Florida catalog coordinates, not these
// region labels, determine camera matches and route coverage.
export const FLORIDA_REGIONS = Object.freeze({
  panhandle: 'Panhandle',
  northeast: 'Northeast Florida',
  central: 'Central Florida',
  'tampa-bay': 'Tampa Bay',
  southwest: 'Southwest Florida',
  southeast: 'Southeast Florida',
  keys: 'Florida Keys',
});

export function pointInFlorida(lon,lat) {
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lat<24.3||lat>31.1||lon<-87.7||lon>-79.9)return false;
  return FLORIDA_RINGS.some(ring=>{
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [xi,yi]=ring[i],[xj,yj]=ring[j];
      if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;
    }
    return inside;
  });
}

export function floridaRouteRegions(route) {
  const regions = new Set();
  for (const coordinate of route?.coordinates || []) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
    const [lon, lat] = coordinate;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (!pointInFlorida(lon,lat)) continue;

    if (lat < 25.45 && lon > -82.3) regions.add('keys');
    else if (lon < -83.2 && lat >= 29.2) regions.add('panhandle');
    else if (lon > -83.2 && lat >= 29.5 && lat <= 30.8) regions.add('northeast');
    else if (lon < -82.1 && lat >= 27.5 && lat <= 28.5) regions.add('tampa-bay');
    else if (lon < -81.25 && lat < 27.5 && lat >= 25.45) regions.add('southwest');
    else if (lon > -83.2 && lat >= 27.5 && lat <= 29.5) regions.add('central');
    else if (lon > -82.3 && lat >= 25.45 && lat < 27.5) regions.add('southeast');
  }
  return [...regions];
}
