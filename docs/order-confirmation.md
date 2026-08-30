---
title: Order confirmation
nav_order: 5
description: >-
  Holding a parcel until the buyer confirms, to attack return-to-origin.
---

# Order confirmation before dispatch

Holding a cash-on-delivery parcel until the buyer confirms they still want it.

Module: [`packages/api/src/modules/order-confirmation`](../packages/api/src/modules/order-confirmation)
Tests: `bun run test:confirmation` (40 checks)

---

## Why

RTO (return to origin) runs 20-40% on Pakistani cash on delivery, and the seller
pays freight in both directions. A returned parcel has cost them two legs of
shipping and earned nothing. Asking the buyer "do you still want this?" before
the box moves is the cheapest lever against that, and it is worth more to a
seller than several points of commission.

It protects us too. An RTO parcel produces no commission but still consumes a
courier booking, a support ticket and a slot in the settlement ledger.

## The one decision that matters

**Most buyers will not reply to anything.** Any flow that treats silence as
refusal destroys far more good orders than the RTO it prevents.

So silence is not refusal by default. Each order gets a policy at creation:

| Policy | Outreach | If the buyer never answers |
|---|---|---|
| `auto` | none | n/a, confirmed on creation |
| `verify` | yes | **ships anyway** |
| `strict` | yes | **cancelled** |

Only when risk is high enough does shipping become the more expensive mistake.
That threshold is the whole design, and it is the number to revisit first once
real RTO data exists.

## Risk scoring

`packages/api/src/modules/order-confirmation/risk.ts`, a pure function so it is
testable without a database.

Prepaid always returns `auto`: the money is already ours, an undelivered parcel
is a refund rather than a loss, and delaying someone who has paid to ask whether
they meant it looks amateur.

For COD, 0-100, `medium` at 15 and `high` at 45:

| Signal | Effect |
|---|---|
| Previous returns on this number | up to +50, scaled by return rate |
| 3+ deliveries kept | -25 |
| 1-2 deliveries kept | -12 |
| First order from this number | +18 |
| 3+ open orders and nothing delivered | +20 |
| Order value above typical | up to +30, log-scaled |
| Address under 12 characters | +15 |
| No city | +10 |
| Guest checkout, number not OTP-verified | +8 |
| 6+ items | +6 |

Two rules are load-bearing:

- **History beats value.** A buyer with eight deliveries placing a Rs 45,000
  order is asked, not blocked. Treating good customers like fraud is how you
  lose them.
- **Returns and deliveries are one branch, not two.** An earlier version added a
  return penalty and then subtracted a delivery discount, which let a buyer with
  three returns and four deliveries score as safe. The return *rate* already
  prices the good orders.

A COD order above Rs 25,000 is never auto-confirmed regardless of score. The
score can be wrong; the size of the loss cannot.

## Flow

```
order.placed
   └─ subscriber opens a confirmation, scores it, picks a policy
        ├─ auto   → confirmed immediately, dispatch released
        └─ verify/strict
             └─ sweep job (every 5 min)
                  ├─ WhatsApp template, SMS fallback
                  ├─ retry after 45 min
                  ├─ escalate to the call queue after 2 attempts
                  └─ after 6 more hours, policy decides
```

Buyer taps **Yes** or **No** on `/confirm/<token>`. An agent can close it out
from the admin queue. Any of those three paths runs the same
`lib/confirmation/resolve.ts` helpers, so "cancelled" means the same thing
however it happened.

## The dispatch gate

`POST /vendor/orders/:id/fulfillments` returns **409** until the confirmation is
`confirmed`. Enforced in `src/api/middlewares.ts` rather than the vendor UI,
because the seller mobile app and the Shopify connector hit the same route. A
rule that lives in a React component is a suggestion.

It **fails open**. If the module throws or the record is missing, dispatch
proceeds. An RTO costs a seller one parcel's freight; a gate that jams costs
them every order they have, and they would be right to leave over it.

## Tokens

