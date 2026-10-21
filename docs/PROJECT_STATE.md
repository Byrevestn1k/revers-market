# Project state

**Current step:** `STEP 15 — DONE (independent final re-review PASS)`.

**Last updated:** 2026-10-20

**Purpose:** короткий handoff для нового AI. Це не повне ТЗ, changelog або друга специфікація.

## HOW TO USE THIS FILE

1. Новий AI читає цей файл першим, але не завантажує автоматично всю документацію.
2. Для поточного Step читає тільки `Required context` нижче.
3. Historical ТЗ і historical analysis не входять у default context; відкривати їх можна лише за конкретної потреби.
4. `LOCKED PRODUCT DECISIONS` не переосмислювати без прямого рішення користувача. `OPEN DECISIONS` і `FUTURE` не є дозволом на implementation.
5. Verify CURRENT against code, migrations and automated tests only for claims materially relevant to the CURRENT Step. Do not re-audit unrelated previously verified areas of the project.
6. Після значущого успішного Step мінімально оновити цей файл і відповідний authoritative document.

## SOURCE OF TRUTH

Для фактичної поведінки пріоритет такий: current code + migrations + automated tests → [PRODUCT.md](PRODUCT.md) → current feature docs → QA/testing docs → target/design docs → historical ТЗ. Якщо документ суперечить CURRENT code, production code не змінювати заради старого тексту; зафіксувати conflict у relevant current doc.

## PRODUCT SUMMARY

Marketplace має два паралельні flows:

- **Supply-first:** `Seller Product → discovery/search/map → Buyer → direct communication`.
- **Demand-first:** `Buyer Request → Seller Offer → comparison → Deal → completion → review`.

Product — повноцінна частина продукту, не legacy. Деталі сутностей і flows: [PRODUCT.md](PRODUCT.md). Поточні gaps і ризики: [MVP_INVENTORY.md](MVP_INVENTORY.md).

## CURRENT TECH STACK

React 19 + Vite + TypeScript frontend; Express + TypeScript backend; PostgreSQL/PostGIS; Leaflet map; Vitest unit/integration tests; Playwright browser E2E; Docker Compose для локальної PostGIS. Деталі запуску: [SETUP.md](SETUP.md).

## LOCKED PRODUCT DECISIONS

- Supply-first Product flow і demand-first Request/Offer/Deal flow існують паралельно.
- Product є current product concept, не legacy.
- Partial fulfillment і multiple Sellers для одного Request — intended product behavior.
- Offer може бути standalone або посилатися на Product; Offer terms не змінюють базовий Product автоматично.
- Private location не треба розкривати для discovery або майбутнього matching; застосовується public/approximate location model.

## CURRENT IMPLEMENTATION SNAPSHOT

- Один hybrid account може купувати й продавати; профіль, location/privacy, Products, Requests, Offers, Deals, chats, reviews і in-app notifications реалізовані.
- Product flow зараз завершується direct chat. Request flow створює Deal зі snapshot умов і quantity reservation.
- Current rating scale: **1–12**. Підтверджено code, migration і automated tests.
- Partial/multiple Seller accounting має locks, constraints та automated coverage. Деталі: [MVP_INVENTORY.md](MVP_INVENTORY.md).
- Notifications мають structured recipient contexts `buying | selling`, а legacy/unclassified rows — `context = NULL`. Центр «Купівля» / «Продаж» / «Усі» має exact aggregate unread counters для всієї історії незалежно від latest-100 newest-first list, individual read, context-specific read-all і structured canonical destinations. Notification unread незалежний від message unread. Contract: [NOTIFICATIONS.md](NOTIFICATIONS.md).
- Основні існуючі list/detail destinations мають canonical path URLs; Product, Buy Request і Conversation відновлюються з direct link/refresh. Breadcrumbs знаходяться в main content, а legacy `?view=...` links нормалізуються. Step 1 пройшов independent Reviewer PASS; manual Browser QA `map marker → entity` лишається UNVERIFIED.
- Step 3 independent Reviewer PASS. Manual Browser legacy `NULL → Усі` та message unread ↔ notification unread — UNVERIFIED. Final execution results Playwright E2E №3 і mutation-error scenario — UNVERIFIED.
- Step 4 implementation: chat roles use the shared `buying | selling` API contract; list ordering is deterministic newest-first; chats have local date separators and persisted-message/read indicators. Saved and Trash are personal participant state, while archived unread messages stay out of the sidebar total. Notification read state remains independent. Delivered receipts, terminal write-policy changes and a definitive Deal context for reused Offer chats remain out of scope.

