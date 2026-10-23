# Step 18 — geographic grouping on the map

Status: **DONE — independent re-review PASS**. The Step 17 map, Leaflet, public-location projection, Smart Search and nearby pixel clustering remain in place.

## Behavior and API

`GET /api/map/markers` accepts optional `geoLevel=region|district`. For a nationwide search it returns `{ markers: [], groups, total, filters }`; without `geoLevel`, the previous marker response remains available. A single matching listing returns its ordinary marker. The same search text, category, delivery, visibility, region, settlement and viewport predicates serve detailed markers and aggregate queries. Smart Search ranking and delivery matching are unchanged. Each group has a stable ID, level, name, public display center, bounds, `count`, `productCount` and `buyRequestCount`. A group counts each Product or Buy Request once. No empty group is returned.

On the client, the wide Ukraine view requests oblast groups, the oblast view requests district groups, and a city view requests normal markers. Zoom and visible north/south span select the level. A new nationwide search requests oblast groups even when started from a city zoom; it then fits those results into view. Clicking a group flies to its matching public result area; normal markers and nearby pixel clusters retain their Step 17 selection and card behavior. A pending search hides groups from the prior response. Aborted requests cannot replace a newer result. The home catalog asks the user to zoom in while only aggregated results are available.

## Geographic source and privacy

`backend/data/settlements.json` is the existing Ukrainian settlement directory (version 2026-07-07). Its stable settlement code identifies region and district. The directory has no verified district polygons or centers. Groups therefore use the bounded, 0.01-degree rounded *public listing points* for display and zoom; those points are not claimed to be administrative centers or boundaries. A legacy listing without a verified settlement code appears in a separately named coarse geographic group, never in a guessed district. Product and Buy Request database coordinates are not changed. The aggregate API returns no addresses, users, titles, private coordinates or individual IDs. Postal delivery does not duplicate a listing across regions.

The two aggregate SQL queries reuse the existing Product and Buy Request conditions in `MapService`. Viewport inclusion uses the same public coordinates as detailed markers; rounding is used only for displayed group positions and bounds. PostgreSQL groups by settlement code; the server maps only those compact buckets to the directory hierarchy. Product and Request counts are merged by the administrative key. No new dependency, table or migration was needed. The national query can scan active rows; selective Smart Search keeps its existing candidate logic. Existing indexes on active Products and search terms remain available; an index may not be chosen for an unfiltered full-country scan.

## Validation and performance

- `npm run typecheck`: passed after the review corrections.
- `npm run build`: passed for frontend and backend. Vite reported its existing large-chunk warning.
- `git diff --check`: passed.
- Real PostgreSQL integration: `region-filter.integration.test.ts` and `smart-search.integration.test.ts` passed before review. They cover mixed counts, region and district identity, hiding Requests, delivery methods, empty results, multiword search and agreement with detailed marker totals. A viewport boundary case added during review passed in a separate focused rerun. The full backend suite before review passed: 248 tests passed, 1 skipped in 45 files.
- Chromium E2E with real API/PostgreSQL and QA accounts: passed at 320, 390, 430, 768, 1024, 1280 and 1440 px. The test created Rivne Product + Request and Kyiv Product, searched by a unique term, checked two oblast groups and count 3, opened Rivne oblast, Rivne district, then a marker/card, and checked document overflow. Test records were removed afterward.
- Existing Step 17 Chromium regressions passed: returning to the same map search, marker/card selection and clearing, card arrows, favorites and report explanation.
- A targeted 390 px Chromium rerun after review passed a new nationwide search from city zoom: the API returned region groups with no individual nationwide marker payload.
- Local existing database: 1,141 active Products and 38 active Requests at measurement. National aggregation returned 9 groups and 1,136 located results in 2,325 bytes for the group payload; `MapService` took 422 ms for regions and 308 ms for districts. The total differs from active rows because some records have no public map point.
- Isolated `navpaky_step18_qa` database: 8,000 synthetic Products and 2,000 Buy Requests. National API returned two groups, total 10,000, in 594 bytes and 1,168 ms on one measured run; district API returned two groups in 643 bytes and 653 ms. Individual SQL queries took 505/222 ms for Products/Requests at national level and 463/175 ms at district level. The PostgreSQL plans used `products_public_list_idx` in one run, while the Request aggregate used a scan. Subsequent measured runs vary with caching and concurrent activity.
- On the same 10,000 rows, selective text `7999` took 382 ms in `MapService` (SQL 210/162 ms) and returned one matching group. A broad common-prefix query took 12.4 s. These are separate measured scenarios.
- In the deliberately dense QA fixture, a small Rivne viewport still contained 5,000 co-located records. The unchanged detailed-marker path took 3.3 s and returned all 5,000; its SQL plans did not use a spatial index. This is a scale limit of the local-detail path, even though the national view remains compact.

## Remaining verification

- Initial independent review found two defects: a new country search from city zoom could request every national marker, and aggregate viewport inclusion rounded explicit public points before filtering. Both were corrected in `a1b9eaf`; focused Chromium and PostgreSQL regressions passed. Independent final re-review of the correction reported PASS with no remaining findings.
- A 50,000-row run, physical Android Chrome and native on-screen keyboard were unavailable.
- The directory does not include verified administrative boundaries or centers, so display bounds enclose matching public points rather than the full oblast/district. Records with no verified code use coarse geographic fallback.
- Repeated common-word text in the 10,000-row synthetic fixture produced a slow 12.4 s Smart Search aggregate (`Step18 QA товар 7999`). This uses the unchanged Step 15 search condition. Do not claim all 10,000-row searches are fast.
- The existing detailed-marker API remains unpaginated. A highly dense city viewport can still return thousands of public markers; reducing or paging that result would require a separate interaction contract for selecting those records. No listings were silently omitted in this step.
