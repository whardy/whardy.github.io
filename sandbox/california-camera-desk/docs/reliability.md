# Feed checks and health semantics

The California catalog and media checks are dated. A listed `videoUrl` is a capability, not proof that the stream currently plays. `mediaHealth.video` and `mediaHealth.snapshot` are independent records on each view; `source-audit.json` retains the corresponding per-endpoint evidence. Shared media URLs are checked once, while all original directional-view IDs remain intact.

## Verification levels

| Method | What it establishes | What it cannot establish |
| --- | --- | --- |
| `hls-manifest-only` | A historical top-level playlist had HLS syntax | Child playlist, segment, decoding, browser playback or ongoing live updates |
| `hls-segment-structure` | Master/child playlist and one media segment had recognizable structure | Decoding or browser playback |
| `ffmpeg-decoded-segment` | The above plus FFmpeg decoded a video frame from one fetched segment | Browser compatibility, autoplay permission or sustained playback |
| `image-decoded` | A complete current JPEG/PNG decoded to pixels in Pillow; a known unavailable template is checked separately | Source capture time, future availability or that an unchanged scene is frozen |
| `browser-playback` | A sampled stream advanced in a real browser session at the recorded time | Every other visitor/browser or future availability |

The page reserves `LIVE` for a player actually advancing in that browser. Exhausted playback slots, user pauses, hidden tabs and browser autoplay restrictions do not change source health. A source's `inService` flag is shown independently from observed media success. The static catalog never promises synchronized feeds or traffic-aware travel prediction.

`checkedAt` is retrieval time. `expiresAt` is a conservative display threshold, not an outage time. Available checks expire after **7 days**; failed checks expire after **2 days** by default. Once expired, the UI must say “Not recently checked.” `lastSuccessAt` and `lastFailureAt` preserve separate known events; `lastSuccessVerificationMethod` says what that success actually established. Old manifest-only successes are not promoted to frame-decoded history. `recordTimestamp` remains the provider catalog record time, not image capture time; verified capture time is not published for these views.

The full listed-key sweep first completed **2026-11-04 06:14:45 UTC** with **5,964 of 5,964** unique endpoints; a 30-stream live-playlist continuation sample ended at **06:18:52 UTC**. At that final dated check, 3,645 image endpoints split into 2,716 decoded camera images, 925 visually verified maintenance notices that still returned HTTP 200, and four HTTP 500 errors. The 2,319 unique HLS endpoints split into 1,517 with emitted PNG frames, three with playlist/segment structure only, 789 HTTP 404, and ten indeterminate segment checks. No frame-decoded endpoint lacked CORS headers for the audited stages. Of 27 follow-up live playlists reached, 26 advanced their media sequence and one was inconclusive; three of the 30 sample requests failed before a follow-up. These are endpoint and audit-time results, not guaranteed visitor playback or future availability.

Failure categories include `http`, `network`, `playlist`, `segment`, `image-decode`, and the visually verified `placeholder`. `audit-limit`, cross-host `delivery-restriction`, encrypted HLS or HTTP 401/403 `access-requirement`, and HTTP 429 `rate-limit` are indeterminate checks, not proof that the source is down. For a live HLS playlist the audit tries the newest listed segment first, then one prior listed segment if fetch, structure or decoding fails; an oldest segment can rotate away after the playlist was fetched. It tries at most two declared master variants. If the master is reachable but no tested child or segment can be verified, the result is indeterminate. A recognizable segment without a decoded PNG frame remains structural rather than being called playable or definitively broken. Browser CORS compatibility is recorded separately when the fetched HLS stages provide a usable cross-origin header.

## Reproducible audit

Install the pinned decode dependencies in a temporary or virtual environment:

```sh
python3 -m pip install -r scripts/requirements-audit.txt
```

The audit reads `camera-catalog.json`, checks only already listed HTTPS endpoints and same-host HLS children, writes a checkpoint every 25 completed endpoints, and resumes from it after interruption. At most four workers run concurrently; the default is two workers and a 0.25 second global gap between requests. Each image response is capped at 2 MB, each segment at 8 MB, each playlist at 100 KB, and each request has a 12 second timeout. A video check makes one top-level playlist request, up to two declared child-variant requests, and up to two listed segment requests; the optional small continuation sample adds one delayed playlist request. A one-time 16 MB cap was used for nine previously indeterminate large-segment URLs, not for the scheduled rotation. It does not record a continuous stream.

```sh
python3 scripts/audit-media.py --output dist --workers 2 --request-gap 0.25
```

For a bounded scheduled rotation after the initial complete sweep:

```sh
python3 scripts/audit-media.py --output dist --rotate-oldest --limit 1000 --workers 2 --request-gap 0.25
```

In a published checkout, use `_tools/requirements-audit.txt` and `_tools/audit-media.py --output .` instead; the site's JSON files are in the site root rather than `dist`. The same script detects this layout by default, but an explicit `--output` makes the target clear. The workflow uses the published `_tools` copy.

Each run selects the oldest checked endpoints first, including expired and previously failed ones. Roughly six daily 1,000-endpoint batches cover a 5,964-endpoint inventory, provided the provider remains reachable and the workflow actually runs. A daily batch is **not** a full daily health guarantee. An audit does not mark unchanged snapshots as broken. Six exact Caltrans 320×260 image templates were visually verified on 2026-11-04 across multiple districts: three show “Temporarily Unavailable” and three show “Down for Construction.” The detector hashes decoded pixels above the changing timestamp bar and classifies an exact match as `failureCategory: placeholder`; **925 image endpoints** matched in the full sweep. These six template hashes and notice wording are versioned as `caltrans-v2`. Other provider error designs may remain unrecognized until verified.

