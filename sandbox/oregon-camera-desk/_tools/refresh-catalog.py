#!/usr/bin/env python3
"""Normalize published ODOT TripCheck views; optionally audit their public still images.

No API key, guessed camera IDs, media relay, or video credentials are used. Source
inventory and report URLs are the files linked by TripCheck's current public UI.
Writes happen only after validation. Images used for audit stay in the private
local cache, never in dist. Python standard library; Pillow improves decode QA.
"""
from __future__ import annotations
import argparse
import collections
import concurrent.futures
import datetime as dt
import email.utils
import gzip
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MAP_URL = 'https://www.tripcheck.com/Scripts/map/data/cctvinventory.js'
REPORT_URL = 'https://www.tripcheck.com/DynamicReports/Report/Cameras'
BOUNDARY_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1'
BOUNDARY_QUERY = BOUNDARY_URL + '/query?' + urllib.parse.urlencode({'where': "STATE IN ('41','53','06','16','32')", 'outFields': 'NAME,STATE,COUNTY', 'outSR': 4326, 'returnGeometry': 'true', 'geometryPrecision': 6, 'maxAllowableOffset': 0.00005, 'f': 'geojson'})
SOURCE_PAGE = 'https://www.tripcheck.com/'
STATE_CODES = {'41': 'OR', '53': 'WA', '06': 'CA', '16': 'ID', '32': 'NV'}
# Add only image hashes visually confirmed to be a provider offline notice.
KNOWN_PLACEHOLDERS = {'e17410b8c38e16b58041f7815780c6af83932a7ae542b91617666e8cc5c209f1': 'Visually verified ODOT/partner unavailable image', '074c85fbfc1e66c6dcb57ea2f45c90813d01818ca3f30f8065f9ebba8ff6ebe7': 'Visually verified ODOT/partner unavailable image', '7fec422751fe6d508404519cfbc2f876b457264086e1b539941744ebab3943a3': 'Visually verified ODOT/partner unavailable image', '6d7ad237bc639994a14527716627ba66eb7238b8ea0cf57bafa2162ac2134077': 'Visually verified ODOT/partner unavailable image', '0008117a0a5606706fbff1bc9ba5353e81f43dae9e6bfdbe2b2aedbdbc425ee0': 'Visually verified ODOT/partner unavailable image', '7b875dd60be50dfa564fd73e91548da539607a9a5a07fa5b80aed88c137f945a': 'Visually verified ODOT/partner unavailable image', 'c57316076e21aeedabda0d12f890e0824c628fb10d45d7af805d5dd4827aab3d': 'Visually verified ODOT/partner unavailable image', '8c9549fed1c62e99ed9ffefbe2f94c52cc7f3c727d92f8e96988c32d769fef90': 'Visually verified ODOT/partner unavailable image', 'aed56821fc94d01fc15d001cda29eb009c9113fe52e5aefbe17ededab0e264a9': 'Visually verified ODOT/partner unavailable image', '0b56a1d0fb34b5fd02c3809ef3736c41bf964b5af42b89102a2db9f0652d68ef': 'Visually verified ODOT/partner unavailable image', 'd5a314e815ea860a105b0b0f18b394e48edf0992abf7ea422b828b2f4a276b6d': 'Visually verified ODOT/partner unavailable image', '13d4e4cdbc8b6b32cf8c13ddeab61bed23a3f97368c97fa62de19ee18e1c6244': 'Visually verified ODOT/partner unavailable image', 'b3d18c20c11297a38ccf35eecceed01341596b1c58e16ee564a4734ef87b5d7b': 'Visually verified ODOT/partner unavailable image', '520629d6b6c0fd092c028eee25e7474172d727405a900ce5b7761c359e8d6642': 'Visually verified ODOT/partner unavailable image', '3deb87dc1851d7454892c501f74994f5200534389b08c5b97ff29b6875b871c2': 'Visually verified ODOT/partner unavailable image', '247e0b7e5499b5980dcb1fbf368361f341db47b1fd5f4bf27bc0dbbdc003bf32': 'Visually verified ODOT/partner unavailable image', 'd9e60713368b0590f57af7afa22d08b2212cd318840227a15b9252e72ded25ef': 'Visually verified ODOT/partner unavailable image', 'f2503aab05e0a425a28feeadc313391fa8e9a0281d3a608a9b5b3f68216e0bf4': 'Visually verified ODOT/partner unavailable image', '89298bdbf21c5e6f3446f202dadddb0548ce9471bec3b207c5a49f4992fad8d9': 'Visually verified ODOT/partner unavailable image', 'db693ad5d5cd2c00b9d7a33e96daa20ad02a7378aef03c5dcb8d3e87fc042ec4': 'Visually verified ODOT/partner unavailable image', 'e25ea488860134d16ca21c40bec38a4dc0d8dfbe90cc1478e2ccc8045dda0225': 'Visually verified ODOT/partner unavailable image', 'fe775be323d717356da8edb8f8666bf6a6b58bbc803a227965650bbc9b29faa1': 'Visually verified ODOT/partner unavailable image', 'c9f5ff8e46d3522287b8bb4fc5baeef9d1c68e28212b2d187deabfdc75642fd5': 'Visually verified ODOT/partner unavailable image', '5c3d6e1625f48b9394b8d244314607bfa5f986cf1af0eb8836aeb1590c942ff7': 'Visually verified ODOT/partner unavailable image', '57d79543ea4e69fc484e2db7000bd0ac108dc84c68130128c02ab7384f8755fa': 'Visually verified ODOT/partner unavailable image', '7d82ae9da71979dd4749247e7f5953655538a204c5e0a7e777d931fcd95c6cb2': 'Visually verified ODOT/partner unavailable image', '9edd4df360672f2149030bbce8eb503dad94e5172eb1249e138a012556c4055b': 'Visually verified ODOT/partner unavailable image', '99367882b73e27645e01ee823b5c2aa69b83dba1a0ea81d4861dac4e21a4d139': 'Visually verified ODOT/partner unavailable image', 'c6cf767a09888e1e0348211c1dca17baf715b3059fd136886a82fc8a06ce2fe6': 'Visually verified ODOT/partner unavailable image', 'd3699f8f57e2bfdbd41132b3df6900d33f1727c20185b79405118ff16349672a': 'Visually verified ODOT/partner unavailable image', 'd5a02be189a76524e320642c10f268604313903411fc3bdf0b338ebd822827ea': 'Visually verified ODOT/partner unavailable image', '32b5d19eef22b9a6681bed1e67cbb50e55dfef1a36fe12254cfa60c209fdbc4f': 'Visually verified ODOT/partner unavailable image', 'eb8c76d1078fc206bc540b80044cb426f6a5fc5c32a76ebed7fd2053cba6a9e6': 'Visually verified ODOT/partner unavailable image', 'c6caa4b53a10860f3f2bf1a38cbb1e2b26c5f64689af2413fbb805ff01e1f47d': 'Visually verified ODOT/partner unavailable image', '481899e1c8da7bcb8fdd3ebdbfbf416bd0647b24b7cb7fda071e70422d52456e': 'Visually verified ODOT/partner unavailable image', '1b22fa7d8b25fc1bef22993678407075f1d00b906d9b48971c4e0f99b509ebed': 'Visually verified ODOT/partner unavailable image', '28de892ae4bb8b7da6dfb34a786025a20dcce0a2d9d2ac0daab396dc32546ba2': 'Visually verified ODOT/partner unavailable image', '0583d1917829f80f024c9f3213e874e65bb3864224efbc511976522eaf0c1f95': 'Visually verified ODOT/partner unavailable image', '4d17684dd3de026ceda24f1ec56ccb3169d3fdeee39782d5418db3506d8df9dd': 'Visually verified ODOT/partner unavailable image', '9b4936fee0246a2efa15009f8301d74203f66dd9e402b975d0f5d6a48ee055f3': 'Visually verified ODOT/partner unavailable image', '90992dcdac4caa320d3a8a7f85b5cadbe068072783712f73e13cf93cb9271243': 'Visually verified ODOT/partner unavailable image', '7e42f375a250bd51bfb7d66ecb00d09eb904a58bae12f54c07dc5379855f05bb': 'Visually verified ODOT/partner unavailable image', '1aae4057699f2dada82da20764bb7190a025f6d9258d7cef1cc99a34070f8eac': 'Visually verified ODOT/partner unavailable image', 'b9c1e20998e6c57d7e72b500fbd55a51b2398b79be21443ee993c1a5c6b54de1': 'Visually verified ODOT/partner unavailable image', 'c69366fcc43ce08a7dc984009fb91573f134a9e9b908c0c51985436817919921': 'Visually verified ODOT/partner unavailable image', 'cc67413917e718ae2d8f9b2dd3b7967a552d5bd5db7ac164ff9b6d3ea4225b57': 'Visually verified ODOT/partner unavailable image', '9206dcffbbf653802b1424b81eeef061beba691c7b12d45b6f65c1ac12ccd0db': 'Visually verified ODOT/partner unavailable image', '2fbe9fc0e3d0148217adef811a4dd2eca734121fef7e76dfd5085db17261c66a': 'Visually verified ODOT/partner unavailable image', '69e7ca69b9daf474ffa628acaff6bcf70b9a4b4f7272d0b725d0a462a18fbeb3': 'Visually verified ODOT/partner unavailable image', '1acf6f24c9cf659c35d44f039fbb75964f0565a1fc903f9e96e50813854bf8d4': 'Visually verified ODOT/partner unavailable image', '35e927ec853ebf9b7021c2fd592e647a3d805e9fec59b5d744408f4c69a1f0d4': 'Visually verified ODOT/partner unavailable image', '6c069de67ee277d0f0b38b55caa8652ac9cb5739a1733466cff4e6b63ee9a4e2': 'Visually verified ODOT/partner unavailable image', '0661a71e4782484669ed0ad8c17154db96d4ca0c8599b632e538c3b27440f2bc': 'Visually verified ODOT/partner unavailable image', 'b03a90532ec8b66ea0307149c549b703770e0c12c6ff19e1fec656d87e9adc59': 'Visually verified ODOT/partner unavailable image', '2070d1025a6c4cd955ac45e1a4ba1fd779b0c0a96c6d5a27f8b6c27ce9f48ae1': 'Visually verified ODOT/partner unavailable image', '1951d6191c609fa69e5abe658eb4f7ea5972270f9bd28923f371723ed7df13f5': 'Visually verified ODOT/partner unavailable image', 'a641dca30eab82fbc5206a34b286f5d2631a28302357571aaf8dfee0a66001bd': 'Visually verified ODOT/partner unavailable image', 'bb9c6cfbca08406f017fca3e93e85f320222231b980dab80f2adc2d5369b229a': 'Visually verified ODOT/partner unavailable image'}
# RGB central crop x25..75%, y25..70%, with dimensions; exact pixels only.
# Seed full hashes identify visually inspected provider notices.
KNOWN_PLACEHOLDER_CROPS = {'328x314:cb5d3d8500c11bde20865e10a7926e90cef748d1cc42e5812e87e74126581ef7': '2070d1025a6c4cd955ac45e1a4ba1fd779b0c0a96c6d5a27f8b6c27ce9f48ae1', '328x334:feac86b3ff6c27ab64bd9e5d5bf789b4154375336dbb9be7cb541e2ec57093e8': 'b03a90532ec8b66ea0307149c549b703770e0c12c6ff19e1fec656d87e9adc59', '328x334:e3d232cec017ca551f4d3a7b3b224404ad47ef7f7a02a68017ffd8229f5d9920': '90992dcdac4caa320d3a8a7f85b5cadbe068072783712f73e13cf93cb9271243', '328x295:60f67b32775b3fdc976bce9783a3b7df80429057b455c73a95065696ec505922': '0661a71e4782484669ed0ad8c17154db96d4ca0c8599b632e538c3b27440f2bc', '328x334:5e529705026b4f14f626e2d86d21f0379ec32025101a5a425ed50fdddd1ec1e9': 'b9c1e20998e6c57d7e72b500fbd55a51b2398b79be21443ee993c1a5c6b54de1', '328x334:e171d00be3920d269b0252a652b727e4c68dc6eced55c57638bb6e35c823012b': '1951d6191c609fa69e5abe658eb4f7ea5972270f9bd28923f371723ed7df13f5', '328x366:c003fdebd06da2d18297994ea19f64da6a2004d5231dcb60ed66d3031953d5f7': 'bb9c6cfbca08406f017fca3e93e85f320222231b980dab80f2adc2d5369b229a'}
LIMIT = 12_000_000
PAUSE_LOCK = threading.Lock()
PAUSE_UNTIL = 0.0
THROTTLED = threading.Event()
AREA_BY_COUNTY = {
 'Multnomah':'Portland area','Washington':'Portland area','Clackamas':'Portland & Mount Hood',
 'Marion':'Salem & central Willamette Valley','Polk':'Salem & central Willamette Valley',
 'Yamhill':'Yamhill Valley','Linn':'Albany & Santiam corridor','Benton':'Corvallis & Albany',
 'Lane':'Eugene, Springfield & west Cascades','Deschutes':'Bend & Redmond','Crook':'Prineville & Ochoco country',
 'Jefferson':'Madras & Warm Springs','Jackson':'Medford, Ashland & Siskiyous','Josephine':'Grants Pass & Illinois Valley',
 'Douglas':'Roseburg & Umpqua Valley','Klamath':'Klamath Falls & southern Cascades','Lake':'Lakeview & Lake County',
 'Clatsop':'North coast & Astoria','Tillamook':'Tillamook & north coast','Lincoln':'Newport & central coast',
 'Coos':'Coos Bay & south coast','Curry':'Brookings, Gold Beach & south coast','Columbia':'Lower Columbia River',
 'Hood River':'Columbia Gorge','Wasco':'The Dalles & Wasco County','Sherman':'Sherman & Columbia Plateau',
 'Gilliam':'Gilliam & Columbia Plateau','Morrow':'Boardman & Morrow County','Umatilla':'Pendleton, Hermiston & Blue Mountains',
 'Union':'La Grande & Blue Mountains','Baker':'Baker City & eastern mountains','Wallowa':'Wallowa country',
 'Grant':'John Day & Grant County','Wheeler':'Fossil & Wheeler County','Harney':'Burns & Harney County',
 'Malheur':'Ontario & southeast Oregon',
}


