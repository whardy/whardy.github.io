#!/usr/bin/env python3
"""Build a static Washington camera catalog from WSDOT's public Travel Center.

No registered API key or relay. Source IDs and URLs are observed, never guessed.
Identical image URLs are merged while every source ID and road alias is retained.
County labels use WSDOT's public Travel Center boundary polygons; area labels are
editorial county groups, not legal metropolitan boundaries.
"""
import argparse
import collections
import concurrent.futures
import datetime as dt
import email.utils
import gzip
import hashlib
import json
import math
import re
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LIST_URL = 'https://wsdot.com/travel/real-time/service/api/Camera'
MAP_URL = 'https://data.wsdot.wa.gov/travelcenter/Cameras.json'
BOUNDARY_URL = 'https://services.arcgis.com/IYrj3otxNjPsrTRD/arcgis/rest/services/Travel_Center_Boundaries/FeatureServer/0'
MAX_BYTES = 8_000_000
KNOWN_PLACEHOLDERS = {'350d8f39cc8db3b78591cf45c13f455c2dd7a61c509a423b4c14fc1eef33eb98': 'WSDOT image currently unavailable notice (visually verified)', 'b52c2a4a2e89fd8504192a146b1e828c214e63c45b8ae9f5cc5f0b0a55b988e0': 'WSDOT image currently unavailable notice (visually verified)', 'bac349c961fc4c7570a4d310bf13b07592d201336357accc17c7129664a5f78f': 'WSDOT image currently unavailable notice (visually verified)', 'c973dd6adc48baecfa10acf80957b8926a7c5519e56427364580821ee9d45b79': 'WSDOT image currently unavailable notice (visually verified)', '4c661d6f61b381c6a4942cd53c7b46877fbeaba3a9d6690be7dff7fe98560df3': 'WSDOT image currently unavailable notice (visually verified)', 'a0a2e9bb127b62571dc4f4131e850e5bbd143a55bc37d8c520eae506df3be125': 'WSDOT image currently unavailable notice (visually verified)', '55d2476f4f66e98a91c5194540ec2099e82e6d2cbc56074dd4a7f8eb07526909': 'WSDOT image currently unavailable notice (visually verified)', '4ec5b923ec73aa4452364598e206cc7f32f665d7a9c28b0903e0d74c9c8a2bc1': 'WSDOT image currently unavailable notice (visually verified)', '0b8797059e6bf6f79b4ad7e6b29f31e230a8e27951745ca6b22367ad0b487792': 'WSDOT image currently unavailable notice (visually verified)', 'e6bf7f1b9aff5b1758f07bc56805a0718532ea2bf97f159b2c38a38df827e439': 'WSDOT image currently unavailable notice (visually verified)'}


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent':'WashingtonCameraDesk/1.0 (public camera availability check)','Accept-Encoding':'gzip'})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read(MAX_BYTES + 1)
        if len(body)>MAX_BYTES: raise ValueError('Response exceeds 8 MB')
        if body[:2] == b'\x1f\x8b': body = gzip.decompress(body)
        return response.status, dict(response.headers), body


def read_json(url):
    body = fetch(url)[2]
    try: text = body.decode('utf-8-sig')
    except UnicodeDecodeError: text = body.decode('cp1252') # WSDOT map JSON currently Windows-1252
    result = json.loads(text)
    if isinstance(result, dict) and result.get('error'): raise ValueError(str(result['error']))
    return result


def contains_ring(x, y, ring):
    inside = False
    j = len(ring)-1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj-xi)*(y-yi)/(yj-yi)+xi:
            inside = not inside
        j = i
    return inside


def county_at(lat, lon, counties):
    matches = []
    for c in counties:
        rings = c['geometry']['rings']
        if sum(contains_ring(lon, lat, ring) for ring in rings) % 2:
            matches.append(c['attributes']['JURLBL'])
    return matches[0] if len(matches)==1 else ''


