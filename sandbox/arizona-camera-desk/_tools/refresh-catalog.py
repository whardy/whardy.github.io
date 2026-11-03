#!/usr/bin/env python3
"""Build the Arizona catalog from the same public list/map endpoints as AZ511.

No account, developer API key, signed media token, or relay is used. The separate
documented developer API requires registration and is deliberately not called.
All image URLs and view IDs come from the public catalog; IDs are not guessed.
"""
import argparse
import collections
import concurrent.futures
import datetime as dt
import email.utils
import gzip
import hashlib
import json
import re
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://az511.gov"
LIST_URL = BASE + "/List/GetData/Cameras"
MAP_URL = BASE + "/map/mapIcons/Cameras"
MAX_BYTES = 8_000_000
KNOWN_PLACEHOLDERS = {
    "e608c39b77e5480ce13682b571638e4246ff519dd6c79402c393db5e273aab19": "Provider notice: No live camera feed at this time",
    "23f87fa28f6f815c78d68d5d3ab939e0025463e4dd61d28ab55bb4dacea0e8b5": "Provider image shows a crossed-out camera",
}


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "ArizonaCameraDesk/1.0 (public camera availability check)", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("Response exceeds 8 MB")
        if body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)
        return response.status, dict(response.headers), body


def read_json(url):
    return json.loads(fetch(url)[2])


def catalog_rows():
    rows, expected, start = [], None, 0
    while expected is None or start < expected:
        query = {"columns": [{"name": "sortOrder"}, {"name": "city", "s": True}, {"name": "roadway", "s": True}, {"name": "location"}],
                 "order": [{"column": 0, "dir": "asc"}, {"column": 2, "dir": "asc"}],
                 "start": start, "length": 100, "search": {"value": ""}}
        url = LIST_URL + "?" + urllib.parse.urlencode({"query": json.dumps(query, separators=(",", ":")), "lang": "en"})
        page = read_json(url)
        total = page.get("recordsTotal")
        if not isinstance(total, int) or not 0 < total < 10_000 or page.get("recordsFiltered") != total:
            raise ValueError("Unexpected public catalog totals")
        if expected is not None and total != expected:
            raise ValueError("Catalog changed while paging; rerun for a consistent snapshot")
        expected = total
        batch = page.get("data")
        if not isinstance(batch, list) or not batch:
            raise ValueError("Missing catalog page")
        rows.extend(batch)
        start += len(batch)
        time.sleep(0.15)
    if len(rows) != expected or len({row["id"] for row in rows}) != expected:
        raise ValueError("Catalog has missing or duplicated sites")
    markers = read_json(MAP_URL)["item2"]
    map_ids = {str(marker["itemId"]) for marker in markers}
    if map_ids != {str(row["id"]) for row in rows}:
        raise ValueError("Public map and list camera IDs disagree; review before publishing")
    return rows, len(map_ids)


def coordinates(row):
    wkt = ((row.get("latLng") or {}).get("geography") or {}).get("wellKnownText", "")
    match = re.fullmatch(r"POINT\s*\((-?[\d.]+)\s+(-?[\d.]+)\)", wkt)
    if not match:
        return None, None
    lon, lat = map(float, match.groups())
    if not (31.2 < lat < 37.1 and -115.0 < lon < -108.9):
        raise ValueError(f"Coordinates outside Arizona envelope: {row['id']}")
    return lat, lon


