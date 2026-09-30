# CURRENT MVP inventory: Marketplace Navpaky

**Дата snapshot:** 2026-09-29

**Призначення:** аудит фактичного стану продукту та прогалин до публічного MVP.

**Статус документа:** `CURRENT PRODUCT AUDIT / PLANNING`. Це не нове джерело істини для implementation. Якщо цей документ розходиться з кодом, migrations або automated tests, правильним вважається код.

## 1. Як проводився аудит

Перевірено frontend, backend, API routes, 34 migrations, permissions, unit/integration/Playwright tests, Docker/config та актуальні й історичні docs. Пріоритет джерел: код + migrations + tests → `PRODUCT.md` → implementation docs → QA docs → target docs → старі ТЗ.

Статуси в цьому документі:

- `DONE` — повний придатний end-to-end flow і достатнє підтвердження тестами/QA.
- `PARTIAL` — основа працює, але є суттєва прогалина.
- `IMPLEMENTED / UNVERIFIED` — код є, але практична перевірка недостатня.
- `PLANNED` — є лише в актуальному design.
- `MISSING` — потрібно для заявленого MVP, але реалізації немає.
- `LEGACY` — старий механізм або опис, що не відповідає основному flow.
- `UNCLEAR` — потрібне продуктове рішення.

## 2. Executive summary

Marketplace уже має завершений та автоматично перевірений основний transaction flow: один hybrid account може створити Buy Request, продавці подають Offers, покупець вибирає повну або часткову кількість, угоди резервують залишок, обидві сторони підтверджують виконання, а відгуки публікуються взаємно. Для цього flow критичних дефектів auth, permissions або quantity accounting в аудиті не підтверджено.

Публічний запуск ще потребує операційного контуру безпеки: доступного модератору робочого інтерфейсу, реального hide/ban enforcement, abuse/rate protection, production deployment/backup/monitoring checklist. Seller-created Product існує як повноцінне оголошення для discovery, але його шлях закінчується direct chat: немає purchase/acceptance, Deal, обліку часткового продажу та review. Власник продукту має вирішити, чи це допустима модель «домовляйтесь у чаті» для першого MVP.

**P0:** підтверджених blocker-дефектів у наявному Request → Offer → Deal flow не знайдено.

**P1:** moderation/safety operations, production readiness, рішення і доведення seller listing promise, критичні regression paths cancellation/recovery та loading/error UX.

## 3. Головна таблиця feature inventory

