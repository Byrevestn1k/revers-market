# Модель бази даних

Цей документ описує логічну модель PostgreSQL + PostGIS для Navpaky. Це контракт домену, а не готові міграції: типи, індекси та обмеження наведені для узгодження до реалізації persistence-модуля.

## Принципи

- PostgreSQL є джерелом істини для транзакційних даних.
- PostGIS використовується для пошуку за відстанню та географічних фільтрів.
- `users` описує обліковий запис, а `profiles` — публічну роль і дані користувача. Один користувач може одночасно купувати й продавати; окремої взаємовиключної ролі немає.
- Точна адреса зберігається окремо від публічних даних і має `visibility = private` за замовчуванням. API повертає її лише авторизованим учасникам відповідного процесу.
- Міста та країни не зашиваються в enum: використовуються ISO-код країни, зовнішній код міста та нормалізована назва.
- Великі файли не зберігаються в PostgreSQL: `product_images` містить метадані й ключ object storage.
- Гроші зберігаються як `numeric(19,4)` з обов'язковою валютою ISO 4217. Для часових міток використовується `timestamptz`.

## Розширення та типи

Перед використанням геополів база повинна мати `postgis`. Для ідентифікаторів рекомендується UUID (генерація може бути реалізована через `pgcrypto` або на рівні застосунку).

Рекомендовані доменні enum або check-обмеження:

- `address_visibility`: `private`, `participants`, `public_area`;
- `product_status`: `draft`, `active`, `paused`, `archived`;
- `buy_request_status`: `open`, `partially_fulfilled`, `fulfilled`, `cancelled`, `expired`;
- `offer_status`: `draft`, `submitted`, `accepted`, `partially_accepted`, `rejected`, `withdrawn`, `expired`;
- `order_status`: `pending`, `confirmed`, `in_progress`, `delivered`, `cancelled`, `disputed`;
- `message_type`: `text`, `system`, `attachment`.

На етапі міграцій enum можна замінити на lookup-таблиці, якщо потрібна конфігурація статусів без деплою.

## Сутності

### Користувачі, профілі та адреси

**`users`** — обліковий запис і технічний стан автентифікації.

- `id uuid PK`
- `email citext UNIQUE NOT NULL`
- `phone text UNIQUE NULL`
- `password_hash text NULL`
- `status text NOT NULL`
- `created_at`, `updated_at timestamptz NOT NULL`

**`profiles`** — публічний профіль користувача.

- `user_id uuid PK/FK -> users.id`
- `display_name text NOT NULL`
- `bio text NULL`, `avatar_key text NULL`
- `locale text`, `timezone text`
- `seller_enabled boolean NOT NULL DEFAULT true`
- `created_at`, `updated_at timestamptz NOT NULL`

`buyer` не є окремим прапорцем: кожен активний користувач може створювати buy requests. `seller_enabled` лише керує можливістю публікувати товари та подавати offers.

**`addresses`** — адреси користувача для доставки, самовивозу або геопошуку.

- `id uuid PK`, `user_id uuid FK -> users.id`
- `country_code char(2) NOT NULL`
- `city_code text NULL`, `city_name text NOT NULL`, `region_name text NULL`
- `postal_code text NULL`, `street text NULL`, `building text NULL`, `unit text NULL`
- `location geography(Point, 4326) NOT NULL`
- `visibility text NOT NULL DEFAULT 'private'`
- `label text NULL`, `is_default boolean NOT NULL DEFAULT false`
- `created_at`, `updated_at timestamptz NOT NULL`

Рекомендовані індекси: `GIST(location)`, `(user_id, is_default)`, `(country_code, city_code)`.

### Каталог

**`categories`** — дерево категорій для майбутніх країн і міст.

- `id uuid PK`, `parent_id uuid NULL FK -> categories.id`
- `code text UNIQUE NOT NULL`
- `name text NOT NULL`, `path text NULL`
- `is_active boolean NOT NULL DEFAULT true`
- `created_at`, `updated_at timestamptz NOT NULL`

**`products`** — базовий товар або пропозиція продавця в каталозі. Його базові дані не змінюються через індивідуальний offer.

- `id uuid PK`, `seller_id uuid FK -> users.id`
- `category_id uuid FK -> categories.id`
- `title text NOT NULL`, `description text NOT NULL`
- `base_unit_price numeric(19,4) NULL`, `currency char(3) NULL`, `unit text NOT NULL`
- `available_quantity numeric(19,4) NULL`
- `status text NOT NULL DEFAULT 'draft'`
- `created_at`, `updated_at timestamptz NOT NULL`

