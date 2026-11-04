# Interface and local configuration

California Camera Desk is a buildless static application. Serve `dist/` over HTTP for development. The catalog and source refresh tooling are documented in the main README and sources notes.

## Browsing

The wall shows 25 listed views per page. Initial ordering puts usable embedded capabilities before official-viewer-only rows and source-disabled views. A selected road is ordered by the provider's finite absolute milepost, with unreported positions last. Raw county postmiles are displayed as metadata and never used as statewide journey distances.

Region, district, county, road, travel side, media capability, dated availability and elevation filters use current contextual counts. A zero-count selected filter remains removable. The broad browsing regions are derived groups, not official city limits. Camera-facing descriptions remain separate from the published travel side.

The map clusters visible camera views in screen-space cells. Very close or co-located views open an accessible choice list; clusters do not claim to count unique physical devices. Moving the map does not automatically change result filters: Search this area applies a deliberate viewport boundary, and Clear map boundary removes it. Fit results uses only located matching cameras. Unlocated rows remain searchable.

The highway stretch controls require one road and use absolute milepost where reported. These are source corridor positions, not calculated route distances. Use Trip Desk for actual routes and journey ordering.

## Viewing media

Autoplay defaults to one simultaneous muted inline video on narrow screens and two on desktop. The global slot selector allows up to four, subject to browser performance and provider limits. These application caps do not establish provider permission or a service guarantee. Per-card Watch live and Stop video remain accessible when the browser blocks autoplay. Native video overlays are hidden for California; a browser may still require a user gesture.

Autoplay is only scheduled for visible eligible video views, skips sources whose video audit is unavailable, and allows an explicit Watch live retry. Manual video takes priority over automatic previews. Offscreen or hidden-tab video stops. Enlarging a camera suspends automatic previews behind its dialog. Closing the dialog releases its player and lets eligible visible wall previews resume. Stop all turns autoplay off until deliberate re-enablement; an individual stop remains stopped in that rendered card.

Only visible snapshots refresh. Four image requests can run at once. Nominal provider intervals are respected with a minimum 60-second automatic refresh; explicit Refresh visible is a deliberate retry. A stream failure can fall back to a snapshot. A dated failed video audit does not disable a working image. Images and streams load directly from the provider, without a new relay.

Fetched time measures browser retrieval. Catalog record times describe metadata and are converted from the provider's record epoch to America/Los_Angeles. Capture time remains unknown unless shown within provider media. Images are current observations subject to source delay, not predictions at trip arrival.

## Boards and sharing

Named boards use localStorage key `california-camera-desk-library-v1`. Autoplay preference uses `california-camera-desk-autoplay`. No account is needed. Up to 30 boards and 500 distinct IDs per board are accepted. Names are trimmed and bounded; IDs are validated. Unknown IDs survive import and export without appearing as fabricated camera cards.

The share action creates a reviewable URL with an encoded board name and camera IDs. Opening it asks the visitor to import; it does not silently mutate their library. Sharing is bounded to 18 KB of decoded content. JSON imports are limited to 1 MB, normalized, then merged after an explicit import action. Existing boards are retained. Export JSON downloads the current local library. Open in Trip Desk creates a shared Trip board with stable CA-prefixed IDs; mixed-state arrangement happens in Trip Desk.

## Conditions

Chain controls are requested only after a user selects a reporting district and chooses Check chain controls. The district manifest is local. Each district request is limited to once per 60 seconds with a 15-second timeout and in-memory last-successful fallback. Include R-0 controls the display of no-control records. Record publication and status-change timestamps are separately labeled as Pacific provider timestamps. An old status change does not itself mean the current feed is stale. R-0 does not prove a road is open. Official QuickMap remains the fallback for chain controls, closures and other restrictions.

## Validation

`npm run check` exercises catalog identifiers, all 12 districts, highway/milepost ordering, geographic and elevation filters, contextual facets, missing coordinates, multiview grouping, bounded import/share and static assets. The reused media-manager harness checks muted inline setup before source assignment, native-overlay flags, shared video capacity, manual priority, viewport/tab cleanup, autoplay restrictions, source failures, explicit retries, snapshot fallback, source refresh intervals, Stop all holds, modal scope and cleanup.

Browser testing must additionally confirm actual advancing video, snapshot decoding, interactions and responsive layouts. A response status or valid manifest alone is not a playback test. Desktop narrow-viewport testing is not physical iOS testing.
