# Local development

## Prerequisites

- Node.js 24.15 or later (`nvm use` reads `.nvmrc`). `pnpm install` refuses older versions (`engineStrict`); the API needs `node:crypto` Argon2 (Node 24.7+) and checks for it at startup
- pnpm through Corepack: `corepack enable` (the version is pinned by `packageManager` in `package.json`)
- Docker with Compose v2. On WSL, enable Docker Desktop's WSL integration for your distro

## First run

```bash
cp .env.example .env        # local-only placeholder values
pnpm install
pnpm infra:up               # Postgres 18 + Redis 8, waits until healthy
pnpm db:deploy              # apply migrations as the schema owner
pnpm db:test:deploy         # migrate the separate integration-test database
pnpm dev                    # web :3000, api :4000, worker
```

Then open:

- http://localhost:3000: the web app, showing live API, Postgres and Redis status
- http://localhost:4000/api/health: readiness (returns 503 if a dependency is down)
- http://localhost:4000/api/health/live: liveness
- http://localhost:4000/api/docs: Swagger UI (`/api/docs-json` for the raw OpenAPI document)

The Postgres container runs `infra/postgres/bootstrap.sql` on its **first** start. That script creates the `dokanflow` (owner) and `app_user` (runtime) roles, the `dokanflow` development database and the `dokanflow_test` integration-test database. If you change the passwords in `.env` later, recreate the volume with `docker compose down -v`.

**Upgrading a volume created before the test database existed:** run `pnpm infra:up` (this recreates the Postgres container with the new mount; the data volume is kept), then `pnpm db:test:create && pnpm db:test:deploy`. Both commands are safe to repeat.

## Integration tests and the test database

Integration tests run against `dokanflow_test` and Redis database index 1. They never use the development database:

- They read only `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL` and `TEST_REDIS_URL`. There is no fallback to `DATABASE_URL` or `REDIS_URL`.
- Before connecting, they refuse to run if the database name does not end in `_test`, if it is the same database as `DATABASE_URL` or `MIGRATION_DATABASE_URL`, or if the test Redis database is the same as `REDIS_URL`.
- After connecting, they ask Postgres for `current_database()` and stop unless it ends in `_test`.
- `pnpm db:test:deploy` applies migrations only to a database whose name ends in `_test`.

Tests create their own uniquely named data and do not clean it up, so the test database grows over time. Reset it whenever you like: `docker compose exec postgres dropdb -U postgres dokanflow_test && pnpm db:test:create && pnpm db:test:deploy`.

## Everyday commands

| Command                 | What it does                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm check`            | format check, lint, type-check and unit tests (what CI's first job runs, minus build)             |
| `pnpm test`             | unit tests, with no infrastructure needed                                                         |
| `pnpm test:integration` | tests against the test database and test Redis (run `pnpm infra:up && pnpm db:test:deploy` first) |
| `pnpm build`            | builds every package and app                                                                      |
| `pnpm format`           | applies Prettier formatting                                                                       |
| `pnpm db:migrate`       | creates and applies a new migration after editing `packages/db/prisma/schema.prisma`              |
| `pnpm db:test:create`   | creates `dokanflow_test` in an existing local Postgres volume (idempotent)                        |
| `pnpm db:test:deploy`   | applies migrations to the test database (refuses names without `_test`)                           |
| `pnpm db:generate`      | regenerates the Prisma client (build, typecheck and test do this automatically)                   |
| `pnpm infra:down`       | stops containers (data volumes are kept)                                                          |

## How the pieces fit together

- **ESM everywhere.** Every package is `"type": "module"` and compiles with `module: NodeNext`, so relative imports need a `.js` extension. `apps/web` is the exception and uses Next's bundler resolution.
- **Workspace packages are built to `dist/`.** Turborepo runs `^build` before dependants' `typecheck`, `lint`, `test` and `dev`.
- **One `.env` at the repo root.** The API, worker, Prisma config, Next config and integration tests all load it if it exists. Variables that are already set take precedence, which is how CI and production configure things.
- **API tests run through SWC** (`unplugin-swc`). Vite's default transformer doesn't emit the decorator metadata that Nest's dependency injection needs.

## Trying the auth flows (Phase 2)

1. Open http://localhost:3000/register and create a business. You land on the app home as its owner.
2. Go to **Staff** and add a cashier with a mobile number (for example `01712345678`) and a temporary password.
3. In a private window, log in at http://localhost:3000/login with the mobile number. You are sent to **Change your password** and cannot use anything else until you do.
4. As the owner, reset the cashier's password from the staff list. The cashier's open session ends on its next request.
5. On the home page, create a second business, then switch between shops with the menu in the header.

Swagger (http://localhost:4000/api/docs) documents every endpoint. Endpoints that use the refresh cookie (`/auth/refresh`, `/auth/logout`, `/auth/switch-tenant`) also require the header `x-dokanflow-csrf: 1`.

## Troubleshooting

- **`Could not connect to Postgres using DATABASE_URL`**: run `pnpm infra:up` and `pnpm db:deploy`.
- **`DATABASE_URL connects as "...", which bypasses Row Level Security`**: the API must connect as `app_user`. Use `MIGRATION_DATABASE_URL` only for migrations.
- **The web build fails with a ZodError on `NEXT_PUBLIC_API_URL`**: create `.env` from `.env.example`, or set the variable.
- **`Invalid environment configuration: JWT_ACCESS_SECRET`**: an `.env` created before Phase 2 lacks the auth settings. Copy the Auth section from `.env.example`, and generate a secret with `openssl rand -base64 48`.
- **Logged out when opening many tabs at once**: this should not happen. Refreshes are serialized across tabs with the Web Locks API. If it does, check that the browser supports `navigator.locks`; reuse of a rotated refresh token deliberately ends the session.
