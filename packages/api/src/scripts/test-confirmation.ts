import { ExecArgs } from "@medusajs/framework/types";

import { ORDER_CONFIRMATION_MODULE } from "../modules/order-confirmation";
import {
  ConfirmationPolicy,
  ConfirmationStatus,
  ConfirmedVia,
  RiskBand,
} from "../modules/order-confirmation/models/order-confirmation";
import {
  AttemptStatus,
  ContactChannel,
} from "../modules/order-confirmation/models/confirmation-attempt";
import { assessRisk, type RiskInput } from "../modules/order-confirmation/risk";
import { CONFIRM_CONFIG } from "../modules/order-confirmation/service";
import { resolveOnTimeout } from "../lib/confirmation/resolve";
import { isDigitalOnly } from "../lib/confirmation/open-for-order";

/**
 * Order confirmation tests.
 *
 * Two things are actually being defended here, and they are the two that cost
 * real money if they are wrong:
 *
 *  1. **The gate holds.** An unconfirmed order must not be dispatchable, and a
 *     confirmed one must be. Everything else in the module is decoration.
 *  2. **Silence resolves the way policy says**, which is the difference between
 *     shipping a good order and throwing it away.
 *
 * Run:  bun run test:confirmation
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

/** A plausible COD order, varied per case. */
function order(over: Partial<RiskInput> = {}): RiskInput {
  return {
    paymentMethod: "cod",
    orderAmount: 3_000,
    history: {
      deliveredOrders: 0,
      rtoOrders: 0,
      openOrders: 0,
      accountAgeDays: 0,
    },
    address: {
      line1: "House 42, Street 7, Gulshan-e-Iqbal Block 13",
      city: "Karachi",
      province: "Sindh",
    },
    itemCount: 2,
    phoneVerified: true,
    ...over,
  };
}

