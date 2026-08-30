import {
  ConfirmationPolicy,
  type ConfirmationPolicyValue,
  RiskBand,
} from "./models/order-confirmation";

/**
 * RTO risk scoring for a freshly placed order.
 *
 * A pure function on purpose: this is the piece most likely to be wrong on day
 * one and most likely to be retuned once we have real delivery data, so it has
 * to be testable without a database, a courier or a running server.
 *
 * The scale is 0-100. Higher is riskier. Bands and thresholds are deliberately
 * conservative at launch because the cost of the two mistakes is asymmetric:
 * over-verifying delays an order by an hour, while cancelling a good order
 * loses it permanently and probably loses the buyer too.
 */

export type BuyerHistory = {
  /** Orders on this phone that reached the buyer and were kept. */
  deliveredOrders: number;
  /** Orders on this phone that came back. The strongest single signal. */
  rtoOrders: number;
  /** Orders currently in flight. Several at once on a new number is a flag. */
  openOrders: number;
  /** Days since we first saw this number. 0 for a brand new buyer. */
  accountAgeDays: number;
};

export type RiskInput = {
  paymentMethod: "cod" | "prepaid";
  orderAmount: number;
  currencyCode?: string;
  history: BuyerHistory;
  address: {
    /** Free-text line, the part couriers actually navigate by. */
    line1?: string | null;
    city?: string | null;
    province?: string | null;
  };
  itemCount: number;
  /** True when the buyer signed in with an OTP rather than checking out as a guest. */
  phoneVerified: boolean;
};

export type RiskAssessment = {
  score: number;
  band: "low" | "medium" | "high";
  policy: ConfirmationPolicyValue;
  reasons: string[];
};

/**
 * Tunables. Env-overridable so the thresholds can be moved without a deploy
 * once real RTO data arrives, which it will, and it will not match these.
 */
export const RISK_CONFIG = {
  /** Above this, a COD order is never auto-confirmed however good the buyer. */
  HIGH_VALUE_PKR: num(process.env.PK_CONFIRM_HIGH_VALUE, 25_000),
  /** Rough average order value; used to scale the value component. */
  TYPICAL_ORDER_PKR: num(process.env.PK_CONFIRM_TYPICAL_VALUE, 3_500),
  /**
   * Low, for our purposes, means "we know this buyer". A first-time COD order
   * from an unknown number is the RTO cohort, so the medium threshold sits
   * below what a first-timer scores and they get asked. Asking costs one
   * message; not asking costs a round trip of freight.
   */
  MEDIUM_THRESHOLD: num(process.env.PK_CONFIRM_MEDIUM_AT, 15),
  HIGH_THRESHOLD: num(process.env.PK_CONFIRM_HIGH_AT, 45),
} as const;