| Area | Feature | Current status | Tested | MVP priority | Problem / missing |
| --- | --- | --- | --- | --- | --- |
| Accounts | Registration, login, logout, cookie session | `DONE` | Unit/integration + manual QA | P0 baseline | Refresh endpoint не потрібен для server session; після 7 днів потрібен login. Logout відкликає поточну сесію. |
| Accounts | Email/phone verification, password reset/change | `DONE` local | Integration/unit; provider delivery не production-tested | P1 operations | Production потребує SMTP/SMS config і delivery check. |
| Accounts | Profile preparation: name, avatar, location, privacy, contacts | `DONE` | Integration + UI QA частково | P1 baseline | Verification необов'язкова для core; правило допуску до угод не визначене. |
| Accounts | Hybrid Buyer/Seller role | `DONE` | E2E №3 | P0 baseline | Окремих ролей акаунта немає; роль визначається участю у сутності. |
| Accounts | Deactivation/deletion; ban/suspension | `MISSING` | — | P1 safety / P2 deletion | Block між користувачами є, але platform ban/deactivation немає. |
| Buyer | Create Buy Request with category, quantity, budget, delivery, location, deadline, mode | `DONE` | Validation/integration/manual | P0 baseline | Фото Request не передбачено. |
| Buyer | Edit Request | `PARTIAL` | Double-submit browser + code | P2 | API підтримує багато полів, UI редагує лише title/description. |
| Buyer | Cancel/expire/delete Request | `PARTIAL` | Integration | P1/P2 | Cancel є; delete немає; deadline блокує нові дії, але автоматичний persisted transition у `expired` не підтверджено. |
| Buyer | Receive/compare/reject/select Offers | `DONE` | Integration + E2E №3 | P0 baseline | Порівняння картками, partial selection та disabled terminal action працюють. |
| Seller | Find Requests in list/map and open detail | `DONE` | Integration/manual map QA | P0 baseline | Немає price/quantity sort/filter. |
| Seller | Create/edit/withdraw Offer | `DONE` | Integration + UI QA | P0 baseline | Активні Deals після withdraw залишаються чинними, що правильно повідомляється. |
| Negotiation | Offer chat + structured counter-proposal | `DONE` | Integration; UI manual | P1 baseline | Фінальні accepted quantity/price беруться з Offer snapshot; домовленість лише текстом не змінює Deal автоматично. |
| Deals | Selection, seller confirmation, dual completion, failure, cancellation, dispute | `DONE` | Extensive integration + E2E №3 + manual E2E №4 | P0 baseline | Dispute resolution доступний лише configured moderator через API; окремого UI немає. |
| Accounting | requested/offered/reserved/completed/available; multiple sellers | `DONE` | Concurrency/integration + E2E №3 | P0 baseline | DB locks/constraints та idempotency покривають over-selection. |
| Listings | Product CRUD, photos, stock, status, location/privacy, discovery | `DONE` as listing | Product/map integration + UI | P1 if public promise | Це повноцінний listing, але не transaction flow. |
| Listings | Buy/accept Product → Deal → completion/review | `MISSING` | — | P1 or P3, decision | Немає endpoint/UI для purchase або order з Product. Є лише direct chat. |
| Chat | Offer/Deal/direct conversations, messages, unread/list/search | `DONE` | Integration + browser QA | P1 baseline | Текстові повідомлення; вкладень/архіву немає. Offer chat може обслуговувати послідовні Deals і змішувати контекст. |
| Chat | Mobile list-first behavior and Back | `DONE` | Browser QA 320/390 | P1 baseline | Перший чат на ≤700 px не відкривається автоматично; active chat має `← Назад`. |
| Map | Products + Requests, markers, preview, clustering/grouping, radius, privacy | `DONE` for current scale | Unit/integration + manual flow | P1 baseline | Quantity є у Request preview; точні приватні адреси не розкриваються. |
| Map | Main discovery readiness | `PARTIAL` | Manual + integration | P1/P2 | Працює як основна точка discovery, але бракує price/quantity filters, performance/load evidence та production map-provider monitoring. |
| Search | Text, category tree, owner/title, settlement/country/radius, map/list sync | `DONE` | Integration/unit | P1 baseline | Немає ціни, кількості, сортування та infinite loading; є pagination. |
| Notifications | In-app history, role scopes, unread/read, deep links | `PARTIAL` | E2E №3 + integration | P1/P2 | Немає email/push preferences; loading/error/retry слабкі; reused Offer conversation робить деякі deep links неоднозначними. |
| Reviews | 1–12, eligibility, one per Deal, double-blind/timeout, rating | `DONE` | Integration + E2E №3 | P0 baseline | `PRODUCT.md` помилково каже 1–5 і потребує окремого doc cleanup. |
| Trust | Public profile, listings, requests, reviews, rating, deal stats, report/block | `DONE` minimum | Integration + UI | P1 baseline | Немає verification badge/role badge; contact показується лише за consent/Deal rules. |
| Safety | Report and user block | `PARTIAL` | Unit/integration частково | P1 | UI скаржиться фактично на user; API приймає product/request/order/message, але повний UI не знайдено. |
| Moderation | Report queue/status and audit log | `IMPLEMENTED / UNVERIFIED` | Permission unit/integration fragments | P1 | API only, moderator IDs через env; немає dashboard, hide/delete, ban або escalation workflow. |
| Admin | Users/content/deals/reviews/analytics/feature flags/support | `MISSING` | — | P1 minimum / P3 full | Для MVP потрібен малий moderation console, а не великий admin suite. |
| Responsive | Main Deal/review/chat/map/request screens | `PARTIAL` | Manual 320/390/1440; E2E smoke | P1 | Перевірені критичні екрани без overflow; повної матриці forms/profile/notifications/tablet немає. |
| Async UX | Loading/empty/error/retry | `PARTIAL` | Code audit + manual fragments | P1/P2 | Map/messages добре розділяють стани; Notifications і деякі dashboard lists можуть коротко показати EMPTY під час loading та не мають local retry. |
| Delivery/payment | Real carrier/payment/escrow | `PLANNED` | — | P3 | Умови доставки зберігаються текстом; фінансової операції немає. |
| Analytics | Product event analytics | `PLANNED` | — | P2/P3 | Є audit log критичних дій, але це не pilot analytics contract. |
| Operations | Docker/config/deploy/backups/monitoring | `PARTIAL` | Local Docker DB only | P1 | Контейнеризована лише PostGIS; немає перевіреного production deploy, backup/restore, logs/alerts/runbook. |

## 4. Authentication, accounts and permissions

### Current behavior

- Registration, login and logout працюють через opaque session token у `HttpOnly`, `SameSite=Lax` cookie. У production cookie має `Secure`; session TTL — 7 днів.
- Паролі хешуються bcrypt cost 12. Є change password, reset через підтверджений email/phone, обмеження спроб коду та строки дії.
- Registration одразу створює session; email verification запускається best effort. Тому звичайна людина може створити акаунт і почати Buyer/Seller flow без адміністратора.
- Профіль дозволяє змінити avatar, nickname/bio, email, phone, location, точку/адресу та privacy. Один account одночасно Buyer і Seller.
- Permissions перевіряються на рівні сутностей: owner Request/Product/Offer, Buyer/Seller Deal, conversation participants, moderator IDs з env.
- Block припиняє нову взаємодію між парою користувачів. Platform-wide ban/suspension, deactivation, delete-account і керування всіма sessions відсутні.

