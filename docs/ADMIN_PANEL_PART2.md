# Адмінпанель — Частина 2

Статус: реалізовано для незалежного Sol Review; не дозвіл на production. База: `483940ebe3f4cba105438e2586e6eaf162680981`. React-admin `/admin` і чинний Express/RBAC розширено без іншого застосунку.

## Аудит і рішення щодо схеми

Перевикористано `reports` (типи user/product/buy_request/order/message; open/under_review/resolved/dismissed), `audit_logs`, `admin_*`, cookie sessions. Причина скарги раніше була довільним текстом; адміністративна проєкція зберігає категорію «Неправильна категорія» / «Інша причина» без приватних details. `user_blocks` — особисте блокування співрозмовника, не platform ban. `category_appeals` і `category_block_decisions` стосуються попередніх категорійних рішень і не підходять для довільного рішення адміністратора; не дублюються.

Міграція `067_admin_operations.sql` додає `moderation_hidden` + `moderation_version` до Product/Buy Request, версію розгляду до reports, `restricted_until` + версію до users. Нових таблиць немає. Product draft/active/paused/sold/expired, стани Request, Offer, Deal, резерви й partial fulfillment не перепризначаються. Відновлення знімає лише moderation flag: paused/sold/closed оголошення не публікується автоматично.

Публічні списки, деталі для сторонніх, карта, popular categories, favorites і demand matching виключають приховане. Власник може бачити свій прихований запис; редагування не може стерти moderation flag. Нові direct conversations, direct Product proposals, створення Offer з прихованого Product/Request і прийняття Offer для прихованого listing заборонені. Історичні Offer, Deal, повідомлення учасників та збережені умови не видаляються й не переписуються.

## Розділи й API

- Користувачі: ID/username/nickname search; статус, дата реєстрації, активна адміністративна роль, активність за 30 днів; публічні ім’я/bio/country, кількості Product/Request/Offer/Deal/скарг на акаунт; історія; строкове обмеження й зняття.
- Товари й запити: окремі списки, фільтри category UUID, author UUID, канонічна область, комерційний статус, moderation visibility, період; сортування, пагінація, картки з публічним описом/ціною/кількістю, public link і пов’язані скарги.
- Модерація: за замовчуванням черга open, фільтри тип/категорія причини/дата/статус; under_review/resolved/dismissed/open; пов’язана permission-guarded картка, hide/restore або restrict з неї. Приватні message/order об’єкти не відкриваються через скаргу. Причини довільного тексту не розкриваються.
- Історія на картках: останні 100 рішень (включно з історичними report.moderated) з actor/time/reason/result/decision UUID. Audit list має окремий `audit.read`, пошук, дати, сортування/пагінацію. Структуровані before/after зберігаються серверно; raw metadata не передається у браузер.

`GET /api/admin/{resource}/:id` перевіряє відповідний read permission, UUID, allowlist полів. `POST /api/admin/{users|products|requests|moderation}/:id/actions` приймає `{action, reason, version, requestKey, until?}`. `until` тільки для restrict, обов’язкове майбутнє значення до 30 днів. Reasons: policy_violation, spam, fraud_risk, review_completed, mistake_corrected, insufficient_evidence. Немає вільного тексту, що міг би потрапити до audit як приватні дані.

Операції потребують cookie session + admin.access, permission операції, точного Origin, JSON, X-Admin-Action:1 та сесії віком до години. Під advisory lock, спільним із grants, permission перечитується; запис блокується FOR UPDATE; стара версія дає409. Зміна, збільшення версії й audit — одна транзакція. Ключ requestKey унікальний для actor: повтор ідентичного запиту повертає попередню відповідь; інший payload з тим самим ключем дає409. Відповідь містить UUID audit-рішення `decisionId`. Помилки не повертають SQL/приватні поля. Durable audit для відхилених 4xx не додається (успішні критичні операції завжди audited).

Заборонено обмежувати себе або користувача з чинним admin.access через HTTP. Строкове обмеження перевіряється під час кожного resolve cookie session, включно з раніше створеними й новими login sessions; усі requireAuth операції недоступні. Гостьовий перегляд публічного сайту лишається доступним. Після строку доступ повертається автоматично. Початок/зняття обмеження audited; природне закінчення строку не є окремою адміністративною дією.

Legacy GET `/api/moderation/reports` використовує RBAC і безпечну проєкцію замість MODERATOR_USER_IDS. Legacy PATCH повертає410 USE_ADMIN_DECISION_API: він більше не є обходом версії/CSRF/audit. Старий dispute/category moderation workflow цією частиною не переписується.

## Спільні операції та оскарження

Server registry: `backend/src/admin/operations.ts`; UI registry/конфігурований компонент: `frontend/src/admin/Operations.tsx`. Future public-site меню може використати ці endpoint і registry після перевірки `/api/admin/session`, з тим самим CSRF/session захистом. Точки інтеграції Частини4: Product detail/card, Buy Request detail/card, public profile; звичайні компоненти сайту й Step32 не редагувалися.

