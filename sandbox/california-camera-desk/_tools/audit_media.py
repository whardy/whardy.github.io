#!/usr/bin/env python3
"""Bounded, resumable checks of the listed California media endpoints.

This is a maintenance audit, not a browser player or an availability guarantee.
Run from a copy of the maintained catalog with --output pointing to that copy.
The only network targets are HTTPS URLs already present in the catalog, plus
their same-host HLS child playlists, media segments and HTTPS redirects.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    from PIL import Image
except ImportError:
    Image = None
try:
    import imageio_ffmpeg
except ImportError:
    imageio_ffmpeg = None

UA = 'CaliforniaCameraDesk/2.0 (+https://whardy.github.io/sandbox/california-camera-desk/; bounded public media audit)'
UTC = dt.timezone.utc
# Visually verified 2026-11-04 across official Caltrans district images.
# The decoded top 320x220 pixels exclude each JPEG's variable timestamp bar.
# Exact template matches avoid treating snow, white skies or unchanged scenes
# as camera failures. Other designs remain unknown until separately verified.
CALTRANS_PLACEHOLDER_TOP_SHA256 = {
    'd8c4cf82cb8d0f867c1e2705d6c99f8cb7186adea3f82c7846dc385ef8b9f740': 'Temporarily Unavailable',
    'de98c7675ecea823d5b429a6ca0b6d9eb4c6a01e08527a45f9a1020214403be8': 'Temporarily Unavailable',
    '0b44e51d2a22a67c25a750de9857f29812970b77267633cd550bde2777e99009': 'Temporarily Unavailable',
    'b3a819aa01b57c27901a8e0b26aed458c4952f576f1217ccba298868ca81b155': 'Down for Construction',
    '3086afdc336dbc1727ff6657b89ad6f6eb7e2b6f06ed3605fa3bde6d08032ea8': 'Down for Construction',
    '96021612784943b1cdca892feb9f4e48432765da0b3ffa51c9dee51a154e107f': 'Down for Construction',
}
PLACEHOLDER_DETECTOR_VERSION = 'caltrans-v2'
_request_lock = threading.Lock()
_last_request = 0.0
_min_gap = 0.25


def now() -> str:
    return dt.datetime.now(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def plus_hours(stamp: str, hours: float) -> str:
    return (dt.datetime.fromisoformat(stamp.replace('Z', '+00:00')) + dt.timedelta(hours=hours)).isoformat(timespec='seconds').replace('+00:00', 'Z')


def endpoint_key(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    # Match the catalog builder's key: an explicit HTTPS default port does not
    # create another media endpoint and must survive a catalog refresh.
    host = p.hostname.lower()
    if p.port and p.port != 443:
        host += ':' + str(p.port)
    return urllib.parse.urlunsplit(('https', host, p.path, p.query, ''))


def safe_https(url: str, parent: str | None = None) -> str:
    target = urllib.parse.urljoin(parent, url) if parent else url
    p = urllib.parse.urlsplit(target)
    if p.scheme != 'https' or not p.hostname or p.username or p.password:
        raise ValueError('non-HTTPS or credential-bearing media URL')
    if parent and p.hostname.lower() != urllib.parse.urlsplit(parent).hostname.lower():
        raise ValueError('HLS child URL changes host; manual review needed')
    return target


class HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(HttpsOnly())


class UnverifiedHls(ValueError):
    """A playlist was reachable, but its selected child/segments were not proven."""

    def __init__(self, message: str, category: str):
        super().__init__(message)
        self.category = category


def request(url: str, max_bytes: int, timeout: float) -> tuple[bytes, dict, str, int]:
    global _last_request
    safe_https(url)
    with _request_lock:
        delay = _min_gap - (time.monotonic() - _last_request)
        if delay > 0:
            time.sleep(delay)
        _last_request = time.monotonic()
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Origin': 'https://whardy.github.io', 'Accept': '*/*'})
    try:
        with OPENER.open(req, timeout=timeout) as response:
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ValueError('response exceeds audit byte limit')
            headers = {k.lower(): v for k, v in response.headers.items()}
            return body, headers, response.url, response.status
    except urllib.error.HTTPError as error:
        if error.code == 429:
            retry = error.headers.get('Retry-After', '30')
            try:
                delay = min(60.0, max(5.0, float(retry)))
            except ValueError:
                delay = 30.0
            with _request_lock:
                _last_request = max(_last_request, time.monotonic() + delay)
        raise


def response_summary(headers: dict, final: str, status: int, size: int) -> dict:
    return {'httpStatus': status, 'finalUrl': final, 'contentType': headers.get('content-type'),
            'cors': headers.get('access-control-allow-origin'), 'bytes': size,
            'lastModified': headers.get('last-modified')}


def allows_public_origin(headers: dict) -> bool:
    value = (headers.get('access-control-allow-origin') or '').strip()
    return value in {'*', 'https://whardy.github.io'}


def first_media_line(playlist: str) -> str:
    for line in playlist.splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            return line
    raise ValueError('HLS playlist has no media entry')


def text_playlist(data: bytes, kind: str) -> str:
    value = data.decode('utf-8-sig')
    if not value.lstrip().startswith('#EXTM3U'):
        raise ValueError(f'{kind} is not an HLS playlist')
    return value


def segment_structure(data: bytes) -> str:
    if len(data) < 1024:
        raise ValueError('media segment is too short')
    # MPEG-TS sync bytes at regular 188-byte packet intervals. The first bytes
    # may be ID3 metadata, so search within the first packet-sized window.
    for offset in range(min(188, len(data))):
        if all(offset + 188 * n < len(data) and data[offset + 188 * n] == 0x47 for n in range(4)):
            return 'mpeg-ts'
    if b'ftyp' in data[:128] or b'moof' in data[:128]:
        return 'fragmented-mp4'
    raise ValueError('media segment lacks recognizable TS/fMP4 structure')


def decode_segment(data: bytes, timeout: float) -> tuple[bool, str | None]:
    if imageio_ffmpeg is None:
        return False, 'FFmpeg decoder not installed'
    try:
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        result = subprocess.run([exe, '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
                                 '-map', '0:v:0', '-frames:v', '1', '-f', 'image2pipe',
                                 '-vcodec', 'png', 'pipe:1'],
                                input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, check=False)
        if result.returncode == 0 and result.stdout.startswith(b'\x89PNG\r\n\x1a\n') and len(result.stdout) > 100:
            if Image is not None:
                try:
                    with Image.open(io.BytesIO(result.stdout)) as frame:
                        frame.load()
                        if frame.width <= 0 or frame.height <= 0:
                            return False, 'FFmpeg emitted a zero-size frame'
                except Exception as error:
                    return False, f'FFmpeg PNG frame did not decode: {error}'
            return True, None
        return False, result.stderr.decode(errors='replace')[-400:].strip() or f'ffmpeg produced no decoded video frame (exit {result.returncode})'
    except (subprocess.TimeoutExpired, OSError) as error:
        return False, str(error)


def check_image(url: str, timeout: float, max_bytes: int) -> dict:
    data, headers, final, http_status = request(url, max_bytes, timeout)
    result = response_summary(headers, final, http_status, len(data))
    result['sha256'] = hashlib.sha256(data).hexdigest()
    if not data.startswith((b'\xff\xd8', b'\x89PNG\r\n\x1a\n')):
        raise ValueError('response is not JPEG or PNG image bytes')
    if Image is None:
        result.update({'status': 'unchecked', 'verificationMethod': 'image-structure',
                       'reason': 'Pillow unavailable; image was not decoded'})
        return result
    with Image.open(io.BytesIO(data)) as im:
        im.load()
        width, height = im.size
        if width <= 0 or height <= 0 or width > 20000 or height > 20000:
            raise ValueError('decoded image dimensions outside bounds')
        result.update({'width': width, 'height': height, 'format': im.format,
                       'status': 'available', 'verificationMethod': 'image-decoded'})
        if (width, height) == (320, 260):
            top_digest = hashlib.sha256(im.convert('RGB').crop((0, 0, 320, 220)).tobytes()).hexdigest()
            result['topRegionSha256'] = top_digest
            if top_digest in CALTRANS_PLACEHOLDER_TOP_SHA256:
                label = CALTRANS_PLACEHOLDER_TOP_SHA256[top_digest]
                result.update({'status': 'unavailable', 'failureCategory': 'placeholder',
                               'reason': f'Visually verified Caltrans {label} image template',
                               'placeholderTemplate': f'caltrans-{label.lower().replace(" ", "-")}-2026-11-04'})
    return result


def check_video(url: str, timeout: float, max_bytes: int, continuity: bool) -> dict:
    data, headers, final, http_status = request(url, 100_000, timeout)
    result = response_summary(headers, final, http_status, len(data))
    cors_ok = allows_public_origin(headers)
    manifest = text_playlist(data, 'top-level response')
    result['masterPlaylist'] = '#EXT-X-STREAM-INF' in manifest
    result['codecs'] = list(dict.fromkeys(re.findall(r'CODECS="([^"]+)"', manifest)))
    playlist_url = final
    if result['masterPlaylist']:
        variants = [line.strip() for line in manifest.splitlines() if line.strip() and not line.startswith('#')]
        variant_errors = []
        for index, relative in enumerate(variants[:2]):
            try:
                candidate = safe_https(relative, final)
                child, child_headers, candidate, child_status = request(candidate, 100_000, timeout)
                playlist = text_playlist(child, 'child response')
                playlist_url = candidate
                cors_ok = cors_ok and allows_public_origin(child_headers)
                result['childPlaylist'] = response_summary(child_headers, playlist_url, child_status, len(child))
                result['variantIndex'] = index
                if variant_errors:
                    result['variantAttemptErrors'] = variant_errors
                break
            except Exception as error:
                variant_errors.append(str(error)[:160])
        else:
            raise UnverifiedHls('HLS master reachable but up to two listed child variants failed: ' + '; '.join(variant_errors), 'playlist')
    else:
        playlist = manifest
    if '#EXT-X-KEY' in playlist:
        raise ValueError('encrypted HLS playlist needs provider-specific access review')
    result['livePlaylist'] = '#EXT-X-ENDLIST' not in playlist
    result['mediaSequence'] = (re.search(r'#EXT-X-MEDIA-SEQUENCE:(\d+)', playlist) or [None, None])[1]
    segment_lines = [line.strip() for line in playlist.splitlines() if line.strip() and not line.startswith('#')]
    if not segment_lines:
        raise ValueError('HLS media playlist has no segment entry')
    # HLS media sequences usually list oldest to newest. A live playlist's
    # oldest segment may already have rotated away. Try the newest listed
    # segment, then one prior listed segment on fetch/structure/decode failure.
    candidates = list(dict.fromkeys(segment_lines[-2:][::-1]))
    decoded = False
    decode_error = None
    structured = False
    attempt_errors = []
    for index, relative in enumerate(candidates):
        try:
            segment_url = safe_https(relative, playlist_url)
            segment, segment_headers, segment_final, segment_status = request(segment_url, max_bytes, timeout)
            fmt = segment_structure(segment)
            structured = True
            result['selectedSegmentIndex'] = len(segment_lines) - 1 - index
            summary = response_summary(segment_headers, segment_final, segment_status, len(segment))
            if index == 0:
                result['mediaSegment'] = summary
                result['segmentFormat'] = fmt
            else:
                result['mediaSegment2'] = summary
                result['segmentFormat2'] = fmt
            segment_cors = cors_ok and allows_public_origin(segment_headers)
            if 'browserCors' not in result or index == 0:
                result['browserCors'] = segment_cors
            segment_decoded, segment_error = decode_segment(segment, timeout)
            if segment_decoded:
                decoded = True
                decode_error = None
                result['browserCors'] = segment_cors
                break
            decode_error = segment_error
            if index == 1:
                result['secondDecoderNote'] = segment_error
        except Exception as error:
            attempt_errors.append(str(error)[:160])
            if index == 1:
                result['secondSegmentError'] = str(error)[:300]
    if attempt_errors:
        result['segmentAttemptErrors'] = attempt_errors
    if not structured:
        raise UnverifiedHls('HLS playlist reachable but up to two listed segments failed: ' + '; '.join(attempt_errors), 'segment')
    result['segmentDecoded'] = decoded
    result['decoderEvidence'] = 'png-frame' if decoded else 'none'
    if decode_error:
        result['decoderNote'] = decode_error
    result['status'] = 'available'
    result['verificationMethod'] = 'ffmpeg-decoded-segment' if decoded else 'hls-segment-structure'
    # A second playlist request is deliberately optional. It waits one target
    # interval and should be used in a small rotating sample, not for all 2k+
    # streams on every audit. Unchanged sequence is inconclusive.
    result['playlistAdvancement'] = 'not-checked'
    if continuity and result['livePlaylist']:
        target = re.search(r'#EXT-X-TARGETDURATION:(\d+)', playlist)
        wait = min(12, max(2, int(target[1]) if target else 10))
        time.sleep(wait)
        follow, _, _, _ = request(playlist_url, 100_000, timeout)
        new = text_playlist(follow, 'follow-up playlist')
        new_seq = (re.search(r'#EXT-X-MEDIA-SEQUENCE:(\d+)', new) or [None, None])[1]
        result['playlistAdvancement'] = 'advanced' if new_seq and result['mediaSequence'] and int(new_seq) > int(result['mediaSequence']) else 'inconclusive'
        result['followupAt'] = now()
    return result


def audit_one(task: tuple[str, str], args) -> tuple[str, dict]:
    kind, url = task
    stamp = now()
    entry = {'kind': kind, 'url': url, 'checkedAt': stamp, 'status': 'unavailable',
             'verificationMethod': 'image-decode-attempt' if kind == 'image' else 'hls-segment-attempt'}
    if kind == 'image':
        entry['placeholderDetectorVersion'] = PLACEHOLDER_DETECTOR_VERSION
    try:
        fields = check_image(url, args.timeout, args.max_image_bytes) if kind == 'image' else check_video(url, args.timeout, args.max_segment_bytes, args.continuity)
        entry.update(fields)
        if fields['status'] == 'available':
            entry['lastSuccessAt'] = stamp
            entry['lastSuccessVerificationMethod'] = fields.get('verificationMethod')
        elif fields['status'] == 'unavailable':
            entry['lastFailureAt'] = stamp
    except Exception as error:
        entry['error'] = str(error)[:500]
        entry['lastFailureAt'] = stamp
        if isinstance(error, urllib.error.HTTPError):
            entry['httpStatus'] = error.code
            if error.code in {401, 403}:
                entry['failureCategory'] = 'access-requirement'
                entry['status'] = 'unchecked'
            elif error.code == 429:
                entry['failureCategory'] = 'rate-limit'
                entry['status'] = 'unchecked'
            else:
                entry['failureCategory'] = 'http'
        elif isinstance(error, (urllib.error.URLError, TimeoutError)):
            entry['failureCategory'] = 'network'
        elif isinstance(error, UnverifiedHls):
            entry['failureCategory'] = error.category
            entry['status'] = 'unchecked'
        elif 'non-HTTPS' in str(error) or 'changes host' in str(error):
            entry['failureCategory'] = 'delivery-restriction'
            entry['status'] = 'unchecked'
        elif 'encrypted HLS' in str(error):
            entry['failureCategory'] = 'access-requirement'
            entry['status'] = 'unchecked'
        elif 'exceeds audit byte limit' in str(error):
            entry['failureCategory'] = 'audit-limit'
            entry['status'] = 'unchecked'
        elif 'HLS' in str(error) or 'playlist' in str(error):
            entry['failureCategory'] = 'playlist'
        elif 'segment' in str(error):
            entry['failureCategory'] = 'segment'
        elif kind == 'image':
            entry['failureCategory'] = 'image-decode'
        else:
            entry['failureCategory'] = 'unknown'
    entry['expiresAt'] = plus_hours(stamp, args.success_ttl_hours if entry['status'] == 'available' else args.failure_ttl_hours)
    return endpoint_key(url), entry


def atomic_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    # Both sites load the catalog on mobile; compact generated JSON reduces
    # transfer without changing the inspectable data or raw source records.
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    temp.replace(path)


def camera_health(kind: str, url: str | None, entry: dict | None) -> dict:
    if not url:
        return {'url': None, 'deliveryMethod': 'none', 'status': 'not-listed', 'verificationMethod': None,
                'checkedAt': None, 'expiresAt': None, 'lastSuccessAt': None, 'lastSuccessVerificationMethod': None,
                'lastFailureAt': None, 'failureCategory': None, 'reason': None, 'finalUrl': None}
    # Older manifest-only audits cannot establish playable video. Preserve the
    # historical evidence without promoting them into the verified filters.
    if not entry:
        return {'url': url, 'deliveryMethod': 'hls' if kind == 'video' else 'snapshot-image',
                'status': 'unchecked', 'verificationMethod': None,
                'checkedAt': None, 'expiresAt': None, 'lastSuccessAt': None, 'lastSuccessVerificationMethod': None,
                'lastFailureAt': None, 'failureCategory': None, 'reason': None, 'finalUrl': None}
    method = entry.get('verificationMethod') or ('hls-manifest-only' if kind == 'video' else 'image-structure')
    status = entry.get('status', 'unchecked')
    if status == 'available' and method not in {'image-decoded', 'ffmpeg-decoded-segment', 'hls-segment-structure', 'browser-playback'}:
        status = 'unchecked'
    delivery = 'hls' if kind == 'video' else 'snapshot-' + str(entry.get('format') or 'image').lower()
    return {'url': url, 'deliveryMethod': delivery,
            'status': status, 'verificationMethod': method,
            'checkedAt': entry.get('checkedAt'), 'expiresAt': entry.get('expiresAt'),
            'lastSuccessAt': entry.get('lastSuccessAt'), 'lastSuccessVerificationMethod': entry.get('lastSuccessVerificationMethod'),
            'lastFailureAt': entry.get('lastFailureAt'),
            'failureCategory': entry.get('failureCategory'), 'reason': entry.get('error') or entry.get('reason'),
            'finalUrl': entry.get('finalUrl'), 'browserCors': entry.get('browserCors'),
            'segmentDecoded': entry.get('segmentDecoded'), 'decoderEvidence': entry.get('decoderEvidence'),
            'playlistAdvancement': entry.get('playlistAdvancement')}


def reclassify_stored_placeholders(entries: dict, failure_ttl_hours: float) -> dict:
    """Upgrade prior decoded-pixel evidence when a template is verified later.

    A 320x260 decoded image without a stored top-pixel hash is left for a
    network recheck; no new template classification is inferred from bytes or
    metadata alone.
    """
    changes = collections.Counter()
    for e in entries.values():
        if e.get('kind') != 'image':
            continue
        digest = e.get('topRegionSha256')
        if e.get('width') == 320 and e.get('height') == 260 and not digest and e.get('status') == 'available':
            changes['needsNetworkRecheck'] += 1
            continue
        e['placeholderDetectorVersion'] = PLACEHOLDER_DETECTOR_VERSION
        label = CALTRANS_PLACEHOLDER_TOP_SHA256.get(digest)
        if not label:
            continue
        if e.get('status') != 'unavailable' or e.get('failureCategory') != 'placeholder':
            changes['newlyClassified'] += 1
        if e.get('lastSuccessAt') == e.get('checkedAt'):
            e.pop('lastSuccessAt', None)
            e.pop('lastSuccessVerificationMethod', None)
        e.update({'status': 'unavailable', 'failureCategory': 'placeholder',
                  'reason': f'Visually verified Caltrans {label} image template',
                  'placeholderTemplate': f'caltrans-{label.lower().replace(" ", "-")}-2026-11-04',
                  'lastFailureAt': e.get('checkedAt')})
        if e.get('checkedAt'):
            e['expiresAt'] = plus_hours(e['checkedAt'], failure_ttl_hours)
    return dict(changes)


def integrate(catalog: dict, entries: dict, started: str | None, completed: str | None, args):
    tasks = {(kind, endpoint_key(c[field])) for c in catalog['cameras']
             for kind, field in [('image', 'imageUrl'), ('video', 'videoUrl')] if c.get(field)}
    entries = {key: e for key, e in entries.items() if (e.get('kind'), key) in tasks}
    for e in entries.values():
        method = e.get('verificationMethod')
        proof = method == 'image-decoded' or (method == 'ffmpeg-decoded-segment' and e.get('decoderEvidence') == 'png-frame') or method == 'browser-playback'
        if e.get('status') == 'available' and proof and e.get('lastSuccessAt') == e.get('checkedAt') and not e.get('lastSuccessVerificationMethod'):
            e['lastSuccessVerificationMethod'] = method
        # Earlier manifest/structure audits sometimes carried a success time
        # without a method. It cannot be presented as decoded-media history.
        if e.get('lastSuccessAt') and not e.get('lastSuccessVerificationMethod'):
            e.pop('lastSuccessAt', None)
    for c in catalog['cameras']:
        image = entries.get(endpoint_key(c['imageUrl'])) if c.get('imageUrl') else None
        video = entries.get(endpoint_key(c['videoUrl'])) if c.get('videoUrl') else None
        snapshot_health = camera_health('image', c.get('imageUrl'), image)
        video_health = camera_health('video', c.get('videoUrl'), video)
        c['mediaHealth'] = {'snapshot': snapshot_health, 'video': video_health}
        c['imageStatus'] = snapshot_health['status'] if c.get('imageUrl') else 'not-listed'
        c['videoStatus'] = video_health['status'] if c.get('videoUrl') else 'not-listed'
        c['imageCheckedAt'] = snapshot_health['checkedAt']
        c['videoCheckedAt'] = video_health['checkedAt']
        c['checkedAt'] = max((v for v in [c['imageCheckedAt'], c['videoCheckedAt']] if v), default=None)
        c['disabled'] = bool(c.get('sourceDisabled')) and not any(h['status'] == 'available' for h in [snapshot_health, video_health])
    stats = catalog['stats']
    stats['imageAvailability'] = dict(collections.Counter(c['imageStatus'] for c in catalog['cameras']))
    stats['videoAvailability'] = dict(collections.Counter(c['videoStatus'] for c in catalog['cameras']))
    method_counts = dict(collections.Counter(e.get('verificationMethod') or e.get('checkType') or 'legacy' for e in entries.values()))
    status_counts = dict(collections.Counter(e.get('status', 'unchecked') for e in entries.values()))
    coverage = {'scope': 'Dated all-listed-endpoint check' if len(entries) == len(tasks) else 'Dated partial endpoint check',
                'listedUniqueEndpoints': len(tasks), 'checkedUniqueEndpoints': len(entries),
                'uncheckedUniqueEndpoints': len(tasks) - len(entries),
                'indeterminateUniqueEndpoints': sum(e.get('status') == 'unchecked' for e in entries.values()),
                'imageChecks': sum(e['kind'] == 'image' for e in entries.values()),
                'videoChecks': sum(e['kind'] == 'video' for e in entries.values()),
                'pngFrameChecks': sum(e.get('decoderEvidence') == 'png-frame' for e in entries.values()),
                'knownPlaceholderImages': sum(e.get('kind') == 'image' and e.get('failureCategory') == 'placeholder' for e in entries.values()),
                'hlsCorsIncompatible': sum(e.get('kind') == 'video' and e.get('browserCors') is False for e in entries.values()),
                'methodCounts': method_counts, 'statusCounts': status_counts,
                'successTtlHours': args.success_ttl_hours, 'failureTtlHours': args.failure_ttl_hours,
                'method': 'One bounded decode attempt per listed image endpoint; HLS master, child, segment and FFmpeg frame attempts where each prior stage is reachable. Browser playback is sampled separately.'}
    all_strict = len(entries) == len(tasks) and all(e.get('verificationMethod') in {'image-decoded', 'image-decode-attempt', 'hls-segment-structure', 'ffmpeg-decoded-segment', 'hls-segment-attempt'} for e in entries.values())
    previous_coverage = catalog.get('auditCoverage') or {}
    if all_strict and (not catalog.get('fullSweepCompletedAt') or
                       previous_coverage.get('checkedUniqueEndpoints', 0) < len(tasks)):
        catalog['fullSweepCompletedAt'] = completed
    catalog['auditCoverage'] = coverage
    catalog['auditCompletedAt'] = completed
    manifest = {'startedAt': started, 'completedAt': completed,
                'fullSweepCompletedAt': catalog.get('fullSweepCompletedAt'),
                'method': coverage['method'], 'coverage': coverage,
                'stats': stats, 'endpoints': sorted(entries.values(), key=lambda e: (e['kind'], e['url']))}
    return catalog, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    project_root = Path(__file__).resolve().parents[1]
    default_output = project_root if Path(__file__).resolve().parent.name == '_tools' else project_root / 'dist'
    parser.add_argument('--output', type=Path, default=default_output)
    parser.add_argument('--limit', type=int, default=0, help='Maximum new endpoints in this run; zero means all remaining')
    parser.add_argument('--kind', choices=('both', 'image', 'video'), default='both')
    parser.add_argument('--endpoint', action='append', default=[],
                        help='Recheck this exact already-listed HTTPS endpoint; repeatable')
    parser.add_argument('--endpoint-list', type=Path,
                        help='JSON array of exact listed HTTPS endpoints for a focused resumable recheck')
    parser.add_argument('--only-available', action='store_true',
                        help='Restrict a focused recheck/sample to endpoints last marked available')
    parser.add_argument('--missing-png-evidence', action='store_true',
                        help='Recheck legacy FFmpeg successes that lack emitted PNG-frame evidence')
    parser.add_argument('--image-template-recheck', action='store_true',
                        help='Recheck listed images lacking the versioned Caltrans placeholder test')
    parser.add_argument('--sample-per-district', type=int, default=0,
                        help='Stratified number of endpoints per district and selected kind; for small continuity checks')
    parser.add_argument('--workers', type=int, default=2, choices=(1, 2, 3, 4))
    parser.add_argument('--request-gap', type=float, default=0.25, help='Minimum seconds between any two HTTP requests')
    parser.add_argument('--timeout', type=float, default=12)
    parser.add_argument('--max-image-bytes', type=int, default=2_000_000)
    parser.add_argument('--max-segment-bytes', type=int, default=8_000_000)
    parser.add_argument('--success-ttl-hours', type=float, default=168,
                        help='Seven-day default; this is an audit-age threshold, not an uptime promise')
    parser.add_argument('--failure-ttl-hours', type=float, default=48)
    parser.add_argument('--continuity', action='store_true', help='Extra delayed playlist request; use only in a small sample')
    parser.add_argument('--force', action='store_true', help='Recheck even if current audit has same strict method')
    parser.add_argument('--rotate-oldest', action='store_true',
                        help='Select oldest checks first, including prior strict results; use with --limit for scheduled batches')
    parser.add_argument('--rebase-ttl', action='store_true',
                        help='Recompute expiry from prior check times without requesting media; useful after policy change')
    parser.add_argument('--reclassify-known-placeholders', action='store_true',
                        help='Reapply visually verified placeholder templates to stored decoded-pixel hashes without network requests')
    args = parser.parse_args()
    if args.limit < 0 or args.request_gap < 0 or args.workers > 4:
        parser.error('Invalid request bound')
    global _min_gap
    _min_gap = args.request_gap
    out = args.output.resolve()
    catalog_path = out / 'camera-catalog.json'
    audit_path = out / 'source-audit.json'
    progress_path = out / 'audit-progress.json'
    catalog = json.loads(catalog_path.read_text())
    old = json.loads(audit_path.read_text()) if audit_path.exists() else {}
    progress = json.loads(progress_path.read_text()) if progress_path.exists() else {}
    entries = {endpoint_key(e['url']): e for e in old.get('endpoints', []) + progress.get('endpoints', [])}
    if args.reclassify_known_placeholders:
        print('Stored-image template reclassification:', reclassify_stored_placeholders(entries, args.failure_ttl_hours), flush=True)
    if args.rebase_ttl:
        for e in entries.values():
            if e.get('checkedAt') and e.get('verificationMethod') in {'image-decoded', 'image-decode-attempt', 'hls-segment-structure', 'ffmpeg-decoded-segment', 'hls-segment-attempt'}:
                e['expiresAt'] = plus_hours(e['checkedAt'], args.success_ttl_hours if e.get('status') == 'available' else args.failure_ttl_hours)
    tasks = sorted({(kind, endpoint_key(c[field])) for c in catalog['cameras']
                    for kind, field in [('image', 'imageUrl'), ('video', 'videoUrl')] if c.get(field)})
    if args.kind != 'both':
        tasks = [t for t in tasks if t[0] == args.kind]
    requested_endpoints = list(args.endpoint)
    if args.endpoint_list:
        requested_endpoints.extend(json.loads(args.endpoint_list.read_text()))
    if requested_endpoints:
        wanted = {endpoint_key(safe_https(url)) for url in requested_endpoints}
        tasks = [t for t in tasks if t[1] in wanted]
        if len({t[1] for t in tasks}) != len(wanted):
            parser.error('--endpoint must match a listed catalog endpoint of the selected kind')
    if args.only_available:
        tasks = [t for t in tasks if entries.get(t[1], {}).get('status') == 'available']
    if args.sample_per_district:
        selected = set()
        eligible = set(tasks)
        for district in sorted({c.get('district') for c in catalog['cameras'] if c.get('district')}):
            group = [c for c in catalog['cameras'] if c.get('district') == district]
            for kind, field in [('image', 'imageUrl'), ('video', 'videoUrl')]:
                if args.kind not in ('both', kind):
                    continue
                choices = sorted({endpoint_key(c[field]) for c in group if c.get(field) and (kind, endpoint_key(c[field])) in eligible})
                n = min(args.sample_per_district, len(choices))
                for index in range(n):
                    selected.add((kind, choices[round(index * (len(choices) - 1) / max(1, n - 1))]))
        tasks = [t for t in tasks if t in selected]
    def needs_check(task):
        if args.force:
            return True
        e = entries.get(task[1])
        if not e:
            return True
        return e.get('verificationMethod') not in ({'image-decoded', 'image-decode-attempt'} if task[0] == 'image' else {'hls-segment-structure', 'ffmpeg-decoded-segment', 'hls-segment-attempt'})
    if args.reclassify_known_placeholders:
        todo = []
    elif args.image_template_recheck:
        todo = [t for t in tasks if t[0] == 'image' and entries.get(t[1], {}).get('placeholderDetectorVersion') != PLACEHOLDER_DETECTOR_VERSION]
    elif args.missing_png_evidence:
        todo = [t for t in tasks if t[0] == 'video' and entries.get(t[1], {}).get('verificationMethod') == 'ffmpeg-decoded-segment' and entries.get(t[1], {}).get('decoderEvidence') != 'png-frame']
    elif args.rotate_oldest:
        todo = sorted(tasks, key=lambda task: (entries.get(task[1], {}).get('checkedAt') or '', task[0], task[1]))
    else:
        todo = [t for t in tasks if needs_check(t)]
    if args.limit:
        todo = todo[:args.limit]
    started = progress.get('startedAt') or (old.get('startedAt') if not todo else now())
    print(f'Listed {len(tasks)} unique endpoints; {len(todo)} selected for this batch; Pillow={Image is not None}; FFmpeg={imageio_ffmpeg is not None}', flush=True)
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for key, entry in pool.map(lambda task: audit_one(task, args), todo):
            previous = entries.get(key)
            if previous:
                strict_previous = previous.get('verificationMethod') in {'image-decoded', 'hls-segment-structure', 'browser-playback'} or (previous.get('verificationMethod') == 'ffmpeg-decoded-segment' and previous.get('decoderEvidence') == 'png-frame')
                carry_success = previous.get('lastSuccessAt') if previous.get('lastSuccessVerificationMethod') else (previous.get('checkedAt') if strict_previous and previous.get('status') == 'available' else None)
                if entry.get('failureCategory') == 'placeholder' and previous.get('kind') == 'image' and previous.get('placeholderDetectorVersion') != PLACEHOLDER_DETECTOR_VERSION:
                    carry_success = None
                entry['lastSuccessAt'] = entry.get('lastSuccessAt') or carry_success
                entry['lastSuccessVerificationMethod'] = (entry.get('lastSuccessVerificationMethod') or (previous.get('lastSuccessVerificationMethod') if carry_success else None) or (previous.get('verificationMethod') if carry_success and strict_previous and previous.get('status') == 'available' else None))
                entry['lastFailureAt'] = entry.get('lastFailureAt') or previous.get('lastFailureAt') or (previous.get('checkedAt') if previous.get('status') == 'unavailable' else None)
            entries[key] = entry
            completed += 1
            if completed % 25 == 0:
                atomic_json(progress_path, {'startedAt': started, 'updatedAt': now(), 'doneThisBatch': completed,
                                            'totalListed': len(tasks), 'endpoints': list(entries.values())})
            if completed % 100 == 0:
                print(f'Checked {completed}/{len(todo)} this batch', flush=True)
    completed_at = now() if completed or args.reclassify_known_placeholders else old.get('completedAt')
    catalog, manifest = integrate(catalog, entries, started, completed_at, args)
    atomic_json(catalog_path, catalog)
    atomic_json(audit_path, manifest)
    progress_path.unlink(missing_ok=True)
    print(json.dumps(manifest['coverage'], indent=2), flush=True)


if __name__ == '__main__':
    main()
