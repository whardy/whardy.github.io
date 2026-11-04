#!/usr/bin/env python3
"""Check normalization against maintained catalogs and known integration edge cases."""
import importlib.util
import json
from pathlib import Path
from collections import Counter
from urllib.parse import urlsplit
import hashlib

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('catalog_builder', root / '_tools/build-catalog.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
data = root / 'data'
index = json.loads((data / 'index.json').read_text())
cameras = []
for state in index['states']:
    shard = json.loads((data / f"{state['state']}.json").read_text())
    raw = (data / f"{state['state']}.json").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == state['sha256']
    assert len(raw) == state['bytes']
    assert state['views'] == len(shard['cameras'])
    assert state['locations'] == len({c['siteId'] for c in shard['cameras']})
    cameras.extend(shard['cameras'])

assert len(cameras) == index['totals']['views']
california_index = next(state for state in index['states'] if state['state'] == 'CA')
assert california_index['sourceGeographyOverridesApplied'] == sum(bool(c.get('geographicOverride')) for c in cameras if c['state'] == 'CA')
assert len({c['id'] for c in cameras}) == len(cameras)
assert len({c['siteId'] for c in cameras}) == index['totals']['locations']
assert len(set(c['sourceId'] for c in cameras)) < len(cameras), 'Fixture still exercises cross-state raw ID collisions'
for camera in cameras:
    assert camera['id'].startswith(camera['state'] + ':' + camera['providerKey'] + ':')
    assert camera['siteId'].startswith(camera['state'] + ':' + camera['providerKey'] + ':')
    assert camera['hasCoordinates'] == (camera['lat'] is not None and camera['lon'] is not None)
    assert camera['mediaType'] == ('video' if camera['videoUrl'] else 'snapshot' if camera['imageUrl'] else 'official')
    if camera['videoStatus'] == 'available' and not camera['disabled']:
        assert camera['availability'] == 'available', 'A failed snapshot must not hide available video'
    if camera['state'] == 'CA' and camera['videoStatus'] == 'available':
        assert camera['mediaHealth']['video']['verificationMethod'] in {'ffmpeg-decoded-segment', 'browser-playback'}, 'Structural HLS alone is not available video'
    if camera['imageStatus'] == 'available' and not camera['disabled']:
        assert camera['availability'] == 'available', 'A failed video must not hide available snapshot'
    for field in ['imageUrl', 'videoUrl', 'iosVideoUrl', 'officialUrl']:
        if camera[field]:
            assert urlsplit(camera[field]).scheme == 'https'
            assert not urlsplit(camera[field]).username
    assert set(camera['primaryRouteRefs']) <= set(camera['routeRefs'])

lookup = {(c['state'], c['sourceId']): c for c in cameras}
assert lookup[('WV', 'CAM001')]['videoUrl'].startswith('https://vtc1.roadsummary.com/')
assert lookup[('WV', 'CAM001')]['imageUrl'] is None
assert sum(c['state'] == 'WV' for c in cameras) == 133, 'WV stream dictionary is joined, not appended'
assert sum(c['state'] == 'OH' for c in cameras) > len({c['siteId'] for c in cameras if c['state'] == 'OH'})
assert sum(c['state'] == 'AZ' for c in cameras) > len({c['siteId'] for c in cameras if c['state'] == 'AZ'})
for raw_id in ['6364', '6365']:
    assert not lookup[('PA', raw_id)]['hasCoordinates']
assert not lookup[('VA', '3656')]['hasCoordinates']
assert lookup[('AZ', 'az511-1189')]['jurisdiction'] == 'Pinal', 'Official geography override applied'
assert lookup[('DC', 'DDOT_CAPTOP_1')]['jurisdictionType'] == 'ward'
assert lookup[('VA', '3432')]['jurisdiction'] == 'Arlington County'
tx_relay = [c for c in cameras if c['state'] == 'TX' and c['embedMode'] == 'relay']
assert len(tx_relay) == 3205
assert all(c['imageUrl'] == builder.RELAY_ROOT + '/api/snapshot/' + c['sourceId'] for c in tx_relay)
assert all(not c['imageUrl'] for c in cameras if c['state'] == 'TX' and c['embedMode'] == 'official')
assert builder.direction_info({'direction': 'Westbound'})[1] == 270
assert builder.direction_info({'direction': 'View', 'name': 'H St NW'})[1] is None, 'Street quadrant is not traffic direction'
assert builder.coordinates({'lat': None, 'lon': -80}) == (None, None)
assert builder.coordinates({'lat': 0, 'lon': 0}) == (None, None)
assert builder.route_refs({'name': 'I-68 @ US-119'}, 'I-68', primary_only=True) == ['I-68']
assert builder.route_refs({'name': 'I-68 @ US-119'}, 'I-68') == ['I-68', 'US-119']
assert builder.normalize_road('IH35E / SH 0045 / FM620') == 'I-35E / SH-45 / FM-620'
assert builder.route_refs({}, 'SH-249') == ['SH-249']
assert builder.normalize_road('NY 027A') == 'NY-27A'
assert builder.route_refs({}, 'NY 27A') == ['NY-27A']
assert lookup[('NY', '20930')]['jurisdictionType'] == 'borough'
assert lookup[('NY', '20930')]['sourceCounty'] == 'New York'
assert lookup[('NY', '34278')]['videoUrl'].startswith('https://s51.nysdot.skyvdn.com/')
assert lookup[('NY', '34278')]['primaryRouteRefs'] == ['NY-104']
assert builder.https_url('https://example.com/camera image.jpg') == 'https://example.com/camera%20image.jpg'
assert builder.https_url('https://secret@example.com/image.jpg') is None
print(f"Passed: {len(cameras):,} unique normalized views; namespaces, geographic overrides, multi-view sites, coordinates, media capabilities, dated availability, and relay preservation.")

# Oregon road aliases and exact border media identity cannot collapse nearby views.
assert builder.normalize_road('ORE 0058 / OR22') == 'OR-58 / OR-22'
assert builder.route_refs({}, 'OR 22 / WA 014') == ['OR-22', 'WA-14']
assert builder.image_identity('https://www.tripcheck.com/RoadCams/cams/Test%20One.jpg?x=1') == builder.image_identity('https://tripcheck.com/roadcams/cams/test one.jpg')
assert builder.image_identity('https://example.com/test.jpg') is None
wa1 = {'id': 'WA:wsdot:duplicate', 'state': 'WA', 'imageUrl': 'https://www.tripcheck.com/RoadCams/cams/Same.jpg', 'officialUrl': 'https://wsdot.com/'}
or1 = {'id': 'OR:tripcheck:one', 'state': 'OR', 'imageUrl': 'https://www.tripcheck.com/roadcams/cams/same.jpg', 'officialUrl': 'https://www.tripcheck.com/'}
or2 = {'id': 'OR:tripcheck:two', 'state': 'OR', 'imageUrl': 'https://www.tripcheck.com/roadcams/cams/other.jpg', 'officialUrl': 'https://www.tripcheck.com/'}
fixture = [({'state': 'WA', 'cameras': [wa1]}, {}), ({'state': 'OR', 'cameras': [or1, or2]}, {})]
reconciled = builder.reconcile_border_views(fixture)
assert len(reconciled) == 1 and fixture[0][0]['cameras'] == []
assert len(fixture[1][0]['cameras']) == 2 and or1['catalogAliases'] == ['WA:wsdot:duplicate']
for camera in [c for c in cameras if c['state'] == 'OR']:
    assert camera['snapshotUpdateSeconds'] >= 300
    assert camera['directionBearing'] is None or camera['directionSource'] == 'published-direction'
print('Passed Oregon/Washington route references, source cadence, viewing-direction uncertainty and exact border reconciliation.')

oregon = [c for c in cameras if c['state'] == 'OR']
washington = [c for c in cameras if c['state'] == 'WA']
assert oregon and washington
assert len(oregon) == 1179 and len({c['siteId'] for c in oregon}) == 1177
assert sum(not c['hasCoordinates'] for c in oregon) == 1
assert all(c['providerJurisdiction'] == 'OR' for c in oregon)
assert all(c['directionBearing'] is None for c in oregon), 'Viewing orientation cannot establish travel direction'
assert all(c['snapshotUpdateSeconds'] >= 300 for c in oregon + washington)
assert len(index['crossCatalogReconciliation']) == 2
canonical = {c['id']: c for c in cameras}
for row in index['crossCatalogReconciliation']:
    assert row['canonicalId'] in canonical and row['aliasId'] in canonical[row['canonicalId']]['catalogAliases']
    assert row['aliasId'] not in canonical
assert {c['physicalState'] for c in oregon} >= {'OR', 'WA', 'CA', 'ID'}
print('Passed Oregon location/view counts, border-state provenance, missing-position retention, source cadence, content hashes and aliases.')
