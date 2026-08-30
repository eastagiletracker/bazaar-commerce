import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { openConfirmationForOrder } from "../lib/confirmation/open-for-order";

/**
 * Open a buyer confirmation for every order as it is placed.
 *
 * The gotcha this handles: Mercur splits one cart into one order per seller and
 * emits a SINGLE `order.placed` carrying an **array** of `{ id }`, not one event
 * per order. A handler written for the usual `{ id }` payload silently confirms
 * nothing on multi-seller carts, which is exactly the case that matters most,
 * because those are the orders where one seller ships and another does not.
 *
 * Failures are swallowed per order. This runs inside checkout's event
 * processing, and an exception here must never surface as a failed order for a
 * buyer who has already paid or committed.
 */
export default async function orderPlacedConfirmation({
  event,
  container,
}: SubscriberArgs<{ id: string } | Array<{ id: string }>>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const payload = event.data;
  const ids = (Array.isArray(payload) ? payload : [payload])
    .map((p) => p?.id)
    .filter(Boolean) as string[];

  for (const orderId of ids) {
    try {
      const result = await openConfirmationForOrder(container, orderId);
      if (!result) continue;

      if (result.created) {
        logger.info(
          `Order ${orderId}: confirmation ${result.confirmation.id} opened ` +
            `(${result.confirmation.risk_band} risk, policy ` +
            `${result.confirmation.policy}, score ${result.confirmation.risk_score}).`
        );
      }
    } catch (e) {
      logger.error(`Could not open a confirmation for order ${orderId}: ${e}`);
    }
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
