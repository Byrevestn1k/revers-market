# Seller demand subscriptions — Step 8 corrections

## Current contract

Own subscriptions are managed at /settings/demand-subscriptions. Minimum: category plus country, region or one/multiple canonical settlements. Quantity, price, unit, currency and suburbs are optional. Defaults: no selected territory, unrestricted quantity/unit/price/currency, both SELF_PICKUP and SELLER_DELIVERY. At least one receipt method must remain selected in the UI, API and database.

| Criterion | Matching semantics |
| --- | --- |
| Category | Selected category or an active descendant. |
| Country | All settlements in the Request's country; never the author's account country or guessed free text. Selecting Ukraine clears redundant regions/cities/suburbs. |
| Region | All canonical settlements in that region. Cities already in it are dropped when suburbs are off. |
| Cities | Any of up to 30 distinct canonical settlement codes, including cities in different regions. Region and cities form a union (OR). Namesakes retain region/district labels. |
| Suburbs | Optional cityOutsideKm 0–20 km, measured from the verified city polygon shared with existing search for any selected settlement. The canonical selected settlement always matches, even without a public point. With suburbs off, only its canonical identity matches. |
| Quantity | Inclusive total quantity bounds. kg/ton use exact decimal cross multiplication; litre/piece/box require the same unit. Missing/unknown quantity fails configured bounds. |
| Price | Inclusive overlap of buyer per-unit budget and seller acceptable per-unit range. kg/ton prices convert inversely to quantity. A missing bound is unbounded on that side. Both buyer prices missing mean unknown budget and match even configured seller minimum/range; nominal Request currency then does not filter. Known budgets require matching currency and existing overlap/unit conversion; no currency conversion. |
| Unit/currency | Null means unrestricted and does not reject missing/differing values. A selected unit restricts that dimension; selected currency restricts only known budgets. Numeric bounds need a unit; price also needs currency. |
| Receipt | SELF_PICKUP means buyer collects; SELLER_DELIVERY means seller/seller's transport brings goods to the buyer's specified place. Both selected impose no receipt restriction. A single selection requires the explicit matching method, except legacy optional delivery described below. |

Older Requests may have a public place label without settlement_code. The shared count/alert matcher resolves that label through the existing Ukrainian directory using the exact settlement name and any supplied region, district or community qualifiers. Only one candidate is accepted; explicit foreign country, ambiguous names, conflicting/unknown qualifiers and private-address-only identity fail closed. Canonical codes take priority. Existing records are not rewritten and historical alerts are not replayed. This fixes the real public label “Млинів, Млинівська селищна громада”.

Geography is a union; category, geography, quantity, price and configured receipt criteria combine with AND. Ukraine covers all Ukrainian regions and settlements, so no lower selection is required or retained. A region plus cities elsewhere covers either territory. Empty optional criteria broaden matching.

## Existing geography reused; verified provider identity

The existing city search and subscription validation share backend/src/city-boundaries.ts: the same structured Ukrainian Nominatim query, provider result cache, valid Polygon/MultiPolygon parser, point-in-polygon and distance to polygon segments. Segment distance uses spherical geodesic distance, preserving holes and disconnected polygons. No center-radius substitution, bounding-box polygon or artificial live geometry is used.

The previous Rivne rejection came from requiring category=boundary/type=administrative. Actual search and subscription queries both returned OSM relation 448930 as category=place/type=city, with the exact canonical katotth=UA56060470010041018 and matching Ukrainian city/region. Its actual city polygon is now accepted through exact directory identity, rather than guessing from its name or center. The shared polygon matches the existing city search geometry. Stored server-only source metadata records provider, OSM object type/id and settlement code.

Accepted geometry must be an unambiguous valid closed Polygon/MultiPolygon with matching name, Ukrainian country and region (plus district for non-cities). An administrative boundary retains admin_level 8/9/10, or 4 for a canonical special-status city. An identified place polygon additionally requires the exact KATOTTG code, matching settlement type and an actual OSM relation/way ID. Wrong/missing code, namesakes, bounding boxes, unsupported levels and missing geometry fail explicitly. Successful lookup is cached 24h; failed eligibility/geometry checks discard the provider result and retry after 60s. Stored subscription geometry is server-owned, not accepted from clients, and excluded from subscription DTOs.

Live real-DB validation on 2026-10-08 saved Rivne with cityOutsideKm=10 (POST 201) and verified inside-city, suburb and beyond-10-km Requests against the actual polygon. Rivne plus Kyiv was saved and matched as a union. The live privacy check locates a real threshold where exact and rounded points differ, and verifies matching/counts/markers use only the rounded public point. Exact private coordinates and addresses are absent from notification/match DTOs. A private Request address rounds its point in address, pin and inherited-profile modes; it does not hide the marker. Only a consented public Request address publishes precise coordinates and address text. The owner retains precise access to their own data.

