# Nevada Camera Desk

Independent static viewer for the public [Nevada 511 camera listing](https://www.nvroads.com/cctv). Public URL: https://whardy.github.io/sandbox/nevada-camera-desk/ . Nevada is also included in [Trip Camera Desk](https://whardy.github.io/sandbox/trip-camera-desk/).

## Source and scope

The catalog refresh uses the public list requested by Nevada 511's own `/cctv` page, `https://www.nvroads.com/List/GetData/Cameras`. This is a public listing endpoint, separate from the [documented developer API](https://www.nvroads.com/developers/doc) that requires a key and states ten calls per 60 seconds. No API key is used or exposed. The public listing may change without notice or contain fewer views than the developer API. The browser fetches only the generated catalog from GitHub Pages; it never requests the authenticated catalog.

The current catalog has 651 listed view records at 651 source parent IDs. These are catalog identities, not independently verified physical devices. All 651 rows have coordinates, 628 advertise HLS URLs, and all 651 advertise snapshot URLs. Provider `Enabled` does not establish that media works now. `Direction` means camera facing in the published schema; it is not traffic travel direction. Capture times are unknown. A dated, stratified sample audit is in `source-audit.json`; it never treats a returned HLS manifest as proof of decoded video. The site does not record video or keep image history.

Locations use Nevada county and Carson City boundaries from [US Census TIGERweb](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer). A nearby place is an approximate nearest named place within 25 km, never an official city claim. Regions are derived for browsing. I-11 and I-515 labels remain separate; so do I-215 and CC-215. Source road wording remains searchable.

## Refresh and validation

From the workspace root:

```sh
python3 nevada-camera-desk/scripts/refresh-catalog.py
python3 nevada-camera-desk/scripts/audit-media.py --sample 20
node nevada-camera-desk/scripts/check.mjs
python3 trip-camera-desk/scripts/build-catalog.py --state-source NV=nevada-camera-desk/dist --state-source OR=oregon-camera-desk/dist
node trip-camera-desk/scripts/check.mjs
```

The refresh requests at most 100 parent records per public-list page, waits six seconds between pages, retries bounded transient failures and `429` using `Retry-After`, and atomically replaces the catalog only after complete count and ID validation. A failed refresh keeps the last good file. `--from-cache nevada-camera-desk/data/nv511-public-list.json` rebuilds from a locally saved public-list cache; it still requests current county boundaries. The raw listing cache is not published. Run media audits sparingly: the 20-view sample makes at most 40 media requests and is a historical sample, not a guarantee for every view.

## Viewing and cost

GitHub Pages serves static HTML, JavaScript and JSON. No Cloudflare Worker or paid key is required for this release. Map tiles use the [OpenStreetMap standard tile service](https://operations.osmfoundation.org/policies/tiles/), intended for normal interactive browsing and subject to its usage policy. Video and visible snapshots load directly from Nevada 511; video uses muted inline HLS where the browser and provider permit it. The page defaults to one live slot on a narrow screen and two on desktop, with four selectable on desktop. Snapshots refresh no faster than five minutes per visible view. Live media bandwidth depends on the number of active streams and the provider's encoding; the site has no fixed or unlimited capacity guarantee. At higher traffic, tile, media and catalog access need their own provider arrangements.

Official conditions and camera links: [Nevada 511](https://www.nvroads.com/), [NDOT cameras](https://www.dot.nv.gov/travel-info/road-conditions/traffic-cameras), [RTC FAST](https://www.rtcsnv.com/traffic-cams/watch-live/). RTC FAST and NDOT direct users toward Nevada 511 for overlapping cameras, so this release does not add their listings as duplicate views.
