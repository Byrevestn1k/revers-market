# Step 19 — UX location, delivery and favorites

## Changes

- Product and Buy Request create/edit forms show the selected settlement. When a pin moves, the existing HERE reverse lookup supplies a region/locality label for that point; if lookup is unavailable, the form identifies it as a selected map point. Coordinates, privacy and saved geography are unchanged.
- Shared delivery selector explains each method from the buyer's or seller's point of view. Buyer seller-delivery uses the same Buy Request location as its destination and shows the location field's current display label, including a moved pin's resolved locality, when known.
- Selecting `FLEXIBLE` visually checks and disables the other displayed methods. The form sends only `{ method: 'FLEXIBLE' }`; visual checks do not become delivery options. The preceding manual selection is restored when flexibility is switched off in the same editing session. The backend continues to treat flexibility as `POSSIBLE_AGREEMENT`, not an `EXACT_MATCH`.
- Product and Buy Request favorites buttons sit over the lower-right area of the card image, including category fallback images. The existing button handler and server favorites API are unchanged.

## Validation

On 24 October 2026, `npm run typecheck` passed for frontend and backend. The complete backend Vitest run with `.env` and one worker finished with **248 passed, 0 failed, 1 skipped** (44 passing files, one skipped live test file). Buy Request integration tests passed **5/5**. Real Chromium Playwright E2E passed **1/1**, covering D, E, G, H and J on 320, 390, 768 and 1440 px. See [Browser QA evidence](step-19-qa/README.md) for routes, actions and screenshots. No API, schema or dependency changes were made.

Independent Sol code review of the implementation: **PASS** after corrections to the pin locality, mobile Product favorite position, and shared Buy Request destination label. Final independent review of the completed QA evidence is pending. A physical Android device was not tested.
