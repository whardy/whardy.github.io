# Ohio Road Atlas

Public OHGO traffic camera explorer, hosted at:
https://whardy.github.io/sandbox/ohio-road-atlas/

- 25 camera locations per page by default, with metro/region, county and road filters.
- Refreshing JPEG snapshots, favorites saved in your browser, and an interactive map.
- Fetches current public OHGO camera and region metadata directly in the browser.
- Uses a dated bundled catalog when OHGO metadata cannot be reached. Image audit dates remain explicit.

This directory contains the self-contained static production build. It requires no API key, server or login. Keep index.html and assets/ together. Existing trafficCam pages are separate and unchanged.

Data: https://www.ohgo.com/ and contributing agencies.
Camera API documentation: https://publicapi.ohgo.com/docs/v1/cameras
Map: OpenStreetMap contributors, with attribution in the map.
