# Локальне налаштування

## Передумови

- Node.js 20+
- npm 10+
- Docker Desktop with Linux containers

PostgreSQL/PostGIS запускається окремо через Docker. Повна інструкція знаходиться в [DATABASE_SETUP.md](../DATABASE_SETUP.md).

## Встановлення

У корені проєкту:

```bash
npm install
copy .env.example .env
npm run db:up
npm run db:migrate
```

Для PowerShell:

```powershell
Copy-Item .env.example .env
```

Файл `.env` залишається локальним і не комітиться.

## Запуск

```bash
npm run dev
```

Команда запускає Vite на `http://localhost:5173` та API на `http://localhost:3000`. Backend слухає лише `localhost`, а PostgreSQL порт прив'язаний до `127.0.0.1`, тому локальні сервіси не відкриваються у публічний інтернет.

Перевірка API:

```bash
curl http://localhost:3000/health
```

Очікувана відповідь містить `status: "ok"` і `database.status: "ok"`.

## Перевірки

```bash
npm run typecheck
npm run build
```

## Майбутні інтеграції

- PostgreSQL/PostGIS: persistence-модуль, міграції та seed категорій знаходяться в `backend/db`.
- Flutter: використовувати HTTP API як незалежний клієнтський контракт.
- Карти, чат та AI: додавати окремими модулями після узгодження API та безпеки.