**Відповідь:** так, звичайна людина може зареєструватися та підготувати акаунт для купівлі/продажу без адміністратора. Для production треба налаштувати реальну доставку verification codes і визначити, чи verification буде обов'язковою перед Offer/Deal.

## 5. Buyer readiness

| Buyer step | Status | Blocker |
| --- | --- | --- |
| Register | `DONE` | Немає для local/current flow. |
| Create Request | `DONE` | Немає. |
| Find/receive Seller | `DONE` | Sellers знаходять Request у list/map; Buyer отримує notification. |
| Compare Offers | `DONE` | Немає. |
| Communicate | `DONE` | Offer chat і negotiation proposals. |
| Select | `DONE` | Full/partial, one/multiple sellers, concurrency guard. |
| Deal | `DONE` | Snapshot умов, contact/address permission, confirmation. |
| Receive | `DONE` as confirmation flow | Фізична доставка не інтегрована. |
| Complete | `DONE` | Подвійне підтвердження та disagreement/dispute. |
| Review | `DONE` | Mutual/timeout publication. |

### Фактичний buyer journey

`register/login → optional profile/location verification → create Request → receive Offers → compare/chat/counter → accept quantity → selected Deal → seller confirms → in_progress → both report result → completed → review`.

Request має category, title, description, quantity/unit, min/max or exact price, currency, delivery preference, settlement/coordinates/privacy, deadline і `single_seller`/`multiple_sellers`. Фото Request відсутнє. Власник може редагувати через API; UI edit обмежений title/description. Видалення немає, але є cancel. Скасування Request не руйнує вже активні Deals.

До завершеного Buyer MVP journey бракує не transaction logic, а: узгодженого правила verification, кращого edit Request, чіткої expiry policy/відображення та production safety/operations.

## 6. Seller readiness

| Seller step | Status | Blocker |
| --- | --- | --- |
| Register | `DONE` | Немає. |
| Find demand | `DONE` | List + map + location/category/text. |
| Evaluate Request | `DONE` | Detail, quantity, budget, location/privacy, Buyer profile. |
| Make Offer | `DONE` | Quantity/price/delivery/comment/product link. |
| Communicate | `DONE` | Offer chat. |
| Negotiate | `DONE` | Structured proposals + chat. |
| Confirm Deal | `DONE` | Seller-only confirm. |
| Fulfil | `DONE` as lifecycle | Logistics outside product. |
| Complete | `DONE` | Dual completion/failure/rejection/cancel. |
| Review | `DONE` | Same protected review flow. |

### Фактичний seller journey

`register/login → browse Requests/list/map → open Request → create Offer → edit/chat/counter → Buyer selects → seller confirm or reject/fail → fulfil → both confirm → review`.

Продавець бачить, **що можна продати прямо зараз і кому**, через «Відгуки на запити», map Buy Request markers, Request detail та Buyer profile. Якість відповіді знижується без price/quantity sort/filter, але core task можливий.

## 7. Seller-created sale/listing flow

**Статус: `PARTIAL`, окремий discovery flow, не legacy.**

Реалізовані DB/API/UI CRUD, draft/active/paused/sold/expired, photos, price, quantity, reserved quantity, delivery, location/privacy, public catalog/map, public detail/profile і direct chat CTA. Buyer може знайти товар та почати діалог.

Не реалізовано: purchase/acceptance endpoint, cart/order from Product, partial sale action, Deal lifecycle, completion та review, пов'язані саме з direct Product flow. Product stock змінюється лише коли Offer посилається на Product і створений через Buy Request Deal.

Отже, UI promise «Додати пропозицію» зараз означає «опублікувати й домовитися в чаті», а не «продати в контрольованій угоді». Це вимагає продуктового рішення перед публічним позиціонуванням.

## 8. Offer and negotiation

### CURRENT

- Offer створює Seller на чужий відкритий Request; Buyer бачить Offers свого Request, Seller — свої.
- Offer містить власні offered quantity, accepted quantity, unit price/currency, delivery, note, terms, optional linked Product і one additional photo URL.
- Seller може edit або withdraw у дозволених станах. Buyer може reject лише невибраний Offer.
- Buyer accept має idempotency `selectionKey`, transaction locks і quantity checks. Прийнята частина стає Deal snapshot; наступне редагування Offer не змінює існуючі Deals.
- Structured negotiation proposal дозволяє counter/accept/reject/withdraw/expire. Текстовий chat сам по собі не змінює комерційні поля.
- Після узгодження Buyer має явно прийняти актуальну кількість. Deal гарантує snapshot прийнятих quantity/price/terms.

### DESIRED / TARGET, що потребує рішення

