# DokanFlow

Multi-tenant POS and inventory SaaS for small Bangladeshi retail businesses (dokan = shop). It covers point of sale, stock, invoicing and customer due (baki) tracking. This is a portfolio-quality project, so build it to production standards.

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
  - `apps/web`: Next.js (App Router), TypeScript, TanStack Query, React Hook Form, Zod
  - `apps/api`: NestJS REST API, Swagger/OpenAPI, Prisma, PostgreSQL
  - `apps/worker`: BullMQ workers (Node/TypeScript, shares Prisma and config with the API)
  - `packages/shared`: Zod schemas, DTO types, enums, money helpers and permission maps shared by web, api and worker
  - `packages/db`: Prisma schema, migrations, generated client and the `createPrismaClient` factory (used by api and worker)
- **Data:** PostgreSQL (with Row Level Security) and Redis (cache, rate limiting, BullMQ)
- **Local dev:** Docker Compose (postgres, redis, plus the apps if wanted)
- **CI:** GitHub Actions (lint, type-check, test, build)
- Use current stable versions. Check installed versions and the official docs before relying on any API you are unsure of.

### Pinned versions and why

- **TypeScript 6.0.x:** typescript-eslint does not support TypeScript 7 yet.
- **ESLint 9:** eslint-config-next's React, import and jsx-a11y plugins do not support ESLint 10 yet.
- **Prisma 7.10.x:** stable. The `prisma` CLI's `latest` dist-tag points at an 8.0 release candidate.
- **NestJS 12** (ESM-only), **Next.js 16**, **BullMQ 6**, **ioredis 6**, **Zod 4**, **Vitest 5**.
- pnpm enforces a minimum release age. Prefer the previous patch release over adding `minimumReleaseAgeExclude` entries.

### Commands

`pnpm check` (format, lint, type-check, unit tests) · `pnpm build` · `pnpm test:integration` (needs `pnpm infra:up && pnpm db:deploy`) · `pnpm db:migrate` · `pnpm dev`. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The planned schema is in [docs/SCHEMA.md](docs/SCHEMA.md).

### Code conventions established in Phase 1

- ESM with `NodeNext`: relative imports use `.js` extensions (except `apps/web`, which uses bundler resolution).
- API env is validated by `parseApiEnv` (`apps/api/src/config/env.ts`) and injected with `@Inject(APP_CONFIG)`. Never read `process.env` inside feature code.
- Request input is validated with `new ZodValidationPipe(schemaFromShared)`. Errors are rendered by `ApiExceptionFilter` in the `apiErrorSchema` shape, including `requestId`.
- API unit tests run through SWC (`unplugin-swc`) for decorator metadata. Integration tests are `test/**/*.int.test.ts` and use real Postgres and Redis.

## Core rules (non-negotiable)

1. **Strict TypeScript.** `strict: true` everywhere, no `any`. Use `unknown` and narrow it.
2. **Tenant isolation.** Every business table has `tenant_id`. Enforce isolation in two layers:
   - In the application: tenant context comes from the authenticated session, never from client input.
   - In PostgreSQL: RLS policies on every business table, with `FORCE ROW LEVEL SECURITY`.
   - Tests must show that tenant A cannot read or write tenant B's data, at both the API level and the raw DB level.
3. **Roles:** `owner`, `manager`, `cashier`. Permissions are enforced on the server. The UI only hides controls as a convenience.
4. **Money** is stored as an integer number of **poisha** (1 BDT = 100 poisha). Never use floats for money. Format only at the edges.
5. **Stock:** every change writes a row to `stock_movements`. Stock on hand is derived from, or reconciled against, the movements.
6. **Sales:** create the sale and decrement stock in **one DB transaction with row locking**. Concurrent sales must not oversell.
7. **Idempotency:** payment callbacks and sale creation are idempotent, via a client `Idempotency-Key` and provider transaction IDs with unique constraints.
8. **Validation:** validate all input. Zod schemas live in `packages/shared` and are reused by the API through a Zod validation pipe.
9. **Secrets:** never commit secrets. Keep `.env.example` up to date. Validate config at boot and fail fast.
10. **Refresh tokens:** store only their hashes. Rotate on every use. Reuse of an already-rotated token revokes the whole token family.
11. **Payments:** sandbox mode only. Never use real credentials.

## Workflow rules

- Work only on the phase requested (see [docs/ROADMAP.md](docs/ROADMAP.md)). Do not start the next phase.
- Before coding, state the plan and any important assumptions briefly.
- Add focused tests for business logic.
- Before finishing, run lint, type-check and the relevant tests, and fix failures.
- Never claim something works without running it. If something could not be run, say so.
- End each task with: what changed, how to test it manually, and a suggested commit message.
- Do not commit or push unless asked.

## Architecture overview

```
apps/web (Next.js) ──HTTPS/JSON──▶ apps/api (NestJS) ──▶ PostgreSQL (RLS)
                                        │   ▲
                                        ▼   │
                                      Redis ◀── apps/worker (BullMQ)
```

