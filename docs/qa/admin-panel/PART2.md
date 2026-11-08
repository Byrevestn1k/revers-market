# Admin panel — QA, Частина2

Дата: 2026-11-08. База: `483940ebe3f4cba105438e2586e6eaf162680981`. Independent Sol Review очікується. Основна БД, production, push, merge, deployment не використовувалися.

## Середовище

Новий local Docker `admin-part2-test-db`, `postgis/postgis:16-3.4-alpine`, PostgreSQL16, database `admin_part2_test`, тільки127.0.0.1:55432. Міграції001–067 застосовано до цієї нової БД. npm ci з lockfile. API3000/Vite5173, FRONTEND_URL=http://127.0.0.1:5173. Screenshot/fixtures не містять production-даних.

## Цільові перевірки

```bash
DATABASE_URL=<isolated-url> ADMIN_TEST_DATABASE_URL=<same-isolated-url> \
  npm run test --workspace backend -- src/admin/admin.integration.test.ts src/admin/operations.integration.test.ts src/search-rate-limit.test.ts
npm run typecheck
npm run build
git diff --check
```

**16/16 PASS**: foundation7 + operations8 + limiter1. Перевірено:

- guest401, ordinary403, Analyst/Support mutation403, Moderator roles403; Moderator users.restrict за замовчуванням403; staff/self restriction403;
- CSRF, обов’язкова allowlisted reason, строк до30 днів, UUID/version/requestKey, current/expired roles;
- два конкурентні запити з одним key → одна зміна/audit та однакові response; key з іншим payload409; конкуруючі різні рішення з однією version →200/409;
- hide/restore Product і Request без зміни комерційного status, quantity, reserved_quantity, часткових request quantities і повного історичного Deal row/snapshot;
- paused Product після restore лишається paused і публічно404;
- прихований Product недоступний гостю, пошуку, карті, новому direct chat; власний редактор доступний; restore повертає public200;
- report under_review/dismissed + історія включно з legacy report.moderated; legacy MODERATOR_USER_IDS не обходить RBAC; старий PATCH410;
- restriction діє для попередньої та нової password-login сесії; unrestrict й automatic expiry повертають доступ;
- ID/nickname search, active-role/category/author/region/visibility/report filters, sorting allowlist, невалідна календарна дата400;
- safe user/detail/report projections без phone/email/address/coordinates/password/tokens/message text, кожен вид нової успішної критичної дії має audit.

Початковий test cleanup мав FK failure після14 успішних сценаріїв; порядок очищення виправлено й повторено. Додатковий region test спочатку показав неправильний fixture без settlement_code; fixture/seed виправлено на канонічний код. Географічна policy не змінювалася.

## Повний suite і доказ baseline

Повний `npm test` виконано один раз: **291 passed,40 failed,2 skipped**,59 файлів. Це НЕ green full suite. У наступному цільовому прогоні додано ще один scenario paused restore (входить у16/16 вище).

Незмінений detached HEAD483940e: виконано тільки13 проблемних файлів →40 failed,23 passed. Набори всіх40 сценаріїв збігаються. Три demand-сценарії з нестабільним5s timeout додатково виконано на обох ревізіях з testTimeout20000:3 однакові validation failures на кожній. Після цього порівняння всі40 assertions і перші test stack locations збігаються. Детальна таблиця/сценарії: [PART2_BASELINE.md](PART2_BASELINE.md). Попередні38 не були автоматично оголошені «старими»; наведено новий доказ для фактично отриманих40. Ці помилки не виправлено, geography/delivery fixtures потребують окремої роботи.

`npm run typecheck` і `npm run build` — PASS. Vite має попередження про розмір chunks; зміни не створюють іншого admin застосунку. `git diff --check` — PASS.

## Browser QA

Відтворення з локальним seed і bootstrap (без password/session bypass):

```bash
node docs/qa/admin-panel/part2-browser-qa.cjs
```

Потрібен `docs/TEST_ACCOUNTS.local.md` від контрольованого `admin:seed:qa`; runner читає пароль лише в пам’яті, не виводить його. Chromium `/usr/bin/chromium`, або CHROMIUM_PATH. ADMIN_QA_BASE_URL і ADMIN_QA_EVIDENCE_DIR перевизначають локальні URL/артефакти.

Фактичні сценарії:

- Гість → login; справжній username/password owner login через чинний auth endpoint.
- users/products/requests/moderation/audit списки, user/product/request/report картки —1280 і390px, прямі deep links/refresh, document overflow відсутній.
- Підтверджене hide → public404 → restore → public200.
- Підтверджені under_review → dismissed, restrict з датою → unrestrict; кожний action повертає200, UI показує результат.
- User search, visibility filter/empty result, sorting; фактична перевірка filtered API total.
- Product detail додатково1024/768/320px: document overflow відсутній.
- pageerror відсутні. HTTP401 для початкового guest — очікувана перевірка auth, не помилка UI.

Під час розширення runner виправлено checkbox selector і враховано збережений стан фільтрів між viewport; окремий короткий browser check підтвердив стабільність самого фільтра. Один проміжний прогін перервано tsx watch restart під час редагування backend (локальний proxy ECONNREFUSED); фінальний прогін виконано на незмінному коді: **29 перевірок,0 pageerror**, без неочікуваних HTTP5xx.

Скриншоти: `/workspace/scratch/admin-part2-qa/`: основні списки/картки1280/390, hidden Product, confirmation dialog, filters/empty result; `results.json`. Візуально переглянуто implementer: Product detail390, Users1280, report detail1280 і filters/empty390; автоматично перевірено решту layout checks. Артефакти не комітяться; вони є свідченням, а не заміною функціонального сценарію.

Інструкція власника, точні URL, безпечний bootstrap, cleanup: [ADMIN_PANEL_PART2.md](../../ADMIN_PANEL_PART2.md). Зовнішній приватний preview не створено, deployment не виконувався.

## Залишкові межі

- Full suite має40 доведених baseline failures; green full-suite результат не заявляється.
- User self-service appeals, MFA, короткий staff idle timeout, edge rate limit за reverse proxy, production-scale query plans та production deployment не входять у завершення цього етапу. Audit UUID/історія/restore/reopen — основа майбутніх appeals, не готовий користувацький workflow.
- Admin free-text report details не відкриваються: там може бути приватний вміст. Для типів message/order немає довільного privileged reader.
- Legacy category/dispute policy не мігрувалася цим етапом; legacy report mutation більше не обходить нові рішення.
- Hidden публічні media URL фізично не видаляються/не стають приватними; історичні snapshots/діалоги учасників зберігаються. Seller Offer private storage, P1 Geo, Step32, Legal Foundation та незалежний UX Terra не переписувалися.
- Ban забороняє authenticated operations; це не мережеве блокування публічного перегляду. Вже прийнятий до обмеження in-flight неадміністративний запит не відкликається автоматично.

Результат етапу: **PART 2 READY FOR INDEPENDENT SOL REVIEW** після локального коміту; це не Sol PASS і не дозвіл на main/production. Частини3–4 не розпочато.