If reliable boundaries are unavailable, CITY_BOUNDARY_UNAVAILABLE still identifies the settlement and allows retry or saving without suburbs. Provider availability and geometry for every settlement are not guaranteed. The Ukrainian city directory is unchanged; Request precision follows the latest private/public clarification, and foreign subscriptions work at country level. HERE is not required for this boundary lookup; actual HERE locality checks for map display are recorded below.

## Receipt compatibility

Current explicit Request enum contains only SELF_PICKUP and SELLER_DELIVERY. Legacy delivery='preferred' is stored as preferred_delivery='preferred' with receipt_method NULL. It means a preference, so it matches either single subscription method or both. Strict explicit SELLER_DELIVERY cannot match pickup-only. Generic legacy yes/no or carrier does not establish seller transport and cannot match a single selected method unless mapped unambiguously to explicit receipt. Carrier/postal delivery remains future scope; no third subscription checkbox or enum was added.

## Storage, API and backward compatibility

- Migration 040 adds subscription ownership, category/region/active, timestamps and partial unique notification index (demand_subscription_id, buy_request_id).
- Migration 041 adds optional criteria, country/receipt Request fields, minimum/range/shape constraints and canonical backfills.
- Migration 043 adds arrays country_codes/regions for repeated country/region selections, copies legacy scalar selections without losing them, retains scalar fields for old clients and enforces a 20 km suburb ceiling. On this PC the one existing subscription had no distance above 20 km, so no saved distance was reduced.
- Migration 042 adds city_outside_km and server-owned settlement_boundaries JSON, requires 1–2 receipt methods and defaults both. Old empty methods become both. Previously implicit/enclosing UA is cleared only for existing narrower region/city subscriptions, preserving their original selected scope under the new union semantics.
- Existing point-radius subscriptions remain readable and continue matching until the owner saves replacement criteria. Status-only changes retain the old radius. The new form has no old radius mode; editing displays a replacement notice and saving explicitly clears center/radius. Arbitrary old center/radius data cannot faithfully become distance from a city boundary.

All endpoints require authentication. Ownership comes from the session, never input. Read/update/delete use both subscription ID and owner; foreign/missing records return 404 SUBSCRIPTION_NOT_FOUND. Lists contain only own records.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /api/demand-subscriptions | Own subscriptions with canonical labels. |
| POST | /api/demand-subscriptions | Category/geography required; optional fields nullable; receipt defaults both; active defaults true. |
| GET | /api/demand-subscriptions/:id | Own record only. |
| PATCH | /api/demand-subscriptions/:id | Omitted fields retained; null clears optional scalars, [] clears cities, [] receipt is invalid. Normalize geography and validate the full merged record under an owner row lock. |
| DELETE | /api/demand-subscriptions/:id | Remove own record; retain notification history. |

Numeric quantity/price criteria accept up to four decimals. Invalid/inactive taxonomy, unknown identities, duplicates, empty receipt, invalid bounds, suburb distance without cities, geometry injection and unknown fields are rejected. Country/region-covered lower selections are normalized rather than stored as redundant restrictions.

## One territory input and existing matches

Subscriptions reuse the homepage SettlementPicker in an optional repeated territory-selection mode. One input searches countries, regions and canonical settlements. Chosen territories remain as removable chips; the next selection is made in the same input. Multiple countries/regions/cities are a union. Ukraine removes redundant Ukrainian regions/cities; a selected region removes its city unless suburbs broaden coverage. The suburb slider is 0–20 km and only applies to selected cities. The ordinary homepage picker retains its existing behavior.

Own list/read/create/edit responses include matchCount for existing active Requests; own Requests are excluded. GET /api/demand-subscriptions/:id/matches is authenticated and owner restricted, reuses the same matchesDemandCriteria and public Request projection as notifications, and obtains markers through the existing MapService. Closed/expired/cancelled/completed Requests are excluded. Missing coordinates do not remove a match from the count. The API returns their canonical public settlement (including strict legacy-label resolution). Subscription map display reuses the existing HERE resolveSettlement: when it confirms one unique locality, the UI creates a rounded city-level marker labelled «Орієнтовно в населеному пункті». It never geocodes private address text. Unconfirmed/ambiguous places remain in a separate list. This is a display estimate; it is not used as a substitute Request point for suburb matching or distances.

The “Збігів: N” link opens /discover?demandSubscription=<id>. Search fetches the saved criteria on the server and shows all matching Requests on the existing map and list; criteria can be expanded to see the selected category, territories, suburb distance, quantity, price, unit/currency and receipt values. Map panning does not silently discard matches or apply the user’s home-city scope. The link survives reload and does not create notifications. The owner can return to editing the subscription or regular search. The current count can naturally change when listings change.

