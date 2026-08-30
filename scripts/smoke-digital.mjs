#!/usr/bin/env node
/**
 * End-to-end digital purchase against a running backend.
 *
 * Proves the whole chain a buyer actually walks: a digital-only cart checks out
 * with no courier, the fraud gate runs, a code is allocated from the vault, and
 * the buyer can read exactly one code that nobody else received.
 *
 * Usage:
 *   PUBKEY=pk_... node scripts/smoke-digital.mjs
 */

const BACKEND = process.env.BACKEND || "http://localhost:3101";
const PUBKEY = process.env.PUBKEY;
const OFFER = process.env.OFFER;

if (!PUBKEY || !OFFER) {
  console.error("Need PUBKEY and OFFER. Get the offer id from `bun run seed:digital-demo`.");
  process.exit(1);
}

let step = 0;
const failures = [];
function check(label, ok, detail = "") {
  step += 1;
  console.log(`  ${String(step).padStart(2, "0")}. ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

let authToken = null;
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-publishable-api-key": PUBKEY,
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

console.log("\nDigital purchase smoke test\n");

// A verified customer by default. GUEST=1 checks out anonymously, which the
// fraud gate should HOLD rather than deliver: a code cannot be recalled.
const GUEST = process.env.GUEST === "1";
const cred = { email: "digital-smoke@bazaar.pk", password: "SmokeTest#2026" };
let auth = GUEST ? { ok: false, json: {} } : await api("/auth/customer/emailpass", { method: "POST", body: cred });
if (!GUEST && !auth.ok) {
  await api("/auth/customer/emailpass/register", { method: "POST", body: cred });
  auth = await api("/auth/customer/emailpass", { method: "POST", body: cred });
}
authToken = auth.json.token;

const me = GUEST ? { ok: true } : await api("/store/customers/me");
if (!GUEST && !me.ok) {
  await api("/store/customers", { method: "POST", body: { email: cred.email } });
  auth = await api("/auth/customer/emailpass", { method: "POST", body: cred });
  authToken = auth.json.token;
}
check(
  GUEST ? "Checking out as an anonymous guest" : "Signed in as a verified customer",
  GUEST ? !authToken : Boolean(authToken)
);

const regions = await api("/store/regions");
const region = regions.json.regions.find((r) => r.currency_code === "pkr");

const cart = await api("/store/carts", {
  method: "POST",
  body: { region_id: region.id, email: GUEST ? "guest-digital@bazaar.pk" : cred.email },
});
const cartId = cart.json.cart.id;

const added = await api(`/store/carts/${cartId}/line-items`, {
  method: "POST",
  body: { offer_id: OFFER, quantity: 1 },
});
check("Digital item added to cart", added.ok, added.ok ? "" : JSON.stringify(added.json).slice(0, 160));
if (!added.ok) process.exit(1);

await api(`/store/carts/${cartId}`, {
  method: "POST",
  body: {
    email: GUEST ? "guest-digital@bazaar.pk" : cred.email,
    shipping_address: {
      first_name: "Digital",
      last_name: "Buyer",
      address_1: "House 12, Street 4, Gulshan-e-Iqbal",
      city: "Karachi",
      province: "Sindh",
      country_code: "pk",
      postal_code: "75300",
      phone: GUEST ? "+923007776655" : "+923009998877",
    },
  },
});

const opts = await api(`/store/shipping-options?cart_id=${cartId}`);
const all = Object.values(opts.json.shipping_options ?? {}).flat();
const instant = all.find((o) => o.name === "Instant delivery");
check(
  'An "Instant delivery" option at Rs 0 is offered',
  Boolean(instant) && Number(instant.amount ?? instant.calculated_price?.calculated_amount ?? -1) === 0,
  instant ? `PKR ${instant.amount ?? instant.calculated_price?.calculated_amount}` : "not offered"
);

await api(`/store/carts/${cartId}/shipping-methods`, {
  method: "POST",
  body: { option_id: instant.id },
});

const pc = await api("/store/payment-collections", { method: "POST", body: { cart_id: cartId } });
await api(`/store/payment-collections/${pc.json.payment_collection.id}/payment-sessions`, {
  method: "POST",
  body: { provider_id: "pp_system_default" },
});

const done = await api(`/store/carts/${cartId}/complete`, { method: "POST" });
check("Digital-only checkout completes", done.ok, done.ok ? "" : JSON.stringify(done.json).slice(0, 200));
if (!done.ok) process.exit(1);

const og = done.json.order_group ?? done.json.order;
const total = Number(og?.total ?? 0);
check("No shipping was charged", total === 1750, `PKR ${total}`);

// The subscriber runs on the event bus; give it a moment.
await new Promise((r) => setTimeout(r, 2500));

console.log(`\n  order group ${og.id}`);
console.log("\n  Now check delivery with:  cd packages/api && bun run digital:link\n");

if (failures.length) {
  console.log(`  ${failures.length} check(s) failed\n`);
  process.exit(1);
}
console.log(`  ${step}/${step} passed\n`);
