#!/usr/bin/env python3
"""Refresh the authorized FL511 camera list and Trip Desk Florida shard.

The official list endpoint is paged and caps its responses at 100 rows. A
failed/incomplete refresh never replaces the last-known-good published shard.
No image or video is downloaded by this builder.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
REPO = HERE.parents[1]
TRIP_DATA = REPO / "sandbox/trip-camera-desk/data"
LIST_URL = "https://www.fl511.com/List/GetData/Cameras"
PUBLIC_SITE = "https://whardy.github.io/sandbox/florida-camera-desk/"
SOURCE_PAGE = "https://www.fl511.com/cctv"
PAGE_SIZE = 100
MAX_RECORDS = 7000
MAX_ATTEMPTS = 3
MIN_REQUEST_SPACING = 0.7
MEDIA_CHECK_MAX_AGE_DAYS = 7

# These are separate source groups in FL511, including partner and local feeds.
# The user confirmed public display scope for the groups listed here. A future
# refresh should change this allowlist if an agreement narrows that scope.
PROVIDERS = {
    "DIVAS-District 1": ("fdot-d1", "FDOT District 1"),
    "DIVAS-District 2": ("fdot-d2", "FDOT District 2"),
    "DIVAS-District 3-CHP": ("fdot-d3", "FDOT District 3"),
    "DIVAS-District 4": ("fdot-d4", "FDOT District 4"),
    "DIVAS-District 5": ("fdot-d5", "FDOT District 5"),
    "DIVAS-District 6": ("fdot-d6", "FDOT District 6"),
    "DIVAS-District 7": ("fdot-d7", "FDOT District 7"),
    "DIVAS-District I595": ("fdot-i595", "FL511 I-595 district feed"),
    "DIVAS-Turnpike SG C": ("turnpike", "Florida's Turnpike Enterprise"),
    "DIVAS-CFX": ("cfx", "Central Florida Expressway Authority"),
    "DIVAS-MDX": ("gmx-mdx", "Greater Miami Expressway Agency (MDX feed)"),
    "DIVAS-COT": ("cot", "City of Tallahassee (FL511 COT feed)"),
    "DIVAS-BCTD": ("bctd", "Broward County traffic cameras (FL511 BCTD feed)"),
}

CENTRAL_COUNTIES = {
    "Bay", "Calhoun", "Escambia", "Holmes", "Jackson", "Okaloosa",
    "Santa Rosa", "Walton", "Washington",
}
GULF_EASTERN_SOURCE_IDS = {"3858"}  # Cape San Blas, south of the federal split.
REGIONS = {
    "Panhandle": "Panhandle",
    "Northeast": "Northeast Florida",
    "Central": "Central Florida",
    "Tampa Bay": "Tampa Bay",
    "Southwest": "Southwest Florida",
    "Southeast": "Southeast Florida",
}
METROS = {
    "Escambia": "Pensacola & Emerald Coast", "Santa Rosa": "Pensacola & Emerald Coast",
    "Okaloosa": "Pensacola & Emerald Coast", "Walton": "Pensacola & Emerald Coast",
    "Bay": "Panama City area", "Leon": "Tallahassee area",
    "Gadsden": "Tallahassee area", "Wakulla": "Tallahassee area",
    "Duval": "Jacksonville area", "Clay": "Jacksonville area",
    "Nassau": "Jacksonville area", "St. Johns": "Jacksonville area",
    "Baker": "Jacksonville area", "Alachua": "Gainesville area",
    "Orange": "Orlando area", "Seminole": "Orlando area",
    "Osceola": "Orlando area", "Lake": "Orlando area",
    "Volusia": "Daytona Beach area", "Flagler": "Daytona Beach area",
    "Brevard": "Space Coast", "Hillsborough": "Tampa Bay metro",
    "Pinellas": "Tampa Bay metro", "Pasco": "Tampa Bay metro",
    "Manatee": "Sarasota & Bradenton", "Sarasota": "Sarasota & Bradenton",
    "Lee": "Fort Myers area", "Collier": "Naples area",
    "Palm Beach": "Palm Beach County", "Broward": "Fort Lauderdale area",
    "Miami-Dade": "Miami area", "Monroe": "Florida Keys",
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def media_check_status(value: str, checked_at: str | None, catalog_time: str) -> str:
    if value == "unchecked" or not checked_at:
        return value
    try:
        checked = dt.datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
        retrieved = dt.datetime.fromisoformat(catalog_time.replace("Z", "+00:00"))
        if checked.tzinfo is None or retrieved.tzinfo is None:
            return "stale"
        return "stale" if retrieved - checked > dt.timedelta(days=MEDIA_CHECK_MAX_AGE_DAYS) else value
    except (ValueError, TypeError):
        return "stale"


def compact_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def atomic_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as file:
        temp = Path(file.name)
        file.write(content)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temp, path)


def fetch_rows() -> tuple[list[dict], dict]:
    rows: list[dict] = []
    expected: int | None = None
    last_request = 0.0
    pages = []
    for start in range(0, MAX_RECORDS, PAGE_SIZE):
        delay = MIN_REQUEST_SPACING - (time.monotonic() - last_request)
        if delay > 0:
            time.sleep(delay)
        payload = {"draw": start // PAGE_SIZE + 1, "start": start, "length": PAGE_SIZE,
                   "search": {"value": "", "regex": False}, "order": [], "columns": []}
        request = urllib.request.Request(
            LIST_URL, data=json.dumps(payload).encode(), method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json",
                     "User-Agent": "FloridaCameraDesk/1.0 (dated catalog refresh)"},
        )
        for attempt in range(MAX_ATTEMPTS):
            try:
                last_request = time.monotonic()
                with urllib.request.urlopen(request, timeout=20) as response:
                    if response.status != 200 or "json" not in response.headers.get("Content-Type", ""):
                        raise ValueError(f"page {start}: invalid response")
                    page = json.load(response)
                break
            except (OSError, ValueError, json.JSONDecodeError) as error:
                if attempt + 1 == MAX_ATTEMPTS:
                    raise RuntimeError(f"page starting {start} failed after {MAX_ATTEMPTS} attempts: {error}") from error
                time.sleep(min(4, 1 + attempt * 1.5))
        total = page.get("recordsFiltered")
        if not isinstance(total, int) or not (1 <= total <= MAX_RECORDS):
            raise ValueError(f"invalid source record count: {total!r}")
        if expected is None:
            expected = total
        elif total != expected:
            raise ValueError(f"source count changed during paging: {expected} to {total}")
        batch = page.get("data")
        if not isinstance(batch, list) or not batch:
            raise ValueError(f"empty/invalid page at {start} of {expected}")
        if len(batch) > PAGE_SIZE or len(batch) != min(PAGE_SIZE, expected - start):
            raise ValueError(f"short or oversized page at {start}: {len(batch)} rows")
        rows.extend(batch)
        pages.append({"start": start, "rows": len(batch)})
        if len(rows) >= expected:
            break
    if expected is None or len(rows) != expected:
        raise ValueError(f"incomplete catalog: got {len(rows)} of {expected}")
    source_ids = [str(row.get("id")) for row in rows]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("duplicate FL511 parent IDs across pages; refusing refresh")
    return rows, {"sourceRowsReported": expected, "pages": pages, "sourceRetrievedAt": utc_now()}


def absolute_https(value: object, *, image: bool = False) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    url = urllib.parse.urlparse(urllib.parse.urljoin("https://www.fl511.com", value))
    if url.scheme != "https" or url.username or url.password or not url.netloc:
        return None
    host = (url.hostname or "").lower()
    if image and host != "www.fl511.com":
        return None
    if not image and host != "www.fl511.com" and not host.endswith(".divas.cloud"):
        return None
    if re.search(r"(?:token|secret|auth|key)=", url.query, re.I):
        return None
    return url.geturl()


def parse_coordinates(row: dict) -> tuple[float | None, float | None]:
    geography = (row.get("latLng") or {}).get("geography") or {}
    if geography.get("coordinateSystemId") != 4326:
        return None, None
    match = re.fullmatch(r"POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)",
                         str(geography.get("wellKnownText") or ""))
    if not match:
        return None, None
    lon, lat = map(float, match.groups())
    if not (-88.3 <= lon <= -79.7 and 24.0 <= lat <= 31.2):
        return None, None
    return lat, lon


def normalized_refs(text: str) -> list[str]:
    upper = text.upper().replace("–", "-").replace("—", "-")
    result: list[str] = []
    def add(value: str) -> None:
        if value not in result:
            result.append(value)
    for pattern, prefix in [
        (r"\b(?:INTERSTATE|I)[ -]?(\d{1,3}[A-Z]?)\b", "I-"),
        (r"\b(?:U\.?S\.?|US ROUTE|US HIGHWAY)[ -]?(\d{1,3}[A-Z]?)\b", "US-"),
        (r"\b(?:S\.?R\.?|STATE (?:ROAD|ROUTE|HIGHWAY)|FLORIDA (?:ROAD|ROUTE|HIGHWAY))[ -]?([A-Z]?\d{1,4}[A-Z]?)\b", "FL-"),
        (r"\b(?:C\.?R\.?|COUNTY (?:ROAD|ROUTE))[ -]?(\d{1,4}[A-Z]?)\b", "FL-CR-"),
    ]:
        for match in re.finditer(pattern, upper):
            add(prefix + match[1])
    if re.search(r"\b(?:FLORIDAS?|FLORIDA'S)\s+TURNPIKE\b|\bTPKE\b", upper):
        add("FL-TURNPIKE")
    return result


def road_fields(row: dict) -> tuple[str, list[str], list[str], str]:
    source = str(row.get("roadway") or "").strip()
    location = str(row.get("location") or "").strip()
    refs = normalized_refs(source + " " + location)
    primary = normalized_refs(source)
    evidence = "FL511 roadway field"
    if source.lower().startswith("for city of"):
        road = re.split(r"\s+(?:at|@|and)\s+|\s*&\s*", location, maxsplit=1, flags=re.I)[0].strip() or source
        primary = []
        evidence = "derived from FL511 location; roadway field is a placeholder"
    elif "FL-TURNPIKE" in primary:
        road = "Florida's Turnpike"
    elif primary:
        road = primary[0]
    elif re.search(r"floridas?\s+turnpike", source, re.I):
        road = "Florida's Turnpike"
    else:
        road = source or location
    return road, refs, primary, evidence


def timezone_for(county: str, source_id: str) -> tuple[str | None, str]:
    if county in CENTRAL_COUNTIES:
        return "America/Chicago", "county entirely in Central zone"
    if county == "Gulf":
        if source_id in GULF_EASTERN_SOURCE_IDS:
            return "America/New_York", "Cape San Blas location in split Gulf County"
        return None, "split Gulf County; individual location unverified"
    if county == "Franklin":
        # Existing source points are east of the Apalachicola River. New
        # Franklin records require location review before assigning a zone.
        if source_id in {"5611", "5612"}:
            return "America/New_York", "east of Apalachicola River"
        return None, "Franklin County river-boundary position unverified"
    return "America/New_York", "county in Eastern zone"


def region_for(row: dict) -> str:
    if str(row.get("county") or "") == "Monroe":
        return "Florida Keys"
    return REGIONS.get(str(row.get("region") or ""), "Other Florida")


def road_kind(text: str) -> str:
    s = text.lower()
    for word, kind in [("express lane", "express-lanes"), ("general lane", "general-lanes"),
                       ("frontage", "frontage"), ("ramp", "ramp"),
                       ("causeway", "causeway"), ("bridge", "bridge")]:
        if word in s:
            return kind
    return "unspecified"


def toll_facility(row: dict, road: str) -> str | None:
    source = str(row.get("source") or "")
    wording = str(row.get("roadway") or "")
    if "turnpike" in wording.lower():
        return "Florida's Turnpike"
    known_authority_roads = {
        "DIVAS-Turnpike SG C": {"FL-417", "FL-429", "FL-528"},
        "DIVAS-CFX": {"FL-408", "FL-414", "FL-417", "FL-429", "FL-451", "FL-453", "FL-528", "FL-538"},
        "DIVAS-MDX": {"FL-112", "FL-836", "FL-874", "FL-878", "FL-924"},
    }
    if road in known_authority_roads.get(source, set()):
        return road
    if re.search(r"expressway|turnpike|toll|suncoast parkway|polk parkway|veterans spur", wording, re.I):
        return wording
    return None


def normalize_row(row: dict, checked_at: str, media_checks: dict) -> list[dict]:
    source = str(row.get("source") or "")
    if source not in PROVIDERS:
        raise ValueError(f"unconfigured provider group: {source!r}")
    provider_key, provider = PROVIDERS[source]
    source_site_id = str(row.get("id") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", source_site_id):
        raise ValueError(f"invalid FL511 site ID: {source_site_id!r}")
    lat, lon = parse_coordinates(row)
    county = str(row.get("county") or "").strip()
    tz, tz_evidence = timezone_for(county, source_site_id)
    road, refs, primary, road_evidence = road_fields(row)
    raw_direction = str(row.get("direction") or "").strip()
    direction = re.sub(r"bound$", "", raw_direction, flags=re.I).title() if re.fullmatch(r"(?:North|South|East|West)bound", raw_direction, re.I) else ""
    cameras = []
    for image in row.get("images") or []:
        source_id = str(image.get("id") or "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", source_id):
            raise ValueError(f"invalid FL511 image ID: {source_id!r}")
        image_url = absolute_https(image.get("imageUrl"), image=True)
        source_video = absolute_https(image.get("videoUrl"))
        if image.get("imageUrl") and not image_url:
            raise ValueError(f"invalid image URL for camera {source_id}")
        if image.get("videoUrl") and not source_video:
            raise ValueError(f"invalid source video URL for camera {source_id}")
        check = media_checks.get(source_id) or {}
        prior_image_status = check.get("imageStatus", "unchecked")
        prior_video_status = check.get("videoStatus", "unchecked")
        if prior_image_status not in {"available", "unavailable", "stale", "unchecked"}:
            raise ValueError(f"invalid image check for {source_id}")
        if prior_video_status not in {"available", "unavailable", "stale", "unchecked"}:
            raise ValueError(f"invalid video check for {source_id}")
        image_status = media_check_status(prior_image_status, check.get("imageCheckedAt"), checked_at)
        video_status = media_check_status(prior_video_status, check.get("videoCheckedAt"), checked_at)
        video_auth = bool(image.get("isVideoAuthRequired"))
        # Only a decoded direct feed can enter the browser player. An FL511
        # tokenized source URL alone is not a playable direct URL.
        playable = video_status == "available" and not video_auth and bool(source_video)
        video_url = source_video if playable else None
        disabled = bool(image.get("disabled") or image.get("blocked") or not row.get("visible", True))
        if disabled:
            availability = "unavailable"
        elif image_status in {"available", "unavailable", "stale"}:
            availability = image_status
        elif video_status == "available":
            availability = "available"
        else:
            availability = "unchecked"
        site_id = f"FL:{provider_key}:site:{image.get('cameraSiteId') or source_site_id}"
        name = str(row.get("location") or image.get("description") or f"FL511 camera {source_id}").strip()
        camera = {
            "id": f"FL:{provider_key}:{source_id}", "siteId": site_id,
            "sourceId": source_id, "sourceSiteId": str(image.get("cameraSiteId") or source_site_id),
            "state": "FL", "stateName": "Florida", "name": name,
            "originalName": str(image.get("description") or name),
            "description": "", "road": road, "sourceRoad": str(row.get("roadway") or ""),
            "roadEvidence": road_evidence, "routeRefs": refs,
            "primaryRouteRefs": primary, "roadKind": road_kind(str(row.get("roadway") or "") + " " + name),
            "tollFacility": toll_facility(row, road),
            "direction": direction, "sourceDirection": raw_direction,
            "directionBearing": None,
            "directionSource": "FL511 listed direction; traffic interpretation unverified" if direction else "unknown",
            "directionConfidence": "uncertain" if direction else "unknown",
            "facingDirection": "", "facingDirectionSource": "unknown",
            "lat": lat, "lon": lon, "hasCoordinates": lat is not None,
            "region": region_for(row), "sourceRegion": row.get("region"),
            "metro": METROS.get(county, region_for(row) + " area"),
            "jurisdiction": county, "jurisdictionType": "county", "city": row.get("city") or "",
            "provider": provider, "providerKey": provider_key, "providerSource": source,
            "district": row.get("dotDistrict") or "", "sourceAreaId": row.get("areaId"),
            "sourceLink": SOURCE_PAGE, "officialUrl": SOURCE_PAGE,
            "officialLinkType": "source-viewer", "siteUrl": PUBLIC_SITE,
            "imageUrl": image_url, "videoUrl": video_url, "iosVideoUrl": None,
            "sourceVideoUrl": source_video, "videoAuthRequired": video_auth,
            "videoCapability": "official-viewer" if source_video and not playable else ("live-video" if playable else "none"),
            "videoAutoplayAllowed": playable,
            "mediaType": "video" if playable else ("snapshot" if image_url else "official"),
            "imageStatus": image_status, "videoStatus": video_status,
            "availability": availability, "auditCheckedAt": check.get("imageCheckedAt") or check.get("videoCheckedAt"),
            "imageCheckedAt": check.get("imageCheckedAt"), "videoCheckedAt": check.get("videoCheckedAt"),
            "statusReason": ("Previous media check is more than seven days old. " if availability == "stale" else "") +
                            (check.get("reason") or ("FL511 lists the camera; media has not been visually verified" if availability == "unchecked" else "")),
            "sourceCreatedAt": row.get("created"), "sourceLastUpdatedAt": row.get("lastUpdated"),
            "sourceTimestamp": None, "sourceCaptureTime": None,
            "sourceRetrievedAt": checked_at, "timezone": tz, "timezoneEvidence": tz_evidence,
            "sourceStatus": "disabled" if disabled else "listed", "disabled": disabled,
            "snapshotUpdateSeconds": 120, "sourceImageCacheMaxAgeSeconds": 60,
            "snapshotCacheBustAllowed": False,
            "sourceLocationId": str(image.get("cameraSiteId") or source_site_id),
            "physicalDeviceId": None, "physicalDeviceCountVerified": False,
            "linkId1": row.get("linkId1"), "linkId2": row.get("linkId2"),
            "aliases": [str(row.get("location") or ""), str(image.get("description") or ""), source_id],
            "provenance": [{"source": source, "siteId": source_site_id, "imageId": source_id,
                            "url": SOURCE_PAGE}],
        }
        if prior_image_status != "unchecked":
            camera["lastVerifiedImageStatus"] = prior_image_status
        if prior_video_status != "unchecked":
            camera["lastVerifiedVideoStatus"] = prior_video_status
        cameras.append(camera)
    return cameras


def reconcile_exact_image_duplicates(cameras: list[dict]) -> tuple[list[dict], list[dict]]:
    """Merge only identical cross-provider image identities, retaining aliases.

    A shared coordinate, roadway link, or name is insufficient evidence. An
    identical image URL is the same delivered view; different directional
    views remain distinct even if a future source reuses one image URL.
    """
    seen: dict[str, dict] = {}
    result: list[dict] = []
    reconciliation: list[dict] = []
    for camera in cameras:
        url = camera.get("imageUrl")
        old = seen.get(url) if url else None
        if old and old["providerKey"] != camera["providerKey"] and old["sourceDirection"] == camera["sourceDirection"]:
            old.setdefault("aliasIds", []).append(camera["id"])
            old.setdefault("sourceLocationAliases", []).append(camera["siteId"])
            old["aliases"] = list(dict.fromkeys(old["aliases"] + camera["aliases"]))
            old["provenance"].extend(camera["provenance"])
            reconciliation.append({"canonicalId": old["id"], "aliasId": camera["id"],
                                   "evidence": "exact-image-url", "imageUrl": url})
        else:
            result.append(camera)
            if url and url not in seen:
                seen[url] = camera
    return result, reconciliation


def build_shard(rows: list[dict], source_meta: dict, media_checks: dict) -> tuple[dict, dict]:
    retrieved_at = source_meta["sourceRetrievedAt"]
    raw_cameras = [camera for row in rows for camera in normalize_row(row, retrieved_at, media_checks)]
    cameras, reconciliation = reconcile_exact_image_duplicates(raw_cameras)
    ids = [camera["id"] for camera in cameras]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate namespaced camera IDs")
    site_ids = {camera["siteId"] for camera in cameras}
    if not cameras or len(cameras) < 1000:
        raise ValueError("unexpectedly small camera catalog; refusing replacement")
    cameras.sort(key=lambda c: (c["providerKey"], int(c["sourceId"]) if c["sourceId"].isdigit() else c["sourceId"]))
    same_coords = collections.Counter((c["lat"], c["lon"]) for c in cameras if c["hasCoordinates"])
    source_video = [c for c in cameras if c["sourceVideoUrl"]]
    verified_checks = [c for c in cameras if c["auditCheckedAt"]]
    audit = {
        "auditDate": retrieved_at, "sourceRetrievedAt": retrieved_at,
        "mediaAuditCompletedAt": max((c["auditCheckedAt"] for c in verified_checks), default=None),
        "sourceUrl": SOURCE_PAGE,
        "listEndpoint": LIST_URL, "sourceRowsReported": source_meta.get("sourceRowsReported", len(rows)),
        "sourceRowsRetrieved": len(rows), "listedViews": len(cameras), "sourceLocations": len(site_ids),
        "verifiedPhysicalDevices": None,
        "providerGroups": dict(sorted(collections.Counter(c["providerSource"] for c in cameras).items())),
        "sourceVideoUrlCount": len(source_video),
        "tokenizedVideoCount": sum(c["videoAuthRequired"] and bool(c["sourceVideoUrl"]) for c in cameras),
        "directPlayableVideoCount": sum(bool(c["videoUrl"]) for c in cameras),
        "snapshotListedCount": sum(bool(c["imageUrl"]) for c in cameras),
        "visuallyCheckedViews": len(verified_checks),
        "missingCoordinates": sum(not c["hasCoordinates"] for c in cameras),
        "unknownTimezones": sum(not c["timezone"] for c in cameras),
        "repeatedCoordinateGroups": sum(count > 1 for count in same_coords.values()),
        "exactCrossProviderMediaDuplicates": len(reconciliation),
        "reconciliation": reconciliation,
        "notes": [
            "FL511 source camera-site IDs are counted as source locations; no physical-device identity was supplied.",
            "Identical coordinates, road links, or nearby names do not prove duplicate camera views; distinct IDs are retained.",
            "Source creation/update dates are catalog metadata, not image capture times. No verified capture timestamps were supplied.",
            "An HLS URL or token response is not proof of browser decoding; only video checks with decoded playback enter the direct player.",
            "This builder does not download media. Media checks are a separate dated, bounded audit input.",
        ],
    }
    shard = {"schemaVersion": 1, "state": "FL", "stateName": "Florida",
             "sourceUpdatedAt": None, "sourceRetrievedAt": retrieved_at,
             "auditCheckedAt": max((c["auditCheckedAt"] for c in verified_checks), default=None),
             "cameras": cameras}
    return shard, audit


def state_entry(state: str, shard: dict, raw: bytes, previous: dict | None = None) -> dict:
    cameras = shard["cameras"]
    positions = [(c["lon"], c["lat"]) for c in cameras if c.get("hasCoordinates") and isinstance(c.get("lat"), (int, float)) and isinstance(c.get("lon"), (int, float))]
    media = dict(collections.Counter(c.get("mediaType", "official") for c in cameras))
    availability = dict(collections.Counter(c.get("availability", "unchecked") for c in cameras))
    entry = dict(previous or {})
    entry.update({
        "state": state, "stateName": shard.get("stateName") or state,
        "file": f"data/{state}.json",
        "views": len(cameras), "locations": len({c.get("siteId") for c in cameras}),
        "bounds": [min(p[0] for p in positions), min(p[1] for p in positions),
                   max(p[0] for p in positions), max(p[1] for p in positions)] if positions else None,
        "withCoordinates": len(positions), "withoutCoordinates": len(cameras) - len(positions),
        "mediaCounts": media, "availabilityCounts": availability,
        "sourceUpdatedAt": shard.get("sourceUpdatedAt"),
        "auditCheckedAt": shard.get("auditCheckedAt"),
        "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
    })
    if state == "FL":
        entry.update({"siteUrl": PUBLIC_SITE, "source": "FL511 public camera list (FDOT and partner groups)",
                      "sourceUrl": SOURCE_PAGE, "sourceRetrievedAt": shard["sourceRetrievedAt"],
                      "catalogUrl": "https://whardy.github.io/sandbox/trip-camera-desk/data/FL.json",
                      "sourceAuditUrl": PUBLIC_SITE + "docs/source-audit.md",
                      "imageStatusCounts": dict(collections.Counter(c["imageStatus"] for c in cameras)),
                      "videoStatusCounts": dict(collections.Counter(c["videoStatus"] for c in cameras)),
                      "physicalDevicesVerified": None})
    return entry


def build_index(fl_shard: dict, fl_raw: bytes) -> dict:
    path = TRIP_DATA / "index.json"
    index = json.loads(path.read_text())
    prior = {entry["state"]: entry for entry in index["states"]}
    entries = []
    for state in sorted(set(prior) | {"FL"}):
        if state == "FL":
            shard, raw = fl_shard, fl_raw
        else:
            raw = (TRIP_DATA / f"{state}.json").read_bytes()
            shard = json.loads(raw)
        entries.append(state_entry(state, shard, raw, prior.get(state)))
    index["states"] = entries
    index["builtAt"] = utc_now()
    index["totals"] = {
        "statesAndDistricts": len(entries),
        "views": sum(e["views"] for e in entries),
        "locations": sum(e["locations"] for e in entries),
        "withCoordinates": sum(e["withCoordinates"] for e in entries),
        "withoutCoordinates": sum(e["withoutCoordinates"] for e in entries),
        "mediaCounts": dict(sum((collections.Counter(e["mediaCounts"]) for e in entries), collections.Counter())),
        "availabilityCounts": dict(sum((collections.Counter(e["availabilityCounts"]) for e in entries), collections.Counter())),
    }
    note = f"Florida counts include only {len(fl_shard['cameras']):,} actual FL511 list records from this refresh; physical-device identity is unverified."
    index["notes"] = [n for n in index.get("notes", []) if not n.startswith("Florida counts include only")] + [note]
    return index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-json", type=Path, help="Use a saved official JSON row array for reproducible offline validation")
    parser.add_argument("--media-checks", type=Path, default=HERE / "docs/media-checks.json")
    args = parser.parse_args()
    status_path = HERE / "data/refresh-status.json"
    try:
        if args.source_json:
            rows = json.loads(args.source_json.read_text())
            if not isinstance(rows, list):
                raise ValueError("--source-json must be a JSON row array")
            source_meta = {"sourceRowsReported": len(rows), "sourceRetrievedAt": utc_now(), "offlineInput": str(args.source_json)}
        else:
            rows, source_meta = fetch_rows()
        checks = json.loads(args.media_checks.read_text()) if args.media_checks.exists() else {}
        if not isinstance(checks, dict):
            raise ValueError("media checks must be keyed by source image ID")
        shard, audit = build_shard(rows, source_meta, checks)
        fl_raw = compact_json(shard)
        index = build_index(shard, fl_raw)
        # Validate both outputs before replacing either last-known-good file.
        if index["totals"]["views"] < len(shard["cameras"]):
            raise ValueError("invalid unified index totals")
        atomic_bytes(TRIP_DATA / "FL.json", fl_raw)
        atomic_bytes(TRIP_DATA / "index.json", compact_json(index))
        atomic_bytes(HERE / "docs/source-audit.json", compact_json(audit))
        atomic_bytes(status_path, compact_json({"status": "complete", "checkedAt": utc_now(),
                                                 "listedViews": len(shard["cameras"]),
                                                 "sourceLocations": audit["sourceLocations"],
                                                 "lastKnownGoodRetained": False}))
        print(f"FL catalog: {len(shard['cameras'])} views, {audit['sourceLocations']} source locations; physical devices unknown")
        return 0
    except Exception as error:
        atomic_bytes(status_path, compact_json({"status": "failed", "checkedAt": utc_now(),
                                                 "reason": str(error), "lastKnownGoodRetained": True}))
        print(f"Florida refresh failed; last-known-good catalog retained: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
