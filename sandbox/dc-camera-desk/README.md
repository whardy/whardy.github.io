# District / Camera Desk

Public site: https://whardy.github.io/sandbox/dc-camera-desk/

A static District of Columbia traffic-camera wall and map with 25 views per page, quadrant, ward and road filters, search, saved cameras, and dated image-availability filters. Shared URLs preserve filters and the selected camera; saved IDs stay in the visitor’s browser.

## Direct media delivery

The catalog contains 137 DDOT views published in TrafficView’s public DC map extent. Snapshots load directly from `https://cctv.trafficview.org/thumbnail/<camera-id>`. No relay, chatgpt.site service, paid backend, API key, database, scheduled collector, or archived imagery is needed. Only public DDOT identifiers returned by the map are included; physical camera inventory without public media is not counted as a feed.

Images refresh every 60 seconds while visible, with four concurrent browser requests. Hidden tabs pause refresh; an expanded camera pauses grid requests. **Fetched** is browser retrieval time, not capture time. Source images are low-resolution thumbnails (usually 320 × 240) and can be delayed, corrupted or offline.

This page displays snapshots. **Open in TrafficView** opens the official map near the camera location; enable its camera layer and select the named camera for the official live viewer. The link does not automatically select a camera. TrafficView uses a custom live-video player rather than published HLS feeds. No vendor player code or signed credentials are copied into this site.

## Geography and feed checks

All 137 catalog positions match official DC quadrant and 2022 ward polygons. Filters cover four quadrants and eight wards. Boundary labels follow reported coordinates; source camera names are retained even where their written quadrant differs. Road groups use the first street in each name; search also matches crossing roads. Nearby Maryland and Virginia cameras are on their separate sites.

The November 3, 2026 audit checked all 137 thumbnails: 59 usable snapshots and 78 unavailable at the check (69 timeouts, three provider notices, four gray frames, two corrupted frames). All 59 usable samples were fully decoded and visually reviewed. Available views are sorted first; the complete catalog remains searchable.

Fresh audits check every published thumbnail with a 20-second timeout and four workers. Usable responses require TrafficView’s `Valid-Thumbnail: True` header and full JPEG decoding. Known visually verified provider notices, gray frames, and corruption are rejected. Valid JPEGs and source status do not prove a fresh scene; new frozen or corrupted frames may evade detection. Audit counts describe that check, not a guarantee of current availability. Catalog and audit dates are displayed on the page.

## Development and maintenance

The frontend needs no package installation or build. Use Node.js for checks, Python 3 for preview and metadata, and Pillow for fresh image audits.

```sh
node scripts/check.mjs
python3 -m http.server 4186 --bind 127.0.0.1 --directory dist
python3 scripts/refresh-catalog.py --audit
```

The refresh script POSTs the same public camera-map query used by TrafficView, selects DDOT IDs, downloads official boundary polygons, and rebuilds the catalog and audit. It does not use the separate developer-key API. Review and publish changed JSON together. No automated maintenance schedule is configured.

Publish `dist/` to `sandbox/dc-camera-desk/` in `whardy/whardy.github.io`, preserving vendor licenses. Copy the maintenance script to `_tools/refresh-catalog.py`. From the published directory, use `python3 _tools/refresh-catalog.py --output . --audit`.

## Sources

- [MATOC traveler information and TrafficView](https://matoc.org/travel-info/)
- [Official TrafficView map](https://www.trafficview.org/live_traffic/)
- [TrafficView introduction](https://www.trafficview.org/introduction/)
- [DC quadrant boundaries](https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/11)
- [DC wards from 2022](https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/53)
- [Leaflet](https://leafletjs.com/) and [OpenStreetMap](https://www.openstreetmap.org/copyright)

Independent viewer; not an official DDOT or MATOC service. Browser requests contact TrafficView and OpenStreetMap. No sign-in or camera recording is provided.
