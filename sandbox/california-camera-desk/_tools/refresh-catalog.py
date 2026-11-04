#!/usr/bin/env python3
"""Reproducible California public traffic camera catalog, without keys or relay.

Discover district URLs on the official CWWP2 page. Preserve last-good raw JSON on
partial failure, reconcile official GIS and statewide viewer, and optionally make
one bounded availability check per unique image/playlist. Availability is dated;
playlist syntax is not proof of browser decoding. No continuous streaming.
"""
from __future__ import annotations
import argparse, ast, collections, concurrent.futures, datetime as dt
import email.utils, gzip, hashlib, json, math, re, struct, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path

HOME = 'https://cwwp2.dot.ca.gov/'
PAGE = HOME + 'closed-circuit-television-cameras.html'
VIEWER = HOME + 'vm/js/cctv03.js'
GIS = 'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/chhighway/CCTV/MapServer/0'
COUNTY_VIEWER = 'https://saecommon.sccgov.org/drupalhtml/rda_map/SCCGOV_Live_Traffic.html'
COUNTY_DATA = 'https://saecommon.sccgov.org/drupalhtml/rda_map/js/rda_live_traffic_locations_data.js'
UA = 'CaliforniaCameraDesk/1.0 (+https://whardy.github.io/sandbox/california-camera-desk/; bounded public catalog check)'
KNOWN_PLACEHOLDERS = {}


def now(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
def clean(v):
    value = str(v).strip() if v is not None else ''
    return '' if value.lower() in {'not reported', 'unknown', 'null', 'none', 'n/a'} else value

def number(v):
    try:
        value = float(v)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError): return None

def fetch(url, max_bytes=16_000_000, timeout=15):
    request = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip', 'Origin':'https://whardy.github.io'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes: raise ValueError('Response exceeds bounded size')
        if body[:2] == b'\x1f\x8b': body = gzip.decompress(body)
        if len(body) > max_bytes: raise ValueError('Expanded response exceeds bounded size')
        return response.status, {k.lower():v for k,v in response.headers.items()}, body, response.url

def read_json(url):
    value = json.loads(fetch(url)[2].decode('utf-8-sig'))
    if isinstance(value,dict) and value.get('error'): raise ValueError(str(value['error']))
    return value

def write_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    temporary.replace(path)

def safe_url(v):
    value=clean(v)
    try:
        parsed=urllib.parse.urlsplit(value)
        return value if parsed.scheme=='https' and parsed.hostname and not parsed.username and not parsed.password else None
    except ValueError:return None

def endpoint_key(url):
    p=urllib.parse.urlsplit(url)
    host=p.hostname.lower()
    if p.port and p.port != 443: host += ':'+str(p.port)
    return urllib.parse.urlunsplit(('https',host,p.path,p.query,''))

def road_name(value):
    value=clean(value)
    m=re.fullmatch(r'(?:SR|CA|State Route)[ -]*(\d+[A-Z]?)',value,re.I)
    if m: return 'CA-'+m[1].upper()
    m=re.fullmatch(r'(I|US)[ -]*(\d+[A-Z]?)',value,re.I)
    return f'{m[1].upper()}-{m[2].upper()}' if m else value or 'Other roads'

