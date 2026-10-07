# marketplace-navpaky

Локальний маркетплейс товарів і запитів на купівлю з пошуком, картою, пропозиціями, угодами, чатом і відгуками.

**Поточний етап:** Step 5 завершено. Виправлення реалізації Step 6 (Google, Facebook і Telegram authentication) завершено; очікується фінальне незалежне approval перед merge. Реальні OAuth сценарії провайдерів залишаються UNVERIFIED. Актуальний статус: [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md).

## Структура

- `frontend/` — React + Vite + TypeScript клієнт.
- `backend/` — Express + TypeScript API.
- `docs/SETUP.md` — локальне встановлення та запуск.
- `ТЗ/` — вихідні матеріали технічного завдання.

Реалізовано реєстрацію, профілі, товари, запити, карту, чат, угоди та відгуки. Поточні можливості й обмеження описані в [docs/PRODUCT.md](docs/PRODUCT.md).

## Швидкий старт

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend health: `http://localhost:3000/health`

Auth API: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

Profile API: `GET /api/profiles/:username`, `GET /api/profile/me`, `PATCH /api/profile/me`, `PATCH /api/profile/me/privacy`. Публічний DTO не містить точну адресу, recovery email або телефон без явної згоди власника. Рейтинг представлений захищеним агрегованим summary; відгуки створюються в межах завершених угод.

Product API: `GET /api/categories`, `GET /api/products`, `GET /api/products/:id`, `GET /api/products/mine`, `POST /api/products`, `PATCH /api/products/:id`, `DELETE /api/products/:id`. Публічний список і detail показують лише активні товари; власник може керувати своїми товарами у статусах `draft`, `active`, `paused`, `sold`, `expired`. Список підтримує `page`, `limit`, `categoryId` і `geoZone`.

Паролі зберігаються лише як bcrypt-хеші. Сесія — це випадковий HttpOnly cookie-токен, у базі зберігається лише його SHA-256 хеш. Для browser-клієнта CORS працює з credentials.

Деталі налаштування дивіться в [docs/SETUP.md](docs/SETUP.md).
