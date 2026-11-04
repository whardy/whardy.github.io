# Florida Camera Desk

Public site: https://whardy.github.io/sandbox/florida-camera-desk/

Florida Camera Desk is a static GitHub Pages camera wall and map backed by an
authorized, dated FL511 camera catalog. Individual provider snapshots appear
directly in the page. The official FL511 map and camera viewer remain available
as secondary resources and for video that the independent site cannot deliver.

The successful 2026-11-04 UTC refresh retrieved **4,991 listed views at 4,991
FL511 source-site IDs**. All 4,991 records had coordinates at that refresh.
FL511 did not supply a verified physical-device identifier, so the number of
physical devices is **unknown**. Same-coordinate and directional views retain
separate IDs. The catalog includes FDOT district and I-595 feeds, Florida's
Turnpike Enterprise, CFX, GMX/MDX, and local COT/BCTD feeds. The exact source
counts, attribution, method and dated observations are in
[`docs/source-audit.md`](docs/source-audit.md).

Each card shows a direct refreshing snapshot where available, with source and
location context, pinning and official-viewer actions. Search, facets, corridor
browsing, 25-card pagination, map/list synchronization and named watchboards use
the same stable `FL:<provider>:<source-image-id>` records that Trip Camera Desk
loads for routes and mixed-state boards. Watchboards use the existing
`trip-camera-desk-v1` browser storage format; sharing and JSON exports contain
IDs and configuration, not media URLs or credentials.

FL511 lists HLS video metadata for many rows, but checked HLS requests from the
published site's origin returned 401 or required FL511 origin context. A
production trial through the existing Texas relay obtained the FL511 token but
timed out reaching DIVAS HLS on port 8200, so that trial was rolled back. **No
Florida view is labeled as playable independent video or eligible for autoplay
until whardy-origin delivery and decoding are verified.** Working snapshots are
the primary direct media; use the official viewer for video. A separately
approved video endpoint reachable by the relay on standard HTTPS, or provider
assistance with its port-8200 connectivity, is the remaining video delivery
dependency. No recording or image-history archive is part of this
release.

## Refresh and checks

This published directory is the maintained source for Florida's static catalog
and frontend. The builder uses 100-row pages, bounded retries and timeouts,
request spacing, validation, and a last-known-good rule. If a page fails or a
source group changes unexpectedly, `data/refresh-status.json` reports the
failure while the previous Trip Desk Florida shard and index remain in place.
Refresh the shared Florida shard/index together:

```sh
python3 sandbox/florida-camera-desk/_tools/build-catalog.py
python3 sandbox/florida-camera-desk/_tools/check-catalog.py
python3 sandbox/trip-camera-desk/_tools/check-catalog.py
```

Run from the `whardy.github.io` repository root. The builder needs Python 3
and access to FL511's public list endpoint; it uses no credential. Dated media
checks are separate in `docs/media-checks.json`; checks older than seven days
become `stale` on refresh. Review agreement terms and
provider scope before changing request cadence, caching, or the explicit source
allowlist in the builder. See the [source audit](docs/source-audit.md) for
recovery, dependencies, and realistic request volume.

Source retrieval time, source record dates, media-check dates, browser retrieval
time and verified image capture time are separate. No source capture time was
verified in this release. A prior successful check is not a live guarantee.
Florida has both Eastern and Central time-zone views, represented with IANA
zones. Route times in Trip Desk are ordinary routing estimates, not
traffic-aware predictions.

Independent viewer; not an official FDOT or FL511 service.
