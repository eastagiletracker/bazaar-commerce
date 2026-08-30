import { defineMiddlewares } from "@medusajs/medusa";
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ORDER_CONFIRMATION_MODULE } from "../modules/order-confirmation";

/**
 * The dispatch gate.
 *
 * Enforced here rather than in the vendor UI because the UI is not the only
 * caller: the seller mobile app, the Shopify connector pushing fulfilments back,
 * and anything else holding a vendor token all hit the same route. A rule that
 * lives in a React component is a suggestion.
 *
 * Refuses with 409, not 403. This is a state problem that will resolve itself
 * in minutes, not a permission problem, and the difference decides whether a
 * seller retries or files a support ticket.
 *
 * Fails OPEN. If the module throws, the confirmation record is missing, or
 * anything else goes wrong, dispatch proceeds. An RTO costs a seller one
 * parcel's freight; a gate that jams costs them every order they have, and they
 * would be right to leave over it.
 */
const requireBuyerConfirmation = async (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const orderId = String(req.params.id ?? "");

  try {
    const confirmations: any = req.scope.resolve(ORDER_CONFIRMATION_MODULE);
    const { released, confirmation } =
      await confirmations.isDispatchReleased(orderId);

    if (released) return next();

    const cancelled = confirmation.status === "cancelled";
    return res.status(409).json({
      type: "not_allowed",
      code: cancelled
        ? "order_confirmation_cancelled"
        : "order_confirmation_pending",
      message: cancelled
        ? "This order was cancelled before dispatch and must not be shipped. " +
          (confirmation.cancel_reason ?? "")
        : "This order is waiting for the buyer to confirm. We are contacting " +
          "them now and will release it as soon as they reply. Please hold " +
          "the parcel until then.",
      confirmation_status: confirmation.status,
    });
  } catch (e) {
    logger.error(
      `Dispatch gate could not evaluate order ${orderId}, allowing dispatch: ${e}`
    );
    return next();
  }
};

export default defineMiddlewares({
  routes: [
    {
      method: ["POST"],
      matcher: "/vendor/orders/:id/fulfillments",
      middlewares: [requireBuyerConfirmation],
    },
  ],
});
