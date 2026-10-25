# Camera Desk WV

Published at https://whardy.github.io/sandbox/wv511-camera-desk/

A responsive public WV511 camera viewer with ten videos per page, populated metro and regional groups, road filters, an interactive map and browser-local saved cameras. Native video controls stay hidden; muted inline playback or the explicit Start feed button handles mobile autoplay.

Camera locations and official stream hosts are checked at publication. Live HLS manifests and video load directly from WV511. Refresh checks the latest published metadata file; source catalog and player pages do not allow cross-origin browser requests. The visible check date is preserved. A playable URL is not a guarantee that a camera is currently online; LIVE appears only after playback begins.

The full dated camera ID audit is available in feed-audit.json. Existing sandbox/trafficCam and sandbox/ohio-road-atlas files are separate and unchanged.

This directory is a self-contained static production build. Keep index.html, assets/ and data/ together. It requires no API key, server or account.

Video and metadata: WVDOT / WV511 https://wv511.org/
Map: OpenStreetMap contributors, with attribution in the map.