## ACTIVITY ORGANISATION REQUIREMENT

STEP 5 UX organizes a user's work in two contexts: **Купую** shows own Buy Requests with related Offers/Deals/actions; **Продаю** shows own Products, own Offers and related Deals/actions. Canonical pages remain separate and group records by lifecycle. Independent final re-review passed; Step 5 is integrated into main.

| Entity | Actual backend status | Business meaning | Possible user-facing group |
| --- | --- | --- | --- |
| Product | `draft`, `active`, `paused`, `sold`, `expired` | Prepared, discoverable, paused, sold out, expired | Inactive; active; completed; inactive/expired |
| Buy Request | `open`, `partially_selected`, `partially_completed`, `partially_fulfilled`, `completed`, `fulfilled`, `cancelled`, `expired` | Looking, partially reserved/received, completed, cancelled, expired | Active/action; completed; cancelled; inactive/expired |
| Offer | `draft`, `submitted`, `accepted`, `partially_accepted`, `rejected`, `withdrawn`, `expired` | Prepared, awaiting Buyer, selected fully/partly, rejected, withdrawn, expired | Active/action; completed selection; cancelled; inactive/expired |
| Deal v2 | `selected`, `in_progress`, `buyer_marked_completed`, `seller_marked_completed`, `completed`, `failed`, `cancelled`, `rejected`, `disputed` | Seller confirmation, fulfilment, other participant confirmation, final result or dispute | Needs action; active; completed; cancelled; dispute/action |
| Deal legacy compatibility | `draft`, `active`, `offer_received`, `accepted`, `expired` | Historical order states still accepted by backend compatibility code | Map only when historical data is present |

These are UX groups, not a new backend state model. STEP 5 added counters, filters, sorting, role-aware action cues and loading/empty/error states with responsive behavior; see [PRODUCT.md](PRODUCT.md) for the implemented mapping.

## OPEN DECISIONS

- Чи потрібен майбутній `Product → Deal` lifecycle, або Product лишається lead/direct-chat flow.
- Policy для conversation після completed/cancelled/rejected Deal.
- Expiry policy для Product, Request та Offer.
- Verification gate перед Offer/Deal.
- Step 8 subscriptions include category/geography, optional quantity/unit and price/currency, and optional suburbs measured from verified city boundaries shared with existing search. Step 14 adds structured pickup, seller delivery, postal delivery and flexibility with method-specific territory. AI and route/corridor remain future scope.
- Route/corridor matching — `FUTURE`; не створювати engine, schema чи migrations без окремого Step.

## KNOWN RELEVANT ISSUES

- Product direct chat не створює Deal, completion чи review.
- Offer conversation може повторно використовуватися для послідовних Deals, що робить історичний context менш однозначним.
- STEP 5 організував власні товари, запити, пропозиції та угоди за станами; два зауваження першої незалежної перевірки виправлено й підтверджено повторною перевіркою.

## ROADMAP

