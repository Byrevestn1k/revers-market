# Step 29 — final reviewer corrections

Base: `31d0c98ce70a1f69ea3d8b4fcea57e496fd24955`.

## Rating and review semantics

Published reviews from an order with status `cancelled` are excluded from seller and buyer rating aggregates, the seller offer rating and public review lists. The database rows are preserved. Opening a dispute on a completed order leaves its status `completed`; it therefore remains included until both sides resolve it as cancelled. Role validation requires both Deal participants to match the review's reviewer and reviewee. Existing publication and moderation fields are not modified.

Public profile GET returns `profile` and a `reviews` array computed in the same PostgreSQL statement snapshot. The public profile UI consumes these together. The existing reviews endpoint uses the same published, role and cancellation filters; independent HTTP responses can represent different committed instants. The list remains capped at 100 while rating counts include all qualifying reviews. Opening a profile continues to publish due reviews through the pre-existing publication process.

`ratingSummary` is a deprecated compatibility field: it is the old mixed aggregate, including the historical trigger semantics, and must not be treated as a role-specific score. Repository audit found no frontend rendering consumer, only retained TypeScript declarations and legacy backend compatibility tests. Canonical fields are `sellerRating` and `buyerRating`; removing the old field would break the existing API contract.

## Verification

- `npm run typecheck`: passed after the SQL syntax correction.
- Full backend: 53 files passed, 1 skipped; 310 tests passed, 1 skipped. Subsequent test-only changes were run separately: cancellation, both roles and parallel profile/reviews request scenario passed. Security, direct Deal, ordinary Deal and regression suites included.
- Legacy fixture: two completed orders changed to `workflow_version=1` with legacy null completion timestamps, historical-dated reviews and repeated publication; targeted test passed on isolated PostgreSQL. This is a reproducible fixture, not a copy of real data.
- Chromium: 2 passed. Long nickname on public profile at 320, 390, 768, 1024, 1280 and 1440 px, including horizontal overflow check. Mutual reviews through UI at 390 px; own profile at 390 px; seller offer rating at 390/1280 px; Product and Buy Request at 390/1280 px. Context chat opened from both participant sessions: buyer at 1280 and seller at 390. The checked chat header does not itself display a numerical rating; no numerical rating assertion is claimed there. API setup created the test accounts, listings and completed Deal.
- No migration added; test DB was isolated at 127.0.0.1:55436. Existing main DB and snapshots were not altered.

## Remaining review points

The old compatibility field is deliberately still mixed and does not implement the new role-specific cancellation rule. Contextual chat's checked header shows no numerical rating; the buyer screenshot shows a generic counterpart label in the open panel, so role identity in that particular panel remains unverified. The historical fixture reproduces legacy workflow data rather than replaying migration 033 on a pre-033 database. Sol should review these constraints, the status predicate, query cost, privacy and the one-statement snapshot contract.

## Follow-up after Sol review of 2a326887

The profile/reviews snapshot is now opt-in with `?includeReviews=1`; ordinary profile GET and all private profile operations do not load or return review bodies. The profile page requests this snapshot. If an older backend omits `reviews`, the page falls back to the existing reviews endpoint; that compatibility path uses separate requests and cannot promise one snapshot. Both endpoints now order ties by review ID, so the same data yields the same list order.

After this follow-up: `npm run typecheck` passed; the full Deal workflow and profile tests passed (21/21), including the final targeted check that ordinary GET omits reviews. Chromium passed 3/3, including a simulated older API response without embedded reviews. The prior full backend run (310 passed, 1 skipped) was before this narrowly scoped read-path follow-up; no Deal lifecycle or Review-writing logic changed in the follow-up. One intermediate run failed because equal timestamps were ordered differently; it was fixed and rerun successfully.
