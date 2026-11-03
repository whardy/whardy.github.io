#!/usr/bin/env python3
"""Refresh Maryland Camera Desk from the official public CHART camera catalog.

python3 scripts/refresh-catalog.py --audit
Requires Python 3 and curl. No accounts, copied credentials, proxies, or private
camera addresses are used. The official CHART frontend publishes the snapshot
path and builds the same unsigned HLS addresses included here.
"""
from __future__ import annotations
import argparse, collections, concurrent.futures, datetime as dt, email.utils
import hashlib, json, re, struct, subprocess, tempfile, urllib.parse
from pathlib import Path

BASE = 'https://chart.maryland.gov'
CATALOG_URL = BASE + '/DataFeeds/GetCamerasJson'
BOUNDARY_SERVICE = 'https://mdgeodata.md.gov/imap/rest/services/Boundaries/MD_PoliticalBoundaries/FeatureServer/1'
BOUNDARY_URL = BOUNDARY_SERVICE + '/query?' + urllib.parse.urlencode({'where':'1=1','outFields':'COUNTY','returnGeometry':'true','outSR':'4326','geometryPrecision':'6','f':'geojson'})
OUT = Path(__file__).resolve().parents[1] / 'dist'
REGIONS = {'Wash. DC':'Washington suburbs','Western MD':'Western Maryland','Southern MD':'Southern Maryland','Baltimore':'Baltimore','Annapolis':'Annapolis','Eastern Shore':'Eastern Shore'}
HOSTS = {'strmr3.sha.maryland.gov','strmr5.sha.maryland.gov','strmr10.sha.maryland.gov'}
# Exact audit frames visually verified as blank or provider "NO VIDEO" cards.
# Timestamped cards change hashes; unknown future frames are not assumed valid
# scenes merely because they are structurally valid JPEGs.
PLACEHOLDER_HASHES = {
 '28f4e2a5ee2ba3ad21458c75045b9a98e3434e387a3025b0dcc5fa0e517e0768',
 '42f091cde056cfd871162b2631c929790614ffbdbc8aa90c23d360fa117de923',
 '55265903fee9dc9eb9552c21d5179f59c89c0924847fc13111e23d240b851f53',
 '644dd69fd61370be2d045ce417254ab87ca123277a55456bff563fd09a6e396c',
 '8b7fb05b4934f03b0d9fadcff6ca1db5226c9781bb223969fe602ad95c6cd286',
 'd1f750e77b464ee63545d9181f523ae5f487d77c798ced7e08255cd1c671681d',
 'da795fb6376a93ebe8e23319c37505547b2c98222dc49c862d2ea2c1f6b35c93',
 'e5b9c72306cebc6b21df33c7a8f9553200611451dfd5e03ab8ca9cbd4c2f154c',

 '306caedc2992444e6981808969212c37bb9952349093dea1d9f14886f9281dc4',
 '92bfb449c8dd40e4682cea7ff2346d054273564c3db3d444fd37002304079322',
 '1815c39fecb4c298f9b83d4b0343f89eb88e4d1452c04be40b43931a7af8ab60',
 'd2e61c86feed095cae147e988b50e1ed65ebe192da325dbe95096fde41bd76a0',
 '47bbc4a5bb5316d554fa503ec288583fa67056764b17c579a5e4700fba57acf9',
 '862fd3201729a61ce5b1c7598079b701b5c3d3e7c59bcdd724de05e2717ddfc7',
 '92085b03f2df27b97b05ce331e574484ad94e13824d0710818c12e618a18ccb7',
 'f045f7d53ff2f7b5c56158f19b3519e8d07f94bc793b9b9aaac8f9448458cdea',
 'd62cf6fb8e8731c8923660e802488af11835c5c2bfd17ba73a1e915f17dfd33f',
 'e6e9f4d436b1311818862f16f00802e4e141a757a5a41e904236948456e2e7c5',
 '369e3bbb7d2b5838b7820cb0083388238e31f00249ec0cf766ac624c51c32888',
 '387cd86e41348ced5409ee247194054327497df8f4c8b4b865d95738758f01e2',
}
BAD_FRAME_HASHES = {'0ca9c9d5b8f3d86fef23ae263ff19d9456ea18d955f9645ebc4425f7fdd99b5b'}
REVIEW_IMAGES = False

def timestamp(): return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')

