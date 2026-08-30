import { model } from "@medusajs/framework/utils";
import LedgerLine from "./ledger-line";

/**
 * A journal entry: the header for a balanced set of debit/credit lines.
 *
 * `idempotency_key` is unique and is how replayed events (a re-delivered
 * webhook, a re-ingested remittance file) avoid double-posting. Callers build
 * it from the business fact, e.g. `order-placed:order_123` or
 * `remittance-line:remline_456`.
 *
 * Entries are append-only. A mistake is corrected with a reversing entry, never
 * by editing or deleting, so the ledger stays auditable.
 */
export const LedgerEntryKind = {
  ORDER_PLACED: "order_placed",
  COD_COLLECTED: "cod_collected",
  COMMISSION_CHARGED: "commission_charged",
  TAX_WITHHELD: "tax_withheld",
  REMITTANCE_RECEIVED: "remittance_received",
  PAYOUT_SENT: "payout_sent",
  RTO_REVERSAL: "rto_reversal",
  SHORTFALL_WRITTEN_OFF: "shortfall_written_off",
  ADJUSTMENT: "adjustment",
} as const;

export type LedgerEntryKindValue =
  (typeof LedgerEntryKind)[keyof typeof LedgerEntryKind];

const LedgerEntry = model.define("pk_ledger_entry", {
  id: model.id({ prefix: "ledent" }).primaryKey(),
  kind: model.enum(Object.values(LedgerEntryKind)),
  /** Natural key of the business fact, so a replay is a no-op. */
  idempotency_key: model.text().unique(),
  /** What this entry is about: "order", "remittance_line", "payout". */
  reference_type: model.text().nullable(),
  reference_id: model.text().nullable(),
  currency_code: model.text().default("pkr"),
  description: model.text().nullable(),
  /** Set only when this entry reverses another. */
  reverses_entry_id: model.text().nullable(),
  lines: model.hasMany(() => LedgerLine, { mappedBy: "entry" }),
});

export default LedgerEntry;
