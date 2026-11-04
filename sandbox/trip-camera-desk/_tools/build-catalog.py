#!/usr/bin/env python3
"""Normalize the published camera catalogs without requesting camera media.

Run from the workspace: python3 trip-camera-desk/scripts/build-catalog.py
For another repository use --repository /path/to/whardy.github.io.
The output consists of an index and independent JSON state shards.
"""
from __future__ import annotations

import argparse
import ast
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import quote, unquote, urlsplit, urlunsplit

STATES = [
    ('WV', 'West Virginia', 'wv511-camera-desk', 'wv511'),
    ('OH', 'Ohio', 'ohio-road-atlas', 'ohgo'),
    ('PA', 'Pennsylvania', 'pennsylvania-camera-desk', '511pa'),
    ('VA', 'Virginia', 'virginia-camera-desk', '511va'),
    ('TX', 'Texas', 'texas-camera-desk', 'txdot'),
    ('MD', 'Maryland', 'maryland-camera-desk', 'mdot'),
    ('AZ', 'Arizona', 'arizona-camera-desk', 'az511'),
    ('DC', 'District of Columbia', 'dc-camera-desk', 'ddot'),
    ('NY', 'New York', 'new-york-camera-desk', '511ny'),
    ('CA', 'California', 'california-camera-desk', 'caltrans'),
    ('WA', 'Washington', 'washington-camera-desk', 'wsdot'),
    ('OR', 'Oregon', 'oregon-camera-desk', 'tripcheck'),
]
PUBLIC_ROOT = 'https://whardy.github.io/sandbox/'
RELAY_ROOT = 'https://texas-camera-relay.wintrytiger33.chatgpt.site'
OH_AREAS = {'akron': 'Akron / Canton / Youngstown', 'cincinnati': 'Cincinnati area',
            'cleveland': 'Cleveland area', 'columbus': 'Columbus area', 'dayton': 'Dayton area',
            'toledo': 'Toledo area', 'southeast ohio': 'Southeast Ohio', '$border': 'Border connections'}
WV_METROS = [
    ('Morgantown', ['Monongalia']), ('Fairmont', ['Marion']),
    ('Clarksburg / Bridgeport / Weston', ['Harrison', 'Lewis', 'Doddridge', 'Taylor', 'Upshur', 'Gilmer', 'Barbour']),
    ('Charleston / Teays Valley', ['Kanawha', 'Putnam', 'Boone', 'Clay']),
    ('Huntington / Point Pleasant', ['Cabell', 'Wayne', 'Mason', 'Lincoln']),
    ('Parkersburg / Ripley', ['Wood', 'Jackson', 'Wirt', 'Pleasants', 'Ritchie', 'Calhoun', 'Roane']),
    ('Beckley / Oak Hill', ['Raleigh', 'Fayette', 'Summers', 'Nicholas']),
    ('Bluefield / Princeton', ['Mercer', 'McDowell', 'Wyoming']),
    ('Martinsburg / Charles Town', ['Berkeley', 'Jefferson', 'Morgan']),
    ('Wheeling / New Martinsville', ['Ohio', 'Marshall', 'Wetzel', 'Tyler']),
    ('Weirton', ['Brooke', 'Hancock']), ('Lewisburg / Greenbrier Valley', ['Greenbrier', 'Monroe', 'Pocahontas']),
    ('Logan / Williamson', ['Logan', 'Mingo']),
    ('Potomac Highlands / Elkins', ['Grant', 'Mineral', 'Tucker', 'Hardy', 'Hampshire', 'Pendleton', 'Randolph']),
    ('Kingwood / Hazelton', ['Preston']), ('Sutton / Gassaway', ['Braxton', 'Webster']),
]
DIRECTION_BEARINGS = {'N': 0, 'NE': 45, 'E': 90, 'SE': 135, 'S': 180, 'SW': 225, 'W': 270, 'NW': 315}


def read_json(path: Path):
    return json.loads(path.read_text())


def clean_text(value):
    return str(value).strip() if value is not None else ''


