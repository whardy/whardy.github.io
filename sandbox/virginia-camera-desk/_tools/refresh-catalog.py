#!/usr/bin/env python3
"""Refresh Virginia Camera Desk using the official public Virginia511 catalog.

Usage: python3 scripts/refresh-catalog.py --audit --output dist
No accounts, private endpoints, or video authorization tokens are used.
"""
from __future__ import annotations
import argparse
import collections
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zlib

BASE = "https://511.vdot.virginia.gov"
CATALOG_URL = BASE + "/services/511/map/layers/map/cams"
OUT = Path(__file__).resolve().parents[1] / "dist"
USER_AGENT = "VirginiaCameraDesk/1.0 (public traffic camera directory)"
REVIEW_IMAGES = False
# Only hashes visually confirmed as a provider error card belong here.
KNOWN_PLACEHOLDER_HASHES = {
    "5df8594ccfaced742a7fa99d9f3671e0a41ad5ac83170005b4c032cfe955c7a6": "Provider returned an unavailable-image warning card",
    "a13c5c15dab02f58c0b6ef1d5b69e3aaed0113a55985b821254785e6cc6d4945": "Provider image says STREAM NOT AVAILABLE",
}
KNOWN_BAD_FRAME_HASHES = {
    "0c29abb6e161682f20e94504e0967b6c6fefa6b9250d7ab80c2d0c5a4a9325ef": "Provider image was visibly corrupted at audit time",
    "88cacd54826d3d658754d194e640e7f5a80fa7fa406a78ee4385cca96d06f7f3": "Provider image was visibly corrupted at audit time",
    "83056b113ee21acc626c57fb0483748cfaae59966185b8c7330e8035a6104d84": "Provider image was visibly corrupted at audit time",
}


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url, timeout=15, max_bytes=8_000_000):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        data = response.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError("Response exceeds expected size")
        if data.startswith(b"\x1f\x8b"):
            data = gzip.decompress(data)
        return response.status, {k.lower(): v for k, v in response.headers.items()}, data


def public_url(value, kind):
    if not isinstance(value, str):
        return None
    u = urllib.parse.urlsplit(value)
    if u.scheme != "https" or u.username or u.password or u.query or u.fragment:
        return None
    if kind == "image" and u.hostname == "snapshot.vdotcameras.com" and u.path.startswith("/thumbs/"):
        return value
    if kind == "video" and re.fullmatch(r"media-sfs\d+\.vdotcameras\.com", u.hostname or "") and u.path.startswith("/rtplive/") and u.path.endswith(".m3u8"):
        return value
    return None


def normalize(features):
    cameras = []
    for feature in features:
        p = feature["properties"]
        lon, lat = feature.get("geometry", {}).get("coordinates", [None, None])[:2]
        valid = isinstance(lon, (int, float)) and isinstance(lat, (int, float)) and -84 < lon < -74 and 36 < lat < 40
        if not valid:
            lon = lat = None
        jurisdiction = str(p.get("jurisdiction") or "Virginia")
        # Source jurisdiction often denotes a VDOT regional operation, not a
        # county. Preserve it separately; only explicitly named counties qualify.
        county = jurisdiction if jurisdiction.endswith(" County") else ""
        # Verified frontend showOnMap() accepts these four bounding coordinates.
        # It centers the official map; there is no assumed camera-ID deep link.
        official = BASE + "/"
        if valid:
            official += "?" + urllib.parse.urlencode({"lat1": round(lat - .004, 6), "lon1": round(lon - .004, 6), "lat2": round(lat + .004, 6), "lon2": round(lon + .004, 6)})
        image = public_url(p.get("image_url"), "image")
        disabled = p.get("active") is False
        cameras.append({
            "id": str(p["id"]), "siteId": str(p["id"]), "viewId": str(p["id"]),
            "name": p.get("description") or f"Camera {p['id']}",
            "description": p.get("description") or "", "direction": p.get("direction") or "",
            "lat": lat, "lon": lon, "hasValidCoordinates": valid,
            "road": (p.get("route") or "").strip() or "Unspecified road",
            "county": county, "region": jurisdiction, "jurisdiction": jurisdiction,
            "metro": "", "provider": "Virginia511 / VDOT and participating agencies",
            "imageUrl": image,
            "videoUrl": public_url(p.get("https_url"), "video"),
            "iosVideoUrl": public_url(p.get("ios_url"), "video"),
            "officialUrl": official, "officialLinkType": "map-location",
            "disabled": disabled, "problemStream": bool(p.get("problem_stream")),
            "imageStatus": "disabled" if disabled else "unchecked" if image else "unavailable",
            "videoStatus": "unchecked",
        })
    if len({c["id"] for c in cameras}) != len(cameras):
        raise ValueError("Duplicate camera identifiers; refusing to save incomplete catalog")
    return sorted(cameras, key=lambda c: (c["region"], c["road"], c["name"], c["id"]))


