# Database schema design

This is the planned schema. Each roadmap phase adds only the tables it needs. The column lists show the important columns, not every index and constraint.

- **Phase 1** has no tables. It ships one migration that grants table privileges to the runtime role.
- **Phase 2** adds `users`, `tenants`, `branches`, `memberships`, `auth_sessions` and `refresh_tokens`, plus the RLS helper functions and policies.

## Global conventions

| Concern       | Rule                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Naming        | snake_case tables and columns in Postgres, mapped to camelCase in Prisma (`@map`/`@@map`)                                                   |
| Keys          | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                                                                             |
| Time          | `timestamptz` in UTC (`created_at`, `updated_at`), displayed in Asia/Dhaka                                                                  |
| Money         | `bigint` (or `integer`) **poisha**. No `numeric` or float money columns. Column names end in `_poisha`                                      |
| Quantity      | integer in the product's **base unit** (pieces, grams, millilitres), so loose goods stay exact                                              |
| Rates         | integer **basis points** (1 bp = 0.01%, so 7.5% VAT = `750`). Column names end in `_bp`                                                     |
| Tenancy       | every business table has `tenant_id uuid NOT NULL REFERENCES tenants(id)`                                                                   |
| Composite FKs | child rows reference `(tenant_id, id)` of the parent, so a row can never point at another tenant's row                                      |
| RLS           | every business table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, with a policy `tenant_id = app_current_tenant_id()` (`USING` and `WITH CHECK`) |
| Soft delete   | `archived_at` on catalogue-style tables (products, customers). Financial records are never deleted                                          |

## Database roles

| Role        | Used by                   | Properties                                                                                |
| ----------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `dokanflow` | Prisma migrations only    | Owns the schema and every table                                                           |
| `app_user`  | API and worker at runtime | `NOSUPERUSER NOBYPASSRLS`. DML only, via default privileges. Cannot run DDL or `TRUNCATE` |

Because `app_user` neither owns the tables nor has `BYPASSRLS`, RLS policies always apply to it. `FORCE ROW LEVEL SECURITY` also covers any future owner-role access. The API refuses to start if `DATABASE_URL` connects as a role that can bypass RLS.

## Row Level Security context

Every tenant-scoped query runs inside a transaction that first calls:

```sql
SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true);
```

`true` makes the settings transaction-local, so a pooled connection never carries one request's tenant into the next. Policies read the settings through two helper functions:

- `app_current_tenant_id()` returns `NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
- `app_current_user_id()` does the same for `app.user_id`.

When the context is missing, both return `NULL`, every policy comparison is false, and queries return no rows. Forgetting to set the context therefore **fails closed**: it can hide data, but it cannot leak another tenant's.

## Tables by phase

### Phase 2: auth, tenants and RBAC

| Table            | RLS                                                     | Key columns                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`          | no (global identity, see below)                         | `name`, `email` unique (stored lowercased, nullable), `phone` unique (normalized E.164, nullable), `CHECK (email IS NOT NULL OR phone IS NOT NULL)`, `password_hash` (Argon2id), `must_change_password`, `password_changed_at` (informational only), `managed_by_tenant_id` (set for staff created by an owner; cleared when they start their own business), `last_tenant_id`, `status` |
| `tenants`        | no (global, see below)                                  | `name`, `status`, `timezone` default `Asia/Dhaka`                                                                                                                                                                                                                                                                                                                                       |
| `branches`       | yes                                                     | `name`, `is_default` (TRUE or NULL, never FALSE); unique `(tenant_id, is_default)` allows one default branch per tenant. Created with the tenant                                                                                                                                                                                                                                        |
| `memberships`    | yes, plus a self-read policy                            | `user_id`, `role` enum(`owner`,`manager`,`cashier`); unique `(tenant_id, user_id)`                                                                                                                                                                                                                                                                                                      |
| `auth_sessions`  | no (checked before and alongside tenant context)        | one row per login: `user_id`, `expires_at` (absolute end, fixed at login), `revoked_at`                                                                                                                                                                                                                                                                                                 |
| `refresh_tokens` | no (looked up by hash before any tenant context exists) | `user_id`, `tenant_id` (the session's active shop), `session_id`, `token_hash` unique (SHA-256 of the opaque token), `replaced_by_id`, `expires_at` (never later than the session's), `revoked_at`, `user_agent`, `ip`                                                                                                                                                                  |