### Tenancy and RLS

- Shared database and shared schema. Each business row carries `tenant_id` (UUID).
- The API connects as a **non-owner, non-superuser role** (`app_user`, via `DATABASE_URL`), so RLS applies. Migrations run as the owner role `dokanflow` (via `MIGRATION_DATABASE_URL`). Roles are created by `infra/postgres/bootstrap.sql`. The API refuses to boot if its role can bypass RLS.
- Each request runs its queries inside a transaction that first executes `SELECT set_config('app.tenant_id', $1, true)`. This is transaction-local, so it is safe with connection pooling. It is wrapped in a Prisma client extension or a request-scoped service so feature code cannot forget it.
- Policy shape: `USING (tenant_id = current_setting('app.tenant_id')::uuid)` with a matching `WITH CHECK`.
- Global tables (`users`, `tenants`, `refresh_tokens`) are handled explicitly. Every business table is tenant-scoped.

### Auth and RBAC

- Short-lived JWT access token and an opaque random refresh token. Only the SHA-256 hash of the refresh token is stored, together with its family ID and rotation chain.
- A `memberships(user_id, tenant_id, role)` table maps users to tenants with a role.
- NestJS guards: `JwtAuthGuard`, then `TenantContext`, then `PermissionsGuard`. A `@RequirePermission(...)` decorator checks against a role→permission map in `packages/shared`.

### Inventory and sales

- `products` (SKU, barcode, price in poisha), `stock_levels` (current quantity per product), and `stock_movements`, which is append-only and records type, quantity delta, reference and actor.
- Sale flow, all in one transaction:
  1. Check the idempotency key; if it was already used, return the stored result.
  2. Lock the involved `stock_levels` rows with `SELECT … FOR UPDATE`, ordered by product ID to avoid deadlocks.
  3. Validate that stock is available.
  4. Insert the sale and its sale items.
  5. Update the stock levels.
  6. Insert the stock movements.
  7. Allocate an invoice number from a per-tenant counter.
- Concurrency is covered by tests that fire parallel sales against a real Postgres instance.

### Customers, dues and payments

- Each customer has a ledger (`customer_ledger_entries`). The due balance is derived from the ledger, never stored as a free-floating number.
- Payment providers sit behind a `PaymentProvider` interface, with a sandbox/mock implementation. Callbacks are verified and deduplicated by `(provider, provider_txn_id)`.

### Background jobs (apps/worker)

- BullMQ queues for invoice PDF and receipt generation, low-stock alerts, due reminders and scheduled reports.
- Jobs carry `tenantId` and set the RLS context exactly as the API does. They are idempotent and retry-safe.

### Cross-cutting concerns

- Redis caching for dashboard aggregates, invalidated on writes.
- Redis-backed rate limiting, especially on auth and payment endpoints.
- An `audit_logs` table records sensitive actions (role changes, price changes, stock adjustments, voids).
- Structured logging with request IDs. Swagger docs live at `/api/docs`.

## Conventions

- Database: snake_case tables and columns, mapped to camelCase in Prisma with `@map`/`@@map`.
- IDs: UUID. Timestamps: `timestamptz`, stored in UTC and displayed in Asia/Dhaka.
- API errors use one consistent JSON shape. List endpoints are paginated.
- Tests: unit tests for pure logic. Integration tests hit a real Postgres instance in Docker or CI. Do not mock the database for RLS or concurrency tests.

## Git push rules (always follow before every push)

Before running any `git push`, do ALL of these checks. If any check fails, STOP and tell me. Do not push.

1. Identity check: run
   git config user.name && git config user.email
   It must be exactly "Moulin Talukder" and "rock.oronno@gmail.com".
   If it is not, set it with repo-local git config and tell me.

2. Check the unpushed commits: run
   git log @{u}..HEAD --format="%h | %an <%ae> | %cn <%ce>"
   (if there is no upstream yet, use: git log --format="%h | %an <%ae> | %cn <%ce>")
   Every author AND committer must be "Moulin Talukder <rock.oronno@gmail.com>".

3. Check for attribution: run
   git log @{u}..HEAD --format="%B" | grep -ci -E "claude|anthropic|co-authored-by"
   The result must be 0. If any unpushed commit has a "Co-Authored-By: Claude" line or any
   "Generated with Claude" text, show me which commits have it, remove it from those
   unpushed commits only, and show me the result before pushing.

4. Never add Co-Authored-By, "Generated with Claude Code", or any Claude/Anthropic
   attribution to commit messages or PR descriptions.

5. Push only with my existing local git credentials (Git Credential Manager).
   Never use any other account, token, GitHub App, or Claude account.
   If authentication fails, stop and tell me. Do not try anything else.

6. Never use `git push --force`, `--force-with-lease`, or `--all`, and never rewrite
   commits that are already pushed, unless I explicitly ask in that message.
   Push only the current branch.

7. Before pushing, show me a short summary: the branch name, the number of commits,
   and the output of checks 2 and 3. Then push.
