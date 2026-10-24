# Step 19 Browser QA — 24 October 2026

## Result

| Requirement | Result | Real Chromium evidence |
| --- | --- | --- |
| D — location | PASS | Product and Buy Request showed the inherited place; clicking the map pin changed the display label; returning to the profile location restored it; both edit forms showed the saved place. |
| E — delivery explanations | PASS | Buyer and seller explanations appeared beside the delivery options on the forms and remained readable at 320 px. |
| G — seller delivery destination | PASS | Selecting seller delivery showed the Buy Request place; moving its pin updated the destination label to the same displayed place. |
| H — FLEXIBLE | PASS | Enabling checked and disabled the concrete options; disabling restored the previous manual selection; both creation payloads contained only `{ method: 'FLEXIBLE' }`; saved Product and Buy Request data and reopened edit forms retained the mode. |
| J — Favorites | PASS | Product and Buy Request hearts stayed inside the lower-right image area at all four widths. Authenticated clicks changed state without opening details; state persisted after reload. Guest click opened the login route. |

Chromium viewports: **320, 390, 768, 1440 px**. The test asserted no document-level horizontal overflow and captured full-page screenshots at every width. Main routes: `/my/products/new`, `/products/:id`, `/my/requests/new`, `/my/requests`, `/profiles/:username`. Test records were created with unique titles and removed after verification.

## Automated checks

| Check | Result |
| --- | --- |
| `node --env-file=.env node_modules/@playwright/test/cli.js test e2e/step-19-qa.spec.ts --project=chromium --workers=1 --reporter=line` | **1 passed, 0 failed** |
| `node --env-file=.env node_modules/vitest/vitest.mjs run --root backend --silent --maxWorkers=1 --minWorkers=1` | **248 passed, 0 failed, 1 skipped** across 45 files |
| Buy Request integration tests within full run | **5 passed, 0 failed** |
| `npm run typecheck` | **PASS** for frontend and backend |

The skipped Vitest file is `demand-suburbs.live.integration.test.ts`, which requires an opt-in live service. No Step 19 code error appeared. Docker PostGIS was healthy; backend `/health` returned `status: ok` and `database.status: ok`; frontend returned HTTP 200.

## Screenshots

- Product pin and location: [product-pin-1440.png](product-pin-1440.png)
- Buy Request pin and seller delivery destination: [request-pin-destination-1440.png](request-pin-destination-1440.png)
- Product FLEXIBLE form: [1440](product-form-flexible-1440.png), [768](product-form-flexible-768.png), [390](product-form-flexible-390.png), [320](product-form-flexible-320.png)
- Buy Request FLEXIBLE form: [1440](request-form-flexible-1440.png), [768](request-form-flexible-768.png), [390](request-form-flexible-390.png), [320](request-form-flexible-320.png)
- Product Favorites card: [1440](favorite-product-1440.png), [768](favorite-product-768.png), [390](favorite-product-390.png), [320](favorite-product-320.png)
- Buy Request Favorites card: [1440](favorite-request-1440.png), [768](favorite-request-768.png), [390](favorite-request-390.png), [320](favorite-request-320.png)
- Saved Favorites after reload: [favorites-active-1440.png](favorites-active-1440.png)

The Playwright test is in [`e2e/step-19-qa.spec.ts`](../../e2e/step-19-qa.spec.ts). A physical Android device was not tested.
