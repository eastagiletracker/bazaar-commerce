import { model } from "@medusajs/framework/utils";
import LedgerEntry from "./ledger-entry";

/**
 * One side of a journal entry.
 *
 * Exactly one of debit/credit is non-zero. The service enforces that every
 * entry's debits equal its credits before anything is written.
 */
const LedgerLine = model.define("pk_ledger_line", {
  id: model.id({ prefix: "ledlin" }).primaryKey(),
  account_id: model.text(),
  debit: model.bigNumber().default(0),
  credit: model.bigNumber().default(0),
  /** Seller this line concerns, for per-seller statements. */
  seller_id: model.text().nullable(),
  /** Order this line concerns, for per-order tracing. */
  order_id: model.text().nullable(),
  description: model.text().nullable(),
  entry: model.belongsTo(() => LedgerEntry, { mappedBy: "lines" }),
});

export default LedgerLine;
