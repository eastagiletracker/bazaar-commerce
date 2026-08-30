import { model } from "@medusajs/framework/utils";

/**
 * Buyer confirmation of a COD order, before the seller is allowed to dispatch.
 *
 * Why this exists: RTO (return to origin) runs 20-40% on Pakistani cash on
 * delivery, and the seller pays freight in both directions. A parcel that comes
 * back has cost them two legs of shipping and earned nothing. Getting the buyer
 * to say "yes, still want it" before the box moves is the cheapest lever
 * against that, and it is worth more to a seller than several points of
 * commission.
 *
 * It is also the one thing here that protects us: an RTO parcel produces no
 * commission, and a COD order that never delivers still consumes courier
 * bookings and support time.
 *
 * The design constraint that shapes everything below: **most buyers will not
 * reply to anything.** A flow that cancels every order whose buyer stayed
 * silent would destroy far more good orders than the RTO it prevents. So
 * silence is not treated as refusal by default — only for the risk band where
 * the expected loss from shipping actually exceeds the expected loss from
 * cancelling. See `policy` below.
 */

export const ConfirmationStatus = {
  /** Created, no outreach attempted yet. */
  PENDING: "pending",
  /** Contacted at least once, waiting on the buyer. */
  AWAITING_BUYER: "awaiting_buyer",
  /** Automated attempts exhausted. A human owns it now. */
  ESCALATED: "escalated",
  /** Buyer confirmed, or policy confirmed on their behalf. Dispatch released. */
  CONFIRMED: "confirmed",
  /** Buyer declined, or policy cancelled. Terminal, nothing ships. */
  CANCELLED: "cancelled",
} as const;

export type ConfirmationStatusValue =
  (typeof ConfirmationStatus)[keyof typeof ConfirmationStatus];

/**
 * What silence means, decided once at creation from the risk band.
 *
 * This is the load-bearing choice in the whole module. Confirming everything
 * costs money and delays every order; cancelling on silence costs orders. The
 * split says: only make the buyer's silence fatal when shipping the parcel is
 * the more expensive mistake.
 */
export const ConfirmationPolicy = {
  /** No outreach. Confirmed on creation. Prepaid, and low-risk COD. */
  AUTO: "auto",
  /** Ask, but ship anyway if they never answer. The default for COD. */
  VERIFY: "verify",
  /** Ask, and cancel if they never answer. High risk only. */
  STRICT: "strict",
} as const;

export type ConfirmationPolicyValue =
  (typeof ConfirmationPolicy)[keyof typeof ConfirmationPolicy];

export const RiskBand = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

/** How a confirmation reached its terminal state. Kept for audit and tuning. */
export const ConfirmedVia = {
  /** Buyer tapped confirm on the link we sent. */
  LINK: "link",
  /** A human called and confirmed on the buyer's behalf. */
  AGENT: "agent",
  /** Policy said no outreach was needed. */
  POLICY: "policy",
  /** Outreach window elapsed with no reply, and policy ships on silence. */
  TIMEOUT: "timeout",
} as const;

const OrderConfirmation = model
  .define("pk_order_confirmation", {
    id: model.id({ prefix: "ordcnf" }).primaryKey(),
    order_id: model.text().unique(),
    seller_id: model.text(),
    customer_id: model.text().nullable(),

    /** E.164. The number the courier will ring, so it is the one we contact. */
    phone: model.text(),
    payment_method: model.text(),
    currency_code: model.text().default("pkr"),
    order_amount: model.bigNumber(),

    status: model.enum(Object.values(ConfirmationStatus)).default("pending"),
    policy: model.enum(Object.values(ConfirmationPolicy)),

    risk_band: model.enum(Object.values(RiskBand)),
    risk_score: model.number().default(0),
    /** Human-readable reasons, so an ops agent can see why this was flagged. */
    risk_reasons: model.json().nullable(),

    /**
     * One-tap link credentials.
     *
     * The token is never stored. It is DERIVED as HMAC(JWT_SECRET, id:salt),
     * so any send can regenerate the same link, and `token_hash` is a plain
     * digest of it, kept only so an incoming token can be looked up.
     *
     * Deriving rather than storing buys two things at once. A database dump on
     * its own yields neither the token nor anything that can be turned into
     * one, because the secret lives in the environment and not in the table.
     * And the link stays STABLE across retries: a buyer who ignores the
     * WhatsApp, gets the SMS, then goes back and taps the original message
     * still lands on a working page. Minting a fresh token per attempt would
     * quietly break every earlier message, which is a conversion loss disguised
     * as a security measure.
     */
    token_salt: model.text().nullable(),
    token_hash: model.text().nullable(),
    token_expires_at: model.dateTime().nullable(),

    attempts: model.number().default(0),
    last_attempt_at: model.dateTime().nullable(),
    /** When the sweep job should next act. Null once terminal. */
    next_action_at: model.dateTime().nullable(),

    confirmed_at: model.dateTime().nullable(),
    confirmed_via: model.text().nullable(),
    /** Set when an agent resolves it, for accountability on manual overrides. */
    resolved_by: model.text().nullable(),

    cancelled_at: model.dateTime().nullable(),
    cancel_reason: model.text().nullable(),
  })
  .indexes([
    { on: ["status", "next_action_at"] },
    { on: ["seller_id", "status"] },
    { on: ["token_hash"] },
    { on: ["phone"] },
  ]);

export default OrderConfirmation;