def coordinates(camera):
    lat, lon = camera.get('lat'), camera.get('lon', camera.get('lng'))
    # The existing catalogs cover the continental US, including border connections.
    # Reject source nulls, booleans, zero coordinates, and nonfinite values.
    if isinstance(lat, bool) or isinstance(lon, bool):
        return None, None
    try:
        lat, lon = float(lat), float(lon)
        if math.isfinite(lat) and math.isfinite(lon) and 24 <= lat <= 50 and -126 <= lon <= -65:
            return lat, lon
    except (TypeError, ValueError):
        pass
    return None, None


def https_url(value):
    if not value:
        return None
    value = str(value).strip()
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password:
        return None
    return urlunsplit((parsed.scheme, parsed.netloc, quote(parsed.path, safe='/%:@!$&\'()*+,;=-._~'),
                       quote(parsed.query, safe='=&%/:?@!$\'()*+,;~-._'), parsed.fragment))


def normalize_road(value):
    road = re.sub(r'\s+', ' ', clean_text(value) or 'Other roads')
    road = re.sub(r'\b(?:OREGON|ORE)\s*-?\s*(\d+[A-Z]?)\b', r'OR-\1', road, flags=re.I)
    road = re.sub(r'\b(?:INTERSTATE|IH)\s*-?\s*(\d+[A-Z]?)\b', r'I-\1', road, flags=re.I)
    def format_ref(match):
        number = re.match(r'(\d+)([A-Z]?)$', match[3], re.I)
        return f'{match[1]}{match[2].upper()}-{int(number[1])}{number[2].upper()}'
    road = re.sub(r'(^|[\s/&(])(US|VA|MD|OH|TX|AZ|WV|PA|NY|CA|WA|OR|RT|SR|SH|FM|RM|LP|SP|BW|I)\s*\.?\s*-?\s*(\d+[A-Z]?)\b',
                  format_ref, road, flags=re.I)
    return road


def route_refs(camera, road, primary_only=False):
    source = road if primary_only else ' '.join([road, clean_text(camera.get('name'))] + list(camera.get('routes') or []))
    source = normalize_road(source)
    refs = re.findall(r'\b(I|US|SR|RT|VA|MD|OH|TX|AZ|WV|PA|NY|CA|WA|OR|SH|FM|RM|LP|SP|BW)-(\d+[A-Z]?)\b', source, flags=re.I)
    return sorted(set(f'{prefix.upper()}-{number.upper()}' for prefix, number in refs))


def direction_info(camera):
    raw = clean_text(camera.get('direction'))
    token = re.sub(r'[^A-Z]', '', raw.upper())
    token = token.replace('BOUND', '').replace('NORTH', 'N').replace('SOUTH', 'S').replace('EAST', 'E').replace('WEST', 'W')
    if token.endswith('B') and token[:-1] in DIRECTION_BEARINGS:
        token = token[:-1]
    if token in DIRECTION_BEARINGS:
        return raw, DIRECTION_BEARINGS[token], 'published-direction'
    # Explicit NB/EB/SB/WB in a camera name describes a directional view. A lone
    # N/S/E/W may be a street quadrant or a location qualifier, so is not inferred.
    match = re.search(r'\b(NB|EB|SB|WB|NORTHBOUND|EASTBOUND|SOUTHBOUND|WESTBOUND)\b', clean_text(camera.get('name')), flags=re.I)
    if match:
        token = match[1].upper()[0]
        return raw or match[1].upper(), DIRECTION_BEARINGS[token], 'explicit-name-token'
    return '' if raw.lower() in {'view', 'na', 'n/a', 'none'} else raw, None, 'unknown'


def normalize_status(value):
    value = clean_text(value).lower()
    if value in {'available', 'working', 'recent', 'valid'}:
        return 'available'
    if value in {'stale', 'older'}:
        return 'stale'
    if value in {'unavailable', 'disabled', 'master-unavailable', 'child-unavailable', 'host-unreachable'}:
        return 'unavailable'
    if value in {'official-only', 'official'}:
        return 'official'
    return 'unchecked'


def metro_groups(path):
    """Reuse maintained PA/VA county-to-browsing-region tables without running JS."""
    text = (path / 'filters.js').read_text()
    match = re.search(r'export const METRO_GROUPS\s*=\s*(\[[\s\S]*?\n\]);', text)
    if not match:
        raise ValueError(f'Cannot read maintained metro groups: {path}')
    groups = ast.literal_eval(match[1])
    return {county.lower(): (county, metro) for metro, counties in groups for county in counties}