Рекомендовані індекси: `(seller_id, status)`, `(category_id, status)`, full-text індекс для `title/description`.

**`product_images`** — метадані зображень товару.

- `id uuid PK`, `product_id uuid FK -> products.id ON DELETE CASCADE`
- `storage_key text NOT NULL`, `sort_order integer NOT NULL DEFAULT 0`
- `alt_text text NULL`, `created_at timestamptz NOT NULL`

### Запити, offers і виконання

**`buy_requests`** — запит покупця на один або кілька товарів/послуг.

- `id uuid PK`, `buyer_id uuid FK -> users.id`, `category_id uuid FK -> categories.id`
- `title text NOT NULL`, `description text NOT NULL`
- `requested_quantity numeric(19,4) NOT NULL`, `unit text NOT NULL`
- `fulfilled_quantity numeric(19,4) NOT NULL DEFAULT 0`
- `currency char(3) NULL`, `max_unit_price numeric(19,4) NULL`
- `delivery_address_id uuid NULL FK -> addresses.id`
- `search_area geography(Geometry, 4326) NULL`
- `status text NOT NULL DEFAULT 'open'`
- `expires_at timestamptz NULL`, `created_at`, `updated_at timestamptz NOT NULL`

`search_area` може бути точкою, полігоном або buffered geometry; для простого радіусного пошуку достатньо точки + параметра радіуса на рівні запиту. Індекс: `GIST(search_area)`.

**`offers`** — індивідуальна пропозиція продавця у відповідь на buy request. Один buy request має багато offers.

- `id uuid PK`, `buy_request_id uuid FK -> buy_requests.id`
- `seller_id uuid FK -> users.id`, `product_id uuid NULL FK -> products.id`
- `offered_quantity numeric(19,4) NOT NULL`, `accepted_quantity numeric(19,4) NOT NULL DEFAULT 0`
- `unit_price numeric(19,4) NOT NULL`, `currency char(3) NOT NULL`, `unit text NOT NULL`
- `terms jsonb NOT NULL DEFAULT '{}'` — індивідуальні умови, що не змінюють `products`
- `delivery_terms jsonb NOT NULL DEFAULT '{}'`
- `status text NOT NULL DEFAULT 'submitted'`
- `valid_until timestamptz NULL`, `created_at`, `updated_at timestamptz NOT NULL`

Обмеження: `accepted_quantity <= offered_quantity`; одна пропозиція не може бути прийнята її власним покупцем; seller має збігатися з `products.seller_id`, якщо `product_id` заданий. Оскільки один запит може виконуватись кількома продавцями, бізнес-правило `SUM(offers.accepted_quantity) <= buy_requests.requested_quantity` перевіряється транзакційно.

**`orders`** — seller-specific результат прийняття offer. Для часткового виконання одного buy request створюється один або більше orders, по одному на продавця/узгоджену поставку.

- `id uuid PK`, `buy_request_id uuid FK -> buy_requests.id`, `buyer_id uuid FK -> users.id`, `seller_id uuid FK -> users.id`
- `status text NOT NULL DEFAULT 'pending'`
- `delivery_address_id uuid NULL FK -> addresses.id`
- `currency char(3) NOT NULL`, `subtotal numeric(19,4) NOT NULL`
- `accepted_at timestamptz NOT NULL`, `created_at`, `updated_at timestamptz NOT NULL`

### Замовлення та snapshot

**`order_items`** — рядки замовлення і незмінний snapshot прийнятої пропозиції.

- `id uuid PK`, `order_id uuid FK -> orders.id ON DELETE CASCADE`
- `offer_id uuid NULL FK -> offers.id`, `product_id uuid NULL FK -> products.id`
- `quantity numeric(19,4) NOT NULL`, `unit text NOT NULL`
- `unit_price numeric(19,4) NOT NULL`, `currency char(3) NOT NULL`
- `product_title_snapshot text NOT NULL`
- `offer_terms_snapshot jsonb NOT NULL DEFAULT '{}'`
- `delivery_terms_snapshot jsonb NOT NULL DEFAULT '{}'`
- `created_at timestamptz NOT NULL`

Snapshot-поля копіюються в одній транзакції під час прийняття offer. Подальша зміна `products` або `offers` не змінює історичні умови замовлення.

### Чат

**`conversations`** — діалог, зазвичай прив'язаний до buy request або order.

