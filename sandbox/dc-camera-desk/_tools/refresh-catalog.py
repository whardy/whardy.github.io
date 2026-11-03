#!/usr/bin/env python3
"""Build DC Camera Desk from TrafficView's public map and official DC boundaries."""
from __future__ import annotations
import argparse, concurrent.futures, datetime as dt, hashlib, io, json, re, urllib.parse, urllib.request
from pathlib import Path
CATALOG_URL='https://www.trafficview.org/map/accessGeoData.php'
BOUNDARY_BASE='https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/'
SOURCES={'wards':BOUNDARY_BASE+'53','quadrants':BOUNDARY_BASE+'11'}
PARAMS={'system':'all','type':'device_cctv','pf':'formatted','params':'hideInactive','box-loc':'-77.14,38.78,-76.90,39.01','box-within':'true'}

def timestamp():return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
def fetch(url,data=None):
    req=urllib.request.Request(url,data=urllib.parse.urlencode(data).encode() if data else None,headers={'User-Agent':'DC-Camera-Desk/1.0'})
    with urllib.request.urlopen(req,timeout=20) as r:
        body=r.read(8_000_001)
        if len(body)>8_000_000:raise ValueError('Response exceeds size limit')
        return r.status,dict((k.lower(),v) for k,v in r.headers.items()),body

def ring_contains(ring,x,y):
    inside=False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        x1,y1=a[:2];x2,y2=b[:2]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1:inside=not inside
    return inside

def labels_at(features,x,y,key):
    labels=[]
    for f in features:
        g=f['geometry'];polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
        for rings in polys:
            if ring_contains(rings[0],x,y) and not any(ring_contains(h,x,y) for h in rings[1:]):
                labels.append(str(f['properties'][key]));break
    return labels[0] if len(labels)==1 else ''

def road_from(name):
    road=re.split(r'\s+(?:and|amd)\s+|,',name,flags=re.I)[0].strip()
    road=re.sub(r'\bST\b','St',road)
    return road or 'Other roads'

def normalize(rows,boundaries):
    cameras=[]
    for r in rows:
        a=r['attributes'];ident=a['id']
        if not re.fullmatch(r'DDOT_CAPTOP_\d+',ident):continue
        lat=float(r['geometry']['lat']);lon=float(r['geometry']['lon'])
        if not (38.78<lat<39.01 and -77.14<lon<-76.90):raise ValueError('Camera outside DC search extent')
        name=a.get('Location') or ident
        quadrant=labels_at(boundaries['quadrants']['features'],lon,lat,'NAME')
        ward=labels_at(boundaries['wards']['features'],lon,lat,'NAME')
        cameras.append({'id':ident,'siteId':ident,'name':name,'lat':lat,'lon':lon,'road':road_from(name),'county':ward,'ward':ward,'metro':quadrant or 'Boundary / unassigned','quadrant':quadrant,'region':'District of Columbia','provider':'DDOT via TrafficView','imageUrl':f'https://cctv.trafficview.org/thumbnail/{ident}','videoUrl':None,'officialUrl':f'https://www.trafficview.org/live_traffic/#16/{lat}/{lon}','embedMode':'image','sourceStatus':a.get('status','unknown'),'disabled':False,'imageStatus':'unchecked','description':'Official map opens near this location. Enable its camera layer and select the camera'})
    if not cameras:raise ValueError('No DDOT public cameras found')
    if len(set(c['id'] for c in cameras))!=len(cameras):raise ValueError('Duplicate camera ID')
    return cameras

KNOWN_BAD_HASHES={
 'd0773f09095bd8c32d7d2670aabfbb18c8ec6c5bf996cb75b31fb78f0ab8608c',
 '44666b280a4e88c574de32f83302f6d102726e5f9f73e4180566c08741b0c406',
 '844dd114b420f2978acd6af0e01e38446e0a3855eb5d46ceb32959ec18cc3048',
 '366736ea06242dc8d2af1a1307eac7799d34659b100bd354548220b9858d5729',
 'db5718073558a2e6e839f6e08606328e1dc3479e2bb93166a86484958f2a65d3',
}

