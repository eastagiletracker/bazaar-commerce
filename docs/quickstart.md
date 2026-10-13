---
title: Quick start
nav_order: 2
description: >-
  Run the whole marketplace locally in about ten minutes.
---

# Quick start

Getting the whole marketplace running locally: storefront, API, vendor panel,
admin, and seeded data you can actually place an order against.

Roughly ten minutes, most of it install.

---

## Requirements

- **Node 20+**
- **[bun](https://bun.sh)** — the package manager and script runner
- **Docker** — for PostgreSQL and Redis (OrbStack works fine)

---

## 1. Install

```bash
git clone https://github.com/Cubitrek/bazaar-commerce.git
cd bazaar-commerce
bun install
docker compose up -d
```

`docker compose` brings up PostgreSQL on **5434** and Redis on **6381**. Those
are deliberately not the defaults, so they will not collide with anything else
you have running.

## 2. Configure

```bash
cp packages/api/.env.template packages/api/.env
cp apps/admin/.env.template apps/admin/.env
cp apps/vendor/.env.template apps/vendor/.env
cp apps/storefront/.env.template apps/storefront/.env
```

The defaults work for local development. Two notes:

- **Redis is required.** Without it Medusa silently substitutes an in-memory
  event bus and lock, so this project's config throws instead. A payout queue
  that does not survive a restart is worse than one that refuses to start.
- **`PK_VAULT_KEY`** encrypts digital codes. Development falls back to a fixed
  key; production refuses to start without one. Generate a real one with
  `openssl rand -base64 32`.

## 3. Migrate and seed

```bash
cd packages/api
bunx medusa db:migrate
bun run seed:pk           # region, currency, sellers, catalogue, shipping
bun run seed:commissions  # per-category commission structure
bun run seed:digital      # digital categories, product types, rates
bun run seed:digital-demo # a digital product with 25 codes in the vault
```

## 4. Create an admin user

```bash
bunx medusa user -e admin@example.com -p 'ChangeMe#2026'
```

## 5. Run everything

```bash
bun run dev
```

| Service | URL |
|---|---|
| Storefront | http://localhost:3100 |
| API | http://localhost:3101 |
| Vendor panel | http://localhost:3102/seller |
| Admin | http://localhost:3103/dashboard |

Seeded sellers are `karachi@bazaar.pk`, `lahore@bazaar.pk` and
`islamabad@bazaar.pk`, password `supersecret`. These are local development seeds
with a published password. Never run this seed against anything reachable.

**Sellers authenticate as the `member` actor.** Using `user` or `seller` returns
a token with an empty `actor_id` that then 401s on every vendor route, with no
useful error. This costs everyone an hour exactly once.

---

## Prove it works

### A cash-on-delivery order, end to end

```bash
PUBKEY=$(docker exec pkmkt_postgres psql -U pkmkt -d pkmkt -t -A \
  -c "select token from api_key where type='publishable' limit 1;") \
  node scripts/smoke-checkout.mjs
```

Drives region → cart → line item → address → shipping → payment → order, and
asserts every money value is denominated correctly.

### The anti-RTO confirmation gate

After placing an order, see the buyer's confirmation link:

```bash
cd packages/api && bun run confirm:link
```

In development no SMS or WhatsApp gateway is contracted, so messages print to
the console and this script regenerates the link. Open it and confirm, then try
dispatching from the vendor panel before and after: the fulfilment endpoint
returns **409** until the buyer says yes.

### A digital purchase and code reveal

```bash
PUBKEY=... OFFER=<offer id from seed:digital-demo> node scripts/smoke-digital.mjs
cd packages/api && bun run digital:link
```

The reveal link returns the decrypted code exactly once and marks the order
non-refundable at that moment.

---

## Run the tests

```bash
cd packages/api
bun run test:settlement    # 34
bun run test:payout        # 26
bun run test:csv           # 38
bun run test:shopify       # 29
bun run test:otp           # 22
bun run test:confirmation  # 40
bun run test:digital       # 44
```

233 assertions, all of which pass on a clean database.

Each suite was proven able to fail by deliberately breaking the code it covers,
which is the standard this repository holds. See
[CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Common problems

**Panels load but login silently does nothing.**
The `.env` was not copied. Both panels default to Medusa's stock port 9000; the
dashboard renders fine while every request fails.

**A bare 403 from the vendor or admin panel.**
On macOS, AirPlay Receiver occupies port 7000, which is Mercur's default panel
port. This project sets the ports explicitly in `medusa-config.ts` for that
reason. If you changed them back, that is why.

**`REDIS_URL is not set` on boot.**
Deliberate. Start Docker, or point it at a real Redis.

**Storefront type errors.**
121 of them, inherited from the upstream Mercur starter, mostly a React types
mismatch. The app builds anyway because `next.config.ts` sets
`ignoreBuildErrors: true`. Documented in
[known-issues.md](known-issues.md); please do not add more.

---

## Next

- [Architecture](architecture.md) — how the money path is separated from the order path
- [AGENTS.md](../AGENTS.md) — nine traps that have already cost real time
- [Known issues](known-issues.md) — what is currently broken
