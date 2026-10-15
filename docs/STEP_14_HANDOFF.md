# Step 14 — geography, receipt methods and matching: planning handoff

**Status:** documentation only, prepared after Step 13 merge. No Step 14 implementation is authorized by this file.

## ALREADY IMPLEMENTED

- Buy Request has one structured `receipt_method`: `SELF_PICKUP` means the buyer collects from the seller; `SELLER_DELIVERY` means the seller brings goods to the buyer. The form explains both. Legacy `preferred_delivery`/`delivery_required` values remain supported. See `frontend/src/subscription-criteria.ts`, `backend/src/buy-requests.ts` and `backend/src/buy-request-validation.ts`.
- Product separately has `delivery_mode`: `pickup`, `seller_delivery` or `carrier`. The Product path currently ends in direct chat. Seller Offer has one required free-text `delivery` field and optional delivery price; Step 13 stores the accepted value in the Deal snapshot. Offers can be standalone or linked to a Product, whose original terms are not changed by Offer edits.
- Buy Request geography stores country, optional Ukrainian settlement code, text area, location/privacy settings and optional coordinates. Search supports country, settlement and region filters; private coordinates are projected approximately for public discovery. Existing map search and verified city-boundary helpers provide geographic data.
- Step 8 seller demand subscriptions match new Requests by category and a union of selected countries, regions and cities, optional distance outside verified city boundaries (up to 20 km), optional quantity/unit and price/currency, and receipt method. Both receipt methods selected means unrestricted matching, including legacy Requests with unknown receipt. Matching uses public location projection. Request creation inserts deduplicated `selling` notifications in the same transaction. See `backend/src/demand-matching.ts` and `backend/src/demand-subscriptions.ts`.

## CONFIRMED PROBLEM / LIMIT

- Request receipt method and Product delivery mode use different models. Postal/carrier delivery exists for Product, but not in the two-value Request receipt method or Step 8 subscription receipt filter.
- Offer delivery is free text; the server checks that it is present and snapshots the selected value, but does not enforce semantic compatibility with the Request's `receipt_method` or a linked Product's `delivery_mode`. The UI compares terms for the buyer. This is a matching/product-rule decision, not a Step 13 data-integrity defect.
- No structured alternative receipt methods are stored on one Request or Offer. A city/suburb distance match in subscriptions indicates geographic relevance, not that a seller actually provides delivery to that location.
- Route/corridor matching and postal transport rules are outside the current engine. Private exact addresses must not be exposed through discovery or notification matching.

## PROPOSED CHANGE — requires product approval

1. Decide which receipt methods the marketplace should support, including carrier/postal delivery, and whether Buyer and Seller may list multiple acceptable methods and prices.
2. Decide local seller-delivery reach (same city, verified boundary plus radius, or another rule), how Seller capability and Buyer destination are represented, and what happens when precise private coordinates are unavailable.
3. Define compatibility and ranking rules for Request ↔ Offer ↔ Product and Step 8 subscriptions, including legacy records and mismatched free-text Offer delivery. Preserve agreed Deal snapshots when rules evolve.
4. After those decisions, design a backward-compatible schema/API/UI migration and focused DB, privacy and Browser E2E checks. Keep route/corridor matching as a separate future decision.

## UNVERIFIED

- Live Browser E2E for Step 8 subscriptions and separate Chat flows; Step 12 Buy Request map-marker scenarios. Existing focused automated coverage is recorded in project state.
- Exact seller delivery reach and carrier/postal handoff behavior have no end-to-end business rule to verify yet.
- Physical-device mobile keyboard language switching remains an unrelated open issue.