- Чи достатньо окремої structured counter-proposal всередині chat, або Offer card має мати видимий negotiation history.
- Чи слід заборонити Offer edit після першого partial Deal. Зараз старі Deals зберігають snapshot, а невибраний залишок Offer можна оновлювати.
- Як поводитися з одним Offer conversation, коли з нього послідовно створено кілька Deals: один timeline або conversation per Deal.

## 9. Deal state machine

Основний workflow v2:

```text
Offer accept
  → selected
  → seller confirm → in_progress
  → first completed result → buyer_marked_completed | seller_marked_completed
  → matching second result → completed
  → conflicting second result → disputed

selected/in_progress/one-side-completed
  → cancel/fail/reject (за правилами actor/status)
  → cancelled | failed | rejected
```

| Transition | Actor and endpoint/UI | Permissions / notification | Accounting effect |
| --- | --- | --- | --- |
| Offer → `selected` | Buyer, `POST /api/offers/:id/accept`, «Обрати пропозицію» | Request owner only; Buyer+Seller notified; conversation gets system message | Increase Offer accepted and Request active selected; optional Product reserved. |
| `selected` → `in_progress` | Seller, `POST /api/orders/:id/seller-confirm`, «Підтвердити домовленість» | Seller only; idempotent repeat; Buyer notified | Reservation unchanged. |
| Active → first side marked | Buyer or Seller, `POST /api/orders/:id/complete`, result dialog | Participant only; same actor repeat idempotent; counterpart notified | Reservation remains until second result. |
| Marked → `completed` | Other participant, same endpoint | Results quantity/total must match; both parties receive events/review availability | Reserved decreases; actual quantity becomes completed; unused difference returns available; linked Product stock decreases actual. |
| Active → `cancelled` | Either participant, status/cancel UI with reason | Participant only; terminal/idempotent for same actor; counterpart notified | Reservation released once; available restored. |
| `selected` → `rejected` | Seller via fail action | Seller only before work; counterpart notified | Reservation released once. |
| Active → `failed` | Either participant via fail reason | Participant only; counterpart notified | Reservation released once unless disagreement. |
| Conflicting results → `disputed` | Derived automatically or explicit dispute endpoint | Participants; moderator resolution endpoint | Reservation retained until resolution; resolution sets completed/failed and accounting. |
| Terminal → another state | No valid UI/API transition | Rejected by permission/state checks | No accounting change. |

Старі `draft → active → offer_received → accepted` transitions лишилися як `LEGACY` compatibility. Новий Offer acceptance створює `selected` workflow v2.

## 10. Quantity accounting

Фактичні поняття:

- `requested` — загальна `requested_quantity` Request.
- `offered` — кількість конкретного Seller Offer.
- `selected/reserved` — сума активних Deal quantities, що ще не завершені terminal failure/cancel.
- `completed` — сума `actual_quantity` completed Deals.
- `available` / API `remainingQuantity` — `requested - active reserved - completed`.

Основний invariant:

```text
completed + active reserved + available = requested
```

DB constraints і transaction locks не дозволяють negative values, accept понад залишок Request/Offer або parallel over-selection. Full/partial, multiple Sellers, cancellation/rejection recovery, actual quantity lower than selected та old partial deals мають integration coverage. `single_seller` і `multiple_sellers` обидва реально підтримуються; поточного технічного обмеження «лише один Seller» немає.

Для linked Product: `available stock = quantity - reserved_quantity`; selection збільшує reserve, cancel/reject releases reserve, completion зменшує total quantity на actual amount. Ця схема не застосовується до direct Product chat без Buy Request Offer.

## 11. Chats

| Capability | Status | Notes |
| --- | --- | --- |
| Offer/Deal chat | `DONE` | Participants only, system events, negotiation context. |
| Direct Product/Request chat | `DONE` | Створюється non-owner для active/open listing; block enforced. |
| Conversation list | `DONE` | Title, counterpart, role, context, price, icon/photo, last message/time/unread. |
| Read/unread | `DONE` | `last_read_at`, counter, mark-read endpoint. |
| Mobile list-first | `DONE` | На ≤700 px без deep link chat спочатку `null`; desktop auto-selects first. |
| Mobile Back | `DONE` | Active embedded chat повертає до list через `← Назад`. |
| «Прямі чати» | `DONE` | Filter показує лише `type=direct` і count; direct охоплює Product та Buy Request. |
| Loading/error/retry | `DONE` in Messages | Окремі loading, empty, error і retry. |
| Attachments/archive | `MISSING` | Не потрібні для базового MVP; P3/P2. |
| Terminal chat policy | `UNCLEAR` | Чат після completed/cancelled/rejected залишається активним. |

Deep link notification → chat працює. Відомий UX risk: conversation, створена для Offer, повторно використовується для послідовних Deals цього Offer; старе notification може відкрити timeline з новішими подіями. Це не псує accounting, але контекст дії може бути неочевидним.

## 12. Map readiness

### Реалізовано

