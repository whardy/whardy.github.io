# Trip Camera Desk

Public site: https://whardy.github.io/sandbox/trip-camera-desk/

A responsive trip planner and public traffic-camera desk combining 13 states—West Virginia, Ohio, Pennsylvania, Virginia, Texas, Maryland, Arizona, New York, California, Washington, Oregon, Nevada, and Florida—plus the District of Columbia. The interface and dated camera metadata are static files hosted on GitHub Pages. Camera pictures and video load from their established sources.

## Use the desk

- **Plan:** choose a start, destination and up to six intermediate stops through manual place search, latitude/longitude entry, or map selection. Calculate real driving directions and select an alternative when available. A route corridor finds cameras across state lines, ordered by progress along the journey.
- **Route wall:** browse 25 camera views per page, with state, area, jurisdiction, provider, district, road, media and dated-availability filters. Highway and direction filters apply to the selected trip stretch. Unknown direction is retained and labeled.
- **Look ahead:** move along the route to see nearby camera checkpoints and elapsed driving estimates. Representative selection picks cameras at intervals, with additional choices near routing-service highway junctions where camera coverage exists.
- **Watchboard:** pin views from multiple states, name boards, reorder or remove views, and start supported live video explicitly. Eligible WV, California and Nevada feeds also autoplay muted by default. Florida autoplay is available only for videos with verified direct playback; none are marked eligible in the current Florida shard. Desktop defaults to two live slots; narrow screens default to one. Independent feeds are not synchronized.
- **Explore:** browse and map the full catalog without calculating a trip.
- **Saved trips:** keep up to 50 trips and 30 boards with up to 500 camera IDs per board in this browser. Export/import JSON to transfer them, or deliberately share a trip or board link. Large shares require JSON export instead of a URL.

The map clusters markers, highlights the selected route, shows a moving look-ahead position, and marks stretches without listed camera checkpoints. A marker near a road does not establish that the camera overlooks that road. Primary road references produce stronger matches; crossing roads, parallel roads and unknown metadata remain labeled conservatively. FL511's listed direction is not documented as traffic direction, so Florida route labels do not claim same or opposite traffic direction. Gap markings describe camera-location spacing, not continuous visual coverage of the pavement.

## Dated catalog and availability

The current `data/index.json` contains **26,569 listed views at 26,189 source-catalog locations** across 14 catalogs (13 states and DC). These are source/site identifiers, not independently verified physical devices. Four views have no usable coordinates and remain searchable while excluded from geographic matching. Florida contributes 4,991 listed views at 4,991 source-site locations; its physical-device count is unknown.

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
| California | 3,770 | 4,110 | 2026-11-04T06:18:52Z (full sweep completed 06:14:45Z) |
| Washington | 1,645 | 1,645 | 2026-11-04T00:03:18.580670Z |
| Oregon | 1,177 | 1,179 | 2026-11-04T03:28:04.193798Z |
| Nevada | 651 | 651 | 2026-11-04T03:50:55.203472Z |
| Florida | 4,991 | 4,991 | 2026-11-04T04:27Z (four-image sample) |

Media categories are configured capabilities: **7,102 video**, **17,845 snapshot**, **1,622 official**. A video-capable view may also provide a snapshot. These primary categories count each view once, and do not guarantee playback. Combined dated availability: 17,368 available, 1,975 unavailable, 51 stale, 1,557 official, 5,618 unchecked. California counts only decoded snapshots or decoded video frames as available; an HLS playlist or segment structure alone remains unchecked for playback. Florida's 4,991 primary categories are snapshots; its listed HLS URLs are not directly playable from this site's origin.

California contributes **4,110 views at 3,770 source location groups**: 3,645 Caltrans snapshot-capable views, including 2,326 configured HLS capabilities, and 465 Santa Clara County official-viewer views grouped at 126 intersections. The GIS comparison supplied 33 additional currently reachable views absent from the district files; their older GIS provenance remains explicit.

California keeps separate, dated video and snapshot health for each media URL. The full unique-endpoint audit checks decoded snapshots and HLS playlists, segments, and decoding where available; an HTTP response or manifest alone never qualifies as playable video. The California feed filter defaults to **Working here** (decoded image or video that advanced in this browser), with separate choices for decoded video checks, snapshots, expired or unchecked checks, unavailable sources, and official viewers. Static results expire; browser playback results apply only to this visit. See the California source audit and `auditCoverage` in `data/index.json` for exact dated coverage. A daily bounded workflow rotates through endpoints without deleting prior checks on a partial refresh. Provider service status, media capability, and browser playback remain independent.

Navigation may link additional state sites; `data/index.json` defines the catalogs actually combined by this release.

The source dates, per-media checks, overrides, counts and shard hashes are in `data/index.json` and the state shards. The build reuses existing checks; it does not perform a new full feed audit. Reloading refreshes visible images, not the catalog inventory. “Fetched” is browser retrieval time and does not establish capture time or freshness.

## Media delivery

