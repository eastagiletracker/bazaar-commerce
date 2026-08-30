import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { ORDER_CONFIRMATION_MODULE } from "../../../../../modules/order-confirmation";
import { ConfirmedVia } from "../../../../../modules/order-confirmation/models/order-confirmation";
import { applyConfirmed } from "../../../../../lib/confirmation/resolve";

/**
 * POST /store/order-confirmation/:token/confirm — "yes, send it".
 *
 * POST rather than GET on purpose. Link previewers, WhatsApp's own crawler,
 * corporate mail scanners and antivirus products all fetch URLs they are shown;
 * if confirming were a GET, a meaningful share of orders would confirm
 * themselves before the buyer had read anything.
 *
 * Tapping twice succeeds twice. The buyer gets one nervous tap and one
 * impatient one, and the second must not read as an error.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const confirmations: any = req.scope.resolve(ORDER_CONFIRMATION_MODULE);

  const confirmation = await confirmations.findByToken(String(req.params.token ?? ""));
  if (!confirmation) {
    return res.status(404).json({
      message: "This confirmation link is no longer valid.",
    });
  }

  await applyConfirmed(req.scope, confirmation.id, ConfirmedVia.LINK, "buyer");

  return res.json({
    status: "confirmed",
    message: "Thank you. Your order is on its way.",
  });
}
