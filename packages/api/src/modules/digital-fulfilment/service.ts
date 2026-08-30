import crypto from "node:crypto";
import type { Context } from "@medusajs/framework/types";
import {
  InjectManager,
  MedusaContext,
  MedusaService,
} from "@medusajs/framework/utils";

import { DigitalCode, DigitalDelivery } from "./models";
import { CodeStatus } from "./models/digital-code";
import { DeliveryStatus, FraudDecision } from "./models/digital-delivery";
import { fingerprint, maskCode, seal, unseal } from "./vault-crypto";

/**
 * The code vault and the delivery ledger.
 *
 * Two responsibilities that belong together because the dangerous operation
 * spans both: taking a code out of stock and attaching it to an order line has
 * to happen exactly once, and the two halves must not be able to disagree.
 */

export type UploadResult = {
  added: number;
  duplicates: number;
  invalid: number;
  batchId: string;
};

class DigitalFulfilmentModuleService extends MedusaService({
  DigitalCode,
  DigitalDelivery,
}) {
  // ------------------------------------------------------------------- vault

  /**
   * Add a batch of codes to a vendor's stock.
   *
   * Duplicates are counted and skipped rather than rejected wholesale. A vendor
   * pasting a spreadsheet that overlaps last week's upload is doing something
   * completely normal; failing the whole batch would teach them to stop using
   * the feature.
   */
  async uploadCodes(input: {
    sellerId: string;
    offerId: string;
    variantId?: string | null;
    codes: string[];
    expiresAt?: Date | null;
  }): Promise<UploadResult> {
    const batchId = `batch_${crypto.randomBytes(8).toString("hex")}`;

    const seen = new Set<string>();
    const rows: any[] = [];
    let invalid = 0;
    let duplicates = 0;

    for (const raw of input.codes) {
      const code = String(raw ?? "").trim();
      if (!code || code.length < 4) {
        invalid += 1;
        continue;
      }

      const fp = fingerprint(input.sellerId, code);

      // Within the batch itself, before touching the database.
      if (seen.has(fp)) {
        duplicates += 1;
        continue;
      }
      seen.add(fp);

      const sealed = seal(code);
      rows.push({
        seller_id: input.sellerId,
        offer_id: input.offerId,
        variant_id: input.variantId ?? null,
        status: CodeStatus.AVAILABLE,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        auth_tag: sealed.auth_tag,
        fingerprint: fp,
        masked: maskCode(code),
        expires_at: input.expiresAt ?? null,
        batch_id: batchId,
      });
    }

    // Against stock already held. The unique index is the real guarantee; this
    // check exists so the vendor gets a count rather than a constraint error.
    if (rows.length) {
      const existing = await this.listDigitalCodes(
        {
          seller_id: input.sellerId,
          fingerprint: rows.map((r) => r.fingerprint),
        } as any,
        { select: ["id", "fingerprint"], take: rows.length }
      );
      const have = new Set(existing.map((e: any) => e.fingerprint));
      const fresh = rows.filter((r) => !have.has(r.fingerprint));
      duplicates += rows.length - fresh.length;

      if (fresh.length) await this.createDigitalCodes(fresh);
      return { added: fresh.length, duplicates, invalid, batchId };
    }

    return { added: 0, duplicates, invalid, batchId };
  }

  /** Sellable stock for an offer. This is the inventory number that matters. */
  async availableStock(offerId: string): Promise<number> {
    const [, count] = await this.listAndCountDigitalCodes(
      { offer_id: offerId, status: CodeStatus.AVAILABLE } as any,
      { take: 1 }
    );
    return count;
  }

  /**
   * Claim one available code for an order line.
   *
   * The dangerous operation, and the reason this method looks like SQL instead
   * of the module's own query helpers. Two buyers must never receive the same
   * code: both have already paid, and the second to redeem finds their PIN
   * spent with no way to make it right.
   *
   * The first version of this read the oldest available row, re-read it to
   * confirm, then wrote — and relied on callers holding a Redis lock. A
   * concurrency test fired twenty simultaneous buyers at it and **all twenty
   * received the same code**, because a lock held by the caller is a lock the
   * next caller can forget. The first thing to forget it was the test.
   *
   * So the claim is now a single atomic statement. `FOR UPDATE SKIP LOCKED` is
   * exactly the primitive for this: each concurrent transaction locks a
   * different row and skips the ones already taken, so twenty buyers take
   * twenty different codes with no coordination and no distributed lock at all.
   *
   * Returns null when there is no stock. That is a real operational state
   * rather than an error: the buyer has paid, and ops must refund or restock.
   */
  @InjectManager()
  async allocateCode(
    input: {
      offerId: string;
      orderLineId: string;
      orderId: string;
    },
    @MedusaContext() context: Context = {}
  ): Promise<any | null> {
    const manager = context.manager as any;

    // Re-entrancy: a retried event must not consume a second code. Checked
    // first, and also guaranteed by the unique index on allocated_to_line_id.
    const [already] = await this.listDigitalCodes(
      { allocated_to_line_id: input.orderLineId } as any,
      { take: 1 }
    );
    if (already) return already;

    const rows = await manager.execute(
      `UPDATE pk_digital_code
          SET status = ?,
              allocated_to_line_id = ?,
              allocated_to_order_id = ?,
              allocated_at = NOW(),
              updated_at = NOW()
        WHERE id = (
                SELECT id
                  FROM pk_digital_code
                 WHERE offer_id = ?
                   AND status = ?
                   AND deleted_at IS NULL
                   AND (expires_at IS NULL OR expires_at > NOW())
                 ORDER BY created_at
                   FOR UPDATE SKIP LOCKED
                 LIMIT 1
              )
        RETURNING id`,
      [
        CodeStatus.ALLOCATED,
        input.orderLineId,
        input.orderId,
        input.offerId,
        CodeStatus.AVAILABLE,
      ]
    );

    const claimedId = rows?.[0]?.id;
    if (!claimedId) return null;

    return await this.retrieveDigitalCode(claimedId);
  }

  /**
   * Return an unsold code to stock.
   *
   * Only legitimate while the buyer has not seen it. Callers check
   * `first_revealed_at`; this method enforces the status side.
   */
  async releaseCode(codeId: string): Promise<void> {
    const code = await this.retrieveDigitalCode(codeId);
    if (code.status === CodeStatus.DELIVERED) {
      throw new Error(
        `Code ${codeId} has been delivered and cannot return to stock. ` +
          "There is no way to know whether the buyer has spent it."
      );
    }
    await this.updateDigitalCodes({
      id: codeId,
      status: CodeStatus.AVAILABLE,
      allocated_to_line_id: null,
      allocated_to_order_id: null,
      allocated_at: null,
    } as any);
  }

  /**
   * Decrypt a code for the buyer who paid for it.
   *
   * The only method that returns plaintext. Callers must have already checked
   * that the delivery is theirs and has cleared the fraud gate.
   */
  async revealCode(codeId: string): Promise<string> {
    const code = await this.retrieveDigitalCode(codeId);
    const plaintext = unseal({
      ciphertext: code.ciphertext,
      iv: code.iv,
      auth_tag: code.auth_tag,
    });

    if (code.status !== CodeStatus.DELIVERED) {
      await this.updateDigitalCodes({
        id: codeId,
        status: CodeStatus.DELIVERED,
        delivered_at: new Date(),
      } as any);
    }

    return plaintext;
  }

  // ---------------------------------------------------------------- delivery

  /** Idempotent on order_line_id: order events get delivered more than once. */
  async openDelivery(input: {
    orderLineId: string;
    orderId: string;
    sellerId: string;
    offerId?: string | null;
    customerId?: string | null;
    phone?: string | null;
    buyerVerified?: boolean;
    productType: string;
    quantity?: number;
    amount?: number;
    currencyCode?: string;
    fulfilmentInput?: Record<string, unknown> | null;
  }): Promise<{ delivery: any; created: boolean }> {
    const [existing] = await this.listDigitalDeliveries(
      { order_line_id: input.orderLineId } as any,
      { take: 1 }
    );
    if (existing) return { delivery: existing, created: false };

    const delivery = await this.createDigitalDeliveries({
      order_line_id: input.orderLineId,
      order_id: input.orderId,
      seller_id: input.sellerId,
      offer_id: input.offerId ?? null,
      customer_id: input.customerId ?? null,
      phone: input.phone ?? null,
      buyer_verified: input.buyerVerified ?? false,
      product_type: input.productType,
      quantity: input.quantity ?? 1,
      amount: input.amount ?? 0,
      currency_code: input.currencyCode ?? "pkr",
      status: DeliveryStatus.PENDING,
      fulfilment_input: input.fulfilmentInput ?? null,
    } as any);

    return { delivery, created: true };
  }

  async recordFraudDecision(
    id: string,
    assessment: { decision: string; score: number; reasons: string[] }
  ): Promise<any> {
    return await this.updateDigitalDeliveries({
      id,
      fraud_decision: assessment.decision,
      fraud_score: assessment.score,
      fraud_reasons: assessment.reasons,
      status:
        assessment.decision === FraudDecision.RELEASE
          ? DeliveryStatus.READY
          : assessment.decision === FraudDecision.REFUSE
            ? DeliveryStatus.REFUSED
            : DeliveryStatus.HELD,
      reviewed_at:
        assessment.decision === FraudDecision.REFUSE ? new Date() : null,
      reviewed_by:
        assessment.decision === FraudDecision.REFUSE ? "system" : null,
    } as any);
  }

  async markDelivered(id: string): Promise<any> {
    return await this.updateDigitalDeliveries({
      id,
      status: DeliveryStatus.DELIVERED,
      delivered_at: new Date(),
    } as any);
  }

  async markOutOfStock(id: string): Promise<any> {
    return await this.updateDigitalDeliveries({
      id,
      status: DeliveryStatus.OUT_OF_STOCK,
      failure_reason:
        "Cleared for delivery but the vendor had no codes left in stock.",
    } as any);
  }

  // ------------------------------------------------------------------ tokens
  //
  // Same construction as the order-confirmation reveal link: derived from a
  // stored salt and the app secret, so the token is never written down and the
  // same link can be regenerated for a resend.

  private deriveToken(id: string, salt: string): string {
    return crypto
      .createHmac("sha256", process.env.JWT_SECRET ?? "dev")
      .update(`ddlv:${id}:${salt}`)
      .digest("base64url");
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  async issueToken(id: string): Promise<string> {
    const d = await this.retrieveDigitalDelivery(id);
    if (d.token_salt) return this.deriveToken(d.id, d.token_salt);

    const salt = crypto.randomBytes(24).toString("base64url");
    const token = this.deriveToken(d.id, salt);
    await this.updateDigitalDeliveries({
      id: d.id,
      token_salt: salt,
      token_hash: this.hashToken(token),
    } as any);
    return token;
  }

  async findByToken(token: string): Promise<any | null> {
    if (!token || token.length < 20) return null;
    const [found] = await this.listDigitalDeliveries(
      { token_hash: this.hashToken(token) } as any,
      { take: 1 }
    );
    return found ?? null;
  }

  /**
   * Count a reveal.
   *
   * The first one is what makes the order non-refundable, so it is recorded
   * before the code is handed over rather than after. If the response never
   * reaches the buyer we would rather have wrongly marked it revealed than
   * wrongly refunded a code somebody already read.
   */
  async countReveal(id: string): Promise<any> {
    const d = await this.retrieveDigitalDelivery(id);
    return await this.updateDigitalDeliveries({
      id,
      first_revealed_at: d.first_revealed_at ?? new Date(),
      reveal_count: (d.reveal_count ?? 0) + 1,
    } as any);
  }

  /** True while the buyer has never seen the code, so a refund is still clean. */
  async isRefundable(orderLineId: string): Promise<boolean> {
    const [d] = await this.listDigitalDeliveries(
      { order_line_id: orderLineId } as any,
      { take: 1 }
    );
    if (!d) return true;
    return !d.first_revealed_at;
  }

  // --------------------------------------------------------------- velocity

  /**
   * Everything the fraud scorer needs about a phone number, in one pass.
   *
   * Reads our own delivery records rather than the order tables: what matters
   * is the digital outcome we observed, and it keeps this cheap enough to run
   * inline on every order.
   */
  async velocityForPhone(phone: string, excludeLineId?: string) {
    const rows = await this.listDigitalDeliveries({ phone } as any, {
      take: 500,
      order: { created_at: "DESC" },
    });
    const relevant = rows.filter((r: any) => r.order_line_id !== excludeLineId);

    const now = Date.now();
    const withinHour = (r: any) =>
      now - new Date(r.created_at).getTime() < 3600_000;
    const withinDay = (r: any) =>
      now - new Date(r.created_at).getTime() < 86_400_000;

    const targets = new Set<string>();
    for (const r of relevant) {
      const input = (r.fulfilment_input ?? {}) as Record<string, unknown>;
      const t = input.target ?? input.player_id ?? input.msisdn;
      if (t) targets.add(String(t));
    }

    return {
      ordersLastHour: relevant.filter(withinHour).length,
      ordersLastDay: relevant.filter(withinDay).length,
      valueLastDay: relevant
        .filter(withinDay)
        .reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0),
      priorRefusals: relevant.filter(
        (r: any) => r.status === DeliveryStatus.REFUSED
      ).length,
      priorDeliveries: relevant.filter(
        (r: any) => r.status === DeliveryStatus.DELIVERED
      ).length,
      distinctTargets: targets.size,
    };
  }
}

export default DigitalFulfilmentModuleService;