def now(): return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
def digest(body): return hashlib.sha256(body).hexdigest()
def safe_image_url(path):
    url = urllib.parse.urljoin(SOURCE_PAGE,path)
    p = urllib.parse.urlsplit(url)
    if p.scheme != 'https' or p.hostname != 'www.tripcheck.com' or p.username or p.password or not p.path.lower().startswith('/roadcams/cams/'):
        raise ValueError('Unapproved image URL in published inventory')
    return urllib.parse.urlunsplit((p.scheme,p.netloc,urllib.parse.quote(urllib.parse.unquote(p.path),safe='/'),'', ''))
def url_identity(url):
    p=urllib.parse.urlsplit(url)
    return p.hostname.lower() + urllib.parse.unquote(p.path).lower()

def fetch(url, maximum=LIMIT, retry=True):
    global PAUSE_UNTIL
    for attempt in range(3 if retry else 1):
        with PAUSE_LOCK: wait=max(0,PAUSE_UNTIL-time.monotonic())
        if wait: time.sleep(wait)
        req=urllib.request.Request(url, headers={'User-Agent':'OregonCameraDesk/1.0 (public inventory and bounded availability audit)', 'Accept-Encoding':'gzip'})
        try:
            with urllib.request.urlopen(req,timeout=18) as r:
                body=r.read(maximum+1)
                if len(body)>maximum: raise ValueError('Response exceeds size limit')
                if body[:2]==b'\x1f\x8b':
                    body=gzip.decompress(body)
                    if len(body)>maximum: raise ValueError('Decompressed response exceeds size limit')
                return r.status,{k.lower():v for k,v in r.headers.items()},body
        except urllib.error.HTTPError as e:
            if e.code==429:
                if not retry or attempt==2:
                    THROTTLED.set()
                    raise
                try: delay=min(30,max(2,float(e.headers.get('Retry-After','5'))))
                except ValueError: delay=5
                with PAUSE_LOCK: PAUSE_UNTIL=max(PAUSE_UNTIL,time.monotonic()+delay)
            elif e.code in (502,503,504) and retry and attempt<2: time.sleep(1+attempt)
            else: raise
    raise RuntimeError('Fetch retries exhausted')

