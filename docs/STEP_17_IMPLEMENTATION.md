# Step 17 — Mobile UX, forms and Buy Request

Status: independent REVIEW PASS on 2026-10-22. See [STEP_17_REVIEW.md](STEP_17_REVIEW.md) for independent evidence and remaining UNVERIFIED device checks.

## 17A — Mobile UX and map

- «Знайти» in the five-button mobile navigation keeps `/discover` and requests a one-time scroll to the existing map. Filter changes and browser Back do not trigger that scroll. Map search settings are restored from browser session storage when returning to `/discover`.
- Selecting a marker highlights its short card. On narrow viewports the map centers the marker near its upper edge in one map movement, then scrolls enough to reveal the marker and beginning of the card. Empty map clicks clear only local selection. Leaflet drag/zoom and map controls keep their existing behavior.
- The result-panel arrows reflect the panel's current scroll bounds and scroll that panel. Swiping remains available. Favorites are untouched by map selection.
- Product/Request report action reads «Повідомити про проблему з оголошенням». Its separate `?` explains the existing «Неправильна категорія» reason. Submission, authorization, duplicate checks and moderation statuses remain on the existing API.
- Delivery-option checkboxes use a horizontal, touch-sized label row. Avatar editor inputs stay within the viewport. Delivery matching, avatar storage and navigation structure are unchanged.

## 17B — Category picker and USD

- A parent category opens its children; a separate «Вибрати» action keeps explicit parent selection. Navigation works with an empty listing title. Product, Buy Request and subscription forms use the same picker.
- USD is added to the existing shared frontend selector. Product, Buy Request, Seller Offer, Deal, map previews and notifications preserve the entered numeric amount and show USD as `$`. No exchange rate or conversion is used.
- The backend and PostgreSQL already accept three-letter uppercase currency codes. Offer currency must match Request currency. Step 17 needs no currency migration and does not modify historical rows or Deal snapshots.

## 17C — One or several sellers

- The existing `fulfillment_mode` field remains the API and database contract. New Buy Requests default to `single_seller`; migration `052_default_single_seller.sql` changes only the database default. Existing Requests retain `multiple_sellers` or their previously saved explicit mode.
- One checkbox enables `multiple_sellers`. In `single_seller`, several sellers may make Offers and the chosen seller may fulfil the quantity through multiple partial Deals. A transaction locks the Request while accepting an Offer and rejects a Deal from another seller while a selected, active, disputed or completed Deal with the chosen seller exists. Cancelled, failed, rejected and expired Deals release that seller restriction according to existing quantity accounting.
- Mode edits are allowed with Offers or one seller's Deals. Switching to `single_seller` is rejected when non-released Deals involve two sellers. Existing Offer terms, Deal snapshots, completion rules, ratings and reviews remain unchanged.
- Existing indexes on `orders(buy_request_id, status)` and Request row locking support the seller check; no new index was needed.

## Validation and limits

- Migration 052 applied to local PostgreSQL.
- The full backend suite with local PostgreSQL passed: 44 files and 248 tests; one environment-dependent test was skipped. The Step 17 integration test covers USD persistence, one-seller restriction, cancellation, 8 + 12 kg concurrent selection, and incompatible mode edits.
- `npm run typecheck` and `npm run build` passed. Chromium automated QA verified `/discover` without horizontal overflow at 320, 360, 390, 430, 768, 1024, 1280 and 1440 px, including explicit «Знайти» at mobile widths. At 320 px, `/my/requests/new` verified empty-title category navigation, delivery selection and the default checkbox; `/settings/profile` verified the editor with a long URL and visible actions.
- The map marker/card/report scenario passed in `e2e/step-17-mobile.spec.ts`; it submits a test report and removes its test records. `e2e/step-17-usd-ui.spec.ts` passed Product, Buy Request and Seller Offer publication via the UI with USD, then removed those test records.
- The earlier Step 16 category Browser E2E passed after its parent-category action was updated for the new picker.
- A separate manual in-app browser pass at approximately 409 px confirmed that «Знайти» scrolls to the map, a chosen marker and card beginning remain visible together, and an empty-map click clears selection. The independent reviewer completed the real Chromium and PostgreSQL scenarios documented in [STEP_17_REVIEW.md](STEP_17_REVIEW.md). Physical Android Chrome, a real on-screen keyboard and file chooser remain **UNVERIFIED**.
