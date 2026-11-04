# Database schema design

This is the planned schema. Each roadmap phase adds only the tables it needs. The column lists show the important columns, not every index and constraint.

**Phase 1 has no tables.** It ships one migration that grants table privileges to the runtime role.

## Global conventions

| Concern       | Rule                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Naming        | snake_case tables and columns in Postgres, mapped to camelCase in Prisma (`@map`/`@@map`)                                                                  |
| Keys          | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                                                                                            |
| Time          | `timestamptz` in UTC (`created_at`, `updated_at`), displayed in Asia/Dhaka                                                                                 |
| Money         | `bigint` (or `integer`) **poisha**. No `numeric` or float money columns. Column names end in `_poisha`                                                     |
| Quantity      | integer in the product's **base unit** (pieces, grams, millilitres), so loose goods stay exact                                                             |
| Tenancy       | every business table has `tenant_id uuid NOT NULL REFERENCES tenants(id)`                                                                                  |
| Composite FKs | child rows reference `(tenant_id, id)` of the parent, so a row can never point at another tenant's row                                                     |
| RLS           | every business table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, with a policy `tenant_id = current_setting('app.tenant_id')::uuid` (`USING` and `WITH CHECK`) |
| Soft delete   | `archived_at` on catalogue-style tables (products, customers). Financial records are never deleted                                                         |

## Database roles

| Role        | Used by                   | Properties                                                                                |
| ----------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `dokanflow` | Prisma migrations only    | Owns the schema and every table                                                           |
| `app_user`  | API and worker at runtime | `NOSUPERUSER NOBYPASSRLS`. DML only, via default privileges. Cannot run DDL or `TRUNCATE` |

Because `app_user` neither owns the tables nor has `BYPASSRLS`, RLS policies always apply to it. `FORCE ROW LEVEL SECURITY` also covers any future owner-role access. The API refuses to start if `DATABASE_URL` connects as a role that can bypass RLS.

## Tables by phase

### Phase 2: auth, tenants and RBAC

| Table            | Tenant-scoped                                       | Key columns                                                                                                                                  |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`        | no (it is the tenant)                               | `name`, `slug` unique, `status`, `timezone` default `Asia/Dhaka`                                                                             |
| `users`          | no (global identity)                                | `email` unique (citext), `password_hash` (argon2id), `name`, `status`                                                                        |
| `memberships`    | yes                                                 | `user_id`, `role` enum(`owner`,`manager`,`cashier`); unique `(tenant_id, user_id)`                                                           |
| `refresh_tokens` | no (looked up by hash before tenant context exists) | `user_id`, `tenant_id`, `token_hash` unique (SHA-256), `family_id`, `replaced_by_id`, `expires_at`, `revoked_at`, `created_ip`, `user_agent` |

Refresh-token reuse detection: presenting a token that is already revoked or replaced revokes every token with the same `family_id`.

### Phase 3: products and inventory

| Table             | Key columns                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branches`        | `name`, `is_default`. Every tenant gets one default branch. Stock is tracked per branch                                                                                                                                           |
| `categories`      | `name`; unique `(tenant_id, name)`                                                                                                                                                                                                |
| `products`        | `name`, `sku` unique per tenant, `barcode` unique per tenant (nullable), `unit` enum(`piece`,`gram`,`ml`), `price_poisha`, `cost_poisha`, `category_id`, `low_stock_threshold`, `archived_at`                                     |
| `stock_levels`    | `branch_id`, `product_id`, `quantity` (base units, `CHECK (quantity >= 0)`); PK `(tenant_id, branch_id, product_id)`. This is the row that sales lock                                                                             |
| `stock_movements` | append-only: `branch_id`, `product_id`, `type` enum(`opening`,`purchase`,`adjustment`,`sale`,`sale_void`,`return`), `quantity_delta`, `quantity_after`, `reference_type`, `reference_id`, `reason`, `actor_user_id`, `created_at` |

Invariant: for each `(branch, product)`, `stock_levels.quantity` equals the sum of `stock_movements.quantity_delta`. A test and a reconciliation query check it.

### Phase 4: POS and sales

| Table              | Key columns                                                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales`            | `branch_id`, `invoice_no` (unique per tenant), `customer_id` nullable, `cashier_user_id`, `status` enum(`completed`,`voided`), `subtotal_poisha`, `discount_poisha`, `total_poisha`, `paid_poisha`, `due_poisha`, `idempotency_key`; unique `(tenant_id, idempotency_key)` |
| `sale_items`       | `sale_id`, `product_id`, `quantity`, `unit_price_poisha`, `discount_poisha`, `line_total_poisha`. Prices are snapshotted at sale time                                                                                                                                      |
| `sale_payments`    | `sale_id`, `method` enum(`cash`,`card`,`mobile_wallet`,`due`), `amount_poisha`, `reference`                                                                                                                                                                                |
| `invoice_counters` | `tenant_id` PK, `next_value`. Incremented with `UPDATE … RETURNING` inside the sale transaction                                                                                                                                                                            |
| `idempotency_keys` | `key`, `request_hash`, `response_status`, `response_body`, `expires_at`; unique `(tenant_id, key)`. The same key with a different request body is rejected                                                                                                                 |

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

## Open questions that affect this design

These were raised before Phase 1 and are not yet answered. The design above assumes the defaults shown here:

1. **Branches:** assumed several per tenant, with one default. If there will only ever be one shop, `branch_id` disappears from the stock and sales tables.
2. **Loose goods:** assumed integer base units (grams, ml). If everything is sold by the piece, `unit` is always `piece`.
3. **Users in several tenants:** assumed yes (through `memberships`).
4. **Tax:** not modelled yet. VAT/SD lines would add tax columns to `sale_items` and `sales`.
