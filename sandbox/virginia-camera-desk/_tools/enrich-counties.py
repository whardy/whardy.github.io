#!/usr/bin/env python3
"""Match all camera coordinates to Virginia's official county/city polygons.

The 511 jurisdiction field can name a VDOT operational region, so every camera
is independently located. Unmatched or ambiguous points are left unclassified;
no nearest-city guesses are made. Geometry is fetched at full resolution.
"""

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE_URL = "https://services.dwr.virginia.gov/arcgis/rest/services/Public/VA_Counties_Jurisdictions/MapServer/0"
QUERY_URL = SOURCE_URL + "/query?" + urlencode({
    "where": "1=1", "outFields": "NAMELSAD,STCOFIPS,JURISTYPE",
    "returnGeometry": "true", "outSR": "4326", "f": "geojson",
})
ROOT = Path(__file__).resolve().parents[1]


def in_ring(x, y, ring):
    """Ray casting, including exact edge points within floating-point tolerance."""
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
    raise ValueError("Expected Polygon or MultiPolygon locality geometry")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "dist/camera-catalog.json")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/county-overrides.json")
    parser.add_argument("--boundaries", type=Path, help="Optional saved response from the documented official query")
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text())
    if args.boundaries:
        boundaries = json.loads(args.boundaries.read_text())
    else:
        request = Request(QUERY_URL, headers={"User-Agent": "VirginiaCameraDesk/1.0 (locality boundary enrichment)"})
        with urlopen(request, timeout=90) as response:
            boundaries = json.load(response)
    if boundaries.get("type") != "FeatureCollection" or boundaries.get("exceededTransferLimit"):
        raise ValueError("Official locality service returned an invalid or truncated response")
    names = {f["properties"]["NAMELSAD"] for f in boundaries["features"]}
    fips_codes = {f["properties"]["STCOFIPS"] for f in boundaries["features"]}
    if len(names) != 133 or len(fips_codes) != 133 or any(not str(code).startswith("51") for code in fips_codes):
        raise ValueError("Official locality service did not return all 133 Virginia counties and independent cities")

    prepared = []
    for feature in boundaries["features"]:
        name = str(feature["properties"]["NAMELSAD"]).strip()
        fips = str(feature["properties"]["STCOFIPS"])
        if not name.endswith((" County", " City")):
            raise ValueError("Unexpected locality name without county/city distinction")
        for rings in geometry_parts(feature["geometry"]):
            xs = [p[0] for p in rings[0]]
            ys = [p[1] for p in rings[0]]
            if not xs or not (-84 < min(xs) <= max(xs) < -75 and 36 < min(ys) <= max(ys) < 40):
                raise ValueError("Unexpected geometry bounds; refusing to assume WGS84")
            prepared.append((name, fips, (min(xs), min(ys), max(xs), max(ys)), rings))

    overrides = {}
    unresolved = []
    for camera in catalog["cameras"]:
        lon, lat = camera.get("lon"), camera.get("lat")
        if type(lon) not in (int, float) or type(lat) not in (int, float) or not math.isfinite(lon) or not math.isfinite(lat) or not (-84 < lon < -75 and 36 < lat < 40):
            unresolved.append({"id": str(camera["id"]), "reason": "Invalid Virginia coordinates"})
            continue
        matches = set()
        for name, fips, bounds, rings in prepared:
            if bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3] and in_polygon(lon, lat, rings):
                matches.add((name, fips))
        if len(matches) == 1:
            name, fips = matches.pop()
            overrides[str(camera["id"])] = {"county": name, "fips": fips, "source": SOURCE_URL}
        else:
            unresolved.append({"id": str(camera["id"]), "reason": "No polygon match" if not matches else "Multiple locality boundary matches", "matches": [n for n, _ in sorted(matches)], "lat": lat, "lon": lon})

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "catalogFetchedAt": catalog.get("fetchedAt"),
        "source": "Virginia Geographic Information Network locality boundaries, hosted by Virginia Department of Wildlife Resources",
        "sourceUrl": SOURCE_URL, "queryUrl": QUERY_URL,
        "method": "Point in full-resolution VGIN county and independent city polygons in WGS84 (EPSG:4326); all camera coordinates classified independently of 511 operational regions",
        "boundaryLocalityCount": len(names), "boundaryFeatureCount": len(boundaries["features"]),
        "candidateCount": len(catalog["cameras"]), "assignedCount": len(overrides),
        "overrides": overrides, "unresolved": unresolved,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(output, indent=2) + "\n")
    temporary.replace(args.output)
    print(json.dumps({"candidates": len(catalog["cameras"]), "assigned": len(overrides), "unresolved": unresolved, "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
