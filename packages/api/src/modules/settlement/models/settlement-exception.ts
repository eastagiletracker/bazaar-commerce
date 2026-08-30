import { model } from "@medusajs/framework/utils";

/**
 * The human queue.
 *
 * Any money fact that does not reconcile lands here instead of being absorbed
 * silently. The marketplace can be "fully automated" only in the sense that
 * everything reconcilable settles without a human; the residue is explicit,
 * counted, and assignable. Silent absorption is how marketplaces lose money
 * they never learn about.
 */
export const ExceptionType = {
  /** Remittance row we cannot tie to any order. */
  UNMATCHED_REMITTANCE: "unmatched_remittance",
  /** Courier remitted less (or more) than the order total. */
  AMOUNT_MISMATCH: "amount_mismatch",
  /** Same AWB remitted twice. */
  DUPLICATE_REMITTANCE: "duplicate_remittance",
  /** Delivered long ago, courier still has not remitted. */
  REMITTANCE_OVERDUE: "remittance_overdue",
  /** Payout to the seller failed at the PSP. */
  PAYOUT_FAILED: "payout_failed",
  /** Seller has no usable payout account. */
  PAYOUT_ACCOUNT_INVALID: "payout_account_invalid",
} as const;

export const ExceptionStatus = {
  OPEN: "open",
  INVESTIGATING: "investigating",
  RESOLVED: "resolved",
  WRITTEN_OFF: "written_off",
} as const;

const SettlementException = model
  .define("pk_settlement_exception", {
    id: model.id({ prefix: "stlexc" }).primaryKey(),
    type: model.enum(Object.values(ExceptionType)),
    status: model.enum(Object.values(ExceptionStatus)).default("open"),
    severity: model.enum(["low", "medium", "high"]).default("medium"),
    currency_code: model.text().default("pkr"),
    /** Money at stake. Drives triage order. */
    amount: model.bigNumber().default(0),
    order_id: model.text().nullable(),
    seller_id: model.text().nullable(),
    courier_code: model.text().nullable(),
    courier_awb: model.text().nullable(),
    remittance_line_id: model.text().nullable(),
    summary: model.text(),
    resolution_note: model.text().nullable(),
    resolved_at: model.dateTime().nullable(),
    resolved_by: model.text().nullable(),
  })
  .indexes([{ on: ["status", "severity"] }, { on: ["type"] }]);

export default SettlementException;
