#!/usr/bin/env python3
"""Match unclassified camera coordinates to official TxDOT county polygons.

Only writes county-overrides.json. Existing catalog classifications are preserved.
Uses polygon boundaries, not county centroids or nearest places. Unmatched or
ambiguous points remain unresolved rather than receiving a guessed county.
Use --boundaries to reuse a previously downloaded official GeoJSON response.
"""

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SOURCE_URL = "https://maps.dot.state.tx.us/arcgis/rest/services/Boundaries/MapServer/1"
QUERY_URL = SOURCE_URL + "/query?" + urlencode({
    "where": "1=1",
    "outFields": "CNTY_NM,FIPS_NBR,DIST_NBR",
    "returnGeometry": "true",
    "outSR": "4326",
    "f": "geojson",
    "geometryPrecision": "5",
})
ROOT = Path(__file__).resolve().parents[1]
UNKNOWN_COUNTIES = (None, "", "Unspecified county", "Unknown county")


def in_ring(x, y, ring):
    """Ray casting, including points exactly on an edge within rounding tolerance."""
    inside = False
    for first, second in zip(ring, ring[1:] + ring[:1]):
        x1, y1 = first[:2]
        x2, y2 = second[:2]
        cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
        if abs(cross) < 1e-12 and min(x1, x2) - 1e-10 <= x <= max(x1, x2) + 1e-10 and min(y1, y2) - 1e-10 <= y <= max(y1, y2) + 1e-10:
            return True
        if (y1 > y) != (y2 > y):
            if x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside


def in_polygon(x, y, rings):
    return bool(rings) and in_ring(x, y, rings[0]) and not any(in_ring(x, y, hole) for hole in rings[1:])


def geometry_parts(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError("Expected Polygon or MultiPolygon county geometry")


def county_name(raw_name):
    """Preserve TxDOT's mixed case, including McCulloch, McLennan, and McMullen."""
    name = str(raw_name).strip()
    special = {
        "DE WITT": "DeWitt",
        "DEWITT": "DeWitt",
        "MCCULLOCH": "McCulloch",
        "MCLENNAN": "McLennan",
        "MCMULLEN": "McMullen",
    }
    return special.get(name.upper(), name.title() if name.isupper() else name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "dist/camera-catalog.json")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/county-overrides.json")
    parser.add_argument("--boundaries", type=Path, help="Local official TxDOT county GeoJSON; otherwise fetch the public service")
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text())
    if args.boundaries:
        counties = json.loads(args.boundaries.read_text())
    else:
        request = Request(QUERY_URL, headers={"User-Agent": "TexasCameraDesk/1.0 (county boundary enrichment)"})
        with urlopen(request, timeout=60) as response:
            counties = json.load(response)
    if counties.get("type") != "FeatureCollection" or len(counties.get("features", [])) != 254:
        raise ValueError("Official county service did not return all 254 Texas counties")
    if counties.get("exceededTransferLimit"):
        raise ValueError("County boundary response was truncated")

    prepared = []
    county_names = set()
    for feature in counties["features"]:
        name = county_name(feature["properties"]["CNTY_NM"])
        if not name or name in county_names:
            raise ValueError("County boundary response contains a missing or duplicate county name")
        county_names.add(name)
        for rings in geometry_parts(feature["geometry"]):
            if not rings or not rings[0]:
                raise ValueError("Empty county polygon")
            xs = [p[0] for p in rings[0]]
            ys = [p[1] for p in rings[0]]
            if not all(math.isfinite(value) for value in xs + ys) or not (-107 < min(xs) <= max(xs) < -93 and 25 < min(ys) <= max(ys) < 37):
                raise ValueError("Unexpected Texas coordinate bounds; refusing to assume WGS84")
            prepared.append((name, (min(xs), min(ys), max(xs), max(ys)), rings))

    targets = [camera for camera in catalog["cameras"] if camera.get("county") in UNKNOWN_COUNTIES]
    overrides = {}
    unresolved = []
    for camera in targets:
        lon, lat = camera.get("lon"), camera.get("lat")
        if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)) or not math.isfinite(lon) or not math.isfinite(lat) or not (-107 < lon < -93 and 25 < lat < 37):
            unresolved.append({"id": str(camera["id"]), "reason": "Invalid Texas coordinates"})
            continue
        matches = set()
        for name, bounds, rings in prepared:
            if bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3] and in_polygon(lon, lat, rings):
                matches.add(name)
        if len(matches) == 1:
            overrides[str(camera["id"])] = {"county": matches.pop(), "source": SOURCE_URL}
        else:
            unresolved.append({"id": str(camera["id"]), "reason": "No polygon match" if not matches else "Multiple county boundary matches", "matches": sorted(matches), "lat": lat, "lon": lon})

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "catalogFetchedAt": catalog.get("fetchedAt"),
        "source": "TxDOT official Texas county boundaries",
        "sourceUrl": SOURCE_URL,
        "queryUrl": QUERY_URL,
        "method": "Point in TxDOT county polygons, requested in WGS84 (EPSG:4326) with five decimal coordinate precision; existing catalog counties unchanged",
        "boundaryCountyCount": 254,
        "candidateCount": len(targets),
        "assignedCount": len(overrides),
        "overrides": overrides,
        "unresolved": unresolved,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"candidates": len(targets), "assigned": len(overrides), "unresolvedCount": len(unresolved), "unresolved": unresolved, "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
