import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { DIGITAL_FULFILMENT_MODULE } from "../../../../../modules/digital-fulfilment";
import { DeliveryStatus } from "../../../../../modules/digital-fulfilment/models/digital-delivery";
import { fulfil } from "../../../../../lib/digital/deliver";

/**
 * POST /admin/digital-deliveries/:id/review — an agent clears or refuses a hold.
 *
 * Body: { decision: "release" | "refuse", note? }
 *
 * Releasing calls `fulfil` directly rather than re-running the assessment. That
 * is deliberate: the agent has seen the same flags the scorer raised and
 * overruled them, and putting the score back in the path would let the machine
 * silently overturn the human who was brought in precisely because the machine
 * was unsure.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const digital: any = req.scope.resolve(DIGITAL_FULFILMENT_MODULE);

  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as { decision?: string; note?: string };
  const decision = String(body.decision ?? "");
  const note = String(body.note ?? "").trim().slice(0, 500) || null;
  const agentId = (req as any).auth_context?.actor_id ?? "admin";

  if (!["release", "refuse"].includes(decision)) {
    return res
      .status(400)
      .json({ message: 'decision must be "release" or "refuse".' });
  }

  let delivery: any;
  try {
    delivery = await digital.retrieveDigitalDelivery(id);
  } catch {
    return res.status(404).json({ message: "Delivery not found." });
  }

  if (delivery.status === DeliveryStatus.DELIVERED) {
    return res.status(409).json({
      message: "This code has already been delivered and cannot be recalled.",
      status: delivery.status,
    });
  }

  await digital.updateDigitalDeliveries({
    id,
    reviewed_by: agentId,
    reviewed_at: new Date(),
    review_note: note,
  } as any);

  if (decision === "refuse") {
    await digital.updateDigitalDeliveries({
      id,
      status: DeliveryStatus.REFUSED,
      failure_reason: note ?? "Refused on manual fraud review.",
    } as any);

    logger.info(`Digital delivery ${id} refused by ${agentId}.`);
    return res.json({
      status: DeliveryStatus.REFUSED,
      message: "Refused. Nothing was delivered; the order needs refunding.",
    });
  }

  const result = await fulfil(req.scope, id);
  logger.info(`Digital delivery ${id} released by ${agentId}: ${result.status}.`);

  return res.json({
    status: result.status,
    message:
      result.status === DeliveryStatus.DELIVERED
        ? "Released. The buyer can see their code now."
        : result.status === DeliveryStatus.OUT_OF_STOCK
          ? "Released, but the seller has no stock left. This order needs a refund."
          : "Released and queued with the seller.",
  });
}