class ReportParser(HTMLParser):
    def __init__(self):
        super().__init__();self.rows=[];self.region='';self.in_region=False
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='span' and a.get('class')=='title-region': self.in_region=True
        if tag=='a' and a.get('data-image-path'):
            m=re.search(r'_pid(\d+)\.',a['data-image-path'],re.I)
            if not m: raise ValueError('Report image lacks published view identifier')
            self.rows.append({'id':m[1],'name':a.get('data-alt-text','').strip(),'path':a['data-image-path'],'daylightPath':a.get('data-ldi-path'),'region':re.sub(r'\s+',' ',self.region).split(' Oregon')[0]})
    def handle_endtag(self,tag):
        if tag=='span': self.in_region=False
    def handle_data(self,data):
        if self.in_region: self.region=data.strip()

def in_ring(x,y,ring):
    inside=False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        x1,y1=a[:2];x2,y2=b[:2]
        if (y1>y)!=(y2>y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1: inside=not inside
    return inside

def prepare_boundaries(data):
    features=data.get('features',[])
    if len(features)!=194 or data.get('exceededTransferLimit'): raise ValueError('Expected complete five-state county inventory (194 counties)')
    if sum(f['properties']['STATE']=='41' for f in features)!=36: raise ValueError('Expected all 36 Oregon counties')
    polygons=[]
    for f in features:
        p=f['properties'];g=f['geometry'];parts=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
        for rings in parts:
            xy=rings[0];xs=[v[0] for v in xy];ys=[v[1] for v in xy]
            polygons.append((STATE_CODES[p['STATE']],p['NAME'].removesuffix(' County'),p['STATE']+p['COUNTY'],(min(xs),min(ys),max(xs),max(ys)),rings))
    return polygons

def geography(lat,lon,polygons):
    if lat is None or lon is None:return '','',''
    found=set()
    for state,county,fips,b,rings in polygons:
        if b[0]<=lon<=b[2] and b[1]<=lat<=b[3] and in_ring(lon,lat,rings[0]) and not any(in_ring(lon,lat,r) for r in rings[1:]):found.add((state,county,fips))
    return found.pop() if len(found)==1 else ('','','')

def road_name(value):
    s=re.sub(r'\s+',' ',str(value or '').strip()).upper()
    m=re.fullmatch(r'(I|US|OR|ORE|SR)[ -]*(\d+[A-Z]*)',s)
    if m:return ('OR' if m[1]=='ORE' else m[1])+'-'+m[2]
    if s=='HWY82':return 'OR-82'
    return 'Local roads' if s in {'CITY','CNTY'} else s or 'Other roads'

def viewing_direction(title,filename):
    # Street quadrants such as NW Arizona or SW Alder are place names. Prefer
    # explicit bound/view tokens, including those in the published filename.
    texts=[str(title or '').replace('_',' '),str(filename or '').replace('_',' ')]
    explicit=re.search(r'\b(NB|SB|EB|WB)\b',' '.join(texts),re.I)
    if explicit:return explicit[1].upper()
    for text in texts:
        facing=re.search(r'\b(?:look(?:ing)?|view(?:ing)?|facing)[ :\-]+(NW|NE|SW|SE)\b',text,re.I)
        if facing:return facing[1].upper()
    for text in texts:
        # Strip only the known published-image suffix and file extension before
        # checking a terminal view token (e.g. Ion Summit NW_pid4261.jpg).
        stem=re.sub(r'\.(?:jpe?g|png)$','',text,flags=re.I)
        stem=re.sub(r'\s+pid\d+$','',stem,flags=re.I)
        terminal=re.search(r'\b(NW|NE|SW|SE)$',stem.strip(),re.I)
        if terminal:return terminal[1].upper()
    return ''

def has_widespread_audit_failure(results):
    if not results:return False
    failures=sum(r.get('httpStatus') is None or r.get('httpStatus') in (429,500,502,503,504) or r.get('sourceImageStatus')=='unchecked' for r in results)
    return failures>=len(results)*.9

def load_source(url,filename,cache,args):
    path=cache/filename
    if args.reuse_sources and path.exists():return path.read_bytes()
    body=fetch(url)[2];path.write_bytes(body);return body

def normalize(args,cache):
    mapbody=load_source(MAP_URL,'inventory.json',cache,args)
    reportbody=load_source(REPORT_URL,'report.html',cache,args)
    boundarybody=load_source(BOUNDARY_QUERY,'boundaries.geojson',cache,args)
    inventory=json.loads(mapbody);features=inventory['features']
    if not 700<len(features)<5000:raise ValueError('Unexpected camera count; keeping existing catalog')
    parser=ReportParser();parser.feed(reportbody.decode('utf-8-sig'));byid=collections.defaultdict(list)
    for row in parser.rows:byid[row['id']].append(row)
    polygons=prepare_boundaries(json.loads(boundarybody));cameras=[];seen=set();filename_mismatch=[]
    for f in features:
        a=f['attributes'];pid=str(a['publishedImageId']);cid=int(a['cameraId'])
        if pid in seen:raise ValueError('Duplicate published image ID; review schema before replacing catalog')
        seen.add(pid);rows=byid.get(pid,[])
        mapurl=safe_image_url('/RoadCams/cams/'+a['filename'])
        image=safe_image_url(rows[0]['path']) if rows else mapurl
        if image.lower()!=mapurl.lower():filename_mismatch.append(pid)
        lat,lon=a.get('latitude'),a.get('longitude')
        valid=all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in (lat,lon)) and 40<=lat<=49 and -126<=lon<=-114
        source_coordinates={'lat':lat,'lon':lon}
        lat,lon=(round(lat,6),round(lon,6)) if valid else (None,None)
        physical,county,fips=geography(lat,lon,polygons)
        regions=list(dict.fromkeys(r['region'] for r in rows if r['region']))
        name=(rows[0]['name'] if rows else a['title']).strip();original_name=a['title'].strip()
        route=road_name(a['route'])
        aliases=list(dict.fromkeys([original_name]+[r['name'] for r in rows]+[a['filename']]))
        direction=viewing_direction(original_name,a['filename'])
        mp=re.search(r'\bMP\s*(\d+(?:\.\d+)?)',' '.join([original_name,a['filename']]).replace('_',' '),re.I)
        milepoint=float(mp[1]) if mp else None
        if physical and physical!='OR': metro={'WA':'Washington border cameras','CA':'Northern California connections','ID':'Idaho border connections','NV':'Nevada border connections'}.get(physical,'Border cameras')
        else:metro=AREA_BY_COUNTY.get(county,('Location unverified' if not valid else 'Oregon border / county unconfirmed'))
        region=regions[0] if regions else ('Border connections' if physical and physical!='OR' else 'Unassigned')
        daylight=safe_image_url(rows[0]['daylightPath']) if rows and rows[0].get('daylightPath') else None
        passes=[label for pattern,label in [(r'Government Camp|Govt Camp','Government Camp'),(r'Santiam Pass','Santiam Pass'),(r'Willamette Pass','Willamette Pass'),(r'Siskiyou (?:Summit|Pass)','Siskiyou Summit'),(r'Meacham|Deadman Pass|Cabbage Hill','Blue Mountains')] if re.search(pattern,name,re.I)]
        cameras.append({'id':pid,'siteId':f'tripcheck-camera-{cid}','viewId':pid,'cameraId':cid,'publishedImageId':int(pid),'name':name,'originalName':original_name,'location':name,'aliases':aliases,
          'road':route,'roads':[route],'originalRoad':a['route'].strip(),'lat':lat,'lon':lon,'sourceCoordinates':source_coordinates,'hasValidCoordinates':valid,
          'coordinateSource':MAP_URL,'county':county,'countyFips':fips,'city':'','metro':metro,'region':region,'regions':regions,'district':'',
          'provider':'ODOT TripCheck','owner':'','providerJurisdiction':'OR','physicalState':physical,'physicalStateSource':'Census TIGERweb 2026 county point-in-polygon' if physical else 'Unresolved',
          'geographicGroupingNote':'Browsing areas are editorial county groups, not official metropolitan boundaries.','direction':direction,'viewingDirection':direction,'trafficDirection':None,'milepoint':milepoint,'elevation':None,'passes':passes,
          'imageUrl':image,'alternateImageUrls':([] if image.lower()==mapurl.lower() else [mapurl]),'videoUrl':None,'streamUrl':None,'embedMode':'image','disabled':False,'imageStatus':'unchecked',
          'officialUrl':SOURCE_PAGE,'sourceUrl':SOURCE_PAGE,'officialLinkKind':'map','sourceStatus':'Listed by TripCheck','videoAvailableOnOfficial':bool(a.get('videoId')),'officialVideoKind':'Session-limited rapidly refreshed images' if a.get('videoId') else None,
          'officialSessionSeconds':60 if a.get('videoId') else None,'officialImageRefreshSeconds':2 if a.get('videoId') else None,'officialVideoId':a.get('videoId') or None,
          'daylightUrl':daylight,'daylightNote':'Last-daylight image is historical; availability is provider-controlled. This URL is listed in the official report, not a current capture guarantee.' if daylight else None,
          'refreshSeconds':300,'captureAt':None,'sourceCaptureAt':None,'statusReason':'Not checked in this inventory refresh','catalogOrigin':'map+report' if rows else 'map-only',
          'category':'Local roads' if route=='Local roads' else 'Highway'})
    if set(byid)-seen:raise ValueError('New report-only views lack schema reconciliation; keeping existing catalog')
    cameras.sort(key=lambda c:(c['physicalState']!='OR',c['metro'],c['road'],c['name'],int(c['id'])))
    reconciliation={'mapViewCount':len(features),'mapLocationCount':len({f['attributes']['cameraId'] for f in features}),'reportAppearanceCount':len(parser.rows),'reportUniqueViewCount':len(byid),'repeatedReportAppearances':len(parser.rows)-len(byid),'mapOnlyViewIds':sorted(seen-set(byid),key=int),'reportOnlyViewIds':sorted(set(byid)-seen,key=int),'filenameDifferences':filename_mismatch,'filenamePreference':'Use report-published URL where present; keep map-published URL as bounded audit fallback. Neither URL is guessed.',
      'invalidCoordinateViewIds':[c['id'] for c in cameras if not c['hasValidCoordinates']],'unresolvedCountyViewIds':[c['id'] for c in cameras if not c['county']],
      'sourceHashes':{'mapSha256':digest(mapbody),'reportSha256':digest(reportbody),'countyBoundariesSha256':digest(boundarybody)},'boundarySource':BOUNDARY_URL,'boundaryVintage':'January 1, 2026','boundaryMethod':'Point-in-polygon against five-state Census county inventory in EPSG:4326, 0.00005-degree generalization; ambiguous and invalid locations stay unresolved.'}
    return cameras,reconciliation