Buyer subscriptions to sellers, seller categories and products are not currently implemented. They require new storage and product-publication alerts, beyond the user's conditional permission for a small mirrored change, and remain a subsequent task.

## Notifications and security

Request creation and alert insertion share one DB transaction. Only active subscriptions created before the Request and active category ancestors are eligible. The author is excluded; creating/editing/enabling a subscription does not replay historical Requests. Request edits do not send new alerts.

Matched candidates are locked until transaction end. DB uniqueness plus ON CONFLICT DO NOTHING suppress concurrent retries. Each subscription generates at most one alert per Request; separate overlapping subscriptions may each alert. Deleting a subscription stops future alerts and retains delivered history.

Alerts retain the existing system type, selling context, counters/read operations and canonical /buy-requests/:id reference. Request input cannot choose a recipient or notification destination; server-side ownership and Request ID determine them. listNotifications adds a public buyRequestPreview from the referenced Request: title, quantity/unit, per-unit budget/currency or unknown, receipt method, optional deadline, public settlement and whitespace-normalized description truncated to 280 characters. Notification time remains createdAt. No private address or coordinates are included. The preview reflects public Request edits, remains after subscription deletion, and becomes null if the Request is deleted.

Notification Center always renders the event's own title and body first, including ordinary Offer/Deal events with a referenced Request. Public Request title and details are supplementary, separated below the event, with wrapping and a two-column layout. Event text wraps without truncation; at widths below 1024 px, the short product description is expandable. Quantity, budget, receipt, public settlement, optional date and unread/time remain visible. Notifications without a preview still show their event title/body. Navigation uses the server reference, never presentation text.

## Validation / re-review

STEP 8 CORRECTIONS READY FOR RE-REVIEW. Earlier exact quantity/price conversion regressions remain covered: 1.001 ton / 1001 kg and 0.35 UAH/kg / 350 UAH/ton, with adjacent nonmatches and persisted real-DB notification assertions. The latest corrections address Rivne's incorrectly rejected actual city polygon, unknown buyer budgets and informative public notifications. A fresh independent review is required; implementer results are not independent PASS.

### Work PC evidence (2026-10-08)

- Branch handoff/step-8 and HEAD 401a605ca838fb6360d391a507ad712406a14c46 preserved. No commit/push/merge, Step 9, architecture or dependency version change. Protected _transfer.rar, _transfer/ and sync-export.bat untouched.
- Main PostgreSQL/PostGIS is accessible, Docker healthy, /health returns DB ok and frontend /discover returns 200. Main schema_migrations confirms 040–043. No new migration is needed. All correction test writes use separate step8_final_1791459413636 with PostGIS 3.4 and all migrations applied; the main DB is read-only in these checks.
- Current main read-only evidence: 2 saved subscriptions. Honey matches one active Mlyniv Request and returns one public marker. Crayfish matches one active Mlyniv Request saved with only its place label and no coordinates, returned in unmappedRequests with the resolved canonical settlement. The existing HERE resolver actually confirmed Mlyniv on this PC; the subscription map now represents such a Request at the approximate settlement level. Older honey Requests used in previous checks are now cancelled and correctly excluded. No private coordinates or artificial markers were added, and no historical notifications replayed.
- Real-DB subscription suite after privacy clarification: 30/30 passed, including CRUD/ownership, minimum geography, union/normalization, unknown budget with minimum/range and nominal currency, known-budget comparison, public notification details, dedup, conversions, receipt, counts/map consistency and privacy. The real provider suburbs test passed on Rivne 10 km plus Kyiv, inside/suburb/outside and rounded public threshold cases; it makes no provider stubs. It asserts actual saved source metadata and geometry equality with cityBoundary.
- city-boundaries unit tests: 17/17 passed, including exact KATOTTG place identity, wrong/missing identity rejection and 60s retry after a failed provider eligibility check. Demand matcher: 21/21 passed.
- city-search instability was an ordering expectation for two equal-title markers: SQL did not define tie order. Only those assertions now compare sorted exact IDs/cardinality; all radius, single-match and exclusion assertions remain unchanged. Three consecutive real-DB repetitions passed; production map search behavior was not changed for this test.
- Final authenticated Chromium E2E: 2/2 passed with existing documented Seller A and Buyer A accounts on a separate real DB, without retries in the final run. Login, subscription creation (Rivne + 10 km, quantity and price range), buyer Request creation without budget, selling notification, unread 0→1→0 and canonical Request navigation all use browser UI and real API. No page.route, API login or API creation supplies this proof. The buyer profile was prepared as an isolated environment precondition in two modes: a stored point with private Request visibility, and only a canonical Rivne settlement with no coordinates. All subscription/Request/notification/navigation actions remain UI actions. Both scenarios clicked «Збігів: 1» and showed the correct Request in the real list and map at all five widths. The stored private point was rounded to 50.62/26.25 without address text; the city-only case actually called the existing HERE resolver and displayed the explicitly approximate locality marker. The final run checked marker bounds and horizontal overflow. This is not a HERE street/house geocoding test. Long notification fields and expandable description passed at 1440/1024/768/390/320; screenshots inspected across completed runs. Final report and public screenshots are in the temporary step8-real-flow-final-result.json and step8-final-live-map-complete artifacts; own test rows are removed after each run.
- Browser subscription regression: 18/18 passed across the same five widths, including CRUD, minimum country/region/cities, repeated input, quantities/prices/receipt, validation/errors, long labels and count→map/list→reload/pan behavior. These separate regression tests use API fixtures and are not counted as real authenticated E2E evidence. The existing Notification Center retry test initially crashed because its fixture returned {} for /api/conversations; after adding the actual empty-list contract it passed 1/1 without changing production chat code or its assertions.
- Root npm run typecheck and npm run build passed on final production code. Vite's existing >500 kB bundle advisory remains. git diff --check passed, and new test files were independently checked for trailing whitespace/conflict markers.
- Full suite intermediate results are retained: 201/202 (one old Telegram clock-skew boundary assertion; unchanged focused provider suite then passed 26/26), then 200/202 during concurrent browser load (two old Buy Request tests exceeded their explicit 30s timeouts). A run without Chromium passed 202/202 in 29 files before the last private-address clarification. Final full backend run after all privacy/map changes: 203/203 PASS, 29/29 files, no skipped tests, with the real provider geo test enabled and DATABASE_URL loaded before collection. No failed run is counted as a full PASS. The unrelated Telegram clock-boundary test was not changed; its timing sensitivity remains a known test risk.

