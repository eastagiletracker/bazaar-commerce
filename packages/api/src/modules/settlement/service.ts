import { MedusaService } from "@medusajs/framework/utils";

import {
  CourierRemittance,
  CourierRemittanceLine,
  LedgerAccount,
  LedgerEntry,
  LedgerLine,
  OrderSettlement,
  SettlementException,
} from "./models";
import { LedgerAccountType } from "./models/ledger-account";
import { LedgerEntryKind } from "./models/ledger-entry";
import { PaymentMethod, SettlementStatus } from "./models/order-settlement";
import { RemittanceStatus } from "./models/courier-remittance";
import { RemittanceLineStatus } from "./models/courier-remittance-line";
import { ExceptionStatus, ExceptionType } from "./models/settlement-exception";
import { round2, splitOrderMoney, type SellerTaxProfile } from "./tax";

type PostLine = {
  account_id: string;
  debit?: number;
  credit?: number;
  seller_id?: string | null;
  order_id?: string | null;
  description?: string | null;
};

/**
 * Double-entry settlement ledger for the Pakistan marketplace.
 *
 * Everything that moves money posts a balanced journal entry here. Nothing
 * mutates a posted entry: corrections are reversing entries, so the history
 * stays auditable.
 *
 * The COD path is the reason this module exists. Mercur's built-in payout
 * pipeline assumes an authorized card payment it can capture, then pays the
 * seller. Cash on delivery has no authorization: a courier collects the money
 * days later and remits it in a batch, sometimes short, sometimes not at all.
 * So a COD order is only payable once a courier remittance line is matched to
 * it, and everything that does not tie out becomes an explicit exception.
 */