BAY={'Alameda','Contra Costa','Marin','Napa','San Francisco','San Mateo','Santa Clara','Solano','Sonoma'}
COUNTY_REGION={
 'Los Angeles':'Los Angeles','Ventura':'Los Angeles & Ventura','Orange':'Orange County',
 'Riverside':'Inland Empire','San Bernardino':'Inland Empire','San Diego':'San Diego','Imperial':'Imperial Valley & desert',
 'Sacramento':'Sacramento','Yolo':'Sacramento','Sutter':'Sacramento & north valley','Yuba':'Sacramento & north valley',
 'San Joaquin':'Central Valley','Stanislaus':'Central Valley','Merced':'Central Valley','Madera':'Central Valley','Fresno':'Central Valley','Kings':'Central Valley','Tulare':'Central Valley','Kern':'Central Valley',
 'Monterey':'Central Coast','San Benito':'Central Coast','Santa Cruz':'Central Coast','San Luis Obispo':'Central Coast','Santa Barbara':'Central Coast',
 'Del Norte':'North Coast','Humboldt':'North Coast','Mendocino':'North Coast','Lake':'North Coast & inland',
 'Shasta':'Shasta / Cascades','Siskiyou':'Shasta / Cascades','Tehama':'Shasta / Cascades','Lassen':'Shasta / Cascades','Modoc':'Shasta / Cascades','Trinity':'Shasta / Cascades',
 'Inyo':'Eastern Sierra','Mono':'Eastern Sierra','Placer':'Sierra / Tahoe','El Dorado':'Sierra / Tahoe','Nevada':'Sierra / Tahoe','Sierra':'Sierra / Tahoe','Plumas':'Sierra / Tahoe','Alpine':'Sierra / Tahoe',
 'Amador':'Sierra foothills','Calaveras':'Sierra foothills','Tuolumne':'Sierra foothills','Mariposa':'Sierra foothills',
 'Butte':'North Central Valley','Colusa':'North Central Valley','Glenn':'North Central Valley'}

def region(location):
    county=clean(location.get('county'))
    lat=number(location.get('latitude'));lon=number(location.get('longitude'))
    # Explicit editorial subregions within very large counties. They are not
    # incorporated-place boundaries; provider county and nearbyPlace are retained.
    if county in {'Placer','El Dorado'} and lon is not None and lon < -121.0:return 'Sacramento & foothills'
    if county in {'Riverside','San Bernardino'} and lon is not None and lon > -116.8:return 'Desert / Inland Empire'
    if county=='Los Angeles' and lat is not None and lat>34.55:return 'Antelope Valley & desert'
    return 'Bay Area' if county in BAY else COUNTY_REGION.get(county,'Other California')

def normalized_record(raw,origin='district',official_url=None):
    location=raw['location']; image=raw.get('imageData') or {};static=image.get('static') or {}
    district=f"D{int(location['district']):02d}"; index=clean(raw.get('index'))
    if not index:raise ValueError('Missing source index')
    lat=number(location.get('latitude'));lon=number(location.get('longitude'))
    valid=lat is not None and lon is not None and 32<=lat<=42.2 and -125<=lon<=-113.5
    if not valid:lat=lon=None
    stream=safe_url(image.get('streamingVideoURL')); video=stream if stream and urllib.parse.urlsplit(stream).path.lower().endswith('.m3u8') else None
    image_url=safe_url(static.get('currentImageURL'))
    timestamp=raw.get('recordTimestamp') or {}
    epoch=number(timestamp.get('recordEpoch'))
    source_updated=dt.datetime.fromtimestamp(epoch,dt.timezone.utc).isoformat().replace('+00:00','Z') if epoch else None
    nominal=number(static.get('currentImageUpdateFrequency'))
    in_service=clean(raw.get('inService')).lower();service=True if in_service=='true' else False if in_service=='false' else None
    desc=clean(image.get('imageDescription'));name=clean(location.get('locationName')) or f'Caltrans {district} camera {index}'
    facing=''
    # A clearly published "Looking ..." phrase is an image-facing label, not
    # the source direction-of-travel field.
    m=re.search(r'\bLooking\s+(North(?:east|west)?|South(?:east|west)?|East|West)\b',desc+' '+name,re.I)
    if m:facing=m[1].title()
    # Use a per-camera page only when observed in the official viewer list.
    # The remainder link to QuickMap rather than advertising guessed pages.
    return {'id':f'caltrans:{district}:{index}','siteId':f'caltrans:{district}:{re.sub(r"-\d+$", "", index)}','sourceId':index,'provider':'Caltrans','providerKey':'caltrans',
      'name':name,'location':name,'imageDescription':desc,'nearbyPlace':clean(location.get('nearbyPlace')),'city':'','metro':region(location),'region':region(location),
      'district':district,'county':clean(location.get('county')),'lat':lat,'lon':lon,'hasValidCoordinates':valid,
      'road':road_name(location.get('route')),'sourceRoad':clean(location.get('route')),'direction':clean(location.get('direction')),'directionSource':'published-travel-side','facingDirection':facing,
      'elevationFeet':number(location.get('elevation')),'postmile':clean(location.get('postmile')),'milepost':number(location.get('milepost')),'postmilePrefix':clean(location.get('postmilePrefix')),'routeSuffix':clean(location.get('routeSuffix')),'alignment':clean(location.get('alignment')),
      'imageUrl':image_url,'videoUrl':video,'sourceVideoUrl':stream,'officialUrl':official_url or 'https://quickmap.dot.ca.gov/',
      'snapshotUpdateSeconds':max(60,int(nominal*60)) if nominal and nominal>0 else 300,
      'sourceSnapshotUpdateMinutes':nominal,'inService':service,'sourceDisabled':service is False,'disabled':service is False,
      'imageStatus':'unchecked','videoStatus':'unchecked' if video else 'not-listed','checkedAt':None,'embedMode':'video' if video else 'image' if image_url else 'official',
      'recordTimestamp':timestamp,'sourceUpdatedAt':source_updated,'captureTime':None,'catalogOrigin':origin,'category':'Highway','sourceStatus':'Provider reports in service' if service else 'Provider reports out of service' if service is False else 'Service status not reported'}

