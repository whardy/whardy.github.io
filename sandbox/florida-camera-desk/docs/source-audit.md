# Florida camera source audit

Audit date: **2026-11-04 UTC**. Machine-readable counts and refresh status are in
[`source-audit.json`](source-audit.json) and
[`../data/refresh-status.json`](../data/refresh-status.json).

## Scope and source

The project owner confirmed permission to publicly display individual Florida
traffic-camera snapshots and video from FDOT and the FL511-listed partner and
local groups below. No private agreement document, credential, endpoint, quota,
cache rule, or expiration notice was supplied in this workspace. The builder
therefore uses the camera list returned by FL511's own public viewer at
[`/cctv`](https://www.fl511.com/cctv), not a private partner feed, and makes no
claim that its request settings supersede an agreement. FL511's published
conditions describe FDOT express consent and separate data and video agreements;
the owner's confirmation establishes that consent for this project. The original
FL511 source group and district remain on every record for attribution and
future scope review.

The viewer's `POST /List/GetData/Cameras` response reported **4,991** camera
rows. We retrieved all 4,991 in 100-row pages. Each row contains one image view
and a `cameraSiteId`; all source-site IDs are distinct in this response. There
are **4,991 listed views at 4,991 source-site locations**. FL511 did not provide
verified physical-device identifiers, so **physical-device count is unknown**.
Repeated coordinates are not used to merge records or directional views.
FL511 supplies `Northbound`/`Southbound`/`Eastbound`/`Westbound` labels but the
public listing does not define whether they describe travel or camera facing.
They remain a searchable listed-direction field; route matching does not use
them to assert an opposite-direction view. Camera-facing direction remains
unknown unless a future source supplies it explicitly.

| FL511 source group | Listed views | Source/provider treatment |
| --- | ---: | --- |
| DIVAS-District 1 | 432 | FDOT District 1 |
| DIVAS-District 2 | 565 | FDOT District 2 |
| DIVAS-District 3-CHP | 337 | FDOT District 3; raw CHP source label retained |
| DIVAS-District 4 | 313 | FDOT District 4 |
| DIVAS-District 5 | 577 | FDOT District 5 |
| DIVAS-District 6 | 280 | FDOT District 6 |
| DIVAS-District 7 | 660 | FDOT District 7 |
| DIVAS-District I595 | 55 | Separate FL511 I-595 district feed |
| DIVAS-Turnpike SG C | 864 | Florida's Turnpike Enterprise |
| DIVAS-CFX | 340 | Central Florida Expressway Authority |
| DIVAS-MDX | 117 | Greater Miami Expressway Agency; MDX source label retained |
| DIVAS-COT | 228 | City of Tallahassee feed, inferred from all-Leon coverage; raw label retained |
| DIVAS-BCTD | 223 | Broward County feed, inferred from source label and dominant Broward coverage; raw label retained |
| **Total** | **4,991** | |

The source's `created` and `lastUpdated` fields are catalog metadata, not image
capture times. No verified image capture timestamp was supplied. The builder
records source retrieval separately from dated media checks. The Florida time
zone uses `America/Chicago` for the nine entirely Central-time counties and
`America/New_York` elsewhere; the Cape San Blas source ID 3858 and two eastern
Franklin County IDs have reviewed exceptions to the split-county/river boundary.
The [federal zone boundary](https://www.ecfr.gov/current/title-49/subtitle-A/part-71/section-71.5)
and [FDOT's Florida time-zone map](https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/aviation/charts---directories/florida_directory_2025.pdf)
are the basis for these assignments. Future new split-area IDs remain unknown
until checked.

## Media delivery and dated checks

Every row lists an FL511 `/map/Cctv/<imageId>` HTTPS snapshot path. The page
uses these direct image URLs with a 120-second visible-card refresh cadence.
Provider responses sampled across all source groups returned CORS `*` and
`Cache-Control: max-age=60`; a response can still be an offline card. Three
sample images (District 1 ID 1, CFX ID 3972, and GMX/MDX ID 4160) were visually
confirmed as roadway imagery at approximately 04:27 UTC. The separate FL511
I-595 district feed ID 4263 was visually confirmed at approximately 04:41 UTC.
CFX ID 3860 was a
visually confirmed offline PNG card at approximately 04:22 UTC, despite HTTP
200. The other **4,986** views remain **unchecked** for visual availability;
their catalog presence is not a live-availability guarantee. The District 1
sample image changed between requests. `Last-Modified` is retained as response
metadata, not treated as a verified capture time.

The latest successful refresh lists HLS URLs for **4,388** rows. **4,359** mark video authorization
required. FL511's viewer obtains a public request object from
`/Camera/GetVideoUrl?imageId=...` and resolves a short-lived secure URI through
DIVAS before playback. The source website refreshes that URI. Seven sampled
non-auth HLS URLs from Districts 3 and 4, MDX and BCTD returned **HTTP 401**
from the `whardy.github.io` origin. Representative auth-required video could be
tested only with FL511 origin/referer context; this is not approved browser
delivery for the published site. A GMX fMP4 fragment also failed a local decode
attempt. **No Florida HLS URL is marked as directly playable or eligible for
autoplay** in this release. A bounded production test through the existing
Texas Sites relay resolved an FL511 token, then returned 504 because the relay
could not reach the DIVAS HLS manifest on HTTPS port 8200. All video URLs in
this catalog use that port; changing them to 443 did not yield a working feed.
The relay test deployment was rolled back and its Texas snapshot behavior was
reverified. The snapshot remains the direct feed, and the official FL511
viewer remains the video path. An approved HLS endpoint reachable by the
relay on standard HTTPS/443, provider assistance enabling port 8200, or
whardy-origin browser delivery is the specific missing connection for
independent video playback.

The builder found no exact cross-provider image or video URL identity to merge.
Road-link IDs repeat for multiple views and are not device identifiers. Some
coordinates repeat, including directional views; all distinct source view IDs
are preserved. Namespaced IDs are `FL:<provider-key>:<source-image-id>`, and
source-site IDs are separately retained. No content is recorded or archived.

## Refresh and recovery

From the repository root:

```sh
python3 sandbox/florida-camera-desk/_tools/build-catalog.py
python3 sandbox/florida-camera-desk/_tools/check-catalog.py
python3 sandbox/trip-camera-desk/_tools/check-catalog.py
```

The builder uses at most 100 records per request, a 20-second timeout, three
attempts and at least 0.7 seconds between requests. It refuses changed totals,
short pages, unknown source groups, duplicate IDs, invalid HTTPS media URLs,
and malformed coordinates before updating the shared Florida shard or Trip's index. A
failed refresh writes a failure reason to `data/refresh-status.json` and keeps
the last-known-good catalogs; review the failed page and provider status before
retrying. For an offline reproduction, pass `--source-json /path/to/official-list-rows.json`.
The media-check input in `docs/media-checks.json` is deliberately small and
dated. At the next catalog refresh, visual checks older than seven days are
marked `stale` while retaining the prior result and check time. Refresh it only
after real image or browser playback checks; stale checks must not be described
as live availability. A new provider group or changed
agreement scope requires updating the explicit source allowlist before another
refresh.

The public list, static GitHub Pages and existing Trip Desk routing require no
new paid service or secret. A full list refresh makes about 50 bounded source
requests. An open page of 25 visible snapshot cards could request roughly 25
images at entry and up to 750 per hour at 120-second cadence if left visible;
offscreen and hidden cards pause. FL511 and its partners may set access limits
or change delivery. GitHub Pages serves the catalog bytes under the account's
hosting limits. A future video relay would add bandwidth and possibly charges;
none is deployed here.

Sources: [FL511 viewer](https://www.fl511.com/cctv),
[FL511 About](https://www.fl511.com/about),
[FL511 conditions](https://www.fl511.com/privacy),
[FL511 map embed](https://www.fl511.com/Map/EmbeddedMapSetup),
[FDOT FL511](https://www.fdot.gov/traffic/its/fl511), and
[FDOT FION](https://fdot.gov/traffic/its/fion). FION's network-wide video count
is not used as this catalog count.
