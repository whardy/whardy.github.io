# California camera sources and maintenance

Research checked 2026-11-04 UTC (2026-11-03 Pacific). The viewer is independent of Caltrans and the County of Santa Clara. Counts and dated endpoint checks come from `camera-catalog.json` and `source-audit.json`; they are not live guarantees.

## Official sources

- [Caltrans CWWP2](https://cwwp2.dot.ca.gov/) aggregates the twelve districts.
- [CCTV source links and fair use](https://cwwp2.dot.ca.gov/closed-circuit-television-cameras.html) publish JSON, CSV, TXT and XML with the same data. The data is available for application integration at no charge. Its fair-use policy prohibits usage that risks degrading streaming availability. It does not specify a numeric public streaming allowance. Our one/two/four slot limits are application defaults, not an assurance of provider capacity.
- [CCTV field descriptions](https://cwwp2.dot.ca.gov/documentation/cctv/cctv-field-description.html), [district reporting matrix](https://cwwp2.dot.ca.gov/documentation/cctv/cctv-district-reporting-matrix.html), [district/county chart](https://cwwp2.dot.ca.gov/documentation/district-map-county-chart.html), [route chart](https://cwwp2.dot.ca.gov/documentation/route-chart.html), and [postmile codes](https://cwwp2.dot.ca.gov/documentation/prefix-suffix-alignment-charts.html) define source semantics.
- [Caltrans statewide viewer](https://cwwp2.dot.ca.gov/vm/iframemap.htm) uses a [published camera location list](https://cwwp2.dot.ca.gov/vm/js/cctv03.js). Its camera page links are matched to district snapshot slugs, not discovered by guessing IDs.
- [California Open Data CCTV catalog](https://publish.data.ca.gov/dataset/closed-circuit-television) describes the state-highway inventory and links to the [Caltrans GIS layer](https://caltrans-gis.dot.ca.gov/arcgis/rest/services/chhighway/CCTV/MapServer/0). The dataset page lists Creative Commons Attribution and unrestricted public use. Attribute Caltrans, retain source links, and follow [Caltrans conditions](https://dot.ca.gov/conditions-of-use); separately owned content can have different rights.
- [Santa Clara County local-road viewer](https://roads.santaclaracounty.gov/roads-and-traffic-info/view-live-traffic-cam-county-maintained-roads) embeds a [public county traffic viewer](https://saecommon.sccgov.org/drupalhtml/rda_map/SCCGOV_Live_Traffic.html) whose [location metadata](https://saecommon.sccgov.org/drupalhtml/rda_map/js/rda_live_traffic_locations_data.js) lists expressway intersections and directional views. These are additional local-road entries, with links to the official viewer. The media bridge uses a third-party credential. That credential, API responses, and media URLs are not reused or republished. Choose the named intersection and view on the county site. No verified individual-camera deep link is advertised.

The release covers participating public sources, not every camera installed in California.

## Discovery and reconciliation

`refresh-catalog.py` parses the twelve JSON links on the official CCTV source page, checks all districts 01–12 are present, and saves raw records. No ID scanning is used.

The original district fetch found 3,612 listed views (D01 149, D02 91, D03 274, D04 771, D05 181, D06 128, D07 592, D08 505, D09 23, D10 154, D11 324, D12 420). The official statewide map list contained 3,299 entries, all of whose snapshot slugs were already present in those district catalogs.

The GIS layer contained 2,936 records. The builder first requests all object IDs, then retrieves every ID in batches of 100 to avoid its record/URI limits. An ID absent from the current district catalog is not automatically a new view: endpoint aliases are identified first. New GIS endpoints are included only after a fresh bounded check succeeds, and are labeled `official-gis-supplement`. Once included, a temporarily failed refresh retains the prior stable view for saved-board identity and records the fresh reachability failure in reconciliation. These GIS metadata may be older than the district inventories. Final reconciliation, additions and retained/rejected candidates are recorded in the catalog.

The county metadata contains 126 intersection entries. One has only zero placeholders; after omitting these, 465 directional views remain at 125 source intersection groups. Zero IDs are never treated as feeds. These entries are labeled Official viewer, rather than promising embedded media.

## Identity and location semantics

- IDs are `caltrans:D01:<source-index>` or `sccroads:<public-view-id>` in the California catalog. Trip Desk adds `CA:`. Caltrans indices are unique only within their dataset/district.
- A documented Caltrans `-number` index suffix designates additional images at one location. It is preserved in the view ID and removed only for source-location grouping. Current district records need not contain any such suffix.
- County directional views group by the county intersection ID. Counts are source groups, not independently verified physical-device counts. Co-located source records are not arbitrarily collapsed.
- Coordinates are WGS84 decimal degrees. Invalid/absent coordinates remain searchable but are excluded from geographic matching. Original coordinates remain in saved raw records.
- The source county field is retained separately as `sourceCounty`. A 2026-11-04 audit found 18 Caltrans rows whose published county contradicted their coordinates (often a default `Alameda`). The explicit corrections in `geographic-overrides.json` use [US Census Geocoder county point lookups](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html), keep the original value and per-ID source URL, and apply only while both provider county and coordinates still match the verified record. The official [Caltrans district/county chart](https://cwwp2.dot.ca.gov/documentation/district-map-county-chart.html) was used to identify candidates, not to assign counties blindly: some valid cameras are served by a neighboring district. Stable camera IDs and locations are unchanged.
- `direction` is the Caltrans published travel-side field. `facingDirection` is a separate explicit “Looking …” label or a county view orientation. A county NB/EB view does not establish which travel lane is being observed.
- `nearbyPlace` is a provider nearby-place label derived from ZIP geography, not a verified city boundary. `county` and `district` remain provider jurisdictions. Display regions are editorial browsing groups defined in the refresh script, with explicit coordinate splits for large counties (Sacramento foothills/Tahoe, Antelope Valley, eastern Inland Empire). They are not formal metropolitan boundaries.
- Original road labels are retained as `sourceRoad`; SR-n becomes CA-n for consistent browsing. Local-road primary labels are separated from cross-street names.
- Elevation is in feet. Postmile and route suffix/alignment are preserved. Raw postmile resets by county and must not be used alone to sort an entire California highway. Route geometry in Trip Desk orders a journey instead.

## Time and availability

`recordTimestamp` describes the source catalog record. It is not an image capture time. The raw local date/time and provider epoch, when present, are preserved; epoch-derived UTC is `sourceUpdatedAt`. Viewer local source times use America/Los_Angeles, including daylight saving. Unknown image capture time stays unknown.

`inService` is the provider report, with false and unknown distinguished. It is independent of a dated media check: a working snapshot is not suppressed just because a stream failed, and a reachable audited image is retained even if service metadata reports false.

The first release used a partial manifest/structure audit. The stricter `audit-media.py` checks every listed unique HTTPS endpoint with bounded, resumable requests: actual snapshot pixel decoding, HLS master and child playlist parsing, a fetched media segment, and an FFmpeg frame decode where available. This is still not a blanket claim of browser playback; representative streams must be tested advancing in a browser. Exact numerator/denominator coverage, methods, failures and timestamps are in `auditCoverage` and `source-audit.json`. `mediaHealth.snapshot` and `.video` are independent per-view summaries. Results expire for display after seven days if successful or two days if failed. A dated, expired result becomes “Not recently checked.” See [feed reliability](reliability.md) for methods, cost and maintenance commands.

Known unavailable notices may be recognized by visually verified image hashes; unknown placeholders cannot be guaranteed detected. Identical bytes alone do not prove a frozen camera. HTTP Last-Modified is not substituted for source capture time. No separate feeds are claimed to be synchronized.

## Other sources investigated

- [City of Santa Clara stadium traffic cameras](https://www.santaclaraca.gov/our-city/santa-clara-stadium-authority/experience-levi-s-stadium/live-traffic-cameras): an official public page describes additional streets around Levi’s Stadium. The direct research fetch was HTTP 403. No unsupported media access or guessed coordinates were added.
- [511 SF Bay traffic data](https://511.org/open-data/traffic): the documented free API requires a token and defaults to 60 requests per 3,600 seconds. It offers incidents/work zones/tolls; this does not grant redistribution of all partner camera images. The [511 FAQ](https://511.org/about/faq) describes cameras as agency-provided feeds. No token or partner-media rights were assumed.
- [CRUZ511 camera information](https://bb.cruz511.org/drive/traffic-conditions/traffic-cameras/) links Caltrans cameras rather than a distinct public local-road inventory; avoid double counting.
- [San Diego 511](https://511sd.com/app) and [SoCal511](https://www.go511.com/) were inspected as regional viewer sources. Their camera presentation does not establish a separate reusable public catalog beyond the included Caltrans sources.
- LADOT ATSAC and city enforcement-camera inventories are not interchangeable with a public, reusable traffic-media feed. They were not imported as if they supplied public video.

## Chain controls and closures

[Caltrans chain controls](https://cwwp2.dot.ca.gov/chain-controls.html) provide no-charge HTTPS JSON with `Access-Control-Allow-Origin: *` for districts 1, 2, 3, 6, 7, 8, 9, 10 and 11, refreshed nominally once per minute. These are suitable for a lightweight on-demand browser integration without a key or relay. Some districts do not publish a chain-control feed; absence of a feed is not evidence of no restrictions.

The chain-control record publication time differs from `statusTimestamp`, which is the last status change and can be years old for an unchanged R-0. Display the provider status description and distinguish retrieval time, record time and last status change. Official status codes are defined by the linked [status chart](https://cwwp2.dot.ca.gov/documentation/cc/cc-chart.html); confirm current chart links before adding code-specific interpretations. Never infer restrictions from camera imagery.

[Lane closures](https://cwwp2.dot.ca.gov/lane-closure.html) also publish no-charge CORS-enabled district JSON, but scheduled start/end, indefinite closures and code1097/code1098 lifecycle fields need a separate active/planned interpretation. The release links [QuickMap](https://quickmap.dot.ca.gov/) and [current highway conditions](https://roads.dot.ca.gov/) instead of making an unverified comprehensive closure claim. Neither cameras nor routing estimates prove that a road is open. Proprietary Google traffic layers are not copied.

## Refresh and cost

From the maintained source directory:

```sh
python3 scripts/refresh-catalog.py
```

The older `refresh-catalog.py --audit` option is only a quick image-structure/HLS-manifest diagnostic. Its successes do not qualify for recently verified media filters. Use the decoded media audit below for visitor-facing health.

For a rebuild using saved source records (GIS supplemental checks and travel-source discovery still use the network):

```sh
python3 scripts/refresh-catalog.py --from-cache
```

For a full stronger media sweep followed by daily oldest-first maintenance batches, use:

```sh
python3 -m pip install -r scripts/requirements-audit.txt
python3 scripts/audit-media.py --output dist --workers 2 --request-gap 0.25
python3 scripts/audit-media.py --output dist --rotate-oldest --limit 1000 --workers 2 --request-gap 0.25
```

For a published checkout, replace `scripts/` with `_tools/` and `--output dist` with `--output .`; install from `_tools/requirements-audit.txt`. Published `camera-catalog.json`, `source-audit.json` and geographic overrides sit in the site root.

`--output /absolute/path` supports publishing tooling. The builder validates district structure before replacing raw records, and retains last-known-good records on network errors, invalid/empty responses, or an unreviewed loss of more than half a district’s records. The source manifest records per-district success, cached retention and errors. Partial failures remain visible in catalog metadata and do not silently erase a district. An initial build without any usable source for a district fails instead of publishing incomplete coverage.

Media is requested from Caltrans or viewed on the county’s official site. No new relay, Cloudflare Worker, R2 storage, API subscription, recording service or paid routing provider is required. GitHub Pages, public map tiles, routing and search each retain their own usage policies; zero incremental service subscriptions is not a promise of unlimited free capacity or uptime. Source catalogs require refresh; the dated static inventory does not update itself merely because media remains live.

## Release inventory and audit coverage

Catalog rebuilt **2026-11-04 06:20:14 UTC** from saved official source files. All twelve district catalogs had been fetched successfully between 03:23:45 and 03:23:53 UTC. A fresh official-catalog comparison around 04:00 UTC found the same 3,612 district IDs and media URLs. The media audit first reached full 5,964-key coverage at **06:14:45 UTC**; its later 30-stream continuation sample finished **06:18:52 UTC**. Individual endpoint check times vary across the sweep.

- **4,110 listed views**, **3,770 source-location groups**, all 4,110 with usable coordinates. The physical-device count is unknown.
- **3,645 Caltrans views**: 3,612 district entries plus 33 fresh-reachable GIS omission candidates. Of 49 GIS IDs absent from current district catalogs, 14 reused existing media endpoints; 35 distinct candidates were checked, 33 retained and two unreachable candidates excluded. Their older GIS origin remains explicit.
- **465 Santa Clara County views**, at 125 nonempty intersection groups, link to the official viewer. Source metadata has 126 rows; one row contains only zero placeholders.
- **3,645 snapshot capabilities**, **2,326 direct HLS capabilities**, and **465 official-viewer-only views**. Snapshot/video capabilities overlap and must not be summed as distinct camera totals.
- **5,964 of 5,964 unique listed media endpoints attempted** in the November 4 reliability audit: 3,645 image URLs and 2,319 video URLs. Some directional views share a video endpoint, so the 2,326 video-capable views are a different denominator. Per-endpoint results record independently decoded images, HLS playlist/segment checks, PNG-frame evidence where obtainable, known maintenance placeholders, failures and indeterminate checks. Exact status/method totals and dates are in `source-audit.json`.
- Of the **3,645 image endpoints**, **2,716 decoded to camera images**, **925 decoded to one of six visually verified Caltrans maintenance notices**, and **four returned HTTP errors** during the dated audit. An HTTP 200 for a notice is not a working snapshot. These are endpoint counts, not additional physical cameras.
- Of the **2,319 video endpoints**, **1,517 emitted a decoded PNG frame from HLS media**, **three had valid playlist/segment structure without a decoded frame**, **789 returned HTTP 404**, and **ten were indeterminate because listed segments could not be verified**. The 30-endpoint live-playlist sample obtained 27 follow-up playlists: 26 advanced their media sequence and one was inconclusive. These checks do not certify browser playback for every stream.
- At the view level, **2,747 of 4,110 views** have at least one recently decoded embedded method (2,716 decoded snapshots and 1,521 frame-decoded video views, with overlap). Twenty-nine video views had a frame-decoded HLS segment while their snapshot showed a maintenance notice; 263 snapshot views decoded while their video had no frame-decoded check. These counts are tied to this audit and expire visibly; frame decoding alone does not establish playback in every browser.

Before this repair, a partial structure/manifest sample had checked **1,358 of 5,964** endpoints at 03:30:33 UTC: 1,218 images (1,216 structurally available, two unavailable) and 140 HLS manifests (86 available, 54 unavailable). The remaining 4,606 had no dated audit. The full audit supersedes those weaker checks. It still does not claim that every video plays in a browser or that any source will stay available; representative advancing playback is tested separately. Six visually verified Caltrans maintenance-image variants are detected, while other placeholder designs may require future verification.