def county_records(rows):
    result=[]
    for r in rows:
        for facing in ['NB','SB','EB','WB']:
            public=clean(r.get(facing))
            if not public or public=='000000':continue
            name=f"{r['name']} · {facing} view"
            lat,lon=number(r.get('lat')),number(r.get('lng'))
            valid=lat is not None and lon is not None and 32<=lat<=42.2 and -125<=lon<=-113.5
            if not valid:lat=lon=None
            result.append({'id':'sccroads:'+public,'siteId':'sccroads:'+str(r['id']),'sourceId':public,'provider':'Santa Clara County Roads','providerKey':'sccroads',
              'name':name,'location':r['name'],'imageDescription':clean(r.get(facing+'View')),'nearbyPlace':'Santa Clara County','city':'','metro':'Bay Area','region':'Bay Area','district':'','county':'Santa Clara',
              'lat':lat,'lon':lon,'hasValidCoordinates':valid,'road':r['name'].split(' & ')[0],'sourceRoad':r['name'].split(' & ')[0],
              'direction':'','directionSource':'unknown','facingDirection':facing,'elevationFeet':None,'postmile':'','milepost':None,'postmilePrefix':'','routeSuffix':'','alignment':'',
              'imageUrl':None,'videoUrl':None,'sourceVideoUrl':None,'officialUrl':COUNTY_VIEWER,'snapshotUpdateSeconds':300,'sourceSnapshotUpdateMinutes':None,'inService':None,'sourceDisabled':False,'disabled':False,
              'imageStatus':'official','videoStatus':'official','checkedAt':None,'embedMode':'official','recordTimestamp':{},'sourceUpdatedAt':None,'captureTime':None,'catalogOrigin':'county-public-viewer','category':'Local roads',
              'sourceStatus':'Official viewer · choose the named intersection and direction','officialInstructions':f"Choose {r['name']}, then {facing}. The county does not publish a verified per-camera deep link.",'countyCameraId':clean(r.get(facing+'Cam'))})
    return result