function num(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons: string[] = [];

  // Prepaid is a different animal entirely. The money is already ours, so an
  // undelivered parcel is a refund rather than a loss, and there is nothing to
  // confirm. Delaying a customer who has already paid to ask whether they meant
  // it is the fastest way to look amateur.
  if (input.paymentMethod !== "cod") {
    return {
      score: 0,
      band: RiskBand.LOW,
      policy: ConfirmationPolicy.AUTO,
      reasons: ["Prepaid. Payment already taken, so there is no RTO exposure."],
    };
  }

  let score = 0;
  const h = input.history;

  // ---------------------------------------------------------------- history
  // History dominates. A buyer with a delivery record is a known quantity at
  // any order value, and treating them like a stranger is how you train good
  // customers to stop ordering.
  // One branch, not two. An earlier version added a return penalty and then
  // subtracted a delivery discount, which let a buyer with three returns and
  // four deliveries score as safe. The return RATE already prices the good
  // orders, so applying the discount on top counts them twice.
  if (h.rtoOrders > 0) {
    const rate = h.rtoOrders / Math.max(1, h.deliveredOrders + h.rtoOrders);
    score += Math.min(50, Math.round(rate * 55) + 12);
    reasons.push(
      `${h.rtoOrders} previous return${h.rtoOrders === 1 ? "" : "s"} on this number ` +
        `(${Math.round(rate * 100)}% of their orders).`
    );
  } else if (h.deliveredOrders >= 3) {
    score -= 25;
    reasons.push(`${h.deliveredOrders} orders delivered and kept. Trusted buyer.`);
  } else if (h.deliveredOrders >= 1) {
    score -= 12;
    reasons.push(`${h.deliveredOrders} previous delivery on this number.`);
  } else {
    score += 18;
    reasons.push("First order from this number.");
  }

  // Several open COD parcels to a number with no delivery record is the
  // classic pattern for both a prank and an address that does not exist.
  if (h.openOrders >= 3 && h.deliveredOrders === 0) {
    score += 20;
    reasons.push(`${h.openOrders} other orders already in flight, none delivered yet.`);
  }

  if (h.accountAgeDays >= 90 && h.deliveredOrders > 0) {
    score -= 8;
    reasons.push("Long-standing buyer.");
  }

  // ------------------------------------------------------------------ value
  // Value matters because it sets the size of the loss, not the probability of
  // it. Scaled rather than stepped, so there is no cliff where one rupee
  // changes the outcome.
  const ratio = input.orderAmount / RISK_CONFIG.TYPICAL_ORDER_PKR;
  if (ratio > 1) {
    const points = Math.min(30, Math.round(Math.log2(ratio) * 12));
    if (points > 0) {
      score += points;
      reasons.push(
        `Order value ${fmt(input.orderAmount)} is ${ratio.toFixed(1)}x typical.`
      );
    }
  }

  const highValue = input.orderAmount >= RISK_CONFIG.HIGH_VALUE_PKR;
  if (highValue) {
    reasons.push(
      `Above the ${fmt(RISK_CONFIG.HIGH_VALUE_PKR)} confirm-always threshold.`
    );
  }

  // ---------------------------------------------------------------- address
  // A courier who cannot find the address generates an RTO no matter how
  // genuine the buyer, so address quality is an RTO signal and not only a
  // fraud one.
  const line1 = (input.address.line1 ?? "").trim();
  if (line1.length < 12) {
    score += 15;
    reasons.push("Delivery address is very short; couriers may not find it.");
  }
  if (!(input.address.city ?? "").trim()) {
    score += 10;
    reasons.push("No city on the delivery address.");
  }

  // ------------------------------------------------------------------- misc
  if (!input.phoneVerified) {
    score += 8;
    reasons.push("Guest checkout; the number has not been verified by OTP.");
  }
  if (input.itemCount >= 6) {
    score += 6;
    reasons.push(`Unusually large basket (${input.itemCount} items).`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ------------------------------------------------------------------- band
  let band: RiskAssessment["band"];
  if (score >= RISK_CONFIG.HIGH_THRESHOLD) band = RiskBand.HIGH;
  else if (score >= RISK_CONFIG.MEDIUM_THRESHOLD) band = RiskBand.MEDIUM;
  else band = RiskBand.LOW;

  // A high-value COD order is confirmed regardless of what the score says. The
  // score can be wrong; the size of the loss cannot.
  if (highValue && band === RiskBand.LOW) {
    band = RiskBand.MEDIUM;
  }

  return { score, band, policy: policyFor(band), reasons };
}

/**
 * What silence means, per band.
 *
 * MEDIUM ships on silence and HIGH cancels on it. That asymmetry is the whole
 * point: for a typical COD order the expected RTO loss is smaller than the
 * value of the order we would throw away by treating a quiet buyer as a
 * refusal, and most buyers are quiet. Only once the risk is high enough does
 * that arithmetic flip.
 */
export function policyFor(band: string): ConfirmationPolicyValue {
  if (band === RiskBand.HIGH) return ConfirmationPolicy.STRICT;
  if (band === RiskBand.MEDIUM) return ConfirmationPolicy.VERIFY;
  return ConfirmationPolicy.AUTO;
}

function fmt(n: number) {
  return `Rs ${Math.round(n).toLocaleString("en-PK")}`;
}
