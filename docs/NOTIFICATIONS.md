# Notifications contract

**Purpose:** authoritative feature contract for notifications, unread state, destinations and future seller demand subscriptions. This document separates CURRENT behavior from TARGET and FUTURE work.

## CURRENT

### Storage and API

`notifications` stores `user_id`, `type` (`order`, `message`, `review`, `report`, `system`), presentation `title`/`body`, persisted recipient `context` (`buying` or `selling`), optional `order_id`, `conversation_id`, `buy_request_id`, `read_at` and `created_at`. Current API lists the latest 100 notifications and returns exact unread `total`, `buying` and `selling` counters for all of the user's history; it marks one notification or all notifications in one context read. Existing historical rows with no provable structured relation retain `context = NULL`, count in `total`, and do not count in either context.

Current producers include Offer created/updated/withdrawn/rejected, Deal selection/confirmation/result/dispute, direct chat start, message sent, review submitted and new Buy Requests matching active seller demand subscriptions. Delivery is in-app only; external channels and digests are not implemented.

### Basic seller demand subscriptions — Step 8

Authenticated users manage their own subscriptions at /settings/demand-subscriptions. Minimum: category plus country, oblast or city/cities. A country includes all its settlements; a region includes its settlements; region and cities elsewhere form a union. Optional quantity/unit and per-unit acceptable price/currency combine with AND. Null unit/currency do not filter; kg/ton comparison uses exact decimals. Both SELF_PICKUP and SELLER_DELIVERY default on, with at least one required; legacy preferred delivery matches either single selection while strict seller delivery excludes pickup-only. Optional suburbs use verified city polygons shared with the existing search and the map's public Request point, with no center fallback. Unknown constrained quantity fails. Missing buyer budget matches a seller minimum/range; nominal currency does not restrict an unknown budget. Known budgets retain overlap, unit conversion and currency checks; unset optional filters broaden. New Request creation delivers immediate system notifications in selling context with canonical buyRequestId references, excluding the author. Request and notification insertion share a transaction; DB uniqueness suppresses duplicate subscription/request delivery. Delivered alerts survive subscription deletion. See [DEMAND_SUBSCRIPTIONS.md](DEMAND_SUBSCRIPTIONS.md) for data availability, migration compatibility and validation evidence.

Demand alerts include a server-generated public buyRequestPreview: product title, quantity/unit, budget or «Не вказано», receipt method, optional deadline, public settlement and description truncated to 280 characters. No private address/coordinates are selected into this DTO. Request private address visibility produces an approximate point rather than hiding it; only explicit public addresses publish exact address/point. City-only matches can be displayed by the existing verified HERE locality resolver, with the city-level approximation stated in the subscription map. Public edits are reflected at list time; deleting a subscription preserves the alert and preview, while deleting the Request leaves the existing generic fallback. Canonical destination and counters are unchanged.

### Current UI and navigation

One Notification Center (`/notifications`) has `Купівля`, `Продаж` and `Усі` tabs. The first two show only their persisted context and have independent unread counters and `Прочитати всі`; `Усі` retains legacy/unclassified history. The sidebar and context badges use the API's aggregate counters, so they remain exact beyond the visible list. Individual read and context read-all refresh those counters. Unread state is stated in text as well as visual styling. Every notification retains its event title and body, including offer acceptance/rejection and deal cancellation/completion. An available public Request preview is a separate supplementary block; it never replaces or truncates the event message. Demand details wrap across 1440/1024/768/390/320 px; below 1024 px the product description can be expanded while important details remain visible. Notification time is displayed independently of the requested date.

Navigation is structured: `conversationId` opens `/messages/:conversationId`; `buyRequestId` opens `/buy-requests/:id`; an order without a conversation uses `/orders`. There is no Offer detail screen, so offer events without a conversation use their Buy Request reference. Unclassified legacy rows retain the safe existing Requests fallback.

Message unread and notification unread are already separate persisted concepts: conversation read state is based on `conversation_participants.last_read_at`; notification read state is `notifications.read_at`. Opening or reading a notification must not be treated as reading conversation messages.

### Current evidence

Messages navigation uses the sum of conversation `unreadCount`, independent of notification badges. Chat mark-read does not call notification read endpoints. `e2e/messages-unread-ui.spec.ts` verifies this boundary with mock API, and the real QA scenario verifies persisted read state.

- Migration `013_create_community_features.sql` defines notification storage and index.
- Backend notification service and event producers create/list/read records.
- Frontend `NotificationsView` renders scope, unread styling and current links.
- The final Playwright execution result for E2E №3 and the mutation-error scenario is UNVERIFIED. Manual Browser legacy `NULL → Усі` and message unread ↔ notification unread are also UNVERIFIED.

## TARGET

### Notification Center

One Notification Center has two primary contexts.