The one-tap link is a bearer credential, so it is never stored. It is derived as
`HMAC(JWT_SECRET, confirmationId:salt)` from a random salt on the row, and only
a lookup digest is written. A dumped table yields nothing usable, because the
secret is in the environment.

Deriving rather than randomising also keeps the link **stable across retries**.
A buyer who ignores the WhatsApp, gets the SMS, then scrolls back to the first
message still lands on a working page.

The link is deliberately **not revoked** when the order resolves. Revoking meant
a buyer who confirmed and then re-opened the message was told the link was
invalid, which reads as though their confirmation failed. Both confirm and
cancel no-op on a terminal record, so a live token there is inert.

The page shows items, total and city. Not the street address, not the phone, not
the buyer's name: the realistic exposure is a link forwarded into a group chat,
and limiting the payload is what keeps that from being a leak.

## Config

| Variable | Default | Meaning |
|---|---|---|
| `PK_CONFIRM_MEDIUM_AT` | 15 | Score at which we start asking |
| `PK_CONFIRM_HIGH_AT` | 45 | Score at which silence cancels |
| `PK_CONFIRM_HIGH_VALUE` | 25000 | Never auto-confirm above this |
| `PK_CONFIRM_TYPICAL_VALUE` | 3500 | Baseline for the value component |
| `PK_CONFIRM_RETRY_MINUTES` | 45 | Gap between attempts |
| `PK_CONFIRM_MAX_ATTEMPTS` | 2 | Automated attempts before escalation |
| `PK_CONFIRM_ESCALATION_HOURS` | 6 | Time an agent has before policy decides |
| `PK_CONFIRM_TOKEN_TTL_HOURS` | 48 | Link lifetime |
| `PK_WHATSAPP_DRIVER` | console | `none` forces the SMS fallback |
| `PK_DEFAULT_PAYMENT_METHOD` | cod | Used when no provider identifies itself |

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /store/order-confirmation/:token` | none | What the buyer sees |
| `POST /store/order-confirmation/:token/confirm` | none | Yes |
| `POST /store/order-confirmation/:token/cancel` | none | No, with a reason |
| `GET /vendor/orders/:id/confirmation` | seller | May I dispatch? |
| `GET /admin/order-confirmations` | admin | The call queue |
| `POST /admin/order-confirmations/:id/resolve` | admin | Close out a call |

Confirm and cancel are POST, not GET. Link previewers, WhatsApp's crawler and
mail scanners all fetch URLs they are shown, so a GET would confirm a meaningful
share of orders before the buyer read anything.

## A trap worth knowing

**Medusa recomputes an order's total from whichever item fields you requested.**
Asking for `items.id` reported a PKR 156,050 order as PKR 250 (the shipping, and
nothing else) with no error. `items.quantity` plus `items.unit_price` is still
not enough. Only `items.*`, or no item fields at all, gives the real number.

It was silently disabling every value-based risk rule and would have shown the
buyer a total of Rs 250 to confirm. `reconciledTotal()` in
`lib/confirmation/open-for-order.ts` now cross-checks the total against the sum
of its own lines and logs loudly when they disagree.

## Verified

`bun run test:confirmation` — 35 checks, each proven able to fail by deliberately
breaking the code it covers (the gate, token storage, the policy split).

End to end against a running stack: a real PKR 156,050 checkout opened a
confirmation on `order.placed`; the seller got 409 on dispatch; the buyer
confirmed and dispatch was released; a second order was cancelled from the page,
which cancelled the Medusa order and left the seller a 409 saying not to ship.

## Not built

- **Inbound WhatsApp replies.** The buyer taps a link; typing "yes" does
  nothing. Needs an inbound webhook and it needs the BSP contract first.
- **Delivery receipts.** We log what we sent, not what arrived. Until the
  gateway reports back, "sent" means "handed to the gateway".
- **Real RTO outcomes.** `rtoOrders` currently counts buyers who cancelled at
  the confirmation step, which understates the real thing: the buyer who never
  answers and then refuses at the door is the expensive one and does not appear
  here at all. Wire courier outcomes into this once remittance files are flowing.
- **Urdu.** The copy is plain English. This page more than any other should be
  translated first.
