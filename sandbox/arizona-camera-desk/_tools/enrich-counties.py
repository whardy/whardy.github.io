#!/usr/bin/env python3
"""Classify Arizona camera coordinates using official AZGEO county boundaries.

Only writes county-overrides.json; the original AZ511 catalog is untouched.
AZ511 county labels sometimes describe a wider source grouping. Every camera is
checked against polygons; only missing or different labels receive an override.
Unmatched or ambiguous locations remain unresolved rather than being guessed.
The ASLD layer is intended for planning and analysis, not engineering work.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://services6.arcgis.com/clPWQMwZfdWn4MQZ/ArcGIS/rest/services/counties/FeatureServer/0"
ITEM_URL = "https://www.arcgis.com/home/item.html?id=545fc0393f0747cb9665848a75f9b23c"
QUERY_URL = SOURCE_URL + "/query?" + urlencode({
    "where": "1=1", "outFields": "NAME,CODE", "returnGeometry": "true",
    "outSR": "4326", "f": "geojson", "geometryPrecision": "7",
})
COUNTIES = {
    "Apache", "Cochise", "Coconino", "Gila", "Graham", "Greenlee", "La Paz",
    "Maricopa", "Mohave", "Navajo", "Pima", "Pinal", "Santa Cruz", "Yavapai", "Yuma",
}


def in_ring(x, y, ring):
    inside = False
    for first, second in zip(ring, ring[1:] + ring[:1]):
        x1, y1 = first[:2]
        x2, y2 = second[:2]
        cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
        if abs(cross) < 1e-12 and min(x1, x2) - 1e-10 <= x <= max(x1, x2) + 1e-10 and min(y1, y2) - 1e-10 <= y <= max(y1, y2) + 1e-10:
            return True
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
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


def prepare_counties(data):
    if data.get("type") != "FeatureCollection" or len(data.get("features", [])) != 15 or data.get("exceededTransferLimit"):
        raise ValueError("Official boundary response must include all 15 Arizona counties")
    prepared, names = [], set()
    for feature in data["features"]:
        name = str(feature["properties"]["NAME"]).strip().title()
        if name not in COUNTIES or name in names:
            raise ValueError("Unexpected or duplicate Arizona county name")
        names.add(name)
        for rings in geometry_parts(feature["geometry"]):
            if not rings or any(len(ring) < 4 for ring in rings):
                raise ValueError("Missing or incomplete county polygon")
            for ring in rings:
                if not all(len(point) >= 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in point[:2]) and -115.1 < point[0] < -108.9 and 31.2 < point[1] < 37.1 for point in ring):
                    raise ValueError("Unexpected Arizona coordinate bounds; refusing to assume WGS84")
            xs, ys = [p[0] for p in rings[0]], [p[1] for p in rings[0]]
            prepared.append((name, (min(xs), min(ys), max(xs), max(ys)), rings))
    if names != COUNTIES:
        raise ValueError("County boundary response is incomplete")
    return prepared


def classify(cameras, prepared):
    overrides, unresolved, counts = {}, [], Counter()
    source_agreement = 0
    missing_count = 0
    for camera in cameras:
        ident = str(camera["id"])
        lon, lat = camera.get("lon"), camera.get("lat")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (lon, lat)):
            unresolved.append({"id": ident, "reason": "Missing or invalid coordinates"})
            continue
        matches = {name for name, bounds, rings in prepared if bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3] and in_polygon(lon, lat, rings)}
        if len(matches) != 1:
            unresolved.append({"id": ident, "reason": "No polygon match" if not matches else "Multiple county boundary matches", "matches": sorted(matches), "lat": lat, "lon": lon})
            continue
        county = matches.pop()
        counts[county] += 1
        source_county = str(camera.get("county") or "").strip()
        if source_county == county:
            source_agreement += 1
            continue
        if not source_county:
            missing_count += 1
        overrides[ident] = {"county": county, "sourceCounty": source_county, "lat": lat, "lon": lon}
    return overrides, unresolved, counts, source_agreement, missing_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "dist/camera-catalog.json")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/county-overrides.json")
    parser.add_argument("--boundaries", type=Path, help="Reuse a saved response from the official county GeoJSON query")
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text())
    cameras = catalog["cameras"]
    if not cameras or len({str(c["id"]) for c in cameras}) != len(cameras):
        raise ValueError("Expected a nonempty catalog with unique camera IDs")
    if args.boundaries:
        boundaries = json.loads(args.boundaries.read_text())
    else:
        request = Request(QUERY_URL, headers={"User-Agent": "ArizonaCameraDesk/1.0 (county boundary classification)"})
        with urlopen(request, timeout=60) as response:
            boundaries = json.load(response)
    prepared = prepare_counties(boundaries)
    overrides, unresolved, counts, agreement, missing = classify(cameras, prepared)
    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "catalogFetchedAt": catalog.get("fetchedAt"),
        "source": "Arizona State Land Department / AZGEO county boundaries",
        "sourceUrl": SOURCE_URL, "sourceItemUrl": ITEM_URL, "queryUrl": QUERY_URL,
        "method": "Point in all 15 official AZGEO county polygons, requested in WGS84 (EPSG:4326), seven decimal precision. Only missing or different labels are overridden; source labels remain in the original catalog and this evidence file.",
        "limitations": "Classifications follow AZ511 coordinates and ASLD boundaries, not a surveyed camera position. Exact boundary conflicts remain unresolved. For planning and browsing, not engineering use. Metro labels remain the original AZ511 area groupings.",
        "boundaryCountyCount": 15, "candidateCount": len(cameras),
        "matchedCount": sum(counts.values()), "sourceAgreementCount": agreement,
        "assignedCount": len(overrides), "missingFilledCount": missing,
        "changedSourceLabelCount": len(overrides) - missing,
        "countyCounts": dict(sorted(counts.items())),
        "overrides": dict(sorted(overrides.items())), "unresolved": unresolved,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({k: output[k] for k in ("candidateCount", "matchedCount", "sourceAgreementCount", "assignedCount", "missingFilledCount", "changedSourceLabelCount", "countyCounts", "unresolved")}, indent=2))


if __name__ == "__main__":
    main()