West Virginia, Virginia, Maryland, New York, California and Nevada support public HLS connections where available. Florida uses direct FL511 snapshots and its official viewer for video; the public FL511 HLS paths require origin-bound authorization that was not available for this GitHub Pages origin. Snapshots load only when visible, with at most four requests in progress and a minimum 60-second refresh interval. Florida uses a 120-second cadence without an unapproved cache-busting query. California nominal image update intervals are respected when longer, and failed snapshots back off for at least five minutes unless a visitor chooses Refresh now. Oregon and Washington use five-minute source cadence, including failed-request retry spacing; offscreen active snapshots are canceled. Hidden tabs pause images and stop video. Videos stop when removed, closed, hidden or scrolled out of view; playback failure returns to a snapshot or source link.

Texas keeps its existing owned relay at `https://texas-camera-relay.wintrytiger33.chatgpt.site` for media already dependent on it. This site does not change that relay's deployment or allowlist. Austin sources retain direct delivery; external-only TranStar views remain official-viewer links. Publishing this directory cannot fix a separate relay or provider outage.

No media is stored in this repository. The release does not record footage or create an image-history archive. Mobile viewport testing does not substitute for testing on physical iOS hardware; native playback controls and a user-start action remain available for autoplay restrictions.

### Autoplay and media limits

Visible WV, supported California and Nevada feeds start muted and inline by default, including camera-wall previews, enlarged views and watchboard slots. Florida uses the same playback controls only when a direct video is verified and allowed; this release has none. Native controls are hidden for these inline feeds to avoid the large pause/play overlay; external Watch live/Stop video actions remain available. Other states retain their native controls and user-start behavior.

Separate state autoplay checkboxes remember preferences in this browser. The established WV and California keys remain unchanged. Automatic previews share the existing global video-slot limit (two on desktop, one by default on narrow screens); manually selected streams take priority. Florida's provider limit defaults to two desktop streams and one narrow-screen stream unless a lower source limit is supplied. Offscreen previews release their slots and resume when visible. Enlarging a camera pauses automatic previews behind the dialog. **Stop all** disables autoplay preferences until deliberately enabled again. Individual visible previews expose a Stop video action. Dated failed video checks retain snapshots and require an explicit retry.

