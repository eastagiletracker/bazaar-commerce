import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ORDER_CONFIRMATION_MODULE } from "../modules/order-confirmation";
import { ConfirmationStatus } from "../modules/order-confirmation/models/order-confirmation";
import { AttemptStatus } from "../modules/order-confirmation/models/confirmation-attempt";
import {
  confirmUrlFor,
  sendConfirmationRequest,
} from "../lib/confirmation/outreach";
import { resolveOnTimeout } from "../lib/confirmation/resolve";

/**
 * Drives every confirmation that is due for something.
 *
 * One job rather than three, because the states are a single timeline: contact,
 * retry, escalate, then let policy decide. Splitting them across jobs makes the
 * ordering between them implicit, and an order that gets escalated and
 * timed-out in the same minute is the bug you find in production.
 *
 * Runs every five minutes. Confirmation is time-sensitive at the front (a
 * request that arrives an hour after checkout reads as a problem, not a
 * courtesy) and patient at the back, so the schedule is set by the first
 * contact rather than by the retries.
 */
export default async function orderConfirmationSweep(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const confirmations: any = container.resolve(ORDER_CONFIRMATION_MODULE);

  const due = await confirmations.dueForAction(new Date());
  if (!due.length) return;

  let contacted = 0;
  let escalated = 0;
  let resolved = 0;

  for (const c of due) {
    try {
      // Escalated and past its window: policy decides. This is the only place
      // silence becomes an outcome.
      if (c.status === ConfirmationStatus.ESCALATED) {
        const { outcome } = await resolveOnTimeout(container, c);
        resolved += 1;
        logger.info(
          `Confirmation ${c.id} (order ${c.order_id}) ${outcome} on timeout ` +
            `under ${c.policy} policy after ${c.attempts} attempts.`
        );
        continue;
      }

      // Otherwise it is due for outreach.
      const sent = await contactBuyer(container, query, c);
      if (!sent) continue;

      contacted += 1;
      const after = await confirmations.retrieveOrderConfirmation(c.id);
      if (after.status === ConfirmationStatus.ESCALATED) escalated += 1;
    } catch (e) {
      logger.error(`Confirmation sweep failed on ${c.id}: ${e}`);
    }
  }

  logger.info(
    `Confirmation sweep: ${due.length} due, ${contacted} contacted, ` +
      `${escalated} escalated, ${resolved} resolved on timeout.`
  );
}

/** Send one confirmation request. */
async function contactBuyer(
  container: MedusaContainer,
  query: any,
  c: any
): Promise<boolean> {
  const confirmations: any = container.resolve(ORDER_CONFIRMATION_MODULE);

  // Same link every time while it is live, re-minted once it lapses. Null means
  // the confirmation resolved between being picked up and being sent, which is
  // a race we should lose quietly rather than by messaging a settled buyer.
  const token = await confirmations.issueToken(c.id);
  if (!token) return false;

  const details = await orderDetails(query, c);

  const result = await sendConfirmationRequest({
    phone: c.phone,
    buyerName: details.buyerName,
    orderDisplayId: details.displayId,
    amountLabel: money(Number(c.order_amount), c.currency_code),
    sellerName: details.sellerName,
    confirmUrl: confirmUrlFor(token),
  });

  // Log the channels we could not use before the one we did, so the attempt
  // history shows the fallback rather than implying WhatsApp was never tried.
  for (const s of result.skipped) {
    await confirmations.recordAttempt({
      confirmationId: c.id,
      channel: s.channel,
      status: AttemptStatus.SKIPPED,
      error: s.error,
    });
  }

  await confirmations.recordAttempt({
    confirmationId: c.id,
    channel: result.channel,
    status: result.status === "sent" ? AttemptStatus.SENT : AttemptStatus.FAILED,
    providerMessageId: result.providerMessageId ?? null,
    error: result.error ?? null,
  });

  return result.status === "sent";
}

async function orderDetails(query: any, c: any) {
  const fallback = {
    buyerName: "there",
    displayId: String(c.order_id).slice(-6).toUpperCase(),
    sellerName: "the seller",
  };

  try {
    const { data } = await query.graph({
      entity: "order",
      fields: ["display_id", "shipping_address.first_name"],
      filters: { id: c.order_id },
    });
    const o = data?.[0];
    if (!o) return fallback;
    return {
      buyerName: o.shipping_address?.first_name?.trim() || fallback.buyerName,
      displayId: o.display_id ? `#${o.display_id}` : fallback.displayId,
      sellerName: fallback.sellerName,
    };
  } catch {
    return fallback;
  }
}

function money(amount: number, currency = "pkr") {
  if (currency.toLowerCase() === "pkr") {
    return `Rs ${Math.round(amount).toLocaleString("en-PK")}`;
  }
  return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
}

export const config = {
  name: "order-confirmation-sweep",
  schedule: "*/5 * * * *",
};
