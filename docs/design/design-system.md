# Bazaar design system

Status: colour system, product card and mobile customer app are **built**.
The page specifications below are **designed but not yet built**. See the
scorecard at the end for exactly which is which.

---

## 1. The strategic bet

The large marketplaces are almost all orange or red. That is not a
coincidence, it is a convention: the palette of discounting, urgency and
cheapness. It works, and it is also why all five feel exhausting.

In cash-on-delivery markets the incumbent's weakness is usually **not price**. It is trust —
counterfeits, sellers who do not ship, photographs that do not match what
arrives, and a returns process people expect to lose. Competing with an incumbent on
"cheaper and louder" means fighting on their strongest ground with less capital.

So Bazaar competes on **trust**, and the design carries that everywhere:

| The incumbents do | Bazaar does | Why |
|---|---|---|
| Countdown timers that reset on reload | No countdowns at all | Once a shopper notices the timer is fake, everything else you claim is suspect |
| "Only 2 left!" on infinite stock | Real stock, or say nothing | Same reason |
| Seller name buried on the product page | Seller named on every card | It is a marketplace. Who you are buying from is primary information |
| Delivery cost revealed at checkout | Total cost stated on the product page | The single biggest cause of abandonment, and it feels like a trick |
| 6 competing CTAs per screen | One primary action per view | Choice paralysis reads as clutter, clutter reads as cheap |
| Interstitial popups on open | None | |

**The test for any new element: would a sceptical Karachi shopper who has been
burned by an online order before find this reassuring, or would they find it
pushy?**

---

## 2. Colour

### Ramps

Two ramps define the brand. Changing them re-themes everything.

**Jade — primary.** `#F0FDF8 → #03241D`, action colour `jade-600 #077C5C`.
Chosen because none of the five competitors own green, it reads as
safe/verified in a commerce context, and it carries cultural resonance in
Pakistan without being flag-waving.

**Amber — accent.** `#FFFBEB → #451A03`, deal badge `amber-300 #FBBF24`.
Deals, ratings, badges. Supplies energy without red-panic.

**Stone — neutrals, warm-tinted.** `#FFFFFF → #0F0C0A`. A few degrees of warmth
in the greys is the difference between "premium marketplace" and "internal
admin tool". Cold blue-greys are what make Amazon feel like a spreadsheet.

**Red is reserved.** Errors, and genuine markdowns. Never chrome, never
urgency. If red appears, it means something.

### Verified rules

Contrast was calculated, not eyeballed. Three results are binding:

1. **Amber never carries white text.** White on amber-400 is 3.19:1 and fails
   AA. Dark-on-amber (11.68:1) or amber-600 with white (5.02:1).
2. **Control borders are stone-400, not stone-300.** Stone-300 on white is
   1.90:1 — effectively invisible in daylight on a cheap screen. This is
   precisely why filling in a form on many marketplaces feels imprecise.
3. **jade-500 is not a text colour** (3.53:1). Large text and UI only. Body
   copy and links use jade-600 or 700.

### Where it lives

- Web: `apps/storefront/src/app/colors.css` — raw ramps, then a semantic layer
  (`--bg-action-primary`, `--content-primary`, `--border-input`) that every
  component reads through. Components never touch a ramp directly.
- Mobile: `apps/mobile-customer/src/theme.ts` — mirrors the same values.

To re-theme: change the two ramps in both files. Nothing else moves.

---

## 3. Type, space, shape

**Type.** Prices are `tabular-nums` everywhere. A column of prices whose digits
jitter is the fastest way to look amateur. Scale: display 28 / h1 22 / h2 18 /
h3 15 / body 14 / small 12 / tiny 11, with price at 17 and 24.

For Urdu, use Noto Naskh Arabic for UI rather than Nastaliq — Nastaliq is
beautiful but needs roughly double the line-height and breaks dense layouts.
Reserve Nastaliq for display headings if the brand wants it. Not yet wired up.

**Space.** A 4pt scale, and everything snaps to it. Most of what makes an
interface feel deliberate rather than assembled is that its gaps are consistent.

**Shape.** Radii 6 / 10 / 12 / 16 / 20. Cards are 12px — 16px reads soft and
toy-like at product-grid density.

**Shadow.** Warm-tinted, matching the neutrals. Pure-black shadows over warm
greys go muddy. The sticky buy bar casts its shadow *upward* so it reads as
floating above the page.

**Tap targets: 48pt minimum.** Apple says 44, Google says 48; take the larger.
Undersized targets are the most common reason someone on a cheap phone gives up
on a checkout.

---

## 4. The user journey

Designed around one question at each step: *what is the shopper's next
objection, and does this screen answer it?*

```
Discover  →  Evaluate  →  Trust  →  Commit  →  Reassure
  home       category     product   checkout    confirmation
```

**Discover.** Search first, categories immediately below. A shopper who knows
what they want should never scroll. One who doesn't gets an 8-tile category
grid — a grid, not a carousel, because horizontal hunting hides options.

