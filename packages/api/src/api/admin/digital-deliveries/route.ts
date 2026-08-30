import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { DIGITAL_FULFILMENT_MODULE } from "../../../modules/digital-fulfilment";
import { DeliveryStatus } from "../../../modules/digital-fulfilment/models/digital-delivery";

/**
 * GET /admin/digital-deliveries — the fraud review queue.
 *
 * Defaults to held and out-of-stock, which are the two states where a buyer has
 * paid and is waiting on a human. Everything else is filterable but nothing
 * else is a job.
 *
 * Sorted oldest first. A digital buyer expects their code in seconds, so the
 * cost of a slow queue here is much higher than on the parcel side and the
 * oldest item is always the most urgent.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const digital: any = req.scope.resolve(DIGITAL_FULFILMENT_MODULE);

  const q = req.query as Record<string, string | undefined>;
  const status = q.status
    ? q.status.split(",")
    : [DeliveryStatus.HELD, DeliveryStatus.OUT_OF_STOCK];

  const filters: Record<string, unknown> = { status };
  if (q.seller_id) filters.seller_id = q.seller_id;

  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
  const [rows, count] = await digital.listAndCountDigitalDeliveries(
    filters as any,
    {
      take: limit,
      skip: Number(q.offset ?? 0) || 0,
      order: { created_at: "ASC" },
    }
  );

  return res.json({
    digital_deliveries: rows.map((d: any) => ({
      id: d.id,
      order_id: d.order_id,
      order_line_id: d.order_line_id,
      seller_id: d.seller_id,
      phone: d.phone,
      product_type: d.product_type,
      amount: Number(d.amount),
      currency_code: d.currency_code,
      status: d.status,
      fraud_decision: d.fraud_decision,
      fraud_score: d.fraud_score,
      // The agent needs these: "unverified number, first purchase" and "eight
      // orders in an hour" are completely different conversations.
      fraud_reasons: d.fraud_reasons ?? [],
      fulfilment_input: d.fulfilment_input ?? null,
      waiting_since: d.created_at,
    })),
    count,
    limit,
  });
}
