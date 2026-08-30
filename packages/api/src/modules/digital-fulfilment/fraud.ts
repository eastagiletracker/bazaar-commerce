import { FraudDecision } from "./models/digital-delivery";

/**
 * Fraud scoring for digital delivery.
 *
 * A correction to what the digital-products plan assumed. It said the RTO risk
 * scorer would "transfer almost directly". The BANDS and the hold-or-release
 * shape transfer; the SIGNALS do not. Address quality is the strongest RTO
 * predictor and is meaningless for a code that never travels. Velocity is the
 * strongest digital predictor and does not appear in the RTO scorer at all. So
 * this is a separate function that borrows the vocabulary and nothing else.
 *
 * ## The asymmetry runs the OTHER WAY here
 *
 * For a parcel, doubt ships: most buyers ignore messages, a returned parcel
 * costs one round of freight, and cancelling on silence loses more good orders
 * than it saves.
 *
 * For a code, doubt holds. A released code cannot be recalled, cannot be
 * cancelled in transit and cannot be refused at the door. The loss is total and
 * immediate, and the counter-cost is fifteen minutes of a real customer's
 * patience. So the thresholds below are deliberately tighter than their RTO
 * equivalents and the default on uncertainty is HOLD.
 */

export type DigitalVelocity = {
  /** Digital orders on this phone in the last hour. */
  ordersLastHour: number;
  /** Digital orders on this phone in the last 24 hours. */
  ordersLastDay: number;
  /** Total digital value on this phone in the last 24 hours, in PKR. */
  valueLastDay: number;
  /** Deliveries previously refused as fraud on this phone. */
  priorRefusals: number;
  /** Successfully delivered digital orders on this phone, all time. */
  priorDeliveries: number;
  /**
   * Distinct top-up target identifiers used by this buyer, all time.
   *
   * A buyer topping up their own account uses one or two. Somebody working
   * through a list of stolen accounts uses many, and this is often the only
   * signal that separates the two.
   */
  distinctTargets: number;
};

export type FraudInput = {
  amount: number;
  /** True when the buyer signed in and their number is OTP-verified. */
  phoneVerified: boolean;
  /** True when the order came through guest checkout. */
  isGuest: boolean;
  velocity: DigitalVelocity;
  /** digital_code, digital_topup, voucher. */
  productType: string;
};

export type FraudAssessment = {
  decision: (typeof FraudDecision)[keyof typeof FraudDecision];
  score: number;
  reasons: string[];
};

export const FRAUD_CONFIG = {
  /** Above this, a first-time buyer is never auto-released. */
  FIRST_PURCHASE_CEILING_PKR: num(process.env.PK_DIGITAL_FIRST_CEILING, 5_000),
  /** Digital orders per phone per hour before it looks automated. */
  MAX_ORDERS_PER_HOUR: num(process.env.PK_DIGITAL_MAX_PER_HOUR, 3),
  /** Digital orders per phone per day. */
  MAX_ORDERS_PER_DAY: num(process.env.PK_DIGITAL_MAX_PER_DAY, 8),
  /** Digital spend per phone per day. */
  MAX_VALUE_PER_DAY_PKR: num(process.env.PK_DIGITAL_MAX_VALUE_DAY, 30_000),
  HOLD_AT: num(process.env.PK_DIGITAL_HOLD_AT, 25),
  REFUSE_AT: num(process.env.PK_DIGITAL_REFUSE_AT, 70),
} as const;

