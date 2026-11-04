# Trip Camera Desk

Public site: https://whardy.github.io/sandbox/trip-camera-desk/

A responsive trip planner and public traffic-camera desk combining West Virginia, Ohio, Pennsylvania, Virginia, Texas, Maryland, Arizona, New York, California, Washington, Oregon, and the District of Columbia. The interface and dated camera metadata are static files hosted on GitHub Pages. Camera pictures and video load from their established sources.

## Use the desk

- **Plan:** choose a start, destination and up to six intermediate stops through manual place search, latitude/longitude entry, or map selection. Calculate real driving directions and select an alternative when available. A route corridor finds cameras across state lines, ordered by progress along the journey.
- **Route wall:** browse 25 camera views per page, with state, area, jurisdiction, road, media and dated-availability filters. Highway and direction filters apply to the selected trip stretch. Unknown direction is retained and labeled.
- **Look ahead:** move along the route to see nearby camera checkpoints and elapsed driving estimates. Representative selection picks cameras at intervals, with additional choices near routing-service highway junctions where camera coverage exists.
- **Watchboard:** pin views from multiple states, name boards, reorder or remove views, and start supported live video explicitly. Visible WV and supported California feeds also autoplay muted by default. Desktop defaults to two live slots; narrow screens default to one, with a selectable limit of one, two or four. Independent feeds are not synchronized.
- **Explore:** browse and map the full catalog without calculating a trip.
- **Saved trips:** keep up to 50 trips and 30 boards with up to 500 camera IDs per board in this browser. Export/import JSON to transfer them, or deliberately share a trip or board link. Large shares require JSON export instead of a URL.

The map clusters markers, highlights the selected route, shows a moving look-ahead position, and marks stretches without listed camera checkpoints. A marker near a road does not establish that the camera overlooks that road. Primary road references and published directional metadata produce stronger matches; crossing roads, parallel roads and unknown metadata remain labeled conservatively. Gap markings describe camera-location spacing, not continuous visual coverage of the pavement.

## Dated catalog and availability

The Oregon and Washington integration contains **20,927 views at 20,547 source-catalog locations** across 12 catalogs (11 states and DC). These are source/site identifiers, not independently deduplicated physical devices. Four views have no usable coordinates and remain searchable while excluded from geographic matching.

| Catalog | Source locations | Listed views | Latest dated availability check |
| --- | ---: | ---: | --- |
| West Virginia | 133 | 133 | 2026-10-25T19:31:43.296Z |
| Ohio | 1,154 | 1,158 | 2026-10-25T20:05:10.883693+00:00 |
| Pennsylvania | 1,564 | 1,564 | 2026-10-28T22:51:53.582674Z |
| Virginia | 1,722 | 1,722 | 2026-10-29T00:09:38.119456Z |
| Texas | 5,185 | 5,185 | 2026-10-29T00:07:53.621029Z |
| Maryland | 553 | 553 | 2026-11-03T23:00:54.397162Z |
| Arizona | 644 | 678 | 2026-11-03T23:00:44.555065Z |
| District of Columbia | 137 | 137 | 2026-11-03T23:14:02.604603+00:00 |
| New York | 2,863 | 2,863 | 2026-11-03T23:35:31Z |
| California | 3,770 | 4,110 | 2026-11-04T03:30:33Z |
| Washington | 1,645 | 1,645 | 2026-11-04T00:03:18.580670Z |
| Oregon | 1,177 | 1,179 | 2026-11-04T03:28:04.193798Z |

Media categories are configured capabilities: **6,474 video**, **12,831 snapshot**, **1,622 official**. A video-capable view may also provide a snapshot. These primary categories count each view once, and do not guarantee playback. Combined dated availability: 15,860 available, 1,195 unavailable, 51 stale, 1,557 official, 2,264 unchecked.

California contributes **4,110 views at 3,770 source location groups**: 3,645 Caltrans snapshot-capable views, including 2,326 configured HLS capabilities, and 465 Santa Clara County official-viewer views grouped at 126 intersections. The GIS comparison supplied 33 additional currently reachable views absent from the district files; their older GIS provenance remains explicit.

