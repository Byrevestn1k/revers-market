# marketplace-navpaky

Мінімальний full-stack каркас для майбутньої географічно орієнтованої платформи.

## Структура

- `frontend/` — React + Vite + TypeScript клієнт.
- `backend/` — Express + TypeScript API.
- `docs/SETUP.md` — локальне встановлення та запуск.
- `ТЗ/` — вихідні матеріали технічного завдання.

У каркасі реалізовано реєстрацію, автентифікацію, базові профілі користувачів і товари агропродукції. Карти, чат, замовлення та повна система відгуків ще не реалізовані.

## Швидкий старт

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend health: `http://localhost:3000/health`

Auth API: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

Profile API: `GET /api/profiles/:username`, `GET /api/profile/me`, `PATCH /api/profile/me`, `PATCH /api/profile/me/privacy`. Публічний DTO не містить точну адресу, recovery email або телефон без явної згоди власника. Рейтинг представлений лише захищеним агрегованим summary; створення відгуків ще не реалізоване.

Product API: `GET /api/categories`, `GET /api/products`, `GET /api/products/:id`, `GET /api/products/mine`, `POST /api/products`, `PATCH /api/products/:id`, `DELETE /api/products/:id`. Публічний список і detail показують лише активні товари; власник може керувати своїми товарами у статусах `draft`, `active`, `paused`, `sold`, `expired`. Список підтримує `page`, `limit`, `categoryId` і `geoZone`.

Паролі зберігаються лише як bcrypt-хеші. Сесія — це випадковий HttpOnly cookie-токен, у базі зберігається лише його SHA-256 хеш. Для browser-клієнта CORS працює з credentials.

Деталі налаштування дивіться в [docs/SETUP.md](docs/SETUP.md).
