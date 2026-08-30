import { ExecArgs } from "@medusajs/framework/types";

import { DIGITAL_FULFILMENT_MODULE } from "../modules/digital-fulfilment";
import {
  CodeStatus,
} from "../modules/digital-fulfilment/models/digital-code";
import {
  DeliveryStatus,
  FraudDecision,
} from "../modules/digital-fulfilment/models/digital-delivery";
import {
  assessFraud,
  FRAUD_CONFIG,
  type FraudInput,
} from "../modules/digital-fulfilment/fraud";
import {
  fingerprint,
  maskCode,
  seal,
  unseal,
} from "../modules/digital-fulfilment/vault-crypto";
import { assessAndFulfil, fulfil } from "../lib/digital/deliver";

/**
 * Code vault and fraud gate tests.
 *
 * The two claims that matter, and the two that are unrecoverable when wrong:
 *
 *  1. **No code is ever handed to two buyers.** Both have already paid; the
 *     second to redeem finds their PIN spent, and there is no way to make that
 *     right. Tested under real concurrency, not by inspection.
 *  2. **No code leaves without clearing the fraud gate**, and no plaintext is
 *     ever written down.
 *
 * Run:  bun run test:digital
 */

let checks = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  console.log(
    `  ${String(checks).padStart(2, "0")}. ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`
  );
  if (!condition) failures.push(label);
}

/** A clean, low-risk buyer. Varied per case. */
function buyer(over: Partial<FraudInput> = {}): FraudInput {
  return {
    amount: 1_500,
    phoneVerified: true,
    isGuest: false,
    productType: "digital_code",
    velocity: {
      ordersLastHour: 0,
      ordersLastDay: 0,
      valueLastDay: 0,
      priorRefusals: 0,
      priorDeliveries: 3,
      distinctTargets: 1,
    },
    ...over,
  };
}