def dimensions(body):
    if body.startswith(b'\x89PNG\r\n\x1a\n') and len(body)>24:return 'png',*struct.unpack('>II',body[16:24])
    if not body.startswith(b'\xff\xd8') or not body.rstrip().endswith(b'\xff\xd9'):raise ValueError('Not a complete JPEG/PNG')
    at=2
    while at+4<=len(body):
        if body[at]!=255:raise ValueError('Invalid JPEG marker')
        while at<len(body) and body[at]==255:at+=1
        marker=body[at];at+=1
        if marker in (216,217) or 208<=marker<=215:continue
        size=struct.unpack('>H',body[at:at+2])[0]
        if size<2 or at+size>len(body):raise ValueError('Truncated JPEG')
        if marker in (192,193,194,195,197,198,199,201,202,203,205,206,207):
            h,w=struct.unpack('>HH',body[at+3:at+7]);return 'jpeg',w,h
        at+=size
    raise ValueError('Missing JPEG dimensions')

def classify_body(body):
    sha=digest(body);signature=None;decoded=False
    try:
        from PIL import Image
        import io
        with Image.open(io.BytesIO(body)) as im:
            im.load();decoded=True;rgb=im.convert('RGB');w,h=im.size
            crop=rgb.crop((int(w*.25),int(h*.25),int(w*.75),int(h*.70)))
            signature=f'{w}x{h}:'+digest(crop.tobytes())
    except ImportError:pass
    return sha,signature,decoded,sha in KNOWN_PLACEHOLDERS or signature in KNOWN_PLACEHOLDER_CROPS

