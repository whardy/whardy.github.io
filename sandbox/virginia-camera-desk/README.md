# Virginia / Camera Desk

Responsive, static Virginia traffic camera viewer for GitHub Pages.

Public URL: https://whardy.github.io/sandbox/virginia-camera-desk/

## Features

- 25 cameras per page with search, metro/region, county/city, and road filters.
- Wall, split, and map layouts, clustered markers, and map-area filtering.
- Favorites saved in the current browser; shareable camera and filter URLs.
- Direct public snapshots with four concurrent image requests at most.
  Only visible images refresh, every 60 seconds; hidden tabs pause refresh.
- On-demand public HLS video, one camera at a time, with native inline playback
  or vendored hls.js. Closing a camera, returning to snapshot, or hiding the tab
  stops playback. Errors return to the snapshot with a retry explanation.

## Sources and scope

The October 28, 2026 catalog has 1,722 camera entries, including interstates,
state routes, and local streets. It comes from the official public Virginia511
GeoJSON layer:

https://511.vdot.virginia.gov/services/511/map/layers/map/cams

The separate public `/services/511/map/array/cameras` directory was checked and
contains the same camera IDs. The site includes the public source catalog;
it does not claim access to private or unlisted agency feeds.

Snapshots load directly from `snapshot.vdotcameras.com`. Public HTTPS HLS
streams come from `media-sfs1` through `media-sfs8.vdotcameras.com`. No video
authorization tokens or account credentials are requested, stored, or published.
Native media controls are available during video; snapshot cards are ordinary
images and have no video pause overlay.

The dated `source-audit.json` records snapshot validation and HLS manifest
availability. The initial audit found 1,667 usable snapshots and 55 unavailable
or visibly corrupt images. Of 1,722 standard HLS playlists, 1,660 responded
successfully; 55 timed out and seven returned HTTP 404. One segment from each
of the eight video hosts was fetched successfully. Those are observations at
the audit time; they do not guarantee future or continuous availability.
Structural image checks and known provider error-card hashes
reject some unavailable frames; a successful check does not prove that a
scene is fresh or that every frame is visually correct. Limited stream samples
check one media segment per source host. This is not continuous monitoring.

Camera metadata stays dated until a maintainer rebuilds the catalog. Reloading
the page fetches the published catalog, not new source metadata. Images and
video load independently from their source. “Fetched” is the browser retrieval
time, not the camera's capture time.

County and independent-city filters use point-in-polygon matches against
official Virginia locality boundaries, rather than regional source labels
such as “Richmond” or “Salem.” Source:

https://services.dwr.virginia.gov/arcgis/rest/services/Public/VA_Counties_Jurisdictions/MapServer/0

Metro/region groups are curated browsing areas, not official statistical
metropolitan boundaries. Only groups containing cameras appear. Border and
unlocated cameras remain separately browsable. One invalid source coordinate
is excluded from the map, without guessing a corrected location.

Official camera links center the Virginia511 map near the camera; they do not
promise to open a camera popup. Saved cameras remain local to the browser.
No recording, historical archive, paid service, or scheduled job is included.

## Development and checks

No package installation or build is required. `dist/` contains the whole site.
Python 3 runs maintenance and the local server; Node runs the filter/data check.

```sh
python3 scripts/refresh-catalog.py --audit
python3 scripts/enrich-counties.py
node scripts/check.mjs
python3 -m http.server 4178 --bind 127.0.0.1 --directory dist
```

Run audits deliberately: they fetch every public snapshot and HLS master with
four workers, plus small video samples. They do not record a video sequence.
Inspect counts, unresolved geography, feed errors, and representative browser
playback before publishing.

Publish `dist/` to `sandbox/virginia-camera-desk/` in `whardy/whardy.github.io`.
Assets use relative paths. Include `.nojekyll`. The published `_tools/` directory
contains maintenance source; GitHub Pages does not execute these scripts.

To refresh from the repository's `sandbox/virginia-camera-desk/` directory:

```sh
python3 _tools/refresh-catalog.py --audit --output .
python3 _tools/enrich-counties.py --catalog camera-catalog.json --output county-overrides.json
```

Review and commit the changed JSON to deploy it. No scheduled update is configured.

Leaflet and hls.js are vendored with their licenses. OpenStreetMap supplies map
tiles with visible attribution. Fonts use Google Fonts with system fallbacks.
Camera images and video are never committed to the repository.
