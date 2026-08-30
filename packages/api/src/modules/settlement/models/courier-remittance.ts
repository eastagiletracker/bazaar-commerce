import { model } from "@medusajs/framework/utils";
import CourierRemittanceLine from "./courier-remittance-line";

/**
 * One COD remittance batch from a courier: the periodic file or API payload
 * saying "here is the cash we collected for these consignments".
 *
 * `declared_total` is what the courier says it is sending. `matched_total` is
 * what we could tie to our own orders. They disagree more often than anyone
 * expects, which is the entire reason this table exists.
 */
export const RemittanceStatus = {
  /** Rows loaded, not yet matched. */
  RECEIVED: "received",
  /** Every row matched and posted. */
  RECONCILED: "reconciled",
  /** Posted, but some rows need a human. */
  PARTIALLY_RECONCILED: "partially_reconciled",
} as const;

const CourierRemittance = model
  .define("pk_courier_remittance", {
    id: model.id({ prefix: "cremit" }).primaryKey(),
    courier_code: model.text(),
    /** The courier's own batch reference, unique per courier. */
    reference: model.text(),
    currency_code: model.text().default("pkr"),
    /** Total the courier claims to be remitting. */
    declared_total: model.bigNumber(),
    /** Total we successfully matched to orders. */
    matched_total: model.bigNumber().default(0),
    /** Courier's deducted delivery/COD fees, if itemized on the batch. */
    courier_fee_total: model.bigNumber().default(0),
    status: model.enum(Object.values(RemittanceStatus)).default("received"),
    received_at: model.dateTime(),
    /** Original filename or API payload id, for audit. */
    source_ref: model.text().nullable(),
    lines: model.hasMany(() => CourierRemittanceLine, { mappedBy: "remittance" }),
  })
  .indexes([{ on: ["courier_code", "reference"], unique: true }]);

export default CourierRemittance;
