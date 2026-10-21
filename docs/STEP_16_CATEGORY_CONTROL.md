# Step 16 — category recommendation and validation

Status: reviewer correction №1 in validation. No merge to `main`.

## Current design

`category-recommendation.ts` reads the active PostgreSQL category tree and caches it for one minute. It uses subject phrases in Ukrainian and Russian, separates an explicitly named gift from the main item, and checks the earliest subject phrase in the title before the description. Purpose and compatibility phrases such as `для ляльки` or `для велосипеда` identify the offered item; a color word does not replace it. For example, a toy car stays a toy, a doll gown stays in toys, a honey extractor is equipment, and a car for an apiary remains a car. Where no subject rule applies, matching words in actual category names can produce suggestions but never a block. The API returns up to three active category IDs with full paths. It never changes the selected category.

The levels are `allow`, `warn`, and `block`. A `warn` is returned on successful create/update as `categoryWarning`; the frontend also shows it before submission. A `block` returns HTTP 422 `CATEGORY_MISMATCH` with message, suggestions, a persisted `decisionId` and appeal guidance. A block needs a subject in the title, confirming context, no contradictory subject in the description, and a different top-level category. Ambiguous short titles and conflicting title/description fall back to warning or no decision. The score is not presented as a probability. Product drafts can be saved despite a mismatch; publishing rechecks. Both Product and Buy Request creation and material edits call the same assessment on the backend. Unrelated edits to old records do not trigger it. No mass recategorization or change to search ranking was made.

`category-duplicates.ts` compares the same author's active listings across categories. It normalizes case, whitespace and punctuation in both title and description before deciding whether two texts are identical; adding `!` does not evade the existing limit. Similar, non-identical listings receive a warning with a link to an existing listing and an audit-log marker. Four simultaneous exact copies in different categories result in HTTP 409 on the fourth. Seller-scoped advisory locks serialize this check. Photos are not compared; legitimate similar listings are not automatically blocked. Moderation can inspect `listing.category_warning` and `listing.category_duplicate` audit events later.

Reports use the existing `reports` table and moderation endpoints. A new "Неправильна категорія" reason is offered on Product and Buy Request detail pages. Sequential and concurrent duplicate open reports by one reporter for one listing are rejected. Reports are private to the reporter and configured moderators. Migration 050 adds `category_appeals`; migration 051 adds persisted block decisions and a foreign key from appeal to decision. The backend creates a decision for each distinct blocked attempt, reuses an identical recent decision for one hour, and limits new decisions to 60 per account per hour. An owner can appeal only their own recorded decision; duplicate appeals are rejected. A moderator can see the original block reason and rule version and update appeal status via API. There is no new admin panel or promise of immediate review.

## Category audit

The local active tree has 1,308 categories and 18 roots. Repeated display names include `Інше` (27 branches) and car brands under distinct branches; full paths and stable IDs disambiguate them. `Мед` exists as `honey_raw` under `Продукти бджільництва`. There is no precise beekeeping-equipment leaf, so equipment is suggested under the existing business equipment branch; that catalog gap needs separate product approval before restructuring. No category rows were moved or deleted.

## Validation

The original curated 100-listing control set contains 40 correctly categorized, 40 deliberately incorrect and 20 ambiguous Ukrainian/Russian entries. After the correction: correct category in top three 40/40; false warnings 0/40; false blocks 0/40; wrong-category cases detected 40/40, of which 38/40 blocked; ambiguous cases left undecided 19/20.

The separate correction set has 100 new listings: 40 correct, 40 incorrect and 20 ambiguous, including toys, gifts, accessories and equipment compatibility. Results: correct category in top three 80/80 for the cases with a known answer; false warnings 0/40; false blocks 0/40; obvious wrong-category cases detected 40/40, of which 28/40 blocked and 12/40 warned; ambiguous cases blocked 0/20; no suggestions for 2/100. The 18 independent Sol review examples were replayed separately: top-three 17/17 eligible, false blocks 0, missed required blocks 0, false warnings 0, unresolved 1. These are hand-built control sets and **not** estimates of marketplace-wide accuracy.

On 20 local calls with a warm category cache, classifier time was 3.1 ms median and 5.5 ms p95 in the focused PostgreSQL test. This measures only local classification, not end-to-end HTTP latency or cold-cache behavior.

Focused real-PostgreSQL integration covers Product and Buy Request create/edit, draft publication, direct API rejection, decision-linked appeals, reports, punctuation-resistant and parallel duplicate listings, ownership, the 60-decisions-per-hour limit and no leaked report text. The original 100 and independent correction 100 use the real active category tree. The full backend suite passed 242 tests with one pre-existing live-provider test skipped when run with one worker and a 15-second test timeout. Default parallel runs had only 5-second timeouts in an unrelated demand-subscriptions test; its isolated run passed 32/32. Typecheck and production build passed. The targeted real-Chromium regression passed 1/1 with product and request publication, appeal, gift and toy cases, manual recommendation selection, Seller Offer, and form widths at 1440 and 390 px.

## Test-data cleanup

The integration test registers uniquely named `step16_...` users and removes those users in `finally`; dependent test listings, decisions and appeals are removed by the database's foreign keys. Browser QA removes only the product, request, offer, appeal and decision IDs it created. For older unwanted decisions, first inspect `user_id`, status, age and linked appeal. A moderator may manually remove an explicitly identified test decision with no appeal. Open appeals must never be removed by an automated retention job. This correction does not add a general cleanup job or modify Docker volumes.

## Remaining limits

- Unknown goods and nuanced mixed listings may receive no recommendation. The fallback never blocks.
- Deliberate wording changes can evade a local deterministic classifier. Conflicting title and description generate a warning rather than a permanent automatic block.
- Duplicate detection is author-scoped and based on text. Images and cross-account abuse need a separate moderation step.
- Cache and recommendation rate limit are per process; a shared limiter would be needed for multiple API instances.
- Existing reports and appeals need a human moderator for decisions. They never automatically remove listings.
