# Local development

## Prerequisites

- Node.js 24.15 or later (`nvm use` reads `.nvmrc`)
- pnpm through Corepack: `corepack enable` (the version is pinned by `packageManager` in `package.json`)
- Docker with Compose v2. On WSL, enable Docker Desktop's WSL integration for your distro

## First run

```bash
cp .env.example .env        # local-only placeholder values
pnpm install
pnpm infra:up               # Postgres 18 + Redis 8, waits until healthy
pnpm db:deploy              # apply migrations as the schema owner
pnpm dev                    # web :3000, api :4000, worker
```

Then open:

- http://localhost:3000: the web app, showing live API, Postgres and Redis status
- http://localhost:4000/api/health: readiness (returns 503 if a dependency is down)
- http://localhost:4000/api/health/live: liveness
- http://localhost:4000/api/docs: Swagger UI (`/api/docs-json` for the raw OpenAPI document)

The Postgres container runs `infra/postgres/bootstrap.sql` on its **first** start. That script creates the `dokanflow` (owner) and `app_user` (runtime) roles. If you change the passwords in `.env` later, recreate the volume with `docker compose down -v`.

## Everyday commands

| Command                 | What it does                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `pnpm check`            | format check, lint, type-check and unit tests (what CI's first job runs, minus build) |
| `pnpm test`             | unit tests, with no infrastructure needed                                             |
| `pnpm test:integration` | tests against real Postgres and Redis (run `pnpm infra:up && pnpm db:deploy` first)   |
| `pnpm build`            | builds every package and app                                                          |
| `pnpm format`           | applies Prettier formatting                                                           |
| `pnpm db:migrate`       | creates and applies a new migration after editing `packages/db/prisma/schema.prisma`  |
| `pnpm db:generate`      | regenerates the Prisma client (build, typecheck and test do this automatically)       |
| `pnpm infra:down`       | stops containers (data volumes are kept)                                              |

## How the pieces fit together

- **ESM everywhere.** Every package is `"type": "module"` and compiles with `module: NodeNext`, so relative imports need a `.js` extension. `apps/web` is the exception and uses Next's bundler resolution.
- **Workspace packages are built to `dist/`.** Turborepo runs `^build` before dependants' `typecheck`, `lint`, `test` and `dev`.
- **One `.env` at the repo root.** The API, worker, Prisma config, Next config and integration tests all load it if it exists. Variables that are already set take precedence, which is how CI and production configure things.
- **API tests run through SWC** (`unplugin-swc`). Vite's default transformer doesn't emit the decorator metadata that Nest's dependency injection needs.

## Troubleshooting

- **`Could not connect to Postgres using DATABASE_URL`**: run `pnpm infra:up` and `pnpm db:deploy`.
- **`DATABASE_URL connects as "...", which bypasses Row Level Security`**: the API must connect as `app_user`. Use `MIGRATION_DATABASE_URL` only for migrations.
- **The web build fails with a ZodError on `NEXT_PUBLIC_API_URL`**: create `.env` from `.env.example`, or set the variable.
