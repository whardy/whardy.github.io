#!/usr/bin/env python3
"""Build Texas camera metadata from public TxDOT ITS and City of Austin sources.

TxDOT returns snapshots as base64 JPEG inside JSON without CORS. Non-Houston
rows use the site's owned relay; Houston rows open on the official provider site.
Austin's public-domain inventory provides normal public JPEG image URLs.
No signed video URLs, access tokens, or internal camera addresses are retained.
"""
from __future__ import annotations
import argparse
import base64
import concurrent.futures
import datetime as dt
import gzip
import email.utils
import hashlib
import json
from pathlib import Path
import re
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://its.txdot.gov/its"
DISTRICTS = {
    "ABL": "Abilene", "AMA": "Amarillo", "ATL": "Atlanta / Texarkana",
    "AUS": "Austin", "BMT": "Beaumont / Port Arthur", "BWD": "Brownwood / Eastland",
    "BRY": "Bryan / College Station", "CHS": "Childress", "CRP": "Corpus Christi",
    "DAL": "Dallas", "ELP": "El Paso", "FTW": "Fort Worth", "HOU": "Houston",
    "LRD": "Laredo / Del Rio", "LBB": "Lubbock", "LFK": "Lufkin / Nacogdoches",
    "ODA": "Midland / Odessa", "PAR": "Paris", "PHR": "Rio Grande Valley / Pharr",
    "SJT": "San Angelo", "SAT": "San Antonio", "TYL": "Tyler / Longview",
    "WAC": "Waco / Temple / Killeen", "WFS": "Wichita Falls", "YKM": "Victoria / Yoakum",
}
AUSTIN_URL = "https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=5000"
AUSTIN_PAGE = "https://data.austintexas.gov/Transportation-and-Mobility/Traffic-Cameras/b4k4-adkb"
OFFICIAL_PAGE = "https://www.txdot.gov/discover/live-traffic-cameras.html"
USER_AGENT = "TexasCameraDesk/1.0 (public traffic camera directory)"
OUT = Path(__file__).resolve().parents[1] / "dist"
# Populated only after visual inspection; audit never assumes HTTP 200 is a feed.
KNOWN_PLACEHOLDER_HASHES = {
    "db8d3ffca668cac202fd73df14bcc10e703b22f166903e8ff9937998d963e08e": "City of Austin Image Unavailable placeholder",
    "25a6512096eabd8460d3eaf13021f78cbc8be6183f79ba83fb8ea6ef0d999354": "Visually verified TxDOT blank or camera-error frame",
    "dc4ea08b78c8829ef99617421bf3061001e354fd648d2ef7542745bd4430ac1f": "Visually verified TxDOT blank or camera-error frame",
    "909d5ed97ee4efce5ce9ff0a432c8cfc8599468bd1f360f40e2c190fc038c9fa": "Visually verified TxDOT blank or camera-error frame",
    "7b7bdd9bb7569c9f45461760d79f5fcbcce9be849b9409ac2cc0ad7e337cf095": "Visually verified TxDOT blank or camera-error frame",
    "1168140c261ceaa5534384009162fb62b99aa59b123f4c013976af5630085a88": "Visually verified TxDOT blank or camera-error frame",
    "929706393f10d0eb60ff19cabafdeaa8e76c9e208509f7daebf03a028126dd45": "Visually verified TxDOT blank or camera-error frame",
    "c6cd9d84b166ef139925b88fbb1ab8a7c4fe0c137e27f6678799b0ced1c78591": "Visually verified TxDOT blank or camera-error frame",
    "8225fd55d53ea748e995c18d66333ad216f7e1c901d9ea2b9d32ffaf5b3a7251": "Visually verified TxDOT blank or camera-error frame",
    "502ca71e653fd086a1eef0fa0090931bcb1115b1955349c721551dc33983aaf2": "Visually verified TxDOT blank or camera-error frame",
    "b75a47417e0df1a848dca891703048ec26d7867800ce754707064df5afd47ba9": "Visually verified TxDOT blank or camera-error frame",
    "77e39dbaedfbfa720e603b90f9cfba916db152b0ba1074ad84bcd65887c2cc51": "Visually verified TxDOT blank or camera-error frame",
    "2f729e2ee63372896abbedb352a9d609d046c8c38d79fea0563ab52ec440c2d6": "Visually verified TxDOT blank or camera-error frame",
    "720264fab9282a04547999f6fcadf2fad01fe1522ea36b21a0a0a7d24c08a0f3": "Visually verified TxDOT camera-error or no-signal frame",
    "5a21d12f6bd1fc2c7857e8d40f199f3438b9e0a754e1c68dcf12035c71d77c46": "Visually verified TxDOT camera-error or no-signal frame",
    "0380ad4f84067f1e14512c42f739b8f5e262907080d09202ae6ee1d0d0ff844e": "Visually verified TxDOT camera-error or no-signal frame",
    "c442425df0044aceb4931c7790acaec11d40edfe8fd4ea43db5dfebce64fc548": "Visually verified TxDOT camera-error or no-signal frame",
    "4f05fa9b676b7e1f3aa32a0dd9389da381d9957992018ea3bc5ee1458d401624": "Visually verified TxDOT camera-error or no-signal frame",
    "2fd295e9e26e16f24a4249d9d9b5fe967809836df16215b8fa04b88a729889d2": "Visually verified TxDOT camera-error or no-signal frame",
    "32db37d6c971430297475d8410778f69b143c735c9e7ff51a68e16f6ec0eff2d": "Visually verified TxDOT camera-error or no-signal frame",
    "94488cbea8c793a01f6c73cdfd83ad952d08de9ebf072da7a240558b9e50fd71": "Visually verified TxDOT camera-error or no-signal frame",
    "519a7f9023532405d7766663634a851eb305c491ccac3dfd80dd1fb5e6787dc0": "Visually verified TxDOT camera-error or no-signal frame",
    "4eee599459a7fe41d2e4c95f709b904931332983583b837bf154d3505683302f": "Visually verified TxDOT camera-error or no-signal frame",
    "aca297d4ff8dd72a28f147a65b4c3ea60c2687f8e1f6afd1d5d0f483c5406dd2": "Visually verified TxDOT camera-error or no-signal frame",
    "3c49cb38bde9fcd5b7219a3aefb97002f720853b8435cd0c7b1d44c8612e26ef": "Visually verified TxDOT camera-error or no-signal frame",
    "568a41447f1a10129e439c60e2af9652f79929456aa9316565e692650f8e53d9": "Visually verified TxDOT camera-error or no-signal frame",
    "4822c0c867b2807d4db84fb670a4fdd1c8061e38419cdc110221099475fb3bad": "Visually verified TxDOT camera-error or no-signal frame",
    "90c70722a9f3c100f44bf01e0b90c2723c92aac6f2c00d81dea43b7080911c93": "Visually verified TxDOT camera-error or no-signal frame"
}


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url, timeout=20, max_bytes=10_000_000):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ValueError("Response exceeds expected size")
        if body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)
        return response.status, {k.lower(): v for k, v in response.headers.items()}, body


