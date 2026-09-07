# Локальне налаштування

## Передумови

- Node.js 20+
- npm 10+

База даних для стартового каркаса не потрібна. PostgreSQL/PostGIS буде підключено окремим етапом через змінну `DATABASE_URL`.

## Встановлення

У корені проєкту:

```bash
npm install
copy .env.example .env
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

Команда запускає Vite на `http://localhost:5173` та API на `http://localhost:3000`. Backend слухає лише `localhost`, тому локальні сервіси не відкриваються у публічний інтернет.

Перевірка API:

```bash
curl http://localhost:3000/health
```

Очікувана відповідь містить `status: "ok"`.

## Перевірки

```bash
npm run typecheck
npm run build
```

## Майбутні інтеграції

- PostgreSQL/PostGIS: додати окремий persistence-модуль у `backend` і міграції.
- Flutter: використовувати HTTP API як незалежний клієнтський контракт.
- Карти, чат та AI: додавати окремими модулями після узгодження API та безпеки.