- Active Products і open/partial Buy Requests в одному API і Leaflet map.
- Browser/current point when allowed, profile/home point, manual settlement/address selection, city/nearby/area/country scopes і adaptive radius.
- Text search by title/all/owner, category hierarchy, settlement boundary, nationwide, viewport requests, toggles Products/Requests.
- Marker grouping/clustering behavior, seller grouping, selected marker preview, Product/Request detail CTA, profile CTA, list/map synchronization and pagination.
- Preview Request показує `Шукає`, title, requested quantity/unit, place/distance, description і Buyer.
- Private coordinates are rounded/approximated server-side; exact address returns only when explicitly public or participant endpoint allows it.
- Map state snapshot restores query, filters, scope, center/zoom, result page and context after Request detail → Back.

### Чи готова як основна discovery точка?

**Так для контрольованого MVP/пілота, `PARTIAL` для широкого public launch.** Користувач може знайти товар або попит, оцінити місце й відкрити detail. До широкого launch бракує:

1. price/quantity filters і sorting для великої кількості markers;
2. load/performance evidence для реального обсягу і marker cap/pagination contract;
3. production monitoring/fallback для HERE/geocoding і tile provider;
4. повної responsive/accessibility матриці карти;
5. чіткої product policy для exact/public pin та default radius.

## 13. Search, filters and categories

Text search, title/owner/all mode, hierarchical category descendants, settlement/city/radius/country, map viewport, Product/Request toggle та page pagination реалізовані. Category tree пройшло integration coverage, включно з legacy categories та ancestor filtering.

`MISSING/P2`: price range, quantity range, sort by distance/price/date, explicit seller/buyer type beyond Product/Request toggle, infinite loading. Active/completed filters є для Deals; discovery API вже фільтрує активні сутності. Поточна taxonomy достатня технічно для MVP; її business completeness цим аудитом не оцінюється.

## 14. Notifications inventory

Усі канали нижче — **in-app**. Email/push event delivery не реалізовано.

| Event | Recipient | Stored notification / channel | Deep link |
| --- | --- | --- | --- |
| New Offer | Buyer | «Нова пропозиція» | Requests (без conversation, поки її немає) |
| Offer updated/withdrawn | Buyer | Order-type notification | Offer conversation when present |
| Offer rejected | Seller | «Пропозицію відхилено» | Requests/general fallback; conversation absent in this event |
| Offer selected / Deal created | Buyer and Seller | Separate selected messages | Exact Offer/Deal conversation + orderId |
| Seller confirms | Buyer | Deal event | Conversation |
| Cancellation/rejection/failure | Counterpart | Deal event | Conversation + orderId |
| Chat message | Other participants | One per other participant | Exact conversation |
| Direct chat started | Listing owner | «Розпочато обговорення» | Direct conversation |
| First completion mark | Counterpart | «Підтвердьте результат угоди» | Conversation + orderId |
| Final completion | Counterpart; review prompt also created | Completion/review events | Conversation or Orders |
| Review submitted | Reviewee | Hidden/open status text | Orders via orderId |
| Dispute/open/resolution | Counterpart | Deal event | Conversation + orderId |

History обмежена останніми 100, сортується newest first. Є read one/read all API, але UI використовує read all. E2E №3 підтверджує ключові recipients, counts і conversation links. Gaps: notification screen не має власного loading/error/retry, немає channel preferences/deduplication keys, і reused Offer conversation дає згадану неоднозначність deep link.

## 15. Reviews and ratings

- Review дозволений лише participant completed Deal, один на reviewer/order; stranger та pre-completion заблоковані.
- Rating і UI — integer **1–12**, з overall, communication, compliance та buyer-only description rating.
- Перший review прихований; обидва публікуються після mutual review або `REVIEW_BLIND_DAYS` timeout. Publication/idempotency audit tested.
- Public profile повертає published reviews, average та count. Cancelled/rejected/failed Deal не eligibility.
- **E2E №3 AUTOMATED / PASS:** two Sellers, partial accounting, dual completion, mutual publication, averages/counts, notifications, permissions, 320/390/desktop smoke. У попередній реалізації suite успішно пройшла двічі поспіль з ізольованими accounts/data.

Документальна суперечність: `PRODUCT.md` стверджує 1–5, але код, UI і tests використовують 1–12. Це `LEGACY` текст у docs, не дефект implementation.

## 16. Profiles and minimum trust

Public profile показує name/nickname/username, avatar, bio, coarse/public location, registration date, last seen, rating/count, completed Deals count, response rate, active Products, open Requests, reviews та report/block actions. Phone показується лише за user consent; Deal contact/address endpoints доступні тільки participants за правилами lifecycle.

Для мінімальної довіри вже є history + rating + activity + safe contact boundary. Перед public MVP бажано: verified email/phone badge або чітке пояснення їх відсутності, результат moderation/report для reporter, і platform ban enforcement. Окремий Buyer/Seller badge не потрібен технічно, бо account hybrid; продукт може додати activity labels пізніше.

## 17. Moderation, safety and admin

### CURRENT

