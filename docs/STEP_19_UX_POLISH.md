# Step 19 — UX location, delivery and favorites

## Changes

- Product and Buy Request create/edit forms show the selected settlement. When a pin moves, the existing HERE reverse lookup supplies a region/locality label for that point; if lookup is unavailable, the form identifies it as a selected map point. Coordinates, privacy and saved geography are unchanged.
- Shared delivery selector explains each method from the buyer's or seller's point of view. Buyer seller-delivery uses the same Buy Request location as its destination and shows the location field's current display label, including a moved pin's resolved locality, when known.
- Selecting `FLEXIBLE` visually checks and disables the other displayed methods. The form sends only `{ method: 'FLEXIBLE' }`; visual checks do not become delivery options. The preceding manual selection is restored when flexibility is switched off in the same editing session. The backend continues to treat flexibility as `POSSIBLE_AGREEMENT`, not an `EXACT_MATCH`.
- Product and Buy Request favorites buttons sit over the lower-right area of the card image, including category fallback images. The existing button handler and server favorites API are unchanged.

## Validation

`npm run typecheck` passed. Focused backend delivery compatibility, delivery integration and Favorites integration tests passed (10/10) with the local database. Plain `npm test` ran without loading `.env`, so database-gated files reported no test suite; 152 unit tests passed. A full run with `.env` was stopped after several existing Buy Request integration tests timed out under parallel load. Browser QA, including responsive widths and a physical Android device, remains **UNVERIFIED** because the Chromium computer-use transport is unavailable. No API, schema or dependency changes were made.

Independent Sol code review: **PASS** after corrections to the pin locality, mobile Product favorite position, and shared Buy Request destination label. The separate Browser QA gate remains **UNVERIFIED**, so Step 19 is not ready for integration.
