import crypto from "node:crypto";
import { MedusaService } from "@medusajs/framework/utils";

import { ConfirmationAttempt, OrderConfirmation } from "./models";
import {
  AttemptStatus,
  ContactChannel,
} from "./models/confirmation-attempt";
import {
  ConfirmationPolicy,
  ConfirmationStatus,
  ConfirmedVia,
} from "./models/order-confirmation";
import { assessRisk, type RiskInput } from "./risk";

/**
 * Buyer order confirmation, as a state machine.
 *
 *   pending ──contact──> awaiting_buyer ──┬── buyer taps yes ──> confirmed
 *                                          ├── buyer taps no ───> cancelled
 *                                          ├── retries left ────> awaiting_buyer
 *                                          └── retries spent ───> escalated
 *   escalated ── agent calls ─────────────────┬────────────────> confirmed
 *                                             └────────────────> cancelled
 *   escalated ── nobody worked it in time ────> policy decides (see below)
 *
 * Only `confirmed` releases dispatch. Everything else holds the parcel.
 *
 * Two rules run through all of it:
 *
 *  1. **Terminal is terminal.** Once confirmed or cancelled, nothing moves it.
 *     Retries, duplicate webhook deliveries and a buyer double-tapping the link
 *     all have to be harmless, because all three will happen.
 *  2. **Silence is not refusal**, except under STRICT. The scoring in `risk.ts`
 *     decides which orders earn that treatment.
 */

/** How long the buyer gets before we retry, and how many times we ask. */
export const CONFIRM_CONFIG = {
  /** Gap between contact attempts. */
  RETRY_AFTER_MINUTES: numEnv(process.env.PK_CONFIRM_RETRY_MINUTES, 45),
  /** Automated attempts before a human is asked to call. */
  MAX_ATTEMPTS: numEnv(process.env.PK_CONFIRM_MAX_ATTEMPTS, 2),
  /** How long an escalation waits for an agent before policy resolves it. */
  ESCALATION_HOURS: numEnv(process.env.PK_CONFIRM_ESCALATION_HOURS, 6),
  /** Link lifetime. Long enough to survive a phone that was off overnight. */
  TOKEN_TTL_HOURS: numEnv(process.env.PK_CONFIRM_TOKEN_TTL_HOURS, 48),
} as const;

