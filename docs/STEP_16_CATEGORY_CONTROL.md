# Step 16 — category recommendation and validation

Status: implementation awaiting independent review. No merge to `main`.

## Current design

`category-recommendation.ts` reads the active PostgreSQL category tree and caches it for one minute. It uses a small set of subject phrases in Ukrainian and Russian, checks title before description, and uses confirming context before a hard decision. For example, `медогонка` is equipment, `медичний халат` is clothing, and `автомобіль для пасіки` is a car. Where no subject rule applies, matching words in actual category names can produce suggestions but never a block. The API returns up to three active category IDs with full paths. It never changes the selected category.

The levels are `allow`, `warn`, and `block`. A `warn` is returned on successful create/update as `categoryWarning`; the frontend also shows it before submission. A `block` returns HTTP 422 `CATEGORY_MISMATCH` with message, suggestions and appeal guidance. A block needs a subject in the title, confirming context, no contradictory subject in the description, and a different top-level category. Ambiguous short titles and conflicting title/description fall back to warning or no decision. The score is not presented as a probability. Product drafts can be saved despite a mismatch; publishing rechecks. Both Product and Buy Request creation and material edits call the same assessment on the backend. Unrelated edits to old records do not trigger it. No mass recategorization or change to search ranking was made.

`category-duplicates.ts` compares the same author's active listings across categories. Exact or highly similar titles and descriptions generate a warning with a link to an existing listing and an audit-log marker. Four simultaneous exact copies in different categories result in HTTP 409 on the fourth. Seller-scoped advisory locks serialize this check. Photos are not compared; legitimate similar listings are not automatically blocked. Moderation can inspect `listing.category_warning` and `listing.category_duplicate` audit events later.

Reports use the existing `reports` table and moderation endpoints. A new "Неправильна категорія" reason is offered on Product and Buy Request detail pages. Sequential and concurrent duplicate open reports by one reporter for one listing are rejected. Reports are private to the reporter and configured moderators. Migration 050 adds `category_appeals`; an owner can appeal a blocked draft, with duplicate pending appeals rejected. Configured moderators can list and update appeal status via API. There is no new admin panel or promise of immediate review.

## Category audit

The local active tree has 1,308 categories and 18 roots. Repeated display names include `Інше` (27 branches) and car brands under distinct branches; full paths and stable IDs disambiguate them. `Мед` exists as `honey_raw` under `Продукти бджільництва`. There is no precise beekeeping-equipment leaf, so equipment is suggested under the existing business equipment branch; that catalog gap needs separate product approval before restructuring. No category rows were moved or deleted.

## Validation

The curated 100-listing control set contains 40 correctly categorized, 40 deliberately incorrect and 20 ambiguous Ukrainian/Russian entries. Results: correct category in top three 40/40; false warnings 0/40; false blocks 0/40; wrong-category cases detected 40/40, of which 39/40 blocked; ambiguous cases left undecided 19/20. These figures describe this hand-built control set only and are **not** estimates of marketplace-wide accuracy. More independent data is needed before expanding hard blocks.

On 20 local calls with a warm category cache, classifier time was 3.2 ms median and 25.0 ms p95 in the focused PostgreSQL test. This measures only local classification, not end-to-end HTTP latency or cold-cache behavior.

Focused real-PostgreSQL integration covers Product and Buy Request create/edit, draft publication, direct API rejection, appeals, reports, duplicate listings, ownership and no leaked report text. Existing Smart Search and category/map integration tests were rerun with valid bicycle category fixtures. The complete backend suite passed 240 tests, with one pre-existing live-provider test skipped. Browser E2E passed 1/1 using real Chromium, frontend, API and PostgreSQL with no API stubs. It checks category suggestions, rejected/accepted publication, retained form state, search, reporting, an ambiguous title, Seller Offer creation, and responsive forms at 1440/1280/1024/768/390/320 px. Typecheck and production build passed.

## Remaining limits

- Unknown goods and nuanced mixed listings may receive no recommendation. The fallback never blocks.
- Deliberate wording changes can evade a local deterministic classifier. Conflicting title and description generate a warning rather than a permanent automatic block.
- Duplicate detection is author-scoped and based on text. Images and cross-account abuse need a separate moderation step.
- Cache and recommendation rate limit are per process; a shared limiter would be needed for multiple API instances.
- Existing reports and appeals need a human moderator for decisions. They never automatically remove listings.
