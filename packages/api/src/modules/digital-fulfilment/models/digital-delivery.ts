import { model } from "@medusajs/framework/utils";

/**
 * The delivery of one digital order line, and the fraud decision attached to it.
 *
 * Separate from the code itself because not every digital product is a code. A
 * top-up has no PIN to store; it is an instruction to credit someone's game ID.
 * This row is the thing that says "line X of order Y has or has not been
 * fulfilled", whatever the mechanism.
 */

export const DeliveryStatus = {
  /** Created, not yet assessed. */
  PENDING: "pending",
  /** Fraud gate says a human should look first. Nothing has been handed over. */
  HELD: "held",
  /** Cleared, waiting on a code or on the vendor to action a top-up. */
  READY: "ready",
  /** Buyer has been given the goods. */
  DELIVERED: "delivered",
  /** Refused on review, or refunded. Terminal. */
  REFUSED: "refused",
  /** Cleared but no stock existed. Ops must refund or restock. */
  OUT_OF_STOCK: "out_of_stock",
  /** Vendor missed the SLA on a top-up. */
  FAILED: "failed",
} as const;

export type DeliveryStatusValue =
  (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const FraudDecision = {
  /** Hand it over now. */
  RELEASE: "release",
  /** A human decides. */
  HOLD: "hold",
  /** Do not deliver at all. */
  REFUSE: "refuse",
} as const;

const DigitalDelivery = model
  .define("pk_digital_delivery", {
    id: model.id({ prefix: "ddlv" }).primaryKey(),
    /** One row per order LINE, not per order. A cart can hold several. */
    order_line_id: model.text().unique(),
    order_id: model.text(),
    seller_id: model.text(),
    offer_id: model.text().nullable(),
    customer_id: model.text().nullable(),
    phone: model.text().nullable(),

    /**
     * Whether the buyer holds a real account, captured at order time.
     *
     * Stored rather than derived, because the obvious derivation is wrong.
     * `customer_id` looks like the test for "is this a guest" and is not:
     * **Medusa creates a customer row for guest checkouts too**, so
     * `!customer_id` never fires and every anonymous digital purchase sailed
     * through the fraud gate. Only `customer.has_account` separates them, and
     * this field is that answer frozen at the moment of the order.
     */
    buyer_verified: model.boolean().default(false),

    /** digital_code, digital_topup, voucher. Drives how this is fulfilled. */
    product_type: model.text(),
    quantity: model.number().default(1),
    amount: model.bigNumber().default(0),
    currency_code: model.text().default("pkr"),

    status: model.enum(Object.values(DeliveryStatus)).default("pending"),

    // ------------------------------------------------------------ fraud gate
    fraud_decision: model.enum(Object.values(FraudDecision)).nullable(),
    fraud_score: model.number().default(0),
    fraud_reasons: model.json().nullable(),
    /** Who cleared or refused a held delivery, and why. */
    reviewed_by: model.text().nullable(),
    reviewed_at: model.dateTime().nullable(),
    review_note: model.text().nullable(),

    // ------------------------------------------------------ what the buyer needs
    /**
     * Identifiers the buyer supplied at checkout: a game player ID, the mobile
     * number to top up. Copied off the line item so the vendor sees it without
     * needing order access.
     */
    fulfilment_input: model.json().nullable(),

    /** Reveal-link credentials, derived exactly as confirmation tokens are. */
    token_salt: model.text().nullable(),
    token_hash: model.text().nullable(),

    /**
     * When the buyer first saw the code.
     *
     * The load-bearing field for refunds. An unrevealed code can be returned to
     * stock and the buyer refunded; a revealed one cannot, because there is no
     * way to know whether it has been spent. Everything about the refund policy
     * hangs on this timestamp, which is why reveals are counted rather than
     * merely flagged.
     */
    first_revealed_at: model.dateTime().nullable(),
    reveal_count: model.number().default(0),

    delivered_at: model.dateTime().nullable(),
    /** Deadline for a vendor-fulfilled top-up. */
    sla_due_at: model.dateTime().nullable(),
    failure_reason: model.text().nullable(),
  })
  .indexes([
    { on: ["status"] },
    { on: ["order_id"] },
    { on: ["seller_id", "status"] },
    { on: ["phone"] },
    { on: ["token_hash"] },
  ]);

export default DigitalDelivery;