def fetch_source(raw_dir,key,url,refresh=True):
    file=raw_dir/key
    if not refresh and file.exists():return json.loads(file.read_text()),{'url':url,'status':'cached','fetchedAt':None,'file':str(file.name)}
    try:
        data=read_json(url)
        if key.startswith('caltrans-D'):
            records=data.get('data') if isinstance(data,dict) else None
            if not isinstance(records,list) or not records or any(not isinstance(r.get('cctv'),dict) for r in records):
                raise ValueError('Invalid or empty district response; last-known-good retained')
            validated=[normalized_record(r['cctv']) for r in records]
            if len({r['id'] for r in validated})!=len(validated):
                raise ValueError('Duplicate district view IDs; last-known-good retained')
            previous=json.loads(file.read_text()) if file.exists() else None
            if previous and len(records)<len(previous.get('data',[]))*0.5:
                raise ValueError('District lost over half its records; last-known-good retained pending review')
        write_json(file,data)
        return data,{'url':url,'status':'fetched','fetchedAt':now(),'file':file.name}
    except Exception as e:
        if not file.exists():raise
        return json.loads(file.read_text()),{'url':url,'status':'last-known-good','fetchedAt':None,'error':str(e),'file':file.name}

def image_dimensions(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data)>=24:return 'png',*struct.unpack('>II',data[16:24])
    if not data.startswith(b'\xff\xd8') or not data.rstrip().endswith(b'\xff\xd9'):raise ValueError('Not a complete JPEG/PNG')
    offset=2
    while offset+4<=len(data):
        if data[offset]!=255:raise ValueError('Invalid JPEG marker')
        while offset<len(data) and data[offset]==255:offset+=1
        marker=data[offset];offset+=1
        if marker in [216,217] or 208<=marker<=215:continue
        length=struct.unpack('>H',data[offset:offset+2])[0]
        if length<2 or offset+length>len(data):raise ValueError('Truncated JPEG')
        if marker in [192,193,194,195,197,198,199,201,202,203,205,206,207]:
            h,w=struct.unpack('>HH',data[offset+3:offset+7]);return 'jpeg',w,h
        offset+=length
    raise ValueError('No image dimensions')

def audit_endpoint(task):
    kind,url=task;result={'kind':kind,'url':url,'checkedAt':now(),'status':'unavailable'}
    try:
        status,headers,body,final=fetch(url,max_bytes=2_000_000,timeout=10)
        result.update({'httpStatus':status,'finalUrl':final,'contentType':headers.get('content-type'),'cors':headers.get('access-control-allow-origin'),'bytes':len(body),'lastModified':headers.get('last-modified')})
        if kind=='image':
            fmt,w,h=image_dimensions(body)
            if not (0<w<20000 and 0<h<20000):raise ValueError('Invalid image dimensions')
            digest=hashlib.sha256(body).hexdigest();result.update({'width':w,'height':h,'sha256':digest,'format':fmt})
            if digest in KNOWN_PLACEHOLDERS:raise ValueError(KNOWN_PLACEHOLDERS[digest])
            result['status']='available'; result['checkType']='complete image structure; representative browser decode separate'
        else:
            text=body.decode('utf-8-sig')
            if not text.startswith('#EXTM3U') or not any(x.strip() and not x.startswith('#') for x in text.splitlines()):raise ValueError('No playable HLS playlist entries')
            result['status']='available';result['checkType']='HLS manifest syntax only; browser playback not guaranteed'
            result['masterPlaylist']='#EXT-X-STREAM-INF' in text
    except Exception as e:
        result.update({'error':str(e),'httpStatus':getattr(e,'code',result.get('httpStatus'))})
    time.sleep(.06)
    return endpoint_key(url),result