The California audit is a **dated partial sample**, completed 2026-11-04 03:30:33 UTC (November 3 Pacific time): 1,358 of 5,964 unique media endpoints checked, including 1,218 image checks and 140 HLS manifest checks. Manifest reachability is separate from browser decoding. Unchecked media remain explicitly unchecked, with no fabricated per-view check date. See the California source audit and `auditCoverage` in `data/index.json`. Source service status, media capability, and dated reachability remain independent.

Navigation may link additional state sites; `data/index.json` defines the catalogs actually combined by this release.

The source dates, per-media checks, overrides, counts and shard hashes are in `data/index.json` and the state shards. The build reuses existing checks; it does not perform a new full feed audit. Reloading refreshes visible images, not the catalog inventory. “Fetched” is browser retrieval time and does not establish capture time or freshness.

## Media delivery

West Virginia, Virginia, Maryland, New York and California support public HLS connections where available. Other states mainly provide refreshing snapshots and official-viewer links. Snapshots load only when visible, with at most four requests in progress and a minimum 60-second refresh interval. California nominal image update intervals are respected when longer. Oregon and Washington use five-minute source cadence, including failed-request retry spacing; offscreen active snapshots are canceled. Hidden tabs pause images and stop video. Videos stop when removed, closed, hidden or scrolled out of view; playback failure returns to a snapshot or source link.

Texas keeps its existing owned relay at `https://texas-camera-relay.wintrytiger33.chatgpt.site` for media already dependent on it. This site does not change that relay's deployment or allowlist. Austin sources retain direct delivery; external-only TranStar views remain official-viewer links. Publishing this directory cannot fix a separate relay or provider outage.

No media is stored in this repository. The release does not record footage or create an image-history archive. Mobile viewport testing does not substitute for testing on physical iOS hardware; native playback controls and a user-start action remain available for autoplay restrictions.

### WV and California autoplay

Visible WV and supported California feeds start muted and inline by default, including camera-wall previews, enlarged views and WV watchboard slots. Native controls are hidden for WV and California to avoid the large pause/play overlay; external Watch live/Stop video actions remain available. Other states retain their native controls and user-start behavior.

The separate **Autoplay WV** and **Autoplay CA** checkboxes remember their preferences in this browser. The established WV preference key is unchanged. Automatic previews share the existing global video-slot limit (two on desktop, one by default on narrow screens); manually selected streams take priority. Offscreen previews release their slots and resume when visible. Enlarging a camera pauses automatic previews behind the dialog. **Stop all** disables both autoplay preferences until deliberately enabled again. Individual visible previews expose a Stop video action. Dated failed California video checks retain snapshots and require an explicit video retry.