**Global tables.** `users`, `tenants`, `auth_sessions` and `refresh_tokens` have no RLS because they are read before a tenant context exists (login, refresh). The API only touches them through the auth, user and tenant services, and never returns `password_hash` or `token_hash`.

**Membership policies.**

- `memberships_tenant_isolation` (all commands): `tenant_id = app_current_tenant_id()`.
- `memberships_self_read` (`SELECT` only): `user_id = app_current_user_id()`. This lets a user list their own memberships in every shop for the shop switcher. Policies of the same command are OR'd, but writes still require the tenant context.
- The tenant context only ever comes from a server-signed access token or server-side data. A shop id from a request (switch-tenant) is checked against the user's own memberships with **user context only**, before anything else.

**Sessions, rotation and reuse detection.**

- Login starts an `auth_sessions` row whose `expires_at` (`SESSION_MAX_AGE_DAYS`, default 30) never changes.
- Each successful refresh locks the presented token and its session (`FOR UPDATE`), marks the token replaced, and issues a new one in the same session that expires at `min(now + REFRESH_TOKEN_TTL_DAYS, session expires_at)`. Rotation can therefore never extend a session.
- Presenting a token that is already replaced or revoked, or whose session is revoked, is treated as theft: the whole session is revoked and the request fails with 401.
- Two tabs refreshing at the same moment with the same token would log that session out. The web app serializes refreshes across tabs to avoid this.

**Access tokens.** JWTs (HS256, 15 minutes) with `sub` (user), `tid` (active tenant) and `sid` (session). Each request re-reads the membership, the user and the session, so these take effect immediately, with no timestamp comparisons (and so no clock skew between API and database):

