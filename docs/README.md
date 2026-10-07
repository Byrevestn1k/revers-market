# Документація: навігатор для AI-агентів

Це карта документів, а не опис продукту. Перед роботою з функцією спочатку звіряйте її з кодом, міграціями та тестами.

## Пріоритет джерел істини

Для **фактично реалізованої** поведінки застосовуйте пріоритет:

1. Поточний код + migrations + automated tests.
2. [PRODUCT.md](PRODUCT.md) — компактна карта поточного продукту.
3. Актуальні feature-specific implementation docs.
4. QA/testing docs.
5. Target architecture/domain design docs.
6. Старі ТЗ та historical documents.

Якщо документ суперечить коду, спочатку позначте його як застарілий. Не змінюйте код лише для відповідності старому документу.

## Документи

| Документ | Тип і призначення | Статус щодо current implementation |
| --- | --- | --- |
| [PROJECT_STATE.md](PROJECT_STATE.md) | **CURRENT STEP.** Поточний етап, завершені кроки й потрібний контекст. | Step 5 DONE; Step 6 awaits final independent re-review. |
| [AUTH_PROVIDERS.md](AUTH_PROVIDERS.md) | **CURRENT FEATURE.** Способи входу Google, Facebook і Telegram та межі перевірки. | Step 6 corrections are implemented; real OAuth scenarios remain UNVERIFIED. |
| [GIT_COMMIT_RULES.md](GIT_COMMIT_RULES.md) | **Workflow.** Що додавати або не додавати до commit/push, щоб source files не змішувалися з локальними даними. | Постійне правило для роботи з Git. |
| [MVP_INVENTORY.md](MVP_INVENTORY.md) | **CURRENT PRODUCT AUDIT / PLANNING.** Snapshot стану продукту, перевірених можливостей, MVP gaps, рішень і рекомендованого порядку робіт станом на 2026-09-29. | Не є implementation source of truth: фактичну поведінку завжди звіряти з кодом, migrations і automated tests. |
| [PRODUCT.md](PRODUCT.md) | **CURRENT.** Карта продукту, ролей, flows і меж. | Основний документ після коду. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **TARGET/design.** Цільові межі модульного моноліту та майбутні adapters. | Не є описом усіх реалізованих модулів. |
| [DATABASE.md](DATABASE.md) | **TARGET/design.** Логічна доменна модель БД. | Не замінює migrations. |
| [ERD.md](ERD.md) | **TARGET/design.** Візуальна ER-модель. | Не замінює migrations. |
| [BUYER_SELLER_IMPLEMENTATION_REVIEW.md](BUYER_SELLER_IMPLEMENTATION_REVIEW.md) | **HISTORICAL/analysis + partial current.** Аналіз та еволюція request/offer/deal workflow. | Звіряти з кодом: містить уже виконані й застарілі пункти. |
| [location-search.md](location-search.md) | **Feature-specific behavior.** Населені пункти, адресний пошук, HERE, приватність локації. | Актуальний орієнтир для цієї функції; код має перевагу. |
| [map-discovery.md](map-discovery.md) | **Feature-specific behavior.** Взаємодія з мапою, маркерами й групами. | Актуальний/частковий: має позначені окремі майбутні фільтри. |
| [PILOT_ANALYTICS.md](PILOT_ANALYTICS.md) | **TARGET/design.** Контракт подій і метрик пілота. | Події не підтверджені як повна реалізація. |
| [QA_REPORT.md](QA_REPORT.md) | **QA/testing.** Межі MVP та pre-pilot перевірки. | Використовувати як чекліст, не як джерело workflow. |
| [SETUP.md](SETUP.md) | **Setup.** Локальний запуск і базова auth-конфігурація. | Загалом актуальний; майбутні інтеграції в кінці застаріли. |
| [TESTER_GUIDE.md](TESTER_GUIDE.md) | **QA/testing.** Ручний сценарій двох учасників. | Частково застарілий щодо lifecycle угоди. |

## Відомі застарілі або змішані документи

- **SETUP.md:** розділ «Майбутні інтеграції» називає карти й чат майбутніми. Вони реалізовані; актуальніші джерела — код, `PRODUCT.md`, `location-search.md` і `map-discovery.md`.
- **TESTER_GUIDE.md:** описує перехід до `in_progress` та завершення лише покупцем. Поточний workflow містить підтвердження продавцем і подвійне завершення; див. код, `PRODUCT.md` і актуальну частину `BUYER_SELLER_IMPLEMENTATION_REVIEW.md`.
- **BUYER_SELLER_IMPLEMENTATION_REVIEW.md:** поєднує реалізовані зміни з початковим аналізом і списками «потрібно». Для request/offer/deal пріоритет мають код, migrations, tests та `PRODUCT.md`.
- **DATABASE.md` і `ERD.md`:** це проектна модель, не фактична схема. Вони не містять усіх пізніших полів і сутностей, зокрема negotiation proposals та прямі conversations; актуальніші migrations.
- **PILOT_ANALYTICS.md:** описує бажаний контракт; повної реалізації `analytics_events` не знайдено. Наявний `audit_logs` не є заміною цього контракту.

## Швидкий вибір документа

- Product meaning, ролі, flows: `PRODUCT.md`.
- Фактичні поля, статуси й права: код, migrations і тести.
- Карта, локація, адреси: `location-search.md`, `map-discovery.md` + код.
- Локальний запуск: `SETUP.md` і `DATABASE_SETUP.md` у корені.
- Перевірка перед пілотом: `QA_REPORT.md`, `TESTER_GUIDE.md`, але звірити lifecycle угоди з кодом.
- Майбутня архітектура чи доменна модель: `ARCHITECTURE.md`, `DATABASE.md`, `ERD.md`.