| Status | Area | Note |
| --- | --- | --- |
| `DONE` | Step 0: state and documentation contracts | Independent review passed. |
| `DONE` | Canonical URLs / deep links / breadcrumbs | Independent Reviewer PASS; manual Browser QA `map marker → entity` remains UNVERIFIED. |
| `DONE` | Messages unread/sidebar UX | Independent Reviewer PASS. |
| `DONE` | STEP 3 — Notification Center & Existing Event Integration | Independent Reviewer PASS. |
| `DONE` | STEP 4 — Messages/Chats UX completion | Independent final re-review PASS; incorporated into main. |
| `DONE` | Activity organisation | Independent final re-review PASS; integrated into main. |
| `DONE` | STEP 8 — Seller demand subscription corrections | Independent final re-review PASS. Exact decimal conversions; country/region/city union; optional verified-boundary suburbs; both receipt defaults and preferred-delivery compatibility. Owned CRUD, immediate selling alerts and dedup retained. |
| `DONE` | STEP 11 — Mobile UX corrections | Independent review PASS. Favorites for Products, Buy Requests and Profiles, responsive cards, map marker/cluster behavior and single-result markers were verified with the real local API and database. A direct single marker centers at maximum zoom and opens its object; multi-object clusters open their list in one click. Physical-device keyboard language switching remains a separate P1 `UNRESOLVED`. |
| `DONE` | STEP 12 — Buy Request UX parity | Creation/editing, up to 8 uploaded photos, cards, category fallback and detail gallery implemented. Independent re-review PASS; integrated into `main`. |
| `DONE` | STEP 13 — Seller Offer redesign | Three creation paths, owned photo snapshots, editable terms, comparison and Deal snapshot. Final independent REVIEW PASS after photo-retention, lock-order and legacy-photo corrections; integrated into `main`. See [STEP_13_REVIEW.md](STEP_13_REVIEW.md). |
| `DONE` | STEP 14 — Delivery matching | Independent final REVIEW PASS after geographic and radius-validation corrections. Product, Buy Request, Seller Offer, Demand Subscription, matching and Notifications were checked against real PostgreSQL. See [STEP_14_REVIEW.md](STEP_14_REVIEW.md). |
| `DONE` | STEP 15 — Smart Search | Independent final re-review PASS after indexed candidate selection, exact COUNT, stable pagination and public search rate limit. Broad 10 000-row searches remain in the performance backlog; see [STEP_15_SEARCH.md](STEP_15_SEARCH.md). |
| `READY FOR RE-REVIEW` | STEP 16 — Category recommendation and validation | Reviewer correction №1 addresses subject context, conservative blocks, punctuation-resistant duplicates and decision-linked appeals. See [STEP_16_CATEGORY_CONTROL.md](STEP_16_CATEGORY_CONTROL.md). Independent re-review remains required. |
| `DONE` | STEP 6 — Google, Facebook, Telegram authentication | Independent review passed and implementation merged to `main`. Full suite: 128/129; only environment-dependent map integration fails. Real provider app QA remains UNVERIFIED. |
| `DONE` | STEP 7 — Reviews / Відгуки | Independent final review PASS; merged to `main`. Deal-based completed-request reviews audited; real-DB integration and live-browser E2E passed. |
| `FUTURE` | Advanced subscription filters, route/corridor matching | No implementation approval. |

## CURRENT STEP

**STEP 16 READY FOR RE-REVIEW (implementer work).** The first independent review failed on subject context, missed category violations, punctuation duplicate bypass and unlinked appeals. Correction №1 adds contextual item rules, migration 051 for persisted block decisions, decision-linked appeals, and normalized duplicate comparisons. The 18 reviewer examples replay with 0 false blocks and 0 missed required blocks. A new 100-case set has 0 false blocks, 40/40 wrong cases detected, and 80/80 known categories in the top three; 12 wrong cases are warnings rather than hard blocks. Focused real-PostgreSQL integration, typecheck and build pass. The complete backend suite passed 242 tests with one existing skip when run with one worker and a 15-second test timeout; faster parallel runs timed out in an unrelated subscriptions test. Targeted Chromium regression passed 1/1 at 390 and 1440 px, including toy car, gift, appeal, Buy Request and Seller Offer. No independent REVIEW PASS or merge has occurred; see [STEP_16_CATEGORY_CONTROL.md](STEP_16_CATEGORY_CONTROL.md) for limitations.