def image_size(body):
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        offset = 8
        size = None
        while offset + 12 <= len(body):
            length = struct.unpack(">I", body[offset:offset+4])[0]
            tag = body[offset+4:offset+8]
            data = body[offset+8:offset+8+length]
            if len(data) != length or offset+12+length > len(body):
                raise ValueError("Truncated PNG")
            crc = struct.unpack(">I", body[offset+8+length:offset+12+length])[0]
            if zlib.crc32(tag+data) & 0xffffffff != crc:
                raise ValueError("Invalid PNG checksum")
            if tag == b"IHDR":
                size = struct.unpack(">II", data[:8])
            if tag == b"IEND" and size:
                return (*size, "png")
            offset += 12+length
        raise ValueError("Incomplete PNG")
    if not body.startswith(b"\xff\xd8") or not body.rstrip().endswith(b"\xff\xd9"):
        raise ValueError("Response is not a complete PNG or JPEG")
    offset = 2
    while offset+4 <= len(body):
        if body[offset] != 255:
            raise ValueError("Invalid JPEG marker")
        while offset < len(body) and body[offset] == 255:
            offset += 1
        marker = body[offset]
        offset += 1
        if marker in (0xd8, 0xd9) or 0xd0 <= marker <= 0xd7:
            continue
        length = struct.unpack(">H", body[offset:offset+2])[0]
        if length < 2 or offset+length > len(body):
            raise ValueError("Truncated JPEG segment")
        if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
            height, width = struct.unpack(">HH", body[offset+3:offset+7])
            return width, height, "jpeg"
        offset += length
    raise ValueError("JPEG dimensions not found")


def audit_image(camera):
    result = {"id": camera["id"], "imageUrl": camera["imageUrl"], "checkedAt": timestamp(), "httpStatus": None}
    try:
        if not camera["imageUrl"]:
            raise ValueError("No public HTTPS snapshot URL")
        code, headers, body = fetch(camera["imageUrl"], max_bytes=3_000_000)
        digest = hashlib.sha256(body).hexdigest()
        result.update({"httpStatus": code, "contentType": headers.get("content-type"), "bytes": len(body), "cors": headers.get("access-control-allow-origin"), "lastModified": headers.get("last-modified"), "sha256": digest})
        width, height, kind = image_size(body)
        if width < 1 or height < 1:
            raise ValueError("Invalid image dimensions")
        result.update({"width": width, "height": height, "format": kind, "isPlaceholder": digest in KNOWN_PLACEHOLDER_HASHES})
        # Temporary local copies support one-time visual review without refetching.
        if REVIEW_IMAGES:
            review = Path(tempfile.gettempdir()) / "virginia-camera-desk-audit-images"
            review.mkdir(exist_ok=True)
            path = review / (digest + "." + kind)
            if not path.exists():
                path.write_bytes(body)
        if digest in KNOWN_PLACEHOLDER_HASHES:
            raise ValueError(KNOWN_PLACEHOLDER_HASHES[digest])
        if digest in KNOWN_BAD_FRAME_HASHES:
            raise ValueError(KNOWN_BAD_FRAME_HASHES[digest])
        result["imageStatus"] = "disabled" if camera["disabled"] else "available"
    except urllib.error.HTTPError as error:
        result.update({"httpStatus": error.code, "imageStatus": "unavailable", "error": f"HTTP {error.code}"})
    except Exception as error:
        result.update({"imageStatus": "unavailable", "error": str(error)[:180]})
    return result


