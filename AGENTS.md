# AGENTS.md

Orientation for AI coding agents working in this repository. Humans should start
with [README.md](README.md); this file exists so an agent can become productive
without reading the whole tree.

## What this is

An open-source multi-vendor marketplace engine for cash-on-delivery markets,
built on MedusaJS 2.18 and Mercur 2.3 in TypeScript. The differentiated code is
the money path: a double-entry settlement ledger keyed on courier remittance, an
anti-RTO order confirmation gate, and an encrypted digital code vault.

## Setup

```bash
bun install
docker compose up -d
cd packages/api && bunx medusa db:migrate
bun run seed:pk && bun run seed:commissions && bun run seed:digital
bun run dev
```

Ports: storefront 3100, API 3101, vendor 3102, admin 3103, Postgres 5434,
Redis 6381. They avoid the defaults deliberately; see README.

## Verification, and the standard this repo holds

```bash
cd packages/api
bun run test:settlement test:payout test:csv test:shopify test:otp test:confirmation test:digital
```

**Every test here was proven able to fail before it was trusted.** If you add a
test, break the code it covers and confirm it goes red. A green test that cannot
go red is worse than no test, because it manufactures confidence. Several bugs in
this repo's history were found exactly this way and would not have been found
otherwise.

Run the suite that covers what you touched. `test:settlement` and `test:digital`
are the two that guard money.

## Where things live

| Path | Responsibility |
|---|---|
| `packages/api/src/modules/settlement` | Double-entry COD ledger, courier reconciliation, exceptions |
| `packages/api/src/modules/order-confirmation` | Buyer confirmation before dispatch, RTO risk scoring |
| `packages/api/src/modules/digital-fulfilment` | Encrypted code vault, digital fraud gate |
| `packages/api/src/providers/payout-pakistan` | Payout rail behind Mercur's `IPayoutProvider` |
| `packages/api/src/lib/confirmation` | Orchestration: open, contact, resolve a confirmation |
| `packages/api/src/lib/digital` | Orchestration: assess fraud, allocate a code, deliver |
| `packages/api/src/lib/order-money.ts` | Safe money reads off an order. Read this before touching totals |
| `packages/api/src/api` | HTTP routes: `store/`, `vendor/`, `admin/` |
| `packages/api/src/subscribers` | Event handlers, notably on `order.placed` |
| `packages/api/src/jobs` | Scheduled jobs, notably the confirmation sweep |
| `apps/storefront` | Next.js buyer storefront |

## Traps that have already cost real time

These are load-bearing. Each one produced a plausible wrong answer rather than an
error, which is why they are listed rather than left to be rediscovered.

1. **`order.total` is computed from whichever item fields you requested.**
   Asking for `items.id` reported a PKR 156,050 order as PKR 250. Always request
   `items.*`, or no item fields at all. `items.quantity` plus `items.unit_price`
   is still not enough. Use `lib/order-money.ts`.

2. **`order_line_item.total` is not a database column.** It is computed, and
   inside an `order.placed` subscriber it reads 0 while `unit_price` holds the
   real figure. Use `lineAmount()` from `lib/order-money.ts`.

3. **Mercur emits ONE `order.placed` carrying an ARRAY of `{id}`**, one per
   seller, not one event per order. A handler written for `{id}` silently does
   nothing on multi-vendor carts.

4. **Medusa creates a customer row for guest checkouts.** `customer_id` is
   populated for everyone, so it does not distinguish a guest. Only
   `customer.has_account` does. This shipped as a fraud-gate hole.

5. **Mercur hardcodes `requires_shipping: true`** on every cart line item, so a
   digital cart still demands a shipping method. Hence the Rs 0 "Instant
   delivery" option. See `docs/known-issues.md`.

6. **`listProductCategories` omits `name` unless you pass `select`.** Without it
   every entry keys a map under `undefined` and scripts decide nothing exists.

7. **Commission rules match a product's DIRECT categories only.** There is no
   ancestor walk, so a rate attached to a department never fires on a leaf.

8. **Workflow hook handlers must return a `StepResponse`.** A plain object is
   silently discarded and the context never receives it, which looks exactly like
   a broken rule engine at runtime.

9. **Medusa substitutes a fake Redis if `REDIS_URL` is unset**, giving an
   in-memory lock and event bus. `medusa-config.ts` throws instead, on purpose.

## Conventions

- No em-dashes in user-facing copy.
- Comments explain **why**, not what. If a line encodes a decision, say what the
  alternative was and why it lost.
- Money is never mutated in place. Corrections are reversing ledger entries.
- Anything that can be delivered twice must be idempotent on a business-fact key.
- Gates fail **open** for parcels (a jammed gate costs a seller every order) and
  **closed** for digital codes (a released code cannot be recalled).

## Things not to do

- Do not weaken or bypass the fraud gate in `lib/digital/deliver.ts`.
- Do not log, return or store a decrypted digital code outside the buyer's
  reveal endpoint.
- Do not add a test without checking it can fail.
- Do not commit `.env`. Templates only.

## Known-broken

`docs/known-issues.md` is current and honest. Three issues are open, including a
free-shipping leak. Read it before assuming something is a new bug.