export default async function testDigital({ container }: ExecArgs) {
  const svc: any = container.resolve(DIGITAL_FULFILMENT_MODULE);
  const run = `d${Date.now().toString(36)}`;
  const seller = `sel_${run}`;

  console.log(`\nDigital vault and fraud gate (run ${run})\n`);

  // ================================================================= crypto
  console.log("  Encryption");

  {
    const code = "PUBG-9F3K-22XQ-7781";
    const sealed = seal(code);

    check(
      "A sealed code round-trips",
      unseal(sealed) === code
    );
    check(
      "The ciphertext does not contain the code",
      !JSON.stringify(sealed).includes(code) &&
        !JSON.stringify(sealed).includes("9F3K"),
      "the whole point of the vault"
    );

    const again = seal(code);
    check(
      "The same code encrypts differently every time",
      again.ciphertext !== sealed.ciphertext,
      "a fixed IV would let anyone spot duplicate codes in a dump"
    );

    // GCM authenticates. A flipped byte must fail, not decrypt to garbage that
    // we would then hand a customer.
    const tampered = {
      ...sealed,
      ciphertext: Buffer.from(
        Buffer.from(sealed.ciphertext, "base64").map((b, i) => (i === 2 ? b ^ 0xff : b))
      ).toString("base64"),
    };
    let threw = false;
    try {
      unseal(tampered);
    } catch {
      threw = true;
    }
    check(
      "A tampered record refuses to decrypt",
      threw,
      "better an error than a corrupted PIN the buyer tries to redeem"
    );

    check(
      "Masking keeps only the last four characters",
      maskCode(code) === "***************7781",
      maskCode(code)
    );
    check(
      "The same code fingerprints the same for one seller",
      fingerprint("sel_a", code) === fingerprint("sel_a", code)
    );
    check(
      "...and differently for another seller",
      fingerprint("sel_a", code) !== fingerprint("sel_b", code),
      "two vendors may legitimately hold the same code"
    );
  }

  // ================================================================== upload
  console.log("\n  Vendor upload");

  const offer = `offer_${run}`;

  {
    const result = await svc.uploadCodes({
      sellerId: seller,
      offerId: offer,
      codes: ["AAAA-1111", "BBBB-2222", "CCCC-3333", "DDDD-4444", "EEEE-5555"],
    });
    check(
      "A batch of 5 codes is stored",
      result.added === 5,
      `added ${result.added}, dup ${result.duplicates}, invalid ${result.invalid}`
    );

    const stock = await svc.availableStock(offer);
    check("Stock reports 5 available", stock === 5, `${stock}`);

    // Vendors paste overlapping spreadsheets. It must not create phantom stock.
    const second = await svc.uploadCodes({
      sellerId: seller,
      offerId: offer,
      codes: ["CCCC-3333", "DDDD-4444", "FFFF-6666"],
    });
    check(
      "Re-uploading an overlapping batch adds only what is new",
      second.added === 1 && second.duplicates === 2,
      `added ${second.added}, duplicates ${second.duplicates}`
    );

    const dupInBatch = await svc.uploadCodes({
      sellerId: seller,
      offerId: offer,
      codes: ["GGGG-7777", "GGGG-7777", "  ", "x"],
    });
    check(
      "Duplicates within one batch, blanks and stubs are all rejected",
      dupInBatch.added === 1 &&
        dupInBatch.duplicates === 1 &&
        dupInBatch.invalid === 2,
      `added ${dupInBatch.added}, dup ${dupInBatch.duplicates}, invalid ${dupInBatch.invalid}`
    );

    const rows = await svc.listDigitalCodes({ seller_id: seller } as any, {
      take: 100,
    });
    const dump = JSON.stringify(rows);
    check(
      "No stored row contains a whole code",
      ["AAAA-1111", "BBBB-2222", "CCCC-3333", "FFFF-6666"].every(
        (c) => !dump.includes(c)
      ),
      "a database dump must not be a pile of spendable PINs"
    );
    check(
      "The only fragment stored is the last four, for vendor reconciliation",
      rows.every((r: any) => /^\*+\w{4}$/.test(r.masked)),
      "a vendor needs to identify a row; four characters is not a usable code"
    );
  }

  // ============================================== THE ONE THAT MATTERS MOST
  console.log("\n  Concurrent allocation");

  {
    const raceOffer = `offer_${run}_race`;
    const CODES = 20;
    const BUYERS = 20;

    await svc.uploadCodes({
      sellerId: seller,
      offerId: raceOffer,
      codes: Array.from({ length: CODES }, (_, i) => `RACE-${run}-${i}`),
    });

    // Fire every allocation at once. Without serialisation, several of these
    // read "the oldest available code" before any of them writes.
    const results = await Promise.all(
      Array.from({ length: BUYERS }, (_, i) =>
        svc
          .allocateCode({
            offerId: raceOffer,
            orderLineId: `line_${run}_${i}`,
            orderId: `order_${run}_${i}`,
          })
          .catch(() => null)
      )
    );

    const allocated = results.filter(Boolean);
    const distinctCodes = new Set(allocated.map((c: any) => c.id));

    check(
      `${BUYERS} simultaneous buyers, ${CODES} codes: no code goes to two buyers`,
      distinctCodes.size === allocated.length,
      `${allocated.length} allocations, ${distinctCodes.size} distinct codes — ` +
        "a duplicate here means two paying customers get the same PIN"
    );

    const stillAvailable = await svc.availableStock(raceOffer);
    check(
      "Stock and allocations reconcile exactly",
      allocated.length + stillAvailable === CODES,
      `${allocated.length} allocated + ${stillAvailable} left = ${allocated.length + stillAvailable}, expected ${CODES}`
    );

    // Re-entrancy: a retried event must not consume a second code.
    const first = await svc.allocateCode({
      offerId: raceOffer,
      orderLineId: `line_${run}_0`,
      orderId: `order_${run}_0`,
    });
    check(
      "Re-allocating the same order line returns the same code",
      first?.id === allocated.find((c: any) => c.allocated_to_line_id === `line_${run}_0`)?.id,
      "a retried event must not burn a second code"
    );
  }

  {
    const emptyOffer = `offer_${run}_empty`;
    const none = await svc.allocateCode({
      offerId: emptyOffer,
      orderLineId: `line_${run}_empty`,
      orderId: `order_${run}_empty`,
    });
    check(
      "Allocating from empty stock returns null, not a crash",
      none === null,
      "the buyer has paid; this is an ops state, not an exception"
    );
  }

  // ============================================================ fraud gate
  console.log("\n  Fraud gate");

  {
    const clean = assessFraud(buyer());
    check(
      "A known buyer on a normal order is released",
      clean.decision === FraudDecision.RELEASE,
      `score ${clean.score}`
    );

    const guest = assessFraud(
      buyer({ isGuest: true, phoneVerified: false, velocity: { ...buyer().velocity, priorDeliveries: 0 } })
    );
    check(
      "An unverified guest is held, not released",
      guest.decision !== FraudDecision.RELEASE,
      `${guest.decision}, score ${guest.score} — a code cannot be recalled`
    );

    const repeat = assessFraud(
      buyer({ velocity: { ...buyer().velocity, priorRefusals: 1 } })
    );
    check(
      "A number with a prior fraud refusal is refused outright",
      repeat.decision === FraudDecision.REFUSE,
      "not a score input, an answer"
    );

    const fast = assessFraud(
      buyer({
        velocity: {
          ...buyer().velocity,
          ordersLastHour: FRAUD_CONFIG.MAX_ORDERS_PER_HOUR,
          priorDeliveries: 0,
        },
      })
    );
    check(
      "Burst velocity is held",
      fast.decision !== FraudDecision.RELEASE,
      `${FRAUD_CONFIG.MAX_ORDERS_PER_HOUR} in an hour → ${fast.decision} (${fast.score})`
    );

    const bigFirst = assessFraud(
      buyer({
        amount: FRAUD_CONFIG.FIRST_PURCHASE_CEILING_PKR + 1,
        velocity: { ...buyer().velocity, priorDeliveries: 0 },
      })
    );
    check(
      "A large first purchase is never auto-released",
      bigFirst.decision !== FraudDecision.RELEASE,
      `${bigFirst.decision}, score ${bigFirst.score}`
    );

    const bigGuest = assessFraud(
      buyer({
        isGuest: true,
        phoneVerified: false,
        amount: 20_000,
        velocity: { ...buyer().velocity, priorDeliveries: 0 },
      })
    );
    check(
      "An unverified buyer making a big first purchase is HELD, never refused",
      bigGuest.decision === FraudDecision.HOLD,
      `${bigGuest.decision} (${bigGuest.score}) — being new is not evidence of fraud, ` +
        "and this is the most valuable order type on the site"
    );

    const mule = assessFraud(
      buyer({
        productType: "digital_topup",
        velocity: { ...buyer().velocity, distinctTargets: 6, priorDeliveries: 0 },
      })
    );
    check(
      "Topping up many different accounts is held",
      mule.decision !== FraudDecision.RELEASE,
      `6 distinct targets → ${mule.decision} (${mule.score})`
    );

    const loyalMule = assessFraud(
      buyer({
        productType: "digital_code",
        velocity: { ...buyer().velocity, distinctTargets: 6, priorDeliveries: 10 },
      })
    );
    check(
      "A long-standing buyer is not punished for the same pattern on a gift card",
      loyalMule.decision === FraudDecision.RELEASE,
      `${loyalMule.decision} (${loyalMule.score}) — targets are meaningless for codes`
    );
  }

  // ================================================== end to end delivery
  console.log("\n  Delivery");

  {
    const e2eOffer = `offer_${run}_e2e`;
    await svc.uploadCodes({
      sellerId: seller,
      offerId: e2eOffer,
      codes: ["E2E-GOOD-0001"],
    });

    const { delivery } = await svc.openDelivery({
      orderLineId: `line_${run}_e2e`,
      orderId: `order_${run}_e2e`,
      sellerId: seller,
      offerId: e2eOffer,
      customerId: `cus_${run}`,
      buyerVerified: true,
      phone: `+92300${String(Date.now()).slice(-7)}`,
      productType: "digital_code",
      amount: 1_500,
    });

    check(
      "A delivery opens pending",
      delivery.status === DeliveryStatus.PENDING
    );

    const same = await svc.openDelivery({
      orderLineId: `line_${run}_e2e`,
      orderId: `order_${run}_e2e`,
      sellerId: seller,
      productType: "digital_code",
    });
    check(
      "Opening the same line twice does not create a second delivery",
      same.created === false && same.delivery.id === delivery.id
    );

    const outcome = await assessAndFulfil(container, delivery.id);
    check(
      "A clean order is assessed and delivered in one pass",
      outcome.status === DeliveryStatus.DELIVERED,
      outcome.status
    );

    const after = await svc.retrieveDigitalDelivery(delivery.id);
    check(
      "Refundable before the buyer looks",
      (await svc.isRefundable(after.order_line_id)) === true,
      "an unseen code can go back to stock"
    );

    const token = await svc.issueToken(delivery.id);
    const found = await svc.findByToken(token);
    check("The reveal token resolves", found?.id === delivery.id);

    const [code] = await svc.listDigitalCodes(
      { allocated_to_line_id: after.order_line_id } as any,
      { take: 1 }
    );
    const plaintext = await svc.revealCode(code.id);
    await svc.countReveal(delivery.id);

    check(
      "The buyer gets the actual code back",
      plaintext === "E2E-GOOD-0001",
      "encrypted at rest, readable exactly once it is paid for"
    );

    const revealed = await svc.retrieveDigitalDelivery(delivery.id);
    check(
      "The first reveal is timestamped",
      Boolean(revealed.first_revealed_at) && revealed.reveal_count === 1
    );
    check(
      "NOT refundable once seen",
      (await svc.isRefundable(revealed.order_line_id)) === false,
      "there is no way to know whether a seen code has been spent"
    );

    let refused = false;
    try {
      await svc.releaseCode(code.id);
    } catch {
      refused = true;
    }
    check(
      "A delivered code cannot be returned to stock",
      refused,
      "reselling a code somebody has already read is the worst outcome here"
    );
  }

  // -------------------------------------------------------- held, then released
  {
    const heldOffer = `offer_${run}_held`;
    await svc.uploadCodes({
      sellerId: seller,
      offerId: heldOffer,
      codes: ["HELD-0001"],
    });

    const { delivery } = await svc.openDelivery({
      orderLineId: `line_${run}_held`,
      orderId: `order_${run}_held`,
      sellerId: seller,
      offerId: heldOffer,
      // A guest AS MEDUSA ACTUALLY SHAPES ONE: customer_id present, account
      // absent. Testing with customer_id: null passed while the real thing
      // sailed through, because checkout creates a customer row for guests too
      // and the gate was keyed on the wrong field.
      customerId: `cus_${run}_guest`,
      buyerVerified: false,
      phone: `+92301${String(Date.now()).slice(-7)}`,
      productType: "digital_code",
      amount: 20_000,
    });

    check(
      "Setup: the guest has a customer_id, as Medusa gives every guest",
      Boolean(delivery.customer_id) && delivery.buyer_verified === false
    );

    const outcome = await assessAndFulfil(container, delivery.id);
    check(
      "THE GATE: a risky order is held, and no code is allocated",
      outcome.status === DeliveryStatus.HELD,
      outcome.status
    );

    const stock = await svc.availableStock(heldOffer);
    check(
      "...the code is still in stock",
      stock === 1,
      `${stock} available — a held order must not consume inventory`
    );

    // An agent reviews and releases. Must reach fulfilment WITHOUT being
    // re-scored, or the machine silently overturns the human.
    const released = await fulfil(container, delivery.id);
    check(
      "An agent releasing a hold delivers it",
      released.status === DeliveryStatus.DELIVERED,
      released.status
    );
    check(
      "...and the stock is now consumed",
      (await svc.availableStock(heldOffer)) === 0
    );
  }

  // ------------------------------------------------------------ out of stock
  {
    const dryOffer = `offer_${run}_dry`;
    const { delivery } = await svc.openDelivery({
      orderLineId: `line_${run}_dry`,
      orderId: `order_${run}_dry`,
      sellerId: seller,
      offerId: dryOffer,
      customerId: `cus_${run}`,
      buyerVerified: true,
      phone: `+92302${String(Date.now()).slice(-7)}`,
      productType: "digital_code",
      amount: 500,
    });

    const outcome = await assessAndFulfil(container, delivery.id);
    check(
      "Cleared but no stock lands in out_of_stock, not delivered",
      outcome.status === DeliveryStatus.OUT_OF_STOCK,
      `${outcome.status} — the buyer has paid and ops must refund or restock`
    );
  }

  // ------------------------------------------------------------------ top-up
  {
    const { delivery } = await svc.openDelivery({
      orderLineId: `line_${run}_topup`,
      orderId: `order_${run}_topup`,
      sellerId: seller,
      offerId: `offer_${run}_topup`,
      customerId: `cus_${run}`,
      buyerVerified: true,
      phone: `+92303${String(Date.now()).slice(-7)}`,
      productType: "digital_topup",
      amount: 800,
      fulfilmentInput: { target: "5218841122" },
    });

    const outcome = await assessAndFulfil(container, delivery.id);
    check(
      "A top-up clears to READY for the vendor rather than delivering a code",
      outcome.status === DeliveryStatus.READY,
      outcome.status
    );

    const row = await svc.retrieveDigitalDelivery(delivery.id);
    check(
      "...with an SLA on the vendor",
      Boolean(row.sla_due_at),
      row.sla_due_at ? new Date(row.sla_due_at).toISOString() : "none"
    );
    check(
      "...and the buyer's target is recorded for them",
      (row.fulfilment_input as any)?.target === "5218841122"
    );
  }

  // ================================================================= cleanup
  {
    const codes = await svc.listDigitalCodes({ seller_id: seller } as any, {
      take: 1000,
    });
    if (codes.length) await svc.deleteDigitalCodes(codes.map((c: any) => c.id));

    const deliveries = await svc.listDigitalDeliveries(
      { seller_id: seller } as any,
      { take: 1000 }
    );
    if (deliveries.length) {
      await svc.deleteDigitalDeliveries(deliveries.map((d: any) => d.id));
    }

    const left = await svc.listDigitalCodes({ seller_id: seller } as any, {
      take: 1,
    });
    check(
      "Test stock is cleaned up, so the ops queue stays real",
      left.length === 0,
      `removed ${codes.length} codes and ${deliveries.length} deliveries`
    );
  }

  console.log(`\n  ${checks - failures.length}/${checks} passed`);
  if (failures.length) {
    console.log("\n  FAILED:");
    for (const f of failures) console.log(`    - ${f}`);
    throw new Error(`${failures.length} digital check(s) failed`);
  }
  console.log("\n  All digital checks passed.\n");
}