- `id uuid PK`, `buy_request_id uuid NULL FK -> buy_requests.id`, `order_id uuid NULL FK -> orders.id`
- `created_at`, `updated_at timestamptz NOT NULL`

**`participants`** — учасники діалогу.

- `conversation_id uuid FK -> conversations.id ON DELETE CASCADE`
- `user_id uuid FK -> users.id`
- `joined_at timestamptz NOT NULL`, `left_at timestamptz NULL`
- PK (`conversation_id`, `user_id`)

**`messages`** — повідомлення та посилання на вкладення.

- `id uuid PK`, `conversation_id uuid FK -> conversations.id ON DELETE CASCADE`
- `sender_id uuid FK -> users.id`, `message_type text NOT NULL`
- `body text NULL`, `attachment_key text NULL`
- `created_at timestamptz NOT NULL`, `edited_at timestamptz NULL`, `deleted_at timestamptz NULL`

Індекс: `(conversation_id, created_at, id)`.

### Довіра, сповіщення та аудит

**`reviews`** — оцінка завершеної взаємодії.

- `id uuid PK`, `order_id uuid FK -> orders.id`, `author_id uuid FK -> users.id`, `subject_id uuid FK -> users.id`
- `rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5)`
- `body text NULL`, `created_at`, `updated_at timestamptz NOT NULL`

Рекомендується `UNIQUE(order_id, author_id, subject_id)` і перевірка, що author/subject є учасниками order.

**`notifications`** — in-app сповіщення користувача.

- `id uuid PK`, `user_id uuid FK -> users.id ON DELETE CASCADE`
- `type text NOT NULL`, `payload jsonb NOT NULL DEFAULT '{}'`
- `read_at timestamptz NULL`, `created_at timestamptz NOT NULL`

Індекс: `(user_id, read_at, created_at DESC)`.

**`reports`** — скарги на користувача або доменний об'єкт.

- `id uuid PK`, `reporter_id uuid FK -> users.id`
- `reported_user_id uuid NULL FK -> users.id`
- `entity_type text NOT NULL`, `entity_id uuid NOT NULL`
- `reason text NOT NULL`, `details text NULL`, `status text NOT NULL DEFAULT 'open'`
- `resolved_by uuid NULL FK -> users.id`, `resolved_at timestamptz NULL`
- `created_at timestamptz NOT NULL`

**`audit_logs`** — незмінний журнал важливих змін і дій модерації.

- `id uuid PK`, `actor_id uuid NULL FK -> users.id`
- `action text NOT NULL`, `entity_type text NOT NULL`, `entity_id uuid NULL`
- `before_data jsonb NULL`, `after_data jsonb NULL`, `metadata jsonb NOT NULL DEFAULT '{}'`
- `ip_address inet NULL`, `created_at timestamptz NOT NULL`

Для audit log забороняються `UPDATE` і `DELETE` на рівні ролі БД; retention та архівування визначаються окремо.

## Геопошук

- Усі координати зберігаються як `geography(..., 4326)` для відстаней у метрах.
- Для пошуку продавців/товарів у радіусі застосовується `ST_DWithin(location, query_point, radius_meters)` з GIST-індексом.
- `addresses.location` є приватним полем; публічний пошук працює з агрегованою областю, містом або coarse геоточністю, а не з точною адресою.
- `country_code`, `city_code` і `city_name` присутні на адресі та можуть бути додані до buy request/product delivery metadata без прив'язки до одного міста.

## Транзакційні правила

1. Створення order і `order_items` виконується в одній транзакції з прийняттям offer та snapshot умов.
2. Прийняття offer перевіряє залишок `requested_quantity` і дозволяє кілька offers від різних sellers.
3. `buy_requests.fulfilled_quantity` оновлюється атомарно; статус переходить у `partially_fulfilled` або `fulfilled`.
4. Зміна offer після прийняття не переписує `order_items`.
5. Видалення користувача має бути soft-delete або anonymization, щоб не ламати orders, reviews і audit logs.
6. Доступ до приватних адрес, повідомлень і audit logs реалізується API authorization та, за потреби, PostgreSQL RLS.

## ER diagram

Повна Mermaid-діаграма винесена в [ERD.md](ERD.md), щоб її можна було переглядати окремо від пояснення моделі.

## Межі цього кроку

Цей документ не містить SQL-міграцій, RLS-політик, тригерів, seed-даних або ORM-схем. Вони з'являються після затвердження логічної моделі.
