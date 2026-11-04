# Florida Camera Desk validation

Updated 2026-11-04 UTC. These are dated observations, not ongoing availability
promises. See the [source audit](source-audit.md) for provider counts, media
method and scope.

## Catalog and metadata

- A complete, bounded refresh retrieved 4,991 of 4,991 official FL511 list
  rows. Florida Desk and Trip Desk use one Florida shard at
  `sandbox/trip-camera-desk/data/FL.json`. The unified Trip index recalculates
  to 26,569 listed views across 14 state/DC catalogs.
- `python3 sandbox/florida-camera-desk/_tools/check-catalog.py` passes 11 offline
  checks covering IDs, source-site counts, missing coordinates, exact-image
  duplicate reconciliation, directional-view retention, Florida state/county
  road namespaces including SR-A1A, toll evidence, video authorization,
  visually checked offline frames, stale-check aging and Eastern/Central
  daylight-saving behavior.
- `python3 sandbox/trip-camera-desk/_tools/check-catalog.py` passes with the
  Florida shard included, preserving older state IDs, border aliases and the
  Texas relay. The Florida refresh deliberately does not change prior state
  shards.
- All 4,991 Florida views had usable coordinates in this source snapshot.
  The builder's missing-coordinate test confirms such a view remains listed
  while absent from geographic matching if future data lacks a position.

## Media audit

- Representative snapshot requests across all 13 source groups returned image
  bytes with CORS `*` and 60-second cache headers. These responses alone do not
  prove a current roadway image.
- Visual checks at approximately 04:27 UTC confirmed actual roadway snapshots
  for FDOT District 1 ID 1, CFX ID 3972 and GMX/MDX ID 4160. The FL511 I-595
  district feed ID 4263 was visually confirmed at approximately 04:41 UTC.
  District 1's sampled bytes changed between requests. CFX ID 3860 displayed a 540×330
  offline placeholder despite HTTP 200 and is marked unavailable.
- Sampled non-auth HLS URLs returned HTTP 401 from the whardy origin. Sampled
  auth-required HLS worked only with FL511 origin/referer context; that is not
  independent browser delivery for this site. GMX sample decoding also failed
  in a local fragment check. The catalog publishes zero direct-playable Florida
  video URLs, and the UI must show official-viewer fallback rather than a
  misleading Live video badge or autoplay.
- A production trial using the existing Texas relay obtained an FL511 video
  token, then timed out when its Worker fetched the DIVAS manifest on port
  8200. No Florida stream decoded through that relay. The trial was rolled
  back, and a Texas JPEG endpoint was reverified. Direct Florida video remains
  dependent on provider-supported delivery reachable by the site or relay.
- Capture times were not verified. An image's browser fetch time and the
  source's catalog dates are shown separately where relevant.

## Browser and release checks

The previous map-only validation is superseded by the direct-camera release.
Local browser checks loaded 4,991 records, displayed a real CFX snapshot in the
camera dialog, searched State Road 408 (96 matches), advanced to page 2
(views 26–50), pinned and reordered views, selected a mapped camera by exact ID,
and confirmed the official FL511 iframe is absent until its panel opens. The
320-pixel viewport had no horizontal overflow. No physical iPhone was available;
the narrow viewport is not an iOS playback test. Published-origin checks are
recorded separately after deployment.

Trip Desk route checks are in
[`../../trip-camera-desk/docs/florida-route-validation.json`](../../trip-camera-desk/docs/florida-route-validation.json).
They cover Tampa–Orlando, Miami–Key West, Jacksonville–Miami,
Pensacola–Jacksonville, Miami–Washington DC, dense Miami–Miami Beach, rural
Apalachicola–Perry, a Georgia-only route, and an I-4 route with directional
views. All nine route checks passed. The catalog, Florida geometry, media,
California media, routing, and waypoint checks also passed.