### Reproduction and remaining limits

Use a dedicated database whose name matches step8_final_<digits>; migrate it and prepare the existing documented QA accounts there. The browser scenario requires the buyer's public Rivne profile pin and existing categories, and API/frontend launched against that isolated DB. The live geography check is opt-in; skipped integration files are never counted as real-DB proof.

~~~powershell
$env:DOTENV_CONFIG_PATH = '<absolute path to isolated DB test environment>'
$env:NODE_OPTIONS = '-r dotenv/config'
$env:STEP8_LIVE_GEO = '1'
npm test --workspace backend -- --no-file-parallelism --testTimeout=60000 --hookTimeout=60000 --silent
# With that isolated API/frontend running and E2E_BASE_URL pointing to it:
node -r dotenv/config node_modules/@playwright/test/cli.js test e2e/demand-subscriptions-live.spec.ts --project=chromium --workers=1
~~~

Provider/network availability and polygons for every city remain unverified; unavailable/ambiguous geometry fails explicitly. Proximity is measured from public/rounded points, so the privacy rounding can change a result close to the distance threshold. Live HERE locality resolution for Mlyniv and Rivne was verified with the existing resolver. Street/house geocoding coverage and availability for other localities remain unverified. Full authenticated creation/matching/notification/navigation is verified; account onboarding, HERE street/house geocoding and carrier/postal delivery are not part of this proof. Buyer subscriptions to sellers/products remain separate conditional scope.

### Files changed for these final corrections

- Backend geometry/matching/notification: city-boundaries.ts, demand-matching.ts, community-service.ts.
- Request map/privacy and existing matches: request-public-location.ts, buy-requests.ts, map-service.ts, demand-subscriptions.ts.
- Frontend: App.tsx (notification details and subscription-map locality estimates), sidebar-profile.css, SubscriptionCriteriaFields.tsx (unknown-budget hint).
- Backend tests: city-boundaries.test.ts, demand-matching.test.ts, demand-subscriptions.integration.test.ts, demand-suburbs.live.integration.test.ts, city-search.integration.test.ts.
- Browser tests: demand-subscriptions-live.spec.ts; notifications-ui.spec.ts (complete conversations fixture only).
- Documentation: DEMAND_SUBSCRIPTIONS.md, NOTIFICATIONS.md, PROJECT_STATE.md. Earlier Step 8 working-tree changes remain present; no unrelated implementation was added.

This privacy correction is scoped to Buy Requests and their subscription search/notifications. Supply Product map precision still uses its earlier address/pin rules; the analogous private-address precision behavior there remains outside this Step 8 change. No supply subscriptions, Step 9, carrier/postal, route/corridor or external notification channels were implemented.

Після фінальних перевірок видалено лише власну ізольовану БД `step8_final_1791459413636` та тимчасовий файл її оточення; зупинено власні тестові служби 3011/5181. Основна БД і служби 3000/5173 залишені працювати. Backend 3000 працює під наявним `tsx watch`. Звіти й публічні QA-знімки збережено.
