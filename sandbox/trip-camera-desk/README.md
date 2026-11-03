# Trip Camera Desk

Public site: https://whardy.github.io/sandbox/trip-camera-desk/

A responsive trip planner and public traffic-camera desk combining West Virginia, Ohio, Pennsylvania, Virginia, Texas, Maryland, Arizona, New York, and the District of Columbia. The interface and dated camera metadata are static files hosted on GitHub Pages. Camera pictures and video load from their established sources.

## Use the desk

- **Plan:** choose a start, destination and up to six intermediate stops through manual place search, latitude/longitude entry, or map selection. Calculate real driving directions and select an alternative when available. A route corridor finds cameras across state lines, ordered by progress along the journey.
- **Route wall:** browse 25 camera views per page, with state, area, jurisdiction, road, media and dated-availability filters. Highway and direction filters apply to the selected trip stretch. Unknown direction is retained and labeled.
- **Look ahead:** move along the route to see nearby camera checkpoints and elapsed driving estimates. Representative selection picks cameras at intervals, with additional choices near routing-service highway junctions where camera coverage exists.
- **Watchboard:** pin views from multiple states, name boards, reorder or remove views, and start supported live video explicitly. Desktop defaults to two live slots; narrow screens default to one, with a selectable limit of one, two or four. Independent feeds are not synchronized.
- **Explore:** browse and map the full catalog without calculating a trip.
- **Saved trips:** keep up to 50 trips and 30 boards with up to 500 camera IDs per board in this browser. Export/import JSON to transfer them, or deliberately share a trip or board link. Large shares require JSON export instead of a URL.

The map clusters markers, highlights the selected route, shows a moving look-ahead position, and marks stretches without listed camera checkpoints. A marker near a road does not establish that the camera overlooks that road. Primary road references and published directional metadata produce stronger matches; crossing roads, parallel roads and unknown metadata remain labeled conservatively. Gap markings describe camera-location spacing, not continuous visual coverage of the pavement.

## Dated catalog and availability

The November 3, 2026 unified build contains **13,993 views at 13,955 source-catalog locations**. These are source/site identifiers, not independently deduplicated physical devices. Three views have no usable coordinates and remain available in lists while being excluded from geographic matching.

| Catalog | Locations | Views | Latest source availability check |
| --- | ---: | ---: | --- |
| West Virginia | 133 | 133 | October 25, 2026 |
| Ohio | 1,154 | 1,158 | October 25, 2026 |
| Pennsylvania | 1,564 | 1,564 | October 28, 2026 |
| Virginia | 1,722 | 1,722 | October 29, 2026 |
| Texas | 5,185 | 5,185 | October 29, 2026 |
| Maryland | 553 | 553 | November 3, 2026 |
| Arizona | 644 | 678 | November 3, 2026 |
| District of Columbia | 137 | 137 | November 3, 2026 |
| New York | 2,863 | 2,863 | November 3, 2026 |

The build records **4,148 video-capable views, 8,688 snapshot views, and 1,157 official-viewer entries**. Capability describes the configured connection, not a promise of current playback. Dated combined availability records 11,920 available, 945 unavailable, 36 stale, and 1,092 official-only views. Official-only capability and availability can differ when a provider marks an external entry disabled.

The source dates, per-media checks, overrides, counts and shard hashes are in `data/index.json` and the state shards. The build reuses existing checks; it does not perform a new full feed audit. Reloading refreshes visible images, not the catalog inventory. “Fetched” is browser retrieval time and does not establish capture time or freshness.

## Media delivery

West Virginia, Virginia, Maryland and New York support established public HLS connections where available. Other states mainly provide refreshing snapshots and official-viewer links. Snapshots load only when visible, with at most four requests in progress and a 60-second refresh interval. Hidden tabs pause images and stop video. Videos stop when removed, closed, hidden or scrolled out of view; playback failure returns to a snapshot or source link.

Texas keeps its existing owned relay at `https://texas-camera-relay.wintrytiger33.chatgpt.site` for media already dependent on it. This site does not change that relay's deployment or allowlist. Austin sources retain direct delivery; external-only TranStar views remain official-viewer links. Publishing this directory cannot fix a separate relay or provider outage.

No media is stored in this repository. The release does not record footage or create an image-history archive. Mobile viewport testing does not substitute for testing on physical iOS hardware; native playback controls and a user-start action remain available for autoplay restrictions.

## Routing, search and operating cost