**STEP 15 DONE — independent final REVIEW PASS after `cb78a80`.** Migrations 047–049 and shared search code handle multiword, prefix, controlled morphology and typo matches across existing Product and Buy Request fields. The correction adds indexed candidates, stored word forms, separate match/rank functions, exact COUNT without reranking, stable pages and a local search rate limit. No new characteristics, brand or model input fields were added. Independent focused PostgreSQL tests passed 4/4, typecheck passed, and narrow Chromium QA passed at 1440/390 px. On the existing 1 130 active Products, `велосипед` took 230 ms median HTTP; on 10 000 same-category QA Products, selective `Trek` took 314/433 ms and broad queries about 1.2–1.8 s on typical measured runs. Broad searches and a process-local rate limit remain documented production risks. The next step awaits user direction. See [STEP_15_SEARCH.md](STEP_15_SEARCH.md).

**STEP 14 DONE — independent REVIEW PASS at `b5d1ad8`.** Migration 046 adds nullable structured delivery options without guessing old territories. Product, Request, Offer and Step 8 subscriptions support method-specific geography; matching distinguishes EXACT_MATCH, POSSIBLE_AGREEMENT, NO_MATCH and UNKNOWN. Coordinates must agree with the claimed settlement, and new radius values start at 1 km. Historical zero-radius matches with missing or unverified points remain UNKNOWN and do not trigger automatic Notifications; confirmed postal regions can match without coordinates. Deal snapshots retain agreed terms. Final focused real-PostgreSQL tests passed 70/70 in eight files; typecheck passed. Direct API checks confirmed HTTP 400 for 0/0.5/0.99 km, HTTP 201 for 1/1.5 km and unchanged database state after a rejected edit. Chromium at 390 px confirmed the UI minimum and no horizontal overflow. Earlier independent Step 14 Browser E2E passed 1/1 at 1440/390 px for unchanged subscription and notification flows. The full backend suite and full Browser E2E were not rerun after the last correction; physical-device keyboard switching remains UNVERIFIED. Details: [STEP_14_REVIEW.md](STEP_14_REVIEW.md); behavior contract: [STEP_14_IMPLEMENTATION.md](STEP_14_IMPLEMENTATION.md).

**STEP 13 DONE.** Migration 045 and three Seller Offer creation paths, owned photos, editing, comparison and Deal snapshots passed final independent review. Correction `1945b3e` fixes advisory/Product lock order, copies surviving photos of legacy Offers when selected, and prevents explicitly removed legacy photos from reappearing. See [STEP_13_REVIEW.md](STEP_13_REVIEW.md). Physical mobile keyboard switching remains UNVERIFIED.

**STEP 12 DONE.** Independent re-review passed after correction `4d81bb7`: the API rejects changes to `fulfillmentMode` after an Offer (including a withdrawn Offer) or Deal, permits unrelated edits when the mode is unchanged, preserves records and agreed terms after HTTP 409, and serializes Offer creation with request editing through a row lock. The focused real-DB regression test and typecheck passed. Earlier Step 12 Chromium creation/editing/Offer/Deal QA passed at 1440/1280/1024/768/390/320 px; the backend suite had passed 209 tests (1 skipped). Live Step 8 subscription Browser E2E and opening a Request from a single map marker or cluster remain UNVERIFIED; focused subscription DB tests and map logic tests passed, so these are non-blocking follow-up QA. See [STEP_12_REVIEW.md](STEP_12_REVIEW.md). The physical-device keyboard language-switch issue remains separate.

**STEP 11 DONE.** Independent review passed against the real local frontend, API and database. The correction commits are `8426278` and `419df04`. Product, Buy Request and Profile favorites were added, opened from Favorites, then removed successfully. On desktop, a single filtered map result renders as an individual marker; selecting it centers the map at zoom 19 and opens the correct object. A real five-object cluster opened its object list in one click; the targeted map test covers exact same-coordinate results. `npm run typecheck` passes; `backend/` is identical to `main`, so the previously reported favorites integration type errors do not reproduce and are not Step 11 regressions. The physical-device keyboard language-switch issue remains a separate P1 `UNRESOLVED`; no PASS is claimed for it.

