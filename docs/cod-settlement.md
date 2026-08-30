---
title: COD settlement
nav_order: 4
description: >-
  The double-entry ledger, courier remittance matching and the exception queue.
---

# Cash-on-delivery settlement

The core of this project. A double-entry ledger where a seller becomes payable
only once a courier has actually handed over the cash.

Module: [`packages/api/src/modules/settlement`](../packages/api/src/modules/settlement)
Tests: `bun run test:settlement` (34 checks)

---

## Why a ledger at all

A marketplace could track "amount owed to seller" as a column and update it. That
works right up to the first month-end when the number is wrong and nobody can say
why.

Cash on delivery produces disagreements constantly: couriers remit late, short,
twice, or against airway bills nobody recognises. Parcels come back. Partial
deliveries happen. A column cannot explain itself; a ledger can, because every
change is an entry with a reason, a timestamp and a counterparty, and nothing is
ever edited.

**Nothing here mutates.** Corrections are reversing entries, so history stays
auditable.

---

## Accounts

| Account | Normal balance | Holds |
|---|---|---|
| `cod_receivable` | debit | Cash a courier has collected but not yet remitted |
| `psp_clearing` | debit | Prepaid money in transit from the payment provider |
| `bank` | debit | Money actually in our account |
| `seller_payable` | credit | What we owe a seller |
| `commission_revenue` | credit | Our fee |
| `sales_tax_payable` | credit | Provincial sales tax on commission |
| `withholding_tax_payable` | credit | Income tax withheld from the seller, owed to the revenue authority |
| `settlement_loss` | debit | Written-off shortfalls, when a human decides to absorb one |

---

## Entry kinds

`order_placed`, `cod_collected`, `commission_charged`, `tax_withheld`,
`remittance_received`, `payout_sent`, `rto_reversal`,
`shortfall_written_off`, `adjustment`.

---

## The three decisions that shape it

### Placement posts nothing

An order is not money. A cash-on-delivery order is not even a receivable: nobody
has any cash. Posting on placement would make the ledger a forecast, and a
forecast that looks like a record is worse than no record.

### A mismatched remittance is a dispute, not an adjustment

When a courier remits less than the order was worth, the difference is **not**
quietly written off. It becomes a `amount_mismatch` exception that a human owns.

The alternative, netting it off automatically, produces a ledger that always
balances and silently absorbs every loss. You would never find out your courier
under-remits by 2%.

### Collected-but-unremitted cash is not payable

The courier has the money, not us. The parcel is delivered and the buyer has
paid, and we still do not owe the seller, because we cannot pay out money we do
not hold. That distinction is exactly what `cod_receivable` exists to express.

---

## Two guards on every write

**Balance.** `postEntry` refuses to write unless debits equal credits, to the
cent. An unbalanced entry throws rather than being stored and reconciled later.

**Idempotency.** Every entry carries a key derived from a business fact, not a
random id. Courier files get re-sent, webhooks get re-delivered, and jobs get
retried. Posting the same remittance twice must be a no-op, and it is.

---

## Reconciliation

A remittance file arrives as lines, each carrying an airway bill and an amount.
Each line resolves to one of:

| Outcome | Result |
|---|---|
| Matches an order, amount agrees | Balanced entry posted, order becomes payable |
| Matches, amount is short | `amount_mismatch` exception. Nothing posted |
| No such airway bill | `unmatched_remittance` exception |
| Already remitted | `duplicate_remittance`; the idempotency key blocks the post |
| Expected and never arrived | `remittance_overdue` exception |

Exceptions move `open` → `investigating` → `resolved` or `written_off`. Writing
one off is a deliberate act that posts to `settlement_loss`, so absorbed losses
are visible rather than invisible.

---

## Tax

Two different taxes, often confused:

- **Sales tax on services** applies to *the commission*, because the commission
  is a service sold to the seller. Provincial in Pakistan (SRB, PRA and others),
  which is why the rate is per-seller rather than global.
- **Withholding tax** is deducted from the *seller's proceeds* under s.153 of the
  Income Tax Ordinance and remitted to the revenue authority on their behalf. The
  rate depends on whether the seller is a filer.

So a gross order splits four ways: commission, sales tax on that commission,
withholding, and the seller's net.

---

## What the tests actually prove

`bun run test:settlement` runs synthetic courier data that includes the messy
cases on purpose: a courier short-paying, an airway bill we have never seen, the
same AWB paid twice, and a partial collection.

The assertion that matters most is the last one: **the ledger still balances
after all of it**, and every individual entry balances too.

Like every suite here, it was proven able to fail before it was trusted.

---

## Not yet built

- Real courier remittance formats. The parser is modelled from documented
  specifications, not live files. Expect to adjust it against a real remittance.
- Automated overdue detection. `remittance_overdue` exists as a type; nothing
  raises it on a schedule yet.
