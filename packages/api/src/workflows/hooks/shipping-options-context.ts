import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { listSellerShippingOptionsForCartWorkflow } from "@mercurjs/core/workflows";

/**
 * Tell the shipping-option query what KIND of cart it is looking at.
 *
 * Fixes a money leak introduced with digital products. Every seller was given a
 * Rs 0 "Instant delivery" option so digital carts could get past Mercur's
 * hardcoded `requires_shipping: true`. But Mercur filters shipping options by
 * fulfilment set and delivery address only, never by shipping profile, so that
 * option was offered on physical products too: anyone buying a pair of shoes
 * could select "Instant delivery, Rs 0" and we would eat the courier cost.
 *
 * Medusa's shipping-option rules match against a context, and this hook is what
 * puts a value in it. The Instant option carries a rule requiring
 * `cart_kind = digital`, so it now disappears the moment anything physical is
 * in the basket.
 *
 * A MIXED cart counts as physical, which is the behaviour we want: a parcel is
 * moving either way, so it must be paid for, and the digital line rides along
 * at no extra cost.
 *
 * ## STATUS: correct, and NOT YET SUFFICIENT. The leak is still open.
 *
 * Two things were wrong and one is fixed. The handler must return a
 * StepResponse: a bare object is silently discarded, so the hook ran, computed
 * the right answer, and the context never carried it. Only the typechecker
 * caught that; at runtime it looked exactly like a broken rule engine.
 *
 * With that fixed the rule works on the LISTING path, and a physical cart
 * correctly stops seeing the Rs 0 option. But cart COMPLETION re-lists seller
 * shipping options through a different path that this hook does not reach, so a
 * digital cart then fails validation with "No shipping method selected". The
 * rule has therefore been left off the option for now, which means a physical
 * buyer can still choose "Instant delivery, Rs 0".
 *
 * Nothing is in production. This must be closed before anything is, and the
 * likely better shape is a zero PRICE RULE on the normal shipping options
 * rather than a separate option whose visibility has to be managed in two
 * places. See docs/marketplace/multi-vendor-orders.md.
 */

const DIGITAL_TYPES = new Set([
  "digital_code",
  "digital_topup",
  "voucher",
  "lead",
]);

listSellerShippingOptionsForCartWorkflow.hooks.setShippingOptionsContext(
  async ({ cart }: { cart: any }) => {
    const items = (cart?.items ?? []) as any[];

    // An empty cart is treated as physical. Failing towards "charge for
    // shipping" is the safe direction; the opposite gives stock away.
    const digitalOnly =
      items.length > 0 &&
      items.every((i) => DIGITAL_TYPES.has(String(i?.product_type ?? "")));

    // StepResponse, not a plain object. A bare return is silently DISCARDED:
    // the hook runs, computes the right answer, and the context never receives
    // it, so the rule it feeds matches nothing and the option vanishes for
    // everyone. Only the typechecker caught this; at runtime it looks like the
    // rule engine is broken.
    return new StepResponse({ cart_kind: digitalOnly ? "digital" : "physical" });
  }
);