A browser autoplay rejection or source error suppresses automatic retries for that view. Use Watch live, Refresh now, or re-enable the relevant autoplay preference to retry. iOS power-saving and browser policies can still require a tap; the site keeps a user-start fallback instead of repeatedly requesting blocked playback. See [WebKit’s autoplay policy](https://webkit.org/blog/6784/new-video-policies-for-ios/).

## Routing, search and operating cost

Routing uses the public **Valhalla/FOSSGIS** service for light, user-triggered driving queries. Avoiding tolls and highways is a preference rather than a guarantee; unsatisfied preferences are surfaced from the returned route. Valhalla alternatives are supported for two-point trips, not trips with intermediate stops. Its hosted route-distance limit is **1,500 km**.

Longer ordinary trips use a labeled **OSRM/FOSSGIS** fallback. Its hosted profile does not support the tested toll/highway exclusions. Long trips with avoidance selected receive an explanation rather than silently discarding the choice. Both services return ordinary driving estimates without live-traffic ETAs. Camera images show current provider imagery, not predicted conditions at arrival.

Place search uses **Photon/komoot**, only after an explicit Search action. Selecting map points and entering coordinates remain available when place search is unavailable. The map uses **OpenStreetMap standard tiles** for normal interactive browsing.

These selected community services need **no API key or paid routing account** and impose no usage fee for this bounded light-use configuration. This is not an unlimited free-service guarantee. FOSSGIS limits requests to one per second and prohibits heavy use. The client serializes requests with at least 1.2-second spacing and caches repeated requests during the visit; Photon applies reasonable-use throttling without a fixed published quota. Per-browser controls cannot enforce an aggregate limit across every visitor. Increased public traffic requires switching to a dedicated provider or an appropriate backend/provider plan. Map and media providers may also limit access. Existing Texas relay hosting remains a separate dependency whose future pricing or quotas are not guaranteed here.

No new Cloudflare Worker, R2 storage, database, or credential is required for these connections. Endpoints are isolated in `routing.js`, with configurable compatible routing/search instances. A vendor using a different protocol requires a new adapter. No secrets belong in static files.

Place queries and route coordinates are sent to the selected service; camera and map requests contact their respective providers. Shared links contain the selected locations or camera IDs and should be reviewed before sharing. Saved trips and boards otherwise stay in local browser storage until exported or shared. Storage errors are reported with an export option.

## Source and maintenance

The maintained source for this published California integration is `california-camera-desk/.integration/trip-camera-desk/` in the existing camera-site workspace. No package installation or frontend build is needed. Node.js runs checks; Python 3 previews the static files and compiles metadata.

The maintained source for this California release is `california-camera-desk/.integration/trip-camera-desk/`. It was isolated from other concurrent state work to preserve the nine existing catalog IDs and add California only. From this release directory, rebuild the unified catalog:

```sh
python3 scripts/build-catalog.py
```

The compiler discovers the enclosing workspace’s `whardy-github-pages/` checkout or the enclosing published repository. California uses its maintained `california-camera-desk/dist/` catalog when present, with the published catalog as fallback. To use another checkout or output directory:

```sh
python3 scripts/build-catalog.py --repository /path/to/whardy.github.io --california-source /path/to/california-camera-desk/dist --output /path/to/output/data
```

Refresh and audit individual state catalogs with their own maintained tools first when new source data is required. Then rebuild the unified shards, run checks, review changed counts and dates, and publish the index and all changed shards together. The compiler preserves state/provider/view IDs, location IDs, primary-road versus crossing-road references, county/city/ward/borough distinctions, geographic overrides, and missing coordinates.

From the local project directory:

```sh
node scripts/check.mjs
node scripts/check-routing.mjs
node scripts/check-media.mjs
python3 scripts/check-data.py
node scripts/check-california.mjs
python3 -m http.server 4190 --bind 127.0.0.1 --directory dist
```

`node scripts/check-california.mjs --live` checks the five California trips, real route ordering, timed lookahead and California–Arizona coverage. It retains large response shapes only in a local `.route-check-cache/`, with the small report in `docs/california-route-validation.json`. `node scripts/check-routing.mjs --live` deliberately sends a small set of requests to the selected routing and search providers. Routine checks use only local data and synthetic geometry.

Publish `dist/` to `sandbox/trip-camera-desk/` in `whardy/whardy.github.io`, include this README in the published directory, and preserve vendor licenses. Existing state-site headers link to Trip Desk and California. Changes to their bundled headers require their own maintained build steps. Keep unrelated state projects and work intact.

## Primary sources

- [FOSSGIS routing policy](https://routing.openstreetmap.de/about.html) and [service overview](https://openstreetmap.de/nutzen/dienste-osm-de/)
- [Valhalla API and avoidance behavior](https://github.com/valhalla/valhalla/blob/master/docs/docs/api/route/api-reference.md)
- [OSRM API](https://project-osrm.org/docs/v5.24.0/api/)
- [Photon public-demo policy](https://github.com/komoot/photon#demo-server)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/) and [attribution](https://www.openstreetmap.org/copyright)
- [California Caltrans CCTV sources and fair-use policy](https://cwwp2.dot.ca.gov/closed-circuit-television-cameras.html) and [California Camera Desk](https://whardy.github.io/sandbox/california-camera-desk/)
- Individual state providers, catalog URLs and source-site links in [the data index](data/index.json)
- [Leaflet](https://leafletjs.com/) and [hls.js](https://github.com/video-dev/hls.js/)

Independent viewer; not an official transportation-agency or navigation service.

From the published bundle directory, the included catalog compiler can be run with explicit paths:

```sh
python3 _tools/build-catalog.py --repository ../.. --output data
```

Review all changed source dates and shard counts before committing. In a clone of `whardy.github.io`, `../..` from `sandbox/trip-camera-desk` is the repository root.

## Oregon and Washington integration

Oregon contributes 1,179 TripCheck views at 1,177 source-reported camera locations. These are not an independently verified physical-device count. The November 4 UTC audit decoded every listed image: 1,121 served camera imagery and 58 served verified provider offline cards, all with HTTP 200 responses. Availability remains dated; browser retrieval does not establish capture time. The one invalid source coordinate (view 4998, longitude 226) remains in lists and is excluded from maps and route matching.

TripCheck also lists neighboring-state cameras. Census county point-in-polygon enrichment identifies 1,131 Oregon views, 21 California, 18 Washington and eight Idaho; one view remains unlocated. Provider jurisdiction and physical state are separate fields. County-derived browsing areas are conveniences rather than official metro boundaries. Source viewing direction is retained separately; it is not treated as reliable traffic direction for route matching.

The standalone Washington catalog has 1,647 views. The hub counts 1,645 after reconciling two exact shared TripCheck image identities (Oregon views 4674 and 4676). The canonical Oregon views retain the old Washington IDs as aliases, including on shared-board and camera links. Different nearby pictures remain separate views. Neither source's standalone catalog is modified by hub reconciliation.

Oregon is snapshot-first. The public source lists 87 official rapid-image options, not verified embeddable continuous video. This release uses five-minute refreshing pictures and official TripCheck map links, preserves session restrictions, and does not add unofficial streams. Capture times are generally unknown. Last-daylight source links, when listed, are historical rather than current pictures. Camera courtesy of ODOT and TripCheck partner agencies: https://www.tripcheck.com/ . Source research and the bounded full-image audit are maintained by Oregon Camera Desk.

No Oregon API subscription, Worker, R2 bucket, database, or paid service is required for this release's public inventory and image delivery. Credentialed road/weather API layers remain separate; official TripCheck links provide those reports. The site's existing community routing, search and map reasonable-use limits continue to apply. Higher traffic may require a dedicated provider; free use is not unlimited.

From this published directory, run the included checks:

```sh
python3 _tools/check-catalog.py
node _tools/check-routing.mjs
node _tools/check-media.mjs
node _tools/check-media-california.mjs
node _tools/check-waypoints.mjs
```

Rebuild from a complete repository clone, with Oregon Camera Desk already present:

```sh
python3 _tools/build-catalog.py --repository ../.. --output data
```

For previewing a maintained catalog before publication, repeat `--state-source STATE=/absolute/catalog/directory` as needed. Publish the rebuilt index and changed shards together. The compiler requests no camera media.

Unconfirmed or partially edited route points remain off the map until validated. Find my route resolves typed coordinate pairs together; malformed saved trips are rejected before changing the active draft.

## Florida access

Florida Camera Desk uses FL511’s official embedded map and regional links. FL511’s published conditions require FDOT’s express written consent for independent reuse of its camera content. This Trip Desk release provides official Florida links for Florida route sections and Explore mode, but does not index, match, pin, or play individual FL511 cameras. FL511 views are not used in camera counts or coverage-gap calculations; Florida stretches may appear as gaps. Individual camera integration requires an applicable FDOT data/video agreement or another verified permitted source.

## Nevada catalog

Nevada is sourced from the public camera listing shown on [Nevada 511's CCTV page](https://www.nvroads.com/cctv), without a developer API key. The maintained Nevada refresh script pages that listing centrally and keeps the last good catalog on a failed fetch; visitors load the static Nevada shard from GitHub Pages. The published shard contains 651 views and 651 source parent IDs, all with coordinates, 628 advertised video URLs and 651 snapshot URLs. A 20-view media sample is dated in the Nevada site's `source-audit.json`; it is not a live guarantee. Nevada 511's published facing field is kept separate from Trip Desk traffic direction. I-11/I-515 and I-215/CC-215 remain distinct. The shared video manager gives visible Nevada HLS the same muted inline playback controls and stream budget used by WV and California. No credential, Worker, or relay is required for the current public listing.
