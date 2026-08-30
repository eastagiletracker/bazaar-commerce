import { ExecArgs } from "@medusajs/framework/types";
import { MercurModules } from "@mercurjs/types";
import PayoutPakistanProviderService from "../providers/payout-pakistan/service";

/**
 * Exercises the payout-pakistan provider against Mercur's IPayoutProvider
 * contract, and proves it is actually registered in the payout module.
 *
 * Run:  bun run test:payout
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

export default async function testPayoutProvider({ container }: ExecArgs) {
  console.log("\nPayout provider test\n");

  // ------------------------------------------------- wired into the module
  // Providers are registered inside the payout module's own container (as
  // `payout_<identifier>_<id>`), not the app container, so resolving the key
  // directly proves nothing here. Calling THROUGH the module service does:
  // it delegates to whichever single provider the module accepted, and the
  // module refuses to boot with anything other than exactly one.
  const payoutModule: any = container.resolve(MercurModules.PAYOUT);
  check("Payout module resolves", Boolean(payoutModule));

  const wired = await payoutModule.createPayoutAccount({
    context: { seller_id: "sel_wiring_probe" },
    data: {
      seller_id: "sel_wiring_probe",
      email: "probe@bazaar.pk",
      cnic: "42101-0000000-0",
      payment_details: { iban: "PK36SCBL0000001123456702" },
    },
  });
  check(
    "Payout module routes to payout-pakistan",
    wired?.data?.psp === "mock",
    `data.psp = ${JSON.stringify(wired?.data?.psp)} (Stripe Connect would not set this)`
  );

  // --------------------------------------------------- contract surface check
  const provider = new PayoutPakistanProviderService(null, {
    driver: "mock",
    autoActivate: true,
  });

  for (const method of [
    "createPayoutAccount",
    "createOnboarding",
    "createPayout",
    "getWebhookActionAndData",
  ]) {
    check(
      `Implements ${method}`,
      typeof (provider as any)[method] === "function"
    );
  }
  check(
    "Declares its identifier",
    PayoutPakistanProviderService.identifier === "pakistan"
  );

  // ---------------------------------------------------------- account + KYC
  const account = await provider.createPayoutAccount({
    data: {
      seller_id: "sel_test",
      email: "seller@bazaar.pk",
      cnic: "42101-1234567-1",
      payment_details: { iban: "PK36SCBL0000001123456702", bank_name: "SCB" },
    },
  });
  check("Creates a sub-merchant account", Boolean(account.id), account.id);
  check("Account is active when KYC auto-completes", account.status === "active", String(account.status));
  check("PSP identity travels in data", account.data.psp === "mock");

  // A seller with no payout destination must not come back usable.
  const incomplete = await provider.createPayoutAccount({
    data: { seller_id: "sel_incomplete", email: "nobank@bazaar.pk" },
  });
  check(
    "Account with no IBAN or CNIC is restricted",
    incomplete.status === "restricted",
    String(incomplete.status)
  );

  const onboarding = await provider.createOnboarding({
    data: { account_id: account.id },
  });
  check(
    "Produces a KYC onboarding link",
    typeof onboarding.data.onboarding_url === "string",
    String(onboarding.data.onboarding_url)
  );

  let onboardingRejected = false;
  try {
    await provider.createOnboarding({ data: {} });
  } catch {
    onboardingRejected = true;
  }
  check("Onboarding without an account_id is rejected", onboardingRejected);

  // ----------------------------------------------------------------- payouts
  const payout = await provider.createPayout({
    amount: 8750,
    currency_code: "pkr",
    account_id: account.id,
    context: { idempotency_key: "order_test_1" },
  });
  check(
    "Disburses and reports a non-final status",
    payout.status === "processing",
    `status ${payout.status} — bank rails are asynchronous, so "paid" must come from a webhook`
  );
  check("Returns a PSP payout id", Boolean(payout.data.payout_id), String(payout.data.payout_id));

  const replay = await provider.createPayout({
    amount: 8750,
    currency_code: "pkr",
    account_id: account.id,
    context: { idempotency_key: "order_test_1" },
  });
  check(
    "Idempotency key prevents a double disbursement",
    replay.data.payout_id === payout.data.payout_id,
    `${payout.data.payout_id} === ${replay.data.payout_id}`
  );

  for (const [label, amount] of [
    ["zero", 0],
    ["negative", -100],
  ] as const) {
    let rejected = false;
    try {
      await provider.createPayout({
        amount,
        currency_code: "pkr",
        account_id: account.id,
      });
    } catch {
      rejected = true;
    }
    check(`Refuses a ${label} disbursement`, rejected);
  }

  let wrongCurrencyRejected = false;
  try {
    await provider.createPayout({
      amount: 100,
      currency_code: "usd",
      account_id: account.id,
    });
  } catch {
    wrongCurrencyRejected = true;
  }
  check("Refuses a non-PKR disbursement", wrongCurrencyRejected);

  // Failure path must be reachable, not theoretical.
  const failing = new PayoutPakistanProviderService(null, {
    driver: "mock",
    autoActivate: true,
    failForSellers: ["sel_bad"],
  });
  const failed = await failing.createPayout({
    amount: 500,
    currency_code: "pkr",
    account_id: "mockacct_sel_bad",
    context: { idempotency_key: "order_bad_1" },
  });
  check("Surfaces a failed disbursement", failed.status === "failed", String(failed.status));
  check("Carries the failure reason", Boolean(failed.data.failure_reason), String(failed.data.failure_reason));

  // ---------------------------------------------------------------- webhooks
  const paidHook = await provider.getWebhookActionAndData({
    data: {},
    rawData: JSON.stringify({ type: "payout.updated", payout_id: "mockpout_1", status: "paid" }),
    headers: {},
  });
  check("Paid webhook maps to captured", paidHook.action === "captured", paidHook.action);
  check("Paid webhook carries the payout id", paidHook.data?.id === "mockpout_1");

  const failedHook = await provider.getWebhookActionAndData({
    data: {},
    rawData: JSON.stringify({ type: "payout.updated", payout_id: "mockpout_2", status: "failed" }),
    headers: {},
  });
  check("Failed webhook maps to failed", failedHook.action === "failed", failedHook.action);

  const garbage = await provider.getWebhookActionAndData({
    data: {},
    rawData: "not json at all",
    headers: {},
  });
  check("Malformed webhook is not_supported, not a crash", garbage.action === "not_supported");

  // ------------------------------------------------------ misconfiguration
  let unknownDriverRejected = false;
  try {
    new PayoutPakistanProviderService(null, { driver: "safepay" as any });
  } catch {
    unknownDriverRejected = true;
  }
  check(
    "Selecting an uncontracted PSP fails loudly",
    unknownDriverRejected,
    "must not silently fall back to a driver that always reports success"
  );

  console.log("");
  if (failures.length) {
    console.log(`${failures.length} of ${checks} checks FAILED:`);
    failures.forEach((f) => console.log(`  - ${f}`));
    throw new Error(`${failures.length} payout provider checks failed`);
  }
  console.log(`All ${checks} payout provider checks passed.\n`);
}
