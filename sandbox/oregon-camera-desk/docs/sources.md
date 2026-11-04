# Oregon Camera Desk — sources and access

Research and initial inventory: November 2026. The JSON artifacts contain exact UTC retrieval and audit times. This is an independent viewer using published transportation-camera still images; it is not an official ODOT service.

## Published inventory and reconciliation

- [TripCheck camera map](https://www.tripcheck.com/).
- [Structured map inventory](https://www.tripcheck.com/Scripts/map/data/cctvinventory.js), linked by the current public map application.
- [Official camera text report](https://www.tripcheck.com/DynamicReports/Report/Cameras), including the literal current-image and last-daylight image paths used by its camera dialogs.
- [Custom camera map](https://www.tripcheck.com/Pages/Custom-Cameras) uses the same structured camera inventory.

The initial map inventory has **1,179 published views** and **1,177 distinct source camera IDs**. The camera report contains 1,266 appearances representing 1,173 distinct published-image IDs; 93 appearances are repeats in regional groups. Its six omitted map views (4261, 4265, 4742, 4998, 5268, 5270) remain in the catalog. All report IDs reconcile to map IDs. These are source-reported locations, not independently verified physical-device counts. Multiple views at one camera ID remain separate.

Some map filenames differ from the report's filenames. The refresh tool preserves both observed URLs, prefers the report URL, and tries only its listed map alternative if the first image fails. The reconciliation JSON records these differences. No image URL or camera ID is brute-forced or inferred from an adjacent number.

TripCheck publishes partner cameras alongside ODOT cameras, including local roads. The initial catalog includes 415 views categorized as city/county roads by the source, including Portland, Salem, Eugene, Bend, Washington County, Clackamas County, and other local or coastal sites. Provider attribution is ODOT TripCheck and partner agencies; exact device ownership is left blank where the public inventory does not specify it. No separate unpublished municipal systems or commercial webcam networks are harvested. Coverage is limited to the collected public TripCheck inventory, not every camera in Oregon.

Raw IDs are published-image IDs. `siteId` uses the separate TripCheck camera ID. The hub namespaces views as `OR:tripcheck:<publishedImageId>`. Keep existing IDs stable across refreshes.

## Image permission, cadence, and attribution

The [official TripCheck FAQ](https://www.tripcheck.com/Pages/Frequently-Asked-Questions) permits reuse of its images/data and requests ODOT credit. This site displays “Camera images courtesy of ODOT and TripCheck partner agencies” and links to the official service. Retain partner marks burned into images.

The FAQ describes most still images as updating about every five minutes, with slower rural updates possible. The site therefore refreshes visible snapshots every **300 seconds**, with at most four concurrent requests. Inventory refresh is separate: [ODOT's API documentation](https://www.tripcheck.com/Pages/API) lists camera inventory refresh at **24 hours**. The public map configuration independently sets its inventory cache period to 86,400 seconds.

The currently served official camera dialog polls its still image at 60 seconds, but frequent retrieval does not create new captures. This viewer uses the more conservative five-minute cadence. Source requests are direct HTTPS `<img>` delivery from `www.tripcheck.com`, which does not require JavaScript access to image pixels. Thus missing CORS response headers do not prevent ordinary image embedding; they do prevent assuming a canvas can read the image. Browser embedding is checked separately from the command-line audit.

There is no published numeric request allowance for these direct images in the reviewed public documentation. Do not call them unlimited or infer an API quota from image behavior. Use modest traffic, lazy loading, offscreen/hidden-tab suspension, and bounded request concurrency. Manual refresh retrieves current provider content and is not evidence of a newly captured frame.

## Streaming is a different service

The currently served [official camera-dialog module](https://www.tripcheck.com/Scripts/map/templates/camera.min.js) still implements the advertised “live streaming” as rapidly refreshed TrafficLand images: two-second intervals and a 60-second session followed by explicit restart. The map inventory flags 87 such views. This is not HLS or continuous video.

The public TrafficVideo metadata includes third-party image URLs with access parameters. Those addresses/parameters are **not copied into this catalog or browser code**. This release links to the official TripCheck map for that feature and embeds no TrafficLand service. It neither loops the session nor tries to bypass provider restrictions. Its camera capabilities are therefore 1,179 refreshing snapshots, zero verified embedded video feeds, and 87 views with an official rapid-image option. The map link opens the official map, not a guaranteed selected-camera deep link.

Last-daylight paths are preserved only when explicitly listed in the report. They refer to historical images and may expire or be unavailable; no capture timestamp is manufactured and no image is presented as a current view merely because it was just retrieved.

## API account, terms, and credentials

The [ODOT developer portal](https://apiportal.odot.state.or.us/) and [getting-started guide](https://www.tripcheck.com/pdfs/TripCheckAPI_Getting_Started_GuideV5.pdf) describe registration, accepting the API subscription terms, and receiving a private subscription key for credentialed XML/JSON feeds. Current acceptance/account-specific quotas must be checked in that account before using those feeds. A historic guide is not evidence of a current numeric quota.

This release uses the permitted public inventory/still-image interface and needs no new account or runtime API key. It does not claim acceptance of unseen subscription terms. If credentialed incident, chain-restriction, RWIS, or road/weather feeds are added later, keep the key in a controlled maintenance environment or server secret, not public GitHub files or URLs. Until then, provide official TripCheck road/weather links rather than stale copied reports. Third-party INRIX congestion tiles are not copied.

## Geographic classification and border views

County and physical-state labels use [U.S. Census Bureau TIGERweb counties](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1), January 1, 2026 vintage, requested in EPSG:4326. The tool checks all 194 counties across Oregon, Washington, California, Idaho, and Nevada. Point-in-polygon classification uses 0.00005-degree generalized geometry and stays unresolved for ambiguous or invalid coordinates. It is for browsing, not surveyed positioning.

The initial result is 1,131 views physically in Oregon, 18 in Washington, 21 in California, eight in Idaho, and one unresolved. TripCheck view 4998 has invalid source longitude 226; its original coordinates remain in evidence while its usable coordinates are null. It remains searchable but is excluded from geographic matching. All other 1,178 views have usable coordinates and a county match.

Area/metro labels are editorial county browsing groups, not legal metropolitan boundaries or assertions that an entire county is urban. Municipality and exact owner remain blank if the source lacks reliable fields. Provider jurisdiction `OR` remains distinct from physical state.

A direction parsed from the title or filename is explicitly a viewing direction. NB/SB/EB/WB tokens take priority; street quadrants such as NW Arizona and SW Alder are not treated as directions. Diagonal tokens require an explicit looking/viewing/facing label or a terminal view token. It is not treated as a verified traffic-travel direction in the trip matcher. Milepoints come only from explicit `MP` tokens in the published title/filename. Pass names are associated only where named in source text. Original route labels and names remain alongside normalized display names.

Some Washington camera catalog entries use exact TripCheck image URLs. The hub reconciles those identities separately while preserving aliases and the independent Washington site's stable IDs. Nearby coordinates alone do not establish duplication.

## Audit meaning and maintenance

Run the refresh tool from the editable project or the corresponding published tools directory:

```sh
python3 scripts/refresh-catalog.py
python3 scripts/refresh-catalog.py --audit-only
```

Use `--audit` to refresh inventory and audit in one run. `--output` chooses the target directory. `--cache-dir` chooses the local private metadata/image cache; do not publish that cache. `--reuse-sources` is an explicit offline maintenance option; it does not imply a fresh source retrieval. Source SHA-256 hashes are recorded in reconciliation metadata.

The tool validates inventory shape/counts/IDs and the complete boundary response before atomically replacing the catalog. Unexpected source/schema failures keep the previous catalog. Rate-limit retries honor a bounded delay and stop subsequent audit requests after persistent throttling. Widespread transport errors without an HTTP response (including DNS, timeout, connection, or local TLS trust failure), provider 429/5xx errors, or unchecked results preserve the last good catalog/audit and write failure evidence only to the local cache. Offline regression checks in `scripts/check-refresh.py` verify both direction interpretation and byte-for-byte preservation of a prior catalog/audit during simulated DNS failure.

The initial complete audit fetched and decoded all 1,179 images. Every endpoint returned HTTP 200; visual review and exact provider-notice fingerprints distinguished **58 unavailable-image notices** from **1,121 valid-image responses**. These are dated availability observations, not current capture/freshness guarantees. None of the responses supplied CORS access headers; ordinary `<img>` embedding works independently of pixel-reading access.

The image audit fetches every listed view at most four in parallel, limits response size and time, verifies image format and dimensions, and decodes with Pillow when available. It records HTTP status, retrieval time, Last-Modified header, image hash, and errors separately. Known offline-placeholder hashes are added only after visual confirmation. Seven exact central RGB pixel fingerprints (x25–75%, y25–70%, including original image dimensions) recognize visually confirmed ODOT/partner notice templates while ignoring varying camera-name/time headers. Exact full-image hashes are retained too. Run `--recheck-cache` to apply updated confirmed templates to existing audit images without fetching them again; original retrieval times remain intact. Repeated bytes alone are not classified as failure, because shared views and quiet scenes can be legitimate. A decoded image can still contain an unrecognized notice or an old capture, so a successful dated audit is not a live/freshness guarantee.

No machine-readable capture timestamp is supplied by the collected inventory. Timestamps burned into pictures are visible to visitors but are not silently parsed into a verified timestamp. No recording, archive storage, image history, or AI traffic analysis is implemented.

The static site and sanitized catalogs can run on the existing GitHub Pages account with no new paid infrastructure. No new relay, Worker, R2 bucket, or routing subscription is needed. Existing GitHub account/Pages limits and upstream provider policies still apply; this is not an unlimited-service promise.
