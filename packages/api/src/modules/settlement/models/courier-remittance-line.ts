import { model } from "@medusajs/framework/utils";
import CourierRemittance from "./courier-remittance";

/**
 * One consignment's cash on a remittance batch.
 *
 * Matching is on (courier_code, awb). Everything that does not tie out cleanly
 * gets a status other than MATCHED and lands in the exception queue rather than
 * being quietly absorbed.
 */
export const RemittanceLineStatus = {
  /** Tied to an order, amount agrees. Posted. */
  MATCHED: "matched",
  /** No order found for this AWB. Courier may be remitting someone else's cash. */
  UNMATCHED: "unmatched",
  /** Order found, but the amount differs from what we expected. */
  AMOUNT_MISMATCH: "amount_mismatch",
  /** This AWB already appeared on an earlier reconciled batch. */
  DUPLICATE: "duplicate",
} as const;

const CourierRemittanceLine = model
  .define("pk_courier_remittance_line", {
    id: model.id({ prefix: "cremln" }).primaryKey(),
    courier_awb: model.text(),
    /** Cash the courier says it collected for this consignment. */
    amount: model.bigNumber(),
    /** Courier's fee deducted on this consignment, if itemized. */
    courier_fee: model.bigNumber().default(0),
    status: model.enum(Object.values(RemittanceLineStatus)).default("unmatched"),
    /** Set once matched. */
    order_id: model.text().nullable(),
    order_settlement_id: model.text().nullable(),
    /** expected - actual. Positive means the courier short-paid us. */
    variance: model.bigNumber().default(0),
    note: model.text().nullable(),
    remittance: model.belongsTo(() => CourierRemittance, { mappedBy: "lines" }),
  })
  .indexes([{ on: ["courier_awb"] }, { on: ["status"] }]);

export default CourierRemittanceLine;
