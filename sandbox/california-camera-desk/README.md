# California Camera Desk

A responsive, static camera wall, map and local watchboard for official Caltrans cameras and participating public local-road viewers. Published at https://whardy.github.io/sandbox/california-camera-desk/ and integrated with https://whardy.github.io/sandbox/trip-camera-desk/ .

The interface has 25 views per page; region, district, county, highway/local-road, direction, media, dated availability and elevation filters; clustered map results; map-area search; along-road milepost ranges where the provider supplies a comparable absolute milepost; local named boards, reordering, deliberate share links and JSON import/export. Multi-state boards and driving-route planning use Trip Camera Desk.

Visible verified video previews start muted and inline within an application limit of one mobile or two desktop slots, with an opt-out and individual/Stop all controls. Up to four desktop slots are available. Browser autoplay policies can still require a tap. Snapshot and video availability are independent. Feeds are stopped when removed, offscreen, closed or hidden. Snapshot refreshes use the provider’s nominal interval and limited concurrency. No recording or image archive is created.

On-demand chain controls load the selected reporting district from official CORS-enabled Caltrans JSON, cached for at least 60 seconds. Retrieval time, record publication time and status last-change time are distinguished. Closures and highway restrictions link to the official services.

## Source and coverage

The release inventory assembled 2026-11-04 03:30 UTC contains **4,110 listed views / 3,770 source-location groups**: 3,645 Caltrans views and 465 Santa Clara County official-viewer entries. All have usable coordinates. Media capabilities include 3,645 snapshots and 2,326 HLS video URLs (overlapping capabilities). A dated partial audit checked 1,358 of 5,964 unique media endpoints; the rest remain unchecked. Exact methods, results and source dates are in the source documentation and JSON.

Read [source documentation](docs/sources.md) for provider links, reuse/fair-use considerations, grouping and geography, timestamps, audits, local-road coverage limitations, and source-refresh behavior. Read [interface notes](docs/interface.md) for behavior, controls and limitations.

`dist/camera-catalog.json` contains the current counts, dated source manifests and reconciliation. Individual directional views and provider source-location groups are distinct; these groups are not verified physical-device counts. `dist/source-audit.json` records the exact partial-check coverage, methods and per-endpoint dates. A manifest response does not prove video playback; representative browser decoding is verified separately. Unchecked feeds remain unchecked.

All twelve Caltrans districts are included. Santa Clara County expressway views link to the county’s public viewer; no county gateway credential is reused. This is coverage of participating public sources, not every camera installed in California. Provider catalog timestamps are not image capture times. Image capture time remains unknown unless explicitly supplied and verified.

## Develop and refresh

No dependency installation or build is required. Serve `dist` with a local static HTTP server, for example:

```sh
python3 -m http.server 4194 --bind 127.0.0.1 --directory dist
```

Refresh official sources, retain last-known-good district records on failures, and rebuild the normalized inventory:

```sh
python3 scripts/refresh-catalog.py
```

For a bounded stratified availability sample, covering up to twelve image URLs and twelve HLS URLs in each reporting district:

```sh
python3 scripts/refresh-catalog.py --audit --audit-sample-per-district 12
```

For a full bounded endpoint audit, use `--audit` without the sampling flag. It makes many requests and should not be run repeatedly. Provider fair-use limits apply; the script uses at most four concurrent requests and never continuously streams or records.

`--from-cache` reuses saved district/GIS metadata, while GIS omission candidates and travel-source discovery still use the network. `--output /absolute/path` controls the generated destination. The directory contains `camera-catalog.json`, `source-audit.json`, `travel-sources.json` and raw source records. Preserve raw records and manifests for reproducibility and failure fallback.

From a published GitHub Pages checkout, the maintenance copy is under `_tools`; use `python3 _tools/refresh-catalog.py --output .` so its output targets the published directory explicitly.

Validation:

```sh
node scripts/check.mjs
python3 scripts/check-data.py
```

The data checks include all-district coverage, unique IDs, view/location separation, safe media URLs, direction/facing distinctions, unknown capture times and fault-injected source-fetch failures. Browser checks cover actual media decoding, interaction, responsive layouts and background cleanup. See [release validation](docs/validation.md).

## Cost and operation

GitHub Pages hosts static assets and catalog JSON. Caltrans supplies direct HTTPS media; participating county entries open their official viewer. No new relay, Worker, R2 storage, API key or paid subscription is required. Public map tiles, existing Trip Desk route/search services and camera providers have separate terms and capacity limits; no unlimited free service or uptime is promised.

The catalog is a dated static inventory. It requires an explicit refresh/deployment to reflect added or removed cameras. Live media and on-demand chain-control requests are fetched from providers at viewing time. Saved boards stay in the visitor’s browser unless deliberately exported or shared.
