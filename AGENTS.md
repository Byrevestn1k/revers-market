# Repository Guidelines

## Project Structure & Modules

This npm workspace contains two TypeScript applications:

- `frontend/` — React 19 + Vite client. Components and feature helpers live in `frontend/src/`; static files are in `frontend/public/`.
- `backend/` — Express API. Route and domain modules are in `backend/src/`; database migrations and seed data are in `backend/db/`; upload files are stored locally in `backend/uploads/`.
- `docs/`, `DATABASE_SETUP.md`, and `EMAIL_VERIFICATION.md` document setup and feature-specific behavior. `ТЗ/` contains the source requirements.

Keep related UI, API, and validation changes close to their existing feature files. Do not edit generated `dist/` output or `node_modules/`.

## Build, Test, and Development Commands

Run commands from the repository root:

```bash
npm install                 # install workspace dependencies
npm run db:up               # start PostgreSQL/PostGIS through Docker
npm run db:migrate          # apply backend database migrations
npm run dev                 # run Vite and the API together
npm run typecheck           # check TypeScript in both workspaces
npm run build               # build frontend and backend
npm test                    # run backend Vitest suite
npm run db:down             # stop the local database
```

Copy `.env.example` to `.env` before starting services. Never commit `.env`, credentials, or uploaded test files.

## Coding Style & Naming

Use TypeScript and follow the style already used in the touched file: two-space indentation, semicolons, single quotes, and explicit exported types where they clarify API contracts. Name React components in `PascalCase` (for example, `ProductCard.tsx`), other modules in `kebab-case` (for example, `map-service.ts`), and functions/variables in `camelCase`. Prefer small feature-focused modules over unrelated rewrites.

## Testing Guidelines

Backend tests use Vitest and sit next to source files in `backend/src/`. Use `*.test.ts` for unit tests and `*.integration.test.ts` for API/database flows. Add or update coverage for changed backend behavior; run `npm test` and `npm run typecheck` before submitting. Integration tests may require the Docker database and local environment variables.

## Commits & Pull Requests

Recent commits use short imperative summaries, commonly Ukrainian, such as `Додати режими виконання запитів` or `Fix map search locations and city radius`. Keep each commit focused and describe the user-visible change. Pull requests should explain the change, list validation commands run, link the related requirement/issue when available, and include screenshots for frontend changes. Call out database migrations, configuration changes, and any security impact explicitly.
