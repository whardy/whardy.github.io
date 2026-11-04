#!/usr/bin/env python3
"""Bounded dated sample of Nevada camera JPEGs and HLS manifests.

Manifest checks do not assert that a stream decodes in a browser. Run browser
playback checks separately. The script never records video or downloads all feeds.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OFFLINE_IMAGES = {
    'bddfbd0d26ad9c324ccdeb3f28607fc2273dbcba08c7d5e1b24d1d7ca6276f0c': 'Nevada DOT technical difficulties card',
    'e608c39b77e5480ce13682b571638e4246ff519dd6c79402c393db5e273aab19': 'Nevada 511 no live camera feed card',
}

def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def fetch(url, limit):
    request = Request(url, headers={'User-Agent':'NevadaCameraDesk/1.0 (bounded dated media check)','Accept':'image/jpeg,application/vnd.apple.mpegurl,*/*'})
    with urlopen(request,timeout=18) as response:
        body=response.read(limit+1)
        if len(body)>limit: raise ValueError('Response exceeds audit limit')
        return response.status,response.headers.get('content-type',''),body

def jpeg_decodes(body):
    if len(body)<1000 or not body.startswith(b'\xff\xd8') or not body.rstrip().endswith(b'\xff\xd9'):
        return False
    with tempfile.NamedTemporaryFile(suffix='.jpg') as file:
        file.write(body);file.flush()
        result=subprocess.run(['sips','-g','pixelWidth','-g','pixelHeight',file.name],capture_output=True,text=True,timeout=8)
        return result.returncode==0 and bool(re.search(r'pixelWidth:\s*[1-9]\d*',result.stdout)) and bool(re.search(r'pixelHeight:\s*[1-9]\d*',result.stdout))

def sample(cameras,count):
    groups=defaultdict(list)
    for camera in cameras:groups[camera['county']].append(camera)
    for group in groups.values():group.sort(key=lambda c:c['id'])
    selected=[]
    for county in sorted(groups,key=lambda k:(-len(groups[k]),k)):
        if len(selected)>=count:break
        group=groups[county]
        selected.append(group[len(group)//2])
    remaining=[c for c in cameras if c['id'] not in {x['id'] for x in selected}]
    if remaining and len(selected)<count:
        stride=max(1,len(remaining)//(count-len(selected)))
        selected.extend(remaining[::stride][:count-len(selected)])
    return selected

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog',type=Path,default=ROOT/'camera-catalog.json')
    parser.add_argument('--output',type=Path,default=ROOT/'source-audit.json')
    parser.add_argument('--sample',type=int,default=20)
    args=parser.parse_args()
    if not 1<=args.sample<=50:parser.error('--sample must be 1–50')
    catalog=json.loads(args.catalog.read_text())
    cameras=catalog['cameras'];chosen=sample(cameras,args.sample)
    results=[]
    for i,camera in enumerate(chosen,1):
        result={'id':camera['id'],'county':camera['county'],'checkedAt':now(),'image':'not checked','videoManifest':'not checked'}
        try:
            status,ctype,body=fetch(camera['imageUrl'],1_500_000)
            digest=hashlib.sha256(body).hexdigest()
            result['image']='provider-offline-card' if digest in OFFLINE_IMAGES else 'jpeg-decoded' if status==200 and jpeg_decodes(body) else 'invalid-image'
            if digest in OFFLINE_IMAGES:result['imageNotice']=OFFLINE_IMAGES[digest]
            result['imageBytes']=len(body)
            result['imageContentType']=ctype
        except (HTTPError,URLError,ValueError,subprocess.TimeoutExpired) as error:
            result['image']='request-failed';result['imageError']=str(error)[:160]
        if camera.get('videoUrl'):
            try:
                status,ctype,body=fetch(camera['videoUrl'],500_000)
                result['videoManifest']='manifest-returned' if status==200 and body.startswith(b'#EXTM3U') else 'invalid-manifest'
                result['manifestBytes']=len(body)
            except (HTTPError,URLError,ValueError) as error:
                result['videoManifest']='request-failed';result['videoError']=str(error)[:160]
        if result['image']=='jpeg-decoded':
            camera['imageStatus']='available'
        elif result['image'] in {'request-failed','invalid-image','provider-offline-card'}:
            camera['imageStatus']='unavailable'
        if camera.get('videoUrl') and result['videoManifest'] in {'request-failed','invalid-manifest'}:
            camera['videoStatus']='unavailable'
        # An HLS manifest is insufficient to label video available.
        camera['checkedAt']=result['checkedAt']
        results.append(result)
        print(f'{i}/{len(chosen)} {camera["id"]}: {result["image"]}, {result["videoManifest"]}',flush=True)
        time.sleep(.4)
    summary={'startedAt':results[0]['checkedAt'],'completedAt':now(),'sampleSize':len(results),
             'totalViews':len(cameras),'counts':{'image':dict(Counter(r['image'] for r in results)),
                                              'videoManifest':dict(Counter(r['videoManifest'] for r in results))},
             'method':'JPEG decoded by sips; HLS manifest syntax only. Browser decoding tested separately. No video recording.',
             'results':results}
    args.output.write_text(json.dumps(summary,indent=2)+'\n')
    catalog['auditCompletedAt']=summary['completedAt']
    args.catalog.write_text(json.dumps(catalog,separators=(',',':'),ensure_ascii=False))
    print(json.dumps(summary['counts'],indent=2))

if __name__=='__main__':main()
