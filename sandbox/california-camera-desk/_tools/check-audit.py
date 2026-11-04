#!/usr/bin/env python3
"""Focused fault checks for the California media audit and health mapping."""
import hashlib
import io
import unittest
import urllib.error
from unittest.mock import patch

import audit_media as a


class AuditChecks(unittest.TestCase):
    def test_newly_verified_template_reclassifies_stored_decoded_image(self):
        digest = next(h for h, label in a.CALTRANS_PLACEHOLDER_TOP_SHA256.items()
                      if label == 'Down for Construction')
        checked = '2026-11-04T00:00:00Z'
        entry = {'kind': 'image', 'url': 'https://example.org/current.jpg',
                 'status': 'available', 'verificationMethod': 'image-decoded',
                 'width': 320, 'height': 260, 'topRegionSha256': digest,
                 'checkedAt': checked, 'lastSuccessAt': checked,
                 'lastSuccessVerificationMethod': 'image-decoded'}
        changes = a.reclassify_stored_placeholders({'one': entry}, 48)
        self.assertEqual(changes['newlyClassified'], 1)
        self.assertEqual(entry['failureCategory'], 'placeholder')
        self.assertEqual(entry['status'], 'unavailable')
        self.assertEqual(entry['placeholderDetectorVersion'], 'caltrans-v2')
        self.assertEqual(entry['expiresAt'], '2026-11-06T00:00:00Z')
        self.assertNotIn('lastSuccessAt', entry)

    def test_audit_403_is_access_unknown_not_source_outage(self):
        class Args:
            timeout = 2
            max_image_bytes = 100_000
            max_segment_bytes = 100_000
            continuity = False
            success_ttl_hours = 168
            failure_ttl_hours = 48
        url = 'https://example.org/live.m3u8'
        error = urllib.error.HTTPError(url, 403, 'Forbidden', {}, None)
        with patch.object(a, 'check_video', side_effect=error):
            _, entry = a.audit_one(('video', url), Args())
        error.close()
        self.assertEqual(entry['status'], 'unchecked')
        self.assertEqual(entry['failureCategory'], 'access-requirement')

    def test_default_https_port_matches_builder_endpoint_identity(self):
        self.assertEqual(a.endpoint_key('https://EXAMPLE.org:443/path.m3u8'),
                         a.endpoint_key('https://example.org/path.m3u8'))

    def test_legacy_success_without_method_is_not_claimed_as_decoded_history(self):
        class Args:
            success_ttl_hours = 168
            failure_ttl_hours = 48
        url = 'https://example.org/current.jpg'
        entry = {'kind': 'image', 'url': url, 'status': 'unavailable',
                 'verificationMethod': 'image-decoded', 'failureCategory': 'placeholder',
                 'checkedAt': '2026-11-04T00:00:00Z',
                 'lastSuccessAt': '2026-11-03T00:00:00Z'}
        catalog = {'cameras': [{'id': 'caltrans:D01:1', 'imageUrl': url,
                               'videoUrl': None, 'sourceDisabled': True}], 'stats': {}}
        _, manifest = a.integrate(catalog, {a.endpoint_key(url): entry}, None,
                                  '2026-11-04T00:00:00Z', Args())
        self.assertNotIn('lastSuccessAt', manifest['endpoints'][0])

    def test_full_sweep_marker_updates_when_two_missing_endpoints_are_checked(self):
        class Args:
            success_ttl_hours = 168
            failure_ttl_hours = 48
        image = 'https://example.org/current.jpg'
        video = 'https://example.org/live.m3u8'
        catalog = {'cameras': [{'id': 'caltrans:D01:1', 'imageUrl': image,
                                'videoUrl': video, 'sourceDisabled': False}],
                   'stats': {}, 'fullSweepCompletedAt': '2026-11-04T00:00:00Z',
                   'auditCoverage': {'checkedUniqueEndpoints': 1}}
        entries = {
            a.endpoint_key(image): {'kind': 'image', 'url': image, 'status': 'available',
                                    'verificationMethod': 'image-decoded', 'checkedAt': '2026-11-04T01:00:00Z'},
            a.endpoint_key(video): {'kind': 'video', 'url': video, 'status': 'unavailable',
                                    'verificationMethod': 'hls-segment-attempt', 'checkedAt': '2026-11-04T01:00:00Z'}
        }
        result, manifest = a.integrate(catalog, entries, None, '2026-11-04T01:00:00Z', Args())
        self.assertEqual(result['fullSweepCompletedAt'], '2026-11-04T01:00:00Z')
        self.assertEqual(manifest['fullSweepCompletedAt'], '2026-11-04T01:00:00Z')

    def test_expired_manifest_only_video_never_becomes_verified(self):
        legacy = {'kind': 'video', 'url': 'https://example.org/playlist.m3u8',
                  'status': 'available', 'checkedAt': '2026-11-01T00:00:00Z',
                  'checkType': 'HLS manifest syntax only'}
        health = a.camera_health('video', legacy['url'], legacy)
        self.assertEqual(health['status'], 'unchecked')
        self.assertEqual(health['verificationMethod'], 'hls-manifest-only')

    def test_video_and_snapshot_health_remain_independent(self):
        class Args:
            success_ttl_hours = 168
            failure_ttl_hours = 48
        image = 'https://example.org/current.jpg'
        video = 'https://example.org/playlist.m3u8'
        catalog = {'cameras': [{'id': 'caltrans:D01:1', 'imageUrl': image,
                                'videoUrl': video, 'sourceDisabled': True}],
                   'stats': {}}
        entries = {
            a.endpoint_key(image): {'kind': 'image', 'url': image, 'status': 'available',
                                    'verificationMethod': 'image-decoded',
                                    'checkedAt': '2026-11-04T00:00:00Z',
                                    'expiresAt': '2026-11-11T00:00:00Z'},
            a.endpoint_key(video): {'kind': 'video', 'url': video, 'status': 'unavailable',
                                    'verificationMethod': 'hls-segment-attempt',
                                    'failureCategory': 'segment',
                                    'checkedAt': '2026-11-04T00:00:00Z',
                                    'expiresAt': '2026-11-06T00:00:00Z'}
        }
        result, _ = a.integrate(catalog, entries, None, '2026-11-04T00:00:00Z', Args())
        camera = result['cameras'][0]
        self.assertEqual(camera['imageStatus'], 'available')
        self.assertEqual(camera['videoStatus'], 'unavailable')
        self.assertEqual(camera['mediaHealth']['video']['failureCategory'], 'segment')
        self.assertFalse(camera['disabled'], 'decoded media must remain visible despite stale provider service flag')

    def test_hls_requires_child_and_real_segment_structure(self):
        master = b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000,CODECS="avc1.42e01e"\nchild.m3u8\n'
        child = b'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:8\n#EXTINF:10,\nmedia.ts\n'
        segment = bytearray(188 * 8)
        for n in range(8):
            segment[n * 188] = 0x47
        headers = {'access-control-allow-origin': '*'}
        responses = [(master, headers, 'https://example.org/master.m3u8', 200),
                     (child, headers, 'https://example.org/child.m3u8', 200),
                     (bytes(segment), headers, 'https://example.org/media.ts', 200)]
        with patch.object(a, 'request', side_effect=responses), patch.object(a, 'decode_segment', return_value=(False, 'decoder not installed')):
            result = a.check_video('https://example.org/master.m3u8', 2, 10_000, False)
        self.assertEqual(result['verificationMethod'], 'hls-segment-structure')
        self.assertTrue(result['browserCors'])
        self.assertEqual(result['segmentFormat'], 'mpeg-ts')
        with patch.object(a, 'request', side_effect=responses[:2] + [(b'<html>error</html>', headers, 'https://example.org/media.ts', 200)]):
            with self.assertRaisesRegex(ValueError, 'segment'):
                a.check_video('https://example.org/master.m3u8', 2, 10_000, False)

    def test_second_listed_segment_can_supply_decodable_frame(self):
        master = b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000\nchild.m3u8\n'
        child = b'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\na.ts\n#EXTINF:10,\nb.ts\n'
        segment = bytearray(188 * 8)
        for n in range(8):
            segment[n * 188] = 0x47
        h = {'access-control-allow-origin': '*'}
        replies = [(master, h, 'https://example.org/master.m3u8', 200),
                   (child, h, 'https://example.org/child.m3u8', 200),
                   (bytes(segment), h, 'https://example.org/a.ts', 200),
                   (bytes(segment), h, 'https://example.org/b.ts', 200)]
        with patch.object(a, 'request', side_effect=replies), patch.object(a, 'decode_segment', side_effect=[(False, 'no keyframe'), (True, None)]) as decoder:
            result = a.check_video('https://example.org/master.m3u8', 2, 10_000, False)
        self.assertEqual(decoder.call_count, 2)
        self.assertEqual(result['verificationMethod'], 'ffmpeg-decoded-segment')
        self.assertEqual(result['decoderEvidence'], 'png-frame')

    def test_newest_live_segment_retries_previous_when_rotated_away(self):
        playlist = b'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:20\n#EXTINF:10,\na.ts\n#EXTINF:10,\nb.ts\n'
        segment = bytearray(188 * 8)
        for n in range(8):
            segment[n * 188] = 0x47
        h = {'access-control-allow-origin': '*'}
        called = []
        def replies(url, *_):
            called.append(url)
            if url.endswith('.m3u8'):
                return playlist, h, url, 200
            if url.endswith('b.ts'):
                error = urllib.error.HTTPError(url, 404, 'rotated', {}, None)
                error.close()
                raise error
            return bytes(segment), h, url, 200
        with patch.object(a, 'request', side_effect=replies), patch.object(a, 'decode_segment', return_value=(True, None)):
            result = a.check_video('https://example.org/live.m3u8', 2, 10_000, False)
        self.assertEqual(called[-2:], ['https://example.org/b.ts', 'https://example.org/a.ts'])
        self.assertEqual(result['verificationMethod'], 'ffmpeg-decoded-segment')
        self.assertTrue(result['segmentAttemptErrors'])

    def test_second_master_variant_can_recover_failed_first_variant(self):
        master = b'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nfirst.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000\nsecond.m3u8\n'
        child = b'#EXTM3U\n#EXTINF:10,\na.ts\n'
        segment = bytearray(188 * 8)
        for n in range(8):
            segment[n * 188] = 0x47
        h = {'access-control-allow-origin': '*'}
        def replies(url, *_):
            if url.endswith('master.m3u8'):
                return master, h, url, 200
            if url.endswith('first.m3u8'):
                error = urllib.error.HTTPError(url, 404, 'missing variant', {}, None)
                error.close()
                raise error
            if url.endswith('second.m3u8'):
                return child, h, url, 200
            return bytes(segment), h, url, 200
        with patch.object(a, 'request', side_effect=replies), patch.object(a, 'decode_segment', return_value=(True, None)):
            result = a.check_video('https://example.org/master.m3u8', 2, 10_000, False)
        self.assertEqual(result['variantIndex'], 1)
        self.assertEqual(result['verificationMethod'], 'ffmpeg-decoded-segment')

    def test_reachable_playlist_without_retrievable_segments_is_indeterminate(self):
        playlist = b'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\na.ts\n'
        h = {'access-control-allow-origin': '*'}
        def replies(url, *_):
            if url.endswith('.m3u8'):
                return playlist, h, url, 200
            error = urllib.error.HTTPError(url, 404, 'rotated', {}, None)
            error.close()
            raise error
        with patch.object(a, 'request', side_effect=replies):
            with self.assertRaises(a.UnverifiedHls) as raised:
                a.check_video('https://example.org/live.m3u8', 2, 10_000, False)
        self.assertEqual(raised.exception.category, 'segment')

    def test_http_200_html_cannot_pass_image_decode(self):
        with patch.object(a, 'request', return_value=(b'<html>maintenance</html>', {}, 'https://example.org/current.jpg', 200)):
            with self.assertRaisesRegex(ValueError, 'not JPEG or PNG'):
                a.check_image('https://example.org/current.jpg', 2, 10_000)

    @unittest.skipIf(a.Image is None, 'Pillow is required for decoded-image checks')
    def test_visually_verified_template_path_can_mark_decoded_image_unavailable(self):
        image = a.Image.new('RGB', (320, 260), 'white')
        expected = hashlib.sha256(image.crop((0, 0, 320, 220)).tobytes()).hexdigest()
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG')
        with patch.object(a, 'request', return_value=(buffer.getvalue(), {}, 'https://example.org/current.jpg', 200)), \
             patch.object(a, 'CALTRANS_PLACEHOLDER_TOP_SHA256', {expected:'Temporarily Unavailable'}):
            result = a.check_image('https://example.org/current.jpg', 2, 100_000)
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(result['failureCategory'], 'placeholder')

    def test_ttl_is_explicit_utc(self):
        self.assertEqual(a.plus_hours('2026-11-04T00:00:00Z', 168), '2026-11-11T00:00:00Z')

    def test_hls_children_must_use_https_and_same_host(self):
        self.assertEqual(a.safe_https('child.m3u8', 'https://example.org/master.m3u8'),
                         'https://example.org/child.m3u8')
        with self.assertRaises(ValueError):
            a.safe_https('http://example.org/child.m3u8', 'https://example.org/master.m3u8')
        with self.assertRaises(ValueError):
            a.safe_https('https://other.example/child.m3u8', 'https://example.org/master.m3u8')


if __name__ == '__main__':
    unittest.main()
