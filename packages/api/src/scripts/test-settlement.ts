import { ExecArgs } from "@medusajs/framework/types";
import { SETTLEMENT_MODULE } from "../modules/settlement";
import { LedgerAccountType } from "../modules/settlement/models/ledger-account";
import { SettlementStatus } from "../modules/settlement/models/order-settlement";
import { ExceptionType } from "../modules/settlement/models/settlement-exception";
import { round2 } from "../modules/settlement/tax";

/**
 * End-to-end exercise of the COD settlement path against synthetic courier data.
 *
 * Deliberately includes the messy cases that actually occur in Pakistan: a
 * courier short-paying, an AWB we have never seen, the same AWB paid twice, and
 * a partial collection. The assertion that matters most is the last one — that
 * the ledger still balances after all of it.
 *
 * Run:  bun run test:settlement
 */

let checks = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ${String(checks).padStart(2, "0")}. PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  ${String(checks).padStart(2, "0")}. FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

function eq(label: string, actual: number, expected: number, tolerance = 0.01) {
  check(label, Math.abs(actual - expected) < tolerance, `got ${actual}, expected ${expected}`);
}

export default async function testSettlement({ container }: ExecArgs) {
  const settlement: any = container.resolve(SETTLEMENT_MODULE);

  // A unique run id keeps repeat runs from colliding on unique keys.
  const run = `t${Date.now().toString(36)}`;
  const seller = `sel_${run}`;
  const courier = `postex_${run}`;

  console.log(`\nSettlement engine test (run ${run})\n`);

  // Seller and courier accounts are unique per run, but bank, commission
  // revenue and the tax accounts are marketplace-wide and carry balances from
  // earlier runs. Measure those as deltas against a baseline.
  const bankAccount = await settlement.ensureAccount(LedgerAccountType.BANK, null);
  const commissionAccount = await settlement.ensureAccount(
    LedgerAccountType.COMMISSION_REVENUE,
    null
  );
  const base = {
    ledger: (await settlement.assertLedgerBalanced()).totalDebit,
    bank: await settlement.getAccountBalance(bankAccount.id),
    commission: await settlement.getAccountBalance(commissionAccount.id),
  };

  // ------------------------------------------------------------------ setup
  // Four COD orders at PKR 10,000 each, 10% commission, Sindh filer.
  // Sindh sales tax on services 15%, filer withholding 1%.
  //   commission     1000.00
  //   sales tax       150.00  (15% of commission)
  //   withholding     100.00  (1% of gross)
  //   seller net     8750.00
  const GROSS = 10000;
  const COMMISSION = 1000;
  const profile = { province: "sindh", is_filer: true };

  const orders = ["a", "b", "c", "d"].map((suffix) => ({
    orderId: `order_${run}_${suffix}`,
    awb: `AWB${run}${suffix.toUpperCase()}`,
  }));

  for (const o of orders) {
    await settlement.recordOrderPlaced({
      orderId: o.orderId,
      sellerId: seller,
      grossAmount: GROSS,
      commissionAmount: COMMISSION,
      paymentMethod: "cod",
      courierCode: courier,
      courierAwb: o.awb,
      taxProfile: profile,
    });
  }

  const first = (await settlement.listOrderSettlements({ order_id: orders[0].orderId }))[0];
  eq("Commission computed", Number(first.commission_amount), 1000);
  eq("Sales tax on commission (Sindh 15%)", Number(first.commission_tax_amount), 150);
  eq("Withholding (filer 1% of gross)", Number(first.withholding_tax_amount), 100);
  eq("Net payable to seller", Number(first.net_payable), 8750);
  check(
    "Split sums exactly to gross",
    round2(
      Number(first.commission_amount) +
        Number(first.commission_tax_amount) +
        Number(first.withholding_tax_amount) +
        Number(first.net_payable)
    ) === GROSS,
    `${first.commission_amount}+${first.commission_tax_amount}+${first.withholding_tax_amount}+${first.net_payable}`
  );

  // Placement alone must not move money: a COD promise is not cash.
  const afterPlacement = await settlement.assertLedgerBalanced();
  eq("No money moved on placement", afterPlacement.totalDebit - base.ledger, 0);

  // ------------------------------------------------- delivery / cash collected
  // a, b, c delivered in full. d is delivered but the buyer paid short.
  for (const o of orders.slice(0, 3)) {
    await settlement.recordCollected({
      orderId: o.orderId,
      courierCode: courier,
      courierAwb: o.awb,
    });
  }
  await settlement.recordCollected({
    orderId: orders[3].orderId,
    collectedAmount: 9000, // partial
    courierCode: courier,
    courierAwb: orders[3].awb,
  });

  const balancedAfterCollection = await settlement.assertLedgerBalanced();
  check("Ledger balanced after collection", balancedAfterCollection.balanced,
    `debits ${balancedAfterCollection.totalDebit} credits ${balancedAfterCollection.totalCredit}`);

  const codAccount = await settlement.ensureAccount(LedgerAccountType.COD_RECEIVABLE, courier);
  eq(
    "COD receivable = cash couriers hold",
    await settlement.getAccountBalance(codAccount.id),
    3 * GROSS + 9000
  );

  eq(
    "Commission revenue booked on all four",
    -((await settlement.getAccountBalance(commissionAccount.id)) - base.commission),
    4 * COMMISSION
  );

  // The partial shrinks the seller's share, not our commission or the taxes.
  const partial = (await settlement.listOrderSettlements({ order_id: orders[3].orderId }))[0];
  eq("Partial collection reduces seller net", Number(partial.net_payable), 9000 - 1000 - 150 - 100);

  // -------------------------------------------------------- remittance batch
  // The courier pays: a in full, b short by 500, an AWB we have never seen,
  // and c twice. d is not on this batch at all.
  const ghostAwb = `AWB${run}GHOST`;
  const result = await settlement.ingestRemittance({
    courierCode: courier,
    reference: `BATCH-${run}-01`,
    declaredTotal: 10000 + 9500 + 7500 + 10000 + 10000,
    sourceRef: "synthetic-test.csv",
    rows: [
      { awb: orders[0].awb, amount: 10000 },  // clean
      { awb: orders[1].awb, amount: 9500 },   // short by 500
      { awb: ghostAwb, amount: 7500 },        // unknown AWB
      { awb: orders[2].awb, amount: 10000 },  // clean
      { awb: orders[2].awb, amount: 10000 },  // duplicate within the batch
    ],
  });

  check("Two rows matched cleanly", result.matched === 2, `matched ${result.matched}`);
  check("One row unmatched", result.unmatched === 1, `unmatched ${result.unmatched}`);
  check("One row amount-mismatched", result.mismatched === 1, `mismatched ${result.mismatched}`);
  check("One row duplicate", result.duplicates === 1, `duplicates ${result.duplicates}`);
  eq("Only clean rows posted to bank", result.postedTotal, 20000);

  const bank = bankAccount;
  eq(
    "Bank holds only reconciled cash",
    (await settlement.getAccountBalance(bank.id)) - base.bank,
    20000
  );

  // The short-paid order must NOT be marked remitted — it is a live dispute.
  const shortPaid = (await settlement.listOrderSettlements({ order_id: orders[1].orderId }))[0];
  check(
    "Short-paid order is not marked remitted",
    shortPaid.status !== SettlementStatus.REMITTED,
    `status ${shortPaid.status}`
  );

  // ------------------------------------------------------------- exceptions
  const exceptions = await settlement.listSettlementExceptions({ courier_code: courier });
  const byType = (t: string) => exceptions.filter((e: any) => e.type === t).length;

  check("Unmatched AWB raised an exception", byType(ExceptionType.UNMATCHED_REMITTANCE) === 1);
  check("Amount mismatch raised an exception", byType(ExceptionType.AMOUNT_MISMATCH) >= 1);
  check("Duplicate raised an exception", byType(ExceptionType.DUPLICATE_REMITTANCE) === 1);
  check("Every exception is open and assignable", exceptions.every((e: any) => e.status === "open"));

  const ghost = exceptions.find((e: any) => e.courier_awb === ghostAwb);
  check("Unmatched exception carries the money at stake", Number(ghost?.amount) === 7500,
    `amount ${ghost?.amount}`);

  // --------------------------------------------------------------- payability
  const payable = await settlement.getPayableOrders(seller);
  check(
    "Only remitted orders are payable",
    payable.length === 2,
    `${payable.length} payable: ${payable.map((p: any) => p.order_id.slice(-1)).join(",")}`
  );
  check(
    "Collected-but-not-remitted COD is withheld",
    !payable.some((p: any) => p.order_id === orders[3].orderId),
    "the courier still holds that cash"
  );

  // ------------------------------------------------------------------ payout
  const payoutAmount = round2(
    payable.reduce((s: number, p: any) => s + Number(p.net_payable), 0)
  );
  eq("Payout is the sum of net payables", payoutAmount, 2 * 8750);

  await settlement.recordPayout({
    sellerId: seller,
    payoutId: `pout_${run}`,
    orderIds: payable.map((p: any) => p.order_id),
    amount: payoutAmount,
  });

  const sellerPayable = await settlement.ensureAccount(LedgerAccountType.SELLER_PAYABLE, seller);
  // Four orders credited the seller; two have been paid out.
  eq(
    "Seller payable = owed but unpaid",
    -(await settlement.getAccountBalance(sellerPayable.id)),
    round2(3 * 8750 + 7750 - payoutAmount)
  );

  const settled = await settlement.listOrderSettlements({ seller_id: seller, status: SettlementStatus.SETTLED });
  check("Paid orders marked settled", settled.length === 2, `${settled.length} settled`);

  // ------------------------------------------------------------- idempotency
  // Compare against the balance immediately before the replay, not the run
  // baseline: the payout above legitimately credited bank, so the run-level
  // delta is no longer 20000.
  const bankBeforeReplay = await settlement.getAccountBalance(bank.id);
  const replay = await settlement.ingestRemittance({
    courierCode: courier,
    reference: `BATCH-${run}-01`,
    declaredTotal: 47000,
    rows: [{ awb: orders[0].awb, amount: 10000 }],
  });
  eq("Re-ingesting the same batch posts nothing new", replay.postedTotal, 20000);
  eq(
    "Bank unchanged after replay",
    await settlement.getAccountBalance(bank.id),
    bankBeforeReplay
  );

  const dupPayout = await settlement.postEntry({
    kind: "payout_sent",
    idempotencyKey: `payout:pout_${run}`,
    lines: [
      { account_id: sellerPayable.id, debit: payoutAmount },
      { account_id: bank.id, credit: payoutAmount },
    ],
  });
  check("Replayed payout is a no-op", dupPayout.created === false);

  // ------------------------------------------------------- balance guard rails
  let rejectedUnbalanced = false;
  try {
    await settlement.postEntry({
      kind: "adjustment",
      idempotencyKey: `bad:${run}`,
      lines: [
        { account_id: bank.id, debit: 100 },
        { account_id: sellerPayable.id, credit: 90 },
      ],
    });
  } catch {
    rejectedUnbalanced = true;
  }
  check("Unbalanced entry is rejected", rejectedUnbalanced);

  let rejectedNegative = false;
  try {
    await settlement.postEntry({
      kind: "adjustment",
      idempotencyKey: `neg:${run}`,
      lines: [
        { account_id: bank.id, debit: -100 },
        { account_id: sellerPayable.id, credit: -100 },
      ],
    });
  } catch {
    rejectedNegative = true;
  }
  check("Negative amounts are rejected", rejectedNegative);

  // ------------------------------------------------------------- the invariant
  const final = await settlement.assertLedgerBalanced();
  check(
    "Ledger totals balance after every mess above",
    final.balanced,
    `debits ${final.totalDebit} = credits ${final.totalCredit}`
  );

  // Stronger, and the one that actually matters: no single entry is lopsided.
  // Global totals can balance while two entries are wrong in opposite
  // directions, so this is the check to trust.
  const unbalanced = await settlement.findUnbalancedEntries();
  check(
    "EVERY ENTRY BALANCES INDIVIDUALLY",
    unbalanced.length === 0,
    unbalanced.length
      ? unbalanced.map((u: any) => `${u.entry_id} off by ${u.diff}`).join("; ")
      : "no lopsided entries"
  );

  console.log("");
  if (failures.length) {
    console.log(`${failures.length} of ${checks} checks FAILED:`);
    failures.forEach((f) => console.log(`  - ${f}`));
    throw new Error(`${failures.length} settlement checks failed`);
  }
  console.log(`All ${checks} settlement checks passed.\n`);
}