def reconcile(raw_dir,rows,refresh):
    report={};cameras=[];by_id={c['id']:c for c in rows};images={endpoint_key(c['imageUrl']) for c in rows if c['imageUrl']};videos={endpoint_key(c['videoUrl']) for c in rows if c['videoUrl']}
    # The viewer's published list points to stable .htm camera pages. It is a
    # reconciliation source; do not copy Google Maps configuration or API keys.
    viewer_file=raw_dir/'caltrans-statewide-viewer.json'
    try:
        if refresh or not viewer_file.exists():
            text=fetch(VIEWER)[2].decode('cp1252');entries=[]
            for line in text.splitlines():
                m=re.search(r"cctv\[\d+\] = '(.*)';",line)
                if not m:continue
                u,lon,lat,name,stream=m[1].split('ÿ');entries.append({'url':u,'lon':number(lon),'lat':number(lat),'name':name,'streamListed':stream=='1'})
            write_json(viewer_file,{'fetchedAt':now(),'source':VIEWER,'entries':entries})
        viewer=json.loads(viewer_file.read_text());entries=viewer['entries']
        slugs={Path(urllib.parse.urlsplit(c['imageUrl']).path).stem:c for c in rows if c['imageUrl']};missing=[]
        for v in entries:
            slug=Path(urllib.parse.urlsplit(v['url']).path).stem
            if slug in slugs:slugs[slug]['officialUrl']=v['url']
            else:missing.append(v)
        report['statewideViewer']={'fetchedAt':viewer.get('fetchedAt'),'listedViews':len(entries),'notInDistrictCatalogs':missing,'matchedViews':len(entries)-len(missing),'note':'Viewer slugs compared with published snapshot names, not camera-ID guessing.'}
    except Exception as e:report['statewideViewer']={'error':str(e)}
    gis_file=raw_dir/'caltrans-gis.json'
    try:
        if refresh or not gis_file.exists():
            ids=read_json(GIS+'/query?'+urllib.parse.urlencode({'where':'1=1','returnIdsOnly':'true','f':'json'}))['objectIds'];features=[]
            for start in range(0,len(ids),100):
                batch=read_json(GIS+'/query?'+urllib.parse.urlencode({'objectIds':','.join(map(str,ids[start:start+100])),'outFields':'*','returnGeometry':'false','f':'json'}))
                features.extend(batch['features'])
            if len(features)!=len(ids):raise ValueError('Incomplete GIS object-ID pagination')
            write_json(gis_file,{'fetchedAt':now(),'source':GIS,'count':len(features),'features':features})
        gis=json.loads(gis_file.read_text());absent=[];aliases=[]
        for feature in gis['features']:
            a=feature['attributes'];ident=f"caltrans:D{int(a['district']):02d}:{a['index_']}"
            if ident in by_id:continue
            image=safe_url(a.get('currentImageURL'));video=safe_url(a.get('streamingVideoURL'))
            if (image and endpoint_key(image) in images) or (video and endpoint_key(video) in videos):aliases.append({'id':ident,'name':a['locationName']});continue
            absent.append(a)
        report['gis']={'fetchedAt':gis.get('fetchedAt'),'records':len(gis['features']),'pagination':'returnIdsOnly, all object IDs in batches of 100','absentIds':len(absent)+len(aliases),'endpointAliases':aliases,'additionalCandidates':len(absent),'added':[],'rejected':[]}
        # GIS is an older inventory. Only add missing records after a fresh
        # endpoint check and label its origin. Avoid resurrecting dead feeds.
        def check_supplement(a):
            raw={'index':str(a['index_']),'recordTimestamp':{'recordDate':a.get('recordDate'),'recordTime':a.get('recordTime'),'recordEpoch':a.get('recordEpoch')},'location':dict(a,milepost=a.get('Odometer')),'inService':a.get('inService'),'imageData':{'imageDescription':a.get('imageDescription'),'streamingVideoURL':a.get('streamingVideoURL'),'static':{'currentImageURL':a.get('currentImageURL'),'currentImageUpdateFrequency':a.get('currentImageUpdateFrequency')}}}
            c=normalized_record(raw,'official-gis-supplement');tests=[]
            if c['imageUrl']:tests.append(audit_endpoint(('image',c['imageUrl']))[1])
            if c['videoUrl']:tests.append(audit_endpoint(('video',c['videoUrl']))[1])
            return c,tests
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for c,tests in pool.map(check_supplement,absent):
                if any(t['status']=='available' for t in tests):
                    c['supplementAudit']=tests;cameras.append(c);report['gis']['added'].append(c['id'])
                else:report['gis']['rejected'].append({'id':c['id'],'name':c['name'],'checks':tests})
    except Exception as e:
        retained=[]
        old_catalog=raw_dir.parent/'camera-catalog.json'
        if old_catalog.exists():
            for previous in json.loads(old_catalog.read_text()).get('cameras',[]):
                if previous.get('catalogOrigin')=='official-gis-supplement' and previous['id'] not in by_id:
                    retained.append(previous)
        cameras.extend(retained)
        report['gis']={'error':str(e),'status':'last-known-good' if retained else 'unavailable','retainedSupplementViews':len(retained),'note':'District catalogs retained. Prior GIS supplements retained on reconciliation failure; original audit dates remain historical.'}
    return cameras,report