def audit_image(camera):
    row={'id':camera['id'],'url':camera['imageUrl'],'checkedAt':timestamp(),'status':'unavailable'}
    try:
        code,h,b=fetch(camera['imageUrl'])
        row.update(httpStatus=code,contentType=h.get('content-type'),validThumbnail=h.get('valid-thumbnail'),bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
        if h.get('valid-thumbnail','').lower()!='true':raise ValueError('TrafficView reports no valid thumbnail')
        if 'image/jpeg' not in h.get('content-type','') or not b.startswith(b'\xff\xd8') or not b.rstrip().endswith(b'\xff\xd9'):raise ValueError('Invalid JPEG response')
        from PIL import Image, ImageStat
        with Image.open(io.BytesIO(b)) as image:
            image.load();row.update(width=image.width,height=image.height,decoded=True)
            if max(ImageStat.Stat(image.convert('RGB')).var)<0.1:raise ValueError('Blank source frame')
        if row['sha256'] in KNOWN_BAD_HASHES:raise ValueError('Known provider notice, blank, or corrupted source frame')
        row['status']='available'
    except Exception as e:row['error']=str(e)[:200]
    return row

def write(path,data):path.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'dist');p.add_argument('--audit',action='store_true');p.add_argument('--audit-file',type=Path);p.add_argument('--source-file',type=Path);p.add_argument('--boundaries-dir',type=Path);args=p.parse_args()
    started=timestamp()
    raw=json.loads(args.source_file.read_text()) if args.source_file else json.loads(fetch(CATALOG_URL,PARAMS)[2])
    rows=raw if isinstance(raw,list) else raw['features']
    boundaries={}
    for key,url in SOURCES.items():
        path=args.boundaries_dir/f'dc-{key}.geojson' if args.boundaries_dir else None
        boundaries[key]=json.loads(path.read_text()) if path else json.loads(fetch(url+'/query?'+urllib.parse.urlencode({'f':'geojson','where':'1=1','outFields':'NAME','outSR':'4326','returnGeometry':'true'}))[2])
    if len(boundaries['wards']['features'])!=8 or len(boundaries['quadrants']['features'])!=4:raise ValueError('Incomplete official boundaries')
    cameras=normalize(rows,boundaries);cameras.sort(key=lambda c:c['id'])
    catalog={'fetchedAt':started,'source':'DDOT public cameras via TrafficView','sourceUrl':'https://matoc.org/travel-info/','siteCount':len(cameras),'viewCount':len(cameras),'cameras':cameras,'notes':['Only DDOT camera IDs published in TrafficView’s public DC map extent are included. Nearby Maryland and Virginia cameras are available on their separate sites.','Snapshots load directly from TrafficView. No relay, authentication, signed tokens, archive, or scheduled collector is used.','Quadrants and wards are matched to official DC GIS polygons; ambiguous boundary locations remain unassigned. Road groups use the first road in the published camera name; search also matches crossing roads.','The official map link opens near the camera. Enable its camera layer; the link does not automatically select a camera.']}
    args.output.mkdir(parents=True,exist_ok=True)
    if args.audit and not args.audit_file:
        from PIL import Image  # Require Pillow before starting the audit.
    if args.audit_file or args.audit:
        audit=json.loads(args.audit_file.read_text()) if args.audit_file else {'checkedAt':timestamp(),'cameras':list(concurrent.futures.ThreadPoolExecutor(max_workers=4).map(audit_image,cameras))}
        lookup={r['id']:r for r in audit['cameras']}
        if set(lookup)!=set(c['id'] for c in cameras):raise ValueError('Audit must cover every catalog camera exactly once')
        counts={status:sum(r['status']==status for r in lookup.values()) for status in ['available','unavailable']}
        audit.update(total=len(cameras),counts=counts)
        audit.setdefault('method','One public GET per listed DDOT thumbnail, four workers, 20-second timeout. Requires Valid-Thumbnail:True, JPEG signatures and full Pillow decode. Known unusable frames and uniform blank images are rejected. Successful responses do not establish capture time. No video recorded.')
        for c in cameras:
            a=lookup[c['id']];c.update(imageStatus=a['status'],checkedAt=a['checkedAt'],statusReason=a.get('error',''))
        catalog.update(auditCompletedAt=audit.get('checkedAt',timestamp()),auditCounts=counts)
        write(args.output/'source-audit.json',audit)
    evidence={'checkedAt':started,'sources':SOURCES,'wardBoundaryCount':8,'quadrantBoundaryCount':4,'wardAssignedCount':sum(bool(c['ward']) for c in cameras),'quadrantAssignedCount':sum(bool(c['quadrant']) for c in cameras),'unassigned':[c['id'] for c in cameras if not c['ward'] or not c['quadrant']]}
    write(args.output/'boundary-check.json',evidence);write(args.output/'camera-catalog.json',catalog)
    print(json.dumps({'cameras':len(cameras),'audit':catalog.get('auditCounts'),'boundaries':evidence},indent=2))
if __name__=='__main__':main()