def geography(state, camera, overrides, groups):
    county = clean_text(overrides.get(str(camera['id']), {}).get('county') or camera.get('county'))
    if re.fullmatch(r'(?:unspecified|unknown)(?: county)?', county, re.I):
        county = ''
    if state == 'VA':
        county, metro = groups.get(county.lower(), ('', 'Border & unlocated cameras'))
        kind = 'city' if county.endswith(' City') else 'county' if county else 'unassigned'
    elif state == 'PA':
        county = re.sub(r'\s+county$', '', county, flags=re.I)
        county, metro = groups.get(county.lower(), (county, camera.get('region') or 'Border & unlocated cameras'))
        kind = 'county' if county else 'unassigned'
    elif state == 'WV':
        county = re.sub(r'\s+county$', '', county, flags=re.I)
        metro = next((name for name, counties in WV_METROS if county.lower() in [c.lower() for c in counties]), 'Other / location unconfirmed')
        kind = 'county' if county else 'unassigned'
    elif state == 'OH':
        area_ids = camera.get('areaIds') or ['$border'] if camera.get('outsideOhio') else camera.get('areaIds') or []
        metros = [OH_AREAS.get(area, area.title()) for area in area_ids]
        metro = ' / '.join(metros) or 'Other Ohio'
        kind = 'county' if county else 'unassigned'
    elif state == 'DC':
        county = clean_text(camera.get('ward')) or county
        metro = clean_text(camera.get('quadrant')) or clean_text(camera.get('metro')) or 'Boundary / unassigned'
        kind = 'ward' if county else 'unassigned'
    elif state == 'NY':
        metro = clean_text(camera.get('metro') or camera.get('region')) or 'Other New York'
        kind = 'borough' if county in {'Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'} else 'county' if county else 'unassigned'
    else:
        county = re.sub(r'\s+county$', '', county, flags=re.I)
        metro = clean_text(camera.get('metro') or camera.get('region')) or f'Other {state}'
        kind = 'city' if state == 'MD' and county.lower() == 'baltimore city' else 'county' if county else 'unassigned'
    return county, kind, metro


