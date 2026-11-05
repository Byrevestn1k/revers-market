# Reviewer corrections — assertion results

- `npm run typecheck`: PASS.
- Full sequential backend suite against isolated PostgreSQL: **51 test files passed, 1 skipped; 291 tests passed, 1 skipped**. The additional Product/Deal test was added while this suite was already running and passed separately.
- Direct hidden retry: **1 passed**, 10 unrelated tests filtered out. Same and changed request bodies return `409 MESSAGE_HISTORY_HIDDEN`; no old message in response, no new message or notification, unread of both participants and visibility boundary unchanged; counterpart history retained; new visible retry is idempotent.
- Product and Deal hidden retry: **1 passed**, 10 unrelated tests filtered out. Both contexts return 409 without the old body, duplicate messages or notifications, or changed counterpart unread; the other participant keeps the history.
- Chromium `reviewer.spec.ts`: **2 passed** (390 and 1280 px). Deal chat: personal delete, incoming message, allowed history, unread cleared and navigation from the associated Deal. On 390 px the actual row button was brought near the fixed navigation by normal scrolling; menu bounds, visible items and the archive action were checked without changing the button's styles or DOM position.
- Test data creation used API in the isolated database; deletion, conversation opening, Deal navigation and menu actions used the UI.
- The previous six-width responsive run predates this server correction. Physical mobile keyboard remains unverified.
