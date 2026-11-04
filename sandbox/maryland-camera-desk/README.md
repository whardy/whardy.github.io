# Maryland / Camera Desk

Public website: https://whardy.github.io/sandbox/maryland-camera-desk/

A static Maryland traffic-camera explorer with 25 cameras per page, six CHART regions, county/city and road filters, search, saved cameras, dated feed-availability filters, and a clustered map. Camera and filter selections can be shared through the page URL. Favorites stay in the visitor's browser.

## Map and camera preview

Selecting a marker or camera opens a persistent preview beside the map. Selecting from the wall enters Split view and preserves the current filters and page. The selected card and map marker (or its cluster) are highlighted. Visible wall snapshots continue refreshing while a preview is open.

In desktop Split view the camera list scrolls independently beneath the preview, so cards remain selectable while the map and selected feed stay visible.

On desktop, drag the divider to resize the map and camera panel. Focus the divider and use Left/Right (Shift for larger steps), Home/End for the width limits, or Enter to reset. Double-click the divider or choose **Reset layout** for the default 46% map width. The preferred width stays in local browser storage. Resizing keeps the geographic map center and does not reset pagination.

At phone and tablet widths the preview becomes a bottom sheet. Collapse or expand it with its handle button, or drag the handle down/up; map gestures remain available outside the sheet. Collapse stops live video. Escape closes the preview when focus is inside it; the map remains available to keyboard navigation without a modal focus trap.

## Media delivery

Snapshots load directly from `chart.maryland.gov`. They refresh every 60 seconds while visible; hidden tabs pause automatic refresh and the image queue permits four concurrent requests. Thumbnails can be delayed. “Fetched” describes browser retrieval, not image capture time.

Open a camera and choose **Watch live** for its public HLS video. One stream plays at a time using native HLS or vendored hls.js. Switching cameras, closing or collapsing the preview, choosing Snapshot, or hiding the tab stops video. Stream failures return to a snapshot and an explanation. Native player controls remain available; mobile layout has been tested in a browser viewport, not on physical iOS hardware.

The page runs entirely on GitHub Pages. It needs no relay, API key, account, database, scheduled collector, or paid hosting service. Images and video are fetched from Maryland's servers and are never committed to this repository. No recording or history archive is provided.

## Catalog and checks

The November 3, 2026 catalog contains 553 public CHART camera views. Six browsing regions follow CHART's source categories: Annapolis, Baltimore, Eastern Shore, Southern Maryland, Washington suburbs, and Western Maryland. These are regional groupings, not statistical metro boundaries.

County labels use point-in-polygon matches against all 24 official Maryland county and Baltimore City boundaries. There are 546 assigned camera locations. Seven bridge/border points remain unassigned; they are still searchable and appear on the map. Routes come from source route fields, with descriptions as a fallback. Cameras on local roads remain included.

Every snapshot and HLS master was checked. The dated audit recorded 528 usable snapshot responses and 25 unavailable, blank, placeholder, or corrupted images. It found 536 valid video playlists with browser CORS and 17 unavailable playlists. A child playlist and MPEG-TS segment were verified on each of the three streaming hosts. Representative browser playback was also verified.

HTTP success and playlist availability do not guarantee a fresh scene or uninterrupted playback. Known error-image hashes are rejected, but new provider notices or frozen scenes can still appear. Audit statuses remain dated until the catalog is refreshed. Source communication status is recorded separately and does not automatically disable a camera that can still respond.

## Sources

- [CHART public data feed documentation](https://chart.maryland.gov/DataFeeds/GetDataFeeds)
- [Official camera catalog](https://chart.maryland.gov/DataFeeds/GetCamerasJson)
- [Official camera directory and public players](https://chart.maryland.gov/TrafficCameras/GetTrafficCameras)
- [Maryland political boundaries](https://mdgeodata.md.gov/imap/rest/services/Boundaries/MD_PoliticalBoundaries/FeatureServer/1)
- [Leaflet](https://leafletjs.com/), [hls.js](https://github.com/video-dev/hls.js), and [OpenStreetMap](https://www.openstreetmap.org/copyright)

The official player publishes unsigned HTTPS HLS addresses on `strmr3.sha.maryland.gov`, `strmr5.sha.maryland.gov`, and `strmr10.sha.maryland.gov`. Only those source hosts are accepted. No signed access tokens or private device addresses are used. The site is independent and is not an official MDOT service.

## Development and maintenance

No dependency installation or build is required. From the local project:

```sh
python3 scripts/refresh-catalog.py --audit
node scripts/check.mjs
python3 -m http.server 4182 --bind 127.0.0.1 --directory dist
```

The refresh script requires Python 3 and curl and fetches the public catalog and official boundaries. `--audit` checks all public images and playlists with four workers and samples one segment per successful streaming host. It does not record video. `--review-images` writes temporary image samples for manual inspection; they are not part of the website.

Publish the contents of `dist/` to `sandbox/maryland-camera-desk/` in `whardy/whardy.github.io`, including the vendor licenses. Copy the maintenance script to `_tools/refresh-catalog.py`. From the published repository directory, refresh with:

```sh
python3 _tools/refresh-catalog.py --output . --audit
```

Review the changed catalog and audit and commit them to publish. No automated refresh schedule is configured. Browser requests contact Maryland's media hosts and OpenStreetMap tile servers; the page uses system fonts.
