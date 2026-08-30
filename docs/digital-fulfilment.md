---
title: Digital fulfilment
nav_order: 6
description: >-
  Encrypted code vault, atomic allocation and the digital fraud gate.
---

# Digital fulfilment

Selling game credits, gift cards, eSIMs, top-ups and prepaid services alongside
physical goods, with an encrypted code vault and a fraud gate in front of it.

Module: [`packages/api/src/modules/digital-fulfilment`](../packages/api/src/modules/digital-fulfilment)
Tests: `bun run test:digital` (44 checks)

Digital changes three things about a marketplace. Returns go to zero, because
nothing travels. Purchase frequency rises by an order of magnitude, because
top-ups and bills are weekly rather than monthly. And it is the cheapest way to
get a buyer's first prepaid transaction in a market where almost everyone pays
cash on delivery.

The constraint worth stating up front: **digital is 100% prepaid.** There is no
cash on delivery for a code, so digital cannot ship before a payment rail exists.

---

## 1. Some categories are lead generation, not commerce

This is the part worth being blunt about, because the code is the easy half.

**Insurance is a licensed activity.** Selling or arranging insurance in Pakistan
requires SECP registration as a corporate insurance agent or broker. A
marketplace cannot list policies and take a commission the way it lists phone
cases. Takaful, the Shariah-compliant form, matters commercially here and
carries its own requirements.

**Banking products are SBP-regulated.** Credit cards, personal loans and account
opening cannot be sold by us. The workable model is Direct Selling Agent or
referral.

**So both are lead generation, not commerce**, and that changes the money flow
entirely:

- The buyer pays **nothing**. The order total is zero.
- We capture a consented enquiry and pass it to a licensed partner.
- **The partner pays us**, per qualified lead or per issued policy, weeks later
  and contingent on them closing it.

That inverts the settlement model, which assumes we collect money from a buyer
and deduct commission before paying a seller. Here we receive money from a
partner and owe nobody. It needs its own receivable, not a commission rate,
which is why the seeded commission for such a department is **0%** rather than
a number that would quietly be wrong.

**Before any of this ships:** counsel confirms whether we can operate as an
introducer without registration, and every partner relationship is papered. Also
note the personal data: an insurance enquiry carries CNIC, vehicle and health
details. That is a materially higher bar than an ecommerce address.

The workable pattern is to keep such categories live for browsing, implement
them as consented enquiry forms with one licensed partner each, and never
describe the platform as selling insurance.

---

---

## 2. Services without building a scheduling engine

Real service marketplaces need dispatch, availability, technician calendars and
rescheduling. That is the restaurants-vertical problem again and it is a
multi-month build.

**Use the voucher pattern instead.** The buyer prepays for "AC service, up to 2
units, Rs 2,500". The vendor receives the order and calls them within a stated
window to arrange a time. No calendar, no availability model, no dispatch.

It is not as slick, and it is enough to launch with. The product type is
`service_booking`, and it is the one digital-ish type that **still goes through
buyer confirmation**, because someone is travelling to the buyer's house and the
address matters.

---

---

## 3. How it works in the system

### Categories are for browsing. Product types are for fulfilment.

Ten departments were added, each with leaves. The leaves matter: Mercur's
commission engine matches a product's **direct** categories with no ancestor
walk, so a rate attached to a department would never fire.

Five product types encode how a thing is delivered, which is the only
distinction the code needs to act on:

| Type | Delivery | Needs from buyer |
|---|---|---|
| `digital_code` | Instant, from a stock of codes we hold | nothing |
| `digital_topup` | Vendor or operator API credits an account | game ID, phone number |
| `voucher` | Redeemed in person at a merchant | nothing, but needs expiry and single-use redemption |
| `service_booking` | Provider phones the buyer | preferred time window |
| `lead` | Nothing is delivered; an enquiry is passed on | consent, plus whatever the partner requires |

This pays off immediately: **Mercur can already scope a commission rate by
product type**, so "every top-up at 1.5% whichever operator" is configuration.

### Commission has to be much lower, and that is arithmetic not generosity

| Department | Rate |
|---|---|
| Mobile load and bundles | 1.5% |
| Bill payments | 1% |
| Game credits | 4% |
| Entertainment | 6% |
| Gift cards and vouchers | 8% |
| Software | 10% |
| eSIM, learning, home services | 15% |
| Insurance and financial | 0%, see above |

A game-credit reseller works on 3-8% gross. Charging them the physical 8% would
exceed their entire margin, and the failure mode is not complaints, it is
silence: they simply never list. Bill payments should really be a fixed fee per
transaction rather than a percentage; the engine is percentage-only today, which
is a gap worth recording.

### The one thing that genuinely fought back

**Mercur hardcodes `requires_shipping: true` on every cart line item**, in its
store add-to-cart route. Not derived from the product, not from the offer, not
from inventory. Verified by direct test: a product with no shipping profile and
an inventory item flagged non-shippable still produced `requires_shipping: true`
and checkout was refused with "No shipping method selected but the cart contains
seller items that require shipping."

Two ways out:

1. Shadow the route in our project and set the flag properly. Cleaner, but it
   forks a core Mercur route and we inherit that fork at every upgrade.
2. Give digital items something free to select.

**Option 2 was taken**, and it turns out better than a workaround deserves to
be. Each seller gets an **"Instant delivery" shipping option at Rs 0**, so
checkout shows "Instant delivery, Rs 0" — a line that reads as a feature rather
than a hack. Mixed carts work naturally, because Mercur already picks a shipping
method per seller. Verified: a digital-only cart completed at exactly the item
price with nothing added.

Revisit option 1 only if the fake shipping method becomes a problem downstream.

### What already works unchanged

