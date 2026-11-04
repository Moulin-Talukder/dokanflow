# DokanFlow Roadmap

Each phase is done when lint, type-check and tests pass, and the phase can be demonstrated manually.

## Phase 1: Foundation

- pnpm + Turborepo monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/shared`
- Strict tsconfig base, ESLint, Prettier, and a shared test setup
- Docker Compose with Postgres and Redis; `.env.example`; config validation at boot
- NestJS skeleton with health check, Swagger, global validation pipe and error filter
- Prisma setup with a migration workflow and separate DB roles (owner for migrations, `app_user` for runtime)
- Next.js skeleton with TanStack Query provider
- GitHub Actions CI: install, lint, type-check, test, build

## Phase 2: Auth, tenants and RBAC

- Tenant signup (creates a tenant plus its owner), login and logout
- JWT access tokens; hashed refresh tokens with rotation and reuse detection
- Memberships and roles (owner, manager, cashier); permission guard and decorator
- RLS infrastructure: transaction-local `app.tenant_id`, policies, and `FORCE RLS`
- Tests: cross-tenant isolation (API and raw DB), role enforcement, refresh-token rotation and reuse
- Web: login and signup pages, auth handling, and a protected layout

## Phase 3: Products and inventory

- Products with SKU, barcode, unit, price in poisha, and category
- Stock levels and the append-only `stock_movements` table (purchase, adjustment, sale, return)
- Stock adjustment endpoint (manager and above) and a movement history view
- Tests: movement bookkeeping, money helpers, permissions, tenant isolation
- Web: product list, create/edit forms, stock adjustment, movement history

## Phase 4: POS and sales

- Sale creation in one transaction with `FOR UPDATE` row locks and an idempotency key
- Discounts, multiple payment methods (cash, card, mobile wallet, due), change calculation
- Per-tenant sequential invoice numbers; sale voids and returns (reversing movements)
- Tests: concurrent sales cannot oversell, idempotent retries, totals math in poisha
- Web: cashier POS screen (search or scan, cart, checkout) and invoice view/print

## Phase 5: Customers, dues and payment sandbox

- Customers and a due ledger (sales on credit, due collections, balance derived from the ledger)
- `PaymentProvider` abstraction with a sandbox implementation; verified, idempotent callbacks
- Tests: ledger correctness, duplicate and out-of-order callbacks, tenant isolation
- Web: customer list and detail, due statement, collect-payment flow

## Phase 6: Background jobs

- Worker app with BullMQ queues: invoice PDFs, low-stock alerts, due reminders, daily summary
- Tenant-aware job context (RLS set per job); retries, backoff and idempotent handlers
- Scheduled (repeatable) jobs; basic job monitoring
- Tests: job handlers and their idempotency

## Phase 7: Dashboard, cache, rate limiting and audit logs

- Dashboard: sales today and this month, top products, low stock, total dues
- Redis caching of aggregates with invalidation on writes
- Redis-backed rate limiting (stricter on auth and payment endpoints)
- Audit log of sensitive actions, plus an owner-only audit view
- Tests: cache invalidation, rate-limit behaviour, audit entries written

## Phase 8: Testing, deployment and README

- Fill coverage gaps; end-to-end tests of key flows (Playwright)
- Production Dockerfiles; deployment configuration and docs
- Seed and demo data
- README: architecture diagram, setup, design decisions (RLS, locking, idempotency), screenshots
