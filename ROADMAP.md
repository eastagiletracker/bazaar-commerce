# Roadmap

What is built and verified, what is not, and what is waiting on a signature
rather than on code.

Last reviewed 2026-08-13.

---

## Built and verified

**229 assertions across seven suites**, each proven able to fail by deliberately
breaking the code it covers. 226 pass on a clean database; three checks in the
CSV suite are order-dependent and are tracked in
[known issues](docs/known-issues.md).

| Area | Checks | What it proves |
|---|---|---|
| Settlement ledger | 34 | Cash is tracked correctly through courier chaos |
| Payout provider | 26 | The rail works and is wired into Mercur |
| CSV importer | 34 | Bulk upload works; bad files import nothing (3 order-dependent) |
| Shopify connector | 29 | Token rotation, throttling, signature verification |
| OTP | 22 | Brute force, SMS pumping and expiry are all defended |
| Order confirmation | 40 | Unconfirmed parcels cannot be dispatched |
| Digital vault | 44 | No code reaches two buyers; none leaves ungated |

Plus end-to-end smoke tests that drive a real cash-on-delivery order and a real
digital purchase against a running stack.

### Foundation
- Multi-vendor marketplace on Medusa 2.18 and Mercur 2.3
- One cart splits into one order per seller, each with its own commission
- Per-category, per-seller and per-product-type commission rules
- Phone-first OTP authentication and guest checkout

### The money path
- Double-entry cash-on-delivery ledger with courier remittance reconciliation
- Exception queue for short payments, unknown airway bills and duplicates
- Provincial sales tax on commission, and income-tax withholding
- Payout provider for markets Stripe Connect does not serve

### Operations
- Order confirmation before dispatch, risk-scored, with an ops escalation queue
- Encrypted digital code vault with atomic allocation
- Digital fraud gate with a manual review queue
- Bulk catalogue import and a Shopify connector core

---

## Not built

Roughly in priority order.

### Digital fulfilment
1. **Notify the buyer their code is ready.** Delivery works; the message does
   not exist. The WhatsApp driver from the confirmation work is the obvious
   channel.
2. **Automatic refund** on `out_of_stock` and `refused`. Both flag for a human today.
3. **Vendor fulfilment API** for top-ups, so vendors are not pasting into a dashboard.
4. **Vendor SLA enforcement.** The deadline is recorded; nothing acts on it.
5. **Voucher redemption** endpoint with single-use enforcement.
6. **Vault key rotation.** Re-encrypting under a new key has no runbook.

### Order confirmation
7. **Inbound WhatsApp replies.** The buyer taps a link; typing "yes" does nothing.
8. **Delivery receipts**, so "sent" means more than "handed to the gateway".
9. **Real courier outcomes** feeding the risk score. The current signal counts
   buyers who cancelled at the confirmation step, which understates real returns.

### Marketplace
10. **Multi-vendor confirmation policy.** One cart across three sellers currently
    sends three messages. See [known-issues.md](docs/known-issues.md).
11. **Ratings and reviews.** No data model yet.
12. **Urdu and right-to-left support.** The confirmation and code reveal pages
    should be translated first.
13. **Fixed-fee commission**, which is the right shape for bill payments. The
    engine is percentage-only.
14. **Scheduled and tiered commission rates.**

### Deferred by design
- **Q-commerce** (grocery, pharmacy): zone-based catalogue, store hours, express
  slots. Reuses most of the engine.
- **Restaurants**: a separate application, not an extension. Live rider dispatch,
  geospatial zones, merchant order screens with accept/reject SLAs. Several times
  the size of the marketplace build.

---

## Blocked on commercial agreements, not code

These cannot be finished by writing software.

- **Payment service provider.** Until one is contracted, payouts run against a
  mock driver and digital products cannot launch at all, because there is no cash
  on delivery for a code. In these markets the right first rail is usually mobile
  wallets rather than cards.
- **SMS gateway and sender mask.** Registration has a lead time.
- **WhatsApp Business.** Needs Meta business verification, a solution provider,
  and template approval before a single message can be sent.
- **Courier contracts.** Booking API, tracking webhooks, and above all the COD
  remittance file format, which is what the reconciliation engine parses.

---

## Known issues

Three are open, including a free-shipping leak. See
[docs/known-issues.md](docs/known-issues.md). We publish that list rather than
wait for someone to find it.