**Evaluate.** The grid is where price comparison happens, so the card carries
price (loudest), seller, rating and delivery. Everything needed to shortlist
without a tap.

**Trust.** The product page's job is not description, it is objection-handling:
who is selling this, when does it arrive, what does it cost in total, what
happens if it is wrong.

**Commit.** One screen, COD preselected, the total unchanged from what the
product page promised.

**Reassure.** Order reference, arrival window, payment method restated. This
screen exists to stop the "did that work?" support message.

---

## 5. Page specifications

### 5.1 Home

1. Sticky search
2. Category grid, 4 across
3. Trust row — COD / returns / verified sellers
4. Popular now — 2-up grid on mobile, 5-up on desktop
5. Deals (only when real markdowns exist; the rail disappears otherwise rather
   than showing manufactured "deals")
6. Category rails
7. New sellers

No hero carousel. Auto-rotating heroes have poor engagement, push content down,
and cost bandwidth that matters on a metered connection.

### 5.2 Category / listing

- **Desktop**: sticky filter sidebar, 4-5 up grid.
- **Mobile**: filter and sort as a bottom sheet, 2-up grid. Sheet, not a new
  page, so context is never lost.
- Result count always visible. Active filters as removable chips.
- Sort: relevance, price asc/desc, rating, newest.
- Filters: price range, category, seller rating, delivery time, COD available,
  free delivery. **Delivery time and COD are filters** — in this market they
  matter more than brand.
- Infinite scroll with a "load more" fallback, never pagination alone.

### 5.3 Product

Order is deliberate; it descends by objection priority.

1. Gallery, square, swipeable, with dot indicators
2. **Price block** — current price largest thing on screen, original struck
   through, discount as a computed percentage
3. Title, then variant selectors as chips (never a dropdown; dropdowns hide
   options and cost a tap)
4. **Seller card** — name, rating, verified badge, link to storefront. High on
   the page, not buried at the bottom
5. **Total cost block** — item + delivery + payment method, stated plainly.
   This is the anti-bait-and-switch block and it is the most important thing on
   the page
6. Trust row — COD, returns window, verified
7. Description and specifications
8. Reviews, with photos, most-recent first
9. Other sellers of the same product — a genuine marketplace advantage that
   incumbents handle poorly
10. Related products

Sticky bottom bar on mobile: price on the left, one primary action on the right.

### 5.4 Cart

**Grouped by seller.** Non-negotiable: a multi-vendor order ships per seller,
is delivered per seller, and is paid out per seller. Showing one flat list and
then charging multiple delivery fees at checkout is exactly the surprise that
loses the order.

Per group: seller name, its items, its delivery fee. Then a totals panel where
the arithmetic is visible.

### 5.5 Checkout

Single scrolling page, not a wizard. Three panels: address, payment, summary.

COD is preselected because it is ~95% of this market. Presenting card first is
designing for a customer who is not here.

The total at the bottom must equal what the product page said. If it cannot,
the product page was wrong.

### 5.6 Confirmation

Order reference, arrival window, payment method, and what happens next.

---

## 6. Behavioural notes specific to this market

- **Assume a cheap Android on a slow connection.** Images are the bulk of the
  payload: serve WebP/AVIF, size them properly, lazy-load below the fold.
  Every unnecessary kilobyte is a real cost to the user.
- **Skeletons, never spinners.** A spinner says "wait"; a skeleton says "this
  is what is coming and how much of it". On a 3G connection that difference is
  the whole perceived-performance story.
- **Phone number is the identity**, not email. Most shoppers here will not have
  or want to type an email address.
- **Prices with thousands separators.** `Rs 77,900`, never `Rs 77900`.
- **Urdu and RTL** need to be designed in, not retrofitted: mirrored layout,
  logical properties rather than left/right, icon direction flipped.
- **Optimistic UI on add-to-cart.** The badge increments instantly; reconcile
  afterwards. Waiting on a round-trip for that feels broken on a slow link.

---

## 7. What is built vs designed

| Item | State |
|---|---|
| Colour system, contrast-verified | **Built** — web + mobile |
| Type, space, radius, shadow tokens | **Built** — mobile; web partially |
| Product card | **Built** — web + mobile |
| Mobile home, categories, cart, account | **Built** |
| Mobile product page | **Built** |
| Mobile checkout + confirmation | **Built** |
| Web home, category, product, cart, checkout | **Designed, not built** — still Mercur's demo layout under the new theme |
| Web storefront branding (still says "FLEEK") | **Not done** |
| Urdu / RTL | **Not done** |
| Icon set (emoji are placeholders) | **Not done** |
| Reviews, ratings, other-sellers-of-this-product | **Not built** — no data model yet |

The web storefront now carries the new colour system and the new product card,
so it is visibly Bazaar. Its page *layouts* are still Mercur's demo. Rebuilding
those is the next substantial piece of work.