def normalized_road(value):
    value = " ".join((value or "Unspecified road").split()).strip()
    value = re.sub(r"^IH[- ]?(\d+[A-Z]?)", r"I-\1", value, flags=re.I)
    value = re.sub(r"^(US|SH|FM|RM|LP|SL|SP|PR|RR)[- ]?(\d+[A-Z]?)", r"\1-\2", value, flags=re.I)
    return value


def coordinates(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
        return (lat, lon) if 25.7 < lat < 36.6 and -106.7 < lon < -93.4 else (None, None)
    except (TypeError, ValueError):
        return None, None


def district_url(code):
    return BASE + "/District/" + code + "/cameras"


def get_district(code):
    url = BASE + "/DistrictIts/GetCctvStatusListByDistrict?" + urllib.parse.urlencode({"districtCode": code})
    _, _, body = fetch(url)
    data = json.loads(body)
    if not isinstance(data.get("roadwayCctvStatuses"), dict):
        raise ValueError(f"Unexpected TxDOT catalog for {code}")
    rows = [row for values in data["roadwayCctvStatuses"].values() for row in values]
    return code, rows


def normalize_txdot(code, rows):
    cameras = []
    for row in rows:
        identity = row["netId"] + ":" + row["icd_Id"]
        ident = "txdot-" + code.lower() + "-" + hashlib.sha256(identity.encode()).hexdigest()[:16]
        lat, lon = coordinates(row.get("latitude"), row.get("longitude"))
        snapshot_url = BASE + "/DistrictIts/GetCctvSnapshotByIcdId?" + urllib.parse.urlencode({"icdId": row["icd_Id"], "districtCode": code})
        disabled = row.get("statusDescription") != "Device Online"
        cameras.append({
            "id": ident, "siteId": ident, "name": row.get("name") or row["icd_Id"],
            "lat": lat, "lon": lon, "hasValidCoordinates": lat is not None,
            "road": normalized_road((row.get("equipLoc") or {}).get("roadway")),
            "county": "Unspecified county", "region": DISTRICTS[code], "metro": DISTRICTS[code],
            "district": code, "provider": "TxDOT ITS", "direction": row.get("dirDescription") or "",
            "imageUrl": None, "snapshotApiUrl": snapshot_url, "videoUrl": None,
            "officialUrl": district_url(code), "disabled": disabled,
            "imageStatus": "official-only" if code == "HOU" else "unchecked", "embedMode": "official" if code == "HOU" else "relay",
            "sourceStatus": row.get("statusDescription") or "Unknown",
            "videoAvailableOnOfficial": False,
            "statusReason": "Open Houston cameras on the official provider site." if code == "HOU" else "",
        })
    return cameras


def normalize_austin(rows):
    cameras = []
    for row in rows:
        if row.get("camera_status") != "TURNED_ON":
            continue
        url = row.get("screenshot_address") or ""
        if not re.fullmatch(r"https://cctv\.austinmobility\.io/image/\d+\.jpg", url):
            continue
        ident = "austin-" + row["camera_id"]
        point = (row.get("location") or {}).get("coordinates", [])
        lat, lon = coordinates(point[1], point[0]) if len(point) == 2 else (None, None)
        cameras.append({
            "id": ident, "siteId": ident, "name": (row.get("location_name") or f"Austin camera {row['camera_id']}").strip(),
            "lat": lat, "lon": lon, "hasValidCoordinates": lat is not None,
            "road": normalized_road(row.get("primary_st")), "crossStreet": (row.get("cross_st") or "").strip(),
            "county": "Unspecified county", "region": "Austin", "metro": "Austin",
            "district": "AUS", "provider": "City of Austin", "direction": "",
            "imageUrl": url, "videoUrl": None, "officialUrl": "https://cctv.austinmobility.io/",
            "disabled": False, "imageStatus": "unchecked", "embedMode": "image",
            "sourceStatus": "Turned on", "videoAvailableOnOfficial": False,
            "inventoryUrl": AUSTIN_PAGE,
        })
    return cameras


def jpeg_size(data):
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
    url = camera.get("imageUrl") or camera.get("snapshotApiUrl")
    result = {"id": camera["id"], "checkedAt": timestamp(), "httpStatus": None,
              "embedMode": camera["embedMode"], "sourceImageStatus": "unavailable"}
    try:
        status, headers, body = fetch(url, max_bytes=4_000_000)
        result.update({"httpStatus": status, "contentType": headers.get("content-type", ""),
                       "cors": headers.get("access-control-allow-origin"), "lastModified": headers.get("last-modified")})
        if camera.get("snapshotApiUrl"):
            if "application/json" not in result["contentType"]:
                raise ValueError("Snapshot response is not JSON")
            payload = json.loads(body)
            if not payload or not payload.get("snippet"):
                raise ValueError("Provider supplied no snapshot")
            body = base64.b64decode(payload["snippet"], validate=True)
            result["sourceTimestamp"] = payload.get("timestampFormatted")
        elif "image/jpeg" not in result["contentType"]:
            raise ValueError("Response is not image/jpeg")
        digest = hashlib.sha256(body).hexdigest()
        result.update({"bytes": len(body), "sha256": digest})
        if digest in KNOWN_PLACEHOLDER_HASHES:
            result.update({"isPlaceholder": True, "error": KNOWN_PLACEHOLDER_HASHES[digest]})
            return result
        width, height = jpeg_size(body)
        result.update({"width": width, "height": height, "isPlaceholder": False,
                       "sourceImageStatus": "disabled" if camera["disabled"] else "available"})
        if result.get("lastModified"):
            age = (dt.datetime.now(dt.timezone.utc) - email.utils.parsedate_to_datetime(result["lastModified"])).total_seconds()
            result["sourceAgeSeconds"] = max(0, round(age))
            if age > 3600:
                result["sourceImageStatus"] = "stale"
                result["error"] = "Provider Last-Modified is over one hour old"
        # Keep small temporary audit samples for visual placeholder inspection.
        # They are never included in the website.
        sample_path = Path("/tmp/texas-camera-audit-samples")
        sample_path.mkdir(exist_ok=True)
        if len(body) < 35_000:
            (sample_path / (digest + ".jpg")).write_bytes(body)
    except urllib.error.HTTPError as error:
        result.update({"httpStatus": error.code, "error": f"HTTP {error.code}"})
    except Exception as error:
        result["error"] = str(error)[:180]
    return result


def write_json(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", action="store_true", help="One GET per inline Austin image with at most four workers")
    parser.add_argument("--output", type=Path, default=OUT)
    parser.add_argument("--audit-txdot", action="store_true", help="Also audit non-Houston TxDOT JSON snapshots")
    parser.add_argument("--resume-audit", action="store_true", help="Reuse existing audit rows by ID, useful when extending an audit to another provider")
    args = parser.parse_args()
    cameras = []
    district_counts = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for code, rows in pool.map(get_district, DISTRICTS):
            district_counts[code] = len(rows)
            cameras.extend(normalize_txdot(code, rows))
            print(f"TxDOT {code}: {len(rows)} cameras", flush=True)
    _, _, body = fetch(AUSTIN_URL)
    austin = normalize_austin(json.loads(body))
    cameras.extend(austin)
    if len(cameras) < 4000 or len({c["id"] for c in cameras}) != len(cameras):
        raise ValueError("Unexpectedly small or duplicate catalog; refusing to replace existing data")
    overrides_path = args.output / "county-overrides.json"
    if overrides_path.exists():
        overrides = json.loads(overrides_path.read_text())
        if isinstance(overrides, dict) and "overrides" in overrides:
            overrides = overrides["overrides"]
        if isinstance(overrides, dict):
            for camera in cameras:
                value = overrides.get(camera["id"])
                if isinstance(value, dict):
                    value = value.get("county")
                if isinstance(value, str):
                    camera["county"] = value
    # The same snapshot can be listed under two network IDs/roadway groups.
    # Keep one card per actual public image endpoint, preserving distinct views.
    unique = {}
    for camera in cameras:
        key = camera.get("imageUrl") or camera.get("snapshotApiUrl")
        if key not in unique or camera["id"] < unique[key]["id"]:
            unique[key] = camera
    cameras = list(unique.values())
    district_counts = {code: sum(c["district"] == code and c["provider"] == "TxDOT ITS" for c in cameras) for code in DISTRICTS}
    cameras.sort(key=lambda c: (c["metro"], c["provider"], c["road"], c["name"], c["id"]))
    catalog = {"fetchedAt": timestamp(), "source": "TxDOT ITS and City of Austin", "sourceUrl": OFFICIAL_PAGE,
               "siteCount": len(cameras), "viewCount": len(cameras), "cameras": cameras,
               "districtCounts": district_counts, "inlineCameraCount": len(austin), "officialOnlyCount": district_counts["HOU"], "relayCameraCount": len(cameras)-len(austin)-district_counts["HOU"],
               "notes": [
                   "Camera metadata is obtained from all 25 official public TxDOT ITS district camera catalogs and the City of Austin public-domain traffic-camera inventory.",
                   "TxDOT snapshots use an owned relay to decode the official base64 JPEG response. Houston cameras open on the official provider site.",
                   "City of Austin cameras marked TURNED_ON with explicit public image URLs are shown inline. Their JPEGs refresh while the page is open; they are snapshots, not continuous video.",
                   "No signed video URLs, private device addresses, access tokens, or proxy credentials are copied into this catalog.",
                   "Source checks are a point-in-time check of snapshot responses, not proof of image freshness or a guarantee of future availability.",
               ]}
    args.output.mkdir(parents=True, exist_ok=True)
    write_json(args.output / "camera-catalog.json", catalog)
    print(f"Saved {len(cameras)} cameras, {len(austin)} with inline image URLs", flush=True)
    if args.audit:
        started = timestamp()
        existing = {}
        audit_path = args.output / "source-audit.json"
        if args.resume_audit and audit_path.exists():
            existing = {r["id"]: r for r in json.loads(audit_path.read_text())["cameras"]}
            for result in existing.values():
                if result.get("sha256") in KNOWN_PLACEHOLDER_HASHES:
                    result.update({"isPlaceholder": True, "sourceImageStatus": "unavailable", "error": KNOWN_PLACEHOLDER_HASHES[result["sha256"]]})
                elif result.get("lastModified"):
                    age = (dt.datetime.now(dt.timezone.utc) - email.utils.parsedate_to_datetime(result["lastModified"])).total_seconds()
                    result["sourceAgeSeconds"] = max(0, round(age))
                    if age > 3600:
                        result.update({"sourceImageStatus": "stale", "error": "Provider Last-Modified is over one hour old"})
        targets = [c for c in cameras if c["embedMode"] in ("image", "relay")] if args.audit_txdot else [c for c in cameras if c["embedMode"] == "image"]
        results = [existing[c["id"]] for c in targets if c["id"] in existing]
        audit_targets = [c for c in targets if c["id"] not in existing]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for index, result in enumerate(pool.map(audit_camera, audit_targets), 1):
                results.append(result)
                if index % 100 == 0 or index == len(audit_targets):
                    print(f"Snapshot audit: {index}/{len(audit_targets)}", flush=True)
        counts = {state: sum(r["sourceImageStatus"] == state for r in results) for state in ("available", "stale", "disabled", "unavailable")}
        inline_counts = {state: sum(r["sourceImageStatus"] == state and r["embedMode"] == "image" for r in results) for state in counts}
        relay_counts = {state: sum(r["sourceImageStatus"] == state and r["embedMode"] == "relay" for r in results) for state in counts}
        audit = {"startedAt": started, "completedAt": timestamp(), "source": OFFICIAL_PAGE,
                 "method": "One GET per audited public snapshot endpoint, four workers, 20-second timeout. TxDOT JSON base64 decoded; JPEG signature and dimensions validated. Known visually verified placeholders rejected. No video streams requested.",
                 "total": len(results), "scope": "Austin direct images and non-Houston TxDOT snapshots; Houston official-only" if args.audit_txdot else "inline Austin images only; TxDOT is metadata-only", "counts": counts, "inlineCounts": inline_counts, "relayCounts": relay_counts, "cameras": results}
        write_json(args.output / "source-audit.json", audit)
        lookup = {r["id"]: r for r in results}
        for camera in cameras:
            if camera["id"] not in lookup:
                continue
            result = lookup[camera["id"]]
            for key in ("sourceImageStatus", "httpStatus", "checkedAt", "sourceTimestamp", "lastModified", "sourceAgeSeconds"):
                if key in result:
                    camera[key] = result[key]
            if camera["embedMode"] in ("image", "relay"):
                camera["imageStatus"] = result["sourceImageStatus"]
            camera["isPlaceholder"] = result.get("isPlaceholder", False)
            camera["imageWidth"] = result.get("width")
            camera["imageHeight"] = result.get("height")
            if result.get("error"):
                camera["statusReason"] = result["error"]
        catalog.update({"auditCompletedAt": audit["completedAt"], "auditCounts": counts, "inlineAuditCounts": inline_counts, "relayAuditCounts": relay_counts, "auditScope": audit["scope"]})
        write_json(args.output / "camera-catalog.json", catalog)
        print(json.dumps({"allSources": counts, "inlineImages": inline_counts}), flush=True)


if __name__ == "__main__":
    main()
