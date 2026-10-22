# Step 17 — independent review

**Decision: REVIEW PASS.** Reviewed `codex/step-17-mobile-forms-buy-request` against base `4cd8ca73e716545969e6b31ed82b2d58f2f91f04` on 2026-10-22. No blocking Step 17 defect was found. This review inspected the changed code and migration, added independent API concurrency assertions and Chromium E2E, then ran focused existing regressions. It did not re-audit unrelated features.

## 17A — mobile map and forms

- Independent Chromium checks at 320, 390, 430, 768, 1024, 1280 and 1440 px passed for `/discover`, `/my/requests/new` and `/my/products/new`: no horizontal overflow, mobile «Знайти» reveals the map, Back returns to the map, the untitled Request can navigate into «Авто», delivery labels toggle their checkboxes, and USD is available.
- Independent 390 px map scenarios passed: selecting a marker displays its matching card; zooming out and dragging preserve selection; clicking empty map clears it; Favorites remain unchanged. A real five-result cluster opens all five matching cards. The result panel's down/up arrows follow its scroll position and a simulated touch swipe scrolls the panel.
- Additional real Chromium scenarios passed for saved map search state, marker/card visibility, report explanation and submission, delivery choices, avatar editor sizing and controls. The `?` button only opens the explanation; the report action submits separately. The existing PostgreSQL category test confirmed anonymous reporting is rejected and duplicate reporting returns 409; Step 16 moderation access rules remain in the unchanged API.

## 17B — category picker and USD

- The shared picker permits navigating into a parent category with an empty Request title; Product and Request forms retain manual selection. The Step 16 recommendation path does not set the selected category on its own.
- Real Chromium form scenarios created Product, Buy Request and Seller Offer at 100 USD. PostgreSQL integration verified Product create/edit, Request create/edit, Offer edit and Deal snapshots preserve the amount and `USD` code. Detail, card, map, Deal and notification formatting uses the existing amount with `$`; no exchange conversion was added. UAH, EUR and PLN remain in the selector.
- Server validation accepts uppercase three-letter currency codes and requires Offer currency to equal Request currency. Subscription matching rejects price comparisons when currencies differ; no exchange rate is assumed.

## 17C — seller modes and historical data

- Migration 052 changes only the default for new Buy Requests. The historical QA Request `6ab575e5-9b88-4295-a967-36a1d90d4fc4` still has `multiple_sellers`, two completed Deals (8 + 12 kg), two Offers and two nonempty Deal snapshots. Its two order items remain present. That fixture has no Request photos, so historical photo contents were not empirically compared; the migration does not touch photo tables.
- Independent concurrent API requests against PostgreSQL confirmed that two sellers competing for a new single-seller Request produce one HTTP 201 and one HTTP 409, one seller in `orders`, and that the chosen seller can supply the remainder in a second Deal. Two 12 kg selections against a 20 kg multiple-seller Request produce one HTTP 201 and one HTTP 409, with exactly 12 kg reserved and no extra order. The existing 8 + 12 kg concurrent test passes, as do cancellation/reallocation and incompatible mode-switch checks.
- Independent Chromium at 390 px confirmed that, after choosing Seller A's 8 kg Offer, Seller B's Offer is disabled in single-seller mode. In multiple-seller mode, Seller A's 8 kg and Seller B's 12 kg Offers both create Deals and the remaining quantity becomes zero. Existing Deal regression tests cover historical terms, photo snapshots and double confirmation.

## Validation

- `npm run typecheck`: passed.
- PostgreSQL: `step-17.integration.test.ts` 1/1 (including added concurrency assertions); `buy-requests.integration.test.ts` and `deal-workflow.integration.test.ts` 18/18; `category-validation.integration.test.ts` 1/1.
- Focused unit tests: `demand-matching.test.ts` and `listing-options.test.ts` 22/22; `map-interactions.test.ts` and `map-clusters.test.ts` 6/6.
- Independent `e2e/step-17-review.spec.ts`: seven responsive tests plus seller-mode, drag/zoom and cluster/touch tests passed (10/10 across focused runs). The implementer's `step-17-mobile.spec.ts` and `step-17-usd-ui.spec.ts` were also rerun independently and passed 12/12; their prior run was not counted as reviewer evidence.
- `git diff --check`: passed. The first wide PostgreSQL run hit `ECONNRESET` while Docker restarted; the affected focused suites passed after the container recovered. An initial reviewer map test attempted zoom-in at the maximum zoom; correcting that test to zoom-out passed.

## Remaining UNVERIFIED

- Physical Android Chrome, an actual on-screen keyboard while the avatar modal is open, and a native file chooser were unavailable. Chromium touch emulation is not a substitute for these device checks.
- The historical QA Request had no stored Request photos, so old photo bytes were not compared before and after migration. USD notification text was reviewed in code and existing event paths, but no separate rendered notification for a new USD Deal was asserted in Chromium.
