# Release validation — November 3, 2026

- Unified catalog checks: 13,993 views, 13,955 namespaced source locations, 13,990 usable coordinates, three unmapped views retained. Source hashes, geography overrides, media URLs, WV joins, and Texas relay preservation passed.
- Geometry checks: cross-state identity, ordered route projection, timed interpolation, primary versus crossing-road metadata, opposite/unknown directions, loops, gaps, representative selection and missing coordinates passed.
- Live service checks: short DC drive, Columbus–Wheeling–DC with a stop, Columbus–DC with alternatives, and Phoenix–DC through the long-distance fallback passed. Provider limits and ordinary ETA labels are surfaced.
- Browser route: Columbus–DC, approximately 407 miles / 6h36m, three returned choices and 245 nearby listed views. Alternative selection, 50% lookahead (199mi / about3h8m on the alternative), interval sampling, 25/16-card pagination, and selected-route labels passed.
- Browser input: real Photon place results, explicit result selection, numeric-coordinate stop entry/removal, and map point selection passed. Map picking works over existing markers as well as map background.
- Saved data: save/load, deliberate share link and recipient loading, JSON export/download/import, pinning, reordering, camera removal, named-board creation/rename, and deletion of a test board passed. Unit checks cover import bounds, malformed data, Unicode, capacity preservation and storage failures.
- Live media: Virginia `3432` and Maryland `89006627008a00be005ed336c4235c0a` decoded simultaneously in the browser; both reached readyState4 with advancing time (320×240 and640×480). A failed WV stream returned a fallback/official-viewer path. Video is stopped when hidden, removed, or scrolled out of view. Native iOS playback is supported in code; physical iOS hardware was not available.
- Added New York: Grand Central Parkway camera35784 decoded at640×480, readyState4 and advancingtime31s. Its catalog adds2,863views, with independent video and snapshot check labels.
- Network observation: four visible DC camera-image requests were observed with a maximum of four concurrent requests; no offscreen camera wall was fetched wholesale.
- Keyboard: camera dialog Escape and focus restoration after pinning passed.
- Mobile: 320px page, planner, camera dialog, source actions, nine state links and conservative one-video default passed without horizontal overflow.
- Existing site navigation: all eight sites retain their nine state links and add Trip Desk. Each ten-link header fits320px with no horizontal overflow. WV/OH builds and all seven static-site checks passed.

Feed checks are observations, not guarantees. This release reuses the dated source audits instead of running a new mass media audit. Public-service requests remain bounded, user-triggered, and subject to the published provider policies.