class SettlementModuleService extends MedusaService({
  LedgerAccount,
  LedgerEntry,
  LedgerLine,
  OrderSettlement,
  CourierRemittance,
  CourierRemittanceLine,
  SettlementException,
}) {
  // ------------------------------------------------------------------ accounts

  /** Fetch or create the account for a (type, owner) pair. */
  async ensureAccount(
    type: string,
    ownerId: string | null,
    name?: string
  ): Promise<any> {
    const [existing] = await this.listLedgerAccounts(
      { type, owner_id: ownerId } as any,
      { take: 1 }
    );
    if (existing) return existing;

    const debitNormal: string[] = [
      LedgerAccountType.COD_RECEIVABLE,
      LedgerAccountType.PSP_CLEARING,
      LedgerAccountType.BANK,
      LedgerAccountType.SETTLEMENT_LOSS,
    ];

    return await this.createLedgerAccounts({
      type,
      owner_id: ownerId,
      name: name ?? `${type}${ownerId ? `:${ownerId}` : ""}`,
      currency_code: "pkr",
      normal_balance: debitNormal.includes(type) ? "debit" : "credit",
    } as any);
  }

  // ------------------------------------------------------------------- posting

  /**
   * Post a balanced journal entry.
   *
   * Refuses to write unless debits equal credits, and is a no-op if an entry
   * with the same idempotency key already exists. Both guards matter: courier
   * files get re-sent and webhooks get re-delivered, and a ledger that
   * double-posts is worse than one that never posted at all.
   */
  async postEntry(input: {
    kind: string;
    idempotencyKey: string;
    lines: PostLine[];
    referenceType?: string;
    referenceId?: string;
    description?: string;
    currencyCode?: string;
  }): Promise<{ entry: any; created: boolean }> {
    const [existing] = await this.listLedgerEntries(
      { idempotency_key: input.idempotencyKey } as any,
      { take: 1 }
    );
    if (existing) {
      return { entry: existing, created: false };
    }

    const totalDebit = round2(
      input.lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0)
    );
    const totalCredit = round2(
      input.lines.reduce((sum, l) => sum + Number(l.credit ?? 0), 0)
    );

    if (totalDebit !== totalCredit) {
      throw new Error(
        `Unbalanced entry "${input.idempotencyKey}": debits ${totalDebit} != credits ${totalCredit}`
      );
    }
    if (totalDebit === 0) {
      throw new Error(`Entry "${input.idempotencyKey}" moves no money`);
    }
    for (const line of input.lines) {
      const d = Number(line.debit ?? 0);
      const c = Number(line.credit ?? 0);
      if (d < 0 || c < 0) {
        throw new Error(
          `Entry "${input.idempotencyKey}" has a negative amount. Reverse with an opposite-side line instead.`
        );
      }
      if (d > 0 && c > 0) {
        throw new Error(
          `Entry "${input.idempotencyKey}" has a line that is both a debit and a credit`
        );
      }
    }

    const entry = await this.createLedgerEntries({
      kind: input.kind,
      idempotency_key: input.idempotencyKey,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      description: input.description ?? null,
      currency_code: input.currencyCode ?? "pkr",
    } as any);

    await this.createLedgerLines(
      input.lines.map((l) => ({
        entry_id: entry.id,
        account_id: l.account_id,
        debit: round2(Number(l.debit ?? 0)),
        credit: round2(Number(l.credit ?? 0)),
        seller_id: l.seller_id ?? null,
        order_id: l.order_id ?? null,
        description: l.description ?? null,
      })) as any
    );

    return { entry, created: true };
  }

  // ------------------------------------------------------------- order intake

  /**
   * Record a placed order and compute how the money splits.
   *
   * No ledger entry yet: nothing has moved. A COD order at placement is a
   * promise, not cash, and booking receivables against undelivered COD is how
   * you end up reporting revenue for parcels that come straight back.
   */
  async recordOrderPlaced(input: {
    orderId: string;
    sellerId: string;
    grossAmount: number;
    commissionAmount: number;
    paymentMethod: "cod" | "prepaid";
    currencyCode?: string;
    courierCode?: string | null;
    courierAwb?: string | null;
    taxProfile?: SellerTaxProfile;
  }): Promise<any> {
    const [existing] = await this.listOrderSettlements(
      { order_id: input.orderId } as any,
      { take: 1 }
    );
    if (existing) return existing;

    const split = splitOrderMoney({
      gross: input.grossAmount,
      commission: input.commissionAmount,
      profile: input.taxProfile ?? {},
    });

    return await this.createOrderSettlements({
      order_id: input.orderId,
      seller_id: input.sellerId,
      currency_code: input.currencyCode ?? "pkr",
      payment_method: input.paymentMethod,
      status: SettlementStatus.PENDING,
      gross_amount: split.gross,
      commission_amount: split.commission,
      commission_tax_amount: split.commissionTax,
      withholding_tax_amount: split.withholdingTax,
      net_payable: split.netPayable,
      courier_code: input.courierCode ?? null,
      courier_awb: input.courierAwb ?? null,
    } as any);
  }

  /**
   * Money is now ours to account for: a prepaid capture, or a courier
   * confirming COD cash collected on delivery.
   *
   * Posts the full split in one balanced entry:
   *   Dr  cash-side account       gross     (COD receivable, or PSP clearing)
   *     Cr commission revenue     commission
   *     Cr sales tax payable      tax on that commission
   *     Cr withholding payable    tax withheld from the seller
   *     Cr seller payable         whatever is left
   */
  async recordCollected(input: {
    orderId: string;
    collectedAmount?: number;
    courierCode?: string | null;
    courierAwb?: string | null;
    collectedAt?: Date;
  }): Promise<{ settlement: any; entry: any }> {
    const settlement = await this.getSettlementByOrder(input.orderId);

    const isCod = settlement.payment_method === PaymentMethod.COD;
    const collected = round2(
      Number(input.collectedAmount ?? settlement.gross_amount)
    );

    const cashAccount = await this.ensureAccount(
      isCod ? LedgerAccountType.COD_RECEIVABLE : LedgerAccountType.PSP_CLEARING,
      isCod ? (input.courierCode ?? settlement.courier_code ?? "unknown") : null
    );
    const sellerPayable = await this.ensureAccount(
      LedgerAccountType.SELLER_PAYABLE,
      settlement.seller_id
    );
    const commissionRevenue = await this.ensureAccount(
      LedgerAccountType.COMMISSION_REVENUE,
      null
    );
    const salesTaxPayable = await this.ensureAccount(
      LedgerAccountType.SALES_TAX_PAYABLE,
      null
    );
    const whtPayable = await this.ensureAccount(
      LedgerAccountType.WITHHOLDING_TAX_PAYABLE,
      null
    );

    // A partial collection scales the seller's share but not our commission or
    // the taxes, which are assessed on what was actually sold. Anything that
    // does not fit becomes an exception rather than a silent adjustment.
    const commission = Number(settlement.commission_amount);
    const commissionTax = Number(settlement.commission_tax_amount);
    const wht = Number(settlement.withholding_tax_amount);
    const sellerShare = round2(collected - commission - commissionTax - wht);

    if (sellerShare < 0) {
      await this.raiseException({
        type: ExceptionType.AMOUNT_MISMATCH,
        severity: "high",
        amount: Math.abs(sellerShare),
        orderId: settlement.order_id,
        sellerId: settlement.seller_id,
        courierCode: input.courierCode ?? settlement.courier_code,
        courierAwb: input.courierAwb ?? settlement.courier_awb,
        summary:
          `Collected ${collected} does not cover commission ${commission} + tax ` +
          `${commissionTax} + withholding ${wht}. Seller share would be negative.`,
      });
      await this.updateOrderSettlements({
        id: settlement.id,
        status: SettlementStatus.EXCEPTION,
        cod_collected_amount: collected,
      } as any);
      throw new Error(
        `Order ${settlement.order_id}: collected ${collected} is less than deductions; raised an exception.`
      );
    }

    const { entry } = await this.postEntry({
      kind: LedgerEntryKind.COD_COLLECTED,
      idempotencyKey: `collected:${settlement.order_id}`,
      referenceType: "order",
      referenceId: settlement.order_id,
      currencyCode: settlement.currency_code,
      description: isCod
        ? `COD collected by ${input.courierCode ?? settlement.courier_code}`
        : "Prepaid payment captured",
      lines: [
        {
          account_id: cashAccount.id,
          debit: collected,
          order_id: settlement.order_id,
          seller_id: settlement.seller_id,
          description: isCod ? "COD receivable from courier" : "PSP clearing",
        },
        {
          account_id: commissionRevenue.id,
          credit: commission,
          order_id: settlement.order_id,
          seller_id: settlement.seller_id,
          description: "Marketplace commission",
        },
        {
          account_id: salesTaxPayable.id,
          credit: commissionTax,
          order_id: settlement.order_id,
          seller_id: settlement.seller_id,
          description: "Sales tax on commission",
        },
        {
          account_id: whtPayable.id,
          credit: wht,
          order_id: settlement.order_id,
          seller_id: settlement.seller_id,
          description: "Income tax withheld from seller",
        },
        {
          account_id: sellerPayable.id,
          credit: sellerShare,
          order_id: settlement.order_id,
          seller_id: settlement.seller_id,
          description: "Net payable to seller",
        },
      ].filter((l) => Number(l.debit ?? 0) > 0 || Number(l.credit ?? 0) > 0),
    });

    await this.updateOrderSettlements({
      id: settlement.id,
      status: SettlementStatus.COLLECTED,
      cod_collected_amount: collected,
      net_payable: sellerShare,
      collected_at: input.collectedAt ?? new Date(),
      courier_code: input.courierCode ?? settlement.courier_code,
      courier_awb: input.courierAwb ?? settlement.courier_awb,
    } as any);

    return { settlement: await this.getSettlementByOrder(input.orderId), entry };
  }

  // ------------------------------------------------------- courier remittance

  /**
   * Ingest a courier remittance batch: match each row to an order, post the
   * cash movement for the ones that tie out, and queue the rest for a human.
   *
   * Re-ingesting the same batch is safe. Rows are keyed by AWB and entries by
   * idempotency key, so a courier re-sending yesterday's file changes nothing.
   */
  async ingestRemittance(input: {
    courierCode: string;
    reference: string;
    declaredTotal: number;
    receivedAt?: Date;
    sourceRef?: string;
    rows: { awb: string; amount: number; fee?: number }[];
  }): Promise<{
    remittance: any;
    matched: number;
    unmatched: number;
    mismatched: number;
    duplicates: number;
    postedTotal: number;
  }> {
    const [existingBatch] = await this.listCourierRemittances(
      { courier_code: input.courierCode, reference: input.reference } as any,
      { take: 1 }
    );
    if (existingBatch) {
      const lines = await this.listCourierRemittanceLines({
        remittance_id: existingBatch.id,
      } as any);
      return {
        remittance: existingBatch,
        matched: lines.filter((l: any) => l.status === RemittanceLineStatus.MATCHED).length,
        unmatched: lines.filter((l: any) => l.status === RemittanceLineStatus.UNMATCHED).length,
        mismatched: lines.filter((l: any) => l.status === RemittanceLineStatus.AMOUNT_MISMATCH).length,
        duplicates: lines.filter((l: any) => l.status === RemittanceLineStatus.DUPLICATE).length,
        postedTotal: Number(existingBatch.matched_total),
      };
    }

    const remittance = await this.createCourierRemittances({
      courier_code: input.courierCode,
      reference: input.reference,
      declared_total: round2(input.declaredTotal),
      received_at: input.receivedAt ?? new Date(),
      source_ref: input.sourceRef ?? null,
      status: RemittanceStatus.RECEIVED,
    } as any);

    const bank = await this.ensureAccount(LedgerAccountType.BANK, null);

    let matched = 0;
    let unmatched = 0;
    let mismatched = 0;
    let duplicates = 0;
    let postedTotal = 0;
    const seenAwb = new Set<string>();

    for (const row of input.rows) {
      const amount = round2(row.amount);
      const awb = String(row.awb).trim();

      // Duplicate inside this same batch.
      if (seenAwb.has(awb)) {
        await this.createCourierRemittanceLines({
          remittance_id: remittance.id,
          courier_awb: awb,
          amount,
          courier_fee: round2(row.fee ?? 0),
          status: RemittanceLineStatus.DUPLICATE,
          note: "AWB appears more than once in this batch",
        } as any);
        duplicates += 1;
        await this.raiseException({
          type: ExceptionType.DUPLICATE_REMITTANCE,
          severity: "medium",
          amount,
          courierCode: input.courierCode,
          courierAwb: awb,
          summary: `AWB ${awb} appears twice in batch ${input.reference}`,
        });
        continue;
      }
      seenAwb.add(awb);

      const [settlement] = await this.listOrderSettlements(
        { courier_code: input.courierCode, courier_awb: awb } as any,
        { take: 1 }
      );

      if (!settlement) {
        await this.createCourierRemittanceLines({
          remittance_id: remittance.id,
          courier_awb: awb,
          amount,
          courier_fee: round2(row.fee ?? 0),
          status: RemittanceLineStatus.UNMATCHED,
          note: "No order settlement with this AWB",
        } as any);
        unmatched += 1;
        await this.raiseException({
          type: ExceptionType.UNMATCHED_REMITTANCE,
          severity: "high",
          amount,
          courierCode: input.courierCode,
          courierAwb: awb,
          summary: `Courier remitted ${amount} for AWB ${awb}, which matches no order`,
        });
        continue;
      }

      // Already remitted on an earlier batch.
      if (settlement.cod_remitted_at) {
        await this.createCourierRemittanceLines({
          remittance_id: remittance.id,
          courier_awb: awb,
          amount,
          courier_fee: round2(row.fee ?? 0),
          status: RemittanceLineStatus.DUPLICATE,
          order_id: settlement.order_id,
          order_settlement_id: settlement.id,
          note: "Already remitted on an earlier batch",
        } as any);
        duplicates += 1;
        await this.raiseException({
          type: ExceptionType.DUPLICATE_REMITTANCE,
          severity: "high",
          amount,
          orderId: settlement.order_id,
          sellerId: settlement.seller_id,
          courierCode: input.courierCode,
          courierAwb: awb,
          summary: `AWB ${awb} was already remitted; batch ${input.reference} pays it again`,
        });
        continue;
      }

      const expected = Number(
        settlement.cod_collected_amount ?? settlement.gross_amount
      );
      const variance = round2(expected - amount);

      if (Math.abs(variance) >= 0.01) {
        await this.createCourierRemittanceLines({
          remittance_id: remittance.id,
          courier_awb: awb,
          amount,
          courier_fee: round2(row.fee ?? 0),
          status: RemittanceLineStatus.AMOUNT_MISMATCH,
          order_id: settlement.order_id,
          order_settlement_id: settlement.id,
          variance,
          note: `Expected ${expected}, received ${amount}`,
        } as any);
        mismatched += 1;
        await this.raiseException({
          type: ExceptionType.AMOUNT_MISMATCH,
          severity: Math.abs(variance) > expected * 0.1 ? "high" : "medium",
          amount: Math.abs(variance),
          orderId: settlement.order_id,
          sellerId: settlement.seller_id,
          courierCode: input.courierCode,
          courierAwb: awb,
          summary:
            `AWB ${awb}: expected ${expected}, courier remitted ${amount} ` +
            `(${variance > 0 ? "short" : "over"} by ${Math.abs(variance)})`,
        });
        // Deliberately NOT posted. A mismatched row is a dispute, and guessing
        // which side is right in the ledger is how the discrepancy disappears.
        continue;
      }

      // Clean match: cash moves from the courier's receivable into our bank.
      const codReceivable = await this.ensureAccount(
        LedgerAccountType.COD_RECEIVABLE,
        input.courierCode
      );

      const line = await this.createCourierRemittanceLines({
        remittance_id: remittance.id,
        courier_awb: awb,
        amount,
        courier_fee: round2(row.fee ?? 0),
        status: RemittanceLineStatus.MATCHED,
        order_id: settlement.order_id,
        order_settlement_id: settlement.id,
        variance: 0,
      } as any);

      await this.postEntry({
        kind: LedgerEntryKind.REMITTANCE_RECEIVED,
        idempotencyKey: `remittance:${input.courierCode}:${awb}`,
        referenceType: "remittance_line",
        referenceId: line.id,
        description: `Cash remitted by ${input.courierCode} for AWB ${awb}`,
        lines: [
          {
            account_id: bank.id,
            debit: amount,
            order_id: settlement.order_id,
            seller_id: settlement.seller_id,
            description: "Cash received from courier",
          },
          {
            account_id: codReceivable.id,
            credit: amount,
            order_id: settlement.order_id,
            seller_id: settlement.seller_id,
            description: "Clear COD receivable",
          },
        ],
      });

      await this.updateOrderSettlements({
        id: settlement.id,
        status: SettlementStatus.REMITTED,
        cod_remitted_at: input.receivedAt ?? new Date(),
      } as any);

      matched += 1;
      postedTotal = round2(postedTotal + amount);
    }

    const status =
      unmatched + mismatched + duplicates === 0
        ? RemittanceStatus.RECONCILED
        : RemittanceStatus.PARTIALLY_RECONCILED;

    await this.updateCourierRemittances({
      id: remittance.id,
      matched_total: postedTotal,
      status,
    } as any);

    // The courier's own arithmetic is a fact worth checking: if the declared
    // total does not equal the rows, one of the two is wrong before we even
    // start matching.
    const rowSum = round2(input.rows.reduce((s, r) => s + Number(r.amount), 0));
    if (Math.abs(rowSum - round2(input.declaredTotal)) >= 0.01) {
      await this.raiseException({
        type: ExceptionType.AMOUNT_MISMATCH,
        severity: "high",
        amount: Math.abs(round2(rowSum - input.declaredTotal)),
        courierCode: input.courierCode,
        summary:
          `Batch ${input.reference}: rows sum to ${rowSum} but the courier ` +
          `declared ${round2(input.declaredTotal)}`,
      });
    }

    return {
      remittance: await this.retrieveCourierRemittance(remittance.id),
      matched,
      unmatched,
      mismatched,
      duplicates,
      postedTotal,
    };
  }

  // ------------------------------------------------------------------- payouts

  /**
   * Everything a seller is owed and we actually hold: orders whose cash has
   * been remitted (COD) or captured (prepaid) and not yet paid out.
   */
  async getPayableOrders(sellerId: string): Promise<any[]> {
    const settlements = await this.listOrderSettlements({
      seller_id: sellerId,
      status: [SettlementStatus.REMITTED, SettlementStatus.COLLECTED],
    } as any);

    // A COD order that was collected but not yet remitted is not payable: the
    // courier still has the cash. Paying it early is lending sellers our money.
    return settlements.filter(
      (s: any) =>
        !s.payout_id &&
        (s.payment_method === PaymentMethod.PREPAID
          ? s.status === SettlementStatus.COLLECTED
          : s.status === SettlementStatus.REMITTED)
    );
  }

  /** Post the payout and mark its orders settled. */
  async recordPayout(input: {
    sellerId: string;
    payoutId: string;
    orderIds: string[];
    amount: number;
  }): Promise<any> {
    const sellerPayable = await this.ensureAccount(
      LedgerAccountType.SELLER_PAYABLE,
      input.sellerId
    );
    const bank = await this.ensureAccount(LedgerAccountType.BANK, null);

    const { entry } = await this.postEntry({
      kind: LedgerEntryKind.PAYOUT_SENT,
      idempotencyKey: `payout:${input.payoutId}`,
      referenceType: "payout",
      referenceId: input.payoutId,
      description: `Payout to seller ${input.sellerId}`,
      lines: [
        {
          account_id: sellerPayable.id,
          debit: round2(input.amount),
          seller_id: input.sellerId,
          description: "Clear seller payable",
        },
        {
          account_id: bank.id,
          credit: round2(input.amount),
          seller_id: input.sellerId,
          description: "Cash paid to seller",
        },
      ],
    });

    for (const orderId of input.orderIds) {
      const settlement = await this.getSettlementByOrder(orderId);
      await this.updateOrderSettlements({
        id: settlement.id,
        status: SettlementStatus.SETTLED,
        payout_id: input.payoutId,
        settled_at: new Date(),
      } as any);
    }

    return entry;
  }

  // ---------------------------------------------------------------- exceptions

  async raiseException(input: {
    type: string;
    severity?: "low" | "medium" | "high";
    amount?: number;
    orderId?: string | null;
    sellerId?: string | null;
    courierCode?: string | null;
    courierAwb?: string | null;
    remittanceLineId?: string | null;
    summary: string;
  }): Promise<any> {
    return await this.createSettlementExceptions({
      type: input.type,
      severity: input.severity ?? "medium",
      status: ExceptionStatus.OPEN,
      amount: round2(input.amount ?? 0),
      order_id: input.orderId ?? null,
      seller_id: input.sellerId ?? null,
      courier_code: input.courierCode ?? null,
      courier_awb: input.courierAwb ?? null,
      remittance_line_id: input.remittanceLineId ?? null,
      summary: input.summary,
    } as any);
  }

  // ------------------------------------------------------------------ reporting

  /**
   * Read every ledger line matching a filter.
   *
   * List calls paginate by default, so summing whatever a single call returns
   * silently computes a balance over a truncated set — it looks correct while
   * the table is small and quietly drifts once it is not. Always page.
   */
  private async eachLedgerLine(filter: Record<string, unknown>): Promise<any[]> {
    const pageSize = 1000;
    const all: any[] = [];
    for (let skip = 0; ; skip += pageSize) {
      const page = await this.listLedgerLines(filter as any, {
        skip,
        take: pageSize,
      });
      all.push(...page);
      if (page.length < pageSize) return all;
    }
  }

  /** Net movement on one account. Debits positive, credits negative. */
  async getAccountBalance(accountId: string): Promise<number> {
    const lines = await this.eachLedgerLine({ account_id: accountId });
    return round2(
      lines.reduce(
        (sum: number, l: any) => sum + Number(l.debit) - Number(l.credit),
        0
      )
    );
  }

  /**
   * Every entry that does not balance on its own.
   *
   * This is the invariant worth enforcing, and it is strictly stronger than
   * comparing global totals: two entries wrong in opposite directions sum to
   * zero across the ledger while both are individually corrupt. Returns the
   * offending entries rather than a boolean, because "the ledger is broken" is
   * not actionable but "entry X is 10 out" is.
   *
   * Run this on a schedule, not only in tests.
   */
  async findUnbalancedEntries(): Promise<
    { entry_id: string; debits: number; credits: number; diff: number }[]
  > {
    const lines = await this.eachLedgerLine({});
    const byEntry = new Map<string, { debits: number; credits: number }>();

    for (const line of lines) {
      const key = (line as any).entry_id ?? (line as any).entry?.id;
      const acc = byEntry.get(key) ?? { debits: 0, credits: 0 };
      acc.debits += Number(line.debit);
      acc.credits += Number(line.credit);
      byEntry.set(key, acc);
    }

    const bad: { entry_id: string; debits: number; credits: number; diff: number }[] = [];
    for (const [entry_id, { debits, credits }] of byEntry) {
      const diff = round2(debits - credits);
      if (Math.abs(diff) >= 0.01) {
        bad.push({ entry_id, debits: round2(debits), credits: round2(credits), diff });
      }
    }
    return bad;
  }

  /**
   * Global invariant: across every line ever posted, debits equal credits.
   *
   * Weaker than findUnbalancedEntries (cancelling errors hide here), but cheap
   * and useful as a top-line figure on a dashboard.
   */
  async assertLedgerBalanced(): Promise<{
    balanced: boolean;
    totalDebit: number;
    totalCredit: number;
  }> {
    const lines = await this.eachLedgerLine({});
    const totalDebit = round2(
      lines.reduce((s: number, l: any) => s + Number(l.debit), 0)
    );
    const totalCredit = round2(
      lines.reduce((s: number, l: any) => s + Number(l.credit), 0)
    );
    return {
      balanced: Math.abs(totalDebit - totalCredit) < 0.01,
      totalDebit,
      totalCredit,
    };
  }

  private async getSettlementByOrder(orderId: string): Promise<any> {
    const [settlement] = await this.listOrderSettlements(
      { order_id: orderId } as any,
      { take: 1 }
    );
    if (!settlement) {
      throw new Error(`No settlement recorded for order ${orderId}`);
    }
    return settlement;
  }
}

export default SettlementModuleService;
