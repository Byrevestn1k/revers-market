# marketplace-navpaky

Мінімальний full-stack каркас для майбутньої географічно орієнтованої платформи.

## Структура

- `frontend/` — React + Vite + TypeScript клієнт.
- `backend/` — Express + TypeScript API.
- `docs/SETUP.md` — локальне встановлення та запуск.
- `ТЗ/` — вихідні матеріали технічного завдання.

У каркасі реалізовано лише реєстрацію та автентифікацію. Профілі, товари, карти, чат, замовлення та рейтинги ще не реалізовані.

## Швидкий старт

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend health: `http://localhost:3000/health`

Auth API: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

Паролі зберігаються лише як bcrypt-хеші. Сесія — це випадковий HttpOnly cookie-токен, у базі зберігається лише його SHA-256 хеш. Для browser-клієнта CORS працює з credentials.

Деталі налаштування дивіться в [docs/SETUP.md](docs/SETUP.md).
