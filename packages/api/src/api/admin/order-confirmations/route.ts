import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ORDER_CONFIRMATION_MODULE } from "../../../modules/order-confirmation";
import { ConfirmationStatus } from "../../../modules/order-confirmation/models/order-confirmation";

/**
 * GET /admin/order-confirmations — the call queue.
 *
 * Defaults to escalated orders, oldest first, because that is the only view
 * anyone actually needs: the list of buyers a human has to ring before policy
 * decides for them. Everything else is filterable but nothing else is a job.
 *
 * Unlike the vendor view, this one DOES return the risk reasons. The agent
 * about to make the call needs to know whether they are ringing a first-time
 * buyer with a vague address or someone with three returns behind them, because
 * those are different conversations.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const confirmations: any = req.scope.resolve(ORDER_CONFIRMATION_MODULE);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const q = req.query as Record<string, string | undefined>;
  const status = q.status ? q.status.split(",") : [ConfirmationStatus.ESCALATED];
  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
  const offset = Number(q.offset ?? 0) || 0;

  const filters: Record<string, unknown> = { status };
  if (q.seller_id) filters.seller_id = q.seller_id;
  if (q.risk_band) filters.risk_band = q.risk_band.split(",");

  const [rows, count] = await confirmations.listAndCountOrderConfirmations(
    filters as any,
    { take: limit, skip: offset, order: { created_at: "ASC" } }
  );

  // Order numbers in one query rather than per row. An ops queue that opens in
  // two seconds gets worked; one that takes ten does not.
  const displayIds = await displayIdsFor(
    query,
    rows.map((r: any) => r.order_id)
  );

  return res.json({
    order_confirmations: rows.map((c: any) => ({
      id: c.id,
      order_id: c.order_id,
      display_id: displayIds.get(c.order_id) ?? null,
      seller_id: c.seller_id,
      phone: c.phone,
      amount: Number(c.order_amount),
      currency_code: c.currency_code,
      status: c.status,
      policy: c.policy,
      /** What happens if nobody works this: STRICT cancels, VERIFY ships. */
      timeout_outcome: c.policy === "strict" ? "cancel" : "confirm",
      risk_band: c.risk_band,
      risk_score: c.risk_score,
      risk_reasons: c.risk_reasons ?? [],
      attempts: c.attempts,
      last_attempt_at: c.last_attempt_at,
      /** When policy takes over. The queue is sorted by urgency against this. */
      decides_at: c.next_action_at,
      created_at: c.created_at,
    })),
    count,
    limit,
    offset,
  });
}

async function displayIdsFor(
  query: any,
  orderIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!orderIds.length) return map;

  try {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "display_id"],
      filters: { id: orderIds },
    });
    for (const o of data ?? []) map.set(o.id, o.display_id);
  } catch {
    // Cosmetic. The queue is still workable without order numbers.
  }
  return map;
}
