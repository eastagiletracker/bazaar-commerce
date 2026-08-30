import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { ORDER_CONFIRMATION_MODULE } from "../../../../../modules/order-confirmation";
import { applyCancelled } from "../../../../../lib/confirmation/resolve";

/**
 * POST /store/order-confirmation/:token/cancel — "no, cancel it".
 *
 * The reason is optional and free text, capped and stored as given. It is the
 * only structured feedback we will ever get about why COD orders are abandoned
 * before dispatch, and it costs the buyer one tap. Worth collecting, not worth
 * blocking the cancellation over.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const confirmations: any = req.scope.resolve(ORDER_CONFIRMATION_MODULE);
  const body = (req.body ?? {}) as { reason?: string };

  const confirmation = await confirmations.findByToken(String(req.params.token ?? ""));
  if (!confirmation) {
    return res.status(404).json({
      message: "This confirmation link is no longer valid.",
    });
  }

  const reason = String(body.reason ?? "").trim().slice(0, 280);

  await applyCancelled(
    req.scope,
    confirmation.id,
    reason ? `Buyer cancelled: ${reason}` : "Buyer cancelled from the confirmation link.",
    "buyer"
  );

  return res.json({
    status: "cancelled",
    message: "Your order has been cancelled. Nothing will be delivered.",
  });
}