def audit_one(camera,cache):
    result={'id':camera['id'],'checkedAt':now(),'httpStatus':None,'sourceImageStatus':'unchecked','captureTimeKnown':False}
    if THROTTLED.is_set():result['error']='Audit paused after persistent rate limiting';return result
    candidates=[camera['imageUrl']]+camera.get('alternateImageUrls',[])
    errors=[]
    for url in candidates:
        try:
            status,headers,body=fetch(url,maximum=3_000_000)
            result.update({'httpStatus':status,'contentType':headers.get('content-type',''),'bytes':len(body),'cors':headers.get('access-control-allow-origin'),'lastModified':headers.get('last-modified'),'url':url})
            if not result['contentType'].startswith(('image/jpeg','image/png','image/jpg')):raise ValueError('Response is not a supported image')
            fmt,w,h=dimensions(body)
            if not (16<w<10000 and 16<h<10000):raise ValueError('Invalid image size')
            sha,signature,decoded,placeholder=classify_body(body)
            result.update({'width':w,'height':h,'sha256':sha,'isPlaceholder':placeholder,'decoded':decoded,'placeholderSignature':signature if placeholder else None})
            (cache/'images'/f'{sha}.{fmt}').write_bytes(body)
            if placeholder:result.update({'sourceImageStatus':'unavailable','error':'Visually verified provider unavailable notice (exact full-image or central-template fingerprint)'})
            else:result.update({'sourceImageStatus':'available','evidence':'Complete decoded image; no visually verified offline-placeholder hash matched' if decoded else 'Complete image signature/dimensions; no visually verified offline-placeholder hash matched'})
            if url!=camera['imageUrl']:result['fallbackUsed']=True
            return result
        except urllib.error.HTTPError as e:
            result['httpStatus']=e.code;errors.append(f'HTTP {e.code}')
            if e.code==429:result['error']='Rate limited; audit paused';return result
        except urllib.error.URLError as e:
            if 'CERTIFICATE_VERIFY_FAILED' in str(e):
                result.update({'sourceImageStatus':'unchecked','error':'Local TLS trust store failed; audit environment must be repaired'})
                return result
            errors.append(str(e)[:180])
        except Exception as e:errors.append(str(e)[:180])
    result.update({'sourceImageStatus':'unavailable','error':'; '.join(errors)})
    return result