def normalize(rows):
    cameras, ids = [], set()
    for row in rows:
        site_id = int(row["id"])
        lat, lon = coordinates(row)
        views = row.get("images")
        if not isinstance(views, list) or not views:
            raise ValueError(f"Site {site_id} has no published views")
        for view in views:
            view_id = int(view["id"])
            if view_id in ids or int(view["cameraSiteId"]) != site_id:
                raise ValueError("Duplicate view or mismatched site ID")
            ids.add(view_id)
            image_url = urllib.parse.urljoin(BASE, view["imageUrl"])
            if image_url != f"{BASE}/map/Cctv/{view_id}":
                raise ValueError(f"Unexpected public image URL: {view_id}")
            disabled = bool(view.get("disabled") or view.get("blocked"))
            city = (row.get("city") or "").strip()
            county = (row.get("county") or "").strip()
            cameras.append({
                "id": f"az511-{view_id}", "siteId": f"az511-site-{site_id}", "viewId": view_id,
                "name": view.get("description") or row.get("location") or f"AZ511 camera {view_id}",
                "location": row.get("location") or "", "lat": lat, "lon": lon, "hasValidCoordinates": lat is not None,
                "road": (row.get("roadway") or "Other roads").strip().upper(), "county": county, "city": city,
                "metro": city or "Other Arizona", "region": city or "Other Arizona", "district": row.get("dotDistrict") or "",
                "provider": "ADOT / AZ511", "direction": row.get("direction") or "",
                "imageUrl": image_url, "videoUrl": None, "officialUrl": f"{BASE}/#camera-{site_id}",
                "embedMode": "image", "disabled": disabled, "imageStatus": "disabled" if disabled else "unchecked",
                "sourceStatus": "Disabled in source" if disabled else "Enabled in source", "videoAvailableOnOfficial": False,
                "statusReason": "Provider marked this view disabled or blocked." if disabled else "",
            })
    return sorted(cameras, key=lambda camera: (camera["metro"], camera["road"], camera["name"], camera["id"]))


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
        if len(body) < 60_000:
            samples = Path("/tmp/arizona-camera-audit-samples")
            samples.mkdir(exist_ok=True)
            (samples / f"{digest}.{format_name}").write_bytes(body)
    except urllib.error.HTTPError as error:
        result.update({"httpStatus": error.code, "error": f"HTTP {error.code}"})
    except Exception as error:
        result["error"] = str(error)[:180]
    return result


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "dist")
    parser.add_argument("--audit", action="store_true", help="Check every published image with at most four workers")
    parser.add_argument("--audit-only", action="store_true", help="Keep dated metadata and check images from the existing catalog")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.audit_only:
        catalog = json.loads((args.output / "camera-catalog.json").read_text())
    else:
        rows, map_count = catalog_rows()
        cameras = normalize(rows)
        catalog = {"fetchedAt": timestamp(), "source": "ADOT / AZ511 public camera list and map", "sourceUrl": BASE + "/cctv",
                   "siteCount": len(rows), "viewCount": len(cameras), "mapSiteCount": map_count,
                   "inlineCameraCount": len(cameras), "officialOnlyCount": 0, "videoCameraCount": 0,
                   "metroCounts": dict(sorted(collections.Counter(camera["metro"] for camera in cameras).items())),
                   "notes": [
                       "Camera site metadata and all published image views come from the public AZ511 camera-list endpoint used by its website; the public map site IDs are cross-checked for completeness.",
                       "The separate developer API requires a key and is not called. No account, relay, credential, or signed video URL is needed by this static viewer.",
                       "Metro/area labels use the source city field and can cover surrounding communities; they are not official metropolitan boundaries. Missing area labels appear under Other Arizona. Counties are source-provided; missing counties remain blank.",
                       "Images load directly from AZ511. They are snapshots, not continuous video. No video URL is supplied by the retrieved public camera catalog.",
                       "Image checks are dated availability observations. Last-Modified and browser fetched time do not guarantee when the camera captured the scene.",
                   ], "cameras": cameras}
        write_json(args.output / "camera-catalog.json", catalog)
    cameras = catalog["cameras"]
    print(f"Catalog: {catalog['siteCount']} sites, {len(cameras)} views, {len(catalog['metroCounts'])} populated areas", flush=True)
    if args.audit or args.audit_only:
        started, results = timestamp(), []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for result in pool.map(audit_camera, cameras):
                results.append(result)
                if len(results) % 100 == 0 or len(results) == len(cameras):
                    print(f"Image audit: {len(results)}/{len(cameras)}", flush=True)
        counts = {status: sum(row["sourceImageStatus"] == status for row in results) for status in ("available", "stale", "disabled", "unavailable")}
        audit = {"startedAt": started, "completedAt": timestamp(), "source": BASE + "/cctv", "total": len(results),
                 "method": "One GET per published image view, four workers, 20-second timeout and 8 MB response cap. JPEG/PNG signatures and dimensions checked. Visually verified provider notices identified by SHA-256. No video streams requested.",
                 "scope": "All image views in the public AZ511 camera catalog", "counts": counts, "inlineCounts": counts, "cameras": results}
        write_json(args.output / "source-audit.json", audit)
        lookup = {row["id"]: row for row in results}
        for camera in cameras:
            result = lookup[camera["id"]]
            for key in ("checkedAt", "httpStatus", "sourceImageStatus", "lastModified", "sourceAgeSeconds", "isPlaceholder"):
                if key in result:
                    camera[key] = result[key]
            camera["imageStatus"] = result["sourceImageStatus"]
            camera["imageWidth"], camera["imageHeight"] = result.get("width"), result.get("height")
            camera["statusReason"] = result.get("error", "")
        catalog.update({"auditCompletedAt": audit["completedAt"], "auditCounts": counts, "inlineAuditCounts": counts, "auditScope": audit["scope"]})
        write_json(args.output / "camera-catalog.json", catalog)
        print(json.dumps(counts), flush=True)


if __name__ == "__main__":
    main()