AREA_BY_COUNTY = {
    'King': 'Seattle & Eastside', 'Snohomish': 'Everett & Snohomish County',
    'Pierce': 'Tacoma & Pierce County', 'Thurston':'Olympia & Thurston County',
    'Spokane':'Spokane area', 'Clark':'Vancouver area', 'Whatcom':'Bellingham & border',
    'Skagit':'Mount Vernon & Skagit Valley', 'Kitsap':'Bremerton & Kitsap',
    'Island':'Whidbey & Camano Islands', 'San Juan':'San Juan Islands',
    'Clallam':'Port Angeles & North Olympic', 'Jefferson':'Port Townsend & Olympic Peninsula',
    'Grays Harbor':'Aberdeen & Grays Harbor', 'Mason':'Shelton & Hood Canal',
    'Lewis':'Centralia, Chehalis & Lewis County', 'Cowlitz':'Longview & Kelso',
    'Pacific':'Long Beach & Pacific Coast', 'Wahkiakum':'Lower Columbia',
    'Skamania':'Columbia Gorge', 'Klickitat':'Columbia Gorge',
    'Yakima':'Yakima Valley', 'Benton':'Tri-Cities', 'Franklin':'Tri-Cities',
    'Walla Walla':'Walla Walla', 'Chelan':'Wenatchee & Chelan', 'Douglas':'Wenatchee & Douglas County',
    'Kittitas':'Ellensburg & Kittitas County', 'Grant':'Moses Lake & Grant County',
    'Okanogan':'Okanogan & Methow Valley', 'Whitman':'Pullman & the Palouse',
    'Asotin':'Clarkston & southeast', 'Garfield':'Clarkston & southeast', 'Columbia':'Dayton & southeast',
    'Adams':'Ritzville & Othello', 'Lincoln':'Davenport & Lincoln County',
    'Ferry':'Republic & northeast', 'Stevens':'Colville & northeast', 'Pend Oreille':'Newport & northeast',
}


def coordinate(feature):
    geo = feature['geometry']
    lon = geo['x'] / 20037508.342789244 * 180
    lat = math.degrees(2*math.atan(math.exp(geo['y']/6378137))-math.pi/2)
    if not (45 < lat < 50 and -125 < lon < -116): raise ValueError('Map coordinate outside state envelope')
    return round(lat, 6), round(lon, 6)


def url_key(url):
    parsed = urllib.parse.urlsplit(url.strip())
    # WSDOT's IIS image path is case-insensitive; retain case for partner hosts.
    path = parsed.path.lower() if parsed.hostname == 'images.wsdot.wa.gov' else parsed.path
    return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, parsed.query, ''))


def normalize():
    rows = read_json(LIST_URL)
    feature_data = read_json(MAP_URL)
    features = feature_data['features']
    if not isinstance(rows,list) or not 1000 < len(rows) < 5000: raise ValueError('Unexpected camera count')
    if len({r['cameraId'] for r in rows}) != len(rows): raise ValueError('Duplicate source camera IDs')
    counties = read_json(BOUNDARY_URL+'/query?'+urllib.parse.urlencode({'where':'1=1','outFields':'JURLBL,JURNM','outSR':4326,'returnGeometry':'true','f':'json'}))['features']
    if len(counties)!=39: raise ValueError('Expected 39 Washington county boundaries')
    mapped = {f['attributes']['CameraID']: f for f in features}
    records = []
    source_ids = {r['cameraId'] for r in rows}
    excluded = []
    for r in rows:
        cid=r['cameraId']
        if cid in mapped:
            lat,lon=coordinate(mapped[cid])
        else:
            detail=read_json(f'{LIST_URL}/{cid}')
            lat,lon=detail.get('latitude'),detail.get('longitude')
            if not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)) or not (45<lat<50 and -125<lon<-116):
                raise ValueError(f'Missing or invalid camera detail coordinates: {cid}')
            time.sleep(.03)
        records.append((r,lat,lon,'list'))
    # Include additional map cameras physically in Washington. Most map-only
    # records are Oregon cameras; retain their IDs in reconciliation metadata.
    for f in features:
        a=f['attributes']; cid=a['CameraID']
        if cid in source_ids: continue
        lat,lon=coordinate(f)
        county=county_at(lat,lon,counties)
        if not county:
            excluded.append(cid); continue
        title=a.get('CameraTitle') or f'WSDOT camera {cid}'
        match=re.match(r'(I-\d+|US \d+[A-Z]?|SR \d+)',title)
        r={'cameraId':cid,'cameraLabel':title,'cameraUrl':a['ImageURL'],'stateRoute':match.group(0) if match else 'Other roads','direction':{'B':'Both directions','N':'Northbound','S':'Southbound','E':'Eastbound','W':'Westbound'}.get(a.get('CompassDirection'),'')}
        records.append((r,lat,lon,'map'))
    groups=collections.defaultdict(list)
    for record in records: groups[url_key(record[0]['cameraUrl'])].append(record)
    cameras=[]
    for key,group in groups.items():
        # Prefer map-matched identity so official map deep link has a feature.
        group.sort(key=lambda item:(item[0]['cameraId'] not in mapped,item[0]['cameraId']))
        r,lat,lon,origin=group[0]; cid=r['cameraId']; url=r['cameraUrl']
        county=county_at(lat,lon,counties)
        name=r['cameraLabel'].strip()
        metro=AREA_BY_COUNTY.get(county,'Columbia Gorge' if 'Bridge of the Gods' in name else 'Other Washington')
        roads=sorted({x[0].get('stateRoute') or 'Other roads' for x in group})
        source_ids_for_view=sorted(x[0]['cameraId'] for x in group)
        if url.startswith('http://'): embed='official'
        elif not url.startswith('https://'): raise ValueError(f'Unexpected image URL: {url}')
        else: embed='image'
        cameras.append({'id':f'wsdot-{cid}','siteId':f'wsdot-site-{cid}','viewId':cid,
            'name':name,'location':name,'aliases':sorted({x[0]['cameraLabel'] for x in group}),
            'sourceIds':source_ids_for_view,'road':r.get('stateRoute') or roads[0],'roads':roads,
            'lat':round(lat,6),'lon':round(lon,6),'hasValidCoordinates':True,
            'county':county,'city':'','metro':metro,'region':metro,'district':'',
            'provider':('WSDOT' if (r.get('camCredit') or '').startswith('Sign up') else (r.get('camCredit') or 'WSDOT').strip()),
            'direction':r.get('direction') or '', 'imageUrl':url,'videoUrl':None,
            'officialUrl':f'https://wsdot.com/Travel/Real-time/Map/?featureid={cid}&featuretype=camera',
            'embedMode':embed,'disabled':False,'imageStatus':'unchecked','sourceStatus':'Listed by WSDOT',
            'videoAvailableOnOfficial':False,'statusReason':'','catalogOrigin':origin,
            'category':'Airport' if 'Airports' in roads else 'Ferry' if 'Ferries' in roads else 'Local roads' if 'City & County Cams' in roads else 'Highway'})
    cameras.sort(key=lambda c:(c['metro'],c['road'],c['name'],c['id']))
    return cameras,{'listEntryCount':len(rows),'mapEntryCount':len(features),'includedSourceEntryCount':len(records),'deduplicatedAliases':len(records)-len(cameras),'mapSupplementIds':sorted(r[0]['cameraId'] for r in records if r[3]=='map'),'excludedMapOutsideWashingtonIds':sorted(excluded),'listNotInMapIds':sorted(source_ids-set(mapped)),'countyBoundaryCount':len(counties),'countyUnmatchedCount':sum(not c['county'] for c in cameras)}
