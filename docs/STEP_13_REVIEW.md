# Step 13 — final independent review

**Result:** REVIEW PASS on 2026-10-15. Feature branch `codex/step-13-seller-offers`; final correction `1945b3e` follows `adcda36`.

## Verified

- Three Offer creation paths, editing, comparison, quantity reservation, permissions and Deal lifecycle have earlier real-DB and Browser E2E evidence. The final review re-ran the five core Buy Request/Offer integration tests (5/5).
- Product photo copies use a fresh key for every copy. Photo insertion, reordering and repeated edits cannot overwrite earlier files; photo-storage tests passed (4/4). A missing local source retains its URL for the UI fallback instead of aborting Offer acceptance.
- The photo-retention DB test passed (1/1): cancelled and completed Deal snapshots, another Offer sharing a file, deletion of an unreferenced file, repeated deletion and concurrent edit/accept. Reference checks cover `offer_photos`, legacy `additional_photo_url`, and photo URLs in both `orders.conditions_snapshot` and `order_items.offer_terms_snapshot`, regardless of Deal status.
- Advisory lock order is now request/Offer row → photo advisory lock → Product row in Offer creation, photo edit and acceptance. The focused real-DB test passed (1/1), proving a request waiting for the photo lock does not hold a Product lock. A second read-only reviewer inspected the final diff and found no remaining deadlock in that path.
- For a pre-045 Offer without owned photos, acceptance copies surviving Product photos into `offer_photos` before writing both Deal snapshots. The legacy DB test passed (1/1): historical photos survived Product photo deletion; price, quantity, unit, delivery, description, participants and snapshot stayed fixed after permitted Product/Request changes, while accepted Offer editing returned 409. Explicit `photos: []` no longer revives the legacy Product-photo fallback.
- Migration 045 adds nullable legacy-compatible Offer fields, constraints and `offer_photos` without deleting historical rows. Its runner records each version transactionally. A repeated local run returned `Database is up to date`; the test simulated a pre-045 Offer row. A full migration on a separate pre-045 database copy was not performed.
- `npm run typecheck` passed for both workspaces, followed by backend typecheck after the final test edit. Photo-storage, draft and validation unit tests passed (18/18). The initial combined DB run had one timeout under parallel load; the same five core cases passed when run alone with one worker.

## Browser evidence and limits

Earlier Step 13 Chromium E2E covered creation, editing, comparison, acceptance, Deal completion, reviews and notifications. Targeted correction Browser QA covered the changed form and gallery at 1440, 1280, 1024, 768, 390 and 320 px. This final correction changed backend logic and storage fallback only; no Browser E2E was repeated. Replacing a broken image in the UI, historical Deal photo display, live Step 8 subscriptions and a separate Chat E2E remain UNVERIFIED. Step 12 map-marker flows and physical mobile keyboard language switching remain separate UNVERIFIED/OPEN items.

Local uploaded image URLs are served by the existing static `/uploads` route. The reference check adds no API disclosure, but a person who knows a photo URL can request it directly; changing that access model needs a separate product/security decision. External image URLs remain dependent on their host. An unavailable URL shows the existing fallback, but its content cannot be guaranteed or reconstructed. Files already deleted before these fixes cannot be recovered by this correction.