- Offers, pricing and multi-vendor competition on the same digital SKU
- Commission resolution, including per-seller deals
- The settlement ledger's **prepaid** path, which is the simple one
- CSV bulk import for catalogue loading
- Search, categories and the storefront

### What changed

- `seed-digital.ts`: the categories, types, rates and delivery options above
- Order confirmation now **skips digital-only orders**. This was load-bearing,
  not cosmetic: until a payment provider identifies itself the risk scorer
  defaults every order to COD, so a game top-up would have been held behind the
  dispatch gate waiting for a buyer confirmation that made no sense. Mixed
  orders and `service_booking` are still confirmed.

---

---

## 4. The code vault and fraud gate

Built 2026-08-13. `packages/api/src/modules/digital-fulfilment`.

### The vault

Codes are sealed with AES-256-GCM under `PK_VAULT_KEY`, which is deliberately
**not** `JWT_SECRET`: session secrets get rotated, shared and pasted into
terminals, and the key protecting unsold inventory should not have that blast
radius. Missing key throws in production rather than falling back, because a
silent fallback would mean production codes encrypted with a value in the source
history.

Stored per code: ciphertext, IV, auth tag, a keyed fingerprint for duplicate
detection, and the last four characters for vendor reconciliation. Nothing else.
GCM rather than CBC because it authenticates: a tampered record fails to decrypt
rather than yielding a plausible wrong code we would hand to a customer.

The fingerprint is keyed per seller, because two vendors legitimately holding the
same code is a real reseller-chain situation and not our place to reject.

### Allocation, and the bug that shaped it

The first version read the oldest available code, re-read it to confirm, then
wrote, relying on callers to hold a Redis lock. A concurrency test fired twenty
simultaneous buyers and **all twenty received the same code.**

That is not a bug in the lock, it is a bug in where the lock lived. A lock held
by the caller is a lock the next caller can forget, and the first thing to forget
it was the test written minutes later. Safety that depends on every future caller
remembering is not safety.

Allocation is now a single atomic statement using `FOR UPDATE SKIP LOCKED`, the
primitive built for exactly this: each concurrent transaction locks a different
row and skips the taken ones, so twenty buyers take twenty codes with no
coordination at all. Re-running the same test gives twenty distinct codes.

Two further guards: a unique index on `allocated_to_line_id`, so a double write
to one line fails in the database; and a re-entrancy check, so a retried event
returns the code already allocated rather than burning a second.

### The fraud gate, and the asymmetry

**For a parcel, doubt ships. For a code, doubt holds.** A released code cannot be
recalled, cancelled in transit or refused at the door, so the loss is total and
immediate while the counter-cost is a real customer waiting fifteen minutes.
Everything here is tighter than its RTO equivalent, and the default on
uncertainty is HOLD.

Signals: unverified buyer, orders per hour and per day on the number, daily
spend, distinct top-up targets (the mule pattern), large first purchase, and
prior refusals. Prior confirmed fraud is not a score input, it is an answer.

One rule worth stating separately: **refusal requires evidence, not merely an
absence of trust.** Being new and unverified is not misconduct and the buyer can
fix it, so the worst that should happen is a wait. An early version scored
"guest" plus "large first purchase" at exactly the refusal threshold and turned
away a plausible new customer buying an expensive gift card, which is the most
valuable order type on the site.

### The bug only a live test could find

Unit tests modelled a guest as `customer_id: null` and passed. Over HTTP, every
guest digital purchase was **auto-released**.

**Medusa creates a customer row for guest checkouts too.** So `customer_id` is
populated for everyone and `!customer_id` never fires. Only
`customer.has_account` separates a guest from a signed-in buyer. The delivery now
stores `buyer_verified`, captured at order time, and the test models a guest the
way Medusa actually shapes one.

### Refunds hang on one timestamp

`first_revealed_at`. An unrevealed code goes back to stock and the buyer is
refunded; a revealed one cannot, because there is no way to know whether it has
been spent. `releaseCode` throws on a delivered code, and the reveal endpoint
says so to the buyer in plain words at the moment it becomes true.

The reveal is counted **before** the code is returned. If the response is lost we
would rather have wrongly marked it seen than wrongly refunded a code the buyer
already read.

### Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /vendor/digital-codes` | seller | Upload a batch of codes |
| `GET /vendor/digital-codes` | seller | Stock and audit trail, masked only |
| `GET /store/digital-delivery/:token` | none | The buyer reads their code |
| `GET /admin/digital-deliveries` | admin | The fraud review queue |
| `POST /admin/digital-deliveries/:id/review` | admin | Release or refuse a hold |

Releasing calls `fulfil` directly rather than re-scoring, so the machine cannot
silently overturn the human it called in.

### Verified

`bun run test:digital` — 44 checks, each proven able to fail by breaking the code
it covers: read-then-write allocation (three checks go red), plaintext storage,
tamper detection, and the fraud gate.

Live, against a running stack: a verified buyer's PKR 1,750 order cleared, took
one code from the vault and left 24; the buyer read the code once and the order
became non-refundable; a guest purchase of the same item was **held** with the
reasons attached; an agent released it from the ops queue and stock dropped
again. A second seller was refused write access to another seller's offer.

### Still not built

- **Notifying the buyer.** Delivery works, but nothing sends them the link yet.
  The WhatsApp driver from the confirmation work is the obvious channel.
- **Auto-refund** on `out_of_stock` and `refused`. Both flag for ops today.
- **Vendor SLA enforcement** on top-ups. The deadline is recorded, nothing acts
  on it.
- **Vendor fulfilment API** for top-ups, so vendors are not pasting into a
  dashboard.
- **Key rotation.** Re-encrypting the vault under a new key has no runbook.
