# Florida Camera Desk validation

Checked 2026-11-03 (Eastern time). Live-source observations can change; they are not availability guarantees.

## Official FL511 embed

- A browser loaded the official statewide iframe with clustered camera markers and FL511's own map controls on the local GitHub Pages preview.
- Selecting Tampa Bay changed the page URL to `?region=tampa-bay` and the embedded map to FL511's `region=TB` view. The Keys shortcut used FL511's chosen-location mode.
- A camera marker opened an FL511 popup with a snapshot. Its **Show Video** action produced a playing 1280 × 720 video in the official iframe (`readyState=4`, advancing playback time). This establishes representative browser playback for that checked feed only.
- At a 320-pixel browser viewport, the Florida site and Keys map fit without page-level horizontal overflow. The official map displayed Keys markers. No physical iPhone was available, so native iOS playback and overlay behavior remain unverified.
- FL511's camera viewer and full map remain direct links if the embed or individual feed fails. The page makes no availability claim for an individual camera.

## Trip Desk integration

The Trip Desk browser preview calculated these ordinary driving routes through its existing routing providers. Distances and times are examples from this audit, **not traffic-aware ETAs**:

| Trip | Result | Florida links shown |
|---|---:|---|
| Tampa–Orlando | 85 mi; 1 h 23 m | Tampa Bay, Central Florida |
| Miami–Key West | 159 mi; 2 h 55 m | Southeast Florida, Florida Keys |
| Jacksonville–Miami | 346 mi; 5 h 18 m | Northeast Florida, Central Florida, Southeast Florida |
| Pensacola–Jacksonville | 356 mi; 5 h 16 m | Panhandle, Northeast Florida |
| Miami–Washington, DC | 1,054 mi; 19 h 26 m | Southeast Florida, Central Florida, Northeast Florida |

The Miami–DC trip used the explicitly labeled OSRM long-distance fallback, found existing out-of-state camera views, and showed coverage gaps. Florida views remained absent from the independent catalog and counts. A 320-pixel Trip Desk viewport showed all state navigation links and the Florida region handoff without horizontal overflow.

## Regression checks

- `node sandbox/trip-camera-desk/_tools/check-florida.mjs`: region mapping checks, including rejecting Valdosta, Georgia.
- `node sandbox/trip-camera-desk/_tools/check-routing.mjs`: route geometry, ordering, road/direction uncertainty, coverage gaps, representative selection, and missing coordinates.
- `node sandbox/trip-camera-desk/_tools/check-waypoints.mjs`: coordinate entry and map waypoint behavior.
- `python3 sandbox/trip-camera-desk/_tools/check-catalog.py`: existing catalog namespace, media, geographic, Oregon/Washington border, and Texas relay checks; 20,927 unique normalized views at this checkout.
- `node --check` for the Florida and Trip Desk JavaScript modules.

Florida has **no independent camera catalog**, so 25-card pagination, Florida-specific camera filtering, a Florida watchboard, automatic video slots, Stop all, snapshot refresh, and direct-stream failure handling are not applicable in this release. They require authorized individual feeds. The FL511 iframe controls its own media behavior.
