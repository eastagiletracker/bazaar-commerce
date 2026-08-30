---
title: Multi-vendor orders
nav_order: 7
description: >-
  What happens when one cart spans several vendors.
---

# One cart, several vendors

What happens when one cart spans several vendors, measured against a running
stack rather than assumed.

---

## 1. What happens today, measured

A real three-vendor order placed against the running stack:

| | |
|---|---|
| Items in cart | 3, one per vendor |
| Orders created | **3** child orders under one order group |
| Shipping charged | **3 x Rs 250 = Rs 750** |
| Parcels | 3, from 3 locations, on 3 couriers |
| COD collections at the door | **3**, on 3 different days |
| Confirmation messages sent | **3**, to the same phone number |

Mercur already splits the cart correctly: one order per seller, each with its
own money, commission and settlement row. The plumbing is not the problem. The
problem is that all of that is invisible to the buyer, who placed **one** order.

---

## 2. This is a COD problem wearing a shipping costume

Amazon splits shipments constantly and nobody minds, because the buyer has
already paid. The parcels simply turn up.

Here they have not paid. A split order means the buyer must:

1. be home three times,
2. have the right cash three times, and
3. **recognise three partial amounts as belonging to one order they placed.**

The third is what actually costs money. The buyer ordered Rs 3,000 of goods. A
rider arrives with a bill for Rs 1,100. Nothing in the buyer's memory matches
Rs 1,100, so they hesitate, and a meaningful share of them refuse.

**Split COD mechanically increases RTO**, and RTO is already the single largest
cost line in the business. That is the real reason to care, and it is why the
answer is not simply "show nicer tracking".

---

## 3. Options

### A. Leave it. Vendors ship independently.

Costs nothing, needs no build, and is what the system does today.

Worth saying plainly: **at launch most carts will be single-vendor anyway.** With
a thin catalogue and few sellers per SKU, multi-vendor baskets are rare. Building
elaborate machinery for a problem that affects 5% of early orders is the wrong
order of work.

### B. Consolidation hub. Vendors ship to us, we ship one parcel.

One delivery, one COD collection, one tracking number. Genuinely the best buyer
experience.

**Think hard before choosing it.** It turns a marketplace into a warehouse
business. A commission advantage over an incumbent is structurally sustainable
only while you carry no warehouses and no fleet; a hub consumes that advantage,
adds a shipping leg and 1-2 days,
and puts the platform in inventory custody with the liability that brings.

### C. One courier contract, we book on the vendor's behalf.

The vendor still ships from their own premises; nothing is consolidated. But the
label is booked through us, on our negotiated account.

This is the highest-leverage move available:

- **One COD remittance stream** instead of one per vendor, which is exactly what
  the settlement ledger already models.
- **Volume pricing.** Our rate across all vendors beats what any single small
  seller negotiates alone, so we can charge the buyer less than Rs 250 per
  parcel and still cover cost.
- **One tracking experience** under our brand rather than five courier portals.
- Worth asking PostEx and Trax directly whether parcels for one consignee
  arriving at the same hub can be merged for the final leg. If yes, we get most
  of the consolidation benefit with none of the warehouse.

### D. One vendor per order.

Forbid multi-vendor carts entirely. **at least one large delivery marketplace does exactly this** and nobody
considers it broken: you cannot order from two restaurants at once.

Eliminates the problem completely, at the cost of basket size. Entirely
defensible for launch, and much easier to relax later than to impose later.

---

## 4. Two defects this exposed

### Three confirmation messages to one buyer

`order.placed` fires once per child order, so a three-vendor cart opens three
separate confirmations against the same phone number. The sweep job would send
that buyer three WhatsApp messages within five minutes, each asking them to
confirm a different amount, for what they experienced as one purchase.

Verified: three rows in `pk_order_confirmation`, same phone, three amounts.

The fix depends on a business decision, which is why it is not already made:

- **Confirm per cart** (recommended). One message: "confirm your order of
  Rs 3,000 from 3 sellers." Releases all three orders together. Simpler for the
  buyer and cheaper for us.
- **Confirm per vendor.** Correct if vendors ship far enough apart in time that
  one confirmation is stale by the time the third ships, but it means three
  messages and it will annoy people.

If we go per cart, the confirmation should key on the **order group** rather than
the order, and the dispatch gate should ask "is the group released?".

### The Rs 0 "Instant delivery" option leaks onto physical products

Introduced by the digital-products work. Every seller was given a Rs 0 option so
digital carts could clear Mercur's hardcoded `requires_shipping: true`. But
Mercur filters shipping options by fulfilment set and delivery address only,
never by shipping profile, so the option shows on **physical** products too. A
buyer can pick "Instant delivery, Rs 0" on a pair of shoes and we eat the
courier cost.

Diagnosis so far, so nobody has to repeat it:

- The intended fix is a `cart_kind = digital` rule on the option, fed by a
  `setShippingOptionsContext` hook. That hook exists at
  `src/workflows/hooks/shipping-options-context.ts`.
- **The hook must return a `StepResponse`.** A plain object is silently
  discarded, so the hook fires, computes the right answer, and the context never
  receives it. This looks identical to a broken rule engine and only the
  typechecker caught it.
- With that fixed, the rule works on the listing path and physical carts
  correctly stop seeing the option. But **cart completion re-lists seller
  shipping options through a path the hook does not reach**, so a digital cart
  then fails with "No shipping method selected".
- The rule is therefore currently OFF and the leak is open. Nothing is in
  production, but this must close before anything is.
- The likely better shape is a zero **price rule** on the normal shipping
  options rather than a separate option whose visibility must be managed in two
  places.

---
