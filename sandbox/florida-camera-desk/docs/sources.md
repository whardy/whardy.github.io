# Florida camera sources and access

Updated 2026-11-04 UTC. See the [detailed dated source audit](source-audit.md),
[machine-readable counts](source-audit.json) and
[refresh status](../data/refresh-status.json).

The project owner confirmed permission for public display of individual
Florida traffic-camera snapshots and video from FDOT, the named Florida
partners, and FL511-listed local source groups. No signed agreement text or
private delivery credentials were supplied in this workspace, so there are no
additional agreement-specific limits or expiry terms to quote here. FL511's
[published conditions](https://www.fl511.com/privacy) call for FDOT's express
written consent for independent reuse; the owner's permission confirmation
is treated as established for this project.

| FL511 source groups | Provider/attribution | Listed views |
| --- | --- | ---: |
| DIVAS-District 1–7, DIVAS-District I595 | FDOT district and I-595 feeds | 3,219 |
| DIVAS-Turnpike SG C | Florida's Turnpike Enterprise | 864 |
| DIVAS-CFX | Central Florida Expressway Authority | 340 |
| DIVAS-MDX | Greater Miami Expressway Agency; MDX source label retained | 117 |
| DIVAS-COT | City of Tallahassee feed; local identity inferred from Leon coverage | 228 |
| DIVAS-BCTD | Broward County feed; raw source label retained | 223 |
| **Total** | **Actual FL511 list records** | **4,991** |

The catalog comes from the official [FL511 camera viewer](https://www.fl511.com/cctv)
list and retains every source group, district, source image ID, source-site ID,
original name and road wording. The public
[`/List/GetData/Cameras`](https://www.fl511.com/cctv) response supplies the
records; the builder validates and pages its responses. The source supplied
4,991 distinct views and 4,991 source-site IDs on the dated refresh, with no
independently verified physical-device count. FDOT's
[FION description](https://fdot.gov/traffic/its/fion) reports a larger
network-wide feed count; it is not this site's catalog count.

FL511 serves direct `/map/Cctv/<image-id>` snapshots. A small visual audit
confirmed four roadway images and one CFX offline placeholder. The remaining
4,986 images were not visually verified. FL511 HLS video uses short-lived DIVAS
authorization for most rows. Tested non-auth URLs returned 401 from the
published site's origin. No Florida HLS stream is yet labeled playable on this
site; the [official FL511 viewer](https://www.fl511.com/cctv) is the video
fallback. The [official embed tool](https://www.fl511.com/Map/EmbeddedMapSetup)
supports the secondary map.

The catalog stores no private keys, session tokens, images, video segments,
recordings, or capture history. Source creation/update timestamps are not
treated as image capture times. Cached image responses do not prove that a feed
is live or current. Official links for closures, detours, drawbridges, road
weather, hurricane/evacuation guidance and toll advisories remain the
appropriate source for travel decisions.
