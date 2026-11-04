// FL511's approved map is linked separately from this site's camera catalog.
// These deliberately coarse regions only choose useful official map entry points;
// they do not assert a camera location or calculate route coverage.
export const FLORIDA_REGIONS = Object.freeze({
  panhandle: 'Panhandle',
  northeast: 'Northeast Florida',
  central: 'Central Florida',
  'tampa-bay': 'Tampa Bay',
  southwest: 'Southwest Florida',
  southeast: 'Southeast Florida',
  keys: 'Florida Keys',
});

export function floridaRouteRegions(route) {
  const regions = new Set();
  for (const coordinate of route?.coordinates || []) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
    const [lon, lat] = coordinate;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lat < 24.3 || lat > 31.0 || lon < -87.7 || lon > -80) continue;
    // East of the Panhandle, nearby south Georgia sits inside the broad bounding box.
    if (lon > -85 && lat > 30.73) continue;

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