def build_state(repository, state, state_name, slug, base_provider, source_path=None):
    path = source_path or repository / 'sandbox' / slug
    published = PUBLIC_ROOT + slug + '/'
    is_wv = state == 'WV'
    container = read_json(path / 'data/cameras.json') if is_wv else read_json(path / 'camera-catalog.json')
    catalog = container['catalog'] if is_wv else container
    audit_file = path / ('feed-audit.json' if is_wv else 'source-audit.json')
    audit = read_json(audit_file) if audit_file.exists() else {}
    audit_rows = audit.get('results', []) if is_wv else audit.get('cameras', audit.get('entries', []))
    audit_by_id = {str(c['id']): c for c in audit_rows}
    overrides_file = path / 'county-overrides.json'
    overrides = read_json(overrides_file).get('overrides', {}) if overrides_file.exists() else {}
    groups = metro_groups(path) if state in {'PA', 'VA'} else {}
    fetched_at = catalog.get('fetchedAt')
    audit_at = audit.get('completedAt') or audit.get('checkedAt') or catalog.get('auditCompletedAt')
    cameras = []
    source_sites = catalog['cameras']
    for camera in source_sites:
        for view in camera.get('views', [camera]) if state == 'OH' else [camera]:
            source_id = str(view['id'])
            provider_key = 'austin' if state == 'TX' and source_id.startswith('austin-') else ('nycdot' if camera.get('provider') == 'NYC DOT' else 'nysdot') if state == 'NY' else base_provider
            if state == 'CA':
                provider_key = source_id.split(':', 1)[0] if ':' in source_id else base_provider
            ident = f'{state}:{source_id}' if state == 'CA' and ':' in source_id else f'{state}:{provider_key}:{source_id}'
            raw_site_id = str(camera.get('siteId', camera['id']))
            site_id = f'{state}:{raw_site_id}' if state == 'CA' and ':' in raw_site_id else f'{state}:{provider_key}:{raw_site_id}'
            county, kind, metro = geography(state, camera, overrides, groups)
            raw_road = clean_text(camera.get('sourceRoad') or camera.get('road') or camera.get('primaryRoad') or camera.get('route')) or 'Other roads'
            road = normalize_road(camera.get('road') or raw_road) if state == 'CA' else normalize_road(raw_road)
            lat, lon = coordinates(camera)
            checked = audit_by_id.get(source_id, {})
            if state == 'OH':
                checked = audit.get('views', {}).get(source_id, {})
                image_url = view.get('largeUrl') or view.get('smallUrl')
                image_status = normalize_status(view.get('availability'))
                official_url = 'https://www.ohgo.com/'
                video_url = None
                embed = 'image'
            elif is_wv:
                image_url = None
                image_status = 'unchecked'
                video_url = container.get('streams', {}).get(source_id)
                official_url = 'https://wv511.org/flowplayeri.aspx?CAMID=' + quote(source_id)
                embed = 'video'
            else:
                image_url = camera.get('imageUrl')
                image_status = normalize_status(camera.get('imageStatus') or camera.get('sourceImageStatus'))
                video_url = camera.get('videoUrl')
                official_url = camera.get('officialUrl') or camera.get('sourceUrl') or catalog.get('sourceUrl')
                embed = camera.get('embedMode') or ('image' if image_url else 'official')
                if state == 'TX' and embed == 'relay' and re.fullmatch(r'txdot-[a-z]{3}-[a-f0-9]{16}', source_id):
                    image_url = RELAY_ROOT + '/api/snapshot/' + source_id
            video_status = normalize_status(checked.get('status')) if is_wv else normalize_status(camera.get('videoStatus')) if video_url else 'unchecked'
            image_url, video_url = https_url(image_url), https_url(video_url)
            media_type = 'video' if video_url else 'snapshot' if image_url else 'official'
            disabled = bool(camera.get('disabled'))
            if disabled:
                availability = 'unavailable'
            elif media_type == 'official':
                availability = 'official'
            elif 'available' in ([image_status] if not video_url else [image_status, video_status]):
                availability = 'available'
            elif image_status == 'stale':
                availability = 'stale'
            elif video_status == 'unavailable' and not image_url or image_status == 'unavailable' and not video_url or image_status == video_status == 'unavailable':
                availability = 'unavailable'
            else:
                availability = 'unchecked'
            merged_direction = {**camera, 'direction': view.get('direction', camera.get('direction'))}
            if state == 'CA':
                # Caltrans travel side and image-facing description are separate.
                # Do not infer travel direction from a camera's descriptive name.
                merged_direction['name'] = ''
                if clean_text(merged_direction.get('direction')).lower() in {'not reported', 'unknown', 'n/a'}:
                    merged_direction['direction'] = ''
            direction, bearing, direction_source = direction_info(merged_direction)
            item = {
                'id': ident, 'siteId': site_id, 'sourceId': source_id, 'sourceSiteId': raw_site_id,
                'state': state, 'stateName': state_name,
                'name': clean_text(camera.get('name')) or source_id,
                'description': clean_text(camera.get('description')),
                'road': road, 'sourceRoad': raw_road, 'routeRefs': route_refs(camera, road),
                'primaryRouteRefs': route_refs(camera, road, primary_only=True),
                'direction': direction, 'directionBearing': bearing, 'directionSource': direction_source,
                'lat': lat, 'lon': lon, 'hasCoordinates': lat is not None and lon is not None,
                'metro': metro, 'jurisdiction': county, 'jurisdictionType': kind,
                'provider': 'WV511' if is_wv else 'OHGO' if state == 'OH' and camera.get('provider') == 'Not specified' else clean_text(camera.get('provider')) or catalog.get('source'),
                'providerKey': provider_key, 'imageUrl': image_url, 'videoUrl': video_url,
                'iosVideoUrl': https_url(camera.get('iosVideoUrl')), 'officialUrl': https_url(official_url),
                'officialLinkType': camera.get('officialLinkType') or ('camera-player' if is_wv else 'regional-map' if state in {'OH', 'DC'} else 'source-viewer'),
                'mediaType': media_type, 'imageStatus': image_status, 'videoStatus': video_status,
                'availability': availability, 'auditCheckedAt': view.get('checkedAt') or checked.get('checkedAt') or checked.get('segment', {}).get('at') or audit_at,
                'videoCheckedAt': camera.get('videoCheckedAt') or (checked.get('segment', {}).get('at') if is_wv else audit_at if state == 'NY' and video_url else None),
                'sourceUpdatedAt': fetched_at, 'imageLastModified': view.get('lastModified') or camera.get('lastModified'),
                'sourceTimestamp': camera.get('sourceTimestamp'), 'embedMode': embed, 'disabled': disabled,
                'statusReason': clean_text(camera.get('statusReason') or checked.get('error')),
                'siteUrl': published, 'outsideSourceState': bool(camera.get('outsideOhio') or camera.get('outsideSourceState') or (camera.get('physicalState') and camera.get('physicalState') != state)),
            }
            if state in {'OR', 'WA'}:
                for field in ('physicalState', 'physicalStateSource', 'providerJurisdiction', 'city', 'region', 'milepoint', 'elevationFeet', 'viewingDirection', 'trafficDirection', 'directionType', 'coordinatesSource', 'captureTime', 'sourceCaptureTime', 'sourceCaptureAt', 'captureAt', 'sourceTimestamp', 'aliases', 'sourceIds', 'daylightImageUrl', 'officialVideoKind', 'officialSessionSeconds', 'officialImageRefreshSeconds', 'officialVideoId'):
                    item[field] = camera.get(field)
                item['coordinatesSource'] = camera.get('coordinateSource') or camera.get('coordinatesSource')
                item['daylightImageUrl'] = https_url(camera.get('daylightUrl') or camera.get('daylightImageUrl'))
                item['providerJurisdiction'] = camera.get('providerJurisdiction') or state
                if state == 'OR':
                    item['officialLinkType'] = 'regional-map'
                if state == 'WA' and clean_text(camera.get('direction')).lower() in {'both directions', 'unknown', 'view', 'n/a'}:
                    item['directionBearing'] = None
                    item['directionSource'] = 'unknown'
                item['snapshotUpdateSeconds'] = max(60, int(camera.get('refreshSeconds') or camera.get('snapshotUpdateSeconds') or catalog.get('refreshSeconds') or 300))
                item['sourceTimestamp'] = camera.get('sourceCaptureTime') or camera.get('sourceCaptureAt') or camera.get('captureAt') or camera.get('captureTime')
                # TripCheck PTZ/viewing orientation is not a verified travel side.
                if state == 'OR' and camera.get('directionType') != 'traffic' and not camera.get('trafficDirection'):
                    item['viewingDirection'] = camera.get('viewingDirection') or direction
                    item['direction'] = ''
                    item['directionBearing'] = None
                    item['directionSource'] = 'viewing-direction-only' if direction else 'unknown'
                elif state == 'OR' and camera.get('trafficDirection'):
                    item['direction'], item['directionBearing'], item['directionSource'] = direction_info({'direction': camera['trafficDirection']})
            if state == 'NY':
                item['sourceCounty'] = camera.get('sourceCounty')
            if state == 'CA':
                for field in ('district', 'nearbyPlace', 'facingDirection', 'elevationFeet', 'postmile', 'postmilePrefix', 'routeSuffix', 'alignment', 'milepost', 'inService', 'recordTimestamp', 'snapshotUpdateSeconds', 'sourceVideoUrl', 'sourceLocationId', 'locationGrouping', 'sourceCaptureTime', 'sourceDisabled', 'sourceStatus', 'catalogOrigin', 'sourceSnapshotUpdateMinutes'):
                    item[field] = camera.get(field)
                item['description'] = clean_text(camera.get('description') or camera.get('imageDescription'))
                # Catalog metadata modification dates are not image capture dates.
                item['sourceCaptureTime'] = camera.get('sourceCaptureTime') or camera.get('captureTime')
                item['sourceTimestamp'] = item['sourceCaptureTime']
                # A completed sampled audit is not a check of every view.
                item['auditCheckedAt'] = camera.get('checkedAt') or checked.get('checkedAt')
                item['imageCheckedAt'] = camera.get('imageCheckedAt') or (checked.get('image') or {}).get('checkedAt')
                item['videoCheckedAt'] = camera.get('videoCheckedAt') or (checked.get('video') or {}).get('checkedAt')
            cameras.append(item)
    cameras.sort(key=lambda c: c['id'])
    assert len({c['id'] for c in cameras}) == len(cameras), f'Duplicate normalized ID in {state}'
    with_coords = [c for c in cameras if c['hasCoordinates']]
    bounds = [min(c['lon'] for c in with_coords), min(c['lat'] for c in with_coords), max(c['lon'] for c in with_coords), max(c['lat'] for c in with_coords)] if with_coords else None
    stats = {
        'state': state, 'stateName': state_name, 'file': f'data/{state}.json', 'siteUrl': published,
        'views': len(cameras), 'locations': len({c['siteId'] for c in cameras}), 'bounds': bounds,
        'withCoordinates': len(with_coords), 'withoutCoordinates': len(cameras) - len(with_coords),
        'mediaCounts': dict(Counter(c['mediaType'] for c in cameras)),
        'availabilityCounts': dict(Counter(c['availability'] for c in cameras)),
        'imageStatusCounts': dict(Counter(c['imageStatus'] for c in cameras)),
        'videoStatusCounts': dict(Counter(c['videoStatus'] for c in cameras if c['videoUrl'])),
        'sourceUpdatedAt': fetched_at, 'auditCheckedAt': audit_at,
        'source': catalog.get('source'), 'sourceUrl': catalog.get('sourceUrl') or ('https://wv511.org/' if is_wv else 'https://www.ohgo.com/'),
        'catalogUrl': published + ('data/cameras.json' if is_wv else 'camera-catalog.json'),
        'geographyOverridesApplied': len(overrides),
    }
    if state == 'CA':
        stats['auditCoverage'] = audit.get('coverage')
        stats['sourceAuditUrl'] = published + 'source-audit.json'
    return {'schemaVersion': 1, 'state': state, 'stateName': state_name, 'sourceUpdatedAt': fetched_at, 'auditCheckedAt': audit_at, 'cameras': cameras}, stats



