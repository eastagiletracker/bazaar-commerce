import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { DIGITAL_FULFILMENT_MODULE } from "../modules/digital-fulfilment";
import { assessAndFulfil } from "../lib/digital/deliver";
import { normalisePkMobile } from "../lib/sms";
import { lineAmount } from "../lib/order-money";

/**
 * Open and attempt a digital delivery for every digital line on a new order.
 *
 * Same payload gotcha as the confirmation subscriber: Mercur emits a SINGLE
 * `order.placed` carrying an ARRAY of `{ id }`, one per seller, not one event
 * per order.
 *
 * Failures are swallowed per line. This runs inside checkout's event
 * processing, and an exception must never surface as a failed order to a buyer
 * who has already paid. A line that fails here stays pending and the ops queue
 * picks it up, which is a far better outcome than a broken checkout.
 */

const DIGITAL_TYPES = new Set(["digital_code", "digital_topup", "voucher"]);

export default async function orderPlacedDigital({
  event,
  container,
}: SubscriberArgs<{ id: string } | Array<{ id: string }>>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const digital: any = container.resolve(DIGITAL_FULFILMENT_MODULE);

  const payload = event.data;
  const orderIds = (Array.isArray(payload) ? payload : [payload])
    .map((p) => p?.id)
    .filter(Boolean) as string[];

  for (const orderId of orderIds) {
    try {
      const { data } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "customer_id",
          "currency_code",
          // has_account, not the presence of customer_id. Medusa creates a
          // customer for guest checkouts too, so customer_id is true for
          // everyone and tells you nothing about whether they are verified.
          "customer.has_account",
          "customer.email",
          "shipping_address.phone",
          "billing_address.phone",
          // `items.*` for the same reason as everywhere else: a partial item
          // selection makes Medusa recompute totals from incomplete data.
          "items.*",
        ],
        filters: { id: orderId },
      });

      const order = data?.[0];
      if (!order) continue;

      const digitalLines = ((order.items ?? []) as any[]).filter(
        (i) => i && DIGITAL_TYPES.has(String(i.product_type ?? ""))
      );
      if (!digitalLines.length) continue;

      const sellerId = await resolveSellerId(query, orderId);
      const phone =
        normalisePkMobile(order.shipping_address?.phone ?? "") ??
        normalisePkMobile(order.billing_address?.phone ?? "");

      for (const line of digitalLines) {
        const { delivery, created } = await digital.openDelivery({
          orderLineId: line.id,
          orderId,
          sellerId: sellerId ?? "unknown",
          offerId: (line.metadata as any)?.offer_id ?? null,
          customerId: order.customer_id ?? null,
          buyerVerified: Boolean(order.customer?.has_account),
          phone,
          productType: String(line.product_type),
          quantity: Number(line.quantity ?? 1),
          // NOT line.total. That is computed, not a column, and the totals
          // calculator has not run when order.placed fires: it reads 0 while
          // unit_price holds the real figure. A zero here would switch off
          // every value-based fraud rule without a word.
          amount: lineAmount(line),
          currencyCode: order.currency_code ?? "pkr",
          // Whatever the buyer typed at checkout: a game player ID, the number
          // to top up. Carried on line metadata by the storefront.
          fulfilmentInput: pickFulfilmentInput(line.metadata),
        });

        if (!created) continue;

        const outcome = await assessAndFulfil(container, delivery.id);
        logger.info(
          `Order ${orderId} line ${line.id}: digital delivery ${outcome.status}.`
        );
      }
    } catch (e) {
      logger.error(`Digital fulfilment failed for order ${orderId}: ${e}`);
    }
  }
}

/**
 * Pull only the fields we expect out of line metadata.
 *
 * Metadata is buyer-influenced, so it is copied selectively rather than
 * wholesale: the vendor sees this, and it should not become a channel for
 * arbitrary content.
 */
function pickFulfilmentInput(
  metadata: unknown
): Record<string, unknown> | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["target", "player_id", "msisdn", "account_id", "region"]) {
    if (m[key] != null) out[key] = String(m[key]).slice(0, 120);
  }
  return Object.keys(out).length ? out : null;
}

async function resolveSellerId(query: any, orderId: string) {
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

export const config: SubscriberConfig = {
  event: "order.placed",
};
