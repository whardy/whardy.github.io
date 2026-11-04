#!/usr/bin/env python3
"""Validate the actual California inventory and source-semantic edge cases."""
import collections, importlib.util, json, pathlib, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
TOOL_DIR=pathlib.Path(__file__).resolve().parent
DATA_DIR=ROOT if TOOL_DIR.name=='_tools' else ROOT/'dist'
spec=importlib.util.spec_from_file_location('refresh',TOOL_DIR/'refresh-catalog.py')
refresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(refresh)
data=json.loads((DATA_DIR/'camera-catalog.json').read_text());rows=data['cameras']
assert len(rows)==len({r['id'] for r in rows})
overrides=json.loads((DATA_DIR/'geographic-overrides.json').read_text())['overrides']
by_id={r['id']:r for r in rows}
assert set(overrides)=={r['id'] for r in rows if r.get('geographicOverride')}
for camera_id, correction in overrides.items():
    row=by_id[camera_id]
    assert row['sourceCounty']==correction['sourceCounty'] and row['county']==correction['county']
    assert abs(row['lat']-correction['latitude'])<1e-6 and abs(row['lon']-correction['longitude'])<1e-6
assert set(r['district'] for r in rows if r['provider']=='Caltrans')=={f'D{d:02d}' for d in range(1,13)}
for row in rows:
    assert row['id'].startswith(('caltrans:D','sccroads:'))
    assert row['siteId'] and row['provider'] and row['name']
    assert row['captureTime'] is None, 'Catalog timestamps must not become image capture timestamps'
    assert row['snapshotUpdateSeconds']>=60
    for key in ['imageUrl','videoUrl','officialUrl']:
        assert not row.get(key) or row[key].startswith('https://')
    if row['hasValidCoordinates']:
        assert 32<=row['lat']<=42.2 and -125<=row['lon']<=-113.5
    else:assert row['lat'] is None and row['lon'] is None
    if row['providerKey']=='sccroads':
        assert not row['direction'] and row['facingDirection'] in ['NB','SB','EB','WB']
        assert row['imageUrl'] is None and row['videoUrl'] is None
    if row['sourceRoad'].startswith('SR-'):assert row['road'].startswith('CA-')
    if row.get('geographicOverride'):
        assert row['sourceCounty']==row['geographicOverride']['sourceCounty']
        assert row['county']==row['geographicOverride']['county']
    if row['imageStatus']=='available' or row['videoStatus']=='available':assert not row['disabled']
    health=row.get('mediaHealth')
    if health:
        assert health['snapshot']['url']==row.get('imageUrl')
        assert health['video']['url']==row.get('videoUrl')
        assert health['snapshot']['status']==row['imageStatus']
        assert health['video']['status']==row['videoStatus']
        if health['video']['status']=='available':
            assert health['video']['verificationMethod'] in {'hls-segment-structure','ffmpeg-decoded-segment','browser-playback'}
            if health['video']['verificationMethod']=='ffmpeg-decoded-segment':
                assert health['video'].get('decoderEvidence')=='png-frame'
        if health['snapshot']['status']=='available':
            assert health['snapshot']['verificationMethod']=='image-decoded'
