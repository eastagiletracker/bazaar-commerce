import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { ORDER_CONFIRMATION_MODULE } from "../../modules/order-confirmation";
import { SETTLEMENT_MODULE } from "../../modules/settlement";
import { SettlementStatus } from "../../modules/settlement/models/order-settlement";

/**
 * The side effects of a confirmation reaching a terminal state.
 *
 * Shared by every path that can resolve one: the buyer tapping the link, an
 * agent working the escalation queue, and the sweep job applying policy on
 * timeout. Keeping it in one place is what stops the three from drifting into
 * three slightly different definitions of "cancelled".
 */

export async function applyConfirmed(
  container: any,
  confirmationId: string,
  via: string,
  resolvedBy?: string | null
) {
  const confirmations: any = container.resolve(ORDER_CONFIRMATION_MODULE);
  const { confirmation, changed } = await confirmations.confirm(
    confirmationId,
    via,
    resolvedBy
  );

  if (changed) {
    await emit(container, "order_confirmation.confirmed", {
      id: confirmation.id,
      order_id: confirmation.order_id,
      seller_id: confirmation.seller_id,
      via,
    });
  }

  return { confirmation, changed };
}

/**
 * Cancel the confirmation, then the order behind it.
 *
 * Order matters. The confirmation is cancelled first so that dispatch is
 * blocked the instant the buyer says no, even if cancelling the order itself
 * fails. The reverse order would leave a window where the order is gone but the
 * gate still reads "released".
 *
 * Order cancellation is best-effort and never throws back to the caller. A
 * buyer who taps "cancel" must always see it worked; an order that could not be
 * cancelled automatically is an ops problem, not something to push back at
 * them. It cannot be dispatched either way, because the gate holds it.
 */
export async function applyCancelled(
  container: any,
  confirmationId: string,
  reason: string,
  resolvedBy?: string | null
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const confirmations: any = container.resolve(ORDER_CONFIRMATION_MODULE);

  const { confirmation, changed } = await confirmations.cancel(
    confirmationId,
    reason,
    resolvedBy
  );

  if (!changed) return { confirmation, changed };

  // Settlement first: it is ours, it is local, and it is what the money side
  // reads. A cancelled-before-dispatch order must never look payable.
  try {
    const settlement: any = container.resolve(SETTLEMENT_MODULE);
    const [row] = await settlement.listOrderSettlements(
      { order_id: confirmation.order_id } as any,
      { take: 1 }
    );
    if (row && row.status === SettlementStatus.PENDING) {
      await settlement.updateOrderSettlements({
        id: row.id,
        status: SettlementStatus.CANCELLED,
      } as any);
    }
  } catch (e) {
    logger.error(
      `Could not mark settlement cancelled for ${confirmation.order_id}: ${e}`
    );
  }

  try {
    const { cancelOrderWorkflow } = await import("@medusajs/core-flows");
    await cancelOrderWorkflow(container).run({
      input: { order_id: confirmation.order_id, canceled_by: resolvedBy ?? "system" },
    });
  } catch (e) {
    logger.warn(
      `Confirmation ${confirmation.id} cancelled but the order could not be ` +
        `cancelled automatically (${e}). Dispatch stays blocked; ops must ` +
        `close out order ${confirmation.order_id} by hand.`
    );
  }

  await emit(container, "order_confirmation.cancelled", {
    id: confirmation.id,
    order_id: confirmation.order_id,
    seller_id: confirmation.seller_id,
    reason,
  });

  return { confirmation, changed };
}

/**
 * What happens when the buyer never answers.
 *
 * The single definition of that decision. It lived in two places for a while
 * (the module service and the sweep job) and that is precisely how the two
 * drift into disagreeing about whether a quiet buyer means yes or no.
 *
 * VERIFY ships, STRICT cancels. The asymmetry is the point: most buyers ignore
 * messages, so treating silence as refusal would throw away far more good
 * orders than the RTO it avoids. Only when the risk score is high enough does
 * shipping become the more expensive mistake.
 */
export async function resolveOnTimeout(
  container: any,
  confirmation: any
): Promise<{ outcome: "confirmed" | "cancelled" }> {
  if (confirmation.policy === "strict") {
    await applyCancelled(
      container,
      confirmation.id,
      `No response after ${confirmation.attempts} attempts on a high-risk order.`,
      "system"
    );
    return { outcome: "cancelled" };
  }

  await applyConfirmed(container, confirmation.id, "timeout", "system");
  return { outcome: "confirmed" };
}

async function emit(container: any, name: string, data: Record<string, unknown>) {
  try {
    const bus = container.resolve(Modules.EVENT_BUS);
    await bus.emit({ name, data });
  } catch {
    // The event bus being unavailable must not fail the buyer's tap.
  }
}
