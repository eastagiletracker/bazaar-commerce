import { model } from "@medusajs/framework/utils";

/**
 * A single account in the marketplace chart of accounts.
 *
 * `owner_id` scopes an account to a counterparty: a seller id for
 * SELLER_PAYABLE, a courier code for COD_RECEIVABLE. Marketplace-wide accounts
 * (revenue, tax, bank) leave it null. (type, owner_id) is unique.
 *
 * `normal_balance` records which side increases the account, so a report can
 * present a balance without every caller re-deriving the sign.
 */
export const LedgerAccountType = {
  /** Owed to a seller. Liability. */
  SELLER_PAYABLE: "seller_payable",
  /** Cash a courier is holding on our behalf after a COD delivery. Asset. */
  COD_RECEIVABLE: "cod_receivable",
  /** Funds captured by the PSP but not yet settled to our bank. Asset. */
  PSP_CLEARING: "psp_clearing",
  /** Our own bank account. Asset. */
  BANK: "bank",
  /** Marketplace commission earned, net of sales tax. Revenue. */
  COMMISSION_REVENUE: "commission_revenue",
  /** Provincial sales tax on services collected on commission. Liability. */
  SALES_TAX_PAYABLE: "sales_tax_payable",
  /** Income tax withheld from seller payments, owed to FBR. Liability. */
  WITHHOLDING_TAX_PAYABLE: "withholding_tax_payable",
  /** Cash lost to a courier shortfall or a written-off variance. Expense. */
  SETTLEMENT_LOSS: "settlement_loss",
} as const;

export type LedgerAccountTypeValue =
  (typeof LedgerAccountType)[keyof typeof LedgerAccountType];

const LedgerAccount = model
  .define("pk_ledger_account", {
    id: model.id({ prefix: "ledacc" }).primaryKey(),
    type: model.enum(Object.values(LedgerAccountType)),
    /** Seller id, courier code, or null for marketplace-wide accounts. */
    owner_id: model.text().nullable(),
    name: model.text(),
    currency_code: model.text().default("pkr"),
    normal_balance: model.enum(["debit", "credit"]),
  })
  .indexes([
    {
      on: ["type", "owner_id"],
      unique: true,
    },
  ]);

export default LedgerAccount;
