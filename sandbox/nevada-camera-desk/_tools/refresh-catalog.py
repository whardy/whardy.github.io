#!/usr/bin/env python3
"""Build a dated Nevada 511 catalog from the public camera-list page.

The public /cctv page requests /List/GetData/Cameras in pages of at most 100.
This script uses the same public listing, with one request every six seconds,
never the key-protected developer API. It writes only after complete validation.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://www.nvroads.com/'
LIST = SOURCE + 'List/GetData/Cameras'
COUNTIES = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query'
LIMIT = 4_000_000
REGIONS = {
    'Clark': 'Las Vegas Valley & southern Nevada',
    'Washoe': 'Reno, Sparks & Washoe',
    'Carson City': 'Carson City & Tahoe',
    'Douglas': 'Carson Valley & Tahoe',
    'Storey': 'Virginia City & Storey',
    'Lyon': 'Fernley, Dayton & Yerington',
    'Churchill': 'Fallon & Churchill',
    'Pershing': 'Lovelock & Pershing',
    'Humboldt': 'Winnemucca & Humboldt',
    'Elko': 'Elko, Wells & West Wendover',
    'Eureka': 'Central Nevada',
    'Lander': 'Battle Mountain & central Nevada',
    'White Pine': 'Ely & eastern Nevada',
    'Nye': 'Pahrump, Tonopah & Nye',
    'Esmeralda': 'Central Nevada',
    'Mineral': 'Hawthorne & Mineral',
    'Lincoln': 'Eastern Nevada',
}
PLACES = [
    ('Las Vegas',36.1699,-115.1398),('North Las Vegas',36.1989,-115.1175),
    ('Henderson',36.0395,-114.9817),('Boulder City',35.9786,-114.8325),
    ('Mesquite',36.8055,-114.0672),('Laughlin',35.1678,-114.5730),
    ('Pahrump',36.2083,-115.9839),('Reno',39.5296,-119.8138),
    ('Sparks',39.5349,-119.7527),('Carson City',39.1638,-119.7674),
    ('Incline Village',39.2513,-119.9729),('Fernley',39.6074,-119.2518),
    ('Fallon',39.4735,-118.7774),('Lovelock',40.1794,-118.4735),
    ('Winnemucca',40.9730,-117.7357),('Elko',40.8324,-115.7631),
    ('West Wendover',40.7391,-114.0733),('Ely',39.2474,-114.8886),
    ('Tonopah',38.0672,-117.2303),('Hawthorne',38.5247,-118.6246),
    ('Battle Mountain',40.6421,-116.9343),('Caliente',37.6147,-114.5130),
]

def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def fetch(url, max_bytes=LIMIT):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={
                'User-Agent': 'NevadaCameraDesk/1.0 (bounded public-camera catalog refresh)',
                'Accept': 'application/json',
            }), timeout=25) as response:
                body = response.read(max_bytes + 1)
                if len(body) > max_bytes:
                    raise ValueError('Source response exceeded size limit')
                return json.loads(body)
        except HTTPError as error:
            if error.code == 429 and attempt < 2:
                try:
                    delay = min(90, max(6, int(error.headers.get('Retry-After', '60'))))
                except ValueError:
                    delay = 60
                time.sleep(delay)
                continue
            if error.code in {502, 503, 504} and attempt < 2:
                time.sleep(6 * (attempt + 1))
                continue
            raise
        except URLError:
            if attempt == 2:
                raise
            time.sleep(6 * (attempt + 1))
    raise RuntimeError('Source fetch retries exhausted')

def list_query(start):
    # Same server-side table parameters used by Nevada 511's public /cctv page.
    query = {
        'start': start, 'length': 100,
        'order': [{'column': 1, 'dir': 'asc'}],
        'columns': [
            {'name': 'sortOrder', 'data': 'sortOrder', 's': False},
            {'name': 'region', 'data': 'region', 's': True},
            {'name': 'roadway', 'data': 'roadway', 's': True},
            {'name': 'Image', 's': False},
        ],
        'search': {'value': ''},
    }
    return LIST + '?' + urlencode({'query': json.dumps(query, separators=(',', ':')), 'lang': 'en'})

def get_public_list(cache=None):
    if cache and cache.exists():
        return json.loads(cache.read_text()), 'saved public-list cache'
    rows = []
    total = None
    for start in range(0, 10000, 100):
        result = fetch(list_query(start))
        if not isinstance(result, dict) or not isinstance(result.get('data'), list):
            raise ValueError('Unexpected Nevada 511 camera-list response')
        reported = int(result.get('recordsTotal', -1))
        if not 1 <= reported <= 10000 or reported != int(result.get('recordsFiltered', -1)):
            raise ValueError('Camera-list total changed or was filtered')
        if total is None:
            total = reported
        if total != reported:
            raise ValueError('Camera-list total changed during paging')
        page = result['data']
        if not page:
            raise ValueError('Camera-list page is empty before the reported total')
        rows.extend(page)
        print(f'Public Nevada 511 list: {len(rows)}/{total} parent records', flush=True)
        if len(rows) >= total:
            break
        time.sleep(6)
    if len(rows) != total or len({str(row.get('id')) for row in rows}) != total:
        raise ValueError('Incomplete or duplicate parent-camera listing; last good catalog retained')
    return rows, 'Nevada 511 public /cctv listing'

def in_ring(x, y, ring):
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        x1, y1 = a[:2]
        x2, y2 = b[:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside

def county_polygons():
    params = {'where': "STATE='32'", 'outFields': 'NAME,STATE,COUNTY',
              'outSR': 4326, 'returnGeometry': 'true', 'geometryPrecision': 6,
              'maxAllowableOffset': 0.00005, 'f': 'geojson'}
    data = fetch(COUNTIES + '?' + urlencode(params), max_bytes=8_000_000)
    features = data.get('features', [])
    if len(features) != 17 or data.get('exceededTransferLimit'):
        raise ValueError('Expected all 17 Nevada counties and Carson City from Census TIGERweb')
    result = []
    for feature in features:
        props = feature['properties']
        geometry = feature['geometry']
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        for rings in polygons:
            result.append((props['NAME'].removesuffix(' County'), props['STATE'] + props['COUNTY'], rings))
    return result

def county_at(lat, lon, polygons):
    found = {(name, fips) for name, fips, rings in polygons
             if in_ring(lon, lat, rings[0]) and not any(in_ring(lon, lat, ring) for ring in rings[1:])}
    return next(iter(found)) if len(found) == 1 else ('', '')

def coordinates(row):
    text = ((row.get('latLng') or {}).get('geography') or {}).get('wellKnownText') or ''
    match = re.fullmatch(r'POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)', text, re.I)
    if not match:
        return None, None
    lon, lat = map(float, match.groups())
    if not (math.isfinite(lat) and math.isfinite(lon) and 34.5 <= lat <= 42.2 and -120.2 <= lon <= -113.5):
        return None, None
    return lat, lon

def safe_url(value, kind):
    if not value:
        return None
    url = urljoin(SOURCE, value)
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password:
        return None
    if kind == 'image' and (parsed.hostname != 'www.nvroads.com' or not re.fullmatch(r'/map/Cctv/\d+', parsed.path, re.I)):
        return None
    if kind == 'video' and (not re.fullmatch(r'd\d+wse\d+\.its\.nv\.gov', parsed.hostname or '', re.I)
                            or not parsed.path.endswith('.m3u8')):
        return None
    return url

def road_name(value):
    raw = re.sub(r'\s+', ' ', str(value or '').strip())
    if re.match(r'^IR\s*-?\s*80\b', raw, re.I):
        return 'I-80'
    if re.match(r'^UCUS\s*6\b', raw, re.I):
        return 'US-6'
    match = re.match(r'\s*(?:Interstate|I|US|U\.S\.|SR|State Route|NV|CC)\s*[- ]?\s*(\d+[A-Z]?)\b', raw, re.I)
    if match:
        lead = re.match(r'\s*([A-Za-z. ]+)', raw).group(1).strip().upper().replace('.', '')
        prefix = 'I' if lead in {'I', 'INTERSTATE'} else 'US' if lead == 'US' else 'CC' if lead == 'CC' else 'NV'
        return prefix + '-' + match.group(1).upper()
    local = re.split(r'\s+(?:@|&|at)\s+|\s*/\s*', raw, maxsplit=1, flags=re.I)[0][:100]
    local = re.sub(r'\bSt\.? Rose\b', 'St Rose', local, flags=re.I)
    local = re.sub(r'\bBlue Diamond\b', 'Blue Diamond', local, flags=re.I)
    return local or 'Local roads'

def nearby_place(lat, lon):
    if lat is None:
        return ''
    def km(point):
        _, plat, plon = point
        dlat = math.radians(plat-lat)
        dlon = math.radians(plon-lon)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat))*math.cos(math.radians(plat))*math.sin(dlon/2)**2
        return 12742 * math.asin(min(1, math.sqrt(a)))
    place = min(PLACES, key=km)
    return place[0] if km(place) <= 25 else ''

def region_for(county, lat, lon):
    if not county:
        return 'Location unverified'
    if county == 'Clark':
        if lat < 35.5:
            return 'Laughlin & Colorado River'
        if lat > 36.55 and lon > -114.6:
            return 'Mesquite & northeast Clark'
        if lon > -114.95 and lat < 36.25:
            return 'Henderson & Boulder City'
        if lon < -115.55:
            return 'Southwest Clark rural roads'
        if lat > 36.45 or lat < 35.8 or lon > -114.65 or lon < -115.4:
            return 'Clark County rural corridors'
    if county == 'Douglas' and lon < -119.8:
        return 'Nevada-side Tahoe'
    return REGIONS.get(county, 'Other Nevada')

def normalize(rows, polygons, origin, source_fetched_at=None):
    cameras = []
    parent_ids, view_ids = set(), set()
    for row in rows:
        parent = str(row.get('id') or '')
        if not parent or parent in parent_ids:
            raise ValueError('Missing or duplicate parent camera ID')
        parent_ids.add(parent)
        lat, lon = coordinates(row)
        county, county_fips = county_at(lat, lon, polygons) if lat is not None else ('', '')
        roadway = str(row.get('roadway') or row.get('location') or f'Nevada camera {parent}').strip()
        road = road_name(roadway)
        source = str(row.get('source') or 'Nevada 511').strip()
        images = row.get('images') or []
        if not isinstance(images, list) or not images:
            images = [{'id': parent, 'description': '', 'disabled': True}]
        for view in images:
            vid = str(view.get('id') or '')
            if not vid or vid in view_ids:
                raise ValueError('Missing or duplicate camera view ID')
            view_ids.add(vid)
            image = safe_url(view.get('imageUrl'), 'image')
            video = safe_url(view.get('videoUrl'), 'video') if not view.get('videoDisabled') and not view.get('isVideoAuthRequired') else None
            disabled = bool(view.get('disabled') or view.get('blocked') or not row.get('visible', True))
            description = str(view.get('description') or '').strip()
            direction = str(row.get('direction') or 'Unknown').strip()
            cameras.append({
                'id': f'nv511:{vid}', 'siteId': f'nv511:{parent}', 'viewId': vid, 'parentId': parent,
                'sourceId': str(row.get('sourceId') or ''), 'source': source,
                'provider': 'Nevada 511', 'providerSource': source,
                'name': description or roadway, 'description': description,
                'sourceRoad': roadway, 'road': road, 'lat': lat, 'lon': lon,
                'county': county, 'countyFips': county_fips, 'metro': region_for(county, lat, lon),
                'region': 'Southern Nevada' if lat and lat < 37.0 else 'Western Nevada' if lon and lon < -118.5 else 'Northern & eastern Nevada',
                'direction': direction, 'directionType': 'camera-facing',
                'city': str(row.get('city') or '').strip() or nearby_place(lat, lon),
                'citySource': 'Nevada 511' if row.get('city') else 'Approximate nearest named place within 25 km',
                'sourceDistrict': str(row.get('dotDistrict') or '').strip(),
                'imageUrl': image, 'videoUrl': video,
                'officialUrl': f'https://www.nvroads.com/cctv',
                'embedMode': 'video' if video else 'image' if image else 'official',
                'disabled': disabled,
                'providerStatus': 'Disabled' if disabled else 'Enabled in public listing',
                'imageStatus': 'unchecked' if image else 'unavailable',
                'videoStatus': 'unchecked' if video else 'unavailable',
                'availability': 'unavailable' if disabled else 'unchecked',
                'checkedAt': None, 'sourceTimestamp': None, 'captureAt': None,
                'sourceUpdatedAt': row.get('lastUpdated'),
                'snapshotUpdateSeconds': 300,
                'aliases': list(dict.fromkeys([roadway, description, str(row.get('location') or ''), str(row.get('sourceId') or ''), parent, vid])),
            })
    cameras.sort(key=lambda c: (c['county'], c['road'], c['name'], c['id']))
    if len(cameras) < 300:
        raise ValueError('Suspiciously small Nevada camera catalog; last good catalog retained')
    return {'version': 1, 'state': 'NV', 'name': 'Nevada Camera Desk',
            'source': 'Nevada 511 public camera listing', 'sourceUrl': 'https://www.nvroads.com/cctv',
            'sourceMethod': origin, 'fetchedAt': source_fetched_at or now(), 'builtAt': now(), 'cameras': cameras,
            'counts': {'views': len(cameras), 'sourceLocations': len(parent_ids),
                       'withCoordinates': sum(c['lat'] is not None for c in cameras),
                       'videoUrls': sum(bool(c['videoUrl']) for c in cameras),
                       'imageUrls': sum(bool(c['imageUrl']) for c in cameras),
                       'providerDisabled': sum(c['disabled'] for c in cameras)}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT)
    parser.add_argument('--from-cache', type=Path, help='Local raw public-list JSON for repeatable rebuilds')
    parser.add_argument('--save-cache', type=Path, help='Save compact source rows outside the published directory')
    args = parser.parse_args()
    rows, origin = get_public_list(args.from_cache)
    polygons = county_polygons()
    cache_time = (datetime.fromtimestamp(args.from_cache.stat().st_mtime, timezone.utc)
                  .isoformat().replace('+00:00', 'Z')) if args.from_cache else None
    catalog = normalize(rows, polygons, origin, cache_time)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    path = output / 'camera-catalog.json'
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(catalog, separators=(',', ':'), ensure_ascii=False))
    temp.replace(path)
    if args.save_cache:
        args.save_cache.parent.mkdir(parents=True, exist_ok=True)
        args.save_cache.write_text(json.dumps(rows, separators=(',', ':'), ensure_ascii=False))
    print(json.dumps(catalog['counts'], indent=2))

if __name__ == '__main__':
    main()