Earlier exact decimal conversion, country/region/city union, repeated territory input, unlimited unit/currency, both receipt defaults, SELF_PICKUP/SELLER_DELIVERY and preferred-delivery compatibility are retained. Main migrations 040–043 remain applied; this correction needs no new migration. Tests use an isolated PostgreSQL/PostGIS database. Implementer validation: 203/203 backend tests in 29 files, real provider suburbs test, 2/2 real authenticated browser flows without API stubs, typecheck/build and diff checks passed. Independent final re-review: notification backend 4/4, notification UI 6/6, focused subscription notification checks 2/2, authenticated Offer rejection E2E 1/1 and provider/token tests 26/26 passed. The known `iat = now + 61` boundary failure was confirmed as timing-dependent test instability, not a production regression. Both notification details and real matches map were checked at 1440/1024/768/390/320. Full evidence and remaining provider/HERE street/house risks are in DEMAND_SUBSCRIPTIONS.md. Step 7 remains DONE. Step 9 has not been started.

## REQUIRED CONTEXT

For Step 15 re-review: this file; [STEP_15_SEARCH.md](STEP_15_SEARCH.md); [PRODUCT.md](PRODUCT.md); migrations 047–049, shared search module, Product/Buy Request/map entry points and their focused tests. Do not load historical documents by default.

## AI WORKFLOW

`ChatGPT → Step → Codex Implementer → validation → risk-based independent review → PASS → PROJECT_STATE update → next Step`

- **Low:** implementer self-check; reviewer optional.
- **Medium:** implementer plus targeted validation; short independent review appropriate to scope.
- **High:** Deal lifecycle, permissions, migrations, notification business logic, matching, privacy/security, stock/reservation and transactional invariants require an independent Reviewer.
- **Very high:** large cross-cutting, security or data changes require a strong implementer and independent strong review.

Implementer and Reviewer assess work independently. A Reviewer does not assume the implementer PASS is correct and need not be a more expensive model. For every new Step ChatGPT records `Implementer: <model> — risk` and, when needed, `Reviewer: <model> — risk`; model choice depends on scope, risk, architecture, debugging and business/security impact, not a universal ranking. Available choices include GPT-5.6 Luna, Terra and Sol, GPT-6 variants and Astra; select them per Step rather than automatically choosing the most expensive option.

## DOCUMENT ROUTING

| Need | Authoritative home |
| --- | --- |
| Handoff, current Step, locked/open decisions, route to docs | This file |
| Product concepts and current domain flows | [PRODUCT.md](PRODUCT.md) |
| UI and responsive rules | [UX_RULES.md](UX_RULES.md) |
| Notifications, unread, destinations and subscriptions contract | [NOTIFICATIONS.md](NOTIFICATIONS.md) |
| Current MVP gaps and priorities | [MVP_INVENTORY.md](MVP_INVENTORY.md) |
| Test/E2E commands and evidence boundaries | [QA_REPORT.md](QA_REPORT.md) |
| Map/location behavior | [map-discovery.md](map-discovery.md), [location-search.md](location-search.md) |
| Working-tree and commit rules | [GIT_COMMIT_RULES.md](GIT_COMMIT_RULES.md) |

## AFTER EACH SUCCESSFUL STEP

1. Update only the relevant CURRENT summary, roadmap entry and authoritative feature doc.
2. Record validation and any remaining risk; do not create a changelog copy.
3. Mark the Step `READY FOR REVIEW` until the required independent review passes.
4. After Reviewer PASS, mark it `DONE` and set the next candidate without starting it automatically.

Step 8 follow-up: one repeated territory input reuses SettlementPicker, multiple region/country arrays in migration 043, suburbs capped at 20 km. Owned existing match count and /discover subscription-filtered map/list reuse notification matcher and public map projection. Legacy public place labels now resolve only through an exact unambiguous Ukrainian directory match, fixing existing Mlyniv Requests without rewriting records. Current final validation is recorded in DEMAND_SUBSCRIPTIONS.md, including the real authenticated browser flow and Rivne 10 km boundary/privacy checks; buyer-to-seller/product subscriptions remain a separate task under the user’s conditional scope. Independent final re-review passed; Step 9 has not been started.
