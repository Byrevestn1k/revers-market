# Admin panel — QA, Частина 1

Дата: 2026-11-08. Статус: підготовка до незалежного Sol Review. Відповідальний implementer: Codex (GPT-6), high risk (permissions, міграція, privileged operations). Незалежний reviewer: Sol — очікується.

## Сервер і міграції

Новий ізольований Docker-контейнер `admin-analytics-test-db`, PostGIS 16/3.4 Alpine, БД `admin_analytics_test`, localhost:55432. Усі міграції 001–066 успішно застосовані. Основна БД не використовувалася.

Цільовий прогін актуального коду:

```sh
DATABASE_URL=<isolated-url> ADMIN_TEST_DATABASE_URL=<same-isolated-url> npm run test --workspace backend -- src/admin/admin.integration.test.ts src/search-rate-limit.test.ts
```

**8/8 PASS** (7 admin integration + 1 limiter). Перевірено: guest 401 для всіх admin модулів, ordinary 403 включно з legacy moderator env, Moderator/Analyst grant 403, Analyst users 403, server-side permission на прямих запитах, safe user projection, маскування довільної причини/деталей скарги, відсутні KPI NULL, часові/пагінаційні ліміти, заборонений export, неподтримувані mutations, multi-seller partial accounting, CSRF, self-elevation, HTTP Super Admin grant, stale session, grant/revoke + audit, expired grants.

Повний `npm test` на ізольованій БД був виконаний: **283 passed, 41 failed, 2 skipped**, 58 файлів. Під час цього прогону паралельно допрацьовувався safe reason projection: один admin тест побачив попередній модуль із raw reason; після виправлення актуальний цільовий прогін 8/8 PASS. Повний suite після цього не повторювався.

Решта 40 failures — переважно validation HTTP400 замість201 у geography/delivery/subscriptions/listing fixtures. Не оголошені виправленими. Перевірка на detached незміненому `origin/main` (`2425408`) у тому самому середовищі відтворила обидва вибрані failures: `products.integration.test.ts` private editor case і `map.integration.test.ts` radius/privacy case (2 failed,1 passed). Це підтверджує baseline для цих двох випадків; решта не пройшла окреме baseline-порівняння. Сторонню географічну business logic в цьому етапі не змінено.

## Browser QA

Відтворюваний runner: [browser-qa.cjs](browser-qa.cjs). Потрібні запущені API3000/Vite5173 з `FRONTEND_URL=http://127.0.0.1:5173` і явний `ADMIN_QA_DATABASE_URL` із назвою БД `admin_analytics_test`. Використовує Playwright + `/usr/bin/chromium`, configurable `CHROMIUM_PATH`.

Немає `TEST_ACCOUNTS.local.md`; пароль не вигадувався. Runner створює тільки ізольовані SQL fixtures із непридатним password hash, непрозорою cookie session та її hash у БД, потім прибирає користувачів/grants. Реальний password/OAuth/MFA login не перевірений. Секрети сесій не виводяться.

Локальні screenshots/results: `/workspace/scratch/admin-panel-qa`, не включені до Git згідно з GIT_COMMIT_RULES.md. У процесі QA виправлено BrowserRouter basename і routing/auth цикл для гостя. Остаточні сценарії:

- Guest `/admin` → `/admin/login`, українська форма входу.
- Analyst Dashboard: **1280,1024,768,390,320 px**, document scrollWidth дорівнює viewport. Період із реальними fixture записами, ECharts canvas; перевірено перемикання лінії → стовпчики → лінії, окремо empty state.
- Analyst: прямий POST grant → **403**, deep link `/admin/roles` показує відсутність дозволу.
- Super Admin `/admin/roles`: підтверджене призначення Support Agent іншому fixture користувачу → **200**, active grant у БД; відкликання → **200**, active grant відсутній.
- `/admin/users`, `/admin/products`, `/admin/requests`, `/admin/offers`, `/admin/deals`, `/admin/moderation`, `/admin/audit`: **1280 і390 px**, прямий URL/refresh, список/пошук/порожні дані. Пошук fixture username перевірений на desktop/mobile.
- Початкове переповнення таблиць на mobile виправлено: компактний OSS SimpleList, обмеження layout. Після виправлення всі сім розділів мають document scrollWidth=390 на viewport390; на1280 також без переповнення.
- Остаточні runner results: errors=[] (немає pageerror). Screenshot Dashboard, bars та mobile Users візуально переглянуті implementer.

`ADMIN_QA_DASHBOARD_ONLY=1` і `ADMIN_QA_RESOURCES_ONLY=1` дозволяють повторювати потрібний сценарій; `ADMIN_QA_RESOURCE_NAMES=users,products` звужує списки. `ADMIN_QA_EVIDENCE_DIR` задає локальну теку артефактів. Між активними QA сценаріями потрібне pacing для реального90/min rate limit; ліміт не вимикається.

## Статичні перевірки

- `npm run typecheck` — **PASS**, обидва workspace.
- `npm run build` — **PASS**, обидва workspace. Є штатне попередження Vite про розмір chunks, не помилка.
- `git diff --check` — **PASS**.
- Фінальний UI має окремі lazy chunks Admin та Dashboard. Main/public components Step32 не редагувалися; wrapper з HelpCenter перенесено без зміни композиції.

Повний production login/password/OAuth flow та мобільні реальні пристрої залишаються неперевіреними; browser authorization виконувалася лише через ізольовані fixture sessions.

## Залишкові ризики

Частини 2–4 первісного ТЗ не завершені: hide/restore, platform ban, інтеграція legacy moderation, контекстні кнопки, повна аналітика/geo/CSV/comparison/config persistence. MFA, коротка staff idle session policy, edge login limits за reverse proxy, production-scale query plans і незалежний security review — перед production. Існуючі P1 geo/Offer photo цим етапом не виправлені. Vite повідомляє про chunks понад500kB; admin та Dashboard lazy-loaded окремо від публічного сайту.