- User report з UI; API також приймає targets `product`, `buy_request`, `order`, `message`.
- Reporter може отримати власні reports.
- User block/unblock і pairwise interaction checks.
- Configured moderator (`MODERATOR_USER_IDS`) може list/update report status через API.
- Audit log для критичних domain actions, reviews, reports, blocks і moderation.

### MVP REQUIRED

1. Мінімальний authenticated moderation screen: queue, target context, reporter, evidence link, status/note.
2. Реальні actions: hide/unhide Product/Request, suspend/ban User, обмежити створення/повідомлення; audit each action.
3. UI report для listing/request/message, не тільки user.
4. Abuse controls для registration/login/reset/message/report endpoints: rate limits і basic spam thresholds.
5. Operational owner: хто отримує reports, response time, emergency disable/support contact.

### POST-MVP

Повний admin dashboard, granular staff roles, analytics console, feature flags, automated risk scoring, appeals/case management. Великий admin panel не є передумовою MVP; малий moderation console є.

## 18. Mobile/responsive inventory

| Surface | Current assessment |
| --- | --- |
| Navigation | Desktop sidebar + mobile bottom nav; основні destinations доступні. |
| Request/Offer | 320/390 manual flow пройдено; ключові price/quantity/status/actions не clipped. |
| Deal/review | E2E responsive smoke 320/390/desktop; manual completed/cancelled views without horizontal overflow. |
| Chat list/conversation | Correct two-screen mobile model, list-first, clear Back; desktop two columns retained. |
| Map | Mobile flow manually exercised; preview/detail/back works. Full touch/accessibility matrix pending. |
| Profile/notifications/forms | Responsive CSS exists, but повна 320/390/768/1024/1280/1440 matrix не виконана. |
| Dialogs/keyboard | Dialog patterns and disabled submits exist; mobile software-keyboard/focus trapping not comprehensively tested. |

Відомі некритичні UX issues з manual E2E: typo `Відхілене`, duplicate/inconsistent cancellation reason presentation, reused conversation context. Їх не слід змішувати з P0 accounting.

## 19. Loading, empty and error states

| Screen | Loading | Empty | Error | Retry | Status |
| --- | --- | --- | --- | --- | --- |
| Map + synced results | Yes | Yes | Yes | Indirect via filters/reload | `DONE/PARTIAL` |
| Messages list | Yes | Yes | Yes | Explicit button | `DONE` |
| Chat body | Yes | Yes | Error feedback | Poll/reopen | `DONE` |
| Catalog/Public results | Yes | Yes | Yes | Repeat search, no dedicated button | `PARTIAL` |
| Requests market/My Requests | Yes | Yes | Toast/inline fragments | Reload/action dependent | `PARTIAL` |
| Orders | Initial state can resemble empty before fetch | Yes | Toast | No local retry | `PARTIAL` |
| Notifications | No explicit initial loading | Yes | Toast | No local retry | `PARTIAL` |
| Profiles | Explicit loading/error | Tabs empty independently | Yes | No explicit retry | `PARTIAL` |
| Forms/dialogs | Busy + validation/error | n/a | Yes | User resubmits | `DONE` core |

UX contract `LOADING ≠ EMPTY` повністю дотриманий у Messages/Map, але не послідовно на dashboards/Notifications. Це варто закрити одним невеликим shared pattern без архітектурного rewrite.

## 20. Automated test coverage

### Unit

- Buy Request/Product/registration validation.
- Order transition roles and legacy state rules.
- Community/review validation, moderator detection, self-block rejection.
- Profile privacy/rating mapping.
- Map geometry, viewport, radius, privacy, marker state/provider helpers.
- Settlement identity/address matching, category primitives, photo storage.

### Integration

- Auth and verification flows.
- Product CRUD, photos, pagination, permissions and listing workflow.
- Buy Requests/Offers, partial acceptance and linked Products.
- Category descendants, city/nationwide search and settlement boundaries.
- Map marker privacy and profile locations.
- Deal workflow: bargaining snapshot, direct chats, outsider permissions, contact/address, blocks, concurrent/idempotent selection, single/multiple Seller accounting, cancel/reject recovery, bilateral completion, disagreement/dispute, review blind publication/timeout.

### Browser E2E

- **E2E №3 AUTOMATED / PASS**: unique accounts, three independent browser contexts, Request 20 + Offers 8/12, Deal A then intermediate accounting, Deal B final accounting, reviews/ratings/notifications/permissions and responsive smoke. Cleanup targets only generated run data; traces/screenshots retained on failure.
- Manual E2E №2 covered mobile Offer/chat/map/back/double-submit/desktop regression.
- Manual E2E №4 covered cancellation/rejection/reservation recovery, but automation was explicitly deferred.

### Найбільші test gaps перед public MVP