def image_identity(value):
    """Only shared official image identities are suitable for border reconciliation."""
    parts = urlsplit(value or '')
    if parts.hostname not in {'www.tripcheck.com', 'tripcheck.com', 'images.wsdot.wa.gov'}:
        return None
    return ('tripcheck.com' if parts.hostname.endswith('tripcheck.com') else parts.hostname, unquote(parts.path).lower() if parts.hostname.endswith('tripcheck.com') else unquote(parts.path))


def reconcile_border_views(built):
    shards = {shard['state']: shard for shard, _ in built}
    if not {'WA', 'OR'} <= shards.keys():
        return []
    groups = {}
    for code in ('WA', 'OR'):
        for camera in shards[code]['cameras']:
            identity = image_identity(camera['imageUrl'])
            if identity:
                groups.setdefault(identity, []).append(camera)
    removed, report = set(), []
    for identity, cameras in groups.items():
        if len({c['state'] for c in cameras}) < 2:
            continue
        preferred = 'OR' if identity[0] == 'tripcheck.com' else 'WA'
        primary = next(c for c in cameras if c['state'] == preferred)
        for duplicate in cameras:
            if duplicate['state'] == preferred:
                continue
            primary.setdefault('catalogAliases', []).append(duplicate['id'])
            primary.setdefault('additionalSourceUrls', []).append(duplicate['officialUrl'])
            removed.add(duplicate['id'])
            report.append({'canonicalId': primary['id'], 'aliasId': duplicate['id'], 'evidence': 'exact-public-image-url', 'imageUrl': primary['imageUrl']})
    for shard in shards.values():
        shard['cameras'] = [c for c in shard['cameras'] if c['id'] not in removed]
    return report