def fetch(url, max_bytes=8_000_000):
    # curl is the transport because the official site rejects urllib's default
    # client. Use normal public GET requests; no cookies or authentication.
    with tempfile.TemporaryDirectory() as work:
        body, headers = Path(work)/'body', Path(work)/'headers'
        result = subprocess.run(['curl','--silent','--show-error','--max-time','20','--max-filesize',str(max_bytes),'-D',str(headers),'-o',str(body),'-w','%{http_code}',url],capture_output=True)
        code = int(result.stdout or 0)
        if result.returncode: raise ValueError(f'GET failed ({result.returncode}): {result.stderr.decode()[:100]}')
        if code != 200: raise ValueError(f'HTTP {code}')
        data = body.read_bytes()
        if len(data)>max_bytes: raise ValueError('Response exceeds size limit')
        values = {}
        for line in headers.read_text().splitlines():
            if ':' in line:
                key,value=line.split(':',1);values[key.lower()]=value.strip()
        return code,values,data

def ring_contains(ring,x,y):
    inside=False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        x1,y1=a[:2];x2,y2=b[:2]
        if (y1>y)!=(y2>y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1: inside=not inside
    return inside

def county_at(features,lon,lat):
    if lon is None or lat is None:return ''
    found=[]
    for feature in features:
        geom=feature['geometry'];polys=geom['coordinates'] if geom['type']=='MultiPolygon' else [geom['coordinates']]
        for rings in polys:
            if ring_contains(rings[0],lon,lat) and not any(ring_contains(r,lon,lat) for r in rings[1:]):
                found.append(feature['properties']['COUNTY']);break
    # Preserve ambiguous/border points as unresolved; never guess nearest county.
    return found[0] if len(found)==1 else ''

def route(row):
    prefix={'IS':'I'}.get(row.get('routePrefix'),row.get('routePrefix') or '')
    number=row.get('routeNumber')
    if prefix in ('I','US','MD') and isinstance(number,(int,float)) and number>0:return f'{prefix}-{int(number)}{row.get("routeSuffix") or ""}'
    text=row.get('description') or row.get('name') or ''
    match=re.search(r'\b(I|US|MD)[ -]?(\d+)([A-Z]?)(?:\b)',text)
    if match:return f'{match[1]}-{match[2]}{match[3]}'
    return 'Local roads / other'

def normalize(rows,boundaries):
    cameras=[]
    for row in rows:
        ident=str(row['id']);host=row.get('cctvIp');official=row.get('publicVideoURL')
        if not re.fullmatch(r'[a-f0-9]{32}',ident):raise ValueError('Unexpected public camera identifier')
        if host not in HOSTS:raise ValueError(f'Unreviewed public streaming host: {host}')
        if official!=BASE+'/Video/GetVideo/'+ident:raise ValueError('Unexpected official viewer URL')
        lat,lon=row.get('lat'),row.get('lon')
        valid=isinstance(lat,(int,float)) and isinstance(lon,(int,float)) and 37.8<lat<39.8 and -79.6<lon<-75
        if not valid:lat=lon=None
        categories=row.get('cameraCategories') or []
        metro=REGIONS.get(categories[0],categories[0]) if categories else 'Other Maryland'
        status=row.get('opStatus') or 'Unknown'
        cameras.append({'id':ident,'siteId':ident,'viewId':ident,'name':row.get('description') or row.get('name') or ident,'sourceName':row.get('name') or '',
                        'description':row.get('description') or '', 'direction':'','lat':lat,'lon':lon,'hasValidCoordinates':valid,
                        'road':route(row),'county':county_at(boundaries,lon,lat),'countyMethod':'Official MD iMAP political boundary point-in-polygon',
                        'region':metro,'metro':metro,'jurisdiction':metro,'sourceRegions':categories,'provider':'MDOT SHA / CHART',
                        'imageUrl':BASE+'/wwwroot/thumbnails/'+ident+'.jpg','videoUrl':f'https://{host}/rtplive/{ident}/playlist.m3u8','iosVideoUrl':None,
                        'officialUrl':official,'officialLinkType':'camera-player','disabled':False,'problemStream':status=='COMM_FAILURE','sourceStatus':status,
                        'communicationMode':row.get('commMode'),'sourceCachedAt':row.get('lastCachedDataUpdateTime'),
                        'imageStatus':'unchecked','videoStatus':'unchecked'})
    if len(set(c['id'] for c in cameras))!=len(cameras):raise ValueError('Duplicate camera ID')
    return sorted(cameras,key=lambda c:(c['metro'],c['road'],c['name'],c['id']))

def image_size(body):
    if not body.startswith(b'\xff\xd8') or not body.rstrip().endswith(b'\xff\xd9'):raise ValueError('Not a complete JPEG')
    offset=2
    while offset+4<=len(body):
        if body[offset]!=255:raise ValueError('Invalid JPEG marker')
        while offset<len(body) and body[offset]==255:offset+=1
        marker=body[offset];offset+=1
        if marker in (0xd8,0xd9) or 0xd0<=marker<=0xd7:continue
        length=struct.unpack('>H',body[offset:offset+2])[0]
        if length<2 or offset+length>len(body):raise ValueError('Truncated JPEG')
        if marker in (0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf):
            height,width=struct.unpack('>HH',body[offset+3:offset+7]);return width,height
        offset+=length
    raise ValueError('JPEG dimensions missing')

def audit_image(camera):
    result={'id':camera['id'],'imageUrl':camera['imageUrl'],'checkedAt':timestamp(),'httpStatus':None,'imageStatus':'unavailable'}
    try:
        request_url=camera['imageUrl']+'?_='+str(int(dt.datetime.now(dt.timezone.utc).timestamp()//60))
        code,headers,body=fetch(request_url,3_000_000)
        digest=hashlib.sha256(body).hexdigest();width,height=image_size(body)
        result.update({'httpStatus':code,'contentType':headers.get('content-type'),'bytes':len(body),'width':width,'height':height,'lastModified':headers.get('last-modified'),'sha256':digest,'isPlaceholder':digest in PLACEHOLDER_HASHES})
        if REVIEW_IMAGES:
            root=Path(tempfile.gettempdir())/'maryland-camera-audit-images';root.mkdir(exist_ok=True);(root/(digest+'.jpg')).write_bytes(body)
        if digest in PLACEHOLDER_HASHES:raise ValueError('Visually verified unavailable-image card or blank frame')
        if digest in BAD_FRAME_HASHES:raise ValueError('Visually verified corrupted image frame')
        result['imageStatus']='available'
        if result['lastModified']:
            age=(dt.datetime.now(dt.timezone.utc)-email.utils.parsedate_to_datetime(result['lastModified'])).total_seconds()
            result['sourceAgeSeconds']=max(0,round(age))
            if age>3600:result['imageStatus']='stale';result['error']='Source Last-Modified is over one hour old'
    except Exception as e:result.update({'imageStatus':'unavailable','error':str(e)[:180]})
    return result

def playlist(url):
    code,headers,body=fetch(url,200_000);text=body.decode('utf-8-sig')
    if not text.startswith('#EXTM3U') or not ('#EXT-X-STREAM-INF:' in text or '#EXTINF:' in text):raise ValueError('No playable HLS playlist entries')
    if headers.get('access-control-allow-origin') not in ('*','https://whardy.github.io'):raise ValueError('HLS response lacks browser CORS permission')
    return code,headers,body,text

def audit_video(camera):
    result={'id':camera['id'],'url':camera['videoUrl'],'checkedAt':timestamp(),'httpStatus':None,'videoStatus':'unavailable'}
    try:
        code,headers,body,text=playlist(camera['videoUrl'])
        result.update({'httpStatus':code,'contentType':headers.get('content-type'),'cors':headers.get('access-control-allow-origin'),'manifestBytes':len(body),'videoStatus':'available'})
    except Exception as e:result['error']=str(e)[:180]
    return result

def safe_media_join(base,value):
    url=urllib.parse.urljoin(base,value);u=urllib.parse.urlsplit(url)
    if u.scheme!='https' or u.hostname!=urllib.parse.urlsplit(base).hostname or u.username or u.password or u.query or not u.path.startswith('/rtplive/'):raise ValueError('Unreviewed HLS media address')
    return url

def sample_segment(camera):
    result={'id':camera['id'],'host':urllib.parse.urlsplit(camera['videoUrl']).hostname,'checkedAt':timestamp(),'status':'unavailable'}
    try:
        url=camera['videoUrl'];_,_,_,text=playlist(url)
        first=next(line.strip() for line in text.splitlines() if line.strip() and not line.startswith('#'))
        if '#EXT-X-STREAM-INF:' in text:
            url=safe_media_join(url,first);_,_,_,text=playlist(url)
        segment=safe_media_join(url,next(line.strip() for line in text.splitlines() if line.strip() and not line.startswith('#')))
        code,headers,body=fetch(segment,8_000_000)
        if headers.get('access-control-allow-origin') not in ('*','https://whardy.github.io'):raise ValueError('Segment CORS permission missing')
        if len(body)<188*3 or not any(body[i]==body[i+188]==body[i+376]==0x47 for i in range(min(188,len(body)-376))):raise ValueError('Segment lacks MPEG-TS packet signatures')
        result.update({'status':'available','segmentHttpStatus':code,'segmentCors':headers.get('access-control-allow-origin'),'segmentBytes':len(body),'segmentContentType':headers.get('content-type')})
    except Exception as e:result['error']=str(e)[:180]
    return result

def write_json(path,data):
    tmp=path.with_suffix('.json.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(path)

def main():
    global REVIEW_IMAGES
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=OUT);parser.add_argument('--audit',action='store_true');parser.add_argument('--review-images',action='store_true');parser.add_argument('--catalog-file',type=Path);parser.add_argument('--boundaries-file',type=Path)
    args=parser.parse_args();REVIEW_IMAGES=args.review_images
    source=json.loads(args.catalog_file.read_bytes() if args.catalog_file else fetch(CATALOG_URL,10_000_000)[2])
    boundaries=json.loads(args.boundaries_file.read_bytes() if args.boundaries_file else fetch(BOUNDARY_URL,25_000_000)[2])
    if not isinstance(source,list) or len(source)<100:raise ValueError('Unexpected catalog')
    if boundaries.get('exceededTransferLimit') or len(boundaries.get('features',[]))!=24:raise ValueError('Incomplete county boundaries')
    cameras=normalize(source,boundaries['features']);output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    catalog={'fetchedAt':timestamp(),'source':'Maryland CHART / MDOT SHA','sourceUrl':BASE+'/TrafficCameras/GetTrafficCameras','catalogEndpoint':CATALOG_URL,'countyBoundarySource':BOUNDARY_SERVICE,'countyBoundaryCount':24,'countyAssignedCount':sum(bool(c['county']) for c in cameras),'siteCount':len(cameras),'viewCount':len(cameras),'metroCounts':dict(collections.Counter(c['metro'] for c in cameras)),'cameras':cameras,'notes':[
        'Camera locations, public viewer links, route fields, regional categories and source status come from the official public CHART feed.',
        'Snapshot paths and unsigned HTTPS HLS paths follow the official public CHART camera page and player. Camera media loads directly from Maryland servers; no relay is required.',
        'Metro / region follows six CHART regional groupings, not statistical metropolitan boundaries. County labels use official Maryland political boundary polygons; ambiguous or out-of-state bridge points remain unassigned.',
        'The source cached timestamp describes metadata caching, not camera image capture time. Fetched timestamps do not establish scene freshness.',
        'Source communication status and dated endpoint checks are separate. Snapshot age never disables a video stream. Checks do not guarantee future availability. No stream is recorded or archived.'
    ]}
    write_json(output/'camera-catalog.json',catalog);print(f'Saved {len(cameras)} Maryland cameras; {catalog["countyAssignedCount"]} county assignments',flush=True)
    if not args.audit:return
    for url in [BASE+'/wwwroot/thumbnails/no-image-available.jpg',BASE+'/thumbnails/offline.jpg']:
        try:PLACEHOLDER_HASHES.add(hashlib.sha256(fetch(url,3_000_000)[2]).hexdigest())
        except Exception:pass
    started=timestamp();images=[];videos=[]
    for label,worker,results in [('Image',audit_image,images),('HLS',audit_video,videos)]:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for i,item in enumerate(pool.map(worker,cameras),1):
                results.append(item)
                if i%100==0 or i==len(cameras):print(f'{label} audit: {i}/{len(cameras)}',flush=True)
    lookup={r['id']:r for r in videos};samples=[]
    for host in sorted(HOSTS):
        candidates=[c for c in cameras if urllib.parse.urlsplit(c['videoUrl']).hostname==host and lookup[c['id']]['videoStatus']=='available']
        for camera in candidates[:3]:
            result=sample_segment(camera);samples.append(result)
            if result['status']=='available':break
    counts=dict(collections.Counter(r['imageStatus'] for r in images));video_counts=dict(collections.Counter(r['videoStatus'] for r in videos));finished=timestamp()
    audit={'startedAt':started,'completedAt':finished,'source':BASE+'/DataFeeds/GetDataFeeds','total':len(images),'method':'Every public snapshot and HLS master checked with four workers and 20-second timeout. JPEG structure and known official placeholders checked. Source Last-Modified over one hour is marked stale. HLS syntax and CORS checked. One child playlist and MPEG-TS segment sampled per successful host; not every stream was played. No recording.','counts':counts,'videoCounts':video_counts,'cameras':images,'videos':videos,'segmentSamples':samples,'placeholderHashes':sorted(PLACEHOLDER_HASHES)}
    write_json(output/'source-audit.json',audit)
    image_lookup={r['id']:r for r in images}
    for camera in cameras:
        image=image_lookup[camera['id']];video=lookup[camera['id']]
        for key in ['imageStatus','httpStatus','checkedAt','isPlaceholder','lastModified','sourceAgeSeconds']: 
            if key in image:camera[key]=image[key]
        camera['imageWidth']=image.get('width');camera['imageHeight']=image.get('height');camera['videoStatus']=video['videoStatus'];camera['videoCheckedAt']=video['checkedAt']
    catalog.update({'auditCompletedAt':finished,'auditCounts':counts,'videoAuditCounts':video_counts});write_json(output/'camera-catalog.json',catalog)
    print(json.dumps({'images':counts,'videos':video_counts,'segments':samples}),flush=True)

if __name__=='__main__':main()
