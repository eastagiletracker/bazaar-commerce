# Bazaar Commerce

**An open-source multi-vendor marketplace engine for cash-on-delivery markets.**
Built on [MedusaJS](https://medusajs.com) 2.18 and [Mercur](https://github.com/mercurjs/mercur) 2.3, in TypeScript.

[![CI](https://github.com/Cubitrek/bazaar-commerce/actions/workflows/ci.yml/badge.svg)](https://github.com/Cubitrek/bazaar-commerce/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Built on Medusa](https://img.shields.io/badge/built%20on-MedusaJS%202.18-000000.svg)](https://medusajs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6.svg)](https://www.typescriptlang.org/)

Most ecommerce software assumes the customer has already paid. In Pakistan,
Bangladesh, Egypt, Nigeria and much of South and Southeast Asia, roughly **95% of
orders are cash on delivery** — a courier collects the money days later, remits it
in a batch, sometimes short, and a fifth to two fifths of parcels come back
undelivered. Every assumption behind "capture the payment, then pay the seller"
is wrong in those markets.

Bazaar Commerce is the missing layer: a double-entry settlement ledger keyed on
*courier remittance* rather than payment capture, plus the operational machinery
that keeps cash-on-delivery from losing money.

---

## What it gives you that a stock marketplace does not

### Cash-on-delivery settlement ledger
A double-entry ledger where every rupee that moves posts a balanced journal
entry. Orders become payable only when a courier actually remits, not when a
parcel is marked delivered. Ingests courier remittance files, auto-matches on
airway bill, and routes short payments, unknown AWBs, double payments and
partial collections to an explicit exception queue instead of silently
absorbing them. Handles provincial sales tax on commission and income-tax
withholding.

→ [`packages/api/src/modules/settlement`](packages/api/src/modules/settlement) · [docs](docs/cod-settlement.md)

### Order confirmation before dispatch (anti-RTO)
Return-to-origin runs 20–40% on cash on delivery and the seller pays freight
both ways. This holds a parcel until the buyer confirms they still want it, over
WhatsApp with an SMS fallback and a one-tap link.

Risk-scored, so most orders are never delayed. The load-bearing decision is that
**silence is not refusal**: most buyers ignore messages, so cancelling every
quiet buyer would destroy far more good orders than the returns it prevents.
Only in the high-risk band does staying silent cancel the order.

→ [`packages/api/src/modules/order-confirmation`](packages/api/src/modules/order-confirmation) · [docs](docs/order-confirmation.md)

### Digital fulfilment: encrypted code vault and fraud gate
Sell game credits, gift cards, eSIMs and top-ups alongside physical goods. Codes
are sealed with AES-256-GCM under a key separate from the session secret and are
never written to a column, a log or an error message. Allocation is a single
atomic `FOR UPDATE SKIP LOCKED` claim, so twenty simultaneous buyers take twenty
different codes.

The fraud gate inverts the parcel logic: **for a parcel, doubt ships; for a code,
doubt holds**, because a released code cannot be recalled, cancelled in transit or
refused at the door.

→ [`packages/api/src/modules/digital-fulfilment`](packages/api/src/modules/digital-fulfilment) · [docs](docs/digital-fulfilment.md)

### A payout rail that works where Stripe Connect does not
Stripe Connect does not serve Pakistan-registered businesses, and the same is
true across much of the region. This ships a pluggable `IPayoutProvider`
implementation behind a driver interface, with a mock driver that models pending
KYC and failed disbursements rather than pretending every payout succeeds.

→ [`packages/api/src/providers/payout-pakistan`](packages/api/src/providers/payout-pakistan)

### Phone-first authentication
The mobile number is the identity in these markets, not email. OTP sign-in with
hashed codes, timing-safe comparison, per-number and hourly rate limits, and
guest checkout that does not create duplicate customers.

→ [`packages/api/src/lib/otp`](packages/api/src/lib/otp)

---

## Quick start

Requires Node 20+, [bun](https://bun.sh) and Docker.

```bash
git clone https://github.com/Cubitrek/bazaar-commerce.git
cd bazaar-commerce
bun install
docker compose up -d
```

```bash
cp packages/api/.env.template packages/api/.env
cp apps/admin/.env.template apps/admin/.env
cp apps/vendor/.env.template apps/vendor/.env
cp apps/storefront/.env.template apps/storefront/.env
```

```bash
cd packages/api
bunx medusa db:migrate
bun run seed:pk && bun run seed:commissions && bun run seed:digital
bunx medusa user -e admin@bazaar.pk -p 'ChangeMe#2026'
```

```bash
bun run dev
```

| Service | URL |
|---|---|
| Storefront | http://localhost:3100 |
| API | http://localhost:3101 |
| Vendor panel | http://localhost:3102/seller |
| Admin | http://localhost:3103/dashboard |

Full walkthrough in [docs/quickstart.md](docs/quickstart.md).

---

## Verification

**233 assertions across seven suites.** Every one was **proven able to fail** by
deliberately breaking the code it covers. A green test that cannot go red proves
nothing, so each was checked against a mutation before being trusted.

All of them pass on a clean database, which is how CI runs them, and every
suite gates the build.

```bash
cd packages/api
bun run test:settlement    # 34  double-entry ledger, courier reconciliation, tax
bun run test:payout        # 26  payout provider and its wiring
bun run test:csv           # 38  catalogue import validation, variant axes
bun run test:shopify       # 29  token rotation, throttling, HMAC verification
bun run test:otp           # 22  OTP brute force, SMS pumping, expiry
bun run test:confirmation  # 40  RTO risk bands, the dispatch gate, tokens
bun run test:digital       # 44  code encryption, concurrent allocation, fraud gate
```

Plus end-to-end smoke tests against a running stack:

```bash
node scripts/smoke-checkout.mjs   # a real cash-on-delivery order
node scripts/smoke-digital.mjs    # a real digital purchase and code reveal
```

---

## Architecture

```
packages/api                      Medusa + Mercur backend (3101)
  src/modules/settlement          Double-entry COD ledger, courier reconciliation
  src/modules/order-confirmation  Buyer confirmation before dispatch (anti-RTO)
  src/modules/digital-fulfilment  Encrypted code vault and digital fraud gate
  src/providers/payout-pakistan   Payout rail (Mercur IPayoutProvider)
  src/lib/csv-import              Bulk catalogue importer
  src/lib/shopify                 Shopify OAuth, token rotation, throttling
apps/storefront                   Next.js buyer storefront (3100)
apps/vendor                       Seller panel (3102)
apps/admin                        Marketplace admin (3103)
apps/mobile-customer              Expo buyer app
apps/mobile-vendor                Expo seller app
```

See [docs/architecture.md](docs/architecture.md) for how the pieces fit and why
the money path is separate from the order path.

---

## Documentation

| Document | What it covers |
|---|---|
| [Quick start](docs/quickstart.md) | Running the stack locally |
| [Architecture](docs/architecture.md) | Modules, data flow, the money path |
| [COD settlement](docs/cod-settlement.md) | The ledger, remittance matching, exceptions |
| [Order confirmation](docs/order-confirmation.md) | Anti-RTO gate, risk bands, policy |
| [Digital fulfilment](docs/digital-fulfilment.md) | Code vault, fraud gate, product types |
| [Multi-vendor orders](docs/multi-vendor-orders.md) | How one cart across vendors behaves |
| [Known issues](docs/known-issues.md) | Honest list of what is broken or unfinished |
| [Roadmap](ROADMAP.md) | What is built, what is not, what is blocked |
| [AGENTS.md](AGENTS.md) | Orientation for AI coding agents |
| [llms.txt](llms.txt) | Machine-readable index for language models |

---

## Status

**Pre-production.** The engine and its tests are real and verified; the
commercial integrations are not, because they need signed contracts rather than
code:

- No payment service provider is contracted, so payouts run against a mock driver.
- No SMS or WhatsApp gateway is contracted, so messages print to the console.
- No courier contract, so remittance formats are modelled from documented specs.

[docs/known-issues.md](docs/known-issues.md) lists every defect we know about,
including three that are open. We would rather publish that list than have you find it.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first,
and [SECURITY.md](SECURITY.md) before reporting anything that touches money,
codes or authentication.

## Licence

[Apache-2.0](LICENSE). Built on the MIT-licensed Medusa and Mercur projects; see
[NOTICE](NOTICE) for attribution.

---

Created and maintained by [Faizan Ali Khan](https://github.com/phyxan) at
[Cubitrek](https://cubitrek.com). See [AUTHORS](AUTHORS).