A browser autoplay rejection or source error suppresses automatic retries for that view. Use Watch live, Refresh now, or re-enable the relevant autoplay preference to retry. iOS power-saving and browser policies can still require a tap; the site keeps a user-start fallback instead of repeatedly requesting blocked playback. See [WebKit’s autoplay policy](https://webkit.org/blog/6784/new-video-policies-for-ios/).

## Routing, search and operating cost

Routing uses the public **Valhalla/FOSSGIS** service for light, user-triggered driving queries. Avoiding tolls and highways is a preference rather than a guarantee; unsatisfied preferences are surfaced from the returned route. Valhalla alternatives are supported for two-point trips, not trips with intermediate stops. Its hosted route-distance limit is **1,500 km**.

Longer ordinary trips use a labeled **OSRM/FOSSGIS** fallback. Its hosted profile does not support the tested toll/highway exclusions. Long trips with avoidance selected receive an explanation rather than silently discarding the choice. Both services return ordinary driving estimates without live-traffic ETAs. Camera images show current provider imagery, not predicted conditions at arrival.

Place search uses **Photon/komoot**, only after an explicit Search action. Selecting map points and entering coordinates remain available when place search is unavailable. The map uses **OpenStreetMap standard tiles** for normal interactive browsing.

These selected community services need **no API key or paid routing account** and impose no usage fee for this bounded light-use configuration. This is not an unlimited free-service guarantee. FOSSGIS limits requests to one per second and prohibits heavy use. The client serializes requests with at least 1.2-second spacing and caches repeated requests during the visit; Photon applies reasonable-use throttling without a fixed published quota. Per-browser controls cannot enforce an aggregate limit across every visitor. Increased public traffic requires switching to a dedicated provider or an appropriate backend/provider plan. Map and media providers may also limit access. Existing Texas relay hosting remains a separate dependency whose future pricing or quotas are not guaranteed here.

No new Cloudflare Worker, R2 storage, database, or credential is required for these connections. Endpoints are isolated in `routing.js`, with configurable compatible routing/search instances. A vendor using a different protocol requires a new adapter. No secrets belong in static files.

Place queries and route coordinates are sent to the selected service; camera and map requests contact their respective providers. Shared links contain the selected locations or camera IDs and should be reviewed before sharing. Saved trips and boards otherwise stay in local browser storage until exported or shared. Storage errors are reported with an export option.

## Source and maintenance

The maintained frontend, compiler, tests and published shard files live in this `sandbox/trip-camera-desk/` directory of `whardy/whardy.github.io`. This static frontend has no package installation or build step. Refresh source catalogs with each state site's maintained tools first. Florida's bounded catalog refresh and dated media audit are documented in [Florida's source audit](../florida-camera-desk/docs/source-audit.md); it retains last-known-good data on failure. The Trip compiler reads the validated Florida shard without reinterpreting FL511's direction or media fields. A missing or invalid Florida shard makes the unified build fail instead of silently removing the state.

From a complete repository clone, stage a unified rebuild in a temporary directory and inspect the totals before copying its index and changed shards into `sandbox/trip-camera-desk/data/`:

```sh
python3 sandbox/trip-camera-desk/_tools/build-catalog.py --repository . --output /tmp/trip-catalog-review
python3 sandbox/florida-camera-desk/_tools/check-catalog.py
python3 sandbox/trip-camera-desk/_tools/check-catalog.py
node sandbox/trip-camera-desk/_tools/check-florida.mjs
node sandbox/trip-camera-desk/_tools/check-routing.mjs
node sandbox/trip-camera-desk/_tools/check-media.mjs
node sandbox/trip-camera-desk/_tools/check-waypoints.mjs
```

For a different source directory, pass `--state-source STATE=/absolute/catalog/directory`; the Florida override accepts its validated `data/FL.json`. The compiler requests no camera media. Publish `index.json` with every changed shard so its hashes and totals remain consistent. `node sandbox/trip-camera-desk/_tools/check-florida-routes.mjs` makes a deliberately small set of live FOSSGIS requests and writes [the dated route report](docs/florida-route-validation.json). It checked Tampa–Orlando, Miami–Key West, Jacksonville–Miami, Pensacola–Jacksonville, Miami–Washington DC, dense Miami, sparse rural Florida, Georgia-only coverage, and an Orlando–Sanford route past two directional views at one coordinate. Routing summaries are ordinary estimates and not traffic aware.

## Primary sources

- [FOSSGIS routing policy](https://routing.openstreetmap.de/about.html) and [service overview](https://openstreetmap.de/nutzen/dienste-osm-de/)
- [Valhalla API and avoidance behavior](https://github.com/valhalla/valhalla/blob/master/docs/docs/api/route/api-reference.md)
- [OSRM API](https://project-osrm.org/docs/v5.24.0/api/)
- [Photon public-demo policy](https://github.com/komoot/photon#demo-server)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/) and [attribution](https://www.openstreetmap.org/copyright)
- [California Caltrans CCTV sources and fair-use policy](https://cwwp2.dot.ca.gov/closed-circuit-television-cameras.html) and [California Camera Desk](https://whardy.github.io/sandbox/california-camera-desk/)
- [FL511 cameras](https://www.fl511.com/cctv), [official Florida conditions](https://www.fl511.com/) and [Florida source audit](../florida-camera-desk/docs/source-audit.md)
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

## Florida catalog and access

The project owner confirmed permission for individual Florida traffic-camera content. The current Florida shard holds 4,991 FL511-listed snapshots from FDOT districts, Florida's Turnpike Enterprise, Central Florida Expressway Authority, Greater Miami Expressway Agency, and listed local/partner groups. Each has a stable `FL:<provider>:<source-id>` identity. These records participate in Trip's filters, route wall, map, lookahead, representative selection, coverage gaps, saved boards, sharing and JSON import/export. Source locations equal 4,991; physical-device identity is not verified. FL511's listed direction is searchable but does not establish traffic travel or camera-facing direction. Florida road and county-road references keep an FL namespace, and the state boundary prevents a nearby Georgia route from acquiring Florida views.

The 2026-11-04 UTC audit visually checked three roadway snapshots and one offline card; the remaining 4,987 image views were unchecked for visual availability at that date. FL511's public viewer lists 4,372 HLS URLs, but its origin-bound authorization did not grant playback to `whardy.github.io`, so Trip does not publish these as direct video URLs. Visitors can watch direct snapshots here and open the official FL511 viewer for video and current conditions. Browser retrieval time is distinct from capture time, which FL511 did not verify. The Florida snapshot cadence is 120 seconds while visible, with provider caching respected. See [the Florida source audit](../florida-camera-desk/docs/source-audit.md) for provider counts, media evidence, source dates, limits and recovery steps. A whardy-origin allowlist or separately approved video delivery endpoint is needed before direct Florida HLS can be enabled.

## Nevada catalog

Nevada is sourced from the public camera listing shown on [Nevada 511's CCTV page](https://www.nvroads.com/cctv), without a developer API key. The maintained Nevada refresh script pages that listing centrally and keeps the last good catalog on a failed fetch; visitors load the static Nevada shard from GitHub Pages. The published shard contains 651 views and 651 source parent IDs, all with coordinates, 628 advertised video URLs and 651 snapshot URLs. A 20-view media sample is dated in the Nevada site's `source-audit.json`; it is not a live guarantee. Nevada 511's published facing field is kept separate from Trip Desk traffic direction. I-11/I-515 and I-215/CC-215 remain distinct. The shared video manager gives visible Nevada HLS the same muted inline playback controls and stream budget used by WV and California. No credential, Worker, or relay is required for the current public listing.
