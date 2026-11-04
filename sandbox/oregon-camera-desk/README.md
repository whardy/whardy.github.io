# Oregon Camera Desk

Public URL: https://whardy.github.io/sandbox/oregon-camera-desk/

A static camera wall, clustered map, and local watchboard for Oregon DOT TripCheck's public inventory and the agency partners it lists. The editable project is `oregon-camera-desk/`; publish `dist/` to the repository's `sandbox/oregon-camera-desk/`. No frontend dependency install or build is required.

## Use

- Browse 25 views per page in Wall, Map, or Split. Search roads, places, passes, names and IDs. City/area and highway menus populate from actual camera data. More filters exposes region, county, published viewing direction, media, dated availability, and corridor endpoints.
- Road stretch uses published milepoints only when every selected view has one within the same physical state. Otherwise it explicitly labels approximate geographic progression. Winding roads and crossing-road aliases can differ from the traveled route. Viewing direction is not a statement about traffic direction. Use Trip Camera Desk for actual driving-route projection and camera coverage.
- Pin cameras with the star into the current named watchboard. Open My watchboards to create or rename boards, switch boards, reorder or remove cameras, show a board as a wall, share, or export/import JSON. Empty boards can be deleted; the last board is retained. Limits are 30 boards and 500 IDs per board. Imports preserve existing boards and reject malformed structures and arbitrary image URLs. Unknown IDs remain named as unavailable catalog entries rather than initiating network requests.
- Board links disclose the board's name and camera IDs. A recipient deliberately selects Save shared board before browser storage is modified. Large boards should use JSON export. Local storage errors are surfaced; export before clearing browser data. No account or server-side storage is required.
- Open in Trip Desk sends the current board as a deliberate share link. Individual enlarged camera views have their own Trip Desk link. Oregon's stable hub IDs use `OR:tripcheck:<publishedImageId>`.

## Inventory and media

The initial inventory has **1,179 published views at 1,177 source-reported locations**, with **1,178 geocoded views and one unmapped view**. These source-location IDs are not independently verified physical-device counts. Views repeated in report regions are deduplicated without collapsing distinct publishedImageIds. The dated inventory contains 1,131 views physically in Oregon, 18 in Washington, 21 in California, eight in Idaho, and one unresolved location. Provider jurisdiction remains Oregon for the TripCheck catalog. The hub reconciles verified duplicates with neighboring catalogs; the standalone site retains their source provenance.

The corrected UTC November 4, 2026 audit decoded every listed JPEG: **1,121 dated available scenes and 58 verified provider offline cards**. Those offline cards returned HTTP 200 and are classified by the verified notice hash rather than HTTP status. These are historical results, not a guarantee of current availability.

The source publishes refreshing still images, not an unrestricted public video catalog. Eighty-seven views advertise an official rapid-image session; this is a limited official viewer, not verified embedded live video. No Oregon HLS stream is claimed or embedded. Each card opens the official TripCheck map as a fallback; a reliable per-camera official deep link was not established, so the displayed name and ID remain available to locate it.

Images are loaded directly from `www.tripcheck.com` using public, source-listed HTTPS URLs. No relay, Worker, credential, R2 bucket, or recording storage is required. Visible snapshots refresh no faster than their verified source cadence (normally five minutes), with at most four in progress. Offscreen requests are cancelled; hidden pages pause and cancel work. Modals stop background image requests. Historical daylight images load only after selecting Show last daylight and are explicitly labeled; their availability is provider-controlled. They do not refresh automatically.

“Fetched” is the browser retrieval time. Public inventory does not supply a machine-readable capture timestamp, so capture time remains unknown. A dated audit is historical evidence, not a live guarantee. Repeated image hashes or HTTP Last-Modified alone do not prove staleness or failure. An offline notice can return HTTP 200. The audit checks source-listed URLs, valid image decoding, and visually verified placeholder hashes, and records any unresolved transport errors separately.

Camera courtesy of ODOT and TripCheck partner agencies. County enrichment uses U.S. Census Bureau TIGERweb 2026 boundaries; metro/area labels are editorial browsing groups. The map uses OpenStreetMap tiles with attribution. The source inventory, report reconciliation, original coordinates, geographic provenance, dates and limitations are in `camera-catalog.json`; individual checks are in `source-audit.json`. Additional source research is in `docs/sources.md`.

Official road conditions, closures, chain restrictions, and weather are linked to TripCheck. This release does not embed credentialed operational data or infer road safety from pictures. Routing is provided by the existing Trip Desk, which distinguishes ordinary estimates from traffic-aware travel times. No private congestion layer is copied.

## Maintenance

From this project directory:

```sh
python3 scripts/refresh-catalog.py
python3 scripts/refresh-catalog.py --audit
node scripts/check.mjs
python3 -m http.server 4194 --bind 127.0.0.1 --directory dist
```

The refresh script owns inventory validation, source reconciliation, geographic enrichment and bounded audit behavior. Check its `--help` for supported output/cache options. Do not replace the last known good catalog with an empty response or widespread local transport failure. Review changed counts and source dates before publishing. A trust-store failure in the audit environment is a local check failure, not evidence every camera is offline; correct the certificate bundle rather than disabling TLS verification.

The published GitHub bundle includes the same maintenance code under `_tools/`. From `sandbox/oregon-camera-desk/`, run `python3 _tools/refresh-catalog.py --output . --cache-dir .cache --audit` and `node _tools/check.mjs`. Keep `.cache/` out of publication; it contains temporary audit images. To run the Oregon/Washington hub checks, use `node _tools/check-trip.mjs` (add `--live` only for deliberate provider queries).

After refreshing and auditing Oregon, rebuild Trip Camera Desk's maintained catalog, run its routing/media/catalog checks, and publish changed shards and index together. Preserve namespaced IDs so saved boards continue to resolve. Oregon camera refresh cadence must remain present in the shared media manager. Keep the source and published `_tools` copies consistent.

The public still-image page has no new usage charge under this static design. GitHub Pages, map tiles, camera delivery, and community routing remain subject to their respective policies and limits, without an unlimited-service or availability promise. Credentialed TripCheck API access is a separate optional dependency for future road/weather layers. No secret belongs in public files. Recording, archives, OneDrive, and AI traffic analysis are out of scope.

## Verification scope

Automated checks exercise actual catalog identity/counts, filters, region aliases, missing coordinates, road aliases, corridor progression and state boundaries, safe Unicode sharing, import validation/preservation, library limits, pagination, assets, and navigation. Browser verification and deployment evidence are recorded by the publishing task. A narrow viewport is not physical iOS testing. Actual Oregon embedded-video playback cannot be tested because no supported embedded video was verified.
