# Conversion playbook

What actually moves revenue on this marketplace, in priority order, with the
evidence behind each and what we have or have not built.

Written 2026-08-12.

---

## 1. Where the money leaks

Average documented cart abandonment across 50 studies is **70.2%**
([Baymard](https://baymard.com/lists/cart-abandonment-rate)). The reasons, for
shoppers who abandoned for something other than idle browsing:

| Reason | Share | Our answer |
|---|---|---|
| Extra costs (delivery, fees) too high or seen late | **39-48%** | Cost block on the product page: item + delivery + total, before the basket. **Built.** |
| Account creation required | **24%** | Guest checkout. **Not built** — the mobile app checkouts as a guest, the web still pushes an account. |
| Delivery too slow | 21% | Delivery window on the product page. Real courier dates need the integration. **Partly built.** |
| Did not trust the site with card details | 19% | COD is the default and the dominant method here, which sidesteps this almost entirely. **Built.** |
| Checkout too long or complicated | 18% | Single-page checkout, COD preselected. **Built in the app, not on web.** |
| Could not see total cost up front | 17% | Same cost block. **Built.** |
| Unsatisfactory returns policy | 15% | 7-day returns, stated on the product page and in the chrome. **Built.** |

**Extra costs are the single largest leak and we have already closed it on the
product page.** That is the highest-leverage thing in this document and it is
done. The next largest is forced account creation, which is still open on web.

---

## 2. The Pakistan-specific layer

None of the above is specific to this market. These are.

**Cash on delivery is ~95% of transactions.** It removes the card-trust
objection (19% of abandonment) but introduces its own: return-to-origin. RTO on
Pakistani COD commonly runs 20-40% of orders. Every point of RTO is a delivered
parcel that earns nothing and costs freight twice.

Levers, in order of impact:
1. **Order confirmation by call or WhatsApp before dispatch.** The single
   biggest RTO reducer in this market. Not built.
2. **Accurate product photography and description.** RTO is often "not what I
   expected". This is why the CSV importer validates image URLs and why the
   category tiles are shot to one brief.
3. **Buyer reliability scoring.** Repeat refusers get prepay-only. Needs order
   history. Not built.
4. **Partial prepay on high-value orders.** Commercial decision, not technical.

**Trust is the binding constraint, not price.** The incumbent's weakness is
counterfeits and unreliable delivery. Every trust affordance we ship — named
seller, verified badge, real delivery window, honest reviews — is working on
the actual objection. This is also why there are no countdown timers: once a
shopper notices the timer is fake, everything else you claim becomes suspect.

**Phone number is the identity.** Most buyers here will not have or want to
type an email. Our auth is still email-first. Not built.

**Cheap Android on a slow connection.** Perceived speed is a conversion
feature, not an engineering nicety. Skeletons over spinners, WebP, aggressive
image sizing.

---

## 3. Page-by-page

### Search and the header
Search is the primary navigation on a marketplace — most sessions start with a
typed query. It is the widest element in the chrome and it is sticky.
**Not built: autocomplete.** A suggestion list needs a search index behind it;
suggestions that return nothing are worse than none.

### Category
- Facets that cannot narrow are hidden. A filter returning zero teaches people
  the filters are broken; after that they stop narrowing and leave.
- Real counts on every option, so the shopper can predict the result.
- Filters as a bottom sheet on mobile, keeping results in context.
- **Not built:** delivery-time and COD filters. In this market those matter
  more than brand and should be added as soon as the courier data exists.

### Product
Ordered by objection: who is selling this, when does it arrive, what is the
total, what if it is wrong. Price is the largest element. Seller is directly
under the buy controls rather than a footnote. Sticky buy bar on mobile.

**Not built, and worth doing in this order:**
1. **Ratings and review count near the title.** The strongest single trust
   signal on a product page, and its absence is conspicuous next to Amazon.
   Needs the review data model.
2. **"N bought this month".** Social proof that is a fact rather than a
   pressure tactic. Needs order aggregates.
3. **Short bullet summary above the fold**, full description below. Scanning
   beats reading.
4. **Other sellers of this product.** A genuine marketplace advantage the incumbent
   handles badly. The buybox logic already exists; it needs surfacing.

### Basket and checkout
Grouped by seller, because that is how it ships and pays out. **Built in the
app, not on web.**

**Highest-value unbuilt item on the whole site: guest checkout on web.** 24% of
abandonment. Take a phone number and an address, create the account silently
afterwards.

---

## 4. What to build next, ranked by expected return

1. **Guest checkout on web** — addresses 24% of abandonment, small build
2. **Phone-first auth with OTP** — removes a hard stop for most of the market
3. **Ratings and reviews** — biggest missing trust signal, needs a data model
4. **Order confirmation before dispatch** — attacks RTO, which is pure margin
5. **Search autocomplete** — needs a search index (Meilisearch is the cheap option)
6. **Delivery-time and COD filters** — needs courier data
7. **"N bought" social proof** — needs order aggregates

Items 1 and 2 are the ones I would do first. They are small, they are entirely
within our control, and between them they address the two largest abandonment
causes we have not already closed.

---

## 5. What to measure

Instrument before optimising. Minimum viable funnel:

```
search/category view → product view → add to basket → checkout start
  → address complete → order placed → delivered → not returned
```

The last step is the one most marketplaces forget, and on COD it is where the
margin actually lands. A 3% conversion lift means nothing next to a 10% RTO
reduction.

Per-step targets worth holding a team to: product view → add to basket above
8%, checkout start → order placed above 60%, RTO below 20%.