def audit_manifest(url):
    result = {"url": url, "checkedAt": timestamp(), "httpStatus": None}
    try:
        if not url:
            raise ValueError("No public HTTPS HLS URL")
        code, headers, body = fetch(url, max_bytes=200_000)
        text = body.decode("utf-8-sig")
        if not text.lstrip().startswith("#EXTM3U"):
            raise ValueError("Response is not an HLS playlist")
        if "#EXT-X-STREAM-INF:" not in text and "#EXTINF:" not in text:
            raise ValueError("Playlist has no variants or media segments")
        result.update({"httpStatus": code, "contentType": headers.get("content-type"), "cors": headers.get("access-control-allow-origin"), "videoStatus": "available", "manifestBytes": len(body)})
    except urllib.error.HTTPError as error:
        result.update({"httpStatus": error.code, "videoStatus": "unavailable", "error": f"HTTP {error.code}"})
    except Exception as error:
        result.update({"videoStatus": "unavailable", "error": str(error)[:180]})
    return result


def sample_video(url):
    """Fetch one variant and one media segment; never play an entire stream."""
    result = {"url": url, "checkedAt": timestamp()}
    try:
        _, _, master = fetch(url, max_bytes=200_000)
        text = master.decode("utf-8-sig")
        variant = urllib.parse.urljoin(url, next(line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")))
        code, headers, playlist = fetch(variant, max_bytes=200_000)
        lines = playlist.decode("utf-8-sig").splitlines()
        segment = urllib.parse.urljoin(variant, next(line.strip() for line in lines if line.strip() and not line.startswith("#")))
        segment_code, segment_headers, segment_body = fetch(segment, max_bytes=8_000_000)
        result.update({"status": "available", "variantHttpStatus": code, "variantCors": headers.get("access-control-allow-origin"), "segmentHttpStatus": segment_code, "segmentCors": segment_headers.get("access-control-allow-origin"), "segmentBytes": len(segment_body), "segmentContentType": segment_headers.get("content-type")})
    except Exception as error:
        result.update({"status": "unavailable", "error": str(error)[:180]})
    return result


def write_json(path, data):
    temp = path.with_suffix(path.suffix+".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"))+"\n", encoding="utf-8")
    temp.replace(path)