def image_dimensions(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        if len(data) < 24 or data[12:16] != b"IHDR":
            raise ValueError("Invalid PNG")
        return "png", *struct.unpack(">II", data[16:24])
    if not data.startswith(b"\xff\xd8") or not data.rstrip().endswith(b"\xff\xd9"):
        raise ValueError("Not a complete JPEG or PNG")
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            raise ValueError("Invalid JPEG marker")
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        marker = data[offset]
        offset += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        length = struct.unpack(">H", data[offset:offset + 2])[0]
        if length < 2 or offset + length > len(data):
            raise ValueError("Truncated JPEG segment")
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
            return "jpeg", width, height
        offset += length
    raise ValueError("JPEG dimensions not found")


def audit_camera(camera):
    result = {"id": camera["id"], "checkedAt": timestamp(), "httpStatus": None, "embedMode": "image", "sourceImageStatus": "unavailable"}
    if camera["disabled"]:
        result.update({"sourceImageStatus": "disabled", "error": "Disabled or blocked in public source catalog"})
        return result
    try:
        status, headers, body = fetch(camera["imageUrl"])
        headers = {key.lower(): value for key, value in headers.items()}
        result.update({"httpStatus": status, "contentType": headers.get("content-type", ""), "bytes": len(body),
                       "cors": headers.get("access-control-allow-origin"), "lastModified": headers.get("last-modified")})
        if not result["contentType"].startswith(("image/jpeg", "image/png")):
            raise ValueError("Response is not a JPEG or PNG image")
        format_name, width, height = image_dimensions(body)
        if not 0 < width < 20_000 or not 0 < height < 20_000:
            raise ValueError("Invalid image dimensions")
        digest = hashlib.sha256(body).hexdigest()
        result.update({"sha256": digest, "width": width, "height": height, "isPlaceholder": digest in KNOWN_PLACEHOLDERS})
        if digest in KNOWN_PLACEHOLDERS:
            result["error"] = KNOWN_PLACEHOLDERS[digest]
        else:
            result["sourceImageStatus"] = "available"
            if result["lastModified"]:
                age = (dt.datetime.now(dt.timezone.utc) - email.utils.parsedate_to_datetime(result["lastModified"])).total_seconds()
                result["sourceAgeSeconds"] = max(0, round(age))
                if age > 3600:
                    result.update({"sourceImageStatus": "stale", "error": "Provider Last-Modified is over one hour old"})
        if len(body) < 120_000:
            samples = Path("/tmp/washington-camera-audit-samples")
            samples.mkdir(exist_ok=True)
            (samples / f"{digest}.{format_name}").write_bytes(body)
    except urllib.error.HTTPError as error:
        result.update({"httpStatus": error.code, "error": f"HTTP {error.code}"})
    except Exception as error:
        result["error"] = str(error)[:180]
    return result


def audit_with_retry(camera):
    result = audit_camera(camera)
    result['attempts'] = 1
    # Snapshot files can be read while the source is replacing them. Retry an
    # invalid HTTP-200 body once; do not endlessly retry offline cameras.
    if result['sourceImageStatus'] == 'unavailable' and result.get('httpStatus') == 200 and not result.get('isPlaceholder'):
        first_error = result.get('error', '')
        time.sleep(1.2)
        result = audit_camera(camera)
        result['attempts'] = 2
        result['firstAttemptError'] = first_error
    return result


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'dist')
    parser.add_argument('--audit',action='store_true')
    parser.add_argument('--audit-only',action='store_true')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    if args.audit_only:
        catalog=json.loads((args.output/'camera-catalog.json').read_text())
    else:
        cameras,reconciliation=normalize()
        catalog={'fetchedAt':timestamp(),'source':'WSDOT public Travel Center list and map','sourceUrl':'https://wsdot.com/travel/real-time/','siteCount':len(cameras),'viewCount':len(cameras),'mapSiteCount':sum(c['hasValidCoordinates'] for c in cameras),'inlineCameraCount':sum(c['embedMode']=='image' for c in cameras),'officialOnlyCount':sum(c['embedMode']!='image' for c in cameras),'videoCameraCount':0,'refreshSeconds':300,'metroCounts':dict(sorted(collections.Counter(c['metro'] for c in cameras).items())),'reconciliation':reconciliation,
            'sourceEndpoints':{'list':LIST_URL,'map':MAP_URL,'counties':BOUNDARY_URL},
            'notes':[
                'Sources are the public WSDOT Travel Center camera list and map JSON. All IDs and image URLs are published by WSDOT; no guessed IDs or registered developer API key is used.',
                'Identical image URLs are merged, preserving all source IDs, labels and road aliases. Map-only cameras outside Washington county boundaries are excluded; camera views in the Travel Center list are retained.',
                'Counties are assigned by point-in-polygon against WSDOT Travel Center county boundaries. Area labels are editorial county-based groups, not official metro boundaries. Missing or boundary-ambiguous counties remain blank.',
                'The catalog includes WSDOT-listed airport, ferry and local partner cameras as well as highways. Use the road filter to select these source categories.',
                'Images load from their original public hosts. They are still snapshots, not continuous video. Five-minute refresh follows the WSDOT Travel Center map guidance.',
                'Availability checks are dated HTTP/image observations. Last-Modified and browser fetched time do not prove when the camera captured the scene.'], 'cameras':cameras}
        write_json(args.output/'camera-catalog.json',catalog)
    cameras=catalog['cameras']
    print(f"Catalog: {len(cameras)} views; {len(catalog['metroCounts'])} populated areas; reconciliation: {catalog.get('reconciliation')}",flush=True)
    if args.audit or args.audit_only:
        started=timestamp();results=[]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for result in pool.map(audit_with_retry,cameras):
                results.append(result)
                if len(results)%100==0 or len(results)==len(cameras): print(f'Image audit: {len(results)}/{len(cameras)}',flush=True)
        counts={status:sum(row['sourceImageStatus']==status for row in results) for status in ('available','stale','disabled','unavailable')}
        audit={'startedAt':started,'completedAt':timestamp(),'source':catalog['sourceUrl'],'total':len(results),'method':'One GET per distinct published image URL, with one retry for invalid HTTP-200 bodies, four workers, 20-second timeout and 8 MB response cap. JPEG/PNG signatures and dimensions checked. Known provider notices identified by SHA-256 after visual review. Last-Modified over one hour is labeled stale; headers are not capture-time proof.','scope':'All deduplicated WSDOT Travel Center views included in this catalog','counts':counts,'inlineCounts':counts,'cameras':results}
        write_json(args.output/'source-audit.json',audit)
        lookup={r['id']:r for r in results}
        for camera in cameras:
            result=lookup[camera['id']]
            for key in ('checkedAt','httpStatus','sourceImageStatus','lastModified','sourceAgeSeconds','isPlaceholder'):
                camera.pop(key,None)
                if key in result:camera[key]=result[key]
            camera['imageStatus']=result['sourceImageStatus']
            camera['imageWidth'],camera['imageHeight']=result.get('width'),result.get('height')
            camera['statusReason']=result.get('error','')
        catalog.update({'auditCompletedAt':audit['completedAt'],'auditCounts':counts,'inlineAuditCounts':counts,'auditScope':audit['scope']})
        write_json(args.output/'camera-catalog.json',catalog);print(json.dumps(counts),flush=True)

if __name__=='__main__':main()
