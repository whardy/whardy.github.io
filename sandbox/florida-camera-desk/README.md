# Florida Camera Desk

Static Florida traffic-camera landing page for the `whardy.github.io/sandbox/florida-camera-desk/` directory. Publish the contents of `dist/` to that directory.

The page uses Florida 511's [official map embed](https://www.fl511.com/Map/EmbeddedMapSetup). It does not copy FL511 camera records, thumbnails, or streams. FL511's [published conditions](https://www.fl511.com/privacy) say service content requires FDOT's express written consent for reuse; the embed is offered publicly for websites in [FL511's About page](https://www.fl511.com/about). Independent camera cards and Trip Camera Desk camera IDs require separate permission or another independently licensed source.

The map embed uses the documented `/Map/EmbeddedMap` URL. Official region codes are `ALL`, `CEN`, `NE`, `NW`, `SE`, `SW`, and `TB`. The Keys shortcut uses the official embed builder's latitude/longitude/zoom mode. Camera markers are always on; optional map layers are closures, incidents, and drawbridges. Changing a region updates the `?region=` query so Trip Camera Desk can link to a Florida region.

The site has no build step, API credentials, data storage, or background media polling. Its map availability depends on FL511.

See `docs/sources.md` and `docs/validation.md` for the source-permission audit and test record.