def main():
    global REVIEW_IMAGES
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUT, help="Directory for camera-catalog.json and source-audit.json")
    parser.add_argument("--audit", action="store_true", help="Check every image and unique HLS master using four concurrent workers, plus a small segment sample")
    parser.add_argument("--review-images", action="store_true", help="Keep temporary local image copies for manual visual review")
    args = parser.parse_args()
    REVIEW_IMAGES = args.review_images
    code, headers, body = fetch(CATALOG_URL, max_bytes=10_000_000)
    source = json.loads(body)
    if source.get("type") != "FeatureCollection" or len(source.get("features", [])) < 100:
        raise ValueError("Unexpected catalog; refusing to replace existing data")
    cameras = normalize(source["features"])
    catalog = {"fetchedAt": timestamp(), "source": "Virginia511 / VDOT and participating agencies", "sourceUrl": BASE+"/", "catalogEndpoint": CATALOG_URL, "siteCount": len(cameras), "viewCount": len(cameras), "cameras": cameras, "notes": [
        "Metadata and media URLs come only from the current official public Virginia511 camera layer.",
        "Jurisdiction is a source grouping and may name a VDOT region, city, county, bridge, or partner agency; it is not treated as county geography.",
        "Public snapshot URLs are images. Public HTTPS HLS video is opened only when requested.",
        "Official map links center the camera location using bounding coordinates supported by the public frontend; they do not promise to open a camera popup.",
        "Checks establish endpoint availability at the recorded time, not scene freshness or continuous future availability. No video authorization tokens are obtained or stored.",
    ]}
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    write_json(output/"camera-catalog.json", catalog)
    print(f"Saved {len(cameras)} Virginia camera sites", flush=True)
    if not args.audit:
        return
    started = timestamp()
    images = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i, item in enumerate(pool.map(audit_image, cameras), 1):
            images.append(item)
            if i%100 == 0 or i == len(cameras):
                print(f"Image audit: {i}/{len(cameras)}", flush=True)
    manifests = []
    video_urls = sorted({c["videoUrl"] for c in cameras if c["videoUrl"]})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i, item in enumerate(pool.map(audit_manifest, video_urls), 1):
            manifests.append(item)
            if i%100 == 0 or i == len(video_urls):
                print(f"HLS master audit: {i}/{len(video_urls)}", flush=True)
    available_by_host = {}
    for item in manifests:
        if item["videoStatus"] == "available":
            available_by_host.setdefault(urllib.parse.urlsplit(item["url"]).hostname, item["url"])
    samples = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        samples = list(pool.map(sample_video, available_by_host.values()))
    image_lookup = {r["id"]: r for r in images}
    video_lookup = {r["url"]: r for r in manifests}
    for camera in cameras:
        result = image_lookup[camera["id"]]
        camera.update({k: result.get(k) for k in ("imageStatus", "httpStatus", "checkedAt", "isPlaceholder")})
        camera["imageWidth"], camera["imageHeight"] = result.get("width"), result.get("height")
        if result.get("error"):
            camera["statusReason"] = result["error"]
        video = video_lookup.get(camera["videoUrl"], {})
        camera["videoStatus"] = video.get("videoStatus", "unavailable")
        camera["videoCheckedAt"] = video.get("checkedAt")
        if camera["videoStatus"] != "available":
            # Preserve official public URLs for user-initiated retry. The dated
            # audit status is advisory; a transient provider failure may recover.
            camera["videoStatusReason"] = video.get("error", "No available public HLS manifest")
    counts = {state: sum(r["imageStatus"] == state for r in images) for state in ("available", "disabled", "unavailable")}
    video_counts = {state: sum(r["videoStatus"] == state for r in manifests) for state in ("available", "unavailable")}
    duplicates = collections.Counter(r["sha256"] for r in images if r.get("sha256"))
    audit = {"startedAt": started, "completedAt": timestamp(), "source": BASE+"/", "catalogCors": headers.get("access-control-allow-origin"), "method": "One GET per snapshot and unique standard HLS master, four concurrent workers, 15-second request timeout. PNG chunk checksums and JPEG structure/dimensions validated. Known visually confirmed placeholders rejected. One variant and one media segment sampled per working HLS host. No full video recordings and no authorization tokens. Image freshness is not proven.", "total": len(images), "counts": counts, "videoCounts": video_counts, "duplicateImageHashes": [{"sha256": key, "count": count} for key,count in duplicates.most_common() if count>1], "cameras": images, "videoManifests": manifests, "videoSamples": samples}
    catalog.update({"auditCompletedAt": audit["completedAt"], "auditCounts": counts, "videoAuditCounts": video_counts})
    write_json(output/"source-audit.json", audit)
    write_json(output/"camera-catalog.json", catalog)
    print(json.dumps({"images": counts, "videoMasters": video_counts, "segmentSamples": len(samples)}), flush=True)


if __name__ == "__main__":
    main()