| Context | Includes |
| --- | --- |
| **Купівля** | Buy Request, Offer, Deal, Review, relevant message-related and other system/activity events where the user acts as Buyer. |
| **Продаж: activity/system** | Product, Offer, Deal, Review, relevant message-related and other system/activity events where the user acts as Seller. |
| **Продаж: demand subscriptions** | Alerts about Buy Requests matching separately saved Seller conditions. |

Seller demand subscriptions are a distinct notification source, not a replacement for Seller activity notifications.

### Structured destinations

Actionable notifications need structured entity/destination context for Product, Buy Request, Offer, Deal, Conversation or another canonical page. Notification text is presentation only and must never be parsed to determine navigation. The design must work with the future canonical URLs/deep links/breadcrumbs Step.

### Unread behavior

- Sidebar: `Повідомлення [N]` and `Сповіщення [N]`; notification badge means total unread notifications.
- Notification Center: `Купівля [N]` and `Продаж [N]`.
- Individual and context read-all use the same persisted `notifications.read_at`; context counters are derived, not stored separately. A context action never clears the other context or legacy rows. Zero badges are hidden.
- Message unread and notification unread stay independent even when a notification links to a conversation.

### Seller demand subscriptions

One Seller may keep multiple independent subscriptions. A basic subscription concept needs name, active/paused state, notification delivery mode and duplicate suppression. Delivery must support at least immediate notifications and a periodic digest; the Seller chooses the digest frequency, while the final set of interval values remains an open product decision. Matching criteria are category/product, quantity, acceptable price/budget, delivery compatibility, location/radius and time/deadline. An empty optional criterion means it does not restrict matching.

UX should keep primary criteria visible and use `Додаткові умови` for less common criteria. It must not expose a technical query-builder. Matching must use the existing public/approximate location model and must not require publication of a Buyer’s exact private location.

## FUTURE

- Email/push channels and notification preferences.
- Advanced subscription filters and matching tuning.
- Route/corridor matching: saved route, direction, schedule/days, maximum detour and distance from route. This is not an approved next Step and needs no engine, migration or special schema now.

## OUT OF SCOPE FOR THIS CONTRACT

This document does not duplicate chat business logic, Deal lifecycle, canonical URL design or map privacy implementation. See [PRODUCT.md](PRODUCT.md), [PROJECT_STATE.md](PROJECT_STATE.md), [UX_RULES.md](UX_RULES.md) and map/location docs.

Step 8 follow-up: one repeated territory input reuses SettlementPicker, multiple region/country arrays in migration 043, suburbs capped at 20 km. Owned existing match count and /discover subscription-filtered map/list reuse notification matcher and public map projection. Step 8 corrections include real Rivne 10 km saving and a complete authenticated Chromium seller → buyer → seller flow without API stubs, proving the selling counter, public details, read state and canonical Request navigation. Other historical Step 3 unverified scenarios above are not claimed as covered. Buyer-to-seller/product subscriptions remain a separate task under the user’s conditional scope. No Step 9 or independent PASS claimed.

### Step 8 P2 notification regression (2026-10-08)

The Request preview previously replaced the event title/body in the frontend whenever it was present, hiding ordinary Seller activity such as offer rejection. The frontend now displays the original event first and keeps the existing public preview below it. Backend event producers, preview projection, matching, geography, Offer/Deal behavior and destination priority are unchanged.

- Notification UI regression: 6/6 passed (five viewport tests plus the existing retry test). New Request, new Offer, selection, rejection with a long explanatory body, cancellation, completion and missing-preview events retain their text. Product details do not overlap the event; the rejection link opens the referenced Request and updates read state/counters. Screenshots at 1440/1024/768/390/320 were inspected.
- Authenticated Chromium with the documented Buyer A/Seller A accounts: 2/2 passed on an isolated real DB, with no API stubs, API login or API creation. Both subscription scenarios retain their informative preview, counters and canonical navigation. The private-point scenario additionally creates an Offer and rejects it through browser UI; Seller sees the API's actual rejection title/explanation alongside the product preview at all five widths, then opens the correct Request. One rejection notification exists and opening it reduces unread by one.
- Real-DB notifications: 4/4 passed, including actual acceptance, cancellation and bilateral completion event bodies, previews and structured references. The existing Offer rejection API has a standard explanation, without a free-text reason field; arbitrary long explanations are covered by the separate UI fixture regression. No new Offer reason or Deal feature was introduced.
- The new multi-operation real-DB test has an explicit 30-second timeout. Its first full-suite run exceeded Vitest's default 5 seconds under parallel load; assertions were retained.
- Final full `npm test`: 203/204 passed in 29 files; all 47 notification/subscription/Deal integration tests passed. The unchanged Telegram `iat` clock-skew boundary test failed (a token signed at `now + 61` crossed a second boundary before verification); its separate provider suite then passed 26/26. This is a remaining test instability, not a full-suite PASS. No unrelated provider code/tests were changed. Root typecheck and build passed; Vite retains the existing >500 kB bundle advisory. `git diff --check` passed.
