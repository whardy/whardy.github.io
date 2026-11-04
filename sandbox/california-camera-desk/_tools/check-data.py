#!/usr/bin/env python3
"""Validate the actual California inventory and source-semantic edge cases."""
import collections, importlib.util, json, pathlib, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('refresh',ROOT/'_tools/refresh-catalog.py')
refresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(refresh)
data=json.loads((ROOT/'camera-catalog.json').read_text());rows=data['cameras']
assert len(rows)==len({r['id'] for r in rows})
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
    if row['imageStatus']=='available' or row['videoStatus']=='available':assert not row['disabled']
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
chain=json.loads((ROOT/'travel-sources.json').read_text())['chainControls']
assert len(chain['districts'])==9 and chain['nominalUpdateSeconds']==60
print(f'California data checks passed: {len(rows):,} views, {len(set(r["siteId"] for r in rows)):,} source locations; all 12 districts and fault retention verified.')
