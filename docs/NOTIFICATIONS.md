# Notifications contract

**Purpose:** authoritative feature contract for notifications, unread state, destinations and future seller demand subscriptions. This document separates CURRENT behavior from TARGET and FUTURE work.

## CURRENT

### Storage and API

`notifications` stores `user_id`, `type` (`order`, `message`, `review`, `report`, `system`), presentation `title`/`body`, persisted recipient `context` (`buying` or `selling`), optional `order_id`, `conversation_id`, `buy_request_id`, `read_at` and `created_at`. Current API lists the latest 100 notifications and returns exact unread `total`, `buying` and `selling` counters for all of the user's history; it marks one notification or all notifications in one context read. Existing historical rows with no provable structured relation retain `context = NULL`, count in `total`, and do not count in either context.

Current producers include Offer created/updated/withdrawn/rejected, Deal selection/confirmation/result/dispute, direct chat start, message sent and review submitted. Delivery is in-app only; email, push, preferences and seller demand subscriptions are not implemented.

### Current UI and navigation

One Notification Center (`/notifications`) has `Купівля`, `Продаж` and `Усі` tabs. The first two show only their persisted context and have independent unread counters and `Прочитати всі`; `Усі` retains legacy/unclassified history. The sidebar and context badges use the API's aggregate counters, so they remain exact beyond the visible list. Individual read and context read-all refresh those counters. Unread state is stated in text as well as visual styling.

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
