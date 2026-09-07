# marketplace-navpaky

Мінімальний full-stack каркас для майбутньої географічно орієнтованої платформи.

## Структура

- `frontend/` — React + Vite + TypeScript клієнт.
- `backend/` — Express + TypeScript API.
- `docs/SETUP.md` — локальне встановлення та запуск.
- `ТЗ/` — вихідні матеріали технічного завдання.

У каркасі навмисно немає реєстрації, профілів, товарів, карт, чату, замовлень або рейтингів. Frontend і backend мають незалежні межі, щоб у майбутньому додати Flutter-клієнт, PostgreSQL/PostGIS, карти, чат та AI без прив'язки цих можливостей до UI.

## Швидкий старт

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend health: `http://localhost:3000/health`

Деталі налаштування дивіться в [docs/SETUP.md](docs/SETUP.md).
