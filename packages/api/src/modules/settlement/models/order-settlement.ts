import { model } from "@medusajs/framework/utils";

/**
 * The money state of one seller's order, from placement through payout.
 *
 * Mercur splits a multi-vendor cart into one order per seller, so this is 1:1
 * with an order and always concerns exactly one seller.
 *
 * COD and prepaid diverge here. A prepaid order is money we already hold, so it
 * can follow Mercur's capture -> payout pipeline. A COD order is money a courier
 * collects on our behalf; it is only payable once that courier actually remits,
 * which is what `cod_remitted_at` records.
 */
export const SettlementStatus = {
  /** Order placed, nothing collected yet. */
  PENDING: "pending",
  /** Prepaid: captured. COD: delivered and cash collected by the courier. */
  COLLECTED: "collected",
  /** COD only: the courier has remitted the cash to us. */
  REMITTED: "remitted",
  /** Net amount paid out to the seller. Terminal. */
  SETTLED: "settled",
  /** Returned to origin; no money moves. Terminal. */
  RTO: "rto",
  /** Cancelled before delivery. Terminal. */
  CANCELLED: "cancelled",
  /** Something does not reconcile; a human owns it. */
  EXCEPTION: "exception",
} as const;

export type SettlementStatusValue =
  (typeof SettlementStatus)[keyof typeof SettlementStatus];

export const PaymentMethod = {
  COD: "cod",
  PREPAID: "prepaid",
} as const;

const OrderSettlement = model
  .define("pk_order_settlement", {
    id: model.id({ prefix: "ordstl" }).primaryKey(),
    order_id: model.text().unique(),
    seller_id: model.text(),
    currency_code: model.text().default("pkr"),
    payment_method: model.enum(Object.values(PaymentMethod)),
    status: model.enum(Object.values(SettlementStatus)).default("pending"),

    /** Order total, what the buyer pays. */
    gross_amount: model.bigNumber(),
    /** Marketplace commission before sales tax. */
    commission_amount: model.bigNumber().default(0),
    /** Provincial sales tax on the commission (a service we sell the seller). */
    commission_tax_amount: model.bigNumber().default(0),
    /** Income tax withheld from the seller's proceeds, remitted to FBR. */
    withholding_tax_amount: model.bigNumber().default(0),
    /** gross - commission - commission_tax - withholding. What the seller gets. */
    net_payable: model.bigNumber().default(0),

    /** Cash the courier actually collected. Differs from gross on a partial. */
    cod_collected_amount: model.bigNumber().nullable(),
    /** Courier handling this delivery, e.g. "postex". */
    courier_code: model.text().nullable(),
    /** Courier airway bill, the key remittance files are matched on. */
    courier_awb: model.text().nullable(),

    collected_at: model.dateTime().nullable(),
    cod_remitted_at: model.dateTime().nullable(),
    settled_at: model.dateTime().nullable(),
    /** Set once a payout covering this order is created. */
    payout_id: model.text().nullable(),
  })
  .indexes([
    { on: ["seller_id", "status"] },
    { on: ["courier_code", "courier_awb"] },
    { on: ["status"] },
  ]);

export default OrderSettlement;
