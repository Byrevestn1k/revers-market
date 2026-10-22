# Step 16 — category recommendations and safe validation

Status: independent final re-review №4 **PASS** after correction `badd55b`. The safe recommendation mode is approved for integration into `main`.

## Current behavior

`category-recommendation.ts` analyzes the named item and its context (purpose, compatibility, bundle or gift), then reads the active PostgreSQL category tree to suggest up to three existing categories with full paths. It returns `allow` or `warn`, plus `identified` or `uncertain`. These labels are decisions about available evidence, not percentages. Unknown or conflicting items remain `uncertain`. The selected category is never changed automatically.

Product and Buy Request use the same assessment on creation and relevant edits. A semantic mismatch can return `categoryWarning` in a successful API response and a visible recommendation before submission. It never causes HTTP 422 or creates a new `category_block_decisions` row. The author may keep a valid chosen category and publish. The listing form no longer offers an appeal for a semantic block that cannot occur.

Technical validation is separate: inactive or nonexistent category IDs still return `CATEGORY_NOT_AVAILABLE` (HTTP 400); invalid fields, ownership, Product/Buy Request business rules, and duplicate policy still apply. This correction does not change Step 14 delivery, Step 15 Smart Search or Deal behavior. `category-duplicates.ts` still normalizes case, whitespace and punctuation and rejects a fourth exact copy across categories with HTTP 409. Similar text can receive a duplicate notice.

The `Неправильна категорія` report remains on Product and Buy Request detail pages, with private report data and existing moderation statuses. Historical block decisions and their appeals remain in the database and on their existing API routes; `category-block-decisions.ts` keeps the old decision format separate from recommendation. No publishing route calls it. No new admin interface or schema migration was added. A future automatic semantic block requires a separate product decision, independent testing and measured precision before any production connection; there is no flag that re-enables the current unreliable rule.

## Category tree and limitations

The active tree previously audited has 1,308 categories and 18 roots. Repeated names are disambiguated by full path and stable ID. No category rows were moved or deleted. Recommendations cover the current rule set and category names; unknown goods or nuanced mixed listings may have no useful suggestion. In the live browser, `Килимки автомобіля Toyota` in the correct car-mats category still receives a false warning suggesting a car. Publication succeeds in the selected category; no new special-case dictionary rule was added. Deliberate wording can evade deterministic rules. Reports and warning audit events require human moderation. Duplicate detection is author-scoped and text-based, without image comparison.

## Regression coverage

The original 100-item set checks 40 correct, 40 wrong and 20 ambiguous Ukrainian/Russian listings. Correction №1 adds another independent 100-item set; correction №2 adds 70 contextual cases and a 22-case reviewer replay. Correction №3 expects **zero semantic hard blocks** in all sets while preserving detection through warnings. These hand-built sets do not estimate marketplace-wide accuracy.

The real PostgreSQL API test checks Product and Buy Request publication for the seven reviewer phrases (car mats, car cover, headlight, car parts, toy car, doll gown and apples with a bicycle gift), the four wrong-category warnings (honey, apples, smartphone, sofa), uncertainty, valid manual category change, draft publication, nonexistent-category rejection, duplicate normalization, reports, ownership and an appeal against a historical test decision. Smart Search and historical Deal are covered by their existing regression suites.

Browser E2E at 390 and 1440 px checks the live forms for car mats and a car-cover Buy Request, a wrong-category warning followed by publication, manual category change and a report by another account. The earlier Seller Offer test remains a separate regression check. Tests use existing local QA accounts and delete only records created by the test. Docker volumes are untouched.

## Validation results (correction №3)

- Full backend suite against the existing PostgreSQL: 245 passed, one existing live-provider test skipped, 43 files passed and one skipped. This includes Smart Search, Product/Buy Request, Offer and Deal integration tests. The two original and two independent category control sets reported zero semantic hard blocks; the 40/40 and 20/20 deliberately wrong cases in their respective sets remained detected through warnings.
- Frontend and backend TypeScript checks: passed. Production `npm run build`: passed for both workspaces; Vite reported only its existing large-chunk advisory.
- Chromium Browser E2E `e2e/category-step16.spec.ts`: 1 passed at 390 and 1440 px, using the real local API and PostgreSQL. It published car mats in the chosen category, published a car-cover Buy Request, showed a wrong-category warning, allowed publication after that warning, changed the category manually, and submitted a category report from another account. No horizontal overflow or clipped checked controls appeared in those forms. The correct car-mats title did still show a false warning, as noted above.
- The Seller Offer browser case was not rerun because the correction did not change its UI or API. Offer and Deal backend integration passed in the full suite.

## Independent final re-review №4 — PASS (2026-10-22)

The reviewer inspected the publishing paths and called the real API with the active PostgreSQL categories. Eight independent phrases were published as both Product and Buy Request (16 successful creates), including the previously blocked car mats, car cover and headlight, a toy car, a doll gown, apples with a bicycle gift, and deliberate honey/apples mismatches in the car category. Wrong categories returned a warning while retaining the author's chosen category. Relevant edits and draft publication succeeded; none of these semantic cases created a new block-decision row. Recommendation responses stayed at three categories or fewer.

Independent API checks rejected malformed and nonexistent category IDs, missing required fields, zero quantity and invalid business statuses with HTTP 400. A rejected create or edit left the listing counts and saved fields unchanged; another user's Product and Buy Request edits returned HTTP 404. Across four categories, title variants using `!`, extra spaces and different case produced statuses 201/201/201/409, while a genuinely different cable configuration published. A category report was stored; anonymous reporting returned 401, a duplicate report 409, non-moderator access to moderation reports 403, and the private report text was absent from the public Product response. A test decision in the historical migration-051 format remained appealable by its owner (201), not another user (404), and a repeated appeal returned 409. The test data was removed with its temporary users; existing historical records were not deleted.

The reviewer's focused PostgreSQL suite passed **16/16 tests in 7 files**, covering category behavior, Product, Buy Request/Offer and Smart Search. Root `npm run typecheck` passed. An independently written Chromium E2E passed **1/1** at **390 and 1440 px** using the documented local QA accounts: an automotive accessory Product, a correctly categorized Buy Request, a wrong-category warning followed by publication, manual application of an apple recommendation, preserved form values and a stored category report. The checked forms had no horizontal overflow or clipped key controls. The earlier independent Seller Offer E2E had passed at 390 px; it was not rerun because this correction did not change the Offer form or API.

The known false warnings and incomplete category coverage remain non-blocking in safe mode: they cannot cause semantic HTTP 422, recategorize a listing or prevent publication. The reviewer did not repeat the full backend suite or production build after this correction; those results above are implementer checks, not independent re-review evidence.
