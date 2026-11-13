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
- Deferred from the Phase 2 security review:
  - **Account enumeration (7):** registration and staff creation return 409 for an existing email or phone, so anyone can probe whether an account exists. Return a neutral response (or verify ownership first) and rely on rate limits.
  - **Temporary passwords never expire (14):** add an expiry (e.g. 72 hours) after which the owner must issue a new one.
  - **Session and refresh-token retention (15):** purge expired and revoked `auth_sessions` and `refresh_tokens` (with their IPs and user agents) on a schedule.
  - **Strict reuse detection on lost responses (16):** a client retry after a lost refresh response looks like reuse and ends the session. Consider a short grace window that returns the already-issued successor instead.
  - **Self-read policy in tenant-scoped queries (21):** while `app.user_id` is set, memberships queries also see the user's own memberships in other shops; a query that forgets its tenant filter mixes them in. Set `app.user_id` only where the self-read is needed, or scope the policy to requests without a tenant context.
  - **Failed-login and security-event logging (23):** record failed logins, rate-limit hits and refresh-token reuse in `audit_logs` (or a security log) for monitoring.

## Phase 8: Testing, deployment and README

- Fill coverage gaps; end-to-end tests of key flows (Playwright)
- Production Dockerfiles; deployment configuration and docs
- Seed and demo data
- README: architecture diagram, setup, design decisions (RLS, locking, idempotency), screenshots
- Deferred from the Phase 2 security review:
  - **Web security headers (8):** add a Content-Security-Policy, `frame-ancestors 'none'`, `Referrer-Policy` and related headers to the Next.js app; keeping the access token in memory depends on XSS resistance.
  - **Database-level protection for global tables (9):** `app_user` can read every `password_hash` and update any `tenants` row. Consider column privileges, a separate credentials table, or RLS with a narrow login function.
  - **Public Swagger and health detail (17):** disable or protect `/api/docs` in production, and reduce `/api/health` to a status for public callers.
  - **Email verification (18):** verify email ownership at registration, so nobody can squat another person's email.
  - **Proxy-aware client IPs (22):** configure Express `trust proxy` for the deployment, so sessions and per-IP rate limits see the real client IP rather than the proxy's.