1. Мінімальний automated cancellation/rejection/reservation recovery regression з E2E №4; не дублювати full lifecycle.
2. Moderation/ban/hide flow після появи реальних enforcement actions.
3. Production-like email/SMS delivery smoke та abuse/rate-limit tests.
4. Map performance/load contract and one mobile touch smoke.
5. Notification deep-link isolation if conversation-per-Deal policy changes.

Backend integration suites можуть skip без `DATABASE_URL`; skipped green run не є перевіркою DB.

## 21. Legacy, duplicate and cleanup inventory

- `LEGACY`: old order statuses `draft/active/offer_received/accepted/expired` and generic transition helper coexist with workflow v2 `selected/...`; keep until data migration policy exists.
- `LEGACY docs`: `TESTER_GUIDE.md`, parts of `SETUP.md`, `BUYER_SELLER_IMPLEMENTATION_REVIEW.md`, target `DATABASE.md/ERD.md`, old stack ТЗ. `PRODUCT.md` has wrong 1–5 rating statement.
- Duplicate product concepts: seller Product listing and Seller Offer. Це не code duplication, але user promise needs distinction.
- Offer conversation reused as Deal conversation. Це intentional reuse now, але causes historical/deep-link ambiguity.
- Product/listing expiry fields and Request deadline exist; no scheduler/background persisted expiry mechanism found.
- `backend/scripts/e2e-flow.test.ps1` remains a manual HTTP regression; Playwright does not require rewriting it.
- No TODO/FIXME-heavy abandoned implementation found. Do not delete compatibility code without a data audit.

## 22. Priority classification

### P0 — BLOCKER

**No confirmed P0 defects.** Core auth, permissions, transaction completion and quantity accounting have automated coverage. A failed clean-database release rehearsal could create a new P0, тому launch gate still must include migrations + DB-backed tests + E2E №3.

### P1 — MVP REQUIRED

1. Minimum moderation/safety operations: queue UI, content hide, user suspend/ban, report targets, rate limits and accountable operator.
2. Production runbook: deploy topology, secrets, SMTP/SMS choice, DB backup/restore rehearsal, upload durability, logs/alerts and rollback.
3. Decide seller Product promise. Either integrate Product → Deal or explicitly present listing as contact/direct-chat flow and remove transaction-like expectations.
4. Normalize critical loading/error/retry states for Orders, Notifications, Requests dashboards.
5. Define/enforce expiry policy for Request/Offer/Product and show stale/expired states consistently.
6. Add focused E2E №4 automation for cancellation/rejection/reservation recovery.
7. Run clean environment release gate: migrations, typecheck, DB integration, E2E №3 twice or stable CI repeat, privacy checks.

### P2 — SHOULD HAVE

- Price/quantity filters and sorting.
- Full Request edit UI and explicit delete/deactivate/account session controls.
- Notification per-item read, preferences and better Deal-specific deep links.
- Verification badges and reporter-visible moderation outcome.
- Full responsive/accessibility matrix, keyboard/focus QA.
- Product analytics for pilot and map load testing.
- Fix known wording/reason duplication and docs drift.

### P3 — POST-MVP

- Payment, escrow, carrier integrations.
- Native app, AI matching/ranking.
- Attachments and chat archive policy UI.
- Full admin/analytics/feature-flag suite and advanced reputation system.

## 23. PRODUCT DECISIONS REQUIRED

### Decision: один чи кілька Sellers на Request?

**Current behavior:** обидва modes `single_seller` і `multiple_sellers` працюють; default — multiple.

**Possible variants:** залишити вибір Buyer; один standard mode; дозволити multiple лише певним units/categories.

**Why it matters:** UI wording, Offer selection, accounting expectations і E2E scope.

### Decision: seller Product — transaction чи lead generation?

**Current behavior:** Product discovery → direct chat; Deal/review лише через Buy Request Offer.

**Possible variants:** інтегрувати «Купити/Запропонувати» у Deal; офіційно залишити contact listing; сховати seller listing з MVP promise.

**Why it matters:** це найбільший розрив між двома половинами marketplace.

### Decision: bargaining source of truth

**Current behavior:** structured proposal змінює Offer; plain chat — лише текст; Deal uses accepted Offer snapshot.

**Possible variants:** лише structured changes; explicit «застосувати умови з чату»; immutable Offer revisions.

**Why it matters:** запобігає спору про фінальні price/quantity.

### Decision: cancellation and failure policy

**Current behavior:** обидві сторони можуть cancel/fail в active stages; reservation releases unless results conflict.

**Possible variants:** різні права/штрафи після seller confirm; mutual cancellation; moderator-only late cancellation.

**Why it matters:** trust, abuse and rating eligibility.

### Decision: conversation after terminal Deal

**Current behavior:** chat remains writable after completed/cancelled/rejected; one Offer conversation may contain several Deals.

**Possible variants:** read-only terminal chat; grace period; always open; one conversation per Deal.

**Why it matters:** support evidence, harassment risk and notification context.

### Decision: contact exchange

**Current behavior:** public phone only by consent; Deal participants get protected contact/address endpoint.

