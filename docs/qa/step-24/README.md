# Step 24 — Browser E2E evidence

Run on 2026-11-03 against commit `767ab5c62fbe27f5ded77d6741f6785d191da1b4` with real Chromium, the real backend and a disposable PostgreSQL/PostGIS container without a volume. The test creates synthetic accounts and 16 products; no real accounts or data are used. Network access to NBU is required. The JSON records every completed assertion; an interrupted or failed run records a failure, not a pass.

- [Assertions and viewport measurements](results.json)
- [Mobile search](search-390.png), [mobile favorites](favorites-390.png)
- [Desktop search](search-1280.png), [desktop favorites](favorites-1280.png)
- [Reproducible test](../../../e2e/step-24-evidence.cjs)

Both viewports were 900 px high. Mobile: `innerWidth=390`, `clientWidth=390`, `scrollWidth=390`. Desktop: `innerWidth=1280`, `clientWidth=1280`, `scrollWidth=1280`. The test checks UI login, search, category, explicit city selection, delivery, sort, USD, original and calculated price, favorites, Details → Back, retained filters and favorite, removal, and pagination against the server response. Console and page errors are monitored after login. An earlier diagnostic run observed two 401 resource errors while opening the unauthenticated login page; the successful run did not capture that pre-login interval, so zero errors applies only after login.

To reproduce, use a new disposable PostGIS 16 database called `step24test`, user `step24test`, exposed only on `127.0.0.1:55439`; select a temporary password and set `DATABASE_URL` accordingly. Apply the project migrations using `npm run db:migrate --workspace backend`. Start the backend on `127.0.0.1:3019` with that same `DATABASE_URL` and `FRONTEND_URL=http://127.0.0.1:5179`. Start Vite on `127.0.0.1:5179` with `BACKEND_URL=http://127.0.0.1:3019`. Install the existing Playwright Chromium if necessary. From the repository root run `node e2e/step-24-evidence.cjs` with the same `DATABASE_URL`. The script refuses other database host, port, name or user. It writes screenshots and results in this directory and creates synthetic data; use only a disposable database.

Physical Android and a real NBU outage remain unverified. No production code was changed for this evidence.