Routing uses the public **Valhalla/FOSSGIS** service for light, user-triggered driving queries. Avoiding tolls and highways is a preference rather than a guarantee; unsatisfied preferences are surfaced from the returned route. Valhalla alternatives are supported for two-point trips, not trips with intermediate stops. Its hosted route-distance limit is **1,500 km**.

Longer ordinary trips use a labeled **OSRM/FOSSGIS** fallback. Its hosted profile does not support the tested toll/highway exclusions. Long trips with avoidance selected receive an explanation rather than silently discarding the choice. Both services return ordinary driving estimates without live-traffic ETAs. Camera images show current provider imagery, not predicted conditions at arrival.

Place search uses **Photon/komoot**, only after an explicit Search action. Selecting map points and entering coordinates remain available when place search is unavailable. The map uses **OpenStreetMap standard tiles** for normal interactive browsing.

These selected community services need **no API key or paid routing account** and impose no usage fee for this bounded light-use configuration. This is not an unlimited free-service guarantee. FOSSGIS limits requests to one per second and prohibits heavy use. The client serializes requests with at least 1.2-second spacing and caches repeated requests during the visit; Photon applies reasonable-use throttling without a fixed published quota. Per-browser controls cannot enforce an aggregate limit across every visitor. Increased public traffic requires switching to a dedicated provider or an appropriate backend/provider plan. Map and media providers may also limit access. Existing Texas relay hosting remains a separate dependency whose future pricing or quotas are not guaranteed here.

No new Cloudflare Worker, R2 storage, database, or credential is required for these connections. Endpoints are isolated in `routing.js`, with configurable compatible routing/search instances. A vendor using a different protocol requires a new adapter. No secrets belong in static files.

Place queries and route coordinates are sent to the selected service; camera and map requests contact their respective providers. Shared links contain the selected locations or camera IDs and should be reviewed before sharing. Saved trips and boards otherwise stay in local browser storage until exported or shared. Storage errors are reported with an export option.

## Source and maintenance

The editable local project is `trip-camera-desk/` in the existing camera-site workspace. No package installation or frontend build is needed. Node.js runs checks; Python 3 previews the static files and compiles metadata.

From the workspace root, rebuild only the unified catalog from the nine maintained published bundles:

```sh
python3 trip-camera-desk/scripts/build-catalog.py
```

The default source repository is the sibling `whardy-github-pages/` checkout. To use another checkout or output directory:

```sh
python3 trip-camera-desk/scripts/build-catalog.py --repository /path/to/whardy.github.io --output /path/to/output/data
```

Refresh and audit individual state catalogs with their own maintained tools first when new source data is required. Then rebuild the unified shards, run checks, review changed counts and dates, and publish the index and all changed shards together. The compiler preserves state/provider/view IDs, location IDs, primary-road versus crossing-road references, county/city/ward/borough distinctions, geographic overrides, and missing coordinates.

From the local project directory:

```sh
node scripts/check.mjs
node scripts/check-routing.mjs
python3 -m http.server 4190 --bind 127.0.0.1 --directory dist
```

`node scripts/check-routing.mjs --live` deliberately sends a small set of requests to the selected routing and search providers. Routine checks use only local data and synthetic geometry.

Publish `dist/` to `sandbox/trip-camera-desk/` in `whardy/whardy.github.io`, include this README in the published directory, and preserve vendor licenses. The nine existing site headers link to Trip Desk. Changes to their bundled headers require their own maintained build steps. Keep unrelated state projects and work intact.

## Primary sources

- [FOSSGIS routing policy](https://routing.openstreetmap.de/about.html) and [service overview](https://openstreetmap.de/nutzen/dienste-osm-de/)
- [Valhalla API and avoidance behavior](https://github.com/valhalla/valhalla/blob/master/docs/docs/api/route/api-reference.md)
- [OSRM API](https://project-osrm.org/docs/v5.24.0/api/)
- [Photon public-demo policy](https://github.com/komoot/photon#demo-server)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/) and [attribution](https://www.openstreetmap.org/copyright)
- Individual state providers, catalog URLs and source-site links in [the data index](data/index.json)
- [Leaflet](https://leafletjs.com/) and [hls.js](https://github.com/video-dev/hls.js/)

Independent viewer; not an official transportation-agency or navigation service.

From the published bundle directory, the included catalog compiler can be run with explicit paths:

```sh
python3 _tools/build-catalog.py --repository ../.. --output data
```

Review all changed source dates and shard counts before committing. In a clone of `whardy.github.io`, `../..` from `sandbox/trip-camera-desk` is the repository root.
