# Project state

**Current step:** `STEP 8 CORRECTIONS — READY FOR RE-REVIEW`.

**Last updated:** 2026-10-08

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
- Step 8 includes category/geography, optional quantity/unit and price/currency, at least one of the two receipt methods (both default), and optional suburbs measured from verified city boundaries shared with existing search. Country/region/cities form a union; redundant lower selections are removed. AI, route/corridor and postal/carrier remain future scope.
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
| `READY FOR RE-REVIEW` | STEP 8 — Seller demand subscription corrections | Exact decimal conversions; country/region/city union; optional verified-boundary suburbs; both receipt defaults and preferred-delivery compatibility. Owned CRUD, immediate selling alerts and dedup retained. Independent re-review pending. |
| `DONE` | STEP 6 — Google, Facebook, Telegram authentication | Independent review passed and implementation merged to `main`. Full suite: 128/129; only environment-dependent map integration fails. Real provider app QA remains UNVERIFIED. |
| `DONE` | STEP 7 — Reviews / Відгуки | Independent final review PASS; merged to `main`. Deal-based completed-request reviews audited; real-DB integration and live-browser E2E passed. |
| `FUTURE` | Advanced subscription filters, route/corridor matching | No implementation approval. |

## CURRENT STEP

**STEP 8 CORRECTIONS READY FOR RE-REVIEW.** Working branch handoff/step-8, HEAD 401a605ca838fb6360d391a507ad712406a14c46. Final corrections address the latest reviewer FAIL: Rivne's actual OSM city polygon was wrongly rejected by administrative-only metadata checks; search and subscriptions now share verified directory-bound geometry. Real DB saving with 10 km, inside/suburb/outside matching, Rivne + Kyiv and public-coordinate privacy passed. Missing buyer budget now matches a seller price minimum/range; known budget retains existing comparisons. Notification Center displays public Request details and an adaptive description. The user's final privacy clarification is implemented for Requests: private points stay visible with rounding and no address text; public consent retains exact location. City-only subscription matches reuse the existing verified HERE locality resolver for an explicitly approximate city marker, without substituting it into suburb matching. Complete authenticated Chromium seller subscription → buyer Request → seller selling alert/counter → canonical Request → read counter passed without API stubs at all five required widths.

Earlier exact decimal conversion, country/region/city union, repeated territory input, unlimited unit/currency, both receipt defaults, SELF_PICKUP/SELLER_DELIVERY and preferred-delivery compatibility are retained. Main migrations 040–043 remain applied; this correction needs no new migration. Tests use an isolated PostgreSQL/PostGIS database. Final validation: 203/203 backend tests in 29 files, real provider suburbs test, 2/2 real authenticated browser flows without API stubs, typecheck/build and diff checks passed. Both notification details and real matches map were checked at 1440/1024/768/390/320. Full evidence and remaining provider/HERE street/house risks are in DEMAND_SUBSCRIPTIONS.md. Step 7 remains DONE. No commit/push/merge, dependency/architecture change or Step 9. Independent re-review is still required; implementer checks are not an independent PASS.

## REQUIRED CONTEXT

For Step 8 review: this file; [DEMAND_SUBSCRIPTIONS.md](DEMAND_SUBSCRIPTIONS.md); [NOTIFICATIONS.md](NOTIFICATIONS.md) CURRENT; migrations 040/041/042/043; backend subscriptions, demand-matching, city-boundaries and its tests, shared Request public projection, Request validation/creation and integration tests; frontend DemandSubscriptions, SubscriptionCriteriaFields, criteria types/CSS, explicit Request receipt UI, CategoryPicker inline mode and settings navigation; `e2e/demand-subscriptions.spec.ts`, `e2e/demand-subscriptions-live.spec.ts`, live suburbs integration and Notification Center public-preview changes. Do not load historical documents by default.

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

Step 8 follow-up: one repeated territory input reuses SettlementPicker, multiple region/country arrays in migration 043, suburbs capped at 20 km. Owned existing match count and /discover subscription-filtered map/list reuse notification matcher and public map projection. Legacy public place labels now resolve only through an exact unambiguous Ukrainian directory match, fixing existing Mlyniv Requests without rewriting records. Current final validation is recorded in DEMAND_SUBSCRIPTIONS.md, including the real authenticated browser flow and Rivne 10 km boundary/privacy checks; buyer-to-seller/product subscriptions remain a separate task under the user’s conditional scope. No Step 9 or independent PASS claimed.