The one-time upgrade from the earlier structure-only audit is resumable: `--kind image --image-template-recheck` selects only endpoints lacking the current versioned placeholder test, and `--kind video --missing-png-evidence` selects only former FFmpeg successes without an emitted PNG-frame proof. Neither mode repeats completed upgrades after a checkpoint resume. When a new template is visually verified after a decoded sweep, `--reclassify-known-placeholders` applies its exact stored pixel hash without new provider requests; an image lacking the necessary stored pixels still needs a network recheck.

For a small stratified live-playlist continuation sample:

```sh
python3 scripts/audit-media.py --output dist --kind video --only-available --sample-per-district 3 --force --continuity --workers 2
```

That re-requests each selected media playlist after up to one target interval. A higher media sequence is evidence of playlist advancement at that moment. An unchanged sequence is inconclusive, not proof of failure. This extra delayed request should remain a small sample rather than a default check of thousands of streams.

To rebuild the catalog from the latest official district catalogs, use `refresh-catalog.py`; it preserves last-known-good district records on source failures. It also preserves per-endpoint health for unchanged URLs. A source URL replacement becomes a new unchecked endpoint until audited. The audit never guesses camera IDs or media paths.

## Official viewer investigation

As checked 2026-11-04 UTC, the County of Santa Clara [official camera page](https://roads.santaclaracounty.gov/roads-and-traffic-info/view-live-traffic-cam-county-maintained-roads) still carried a 2026-09-28 alert saying its live cameras were down for maintenance. The [county regional viewer](https://saecommon.sccgov.org/drupalhtml/rda_map/SCCGOV_Live_Traffic.html) loaded its outer page, but two tested intersections—Almaden Expressway at Almaden Plaza Way (three directions) and at Blossom Hill Road (four directions)—displayed empty directional image sources even on the official origin; only a “No WB Camera View” placeholder decoded. Its outer response did not include `X-Frame-Options` or a framing CSP, but this alone is neither permission to embed nor proof that the camera images play inside a frame. Its public HTML contained no per-camera HLS, MP4, MJPEG, JPEG, query-based media URL, camera-specific deep link, or iframe player. A third-party media gateway credential was not reused. Therefore its 465 directional entries remain official regional-viewer links and are excluded from working embedded-camera results; embedding a blank outer viewer would mislead visitors. The county page has an accessible “Search by County Expressway” option while its “Search by Camera Location” tab has a posted accessibility notice.

Two Caltrans catalog `streamingVideoURL` values without direct HLS syntax, D06:49 and D08:1416, each returned a 204-byte generic Wowza HTML page. Neither page contained a video/source tag, HLS or MP4 URL, query-based media URL, or iframe player. Their published snapshots remain available for separate checks. No direct stream URL was inferred by appending guessed paths.

Many D04 and D07 HLS URLs returned HTTP 404 in the provisional audit while their separate JPEGs could still work. To check whether the official viewer carried a newer URL, a bounded 2026-11-04 sample compared 10 camera-specific CWWP HTML pages: D04 IDs 1, 22, 368, 426 and 9, and D07 IDs 1003, 1106, 1147, 275 and 997. Every page, including the [D04:1 official viewer](https://cwwp2.dot.ca.gov/vm/loc/d4/tv102i580westofsr24.htm), declared exactly the same `videoStreamURL` and `posterURL` as the current catalog; **zero replacement URLs** were found in that sample. The D04:1 page exposed one HLS URL and one JPEG URL, with no query-based alternate, MP4/MJPEG URL, or standalone iframe player. This page inspection is a bounded sample, not a claim about every viewer page. D04:1's JPEG also decoded in the browser. These views use embedded snapshot fallback where it works, with the official source link retained, rather than a guessed stream URL.

The 12 official Caltrans district JSON catalogs were fetched again around **2026-11-04 04:00 UTC** and compared by district-local source ID with the saved records: all **3,612 district IDs** were present, with **zero additions, removals or image/video URL changes**. The 33 older GIS-supplement views are separate from this district comparison. This is an observation at that time, not a promise that URLs will remain stable.

The current published statewide viewer list supplies **3,299 camera-specific CWWP links**. The other **346 Caltrans views** retain generic QuickMap as an official fallback because no camera-specific viewer link was verified in that list; this generic link does not select that card's camera. Those views still have their separately audited direct Caltrans snapshots. The **465 county views** share one regional viewer, with no verified per-direction deep link. These link types remain explicit rather than treating a generic viewer landing page as a working embedded feed.

## Operation and cost

The audit uses public HTTPS sources and no credentials, paid relay, recording or image archive. GitHub Pages can host the static dated result, but a scheduled GitHub Action or other publisher must commit updated catalogs before its checks can change for visitors. Standard GitHub-hosted Actions runners are [free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The configured public-repository workflow runs a 1,000-endpoint oldest-first batch each day with 0.5 seconds between requests, rebuilds only the California Trip shard, commits changed health files, and explicitly requests a Pages build. [Commits made with `GITHUB_TOKEN` do not by themselves trigger a Pages build](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site). Scheduled jobs can be delayed or disabled after inactivity, so the displayed expiry remains authoritative. Request volume must still follow [Caltrans fair-use guidance](https://cwwp2.dot.ca.gov/closed-circuit-television-cameras.html), which does not publish an unlimited stream allowance. A smaller rotation or manual run is appropriate if the provider signals load or rate limits.