- removing a role or membership, or disabling a user
- logout and refresh-token reuse (the session is revoked)
- a password change or reset (all of the user's sessions are revoked in the same transaction as the password update)
- the session reaching its absolute `expires_at`

**Rate limits and password hashing.** Login, register, refresh, change-password and staff password reset are rate-limited in Redis per client IP and per identifier (normalized email or phone, session, account or target user; stored as hashes). Exceeding a limit returns 429 with `Retry-After`. If Redis is unavailable the limiter allows the request and logs it. Argon2 runs at most `PASSWORD_HASH_CONCURRENCY` (default 4) at a time with a bounded queue (`PASSWORD_HASH_QUEUE`); beyond that the API answers 503 instead of exhausting memory.

### Phase 3: products and inventory

| Table             | Key columns                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories`      | `name`; unique `(tenant_id, name)`                                                                                                                                                                                                                                                  |
| `products`        | `name`, `sku` unique per tenant, `barcode` unique per tenant (nullable), `unit` enum(`piece`,`gram`,`ml`), `price_poisha` (shelf price **including VAT**; see the pricing rule below), `cost_poisha`, `vat_rate_bp` (nullable), `category_id`, `low_stock_threshold`, `archived_at` |
| `stock_levels`    | `branch_id`, `product_id`, `quantity` (base units, `CHECK (quantity >= 0)`); PK `(tenant_id, branch_id, product_id)`. This is the row that sales lock                                                                                                                               |
| `stock_movements` | append-only: `branch_id`, `product_id`, `type` enum(`opening`,`purchase`,`adjustment`,`sale`,`sale_void`,`return`), `quantity_delta`, `quantity_after`, `reference_type`, `reference_id`, `reason`, `actor_user_id`, `created_at`                                                   |

- **Invariant:** for each `(branch, product)`, `stock_levels.quantity` equals the sum of `stock_movements.quantity_delta`. A test and a reconciliation query check it.
- **Unit lock:** a product's `unit` cannot change once it has any stock movement. A trigger enforces this, and the API also rejects the change with 409.

### Phase 4: POS and sales

| Table              | Key columns                                                                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales`            | `branch_id`, `invoice_no` (unique per tenant), `customer_id` nullable, `cashier_user_id`, `status` enum(`completed`,`voided`), `subtotal_poisha`, `discount_poisha`, `tax_poisha` (VAT contained in the total), `total_poisha`, `paid_poisha`, `due_poisha`, `idempotency_key`; unique `(tenant_id, idempotency_key)` |
| `sale_items`       | `sale_id`, `product_id`, `unit` (snapshot), `quantity`, `unit_price_poisha` (snapshot), `discount_poisha`, `vat_rate_bp` (snapshot), `tax_poisha` (VAT extracted from the line total), `line_total_poisha`. Every price and rate is copied at sale time and never recalculated                                        |
| `sale_payments`    | `sale_id`, `method` enum(`cash`,`card`,`mobile_wallet`,`due`), `amount_poisha`, `reference`                                                                                                                                                                                                                           |
| `invoice_counters` | `tenant_id` PK, `next_value`. Incremented with `UPDATE … RETURNING` inside the sale transaction                                                                                                                                                                                                                       |
| `idempotency_keys` | `key`, `request_hash`, `response_status`, `response_body`, `expires_at`; unique `(tenant_id, key)`. The same key with a different request body is rejected                                                                                                                                                            |

#### Pricing and rounding rule

The price basis depends on the product's unit:

| `unit`  | `price_poisha` is the price of | Quantity is stored in |
| ------- | ------------------------------ | --------------------- |
| `piece` | 1 piece                        | pieces                |
| `gram`  | 1 kilogram (1000 g)            | grams                 |
| `ml`    | 1 litre (1000 ml)              | millilitres           |

**Prices include VAT.** `price_poisha` is the shelf price the customer pays, VAT included, as on Bangladeshi MRP labels. VAT is never added on top; it is extracted from the amount paid and stored for reporting.

Every money calculation uses integers only. Division always rounds **half up to the nearest poisha**, using one helper for non-negative integers:

```
round_half_up(a, b) = floor((a + floor(b / 2)) / b)
```

This rounds exactly at these points, and nowhere else:

1. **Line gross** (VAT included):
   - `piece`: `quantity × unit_price_poisha` (exact).
   - `gram`/`ml`: `round_half_up(quantity × unit_price_poisha, 1000)`.
   - Examples: 750 g at ৳120.00/kg = `round_half_up(750 × 12000, 1000)` = 9000 poisha (৳90.00). 333 g at ৳99.99/kg = `round_half_up(333 × 9999, 1000)` = 3330 poisha (৳33.30).
2. **Line total** = line gross − line discount. The discount is an integer number of poisha, also VAT-inclusive. This is what the customer pays for the line.
3. **Line VAT** (extracted, not added):
   - `line_net_of_vat = round_half_up(line_total × 10000, 10000 + vat_rate_bp)`
   - `tax_poisha = line_total − line_net_of_vat`
   - A product without a VAT rate has `tax_poisha = 0`.
4. **Sale totals** are plain sums of the stored line values: `total_poisha = Σ line_total`, `tax_poisha = Σ line tax`. They are never recomputed from rates, so a sale always adds up to its lines, and the VAT on the invoice equals the sum of the line VAT.

Worked VAT examples (rate 7.5% = 750 bp unless stated):

| Line total (poisha) | Rate    | Net of VAT                                  | VAT extracted |
| ------------------- | ------- | ------------------------------------------- | ------------- |
| 10750 (৳107.50)     | 750 bp  | `round_half_up(107 500 000, 10750)` = 10000 | 750           |
| 9999 (৳99.99)       | 750 bp  | `round_half_up(99 990 000, 10750)` = 9301   | 698           |
| 1000 (৳10.00)       | 1500 bp | `round_half_up(10 000 000, 11500)` = 870    | 130           |
| 1 (৳0.01)           | 750 bp  | `round_half_up(10 000, 10750)` = 1          | 0             |

The helper was checked against exact rational rounding for 200,000 random inputs. Phase 4 implements it with `bigint`-safe integers and adds unit tests for these examples and the boundary cases (exact halves, zero, rate 0, large totals).

### Phase 5: customers, dues and payments

| Table                     | Key columns                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`               | `name`, `phone` (unique per tenant, nullable), `address`, `archived_at`                                                                                                                         |
| `customer_ledger_entries` | append-only: `customer_id`, `type` enum(`sale_due`,`payment`,`adjustment`), `amount_poisha` (signed), `reference_type`, `reference_id`, `created_at`. The balance is the sum of `amount_poisha` |
| `payments`                | `customer_id`, `provider`, `amount_poisha`, `status` enum(`pending`,`succeeded`,`failed`), `provider_txn_id`; unique `(provider, provider_txn_id)`                                              |
| `payment_callbacks`       | raw callback log: `provider`, `provider_txn_id`, `payload jsonb`, `signature_valid`, `processed_at`. Duplicate callbacks are recorded and then ignored                                          |

### Phase 6: background jobs

No tables are required. Jobs live in Redis (BullMQ). Generated invoice PDFs may later add `documents` (`type`, `reference_id`, `storage_key`).

### Phase 7: dashboard, cache, rate limiting and audit logs

| Table        | Key columns                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audit_logs` | append-only: `actor_user_id`, `action` (e.g. `product.price_changed`), `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `ip`, `request_id`, `created_at` |

## Design decisions

Decided on 2026-11-04, before Phase 2.

| #   | Topic                  | Decision                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Users in several shops | Yes, through `memberships`, with a role per shop.                                                                                                                                                                                                                                                                                        |
| 2   | Sign-in identifiers    | Owners and managers sign in with email and password. Cashiers sign in with phone and password. Phones are normalized to E.164 (`+8801XXXXXXXXX`) and are globally unique when present. No OTP for now.                                                                                                                                   |
| 3   | Staff accounts         | Owners create staff accounts directly with a temporary password. Staff must change it at first login. Owners can reset staff passwords. No invite links for now.                                                                                                                                                                         |
| 4   | Token storage          | Access token in browser memory. Refresh token in an httpOnly cookie, with flags set per environment. The refresh, logout and switch-tenant endpoints are protected against CSRF.                                                                                                                                                         |
| 5   | Branches               | Supported in the data model. One default branch is created per business and hidden in the UI. Stock transfers and branch management screens are out of scope for the MVP.                                                                                                                                                                |
| 6   | Quantities and prices  | Integer quantities in `piece`, `gram` or `ml`. A product's unit is locked once it has stock movements. Sale lines snapshot the unit price and line total in poisha. Rounding follows the [pricing and rounding rule](#pricing-and-rounding-rule).                                                                                        |
| 7   | Tax                    | Optional VAT rate per product (`vat_rate_bp`). **Shop prices include VAT**; sale lines store the VAT extracted from the line total with the documented rounding rule, plus a snapshot of the rate. The Mushak format is not implemented, and invoices are not presented as Mushak-compliant. (VAT-inclusive pricing decided 2026-11-13.) |
| 8   | Offline POS            | Not supported. The POS is online only.                                                                                                                                                                                                                                                                                                   |
| 9   | Payments               | A mock provider first, then the SSLCommerz sandbox. Sandbox access is confirmed from the official docs in Phase 5.                                                                                                                                                                                                                       |
| 10  | Language               | English first. A translation layer exists from Phase 2, so UI text is not hard-coded. Bangla is added later if time allows.                                                                                                                                                                                                              |
| 11  | Deployment             | Decided in Phase 8.                                                                                                                                                                                                                                                                                                                      |

### Rules that follow from these decisions

These are implemented in Phase 2.

- **Staff identifiers by role:** a manager account needs an email; a cashier account needs a phone. Login accepts either identifier: if it contains `@` it is looked up as an email, otherwise as a normalized phone.
- **Existing people cannot be added as staff:** creating staff with an email or phone that already belongs to a user fails with 409. Adding an existing person to another shop needs their consent, which needs invite links (out of scope). A user can still belong to several shops by creating another business from their own account.
- **Who can reset a password:** an owner can reset a staff password only while the account is managed by that owner's shop (`managed_by_tenant_id`), and never an owner's. A managed account can only join another shop by starting its own business, which clears `managed_by_tenant_id` in the same transaction. So "managed by this shop" also means "belongs to no other shop", and the reset is one conditional update in the shop's own context, with no look at other shops. Otherwise, the owner of one shop could take over an account that owns or works at another shop.
- **What a reset or change does:** in one transaction it updates the password (a reset also sets `must_change_password`) and revokes all of that user's sessions and refresh tokens, which invalidates their access tokens immediately.
- **First-login gate:** while `must_change_password` is true, every API endpoint except `GET /auth/me`, `POST /auth/change-password` and `POST /auth/logout` returns 403 with code `PASSWORD_CHANGE_REQUIRED`.

### Still open

Nothing at the moment.