export default async function testConfirmation({ container }: ExecArgs) {
  const svc: any = container.resolve(ORDER_CONFIRMATION_MODULE);
  const run = `c${Date.now().toString(36)}`;

  console.log(`\nOrder confirmation test (run ${run})\n`);

  // ==================================================================== risk
  console.log("  Risk scoring");

  {
    const prepaid = assessRisk(order({ paymentMethod: "prepaid", orderAmount: 90_000 }));
    check(
      "Prepaid never asks, however large",
      prepaid.policy === ConfirmationPolicy.AUTO,
      `Rs 90,000 prepaid → ${prepaid.policy}`
    );
  }

  {
    const trusted = assessRisk(
      order({
        history: { deliveredOrders: 6, rtoOrders: 0, openOrders: 0, accountAgeDays: 300 },
      })
    );
    check(
      "A buyer with a delivery record is not pestered",
      trusted.policy === ConfirmationPolicy.AUTO,
      `score ${trusted.score}, band ${trusted.band}`
    );
  }

  {
    const stranger = assessRisk(order());
    check(
      "A first-time COD buyer is verified, not cancelled on silence",
      stranger.policy === ConfirmationPolicy.VERIFY,
      `score ${stranger.score}, band ${stranger.band}`
    );
  }

  {
    // The single strongest RTO signal in this market.
    const repeat = assessRisk(
      order({
        history: { deliveredOrders: 1, rtoOrders: 3, openOrders: 1, accountAgeDays: 40 },
      })
    );
    check(
      "A number with a history of returns goes strict",
      repeat.policy === ConfirmationPolicy.STRICT,
      `score ${repeat.score}, band ${repeat.band}`
    );
  }

  {
    // History has to beat value, or every good customer placing a big order
    // gets treated like a fraud.
    const bigButKnown = assessRisk(
      order({
        orderAmount: 45_000,
        history: { deliveredOrders: 8, rtoOrders: 0, openOrders: 0, accountAgeDays: 400 },
      })
    );
    check(
      "A trusted buyer placing a large order is asked, not blocked",
      bigButKnown.policy === ConfirmationPolicy.VERIFY,
      `Rs 45,000 from an 8-order buyer → ${bigButKnown.policy} (${bigButKnown.score})`
    );
  }

  {
    const highValueStranger = assessRisk(order({ orderAmount: 60_000 }));
    check(
      "A large order from an unknown number is never auto-confirmed",
      highValueStranger.policy !== ConfirmationPolicy.AUTO,
      `${highValueStranger.policy}, score ${highValueStranger.score}`
    );
  }

  {
    const vague = assessRisk(order({ address: { line1: "Lahore", city: "" } }));
    const good = assessRisk(order());
    check(
      "An unusable address raises risk on its own",
      vague.score > good.score,
      `${vague.score} vs ${good.score}`
    );
  }

  // ============================================================ state machine
  console.log("\n  State machine and the dispatch gate");

  const lowRisk = await svc.openConfirmation({
    orderId: `order_${run}_auto`,
    sellerId: `sel_${run}`,
    phone: "+923001110001",
    risk: order({
      history: { deliveredOrders: 6, rtoOrders: 0, openOrders: 0, accountAgeDays: 300 },
    }),
  });

  check(
    "An auto-policy order is confirmed on creation, with no outreach",
    lowRisk.confirmation.status === ConfirmationStatus.CONFIRMED &&
      lowRisk.token === null,
    `status ${lowRisk.confirmation.status}`
  );

  {
    const gate = await svc.isDispatchReleased(`order_${run}_auto`);
    check("...and dispatch is released immediately", gate.released === true);
  }

  const pending = await svc.openConfirmation({
    orderId: `order_${run}_verify`,
    sellerId: `sel_${run}`,
    phone: "+923001110002",
    risk: order(),
  });

  check(
    "A COD order needing confirmation starts pending with a token",
    pending.confirmation.status === ConfirmationStatus.PENDING &&
      typeof pending.token === "string" &&
      pending.token.length > 20,
    `status ${pending.confirmation.status}`
  );

  {
    const gate = await svc.isDispatchReleased(`order_${run}_verify`);
    check(
      "THE GATE: an unconfirmed order cannot be dispatched",
      gate.released === false,
      "if this passes when it should not, sellers ship parcels nobody confirmed"
    );
  }

  // Idempotency. The order-placed event is delivered more than once in practice.
  {
    const again = await svc.openConfirmation({
      orderId: `order_${run}_verify`,
      sellerId: `sel_${run}`,
      phone: "+923001110002",
      risk: order(),
    });
    check(
      "Opening the same order twice does not create a second confirmation",
      again.created === false && again.confirmation.id === pending.confirmation.id,
      "a duplicate would invalidate the link already sent to the buyer"
    );
  }

  // ==================================================================== tokens
  console.log("\n  Token handling");

  {
    const found = await svc.findByToken(pending.token);
    check(
      "A valid token resolves to its confirmation",
      found?.id === pending.confirmation.id
    );
  }

  {
    const wrong = await svc.findByToken("x".repeat(43));
    check(
      "A wrong token resolves to nothing",
      wrong === null,
      "tokens are bearer credentials; a near miss must not match"
    );
  }

  {
    const row = await svc.retrieveOrderConfirmation(pending.confirmation.id);
    check(
      "The token itself is never stored",
      Boolean(row.token_hash) &&
        row.token_hash !== pending.token &&
        !JSON.stringify(row).includes(pending.token),
      "a database dump must not hand over working confirm links"
    );
  }

  {
    // The retry must reach the same link, or the WhatsApp message already on
    // the buyer's phone silently stops working.
    const reissued = await svc.issueToken(pending.confirmation.id);
    check(
      "Re-issuing returns the SAME link while it is still live",
      reissued === pending.token,
      "a rotating token breaks every message we have already sent"
    );
  }

  {
    // Force expiry the way time would.
    const expiring = await svc.openConfirmation({
      orderId: `order_${run}_expiry`,
      sellerId: `sel_${run}`,
      phone: "+923001110003",
      risk: order(),
    });
    await svc.updateOrderConfirmations({
      id: expiring.confirmation.id,
      token_expires_at: new Date(Date.now() - 1000),
    });

    const dead = await svc.findByToken(expiring.token);
    check("An expired token stops working", dead === null);

    const fresh = await svc.issueToken(expiring.confirmation.id);
    check(
      "...but a new one can be issued while the order is still open",
      typeof fresh === "string" && fresh !== expiring.token,
      "a buyer who opens WhatsApp on day three should still be able to answer"
    );
  }

  // ================================================================= outreach
  console.log("\n  Outreach, escalation and timeout");

  {
    const c = pending.confirmation;

    // A skipped channel must not burn a retry: the buyer was asked once.
    await svc.recordAttempt({
      confirmationId: c.id,
      channel: ContactChannel.WHATSAPP,
      status: AttemptStatus.SKIPPED,
      error: "No gateway configured",
    });
    const afterSkip = await svc.retrieveOrderConfirmation(c.id);
    check(
      "A skipped channel does not count as asking the buyer",
      afterSkip.attempts === 0,
      `attempts ${afterSkip.attempts}`
    );

    for (let i = 1; i <= CONFIRM_CONFIG.MAX_ATTEMPTS; i++) {
      await svc.recordAttempt({
        confirmationId: c.id,
        channel: ContactChannel.SMS,
        status: AttemptStatus.SENT,
        providerMessageId: `msg_${i}`,
      });
    }

    const exhausted = await svc.retrieveOrderConfirmation(c.id);
    check(
      `Escalates to a human after ${CONFIRM_CONFIG.MAX_ATTEMPTS} attempts`,
      exhausted.status === ConfirmationStatus.ESCALATED,
      `status ${exhausted.status}, attempts ${exhausted.attempts}`
    );

    const log = await svc.attemptsFor(c.id);
    check(
      "Every attempt is logged, including the skip",
      log.length === CONFIRM_CONFIG.MAX_ATTEMPTS + 1,
      `${log.length} rows — this is what a seller is shown when an order is cancelled`
    );

    const gate = await svc.isDispatchReleased(c.order_id);
    check(
      "An escalated order still cannot be dispatched",
      gate.released === false
    );
  }

  // The divergence that decides whether a quiet buyer keeps their order.
  {
    const verify = await svc.openConfirmation({
      orderId: `order_${run}_timeout_verify`,
      sellerId: `sel_${run}`,
      phone: "+923001110004",
      risk: order(),
    });
    check(
      "Setup: a normal COD order is on the verify policy",
      verify.confirmation.policy === ConfirmationPolicy.VERIFY
    );

    // Through resolveOnTimeout, not confirm(), because the thing under test is
    // the POLICY ROUTING. An earlier version called confirm() directly here and
    // still passed with the strict branch deleted, which made it a test of
    // whether confirm() works rather than of what silence means.
    const verifyOutcome = await resolveOnTimeout(container, verify.confirmation);
    const after = await svc.retrieveOrderConfirmation(verify.confirmation.id);
    check(
      "VERIFY ships on silence",
      verifyOutcome.outcome === "confirmed" &&
        after.status === ConfirmationStatus.CONFIRMED,
      "cancelling every quiet buyer would lose more orders than RTO costs"
    );

    const strict = await svc.openConfirmation({
      orderId: `order_${run}_timeout_strict`,
      sellerId: `sel_${run}`,
      phone: "+923001110005",
      risk: order({
        history: { deliveredOrders: 0, rtoOrders: 4, openOrders: 2, accountAgeDays: 10 },
        orderAmount: 40_000,
      }),
    });
    check(
      "Setup: a high-risk order is on the strict policy",
      strict.confirmation.policy === ConfirmationPolicy.STRICT,
      `band ${strict.confirmation.risk_band}, score ${strict.confirmation.risk_score}`
    );

    const strictOutcome = await resolveOnTimeout(container, strict.confirmation);
    const strictAfter = await svc.retrieveOrderConfirmation(strict.confirmation.id);
    check(
      "STRICT cancels on silence",
      strictOutcome.outcome === "cancelled" &&
        strictAfter.status === ConfirmationStatus.CANCELLED,
      "the same silence, the opposite outcome — this is the whole policy split"
    );

    const gate = await svc.isDispatchReleased(strict.confirmation.order_id);
    check(
      "THE GATE: a cancelled order can never be dispatched",
      gate.released === false,
      "shipping this one means a guaranteed return at the seller's expense"
    );
  }

  // ================================================================ terminal
  console.log("\n  Terminal states");

  {
    const c = await svc.openConfirmation({
      orderId: `order_${run}_double`,
      sellerId: `sel_${run}`,
      phone: "+923001110006",
      risk: order(),
    });

    const first = await svc.confirm(c.confirmation.id, ConfirmedVia.LINK, "buyer");
    const second = await svc.confirm(c.confirmation.id, ConfirmedVia.LINK, "buyer");
    check(
      "A buyer tapping confirm twice succeeds twice",
      first.changed === true && second.changed === false,
      "the second tap must not read as an error"
    );

    const cancelAfter = await svc.cancel(c.confirmation.id, "too late", "buyer");
    check(
      "A confirmed order cannot then be cancelled by a stale link",
      cancelAfter.changed === false &&
        cancelAfter.confirmation.status === ConfirmationStatus.CONFIRMED
    );

    // Deliberately still live. Revoking on resolve meant a buyer who tapped
    // confirm and then re-opened the same WhatsApp message was told the link
    // was invalid, which reads as "my confirmation failed".
    const stillResolves = await svc.findByToken(c.token);
    check(
      "The link still opens after the order is resolved, and shows the outcome",
      stillResolves?.status === ConfirmationStatus.CONFIRMED,
      "re-opening the message must not look like a failure"
    );
    check(
      "...but it can no longer change anything",
      cancelAfter.changed === false,
      "a live token on a terminal record is inert, which is why keeping it is safe"
    );
  }

  {
    const missing = await svc.isDispatchReleased(`order_${run}_never_existed`);
    check(
      "An order with no confirmation record is dispatchable",
      missing.released === true,
      "the gate fails OPEN: a bug here must not freeze a seller's whole shop"
    );
  }

  // =================================================================== history
  console.log("\n  Buyer history feeding the next score");

  {
    // Run-scoped, because historyForPhone reads every confirmation ever
    // recorded against a number. A fixed number here accumulated across runs
    // and the assertion drifted from 3 to 6 to 9 — the test was passing on the
    // first run of the day and failing afterwards.
    const phone = `+92300${String(Date.now()).slice(-7)}`;
    for (let i = 0; i < 3; i++) {
      const c = await svc.openConfirmation({
        orderId: `order_${run}_hist_${i}`,
        sellerId: `sel_${run}`,
        phone,
        risk: order(),
      });
      await svc.cancel(c.confirmation.id, "Buyer cancelled", "buyer");
    }

    const history = await svc.historyForPhone(phone);
    check(
      "Cancellations accumulate against the number",
      history.cancelled === 3,
      `${history.cancelled} cancelled of ${history.total}`
    );

    const scored = assessRisk(
      order({
        history: {
          deliveredOrders: history.confirmed,
          rtoOrders: history.cancelled,
          openOrders: history.open,
          accountAgeDays: 1,
        },
      })
    );
    check(
      "...and the fourth order from that number is treated as high risk",
      scored.band === RiskBand.HIGH,
      `score ${scored.score}, ${scored.policy}`
    );
  }

  // ================================================== digital orders skip this
  console.log("\n  Digital orders");

  {
    const digital = [{ product_type: "digital_code" }, { product_type: "digital_topup" }];
    const mixed = [{ product_type: "digital_code" }, { product_type: null }];
    const physical = [{ product_type: null }];
    const service = [{ product_type: "service_booking" }];

    check(
      "An all-digital order needs no confirmation",
      isDigitalOnly({ items: digital }) === true,
      "holding a game top-up to ask whether they meant it would be absurd"
    );
    check(
      "A mixed order IS confirmed",
      isDigitalOnly({ items: mixed }) === false,
      "one physical line means a parcel is moving and the gate applies"
    );
    check(
      "A physical order IS confirmed",
      isDigitalOnly({ items: physical }) === false
    );
    check(
      "A home service IS confirmed",
      isDigitalOnly({ items: service }) === false,
      "someone is going to the buyer's house; confirming matters most there"
    );
    check(
      "An order with no items is not treated as digital",
      isDigitalOnly({ items: [] }) === false,
      "fail towards confirming rather than towards shipping blind"
    );
  }

  // =================================================================== cleanup
  // These are synthetic rows against order ids that do not exist. Left behind
  // they show up in the admin escalation queue looking like real buyers waiting
  // for a call, which is how an ops queue stops being trusted.
  {
    const mine = await svc.listOrderConfirmations({ seller_id: `sel_${run}` } as any, {
      take: 500,
    });
    for (const c of mine) {
      const attempts = await svc.attemptsFor(c.id);
      if (attempts.length) {
        await svc.deleteConfirmationAttempts(attempts.map((a: any) => a.id));
      }
    }
    if (mine.length) {
      await svc.deleteOrderConfirmations(mine.map((c: any) => c.id));
    }
    const left = await svc.listOrderConfirmations({ seller_id: `sel_${run}` } as any, {
      take: 1,
    });
    check(
      "Test rows are cleaned up, so the ops queue stays real",
      left.length === 0,
      `removed ${mine.length}`
    );
  }

  // ==================================================================== result
  console.log(`\n  ${checks - failures.length}/${checks} passed`);
  if (failures.length) {
    console.log("\n  FAILED:");
    for (const f of failures) console.log(`    - ${f}`);
    throw new Error(`${failures.length} confirmation check(s) failed`);
  }
  console.log("\n  All confirmation checks passed.\n");
}
