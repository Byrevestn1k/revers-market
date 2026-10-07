# Basic seller demand subscriptions — Step 8

## CURRENT audit and scope

- Buy Requests store one category. CURRENT parent_id taxonomy and search include active descendants: selecting a parent includes subcategories, selecting a leaf narrows matching. The existing CategoryPicker is reused with a touch-friendly inline hierarchy.
- The Ukrainian settlement directory provides canonical codes, oblasts and disambiguated names. Country choices reuse the current account country inventory; country is a Request location field, independent of the author's phone/account country. Foreign country subscriptions work at country level; foreign city/oblast directories are not introduced.
- The map already projects public Request points from published pins/addresses, public profile points or rounded approximate coordinates. Radius matching reuses exactly this SQL projection and the existing haversine function. Radius is optional, 0.2–200 km, from a map point, entered coordinates or the existing HERE city resolver. No route/corridor/polygon engine is introduced.
- Request quantity remains required and positive in CURRENT API/DB. Units: kg, ton, litre, piece, box. Price is an optional per-unit min/max or exact budget; currency uses CURRENT three-letter codes.
- Generic legacy delivery yes/no/preferred cannot identify who transports goods. Requests now store an explicit receiptMethod. Only unambiguous structured legacy pickup/seller_delivery values are mapped; generic/carrier values remain unknown. Request creation UI uses clear Ukrainian receipt wording.
- Notifications already support buying/selling contexts, exact unread counters and structured buyRequestId navigation. Demand alerts reuse these contracts and the system type. Accounts can buy and sell; no seller role gate is added.
- Own subscriptions are at /settings/demand-subscriptions, linked from profile settings and the Продаю menu. Private profile fields are not added.

## Minimum and optional criteria

Creation requires **categoryId + at least one geography level: countryCode, region or settlementCodes**. «Мед + Рівненська область» is valid without price, quantity, receipt or radius. The form defaults to Ukraine, leaving every other criterion blank. Region/cities without a country imply Ukraine through the canonical directory. Radius alone does not replace the required geography level.

| Criterion | Matching semantics |
| --- | --- |
| Category / subcategory | Request category equals the selection or an active descendant. |
| Country | Explicit Request country or canonical Ukrainian settlement identity; never inferred from author country or free text. |
| Region | Canonical public settlement belongs to the selected oblast. Unknown legacy free text fails this filter. |
| One or multiple cities | Exact canonical public settlement code; any selected city suffices. Up to 30 unique cities; all must belong to a selected oblast, if present. |
| Radius | Public point within the inclusive radius; absent public point fails the filter. Country/region/cities still apply. |
| Quantity min/max | Total requested quantity within inclusive bounds after conversion to subscription unit. kg ↔ ton converts; other units must match exactly. Missing quantity fails when bounds exist. CURRENT Request creation still rejects missing quantity. |
| Price minimum / range | Buyer per-unit budget and seller acceptable per-unit range overlap inclusively. Missing bound is unbounded on that side; both buyer bounds absent fail a configured price filter. Currency must match; no exchange conversion. Price converts inversely to quantity for kg ↔ ton. |
| Receipt methods | SELF_PICKUP: buyer collects from seller. SELLER_DELIVERY: seller or seller's transport brings goods to the buyer-defined place. A selected method must equal the explicit Request method; missing/ambiguous method fails this filter. Pickup-only cannot match seller delivery. |

All selected criteria combine with **AND**; selected city and receipt lists use **OR** internally. Unset optional criteria impose no restriction: an unpriced/unspecified-receipt Request can match a subscription with no corresponding criterion. Selecting only unit or currency still restricts that dimension. Missing-value rules are explicit fixed policies, described in the form; no additional policy field is required. Carrier/postal delivery is not implemented; the separate receipt enum can be extended in a later migration without changing these two meanings.

## Storage, ownership and API

Migration 040_demand_subscriptions.sql adds owner/category/region/active/timestamps and the DB partial unique notification index (demand_subscription_id, buy_request_id). Migration 041_demand_subscription_criteria.sql extends subscriptions with optional criteria and DB range/shape/minimum checks, adds Request country/receipt fields, and backfills canonical Ukrainian locations and unambiguous receipt values. Prior nationwide/oblast subscriptions retain their Ukraine scope.