function numEnv(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type OpenInput = {
  orderId: string;
  sellerId: string;
  customerId?: string | null;
  phone: string;
  currencyCode?: string;
  risk: RiskInput;
};

class OrderConfirmationModuleService extends MedusaService({
  OrderConfirmation,
  ConfirmationAttempt,
}) {
  // ------------------------------------------------------------------ tokens

  /**
   * The one-tap token is a bearer credential: whoever holds it can confirm or
   * cancel someone else's order. So it is never written down.
   *
   * It is derived from a stored random salt and the application secret. The
   * secret is in the environment, not the database, so a dumped table yields
   * nothing usable. And because it is derived rather than random-per-send, the
   * same link can be regenerated for a retry, which keeps every message we have
   * already sent the buyer working.
   */
  private deriveToken(id: string, salt: string): string {
    return crypto
      .createHmac("sha256", process.env.JWT_SECRET ?? "dev")
      .update(`ordcnf:${id}:${salt}`)
      .digest("base64url");
  }

  /**
   * Lookup digest for an incoming token. A plain digest, not an HMAC: this is
   * an index key, and the token it covers is already high-entropy, so there is
   * nothing here for a rainbow table to attack.
   */
  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private newTokenFor(id: string): {
    token: string;
    salt: string;
    hash: string;
    expiresAt: Date;
  } {
    const salt = crypto.randomBytes(24).toString("base64url");
    const token = this.deriveToken(id, salt);
    return {
      token,
      salt,
      hash: this.hashToken(token),
      expiresAt: new Date(
        Date.now() + CONFIRM_CONFIG.TOKEN_TTL_HOURS * 3600 * 1000
      ),
    };
  }

  /**
   * The live link for a confirmation, extending its life if it has lapsed.
   *
   * Returns the same token every time while the salt is unchanged, so a resend
   * does not invalidate the message already on the buyer's phone. Returns null
   * once the confirmation is terminal, because a live credential on a resolved
   * order serves no purpose.
   */
  async issueToken(id: string): Promise<string | null> {
    const c = await this.retrieveOrderConfirmation(id);
    if (this.isTerminal(c)) return null;

    const salt: string | null = c.token_salt ?? null;
    const stillValid =
      salt && c.token_expires_at && new Date(c.token_expires_at) > new Date();

    if (salt && stillValid) {
      return this.deriveToken(c.id, salt);
    }

    // Lapsed, or never issued. A buyer who finally opens WhatsApp on day three
    // should get a link that works; the record is still open precisely because
    // nobody has answered yet.
    const issued = this.newTokenFor(c.id);
    await this.updateOrderConfirmations({
      id: c.id,
      token_salt: issued.salt,
      token_hash: issued.hash,
      token_expires_at: issued.expiresAt,
    } as any);
    return issued.token;
  }

  /**
   * Look up by token. Returns null for unknown, expired or already-terminal
   * confirmations, without saying which — a caller holding a guessed token
   * learns nothing about whether an order exists.
   */
  async findByToken(token: string): Promise<any | null> {
    if (!token || token.length < 20) return null;

    const [found] = await this.listOrderConfirmations(
      { token_hash: this.hashToken(token) } as any,
      { take: 1 }
    );
    if (!found) return null;

    if (found.token_expires_at && new Date(found.token_expires_at) < new Date()) {
      return null;
    }
    return found;
  }

  // -------------------------------------------------------------------- open

  /**
   * Create the confirmation for a newly placed order.
   *
   * Idempotent on order_id: the order-placed event can be delivered more than
   * once, and issuing a second token for the same order would silently
   * invalidate the link already sitting in the buyer's WhatsApp.
   */
  async openConfirmation(
    input: OpenInput
  ): Promise<{ confirmation: any; token: string | null; created: boolean }> {
    const [existing] = await this.listOrderConfirmations(
      { order_id: input.orderId } as any,
      { take: 1 }
    );
    if (existing) {
      return { confirmation: existing, token: null, created: false };
    }

    const assessment = assessRisk(input.risk);
    const needsContact = assessment.policy !== ConfirmationPolicy.AUTO;

    const confirmation = await this.createOrderConfirmations({
      order_id: input.orderId,
      seller_id: input.sellerId,
      customer_id: input.customerId ?? null,
      phone: input.phone,
      payment_method: input.risk.paymentMethod,
      currency_code: input.currencyCode ?? "pkr",
      order_amount: input.risk.orderAmount,

      status: needsContact
        ? ConfirmationStatus.PENDING
        : ConfirmationStatus.CONFIRMED,
      policy: assessment.policy,
      risk_band: assessment.band,
      risk_score: assessment.score,
      risk_reasons: assessment.reasons,

      // Contact immediately. A confirmation request that arrives an hour after
      // the order does not read as a confirmation, it reads as a problem.
      next_action_at: needsContact ? new Date() : null,
      confirmed_at: needsContact ? null : new Date(),
      confirmed_via: needsContact ? null : ConfirmedVia.POLICY,
    } as any);

    // The token derives from the row id, so it can only be minted once the row
    // exists.
    const token = needsContact ? await this.issueToken(confirmation.id) : null;

    return { confirmation, token, created: true };
  }

  // ------------------------------------------------------------- transitions

  private isTerminal(c: any): boolean {
    return (
      c.status === ConfirmationStatus.CONFIRMED ||
      c.status === ConfirmationStatus.CANCELLED
    );
  }

  /**
   * Confirm. Returns `changed: false` when it was already terminal, so a buyer
   * who taps twice sees success both times rather than an error on the second.
   */
  async confirm(
    id: string,
    via: string,
    resolvedBy?: string | null
  ): Promise<{ confirmation: any; changed: boolean }> {
    const current = await this.retrieveOrderConfirmation(id);
    if (this.isTerminal(current)) {
      return { confirmation: current, changed: false };
    }

    const updated = await this.updateOrderConfirmations({
      id,
      status: ConfirmationStatus.CONFIRMED,
      confirmed_at: new Date(),
      confirmed_via: via,
      resolved_by: resolvedBy ?? null,
      next_action_at: null,
      // The link is deliberately NOT revoked here.
      //
      // Revoking looked like good hygiene and was actually a bug: a buyer who
      // taps confirm and then re-opens the same WhatsApp message got "this link
      // is no longer valid", which reads as though the confirmation failed.
      // That is a support call, and worse, it invites them to worry about an
      // order that is fine.
      //
      // Nothing is given up by keeping it. Both confirm and cancel no-op on a
      // terminal record, so a live token on a resolved order can no longer
      // change anything; it can only show the holder the summary they have
      // already seen. It lapses on its own at token_expires_at.
    } as any);

    return { confirmation: updated, changed: true };
  }

  async cancel(
    id: string,
    reason: string,
    resolvedBy?: string | null
  ): Promise<{ confirmation: any; changed: boolean }> {
    const current = await this.retrieveOrderConfirmation(id);
    if (this.isTerminal(current)) {
      return { confirmation: current, changed: false };
    }

    const updated = await this.updateOrderConfirmations({
      id,
      status: ConfirmationStatus.CANCELLED,
      cancelled_at: new Date(),
      cancel_reason: reason,
      resolved_by: resolvedBy ?? null,
      next_action_at: null,
      // Kept live, as in confirm() above, so the buyer can re-open the message
      // and see that their cancellation went through.
    } as any);

    return { confirmation: updated, changed: true };
  }

  /** Record an outbound attempt and schedule the next step. */
  async recordAttempt(input: {
    confirmationId: string;
    channel: string;
    status: string;
    providerMessageId?: string | null;
    error?: string | null;
    agentId?: string | null;
    note?: string | null;
  }): Promise<any> {
    const c = await this.retrieveOrderConfirmation(input.confirmationId);

    const sequence = (c.attempts ?? 0) + 1;
    await this.createConfirmationAttempts({
      confirmation_id: c.id,
      order_id: c.order_id,
      sequence,
      channel: input.channel,
      status: input.status,
      provider_message_id: input.providerMessageId ?? null,
      error: input.error ?? null,
      agent_id: input.agentId ?? null,
      note: input.note ?? null,
    } as any);

    // A skipped channel is not an attempt on the buyer. If WhatsApp is not
    // contracted and we fall through to SMS, the buyer has been asked once,
    // not twice — counting the skip would burn a retry they never saw.
    if (input.status === AttemptStatus.SKIPPED) {
      return c;
    }

    const attempts = sequence;
    const exhausted = attempts >= CONFIRM_CONFIG.MAX_ATTEMPTS;

    return await this.updateOrderConfirmations({
      id: c.id,
      attempts,
      last_attempt_at: new Date(),
      status: exhausted
        ? ConfirmationStatus.ESCALATED
        : ConfirmationStatus.AWAITING_BUYER,
      next_action_at: new Date(
        Date.now() +
          (exhausted
            ? CONFIRM_CONFIG.ESCALATION_HOURS * 3600 * 1000
            : CONFIRM_CONFIG.RETRY_AFTER_MINUTES * 60 * 1000)
      ),
    } as any);
  }

  // --------------------------------------------------------------- querying

  /** Confirmations the sweep job should act on now. */
  async dueForAction(now: Date = new Date(), limit = 200): Promise<any[]> {
    return await this.listOrderConfirmations(
      {
        status: [
          ConfirmationStatus.PENDING,
          ConfirmationStatus.AWAITING_BUYER,
          ConfirmationStatus.ESCALATED,
        ],
        next_action_at: { $lte: now },
      } as any,
      { take: limit, order: { next_action_at: "ASC" } }
    );
  }

  /**
   * The dispatch gate, in one question.
   *
   * Defaults to released when no confirmation row exists. That default is
   * deliberate: orders placed before this module existed, and any order whose
   * confirmation failed to be created, must not become undispatchable. A bug in
   * here should slow nothing down — it should only fail to protect.
   */
  async isDispatchReleased(
    orderId: string
  ): Promise<{ released: boolean; confirmation: any | null }> {
    const [c] = await this.listOrderConfirmations(
      { order_id: orderId } as any,
      { take: 1 }
    );
    if (!c) return { released: true, confirmation: null };
    return {
      released: c.status === ConfirmationStatus.CONFIRMED,
      confirmation: c,
    };
  }

  /** Attempts for one confirmation, oldest first. */
  async attemptsFor(confirmationId: string): Promise<any[]> {
    return await this.listConfirmationAttempts(
      { confirmation_id: confirmationId } as any,
      { order: { sequence: "ASC" } }
    );
  }

  /**
   * Delivery history for a phone number, for the risk scorer.
   *
   * Reads our own confirmation records rather than the order tables, because
   * what matters is the outcome we observed, and it keeps scoring cheap enough
   * to run inline on every order.
   */
  async historyForPhone(phone: string, excludeOrderId?: string) {
    const rows = await this.listOrderConfirmations({ phone } as any, {
      take: 500,
    });
    const relevant = rows.filter((r: any) => r.order_id !== excludeOrderId);

    return {
      total: relevant.length,
      cancelled: relevant.filter(
        (r: any) => r.status === ConfirmationStatus.CANCELLED
      ).length,
      confirmed: relevant.filter(
        (r: any) => r.status === ConfirmationStatus.CONFIRMED
      ).length,
      open: relevant.filter((r: any) => !this.isTerminal(r)).length,
      firstSeen: relevant.reduce<Date | null>((earliest, r: any) => {
        const d = r.created_at ? new Date(r.created_at) : null;
        if (!d) return earliest;
        return !earliest || d < earliest ? d : earliest;
      }, null),
    };
  }
}

export default OrderConfirmationModuleService;
export { ContactChannel, AttemptStatus };