def refresh_stats(shard, stats):
    cameras = shard['cameras']
    positioned = [c for c in cameras if c['hasCoordinates']]
    stats.update({
        'views': len(cameras), 'locations': len({c['siteId'] for c in cameras}),
        'withCoordinates': len(positioned), 'withoutCoordinates': len(cameras) - len(positioned),
        'bounds': [min(c['lon'] for c in positioned), min(c['lat'] for c in positioned), max(c['lon'] for c in positioned), max(c['lat'] for c in positioned)] if positioned else None,
        'mediaCounts': dict(Counter(c['mediaType'] for c in cameras)),
        'availabilityCounts': dict(Counter(c['availability'] for c in cameras)),
        'imageStatusCounts': dict(Counter(c['imageStatus'] for c in cameras)),
        'videoStatusCounts': dict(Counter(c['videoStatus'] for c in cameras if c['videoUrl'])),
    })


def main():
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', type=Path, default=project.parent / 'whardy-github-pages')
    parser.add_argument('--output', type=Path, default=project / 'dist/data')
    parser.add_argument('--state-source', action='append', default=[], metavar='STATE=PATH', help='Explicit maintained catalog directory override; repeat for multiple states.')
    parser.add_argument('--california-source', type=Path, help='Override California catalog directory; default uses maintained source when available, published copy otherwise.')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    states, all_cameras, built, skipped = [], [], [], []
    overrides = {}
    for value in args.state_source:
        code, separator, directory = value.partition('=')
        if not separator or code not in {item[0] for item in STATES}:
            parser.error('--state-source requires a configured STATE=PATH')
        overrides[code] = Path(directory)
    for state, name, slug, provider in STATES:
        source_path = overrides.get(state) or (args.california_source if state == 'CA' else None)
        if state == 'CA' and source_path is None:
            maintained = project.parent / 'california-camera-desk/dist'
            if (maintained / 'camera-catalog.json').exists():
                source_path = maintained
            elif not (args.repository / 'sandbox' / slug / 'camera-catalog.json').exists():
                skipped.append({'state': state, 'reason': 'Configured California catalog has not yet been published; independent work is preserved.'})
                continue
        shard, stats = build_state(args.repository, state, name, slug, provider, source_path)
        built.append((shard, stats))
    reconciliation = reconcile_border_views(built)
    for shard, stats in built:
        refresh_stats(shard, stats)
        payload = (json.dumps(shard, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
        (args.output / f"{shard['state']}.json").write_bytes(payload)
        stats['sha256'] = hashlib.sha256(payload).hexdigest()
        stats['bytes'] = len(payload)
        states.append(stats)
        all_cameras.extend(shard['cameras'])
    assert len({c['id'] for c in all_cameras}) == len(all_cameras), 'Cross-state identifier collision'
    index = {
        'schemaVersion': 1, 'builtAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'totals': {
            'statesAndDistricts': len(states), 'views': len(all_cameras), 'locations': len({c['siteId'] for c in all_cameras}),
            'withCoordinates': sum(c['hasCoordinates'] for c in all_cameras),
            'withoutCoordinates': sum(not c['hasCoordinates'] for c in all_cameras),
            'mediaCounts': dict(Counter(c['mediaType'] for c in all_cameras)),
            'availabilityCounts': dict(Counter(c['availability'] for c in all_cameras)),
        },
        'states': states, 'crossCatalogReconciliation': reconciliation, 'configuredCatalogsNotBuilt': skipped,
        'notes': [
            'Listed views are dated catalog entries, not a live count of working feeds or deduplicated physical devices across providers.',
            'Locations count distinct state/provider/source site identifiers; OH, AZ and CA may contain several views at one source location; this is not an independently verified count of physical devices.',
            'State labels identify source catalogs; some catalogs include adjacent-state border connections.',
            'Availability is the best available dated media check. Available does not prove image capture time or current playback.',
            'Image/video capability and dated availability are independent. Video entries can have a working snapshot when their video was unavailable.',
            'County, independent-city, and DC ward classifications remain distinct. Metro groupings are browsing conveniences.',
            'Texas TxDOT relay image URLs preserve the existing owned relay. Official-only Houston views remain external links.',
            'California Caltrans recordTimestamp is catalog metadata, not image capture time. Direction describes travel side separately from facingDirection. County postmiles are not a statewide route odometer.',
            'Oregon and Washington snapshots respect their source refresh cadence (normally five minutes). Oregon camera viewing orientation is not treated as verified travel direction.',
            'Exact shared Oregon/Washington image URLs are counted once in the hub, with original catalog IDs retained as aliases. Different images at nearby positions remain separate views.',
            'No camera media was requested or recorded while building these shards.',
        ],
    }
    (args.output / 'index.json').write_text(json.dumps(index, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'output': str(args.output), 'totals': index['totals'], 'states': [{k: s[k] for k in ('state', 'views', 'locations', 'withoutCoordinates')} for s in states]}, indent=2))


if __name__ == '__main__':
    main()
