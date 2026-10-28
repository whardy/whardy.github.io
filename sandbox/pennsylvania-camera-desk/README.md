# Keystone / Camera Desk

Responsive, static Pennsylvania traffic camera viewer for GitHub Pages.

Public URL: https://whardy.github.io/sandbox/pennsylvania-camera-desk/

## Features

- 25 camera views per page; search and metro/region, county, and road filters.
- Wall, split, and map layouts with clustered, keyboard-accessible markers.
- Favorites stored only in this browser and shareable URLs for filters/cameras.
- Public 511PA snapshots, fetched at most four at a time, with visible images
  refreshing every 60 seconds. Hidden tabs pause; unavailable source-disabled
  cameras are labeled without repeated image requests.
- Enlarged snapshots and per-camera links to official 511PA video. This static
  site does not request, retain, or publish video authorization tokens.

## Data and limitations

The initial October 28, 2026 catalog includes 1,564 sites/views. The full image
audit found 1,435 usable snapshots, 118 officially disabled views, and 11
additional unavailable/blank/placeholder images. These are dated observations,
not guaranteed current availability. HTTP 200 alone does not imply a usable
camera image. Source images may be stale or show new fault notices.

Catalog: https://511pa.com/cctv and the public `/List/GetData/Cameras` endpoint.
Image URLs: `https://511pa.com/map/Cctv/{viewId}`. Official camera links follow
511PA's own `/map#camera-{siteId}` format. Images permit direct browser display;
metadata lacks cross-origin fetch access and is saved during the refresh step.

Metadata remains dated until a maintainer rebuilds it. Refreshing the website
loads the most recently published catalog, not new source metadata. Images
load directly from the source, independently of that catalog.

Metro groups are explicit county-based browsing areas, not official metro
boundaries. 78 missing weather-camera counties were matched to official
PennDOT county polygons using point-in-polygon checks. Two Ohio border feeds
and two cameras without valid coordinates remain separately listed. Missing
coordinates are excluded from the map, not invented.

County boundaries:
https://gis.penndot.pa.gov/gis/rest/services/opendata/countyboundary/MapServer/0

511PA allows at most eight simultaneous video streams. This viewer opens no
video automatically; its official video links open 511PA in another tab.

No recorder, historical archive, server, paid service, or recurring job is part
of this website. It uses no private account data or credentials.

## Local development

No package installation or build is required. The `dist/` folder is the site.
Node is needed only for the validation script; Python 3 runs catalog updates
and the development server.

```sh
python3 scripts/refresh-catalog.py --audit
python3 scripts/enrich-counties.py
node scripts/check.mjs
python3 -m http.server 4178 --bind 127.0.0.1 --directory dist
```

Run refreshes deliberately; `--audit` fetches each public snapshot once with
four workers. It does not record a sequence or access the video service.

Publish the contents of `dist/` to `sandbox/pennsylvania-camera-desk/` in
`whardy/whardy.github.io`. Assets use relative paths. Include `.nojekyll`.
The deployed `_tools/` folder contains maintenance scripts in the repository;
they are never executed by GitHub Pages.

## Refresh from the GitHub repository

From `sandbox/pennsylvania-camera-desk/`:

```sh
python3 _tools/refresh-catalog.py --audit --output .
python3 _tools/enrich-counties.py --catalog camera-catalog.json --output county-overrides.json
```

Review the changed JSON before committing it. A new deployment is needed to
publish the new metadata. No scheduled refresh has been configured.

Leaflet 1.9.4 is vendored with its license. Map tiles are supplied by
OpenStreetMap, with attribution displayed on the map. Typography uses Google
Fonts with system-font fallbacks. No camera image files are committed.
