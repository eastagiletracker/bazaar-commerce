import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { ORDER_CONFIRMATION_MODULE } from "../../../../../modules/order-confirmation";
import {
  AttemptStatus,
  ContactChannel,
} from "../../../../../modules/order-confirmation/models/confirmation-attempt";
import { ConfirmedVia } from "../../../../../modules/order-confirmation/models/order-confirmation";
import {
  applyCancelled,
  applyConfirmed,
} from "../../../../../lib/confirmation/resolve";

/**
 * POST /admin/order-confirmations/:id/resolve — an agent closes out a call.
 *
 * Body: { outcome: "confirmed" | "cancelled" | "no_answer", note?, reason? }
 *
 * Records the call as an attempt in its own right before applying the outcome.
 * That log is what lets a seller be told "we rang twice, no answer" rather than
 * being handed a cancellation with no explanation, and it is the only record
 * that the manual step happened at all.
 *
 * `no_answer` is a first-class outcome, not a failure. An agent who rings and
 * gets nothing has done the work; the confirmation stays escalated and policy
 * still owns the deadline.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const confirmations: any = req.scope.resolve(ORDER_CONFIRMATION_MODULE);
  const body = (req.body ?? {}) as {
    outcome?: string;
    note?: string;
    reason?: string;
  };

  const id = String(req.params.id ?? "");
  const outcome = String(body.outcome ?? "");
  const note = String(body.note ?? "").trim().slice(0, 500) || null;
  const agentId = (req as any).auth_context?.actor_id ?? "admin";

  if (!["confirmed", "cancelled", "no_answer"].includes(outcome)) {
    return res.status(400).json({
      message: 'outcome must be one of "confirmed", "cancelled", "no_answer".',
    });
  }

  let confirmation: any;
  try {
    confirmation = await confirmations.retrieveOrderConfirmation(id);
  } catch {
    return res.status(404).json({ message: "Confirmation not found." });
  }

  await confirmations.recordAttempt({
    confirmationId: id,
    channel: ContactChannel.CALL,
    status: outcome === "no_answer" ? AttemptStatus.FAILED : AttemptStatus.SENT,
    agentId,
    note,
  });

  if (outcome === "no_answer") {
    const after = await confirmations.retrieveOrderConfirmation(id);
    return res.json({
      status: after.status,
      message: "Call logged. The order stays on hold.",
    });
  }

  const result =
    outcome === "confirmed"
      ? await applyConfirmed(req.scope, id, ConfirmedVia.AGENT, agentId)
      : await applyCancelled(
          req.scope,
          id,
          body.reason?.trim()
            ? `Cancelled on a call: ${body.reason.trim().slice(0, 280)}`
            : "Cancelled by the buyer on a call.",
          agentId
        );

  return res.json({
    status: result.confirmation.status,
    // False when it had already resolved: the buyer tapped the link while the
    // agent was dialling. Worth surfacing so the agent is not told they did
    // something they did not do.
    changed: result.changed,
    message: result.changed
      ? outcome === "confirmed"
        ? "Confirmed. The seller can dispatch."
        : "Cancelled. The seller has been told not to dispatch."
      : "This order had already been resolved.",
  });
}