def atomic_json(path,data):
    temporary=path.with_suffix(path.suffix+'.tmp');temporary.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n');temporary.replace(path)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,default=ROOT/'dist')
    p.add_argument('--cache-dir',type=Path,default=ROOT/'.cache')
    p.add_argument('--reuse-sources',action='store_true',help='Reuse locally cached inventory/report/boundaries; source retrieval date remains original')
    p.add_argument('--audit',action='store_true',help='Fetch every listed image, at most four in parallel')
    p.add_argument('--audit-only',action='store_true',help='Audit existing catalog without refreshing inventory')
    p.add_argument('--recheck-cache',action='store_true',help='Reclassify existing audit images against confirmed placeholder templates without fetching media')
    args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True);cache=args.cache_dir;cache.mkdir(parents=True,exist_ok=True);(cache/'images').mkdir(exist_ok=True)
    path=args.output/'camera-catalog.json';previous=json.loads(path.read_text()) if path.exists() else None
    if args.audit_only or args.recheck_cache:
        if not previous:raise ValueError('No existing catalog to audit')
        catalog=previous;cameras=catalog['cameras']
    else:
        cameras,reconciliation=normalize(args,cache)
        fetched=previous['fetchedAt'] if args.reuse_sources and previous else now()
        catalog={'version':1,'state':'OR','name':'Oregon Camera Desk','source':'ODOT TripCheck public camera inventory and camera report','sourceUrl':SOURCE_PAGE,'inventoryUrl':MAP_URL,'reportUrl':REPORT_URL,'fetchedAt':fetched,'inventoryRefreshSeconds':86400,'defaultRefreshSeconds':300,'cameras':cameras,'locationCount':len({c['siteId'] for c in cameras}),'viewCount':len(cameras),'reconciliation':reconciliation,
          'attribution':'Camera images courtesy of ODOT and TripCheck partner agencies. County classification: U.S. Census Bureau TIGERweb 2026.',
          'limitations':['An independent viewer, not an official ODOT service.','Counts are published views and source-reported locations, not independently verified physical devices.','Provider capture timestamps are not machine-readable in this public inventory; fetched times are not capture times.','Official rapid-image sessions are not embedded live video.','No API key is needed for the permitted public still-image integration; credentialed API feeds are separate.']}
        old={c['id']:c for c in (previous or {}).get('cameras',[])}
        for c in cameras:
            prior=old.get(c['id'])
            if prior and url_identity(prior['imageUrl'])==url_identity(c['imageUrl']):
                for key in ('imageStatus','checkedAt','statusReason','audit'):
                    if key in prior:c[key]=prior[key]
        if any(c.get('checkedAt') for c in cameras):
            catalog['auditCounts']=dict(collections.Counter(c['imageStatus'] for c in cameras))
            for key in ('auditStartedAt','auditCompletedAt'):
                if previous and previous.get(key):catalog[key]=previous[key]
            catalog['auditScope']='Historical individual-view checks retained only for unchanged image identities; new or changed image URLs remain unchecked until audited.'
    if args.recheck_cache:
        audit=json.loads((args.output/'source-audit.json').read_text())
        byid={r['id']:r for r in audit['checks']}
        for c in cameras:
            r=byid[c['id']]
            if not r.get('sha256'):continue
            files=list((cache/'images').glob(r['sha256']+'.*'))
            if len(files)!=1:raise ValueError('Missing cached audit image; cannot silently reclassify')
            sha,signature,decoded,placeholder=classify_body(files[0].read_bytes())
            if sha!=r['sha256']:raise ValueError('Cached image hash mismatch')
            r.update({'isPlaceholder':placeholder,'decoded':decoded,'placeholderSignature':signature if placeholder else None})
            if placeholder:r.update({'sourceImageStatus':'unavailable','error':'Visually verified provider unavailable notice (exact full-image or central-template fingerprint)'})
            c.update({'imageStatus':r['sourceImageStatus'],'statusReason':r.get('error') or r.get('evidence',''),'audit':r})
        audit.update({'reclassifiedAt':now(),'knownPlaceholderHashes':KNOWN_PLACEHOLDERS,'knownPlaceholderCrops':KNOWN_PLACEHOLDER_CROPS,'placeholderMethod':'Exact RGB pixel hash of central crop x25..75%, y25..70% plus image dimensions, or exact full-image SHA256. Seeds were visually confirmed provider unavailable notices. No brightness/entropy/unchanged-image rule is used.'})
        audit['counts']=dict(collections.Counter(r['sourceImageStatus'] for r in audit['checks']))
        catalog['auditCounts']=audit['counts'];atomic_json(args.output/'source-audit.json',audit)
    if args.audit or args.audit_only:
        audit_started=now();results=[]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for i,result in enumerate(pool.map(lambda c:audit_one(c,cache),cameras),1):
                results.append(result)
                if i%100==0:print(f'Audited {i}/{len(cameras)}',flush=True)
        if has_widespread_audit_failure(results):
            atomic_json(cache/'last-failed-audit.json',{'completedAt':now(),'checks':results})
            raise ValueError('Transport failure, provider outage, or rate limit across most checks; preserving last known-good catalog and audit')
        byid={r['id']:r for r in results}
        for c in cameras:
            r=byid[c['id']];c['imageStatus']=r['sourceImageStatus'];c['checkedAt']=r['checkedAt'];c['statusReason']=r.get('error') or r.get('evidence','');c['audit']=r
            if r.get('fallbackUsed'):c['imageUrl']=r['url']
        completed=now();counts=dict(collections.Counter(r['sourceImageStatus'] for r in results))
        duplicates=collections.defaultdict(list)
        for r in results:
            if r.get('sha256'):duplicates[r['sha256']].append(r['id'])
        audit={'startedAt':audit_started,'completedAt':completed,'count':len(results),'concurrency':4,'counts':counts,'throttled':THROTTLED.is_set(),'knownPlaceholderHashes':KNOWN_PLACEHOLDERS,'knownPlaceholderCrops':KNOWN_PLACEHOLDER_CROPS,
          'method':'Fetch only listed still URLs, HTTPS, bounded response size/time, at most four concurrent requests; decode/validate images and compare visually confirmed offline-placeholder hashes. Header Last-Modified and repeated hashes alone do not establish capture time, freshness, or failure.',
          'duplicateImageHashes':{key:ids for key,ids in duplicates.items() if len(ids)>1},'checks':results}
        atomic_json(args.output/'source-audit.json',audit);catalog.update({'auditStartedAt':audit_started,'auditCompletedAt':completed,'auditCounts':counts})
    catalog['viewCount']=len(cameras);catalog['locationCount']=len({c['siteId'] for c in cameras});catalog['geocodedCount']=sum(c['hasValidCoordinates'] for c in cameras);catalog['unmappedCount']=len(cameras)-catalog['geocodedCount'];catalog['physicalStateCounts']=dict(collections.Counter(c['physicalState'] or 'Unresolved' for c in cameras));catalog['mediaCounts']={'snapshot':len(cameras),'embeddedVideo':0,'officialRapidImage':sum(c['videoAvailableOnOfficial'] for c in cameras)}
    catalog['counts']=catalog.get('auditCounts',dict(collections.Counter(c['imageStatus'] for c in cameras)))
    atomic_json(path,catalog)
    print(json.dumps({k:catalog.get(k) for k in ('viewCount','locationCount','geocodedCount','unmappedCount','physicalStateCounts','mediaCounts','auditCounts')},indent=2))

if __name__=='__main__':main()