function num(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function assessFraud(input: FraudInput): FraudAssessment {
  const reasons: string[] = [];
  const v = input.velocity;
  let score = 0;

  /**
   * Whether anything here is evidence of fraud, as opposed to absence of trust.
   *
   * The distinction decides whether we can refuse outright. Being new and
   * unverified is not misconduct, and a buyer in that position can fix it by
   * verifying their number, so the worst we should do is make them wait. An
   * early version scored "guest" plus "large first purchase" at exactly the
   * refusal threshold and turned away a plausible new customer buying an
   * expensive gift card, which is the single most valuable order type on the
   * site.
   */
  let hardSignals = 0;

  // ----------------------------------------------------------- hard refusals
  // Prior confirmed fraud on this number is not a score input, it is an answer.
  if (v.priorRefusals > 0) {
    return {
      decision: FraudDecision.REFUSE,
      score: 100,
      reasons: [
        `${v.priorRefusals} previous delivery on this number was refused as fraud.`,
      ],
    };
  }

  // ------------------------------------------------------------- who they are
  //
  // Guest checkout is allowed on physical orders because requiring an account
  // costs real conversions and the parcel is recoverable. Neither holds for a
  // code, so an unverified buyer is held rather than blocked outright: they can
  // still verify their number and clear it themselves.
  if (input.isGuest || !input.phoneVerified) {
    score += 40;
    reasons.push(
      "Buyer's mobile number has not been verified. Digital orders need a verified number."
    );
  }

  if (v.priorDeliveries >= 5) {
    score -= 20;
    reasons.push(`${v.priorDeliveries} digital orders previously delivered to this number.`);
  } else if (v.priorDeliveries >= 1) {
    score -= 8;
    reasons.push(`${v.priorDeliveries} previous digital delivery on this number.`);
  }

  // ------------------------------------------------------------- velocity
  if (v.ordersLastHour >= FRAUD_CONFIG.MAX_ORDERS_PER_HOUR) {
    score += 35;
    hardSignals += 1;
    reasons.push(
      `${v.ordersLastHour} digital orders from this number in the last hour.`
    );
  } else if (v.ordersLastHour >= 2) {
    score += 10;
    reasons.push(`${v.ordersLastHour} digital orders in the last hour.`);
  }

  if (v.ordersLastDay >= FRAUD_CONFIG.MAX_ORDERS_PER_DAY) {
    score += 25;
    hardSignals += 1;
    reasons.push(`${v.ordersLastDay} digital orders from this number today.`);
  }

  if (v.valueLastDay + input.amount > FRAUD_CONFIG.MAX_VALUE_PER_DAY_PKR) {
    score += 25;
    hardSignals += 1;
    reasons.push(
      `Would take today's digital spend on this number to ${fmt(v.valueLastDay + input.amount)}.`
    );
  }

  // A spread of top-up targets from one account is the mule pattern. Only
  // meaningful for top-ups: nobody has a "target" for a gift card.
  if (input.productType === "digital_topup" && v.distinctTargets >= 5) {
    score += 30;
    hardSignals += 1;
    reasons.push(
      `Credited ${v.distinctTargets} different accounts. Buyers usually top up one or two.`
    );
  }

  // ---------------------------------------------------------------- value
  const firstPurchase = v.priorDeliveries === 0;
  if (firstPurchase && input.amount >= FRAUD_CONFIG.FIRST_PURCHASE_CEILING_PKR) {
    score += 30;
    reasons.push(
      `First digital purchase on this number, for ${fmt(input.amount)}.`
    );
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let decision: FraudAssessment["decision"];
  if (score >= FRAUD_CONFIG.REFUSE_AT) decision = FraudDecision.REFUSE;
  else if (score >= FRAUD_CONFIG.HOLD_AT) decision = FraudDecision.HOLD;
  else decision = FraudDecision.RELEASE;

  // Refusal needs evidence, not just an absence of history. Without this, a
  // new customer making their first big purchase is turned away by a machine
  // for the crime of being new, and nobody ever finds out we did it.
  if (decision === FraudDecision.REFUSE && hardSignals === 0) {
    decision = FraudDecision.HOLD;
    reasons.push(
      "Held rather than refused: nothing here is evidence of fraud, only an unverified new buyer."
    );
  }

  if (!reasons.length) reasons.push("Known buyer, normal pattern.");

  return { decision, score, reasons };
}

function fmt(n: number) {
  return `Rs ${Math.round(n).toLocaleString("en-PK")}`;
}