**Possible variants:** contact after selection, after seller confirmation, or public verified contact.

**Why it matters:** privacy versus fulfilment speed.

### Decision: expiration

**Current behavior:** deadlines/valid-until block acceptance or negotiation, but automatic persisted expiry and scheduler are not established.

**Possible variants:** lazy expiry on read/action; scheduled expiry; manual owner close only.

**Why it matters:** stale discovery, notifications and availability.

### Decision: delivery/pickup responsibility

**Current behavior:** structured flags plus free-text terms; no provider or tracking.

**Possible variants:** keep offline coordination for MVP; fixed pickup/delivery choices; later provider integration.

**Why it matters:** scope and completion evidence.

### Decision: location/privacy defaults

**Current behavior:** approximate by default unless user explicitly publishes pin/address or compatible profile point.

**Possible variants:** always approximate pre-Deal; public pickup points allowed; exact distance without exact coordinates.

**Why it matters:** user safety and map usefulness.

### Decision: verification gate

**Current behavior:** account can transact before verified email/phone.

**Possible variants:** verification before listing/Offer/Deal; badge only; risk-based requirement.

**Why it matters:** spam and accountability.

## 24. P0/P1 dependency map

```text
Product decisions: seller listing + expiry + verification + terminal chat
  ├─→ Product promise/UI scope
  ├─→ Safety enforcement rules
  └─→ Notification/deep-link rules

Minimum moderation API actions
  → Moderator UI
  → moderation integration tests

Abuse limits + provider configuration
  → production-like auth/contact smoke

Production deployment + durable uploads + secrets
  → DB backup/restore rehearsal
  → clean release gate

Cancellation/recovery contract (already implemented)
  → focused E2E №4 automation
  → public MVP regression gate
```

## 25. Рекомендований порядок завершення MVP

### 1. Зафіксувати product scope

1. Вирішити seller listing, expiry, verification, terminal chat і cancellation rules.
2. Це визначає, що саме обіцяє MVP.
3. Залежить лише від власника продукту.
4. `DONE`: короткі рішення додані в current product doc, без суперечностей у CTA.
5. QA: review flows/wording, tests не потрібні.

### 2. Додати мінімальний safety enforcement

1. Hide/unhide content, suspend/ban user, rate limits, audit.
2. Публічний marketplace має реагувати на abuse.
3. Залежить від рішень verification/cancellation.
4. `DONE`: заблокований user/content реально недоступний у API/UI/map/chat.
5. QA: integration permissions + кілька focused browser checks.

### 3. Зробити малий moderation console

1. Report queue, context, status/note, enforcement actions.
2. Існуючий API без робочого UI недостатній оператору.
3. Залежить від stage 2.
4. `DONE`: configured moderator може опрацювати report end-to-end.
5. QA: role/permission integration + one browser flow.

### 4. Закрити production operations

1. Deployment, secrets, SMTP/SMS, durable uploads, backup/restore, monitoring/rollback.
2. Без цього working local app не є launchable service.
3. Залежить від hosting choice.
4. `DONE`: documented rehearsal succeeds in clean environment.
5. QA: health, migration, upload, email/reset, backup restore smoke.

### 5. Реалізувати вибране рішення для seller listings

1. Або Product → Deal, або чіткий lead-only scope/UI.
2. Усунути головну продуктову неоднозначність.
3. Залежить від stage 1.
4. `DONE`: Buyer розуміє CTA і flow має відповідний terminal outcome.
5. QA: один happy path + permissions/accounting only if Deal is added.

### 6. Уніфікувати expiry та async states

1. Expiry behavior + loading/empty/error/retry for critical dashboards.
2. Прибирає stale supply/demand і хибне «порожньо».
3. Залежить від expiry decision.
4. `DONE`: status changes consistent; no LOADING=EMPTY on critical screens.
5. QA: focused API clock cases + browser states.

### 7. Додати focused cancellation regression

1. Автоматизувати E2E №4 core: select → cancel/reject → reservation returns once.
2. Захищає найризикованішу accounting гілку без дублювання E2E №3.
3. Залежить від stable cancellation rules.
4. `DONE`: isolated repeatable Playwright scenario passes twice.
5. QA: test itself + relevant integration suite.

### 8. Провести release gate

1. Clean DB migrations, typecheck, integration, E2E №3, focused cancellation, privacy and responsive smoke.
2. Це фінальне підтвердження саме release candidate.
3. Залежить від stages 2–7.
4. `DONE`: no skips in required DB suites, no P0, operational owner accepts checklist.
5. QA: один consolidated run, не повний E2E після кожної дрібної зміни.

## 26. Рекомендований найближчий крок

Провести коротку product decision session і зафіксувати **seller Product scope, expiry, verification gate та terminal chat policy**. Першим engineering stage після цього має бути мінімальний moderation/safety enforcement, бо core transaction уже працює, а public operational safety є найбільшою реальною прогалиною.
