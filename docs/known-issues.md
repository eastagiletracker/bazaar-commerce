---
title: Known issues
nav_order: 8
description: >-
  Current defects and limitations, stated plainly.
---

# Known issues

Current defects and limitations, stated plainly. We would rather publish this
list than have you discover it in production.

Last reviewed 2026-08-13.

---

## Open

### 1. The Rs 0 "Instant delivery" option is offered on physical products

**Impact:** a buyer can select free delivery on a physical item and the platform
absorbs the courier cost.

**Why it exists.** Mercur hardcodes `requires_shipping: true` on every cart line
item, so a digital cart demands a shipping method however the product is
configured. Rather than fork a core route, each seller was given a Rs 0 "Instant
delivery" option. But Mercur filters shipping options by fulfilment set and
delivery address only, never by shipping profile, so that option is offered on
physical products too.

**How far the fix got.** The intended fix is a `cart_kind = digital` rule on the
option, fed by a `setShippingOptionsContext` hook, which exists at
`packages/api/src/workflows/hooks/shipping-options-context.ts`.

Two things were wrong and one is fixed. The hook handler must return a
`StepResponse`; a plain object is silently discarded, so the hook fires, computes
the right answer, and the context never carries it. That looks identical to a
broken rule engine at runtime and only the typechecker caught it.

With that corrected the rule works on the **listing** path and physical carts
correctly stop seeing the option. But cart **completion** re-lists seller
shipping options through a path the hook does not reach, so a digital cart then
fails with "No shipping method selected". The rule is therefore currently off.

**Likely correct shape:** a zero **price rule** on the ordinary shipping options
rather than a separate option whose visibility must be managed in two places.

**Severity:** money leak, but nothing is in production. Must close before launch.

### 2. A multi-vendor cart messages the buyer once per vendor

**Impact:** a buyer ordering from three sellers receives three separate order
confirmation messages within minutes, each for a different amount, for what they
experienced as one purchase.

**Why.** `order.placed` fires once per child order and Mercur splits a cart into
one order per seller. Verified: three rows in `pk_order_confirmation`, same
phone number, three amounts.

**Not fixed on purpose.** The fix depends on a product decision. Confirming per
**cart** means keying the confirmation on the order group rather than the order,
and having the dispatch gate ask whether the group is released. Confirming per
**vendor** is defensible if sellers dispatch far apart in time. Until that is
decided, either implementation would be guesswork.

See [multi-vendor-orders.md](multi-vendor-orders.md).

---

## Limitations, by design or by circumstance

### Not contracted, so mocked

- **Payouts** run against a mock driver that models pending KYC and failed
  disbursements. No payment service provider is contracted.
- **SMS and WhatsApp** print to the console. Both need a contracted gateway, and
  WhatsApp additionally needs Meta business verification and template approval,
  which have lead times.
- **Courier remittance formats** are modelled from documented specifications, not
  from live files. Expect to adjust the parser against a real remittance.

### Digital fulfilment

- Nothing notifies the buyer that their code is ready. Delivery works; the
  message does not exist yet.
- No automatic refund on `out_of_stock` or `refused`. Both flag for a human.
- Vendor SLA on top-ups is recorded but nothing acts on it when it expires.
- No runbook for rotating `PK_VAULT_KEY`. Re-encrypting the vault is unimplemented.

### Order confirmation

- Inbound WhatsApp replies are not handled. The buyer taps a link; typing "yes"
  does nothing.
- Delivery receipts are not read back, so "sent" means "handed to the gateway".
- The RTO signal currently counts buyers who cancelled at the confirmation step.
  That understates real returns, because the buyer who ignores everything and
  then refuses at the door never appears in it. Wire courier outcomes in once
  remittance files flow.

### Catalogue import

- Variant rows only import on an axis that is mirrored onto a Medusa product
  option. Axes created by `createProductAttributesWorkflow`, as `seed:pk` does,
  are, and new values on them are mirrored automatically. An axis created
  through the attribute module service has no mirrored option, so rows that use
  it are rejected row by row and nothing is imported.

### Storefront

- **121 pre-existing TypeScript errors**, inherited from the upstream Mercur
  starter, mostly a React types mismatch. The app builds because
  `next.config.ts` sets `ignoreBuildErrors: true`. Please do not add more.
- Urdu and right-to-left support are not implemented. The confirmation and code
  reveal pages are the ones that most need translating first.

### Commission engine

- Rates are percentage-only. A fixed fee per transaction, which is the right
  shape for bill payments, cannot be expressed.
- No scheduled or time-boxed rates, so a promotional commission holiday must be
  set and later unset by hand.
- No volume or tiered rates.

---

## Reporting something not on this list

See [SECURITY.md](../SECURITY.md) for anything touching money, codes or
authentication. Everything else: open an issue.
