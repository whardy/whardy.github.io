# Routing and place search — checked November 3, 2026

## Selected services

The default is the public FOSSGIS Valhalla driving service at `https://valhalla1.openstreetmap.de/route`. It needs no API key and accepts browser requests with CORS. The browser sends the identifying `X-Client-Id: whardy.github.io/sandbox/trip-camera-desk` header. A preflight check returned CORS permission for that header.

Valhalla supports driving through intermediate stops, up to two requested alternatives for two-point trips, and `use_tolls: 0` / `use_highways: 0` preferences. These preferences attempt avoidance; they do not guarantee it. The returned route carries `has_toll` / `has_highway` flags, and the adapter attaches route-specific warnings when an avoidance preference is not satisfied. Alternatives are not available with intermediate stops on this service.

The hosted Valhalla service has a **1,500 km route-distance limit** (verified HTTP 400, provider error 154). For longer ordinary trips the adapter uses the public FOSSGIS OSRM driving service at `https://routing.openstreetmap.de/routed-car/route/v1/driving/`. Its hosted profile does not accept the toll/highway exclusion combination tested. Long trips with an avoidance preference return an explicit explanation rather than dropping that preference. The fallback is labeled OSRM in the UI and response; it is not advertised as equivalent to Valhalla.

Neither selected routing service provides live-traffic ETAs in this implementation. Durations come from ordinary driving estimates. Camera elapsed-time labels interpolate actual returned maneuver/step durations, rather than assuming a uniform speed across a trip.

Place search uses the public Photon demo at `https://photon.komoot.io/api/`. It needs no API key and returned CORS `*`. The app uses explicit searches, no background autocomplete, and caches repeated queries in the current visit. Photon permits reasonable project use, throttles extensive use, and offers no availability guarantee or fixed published request quota.

The public Nominatim service was considered but not selected. Its current policy includes specific restrictions on generated generic search services and an aggregate limit across an application's users. Photon is a separate service with its own policy, even though its underlying database originates from OpenStreetMap.

## Limits and cost

- These community endpoints charge no usage fee for the selected bounded use. They have no SLA and are not an unlimited hosting plan.
- FOSSGIS specifies a maximum of one request per second and no heavy usage. The adapter serializes routing requests with a minimum 1.2-second spacing. Photon searches use the same conservative per-browser interval.
- These browser controls do not enforce a global quota across all visitors. The release is intended for low-volume personal use. If public usage grows, switch to a dedicated or commercial provider, or use an appropriately configured shared backend and provider plan.
- User-selected places and trip coordinates are sent to the relevant service. Saved trips and boards are otherwise stored locally.
- FOSSGIS/Valhalla maintainers request end-user apps notify them through GitHub Discussions. No notification or other third-party message has been posted by the agent. The identifying header is included.
- No API key, paid account, Cloudflare Worker, or R2 bucket is required for these selected routing connections. Existing Texas camera media requirements are independent.

Endpoints are configurable through `configureProviders()` or a separately loaded `providers.json`, and routing/search adapters are isolated in `routing.js`. Compatible hosted instances can be substituted without changing the product UI. A different vendor protocol needs an adapter. The service configuration should be changed before heavier use, rather than treating throttling as extra capacity.

## Verification

Live browser-compatible HTTP requests and the module's live test suite verified:

- Photon place search for Columbus, Ohio.
- A short Washington, DC driving route: 2.7 km.
- Columbus → Wheeling → Washington, DC with an intermediate stop and toll avoidance: 668.8 km.
- Columbus → Washington, DC with two alternatives: recommended route 655.0 km.
- Phoenix → Washington, DC through OSRM: 3,705.6 km, two routes.

Responses were normalized with full geometry, road references and timed steps. Matching all 11,130 catalog views against the 7,787-point Columbus route took about 42 ms and found 244 nearby views in a one-mile corridor. The 29,845-point Phoenix route matched 489 views in about 73 ms. Those are local observed timings, not performance guarantees.

The deterministic checks cover timed interpolation, cross-state IDs, primary-road versus crossing-road metadata, opposite-direction metadata, missing coordinates, route-order ties on loops, coverage gaps, and representative-camera selection. Coverage gaps describe a distance threshold between listed camera positions, not the camera's actual field of view or continuous visual coverage.

## Primary documentation

- [FOSSGIS service overview](https://openstreetmap.de/nutzen/dienste-osm-de/)
- [FOSSGIS routing policy](https://routing.openstreetmap.de/about.html)
- [Valhalla demo server and client identification](https://github.com/valhalla/valhalla#demo-server)
- [Valhalla route API and avoidance preferences](https://github.com/valhalla/valhalla/blob/master/docs/docs/api/route/api-reference.md)
- [OSRM route API](https://project-osrm.org/docs/v5.24.0/api/)
- [Photon demo policy](https://github.com/komoot/photon#demo-server)
- [Nominatim policy reviewed but not used](https://operations.osmfoundation.org/policies/nominatim/)