All endpoints require authentication. Ownership comes from the authenticated user, never input. Single-record reads/edits/deletes use both ID and owner and return 404 SUBSCRIPTION_NOT_FOUND for foreign or missing records. Lists contain only owned subscriptions.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /api/demand-subscriptions | Own subscriptions, newest first; criteria and canonical settlement labels. |
| POST | /api/demand-subscriptions | Required category/geography minimum; all other criteria optional; active defaults true. |
| GET | /api/demand-subscriptions/:id | Own record only. |
| PATCH | /api/demand-subscriptions/:id | Supplied criteria replace fields; omitted fields remain. Null clears scalar limits; empty arrays clear cities/methods. Validate the entire merged record under owner row lock. |
| DELETE | /api/demand-subscriptions/:id | Delete own record; retain delivered history. |

Fields: categoryId, countryCode, region, settlementCodes, center (latitude/longitude), radiusKm, minQuantity, maxQuantity, unit, minPrice, maxPrice, currency, receiptMethods, active. Numeric quantity/price criteria accept up to four decimals. Bounds need a unit; price needs currency too; radius needs both center coordinates. Unknown fields, invalid/inactive taxonomy, unknown countries/regions/cities, contradictory geography, duplicate cities/methods, unsupported methods, invalid ranges and empty patches are rejected. Partial Request location edits also validate country against stored settlement.

## Immediate delivery and security

Request creation and notification insertion share one DB transaction. Only active subscriptions created before that Request and active category ancestors are eligible; the author is excluded. Creating/editing/enabling subscriptions applies to future Requests; editing a Request sends no new alerts.

Matched candidates are locked until transaction end, protecting concurrent disable/edit/delete. ON CONFLICT DO NOTHING is backed by the DB unique index. One subscription generates at most one alert per Request; overlapping separate subscriptions may each alert their owner. Deletion stops future delivery and clears the source reference, preserving history.

The notification has a category-based title, generic body, selling context and canonical /buy-requests/:id reference. It contains no private address, coordinates, Request description or profile location. Radius uses the shared map public projection; canonical destination retains the existing privacy contract.

## Validation and independent review

Implementer: Codex (GPT-6). Risk: High (ownership, matching, transaction and migrations). Independent reviewer: pending. No independent PASS is claimed.

Real-DB coverage: owned CRUD/access denial, minimum geography, category descendants, country/region/single/multiple city matches and non-matches, merged-patch validation, quantity/unit conversion, per-unit budget/currency/unknown-price rules, explicit receipt mismatch/unknown rules, disabled/deleted/edited subscriptions, no historical replay, concurrent duplicate suppression and direct DB uniqueness, self exclusion, canonical notification references, public rounded radius/privacy and rollback. Pure matcher tests cover missing quantity and combined AND/OR criteria independently of CURRENT quantity-required DB rules.

Browser coverage uses actual Chromium UI with API fixtures, separately from real PostgreSQL integration; it does not claim a live authenticated backend E2E flow. Checks include the settings route at 1440/1024/768/390/320 px, minimum creation, all editable criteria, multiple city add/remove, radius point inputs/map, save/reload/edit, disable/enable/delete, long labels, control bounds/overflow and errors/retries. Selling notifications open and refresh their canonical Request with clear receipt wording.

Validation on this PC:

- Migrations 040 and 041 applied successfully to local PostgreSQL/PostGIS.
- Targeted matcher + real DB + Request validation: 40/40 PASS (16 subscription integration, 15 matcher, 9 Request validation).
- Full npm test with .env loaded and no-file-parallelism: 164/164 PASS, 27 files. One worker avoids the local DB contention observed in the earlier default-parallel baseline run.
- Chromium UI suite: 11/11 PASS. Settings CRUD/all criteria at 1440/1024/768/390/320 px; category + country/region/city minimum without optional fields; Request creation without budget and with explicit receipt at 1440/390/320 px; notification canonical destination/refresh; error retry.
- Responsive screenshots were visually inspected. The Request receipt selector uses short labels plus a wrapping full explanation to avoid clipped meaning on mobile; affected 1440/390/320 px checks passed again (3/3) after this fix.
- Final typecheck and build PASS. Git whitespace check PASS for tracked diff and all 13 new Step 8 files.
- Branch handoff/step-8 and HEAD 146ead23e8770fcf9cefc910fe30d9a9db260df3 preserved; index empty. No commit/push/merge. Stash untouched and unrelated package-lock.json, README_SYNC.txt, _transfer/, sync-import.bat preserved.

QA boundary: no authenticated browser session or docs/TEST_ACCOUNTS.local.md was available; live authenticated manual QA was not performed. City-center resolution uses existing HERE configuration and reports its existing ambiguity/configuration errors; external HERE availability is not covered by fixture tests. Existing shared toast placement can temporarily overlap mobile navigation. Existing Vite large-bundle advisory remains outside this change.

No AI, keywords, scoring/recommendations, route/corridor engine, advanced polygons, postal/carrier, paid subscriptions, digests, external channels or Step 9 implementation.
