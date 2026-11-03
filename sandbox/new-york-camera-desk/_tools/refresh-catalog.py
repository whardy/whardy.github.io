#!/usr/bin/env python3
"""Build a dated, public 511NY camera catalog and check its published media URLs."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

SOURCE = "https://api-511x-nysdot.carsprogram.org/cameras/map-features"
COUNTIES = "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Civil_Boundaries/FeatureServer/2/query"
BOROUGHS = {"New York": "Manhattan", "Kings": "Brooklyn", "Richmond": "Staten Island", "Bronx": "Bronx", "Queens": "Queens"}
AREAS = {
    "New York City": set(BOROUGHS),
    "Long Island": {"Nassau", "Suffolk"},
    "Hudson Valley": {"Westchester", "Rockland", "Putnam", "Dutchess", "Orange", "Ulster", "Sullivan"},
    "Capital Region": {"Albany", "Rensselaer", "Schenectady", "Saratoga", "Columbia", "Greene", "Washington", "Warren", "Montgomery", "Fulton", "Schoharie"},
    "Central New York": {"Onondaga", "Oneida", "Madison", "Cayuga", "Oswego", "Cortland", "Herkimer"},
    "Finger Lakes": {"Monroe", "Ontario", "Wayne", "Seneca", "Yates", "Livingston", "Genesee", "Orleans", "Wyoming"},
    "Western New York": {"Erie", "Niagara", "Chautauqua", "Cattaraugus", "Allegany"},
    "Southern Tier": {"Broome", "Tioga", "Chemung", "Steuben", "Schuyler", "Tompkins", "Delaware", "Otsego", "Chenango"},
    "North Country": {"Jefferson", "Lewis", "St Lawrence", "Franklin", "Clinton", "Essex", "Hamilton"},
}
CORRIDORS = [
    (r"\b(?:FDR|Franklin D Roosevelt)\b", "FDR Drive"),
    (r"\b(?:BQE|Brooklyn Queens Expy|Brooklyn-Queens Expressway)\b", "BQE / I-278"),
    (r"\b(?:LIE|Long Island Expy|Long Island Expressway)\b", "LIE / I-495"),
    (r"\b(?:Cross Bronx|CBX)\b", "Cross Bronx / I-95"),
    (r"\b(?:Belt Pkwy|Belt Parkway)\b", "Belt Parkway"),
    (r"\b(?:Grand Central Pkwy|Grand Central Parkway|GCP)\b", "Grand Central Parkway"),
    (r"\b(?:Staten Island Expy|SIE)\b", "Staten Island / I-278"),
    (r"\b(?:West Side Hwy|West Side Highway|Henry Hudson Pkwy)\b", "West Side / Henry Hudson"),
    (r"\b(?:Major Deegan|Deegan Expy)\b", "Major Deegan / I-87"),
    (r"\b(?:Van Wyck|VWE)\b", "Van Wyck / I-678"),
]


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def request(url, limit=5_000_000):
    headers = {"User-Agent": "Mozilla/5.0 (public camera catalog check)", "Origin": "https://whardy.github.io"}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=18) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("response exceeded expected size")
        return response.status, response.headers, data


def in_ring(x, y, ring):
    inside = False
    last = len(ring) - 1
    for index, (xi, yi) in enumerate(ring):
        xj, yj = ring[last]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        last = index
    return inside


def in_polygon(x, y, geometry):
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    return any(in_ring(x, y, rings[0]) and not any(in_ring(x, y, hole) for hole in rings[1:]) for rings in polygons)


def prepared_counties(features):
    items = []
    for feature in features:
        points = []
        def flatten(value):
            if isinstance(value[0], (int, float)):
                points.append(value)
            else:
                for part in value:
                    flatten(part)
        flatten(feature["geometry"]["coordinates"])
        xs, ys = [point[0] for point in points], [point[1] for point in points]
        items.append((feature["properties"]["NAME"], feature["geometry"], (min(xs), max(xs), min(ys), max(ys))))
    return items


def county_for(lon, lat, counties):
    for name, geometry, (west, east, south, north) in counties:
        if west <= lon <= east and south <= lat <= north and in_polygon(lon, lat, geometry):
            return name
    return None


def road_for(properties):
    route = re.sub(r"\s+", " ", str(properties.get("route") or "")).strip()
    route = re.sub(r"^I[ -]+(\d{1,3})$", r"I-\1", route, flags=re.I)
    name = str(properties.get("name") or "")
    if properties.get("cameraOwner") == "NYC DOT":
        for pattern, label in CORRIDORS:
            if re.search(pattern, name, re.I):
                return label
        return "City streets & crossings"
    if not route or route.lower() == "unknown":
        for pattern, label in CORRIDORS:
            if re.search(pattern, name, re.I):
                return label
        match = re.search(r"\b(?:I[- ]\d{1,3}|US[- ]\d{1,3}|NY[- ]\d{1,3}[A-Z]?)\b", name, re.I)
        if match:
            inferred = match.group(0).upper().replace("-", " ")
            return re.sub(r"^I (\d{1,3})$", r"I-\1", inferred)
        return "Other roads"
    if re.fullmatch(r"\d{3}[A-Z]", route):
        return "Parkways & expressways"
    return route


def clean_source(features, counties):
    cameras, excluded = [], []
    for feature in features:
        properties = feature["properties"]
        if properties.get("public") is not True:
            excluded.append({"id": properties.get("id"), "reason": "not public"})
            continue
        try:
            lon, lat = map(float, feature["geometry"]["coordinates"])
        except (ValueError, TypeError, KeyError):
            excluded.append({"id": properties.get("id"), "reason": "invalid coordinate"})
            continue
        county = county_for(lon, lat, counties)
        if not county:
            excluded.append({"id": properties.get("id"), "reason": "outside New York county polygons or invalid coordinate"})
            continue
        area = next((name for name, names in AREAS.items() if county in names), None)
        if not area:
            raise ValueError(f"Unassigned New York county: {county}")
        views = properties.get("views") or []
        for index, view in enumerate(views):
            media = urllib.parse.urlparse(view.get("url") or "")
            image = urllib.parse.urlparse(view.get("videoPreviewUrl") or view.get("url") or "")
            if media.scheme != "https" or image.scheme != "https":
                excluded.append({"id": properties.get("id"), "reason": "missing HTTPS feed"})
                continue
            camera_id = str(properties["id"])
            cameras.append({
                "id": camera_id if len(views) == 1 else f"{camera_id}:{index + 1}",
                "sourceId": camera_id,
                "name": str(view.get("name") or properties.get("name") or "Traffic camera").strip(),
                "lat": round(lat, 7), "lon": round(lon, 7),
                "county": BOROUGHS.get(county, county), "sourceCounty": county,
                "metro": area, "road": road_for(properties),
                "provider": properties.get("cameraOwner") or "511NY",
                "type": "video" if view.get("type") == "WMP" else "snapshot",
                "imageUrl": image.geturl(),
                "videoUrl": media.geturl() if view.get("type") == "WMP" else None,
                "officialUrl": f"https://511ny.org/camera/{camera_id}",
                "imageStatus": "unchecked", "videoStatus": "unchecked" if view.get("type") == "WMP" else "none",
            })
    return cameras, excluded


def valid_image(data):
    return data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n") or data[:6] in (b"GIF87a", b"GIF89a")


def check_feed(camera):
    result = {"id": camera["id"], "image": "unknown", "video": "none", "imageHttp": None, "videoHttp": None}
    try:
        status, headers, data = request(camera["imageUrl"], limit=8_000_000)
        result["imageHttp"] = status
        result["image"] = "available" if valid_image(data) and headers.get_content_type().startswith("image/") else "unavailable"
        result["imageBytes"] = len(data)
    except urllib.error.HTTPError as error:
        result["imageHttp"] = error.code
        result["image"] = "unavailable"
    except Exception as error:
        result["imageError"] = type(error).__name__
    if camera["videoUrl"]:
        result["video"] = "unknown"
        try:
            status, headers, data = request(camera["videoUrl"], limit=100_000)
            result["videoHttp"] = status
            result["video"] = "available" if data.startswith(b"#EXTM3U") and (b"#EXT-X-STREAM-INF" in data or b"#EXTINF" in data) and headers.get("Access-Control-Allow-Origin") in ("*", "https://whardy.github.io") else "unavailable"
        except urllib.error.HTTPError as error:
            result["videoHttp"] = error.code
            result["video"] = "unavailable"
        except Exception as error:
            result["videoError"] = type(error).__name__
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--audit", action="store_true", help="GET each published image and HLS playlist, with six workers")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    _, _, source_data = request(SOURCE)
    source = json.loads(source_data)
    query = urllib.parse.urlencode({"where": "1=1", "outFields": "NAME", "outSR": "4326", "f": "geojson"})
    _, _, county_data = request(f"{COUNTIES}?{query}", limit=12_000_000)
    county_source = json.loads(county_data)
    counties = prepared_counties(county_source["features"])
    if len(counties) != 62:
        raise ValueError(f"Expected 62 New York counties, received {len(counties)}")
    cameras, excluded = clean_source(source["features"], counties)
    if len(cameras) < 2500:
        raise ValueError(f"Source catalog unexpectedly small: {len(cameras)}")
    fetched = now()
    audit = None
    if args.audit:
        checked = []
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = {pool.submit(check_feed, camera): camera for camera in cameras}
            for number, future in enumerate(as_completed(futures), 1):
                checked.append(future.result())
                if number % 250 == 0 or number == len(cameras):
                    print(f"Checked {number}/{len(cameras)} feeds", flush=True)
        by_id = {entry["id"]: entry for entry in checked}
        for camera in cameras:
            media = by_id[camera["id"]]
            camera["imageStatus"] = media["image"]
            camera["videoStatus"] = media["video"]
        audit = {"checkedAt": now(), "source": SOURCE, "imageCounts": dict(Counter(c["imageStatus"] for c in cameras)), "videoCounts": dict(Counter(c["videoStatus"] for c in cameras if c["videoUrl"])), "entries": sorted(checked, key=lambda item: item["id"])}
        (args.output / "source-audit.json").write_text(json.dumps(audit, separators=(",", ":")) + "\n")
    catalog = {
        "source": SOURCE, "countySource": COUNTIES, "fetchedAt": fetched,
        "sourceFeatureCount": len(source["features"]), "excludedFeatureCount": len(excluded),
        "excluded": excluded, "cameraCount": len(cameras),
        "auditCompletedAt": audit["checkedAt"] if audit else None,
        "auditCounts": audit["imageCounts"] if audit else None,
        "videoAuditCounts": audit["videoCounts"] if audit else None,
        "cameras": cameras,
    }
    (args.output / "camera-catalog.json").write_text(json.dumps(catalog, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"Wrote {len(cameras)} camera views from {len(source['features'])} public map features; {len(excluded)} locations excluded")


if __name__ == "__main__":
    main()