fixture={'index':'17-2','recordTimestamp':{'recordDate':'2026-01-01','recordTime':'01:02:03'},'location':{'district':'4','locationName':'Looking North on 99','route':'SR-99','latitude':'Not Reported','longitude':'0','direction':'South','elevation':'100','postmile':'2.5'},'inService':'false','imageData':{'imageDescription':'Looking North','streamingVideoURL':'https://example.org/viewer.html','static':{'currentImageURL':'https://example.org/current.jpg','currentImageUpdateFrequency':'15'}}}
f=refresh.normalized_record(fixture)
assert f['id']=='caltrans:D04:17-2' and f['siteId']=='caltrans:D04:17'
assert f['road']=='CA-99' and f['sourceRoad']=='SR-99'
assert f['direction']=='South' and f['facingDirection']=='North'
assert f['videoUrl'] is None and f['sourceVideoUrl']=='https://example.org/viewer.html'
assert f['captureTime'] is None and f['sourceUpdatedAt'] is None
assert f['lat'] is None and f['lon'] is None and f['snapshotUpdateSeconds']==900
county=refresh.county_records([{'id':99,'name':'Local Rd & Cross St','lat':None,'lng':'bad','NB':'12345','NBCam':'1','NBView':'Local'}])[0]
assert county['lat'] is None and county['lon'] is None and not county['hasValidCoordinates']
assert not county['direction'] and county['facingDirection']=='NB'
override_row=next(r.copy() for r in rows if r['id']=='caltrans:D07:1165')
report=refresh.apply_geographic_overrides([override_row],DATA_DIR/'geographic-overrides.json')
assert report['applied']==1 and override_row['county']=='Los Angeles' and override_row['metro']=='Los Angeles'
assert override_row['geographicOverride']['sourceCounty']=='Alameda'
changed_row=next(r.copy() for r in rows if r['id']=='caltrans:D07:1165');changed_row['lat']+=0.1;unchanged_county=changed_row['county']
changed_report=refresh.apply_geographic_overrides([changed_row],DATA_DIR/'geographic-overrides.json')
assert changed_report['applied']==0 and changed_report['skipped'] and changed_row['county']==unchanged_county
# A district fetch failure or malformed successful response must leave cached
# data intact. No real network is used for these fault-injection checks.
with tempfile.TemporaryDirectory() as temp:
    directory=pathlib.Path(temp);file=directory/'caltrans-D04.json';saved={'data':[{'cctv':fixture}]};refresh.write_json(file,saved)
    original=refresh.read_json
    for response in [None,{'data':[]}]:
        def faulty(url):
            if response is None:raise OSError('simulated timeout')
            return response
        refresh.read_json=faulty
        retained,meta=refresh.fetch_source(directory,file.name,'https://example.org/source.json')
        assert retained==saved and meta['status']=='last-known-good'
        assert json.loads(file.read_text())==saved
    refresh.read_json=original
chain=json.loads((DATA_DIR/'travel-sources.json').read_text())['chainControls']
assert len(chain['districts'])==9 and chain['nominalUpdateSeconds']==60
audit=json.loads((DATA_DIR/'source-audit.json').read_text())
listed_endpoint_keys={(kind,refresh.endpoint_key(row[field])) for row in rows for kind,field in [('image','imageUrl'),('video','videoUrl')] if row.get(field)}
audited_endpoint_keys={(e['kind'],refresh.endpoint_key(e['url'])) for e in audit['endpoints']}
assert audit['coverage']['listedUniqueEndpoints']==len(listed_endpoint_keys)
assert audit['coverage']['checkedUniqueEndpoints']==len(audited_endpoint_keys)
assert audit['coverage']['uncheckedUniqueEndpoints']==len(listed_endpoint_keys-audited_endpoint_keys)
assert audited_endpoint_keys<=listed_endpoint_keys
assert len(audit['endpoints'])==len(audited_endpoint_keys)
for e in audit['endpoints']:
    if e.get('verificationMethod') in {'image-decoded','image-decode-attempt','hls-segment-structure','ffmpeg-decoded-segment','hls-segment-attempt'}:
        assert e.get('checkedAt') and e.get('expiresAt')
    if e.get('verificationMethod')=='ffmpeg-decoded-segment':assert e.get('decoderEvidence')=='png-frame'
    if data.get('fullSweepCompletedAt') and e.get('kind')=='image':
        assert e.get('placeholderDetectorVersion')=='caltrans-v2'
print(f'California data checks passed: {len(rows):,} views, {len(set(r["siteId"] for r in rows)):,} source locations; all 12 districts and fault retention verified.')
