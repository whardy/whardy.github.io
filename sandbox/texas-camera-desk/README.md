# Lone Star / Camera Desk

Published Texas camera viewer: https://whardy.github.io/sandbox/texas-camera-desk/

This directory is the static GitHub Pages bundle. It includes 25-camera pagination, metro/region, county, road and feed-type filters, search, favorites and a map. Saved cameras stay in the visitor’s browser.

TxDOT ITS snapshots are served through the owned [Texas Camera Relay](https://texas-camera-relay.wintrytiger33.chatgpt.site). Austin street images load directly from the City of Austin. Houston entries open the official district viewer because [TranStar requires permission for external image linking](https://traffic.houstontranstar.org/disclaimer.aspx).

Visible images refresh every 60 seconds. The catalog and audit are dated files; fetched time does not mean capture time. Source images can be delayed, offline or unavailable. The catalog has 5,185 unique camera views across 25 metro/regional groups. Regions follow TxDOT district groupings and include surrounding communities.

## Refresh the published data

From this directory, with Python 3:

```sh
python3 _tools/refresh-catalog.py --output . --audit --audit-txdot
python3 _tools/enrich-counties.py --catalog camera-catalog.json --output county-overrides.json
```

The refresh checks published camera addresses, validates images and known placeholders, and uses official TxDOT county boundaries for missing classifications. It does not record video or run on a schedule. Review and commit the changed data files. New TxDOT camera IDs must also be added to the separate relay’s allowlist and deployed there; publishing this directory alone does not update the relay. Full editable source and checks are maintained in the local `texas-camera-desk` project and the relay’s Sites source repository.

## Sources

- [TxDOT public cameras](https://www.txdot.gov/discover/live-traffic-cameras.html)
- [City of Austin camera inventory](https://data.austintexas.gov/Transportation-and-Mobility/Traffic-Cameras/b4k4-adkb)
- [TxDOT county boundaries](https://maps.dot.state.tx.us/arcgis/rest/services/Boundaries/MapServer/1)
- [Leaflet](https://leafletjs.com/) and [OpenStreetMap](https://www.openstreetmap.org/copyright)

Independent viewer; not an official TxDOT service.
