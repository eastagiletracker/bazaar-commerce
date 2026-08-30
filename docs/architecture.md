---
title: Architecture
nav_order: 3
description: >-
  How the money path is deliberately separated from the order path.
---

# Architecture

How the pieces fit, and why the money path is deliberately separate from the
order path.

---

## The shape of the problem

Stock ecommerce software models one money flow: authorize a card, capture it,
pay the seller. Everything downstream assumes the money is already yours.

Cash on delivery breaks that at every step:

- There is no authorization, so there is nothing to capture.
- The money arrives days later, from a courier rather than the buyer.
- It arrives **in a batch**, covering many orders at once, sometimes short.
- Between a fifth and two fifths of parcels never deliver at all.

So the money path cannot hang off the payment lifecycle. It has to hang off
**courier remittance**, which is a separate, slower, messier timeline. That is
the central architectural decision here and it explains most of the rest.

---

## Layers

```
                    ┌─────────────────────────────────────┐
   buyer  ───────►  │  storefront (Next.js, 3100)         │
                    │  mobile-customer (Expo)             │
                    └──────────────┬──────────────────────┘
                                   │  Store API
                    ┌──────────────▼──────────────────────┐
   seller ───────►  │  API: Medusa 2.18 + Mercur 2.3      │  ◄─── admin (3103)
   vendor panel     │  (3101)                             │
   (3102)           │                                     │
                    │  ┌───────────────────────────────┐  │
                    │  │ Mercur: sellers, offers,      │  │
                    │  │ commission, orders, payouts   │  │
                    │  └───────────────────────────────┘  │
                    │  ┌───────────────────────────────┐  │
                    │  │ THIS PROJECT                  │  │
                    │  │  settlement    (the ledger)   │  │
                    │  │  order-confirmation (anti-RTO)│  │
                    │  │  digital-fulfilment (vault)   │  │
                    │  │  payout-pakistan (rail)       │  │
                    │  └───────────────────────────────┘  │
                    └──────┬───────────────────┬──────────┘
                           │                   │
                   PostgreSQL 5434       Redis 6381
                                    (queues, locks, OTP, cache)
```

Mercur supplies the marketplace primitives: sellers, offers, per-seller order
splitting, commission rules, and a pluggable payout module. This project supplies
the layer underneath the money.

---

## The money path

```
order placed
     │
     ├─ nothing is posted to the ledger yet
     │  (an order is not revenue, and a COD order is not even a receivable
     │   until someone has the cash)
     │
     ├─ order-confirmation opens, scores RTO risk
     │     └─ buyer confirms  ──► dispatch released
     │        buyer declines  ──► cancelled, settlement marked cancelled
     │
     ├─ seller dispatches (gated: 409 until confirmed)
     │
     ├─ courier delivers, collects cash
     │
     ├─ courier remits, days later, in a batch file
     │     └─ each line matched on airway bill
     │           matched      ──► balanced journal entry, order becomes payable
     │           short        ──► exception queue, NOT posted as an adjustment
     │           unknown AWB  ──► exception queue
     │           double paid  ──► idempotency key rejects the second post
     │
     └─ payout run pays the seller net of commission, tax and withholding
```

Three decisions in that flow are load-bearing:

**Placement posts nothing.** An order is not money. Posting on placement would
make the ledger a forecast rather than a record.

**A mismatched remittance is a dispute, not an adjustment.** If the courier pays
less than the order was worth, the difference is not silently written off. It
becomes an exception a human owns, because the alternative is a ledger that
quietly absorbs losses.

**Collected-but-unremitted cash is not payable.** The courier has the money. Until
they hand it over we do not owe the seller, however delivered the parcel is.

---

## Modules

### `settlement`
Double-entry ledger. Seven models: ledger accounts, entries and lines; per-order
settlement; courier remittances and their lines; exceptions.

Refuses to write unless debits equal credits, and is a no-op if an entry with the
same idempotency key already exists. Both guards matter: courier files get re-sent
and webhooks get re-delivered, and a ledger that double-posts is worse than one
that never posted.

Handles the tax split: provincial sales tax on commission (a service sold to the
seller) and income-tax withholding from the seller's proceeds.

### `order-confirmation`
Holds a parcel until the buyer confirms. A state machine: pending → contacted →
escalated to a human → confirmed or cancelled. Only `confirmed` releases dispatch,
enforced in API middleware so the vendor app and the Shopify connector cannot
route around it.

Fails **open**. If the module throws, dispatch proceeds. A return costs a seller
one parcel's freight; a jammed gate costs them every order they have.

### `digital-fulfilment`
An encrypted vault of sellable codes plus a delivery ledger. Codes are sealed
with AES-256-GCM under a key separate from the session secret, and allocation is
a single atomic statement using `FOR UPDATE SKIP LOCKED`.

Fails **closed**, the opposite of the parcel gate, because a released code cannot
be recalled, cancelled in transit or refused at the door.

### `payout-pakistan`
Implements Mercur's four-method `IPayoutProvider` behind a driver interface.
Stripe Connect does not serve Pakistan-registered businesses, and the module
accepts exactly one provider, so this replaces it wholesale.

---

## Event flow

`order.placed` is the hinge. Two subscribers listen:

- `order-placed-confirmation` opens an RTO confirmation for physical orders.
- `order-placed-digital` opens a delivery for digital lines and runs the fraud
  gate.

Mercur emits **one** `order.placed` carrying an **array** of `{id}`, one per
seller. A handler written for the usual single payload silently does nothing on
multi-vendor carts, which are exactly the orders where it matters most.

A scheduled sweep drives the confirmation state machine every five minutes:
contact, retry, escalate, then let policy decide.

---

## Data stores

**PostgreSQL** holds everything durable. **Redis** is not optional: it backs the
job queue, the event bus, distributed locks and OTP state. `medusa-config.ts`
throws when `REDIS_URL` is unset rather than letting Medusa substitute an
in-memory stand-in, because a payout queue that does not survive a restart is
worse than one that refuses to start.

---

## Ports

Chosen to avoid the defaults, which collide with common local services. Notably
Mercur's panels default to port 7000, which macOS AirPlay Receiver occupies,
returning a bare 403 that looks like a broken build.

| Service | Port |
|---|---|
| Storefront | 3100 |
| API | 3101 |
| Vendor panel | 3102 |
| Admin | 3103 |
| PostgreSQL | 5434 |
| Redis | 6381 |

---

## Further reading

- [COD settlement](cod-settlement.md)
- [Order confirmation](order-confirmation.md)
- [Digital fulfilment](digital-fulfilment.md)
- [Multi-vendor orders](multi-vendor-orders.md)
- [AGENTS.md](../AGENTS.md), which lists nine traps that have already cost real time
