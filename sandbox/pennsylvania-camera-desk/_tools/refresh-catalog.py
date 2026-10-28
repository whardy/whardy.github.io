#!/usr/bin/env python3
"""Build a static 511PA public snapshot catalog and optionally audit its images.

Uses only the endpoints consumed by 511PA's public camera list. It does not
request video authorization, retain session tokens, or fetch video streams.
The public catalog does not grant cross-origin fetch access, so this script
fetches metadata at build time. The public JPEG endpoint permits image display.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import re
import struct
import time
import urllib.error
import urllib.parse
import urllib.request


BASE = "https://511pa.com"
LIST_URL = BASE + "/List/GetData/Cameras"
OFFICIAL_PAGE = BASE + "/cctv"
USER_AGENT = "PennsylvaniaCameraDesk/1.0 (public traffic camera directory)"
OUT = Path(__file__).resolve().parents[1] / "dist"
# Visually verified from public endpoints on 2026-10-28. A successful response
# alone is not a feed: the provider can return an unavailable PNG or blank JPEG.
KNOWN_PLACEHOLDER_HASHES = {
    "e608c39b77e5480ce13682b571638e4246ff519dd6c79402c393db5e273aab19": "Provider image says no live camera feed at this time",
    "21eebdd3187a2bff7407058b66c0cb1558e0ad72a6b49c15f66641f16b6312ca": "Provider returned a blank frame",
    "2e337bcd088789c92837e5730ca10910b859ecd17bb0ae9a9b9ee0d3117b9313": "Provider returned a blank frame with PennDOT logo",
}


def timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url: str, timeout: int = 20, max_bytes: int = 8_000_000):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ValueError("Response exceeds expected size")
        if body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)
        return response.status, dict(response.headers), body


def get_page(start: int):
    columns = ["sortOrder", "dotDistrict", "county", "roadway", "turnpikeOnly", "location", "cameraName", "district"]
    query = {
        "start": start, "length": 100,
        "columns": [{"name": col, "data": col, "s": True} for col in columns],
        "order": [{"column": 0, "dir": "asc"}], "search": {"value": ""},
    }
    url = LIST_URL + "?" + urllib.parse.urlencode({"query": json.dumps(query, separators=(",", ":")), "lang": "en"})
    _, _, raw = fetch(url)
    return json.loads(raw)


def normalize(rows):
    cameras = []
    for row in rows:
        wkt = (row.get("latLng") or {}).get("geography", {}).get("wellKnownText", "")
        match = re.fullmatch(r"POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)", wkt)
        lon, lat = map(float, match.groups()) if match else (None, None)
        valid_coordinates = bool(lon is not None and lat is not None and -81 < lon < -74 and 39 < lat < 43)
        if not valid_coordinates:
            # The official catalog contains at least one unavailable site at
            # POINT (0 0). Preserve its card without plotting a false location.
            lon, lat = None, None
        for view in row.get("images", []):
            relative = view.get("imageUrl")
            if not relative:
                continue
            image_url = urllib.parse.urljoin(BASE, relative)
            if not image_url.startswith(BASE + "/map/Cctv/"):
                raise ValueError(f"Unexpected snapshot URL: {image_url}")
            disabled = bool(view.get("disabled") or view.get("blocked"))
            cameras.append({
                "id": str(view["id"]),
                "viewId": str(view["id"]),
                "siteId": str(row["id"]),
                "name": row.get("location") or row.get("cameraName") or f"Camera {row['id']}",
                "cameraName": row.get("cameraName") or "",
                "description": view.get("description") or "",
                "direction": row.get("direction") or "",
                "lat": lat, "lon": lon, "hasValidCoordinates": valid_coordinates,
                "road": row.get("roadway") or "Unspecified road",
                "county": row.get("county") or "Unspecified county",
                "region": row.get("dotDistrict") or row.get("region") or "Pennsylvania",
                "metro": "",
                "district": row.get("district") or "",
                "provider": row.get("source") or "511PA",
                "imageUrl": image_url,
                "videoUrl": None,
                "officialUrl": BASE + "/map#camera-" + str(row["DT_RowId"]),
                "officialVideoUrl": BASE + "/map#camera-" + str(row["DT_RowId"]),
                "disabled": disabled,
                "videoAvailableOn511PA": bool(view.get("videoUrl") and not view.get("videoDisabled") and not disabled),
                "imageStatus": "disabled" if disabled else "unchecked",
            })
    ids = [camera["id"] for camera in cameras]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate image IDs returned; refusing to write a partial catalog")
    return sorted(cameras, key=lambda cam: (cam["region"], cam["county"], cam["road"], cam["name"], cam["id"]))


def jpeg_size(data: bytes):
    """Read JPEG SOF dimensions; this is structural validation, not pixel decoding."""
    if not data.startswith(b"\xff\xd8") or not data.rstrip().endswith(b"\xff\xd9"):
        raise ValueError("Missing JPEG start/end signature")
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
            if width < 1 or height < 1:
                raise ValueError("Invalid JPEG dimensions")
            return width, height
        if marker == 0xDA:
            break
        offset += length
    raise ValueError("JPEG dimensions not found")


def audit_camera(camera):
    result = {"id": camera["id"], "imageUrl": camera["imageUrl"], "checkedAt": timestamp(), "httpStatus": None}
    try:
        status, headers, body = fetch(camera["imageUrl"], max_bytes=2_000_000)
        lower_headers = {key.lower(): value for key, value in headers.items()}
        result.update({"httpStatus": status, "contentType": lower_headers.get("content-type", ""), "bytes": len(body), "cors": lower_headers.get("access-control-allow-origin"), "sha256": hashlib.sha256(body).hexdigest()})
        if result["sha256"] in KNOWN_PLACEHOLDER_HASHES:
            result.update({"isPlaceholder": True, "imageStatus": "disabled" if camera["disabled"] else "unavailable", "error": KNOWN_PLACEHOLDER_HASHES[result["sha256"]]})
            return result
        if "image/jpeg" not in result["contentType"]:
            raise ValueError("Response is not image/jpeg")
        width, height = jpeg_size(body)
        result.update({"width": width, "height": height, "isPlaceholder": False, "imageStatus": "disabled" if camera["disabled"] else "available"})
    except urllib.error.HTTPError as error:
        result.update({"httpStatus": error.code, "imageStatus": "unavailable", "error": f"HTTP {error.code}"})
    except Exception as error:
        result.update({"imageStatus": "unavailable", "error": str(error)[:180]})
    return result


def write_json(path: Path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", action="store_true", help="Fetch every catalog image once with at most four concurrent requests")
    parser.add_argument("--output", type=Path, default=OUT, help="Directory for catalog and audit JSON")
    args = parser.parse_args()
    output = args.output.resolve()
    first = get_page(0)
    total = int(first["recordsTotal"])
    rows = list(first["data"])
    if total < 100:
        raise ValueError("Unexpectedly small catalog; refusing to replace existing data")
    for start in range(100, total, 100):
        page = get_page(start)
        if int(page["recordsTotal"]) != total:
            raise ValueError("Catalog changed during pagination; retry for a consistent snapshot")
        rows.extend(page["data"])
        print(f"Catalog: {len(rows)}/{total} sites", flush=True)
        time.sleep(0.1)
    if len(rows) != total or len({str(row["id"]) for row in rows}) != total:
        raise ValueError("Missing or duplicate camera sites; refusing incomplete catalog")
    cameras = normalize(rows)
    catalog = {
        "fetchedAt": timestamp(), "source": "511PA / PennDOT and participating agencies",
        "sourceUrl": OFFICIAL_PAGE, "catalogEndpoint": LIST_URL,
        "siteCount": total, "viewCount": len(cameras), "cameras": cameras,
        "notes": [
            "Snapshot URLs and camera metadata come from the official public 511PA camera list.",
            "Catalog metadata is saved at build time because the public catalog endpoint does not allow browser cross-origin fetches.",
            "Public JPEG images refresh while the page is open; they are snapshots, not continuous video.",
            "Video is opened on 511PA. No video authorization tokens are requested, copied, or stored by this project.",
            "511PA limits viewers to eight simultaneous video streams; this site does not open video streams automatically.",
            "Image checks verify HTTP status, content type, JPEG signatures, and dimensions and reject visually verified placeholder/blank-image hashes. They do not prove scene freshness or detect every possible source fault.",
        ],
    }
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "camera-catalog.json", catalog)
    print(f"Saved {total} camera sites / {len(cameras)} image views", flush=True)
    if args.audit:
        started = timestamp()
        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for index, result in enumerate(pool.map(audit_camera, cameras), 1):
                results.append(result)
                if index % 100 == 0 or index == len(cameras):
                    print(f"Image audit: {index}/{len(cameras)}", flush=True)
        counts = {state: sum(item["imageStatus"] == state for item in results) for state in ("available", "disabled", "unavailable")}
        audit = {"startedAt": started, "completedAt": timestamp(), "source": OFFICIAL_PAGE, "method": "One GET per public image URL, four concurrent workers, 20-second timeout; JPEG signature and SOF dimensions validated. Known visually verified placeholder/blank-image hashes are rejected. Does not establish image age or detect every possible source fault.", "total": len(results), "counts": counts, "cameras": results}
        write_json(output / "source-audit.json", audit)
        lookup = {item["id"]: item for item in results}
        for camera in cameras:
            result = lookup[camera["id"]]
            camera.update({key: result[key] for key in ("imageStatus", "httpStatus", "checkedAt")})
            camera["isPlaceholder"] = result.get("isPlaceholder", False)
            if result.get("error"):
                camera["statusReason"] = result["error"]
            camera["imageWidth"] = result.get("width")
            camera["imageHeight"] = result.get("height")
        catalog["auditCompletedAt"] = audit["completedAt"]
        catalog["auditCounts"] = counts
        write_json(output / "camera-catalog.json", catalog)
        print(json.dumps(counts), flush=True)


if __name__ == "__main__":
    main()
