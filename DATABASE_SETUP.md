# Database setup

Локальна база запускається через PostgreSQL 16 з PostGIS 3.4. Порт прив'язаний тільки к `127.0.0.1`, тому контейнер не відкриває базу в публічний інтернет.

## Переменные окружения

```powershell
Copy-Item .env.example .env
```

`.env` не коммитится. `DATABASE_URL` используется backend, а `POSTGRES_*` передаются Docker Compose контейнеру.

## Чистое создание БД

```powershell
docker compose down --volumes
npm run db:up
npm run db:migrate
```

`db:up` запускается из корня проекта и ждёт готовности PostgreSQL. Мигратор применяет SQL-файлы из `backend/db/migrations/` по порядку и записывает версии в `schema_migrations`.

## Проверка

```powershell
npm run db:status
npm run dev --workspace backend
Invoke-RestMethod http://127.0.0.1:3000/health | ConvertTo-Json
```

Ожидаемый результат содержит:

```json
{
  "status": "ok",
  "service": "backend",
  "database": {
    "status": "ok"
  }
}
```

Проверка PostGIS и seed:

```powershell
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT PostGIS_Version();"'
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT code, name FROM categories ORDER BY code;"'
```

Остановка контейнера без удаления данных:

```powershell
docker compose down
```
