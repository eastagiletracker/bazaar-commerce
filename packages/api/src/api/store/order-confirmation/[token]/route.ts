import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ORDER_CONFIRMATION_MODULE } from "../../../../modules/order-confirmation";

/**
 * GET /store/order-confirmation/:token — what the buyer sees before deciding.
 *
 * Unauthenticated by design. The buyer arrives from a WhatsApp message on a
 * phone that is probably not signed in, and putting a login in front of a
 * confirmation would defeat the point of asking.
 *
 * That makes the token a bearer credential, so the response is deliberately
 * thin. It shows what someone needs in order to recognise their own order and
 * nothing that would be worth harvesting: item names, total, city. **Not** the
 * street address, not the phone number, not the buyer's name.
 *
 * A token is 32 random bytes, so guessing one is not a practical attack. The
 * realistic exposure is a link forwarded or left in a shared WhatsApp, and
 * limiting the payload is what keeps that from being a leak of anything more
 * than the fact that someone ordered something.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const confirmations: any = req.scope.resolve(ORDER_CONFIRMATION_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const token = String(req.params.token ?? "");
  const confirmation = await confirmations.findByToken(token);

  if (!confirmation) {
    // One response for unknown, expired and already-resolved. Distinguishing
    // them would tell a caller holding a guessed token that they had hit
    // something real.
    return res.status(404).json({
      message: "This confirmation link is no longer valid.",
    });
  }

  let summary: {
    display_id?: number | string | null;
    city?: string | null;
    items: Array<{ title: string; quantity: number }>;
    total: number;
  } = { items: [], total: Number(confirmation.order_amount) };

  try {
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "display_id",
        "total",
        "currency_code",
        "shipping_address.city",
        // `items.*` and not the two fields actually used. Medusa recomputes the
        // order total from whatever item fields were requested, so asking only
        // for title and quantity would show the buyer a total of PKR 250 on a
        // PKR 156,050 order and invite them to confirm it. See the same note in
        // lib/confirmation/open-for-order.ts.
        "items.*",
      ],
      filters: { id: confirmation.order_id },
    });
    const order = data?.[0];
    if (order) {
      summary = {
        display_id: order.display_id,
        city: order.shipping_address?.city ?? null,
        items: (order.items ?? []).map((i: any) => ({
          title: i.title,
          quantity: i.quantity,
        })),
        total: Number(order.total ?? confirmation.order_amount),
      };
    }
  } catch {
    // The order lookup is a nicety. If it fails the buyer can still confirm,
    // which is the part that matters, so fall back to the amount we recorded.
  }

  return res.json({
    confirmation: {
      status: confirmation.status,
      resolved:
        confirmation.status === "confirmed" || confirmation.status === "cancelled",
      confirmed_via: confirmation.confirmed_via,
      currency_code: confirmation.currency_code,
    },
    order: summary,
  });
}
