# Oregon integration validation — November 4, 2026 UTC

- Twelve source catalogs:20,927 unique namespaced views,20,547 source locations,20,923 valid positions and four unlocated views retained in lists. Source hashes/counts, relay preservation and legacy WV IDs passed.
- Oregon1179views/1177sourcelocations;1121imagery and58verifiedoffline cards in the source's complete bounded audit. All1179returnedHTTP200 and decoded; availability uses content evidence rather than status alone. One invalid source longitude remains unmapped.
- Washington1647standalone views becomes1645unique hubviews after exact TripCheck image identity reconciliation for4674and4676. Alias IDs and their canonical-shard loading passed. Nearby different images remain separate.
- OR/ORE/Oregon and WA/Washington road-reference normalization, primary versus crossing-road refs, projection ordering, time interpolation, missing positions, uncertainty and coverage-gap checks passed. Oregon viewing orientation is not treated as traffic direction.
- The actual shared media manager passed muted-inline/no-controls WV autoplay, global capacity/manual priority, blocked/source failure guards, Stop all, modal scope and disposal regression tests. Oregon snapshots passed300second success/failure cadence, capture-time-unknown labeling, maximumfourimage requests, offscreen cancellation and hidden-tab cleanup.
- Live route-provider checks by the release owner include Portland–Seattle (approximately181mi,433nearbyOR/WAviews), shortPortland (approximately1.8mi,56views), Bend–KlamathFalls (approximately138mi,31views) and sparseLakeview–JordanValley (approximately276mi,10views). Coverage gaps remain visible. These are ordinary driving estimates, without live traffic.
- All ten existing state navigation releases include Oregon and preserve prior state/Trip links. WV/OH were rebuilt from isolated maintained-source copies; the concurrently published California site and hub integration were preserved in this release.
- Browser verification and published screenshots are recorded by the release owner. A viewport test does not establish physical iOS behavior. Oregon contributes snapshots and official viewers; no new Oregon continuous-video integration is claimed.

The following records describe the earlier base release, not new availability guarantees.

# Historical base-release validation — November 3, 2026

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

Route-draft regression: actual map controller rejects null/blank/NaN/infinite coordinates before Leaflet, retains destination marker labels, safely accepts partially edited start/destination fields, and validates saved trips. Actual application helper resolves both typed coordinate pairs in a single submission. CA media regression checks preserve independent autoplay preferences, snapshot fallback, and nominal source intervals.
