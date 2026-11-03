# Desert / Camera Desk

Published site: https://whardy.github.io/sandbox/arizona-camera-desk/

Arizona camera explorer with 25 views per page, city/area, county, road and image-status filters, search, favorites, and wall/split/map layouts. Includes 644 AZ511 camera locations and 678 distinct views. The November 3, 2026 audit checked every image endpoint: 585 camera images and 93 provider unavailable notices.

Images load directly from AZ511. No relay, account, developer key, database, or server function is required. The public AZ511 configuration currently disables video, so the site displays refreshing snapshots with official camera links. Visible images refresh every 60 seconds with four concurrent requests; hidden tabs pause. Fetched time describes retrieval, not capture time. No images are recorded or archived.

City/area choices follow AZ511 groupings and are not official metropolitan boundaries. County names are checked against all 15 official Arizona State Land Department county polygons hosted by AZGEO. This corrected 89 labels and filled 34 missing values, using reported camera coordinates. Original source labels remain in the catalog and county evidence. Only populated choices appear.

The catalog, audit, and county overrides are dated static files. Reloading refreshes pictures but does not discover new cameras. Availability can change. Saved IDs stay in the visitor's browser; URL sharing preserves filters and selected cameras, not the saved-camera list.

## Refresh data

From this published directory:

```sh
python3 _tools/refresh-catalog.py --output . --audit
python3 _tools/enrich-counties.py --catalog camera-catalog.json --output county-overrides.json
```

The refresh uses the public website list and independently checks map IDs; it does not call the separate key-required developer API. All image addresses come from published views. Four workers check JPEG/PNG signatures, dimensions and known unavailable notices. Review and commit all three data files together. Full source, checks, and preview scripts are maintained in the local `arizona-camera-desk` project.

## Sources

- [AZ511 camera list](https://az511.gov/cctv) and [map](https://az511.gov/)
- [Documented camera view URL schema](https://az511.gov/help/endpoint/cameras)
- [AZGEO / Arizona State Land Department county boundaries](https://www.arcgis.com/home/item.html?id=545fc0393f0747cb9665848a75f9b23c)
- [ADOT AZ511 information](https://azdot.gov/adot-az511)
- [Leaflet](https://leafletjs.com/) and [OpenStreetMap](https://www.openstreetmap.org/copyright)

Independent viewer; not an official ADOT service. Vendor licenses are retained in the bundle.
