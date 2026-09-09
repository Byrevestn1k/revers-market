# QA report: MVP readiness

## Scope

The release covers the MVP path: registration, product and buy-request CRUD,
offer negotiation, partial acceptance, order chat, controlled order status,
reviews, reporting, blocks, privacy and map search.

## Automated checks

- `npm run typecheck` — TypeScript for frontend and backend.
- `npm run test --workspace backend` — unit tests and DB-backed integration
  tests when `DATABASE_URL` is set.
- `backend/scripts/e2e-flow.test.ps1` — manual HTTP E2E flow against a running
  local API and migrated local database.

Integration suites deliberately skip without `DATABASE_URL`; a green skipped
suite is not database verification. Run migrations and set `DATABASE_URL`
before declaring a pilot build ready.

## Required pre-pilot checks

1. Apply migrations on a clean local database.
2. Run typecheck and backend tests.
3. Start the API and run `powershell -ExecutionPolicy Bypass -File backend/scripts/e2e-flow.test.ps1`.
4. Manually verify mobile layout for product, request, offer, chat and order.
5. Confirm a public product/request response contains no exact address or
   private phone number.
6. Confirm the delivery-address endpoint returns data only for order
   participants after an offer has been accepted.

## Known MVP boundaries

- No payment processing, escrow or delivery-provider integration.
- No native mobile client, AI ranking or production logistics.
- Notifications are in-app; email/push delivery is intentionally deferred.
