import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { ORDER_CONFIRMATION_MODULE } from "../../../../../modules/order-confirmation";
import { ConfirmationStatus } from "../../../../../modules/order-confirmation/models/order-confirmation";

/**
 * GET /vendor/orders/:id/confirmation — may I pack this yet?
 *
 * The seller's view of the gate. It answers the only question they have, in a
 * sentence they can act on, because "status: awaiting_buyer" tells a shop owner
 * in Karachi nothing about whether to print a label.
 *
 * The risk reasons are deliberately NOT returned. They read as an accusation
 * about a named buyer, they are our internal scoring rather than fact, and a
 * seller who could see them would start arguing with them.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const confirmations: any = req.scope.resolve(ORDER_CONFIRMATION_MODULE);
  const sellerId = (req as any).seller_context?.seller_id;
  const orderId = String(req.params.id ?? "");

  const [confirmation] = await confirmations.listOrderConfirmations(
    { order_id: orderId } as any,
    { take: 1 }
  );

  if (!confirmation) {
    // No confirmation record means nothing is holding this order. Say so
    // plainly rather than 404-ing, which a seller would read as a fault.
    return res.json({
      confirmation: null,
      dispatch_released: true,
      headline: "Ready to dispatch.",
      detail: "This order does not need buyer confirmation.",
    });
  }

  if (sellerId && confirmation.seller_id !== sellerId) {
    return res.status(404).json({ message: "Order not found." });
  }

  const attempts = await confirmations.attemptsFor(confirmation.id);

  return res.json({
    confirmation: {
      id: confirmation.id,
      status: confirmation.status,
      policy: confirmation.policy,
      attempts: confirmation.attempts,
      last_attempt_at: confirmation.last_attempt_at,
      confirmed_at: confirmation.confirmed_at,
      confirmed_via: confirmation.confirmed_via,
      cancelled_at: confirmation.cancelled_at,
      cancel_reason: confirmation.cancel_reason,
    },
    attempt_log: attempts.map((a: any) => ({
      sequence: a.sequence,
      channel: a.channel,
      status: a.status,
      at: a.created_at,
    })),
    dispatch_released: confirmation.status === ConfirmationStatus.CONFIRMED,
    ...describe(confirmation),
  });
}

function describe(c: any): { headline: string; detail: string } {
  switch (c.status) {
    case ConfirmationStatus.CONFIRMED:
      return {
        headline: "Confirmed by the buyer. Ready to dispatch.",
        detail:
          c.confirmed_via === "timeout"
            ? "The buyer did not reply, and this order was cleared to ship anyway."
            : c.confirmed_via === "agent"
              ? "Confirmed by phone with our team."
              : c.confirmed_via === "policy"
                ? "No confirmation needed for this order."
                : "The buyer confirmed they still want it.",
      };
    case ConfirmationStatus.CANCELLED:
      return {
        headline: "Cancelled. Do not dispatch.",
        detail:
          c.cancel_reason ??
          "This order was cancelled before dispatch. Nothing should be shipped.",
      };
    case ConfirmationStatus.ESCALATED:
      return {
        headline: "On hold. Our team is calling the buyer.",
        detail:
          "We messaged the buyer and did not hear back, so someone is ringing them. " +
          "You will get an answer shortly. Please hold the parcel until then.",
      };
    case ConfirmationStatus.AWAITING_BUYER:
      return {
        headline: "On hold. Waiting for the buyer to confirm.",
        detail:
          `We have asked the buyer ${c.attempts} time${c.attempts === 1 ? "" : "s"} ` +
          "to confirm this order. Please do not pack it yet.",
      };
    default:
      return {
        headline: "On hold. Contacting the buyer.",
        detail: "We are about to message the buyer to confirm this order.",
      };
  }
}