Основа оскаржень: незмінний audit UUID, actor, причина, before/after та відновлення/повторне відкриття рішення. Самообслуговування оскаржень ще не реалізоване. Наступна частина має прив’язати заяву до decisionId, перевірити власника target та передбачити обмежений authenticated appeal endpoint для заблокованого користувача, без повернення загальних mutation permissions. Існуючі категорійні appeals не перетворюються на універсальну таблицю мовчки.

## Локальна перевірка власником

Потрібні Git, Node22/npm, Docker Desktop/Compose v2; у Windows команди нижче виконувати у WSL2. Працювати в корені checkout `codex/admin-panel-analytics`. Не запускати на production, не використовувати основний compose/.env DATABASE_URL.

```bash
npm ci
export ADMIN_QA_DB_PASSWORD=$(node -p "require('node:crypto').randomBytes(24).toString('hex')")
docker compose -f compose.admin-qa.yml -p admin-part2 up -d --wait
export DATABASE_URL="postgresql://postgres:${ADMIN_QA_DB_PASSWORD}@127.0.0.1:55432/admin_part2_test"
export NODE_ENV=development
export PORT=3000
export FRONTEND_URL=http://127.0.0.1:5173
export PUBLIC_ORIGIN=http://127.0.0.1:5173
export APP_URL=http://127.0.0.1:5173
export PUBLIC_API_URL=http://127.0.0.1:5173
export BACKEND_URL=http://127.0.0.1:3000
export VITE_API_URL=''
node -e 'const u=new URL(process.env.DATABASE_URL); console.log(u.hostname,u.port,u.pathname)'
# Перевірити: 127.0.0.1 55432 /admin_part2_test
npm run db:migrate
ADMIN_QA_SEED_ACK=CREATE_ISOLATED_FIXTURES npm run admin:seed:qa
```

Експорти вище мають перевагу над наявними .env: admin client і dev proxy звертаються лише до локального API.

Seed відмовляється від іншої назви БД/віддаленого host, не запускається без ACK, не перезаписує наявний `docs/TEST_ACCOUNTS.local.md`. Створює шість акаунтів, Product, Request, три скарги; випадковий пароль лише в ігнорованому локальному файлі з mode0600. Owner спочатку звичайний користувач. У цьому файлі знайти його UUID і виконати (підставити UUID):

```bash
ADMIN_BOOTSTRAP_ACK=GRANT_SUPER_ADMIN npm run admin:bootstrap --workspace backend -- OWNER_UUID
npm run dev
```

Bootstrap — чинна offline процедура Частини1, з audit; HTTP обходу немає. Немає відомого тестового пароля в коді. Реальний login перевірений браузером.

1. Відкрити **http://127.0.0.1:5173/admin/login**. Логін owner і випадковий пароль взяти з `docs/TEST_ACCOUNTS.local.md`.
2. `/admin/users`: пошук seller, картка → «Тимчасово заблокувати» → причина → дата до30 днів → «Перевірити рішення» → «Підтвердити». Перевірити дату/історію, потім «Розблокувати».
3. `/admin/products`: відкрити тестовий товар, public link; приховати з причиною й підтвердженням. У новій гостьовій вкладці public URL має дати недоступність; комерційний статус лишається active. Відновити — public URL знову доступний.
4. `/admin/requests`: аналогічно запит; перевірити category/author/region/status/date/visibility фільтри через «Додати фільтр». Category UUID видно у картці, author UUID — у деталях. Для області: `Рівненська область`.
5. `/admin/moderation`: відкрити скаргу → «Взяти на розгляд», далі завершити/відхилити з причиною. Для закритих рішень змінити фільтр status; related object відкривається за дозволом. Історія на картці; відновлення помилки — через картку об’єкта.
6. `/admin/audit`: переконатися в actor/time/target/reason/result для виконаних дій. Оновлення сторінки не повторює mutation.
7. Вийти через меню користувача. Увійти як moderator, support_agent, analyst із того самого локального файлу; перевірити відповідні права за матрицею ADMIN_RBAC.md. Для дії після години — повторно увійти.
8. DevTools responsive: 390 і1280 px; перевірити списки, картки, фільтри, діалоги, loading/error/empty states. Скриншоти не замінюють натискання кнопок.

Контейнер/дані переживають перезапуск. Випадково згенерований DB password потрібно зберегти лише локально для подальшого запуску цього volume. Для нового чистого набору зупинити dev, видалити **лише ізольований QA volume**, видалити локальний файл credentials і повторити:

```bash
docker compose -f compose.admin-qa.yml -p admin-part2 down -v
```

Команда видаляє тільки тестовий набір, тому не застосовувати її до іншого compose project. Не комітити credentials і не пересилати їх. Після перевірки знищити QA БД і локальний файл.

Тимчасовий зовнішній приватний preview не створено; deployment не виконувався. Функціонально перевірений локальний сценарій — доступний варіант перевірки до main. QA-артефакти/команди й обмеження: [PART2.md](qa/admin-panel/PART2.md).
