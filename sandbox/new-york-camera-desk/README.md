# New York Camera Grid

Responsive traffic camera viewer for the public 511NY catalog, published at https://whardy.github.io/sandbox/new-york-camera-desk/.

The dated catalog includes every publicly listed 511NY camera with a location inside the official New York county polygons. It keeps separate views where a location has more than one. Source feeds come from NYSDOT and NYC DOT. The page offers nine populated area groups, county/borough, corridor, agency, feed-status and text filters; saved cameras; 25 feeds per page; wall, split and map layouts; still refresh; and on-demand HLS video. It is an independent viewer and does not record feeds.

## How delivery works

GitHub Pages serves the site files and a dated JSON catalog. The visitor's browser loads still images directly from the URLs published in the public 511NY map. For video, native Safari HLS or locally vendored hls.js fetches NYSDOT's public HLS stream only when the visitor selects **Watch live**. There is no relay, API key, database or paid runtime. Only visible stills refresh, at most four at once, every 60 seconds while the tab is active. “Fetched” is the browser retrieval time, not capture time.

## Refresh and check

```sh
python3 _tools/refresh-catalog.py --audit
node _tools/check.mjs
python3 -m http.server 4187 --bind 127.0.0.1
```

`_tools/refresh-catalog.py` gets the official 511NY public map inventory and New York State county polygons. It excludes out-of-state and invalid positions. `--audit` checks each direct image URL and each HLS master playlist with six workers, writes `dist/source-audit.json`, and stores dated statuses in `dist/camera-catalog.json`. Statuses are point-in-time responses, not guarantees that the content is a current road scene or that a stream will continue playing. The catalog does not automatically discover new locations after publication; rerun the script and publish the updated JSON files. The official feed may change its schema or delivery rules.

`node _tools/check.mjs` validates URLs, geographic grouping, audit coverage, filtering, pagination, and local assets. Browser QA should check a still from each source, actual HLS playback, the map and filters, and mobile layout.

## Sources

- [511NY public traffic map](https://511ny.org/map)
- [511NY public camera map data](https://api-511x-nysdot.carsprogram.org/cameras/map-features)
- [New York State county boundaries](https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Civil_Boundaries/FeatureServer/2)
- [NYC DOT camera information](https://www.nyc.gov/html/dot/html/motorist/atis.shtml)
- [Leaflet](https://leafletjs.com/) and [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)

Camera feeds remain with their source agencies. Saved camera IDs remain in the visitor's browser. This project stores only a camera directory and dated availability check, not photos or video.