def build(args):
    out=args.output.resolve();raw_dir=out/'raw';raw_dir.mkdir(parents=True,exist_ok=True)
    travel_path=out/'travel-sources.json'
    try:
        chain_page=HOME+'chain-controls.html'
        chain_html=fetch(chain_page)[2].decode('utf-8')
        chain_urls=re.findall(r'href=["\']([^"\']+\.json)["\']',chain_html)
        districts=[{'district':f'D{int(re.search(r"StatusD(\d+)\.json",u)[1]):02d}','url':u} for u in chain_urls]
        if not districts:raise ValueError('No official chain-control links discovered')
        write_json(travel_path,{'fetchedAt':now(),'chainControls':{'sourcePage':chain_page,'nominalUpdateSeconds':60,'timeZone':'America/Los_Angeles','districts':districts,'officialUrl':'https://quickmap.dot.ca.gov/','note':'Manual on-demand checks. Record publication time differs from status last-change time. Missing feed is not no restrictions.'},'highwayConditionsUrl':'https://roads.dot.ca.gov/','laneClosuresUrl':HOME+'lane-closure.html'})
    except Exception:
        if not travel_path.exists():raise
    source_manifest_file=raw_dir/'source-manifest.json'
    old_manifest=json.loads(source_manifest_file.read_text()) if source_manifest_file.exists() else {}
    source_page=raw_dir/'cctv-source-page.html'
    if not args.from_cache or not source_page.exists():
        try:source_page.write_text(fetch(PAGE)[2].decode('utf-8'))
        except Exception:
            if not source_page.exists():raise
    links=re.findall(r'href=["\']([^"\']+\.json)["\']',source_page.read_text())
    district_urls={int(re.search(r'cctvStatusD(\d+)\.json',u)[1]):u for u in links if re.search(r'cctvStatusD(\d+)\.json',u)}
    if set(district_urls)!=set(range(1,13)):raise ValueError('Official page must account for exactly all 12 districts')
    cameras=[];sources=[]
    def district_task(item):
        district,url=item;data,meta=fetch_source(raw_dir,f'caltrans-D{district:02d}.json',url,not args.from_cache)
        records=data.get('data')
        if not isinstance(records,list) or not records:raise ValueError(f'D{district:02d} empty or invalid')
        results=[normalized_record(r['cctv']) for r in records]
        if len(set(c['id'] for c in results))!=len(results):raise ValueError('Duplicate district source IDs')
        meta.update({'district':f'D{district:02d}','views':len(results)})
        previous=old_manifest.get(f'D{district:02d}',{})
        if not meta.get('fetchedAt'):meta['fetchedAt']=previous.get('fetchedAt')
        return results,meta
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for records,meta in pool.map(district_task,sorted(district_urls.items())):cameras.extend(records);sources.append(meta)
    write_json(source_manifest_file,{m['district']:m for m in sources})
    supplements,reconciliation=reconcile(raw_dir,cameras,not args.from_cache);cameras.extend(supplements)
    county_file=raw_dir/'scccounty-locations.json'
    county_error=None
    try:
        if not args.from_cache or not county_file.exists():
            text=fetch(COUNTY_DATA)[2].decode('utf-8-sig')
            match=re.search(r'var locations\s*=\s*(\[[\s\S]*?\]);',text)
            # Parse a literal array only; never execute provider JavaScript.
            records=ast.literal_eval(match[1])
            if not isinstance(records,list) or not records:raise ValueError('Empty county source; last-known-good retained')
            validated=county_records(records)
            if not validated:raise ValueError('No valid county views; last-known-good retained')
            write_json(county_file,records)
        local=county_records(json.loads(county_file.read_text()));cameras.extend(local)
        reconciliation['santaClaraCounty']={'source':COUNTY_DATA,'locations':len(json.loads(county_file.read_text())),'listedViews':len(local),'media':'Official viewer only; third-party gateway credentials are not reused. Zero/unavailable placeholders omitted.','officialUrl':COUNTY_VIEWER}
    except Exception as e:
        county_error=str(e);reconciliation['santaClaraCounty']={'error':county_error}
        if county_file.exists():cameras.extend(county_records(json.loads(county_file.read_text())))
    # Restore dated audit records when rebuilding metadata without a media audit.
    audit_path=out/'source-audit.json';old_audit=json.loads(audit_path.read_text()) if audit_path.exists() else {};endpoints={}
    for e in old_audit.get('endpoints',[]):endpoints[endpoint_key(e['url'])]=e
    audit_start=now()
    if args.audit:
        tasks=set()
        for c in cameras:
            if c.get('imageUrl'):tasks.add(('image',endpoint_key(c['imageUrl'])))
            if c.get('videoUrl'):tasks.add(('video',endpoint_key(c['videoUrl'])))
        tasks=sorted(tasks)
        if args.audit_sample_per_district:
            selected=set()
            for district in sorted({c['district'] for c in cameras if c['district']}):
                group=[c for c in cameras if c['district']==district]
                for kind,field in [('image','imageUrl'),('video','videoUrl')]:
                    choices=sorted({endpoint_key(c[field]) for c in group if c.get(field)})
                    n=min(args.audit_sample_per_district,len(choices))
                    for index in range(n):
                        selected.add((kind,choices[round(index*(len(choices)-1)/max(1,n-1))]))
            tasks=sorted(selected)
        if args.audit_limit:tasks=tasks[:args.audit_limit]
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for index,(key,result) in enumerate(pool.map(audit_endpoint,tasks),1):
                endpoints[key]=result
                if index%100==0:
                    print(f'Audited {index}/{len(tasks)} endpoints',flush=True)
                    write_json(out/'audit-progress.json',{'startedAt':audit_start,'checkedAt':now(),'done':index,'total':len(tasks),'endpoints':list(endpoints.values())})
    audit_rows=[]
    for c in cameras:
        image=endpoints.get(endpoint_key(c['imageUrl'])) if c.get('imageUrl') else None
        video=endpoints.get(endpoint_key(c['videoUrl'])) if c.get('videoUrl') else None
        for e in c.pop('supplementAudit',[]):
            endpoints[endpoint_key(e['url'])]=e
            if e['kind']=='image':image=e
            else:video=e
        c['imageStatus']=image['status'] if image else c['imageStatus'];c['videoStatus']=video['status'] if video else c['videoStatus']
        checks=[e['checkedAt'] for e in [image,video] if e];c['checkedAt']=max(checks) if checks else None
        c['disabled']=c['sourceDisabled'] and not any(e and e['status']=='available' for e in [image,video])
        if image:c['sourceImageStatus']=image['status']
        if video:c['sourceVideoStatus']=video['status']
        audit_rows.append({'id':c['id'],'checkedAt':c['checkedAt'],'sourceImageStatus':c['imageStatus'],'sourceVideoStatus':c['videoStatus'],'image':image,'video':video})
    if len({c['id'] for c in cameras})!=len(cameras):raise ValueError('Duplicate normalized view IDs')
    cameras.sort(key=lambda c:(c['metro'],c['road'],c['name'],c['id']))
    count=lambda key:dict(collections.Counter(c[key] for c in cameras))
    stats={'viewCount':len(cameras),'sourceLocationCount':len({c['siteId'] for c in cameras}),'physicalDeviceCount':None,'coordinateCount':sum(c['hasValidCoordinates'] for c in cameras),'snapshotCount':sum(bool(c['imageUrl']) for c in cameras),'videoCount':sum(bool(c['videoUrl']) for c in cameras),'officialOnlyCount':sum(not c['imageUrl'] and not c['videoUrl'] for c in cameras),'districtCounts':dict(collections.Counter(c['district'] for c in cameras if c['district'])),'providerCounts':count('provider'),'imageAvailability':count('imageStatus'),'videoAvailability':count('videoStatus'),'serviceStatus':dict(collections.Counter(str(c['inService']) for c in cameras))}
    all_endpoints={(kind,endpoint_key(c[field])) for c in cameras for kind,field in [('image','imageUrl'),('video','videoUrl')] if c.get(field)}
    endpoints={key:value for key,value in endpoints.items() if (value['kind'],key) in all_endpoints}
    coverage={'scope':'Dated partial endpoint sample' if len(endpoints)<len(all_endpoints) else 'Dated all-listed-endpoint check','listedUniqueEndpoints':len(all_endpoints),'checkedUniqueEndpoints':len(endpoints),'uncheckedUniqueEndpoints':len(all_endpoints)-len(endpoints),'method':'Retained completed endpoint checks plus stratified district/media samples and all GIS supplement candidates; no continuous streaming.' if args.audit_sample_per_district else 'Bounded endpoint checks; see per-endpoint dates and methods.','imageChecks':sum(e['kind']=='image' for e in endpoints.values()),'videoManifestChecks':sum(e['kind']=='video' for e in endpoints.values()),'samplePerDistrictMedia':args.audit_sample_per_district or None}
    fetched=now();catalog={'version':1,'auditCoverage':coverage,'fetchedAt':fetched,'source':'Caltrans CWWP2 and official Santa Clara County local-road viewer','sourceUrl':PAGE,'sources':sources,'auditCompletedAt':now() if args.audit else old_audit.get('completedAt'),'stats':stats,'reconciliation':reconciliation,'cameraLocationMethod':'Provider source groups; Caltrans district-local index base before a documented -number view suffix, Santa Clara County intersection IDs. These are not independently verified physical devices.','regionMethod':'Editorial county groups with explicit coordinate splits in large counties; nearbyPlace is a provider nearby-place label, not a municipal boundary.','cameras':cameras}
    write_json(out/'camera-catalog.json',catalog)
    write_json(audit_path,{'startedAt':audit_start if args.audit else old_audit.get('startedAt'),'completedAt':now() if args.audit else old_audit.get('completedAt'),'method':'One full image structure check or one HLS manifest request per unique HTTPS endpoint, concurrency <=4, no continuous stream. Browser decode verified separately. HTTP Last-Modified is not a verified capture timestamp.','stats':stats,'coverage':coverage,'cameras':audit_rows,'endpoints':sorted(endpoints.values(),key=lambda e:(e['kind'],e['url']))})
    (out/'audit-progress.json').unlink(missing_ok=True)
    print(json.dumps(stats,indent=2),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'dist')
    parser.add_argument('--from-cache',action='store_true',help='Reuse saved official catalogs; GIS candidates are still checked before inclusion')
    parser.add_argument('--audit',action='store_true',help='Make one bounded check for every unique media endpoint')
    parser.add_argument('--audit-limit',type=int,help='For an explicitly partial diagnostic audit only')
    parser.add_argument('--audit-sample-per-district',type=int,help='Explicit partial audit: this many image and HLS URLs per reporting district')
    parser.add_argument('--workers',type=int,default=4,choices=range(1,5))
    build(parser.parse_args())
