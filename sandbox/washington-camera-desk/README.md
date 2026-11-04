# Washington Camera Desk

A static Washington traffic-camera viewer for GitHub Pages, using public WSDOT snapshots and official camera links.

Published location: `https://whardy.github.io/sandbox/washington-camera-desk/`

## Interface

- Camera wall, map, and split view, with 25 camera views per page.
- Area, county, road, and dated feed-status filters; search and browser-local saved cameras.
- Road filtering includes alternate route labels where multiple catalog entries refer to the same image.
- Visible snapshots refresh every five minutes, matching the interval documented by WSDOT's viewer. The manual refresh button requests visible images immediately.
- Hidden tabs stop automatic refresh; an expanded camera pauses background card loading. At most four image requests run at once.
- Map clusters, camera selection, optional map-area filtering, keyboard access, and responsive phone layouts.
- Shareable filter, layout, page, and selected-camera URLs.

## Preview and maintenance

This published directory is a buildless GitHub Pages site. To preview a local copy, run `python3 -m http.server 4193` from this directory and open `http://127.0.0.1:4193/`.

The catalog and feed audit are dated files. Images load directly from the source. Refresh metadata and check every distinct image with:

```sh
python3 _tools/refresh-catalog.py --output . --audit
# Recheck images using the current catalog:
python3 _tools/refresh-catalog.py --output . --audit-only
```

Commit and push the resulting JSON files to update the public catalog. The script uses Python's standard library and no access keys. Review the reported changes and availability results before publishing. New source placeholder designs may require updating the known-notice hashes after visual verification.

## Source and freshness

WSDOT supplies the [Travel Center camera list](https://wsdot.com/travel/real-time/service/api/Camera), [map camera data](https://data.wsdot.wa.gov/travelcenter/Cameras.json), coordinates, and official viewer links. The refresh combines the list with map-only Washington entries, merges duplicate image URLs, and keeps alternate names, IDs, and roads. Counties are assigned using the [WSDOT Travel Center boundaries](https://services.arcgis.com/IYrj3otxNjPsrTRD/arcgis/rest/services/Travel_Center_Boundaries/FeatureServer/0). Unmatched county coordinates remain blank. Images come from WSDOT and the partner sources listed in its catalog. Area labels are browsing groups rather than official metropolitan boundaries. The source audit records availability when it runs; it cannot guarantee that an image depicts current conditions. “Fetched” in the interface records browser retrieval time rather than camera capture time. The source may return an older photo, an unavailable notice, or a failed request.

This viewer contains no relay, video recorder, server, analytics, or access keys. It is independent of WSDOT. Saved cameras stay in the current browser. Map tiles come from OpenStreetMap, with attribution. Leaflet is vendored under its included license.
