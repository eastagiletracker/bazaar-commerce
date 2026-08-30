import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { DIGITAL_FULFILMENT_MODULE } from "../../../modules/digital-fulfilment";

/**
 * POST /vendor/digital-codes — a vendor adds stock.
 *
 * Body: { offer_id, codes: string[], expires_at? }
 *
 * The response counts rather than lists. A vendor pasting an overlapping batch
 * is doing something completely normal, so duplicates are skipped and reported
 * instead of failing the upload; teaching them the feature rejects their work
 * is how you get them to stop using it.
 *
 * The request body is the last place the plaintext exists before it is sealed.
 * It is never echoed back, never logged, and the error paths below say what
 * went wrong without quoting the offending value.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const digital: any = req.scope.resolve(DIGITAL_FULFILMENT_MODULE);
  const sellerId = (req as any).seller_context?.seller_id;

  if (!sellerId) {
    return res.status(401).json({ message: "Seller context is required." });
  }

  const body = (req.body ?? {}) as {
    offer_id?: string;
    variant_id?: string;
    codes?: unknown;
    expires_at?: string;
  };

  if (!body.offer_id) {
    return res.status(400).json({ message: "offer_id is required." });
  }
  if (!Array.isArray(body.codes) || !body.codes.length) {
    return res.status(400).json({ message: "codes must be a non-empty array." });
  }
  // A cap, because a vendor pasting their whole inventory in one request will
  // otherwise time out halfway and leave them guessing what landed.
  if (body.codes.length > 5000) {
    return res.status(400).json({
      message: "Upload at most 5000 codes at a time.",
    });
  }

  const owns = await sellerOwnsOffer(req.scope, sellerId, body.offer_id);
  if (!owns) {
    return res.status(404).json({ message: "Offer not found." });
  }

  const result = await digital.uploadCodes({
    sellerId,
    offerId: body.offer_id,
    variantId: body.variant_id ?? null,
    codes: body.codes.map((c) => String(c)),
    expiresAt: body.expires_at ? new Date(body.expires_at) : null,
  });

  // Counts only. Never the codes.
  logger.info(
    `Seller ${sellerId} uploaded to offer ${body.offer_id}: ` +
      `${result.added} added, ${result.duplicates} duplicates, ${result.invalid} invalid.`
  );

  const stock = await digital.availableStock(body.offer_id);

  return res.json({
    added: result.added,
    duplicates: result.duplicates,
    invalid: result.invalid,
    batch_id: result.batchId,
    available_stock: stock,
    message:
      `${result.added} code${result.added === 1 ? "" : "s"} added. ` +
      (result.duplicates
        ? `${result.duplicates} were already in your stock and were skipped. `
        : "") +
      (result.invalid ? `${result.invalid} were blank or too short. ` : "") +
      `You now have ${stock} available to sell.`,
  });
}

/**
 * GET /vendor/digital-codes — stock levels and the audit trail.
 *
 * Returns masked codes only. A vendor already has their own copy; there is no
 * reason for this endpoint to be able to hand back a spendable code, and every
 * reason for it not to be.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const digital: any = req.scope.resolve(DIGITAL_FULFILMENT_MODULE);
  const sellerId = (req as any).seller_context?.seller_id;

  if (!sellerId) {
    return res.status(401).json({ message: "Seller context is required." });
  }

  const q = req.query as Record<string, string | undefined>;
  const filters: Record<string, unknown> = { seller_id: sellerId };
  if (q.offer_id) filters.offer_id = q.offer_id;
  if (q.status) filters.status = q.status.split(",");

  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
  const [rows, count] = await digital.listAndCountDigitalCodes(filters as any, {
    take: limit,
    skip: Number(q.offset ?? 0) || 0,
    order: { created_at: "DESC" },
  });

  return res.json({
    digital_codes: rows.map((c: any) => ({
      id: c.id,
      offer_id: c.offer_id,
      masked: c.masked,
      status: c.status,
      batch_id: c.batch_id,
      expires_at: c.expires_at,
      allocated_at: c.allocated_at,
      delivered_at: c.delivered_at,
      order_id: c.allocated_to_order_id,
    })),
    count,
  });
}

/** Mercur scopes offers by seller; confirm before writing stock against one. */
async function sellerOwnsOffer(
  scope: any,
  sellerId: string,
  offerId: string
): Promise<boolean> {
  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "offer",
      fields: ["id", "seller_id"],
      filters: { id: offerId },
    });
    return data?.[0]?.seller_id === sellerId;
  } catch {
    return false;
  }
}
