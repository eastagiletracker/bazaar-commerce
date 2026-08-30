import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ORDER_CONFIRMATION_MODULE } from "../../modules/order-confirmation";
import type { RiskInput } from "../../modules/order-confirmation/risk";
import { normalisePkMobile } from "../sms";
import { reconciledOrderTotal } from "../order-money";

/**
 * Turn a freshly placed order into a confirmation record.
 *
 * Everything the risk scorer needs is gathered here, in one query, so the
 * scorer itself stays a pure function over plain data.
 */

/**
 * Which orders are cash on delivery.
 *
 * No COD payment provider is contracted yet, so today this reads the provider
 * id and falls back to the market default. COD is roughly 95% of Pakistani
 * ecommerce, so defaulting the unknown case to COD is both the honest guess and
 * the safe one: guessing "prepaid" would skip confirmation on an order that
 * carries the full RTO exposure.
 */
function paymentMethodOf(order: any): "cod" | "prepaid" {
  const providers: string[] = [];
  for (const pc of order?.payment_collections ?? []) {
    for (const p of pc?.payments ?? []) {
      if (p?.provider_id) providers.push(String(p.provider_id).toLowerCase());
    }
  }

  if (providers.some((p) => p.includes("cod") || p.includes("cash"))) return "cod";
  if (providers.some((p) => p.includes("card") || p.includes("stripe") || p.includes("safepay")))
    return "prepaid";

  return (process.env.PK_DEFAULT_PAYMENT_METHOD as "cod" | "prepaid") ?? "cod";
}

export async function openConfirmationForOrder(
  container: any,
  orderId: string
): Promise<{ confirmation: any; token: string | null; created: boolean } | null> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const confirmations: any = container.resolve(ORDER_CONFIRMATION_MODULE);

  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "total",
      "currency_code",
      "customer_id",
      "email",
      "shipping_address.phone",
      "shipping_address.address_1",
      "shipping_address.city",
      "shipping_address.province",
      // `items.*`, not a subset. Medusa RECOMPUTES the order total from
      // whichever item fields you asked for, so a partial selection silently
      // returns a wrong number rather than an error. Asking for `items.id`
      // reported a PKR 156,050 order as PKR 250 (the shipping, and nothing
      // else) and every value-based risk rule quietly stopped firing.
      // `items.quantity` plus `items.unit_price` is still not enough.
      "items.*",
      "shipping_methods.*",
      "payment_collections.payments.provider_id",
    ],
    filters: { id: orderId },
  });

  const order = data?.[0];
  if (!order) {
    logger.warn(`Confirmation skipped: order ${orderId} not found.`);
    return null;
  }

  const orderAmount = reconciledOrderTotal(order, (msg) =>
    logger.error(`Order ${orderId}: ${msg} Check the field selection.`)
  );

  const phone = normalisePkMobile(order.shipping_address?.phone ?? "");
  if (!phone) {
    // Without a usable number there is nobody to ask, so there is no gate to
    // apply. Creating a confirmation we can never resolve would strand the
    // order permanently, which is far worse than shipping it unconfirmed.
    logger.warn(
      `Confirmation skipped for ${orderId}: no valid Pakistani mobile on the ` +
        `shipping address.`
    );
    return null;
  }

  const sellerId = await resolveSellerId(query, orderId);
  if (!sellerId) {
    logger.warn(`Confirmation skipped for ${orderId}: no seller linked.`);
    return null;
  }

  // Digital orders are not confirmed. There is no parcel to hold, no freight to
  // waste and no RTO to prevent, so the entire premise of this module is absent.
  // Holding a game top-up for 45 minutes to ask whether the buyer meant it would
  // be a worse experience than any competitor's.
  //
  // This check is load-bearing rather than cosmetic. Until a payment provider
  // identifies itself, paymentMethodOf() defaults to COD, so a digital order
  // would otherwise be scored as cash on delivery and held behind the dispatch
  // gate indefinitely.
  if (isDigitalOnly(order)) {
    logger.info(`Order ${orderId}: digital only, no buyer confirmation needed.`);
    return null;
  }

  // Everything this number has done with us before. Excludes the order being
  // scored, which has not been created here yet but would be on a retry.
  const history = await confirmations.historyForPhone(phone, orderId);
  const ageDays = history.firstSeen
    ? Math.floor((Date.now() - new Date(history.firstSeen).getTime()) / 86_400_000)
    : 0;

  const risk: RiskInput = {
    paymentMethod: paymentMethodOf(order),
    orderAmount,
    currencyCode: order.currency_code,
    history: {
      deliveredOrders: history.confirmed,
      // Buyers who cancelled at the confirmation step are the closest proxy we
      // have for RTO until courier outcomes are flowing back. It understates
      // real RTO, since the buyer who never answers and refuses at the door is
      // the expensive one and does not appear here at all.
      rtoOrders: history.cancelled,
      openOrders: history.open,
      accountAgeDays: ageDays,
    },
    address: {
      line1: order.shipping_address?.address_1,
      city: order.shipping_address?.city,
      province: order.shipping_address?.province,
    },
    itemCount: (order.items ?? []).length,
    // Guest checkout synthesises an email from the phone number; a real signed
    // in customer has verified that number by OTP.
    phoneVerified: Boolean(order.customer_id) && !isGuestEmail(order.email),
  };

  return await confirmations.openConfirmation({
    orderId,
    sellerId,
    customerId: order.customer_id ?? null,
    phone,
    currencyCode: order.currency_code ?? "pkr",
    risk,
  });
}

/**
 * Product types that never travel in a van. Kept in step with the types seeded
 * by scripts/seed-digital.ts.
 */
const DIGITAL_TYPES = new Set([
  "digital_code",
  "digital_topup",
  "voucher",
  "lead",
  // service_booking is deliberately ABSENT. Someone is coming to the buyer's
  // house, so confirming the address and that they still want it is worth more
  // there than almost anywhere else.
]);

/**
 * True when nothing in the order needs delivering.
 *
 * Decided on product type, not on `requires_shipping`. That field looks like
 * the obvious answer and is useless here: Mercur hardcodes it to true on every
 * cart line item, and forces it true again on every order line item whose offer
 * carries a shipping profile, which all of them do. It is true for a game
 * top-up.
 *
 * A MIXED order still gets confirmed. If one line is a phone case, a parcel is
 * moving and the whole reason for the gate applies.
 */
export function isDigitalOnly(order: any): boolean {
  const items = order?.items ?? [];
  if (!items.length) return false;
  return items.every((i: any) => DIGITAL_TYPES.has(String(i.product_type ?? "")));
}

function isGuestEmail(email?: string | null): boolean {
  return Boolean(email && email.endsWith("@guest.bazaar.pk"));
}

/** Seller behind an order, via Mercur's order_seller link. */
async function resolveSellerId(query: any, orderId: string): Promise<string | null> {
  try {
    const { data } = await query.graph({
      entity: "order_seller",
      fields: ["seller_id"],
      filters: { order_id: orderId },
    });
    return data?.[0]?.seller_id ?? null;
  } catch {
    return null;
  }
}
