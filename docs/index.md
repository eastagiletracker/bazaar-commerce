---
title: Home
nav_order: 1
description: >-
  Open-source multi-vendor marketplace engine for cash-on-delivery markets,
  built on MedusaJS and Mercur in TypeScript.
---

# Bazaar Commerce

**An open-source multi-vendor marketplace engine for cash-on-delivery markets.**

Most ecommerce software assumes the customer has already paid. In Pakistan,
Bangladesh, Egypt, Nigeria and much of South and Southeast Asia, roughly **95% of
orders are cash on delivery**: a courier collects the money days later, remits it
in a batch, sometimes short, and between a fifth and two fifths of parcels come
back undelivered.

Every assumption behind "authorize, capture, then pay the seller" is wrong in
those markets. Bazaar Commerce supplies the layer that is missing.

[View on GitHub](https://github.com/Cubitrek/bazaar-commerce){: .btn .btn-primary }
[Quick start](quickstart.html){: .btn }

---

## What it provides

**[Cash-on-delivery settlement ledger](cod-settlement.html)** — double-entry
accounting where a seller becomes payable only once a courier has actually
remitted. Ingests remittance files, matches on airway bill, and routes short
payments, unknown AWBs and duplicates to an explicit exception queue rather than
absorbing them silently.

**[Order confirmation before dispatch](order-confirmation.html)** — return to
origin runs 20 to 40% on cash on delivery and the seller pays freight both ways.
This holds the parcel until the buyer confirms, over WhatsApp with an SMS
fallback, risk-scored so most orders are never delayed.

**[Digital fulfilment](digital-fulfilment.html)** — an AES-256-GCM encrypted code
vault with atomic allocation, so twenty simultaneous buyers take twenty different
codes, and a fraud gate that holds on doubt because a released code cannot be
recalled.

**Payout rail** — a pluggable provider for markets Stripe Connect does not serve.

**Phone-first authentication** — the mobile number is the identity in these
markets, not email.

---

## Verified, honestly

233 assertions across seven suites. Every one was **proven able to fail** by
deliberately breaking the code it covers, because a green test that cannot go red
manufactures confidence rather than providing it.

The project is **pre-production**. The engine is real; the commercial
integrations are not, because they need signed contracts rather than code. The
[known issues](known-issues.html) page lists every defect we are aware of,
including the three that are open.

---

## Licence

Apache-2.0, built on the MIT-licensed [Medusa](https://medusajs.com) and
[Mercur](https://github.com/mercurjs/mercur). Maintained by
[Cubitrek](https://cubitrek.com).
