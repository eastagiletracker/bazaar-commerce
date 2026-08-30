#!/usr/bin/env node
/**
 * Phase 1 verification: drive a complete PKR order through the Store API.
 *
 * Proves region -> cart -> line item -> address -> shipping -> payment -> order
 * works end to end against a running backend, and that every money value on the
 * resulting order is denominated in PKR.
 *
 * Usage:
 *   node scripts/smoke-checkout.mjs
 *   BACKEND=http://localhost:3101 PUBKEY=pk_... node scripts/smoke-checkout.mjs
 *
 * Exits non-zero on the first failed assertion.
 */

const BACKEND = process.env.BACKEND || "http://localhost:3101";
const PUBKEY = process.env.PUBKEY || process.env.PK_PUBLISHABLE_KEY;

if (!PUBKEY) {
  fail(
    "No publishable key. Pass PUBKEY=pk_... or export PK_PUBLISHABLE_KEY.\n" +
      "Get one with: docker exec pkmkt_postgres psql -U pkmkt -d pkmkt -t -A " +
      "-c \"select token from api_key where type='publishable' limit 1;\""
  );
}

let step = 0;
function ok(msg, detail = "") {
  step += 1;
  console.log(`  ${String(step).padStart(2, "0")}. PASS  ${msg}${detail ? ` — ${detail}` : ""}`);
}
function fail(msg) {
  console.error(`\nFAIL: ${msg}\n`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
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
    fail(`${method} ${path} -> ${res.status}, non-JSON body: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    fail(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

console.log(`\nPKR checkout smoke test against ${BACKEND}\n`);

// 0. Authenticate a customer ---------------------------------------------------
// Order groups are customer-scoped, so the whole flow runs authenticated.
// A fixed email keeps re-runs idempotent: register once, log in thereafter.
const CUSTOMER_EMAIL = process.env.SMOKE_EMAIL || "smoke-test@bazaar.pk";
const CUSTOMER_PASSWORD = process.env.SMOKE_PASSWORD || "SmokeTest#2026";

async function login() {
  const res = await fetch(`${BACKEND}/auth/customer/emailpass`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-publishable-api-key": PUBKEY },
    body: JSON.stringify({ email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD }),
  });
  if (!res.ok) {
    fail(`Login failed for ${CUSTOMER_EMAIL}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const { token } = await res.json();
  return token;
}

async function authenticate() {
  const register = await fetch(`${BACKEND}/auth/customer/emailpass/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-publishable-api-key": PUBKEY },
    body: JSON.stringify({ email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD }),
  });

  let mode = "logged in";
  if (register.ok) {
    // The register token carries no actor_id, so it can only create the
    // customer record. A customer-scoped JWT requires logging in afterwards.
    const { token } = await register.json();
    authToken = token;
    await api("/store/customers", {
      method: "POST",
      body: { email: CUSTOMER_EMAIL, first_name: "Ali", last_name: "Khan" },
    });
    mode = "registered";
  }

  authToken = await login();
  return mode;
}

const authMode = await authenticate();
assert(authToken, "No auth token obtained");
ok("Customer authenticated", `${CUSTOMER_EMAIL} (${authMode})`);

// 1. Region must be Pakistan / PKR ------------------------------------------
const { regions } = await api("/store/regions");
const region = regions.find((r) => r.currency_code === "pkr");
assert(region, `No PKR region found. Got: ${regions.map((r) => `${r.name}/${r.currency_code}`).join(", ")}`);
assert(
  region.countries.some((c) => c.iso_2 === "pk"),
  `PKR region does not contain country "pk" (has: ${region.countries.map((c) => c.iso_2).join(",")})`
);
ok("Region is Pakistan/PKR", `${region.name} (${region.id})`);

// 2. Find a purchasable offer -------------------------------------------------
// Mercur is offer-based: a cart line references a specific seller's listing
// (offer), not a bare product variant. This is the multi-vendor pivot — the
// offer is what carries seller_id through to the order and the commission line.
const { offers } = await api(`/store/offers?limit=50&region_id=${region.id}`);
assert(offers.length > 0, "No offers returned from /store/offers");

const offer = offers.find((o) => o.calculated_price?.calculated_amount > 0);
assert(offer, "No offer with a calculated PKR price found");
assert(
  offer.calculated_price.currency_code === "pkr",
  `Offer priced in ${offer.calculated_price.currency_code}, expected pkr`
);
assert(offer.seller_id, "Offer has no seller_id — commission cannot be attributed");
const unitPrice = Number(offer.calculated_price.calculated_amount);
ok(
  "Found priced offer",
  `${offer.seller.name} — ${offer.product_variant.title} @ PKR ${unitPrice}`
);

// 3. Create cart --------------------------------------------------------------
let { cart } = await api("/store/carts", {
  method: "POST",
  body: { region_id: region.id, email: "smoke-test@bazaar.pk" },
});
assert(cart.currency_code === "pkr", `Cart currency is ${cart.currency_code}, expected pkr`);
ok("Cart created in PKR", cart.id);

// 4. Add line item ------------------------------------------------------------
({ cart } = await api(`/store/carts/${cart.id}/line-items`, {
  method: "POST",
  body: { offer_id: offer.id, quantity: 2 },
}));
assert(cart.items.length === 1, `Expected 1 line item, got ${cart.items.length}`);
assert(cart.items[0].quantity === 2, `Expected quantity 2, got ${cart.items[0].quantity}`);
ok("Line item added", `qty 2, subtotal PKR ${cart.item_subtotal ?? cart.subtotal}`);

// 5. Pakistani shipping address ----------------------------------------------
({ cart } = await api(`/store/carts/${cart.id}`, {
  method: "POST",
  body: {
    email: "smoke-test@bazaar.pk",
    shipping_address: {
      first_name: "Ali",
      last_name: "Khan",
      address_1: "Plot 42, Shahrah-e-Faisal",
      address_2: "Block 6, PECHS",
      city: "Karachi",
      province: "Sindh",
      postal_code: "75400",
      country_code: "pk",
      phone: "+923001234567",
    },
    billing_address: {
      first_name: "Ali",
      last_name: "Khan",
      address_1: "Plot 42, Shahrah-e-Faisal",
      city: "Karachi",
      province: "Sindh",
      postal_code: "75400",
      country_code: "pk",
      phone: "+923001234567",
    },
  },
}));
assert(cart.shipping_address?.country_code === "pk", "Shipping address country is not pk");
ok("PK shipping address set", `${cart.shipping_address.city}, ${cart.shipping_address.province}`);

// 6. Shipping method, per seller ----------------------------------------------
// Multi-vendor shape: /store/shipping-options returns a map keyed by seller_id,
// not a flat array. Every seller represented in the cart needs its own shipping
// method or the cart will not complete.
const { shipping_options: optionsBySeller } = await api(
  `/store/shipping-options?cart_id=${cart.id}`
);
// The endpoint keys by the sellers actually represented in the cart, so this is
// the authoritative seller set (cart line items do not expose seller_id).
const sellerIds = Object.keys(optionsBySeller || {});
assert(sellerIds.length > 0, "No shipping options available for this cart");
assert(
  sellerIds.includes(offer.seller_id),
  `Cart contains an offer from seller ${offer.seller_id} but shipping options only cover ${sellerIds.join(", ")}`
);

let chosen = [];
for (const sellerId of sellerIds) {
  const opt = optionsBySeller[sellerId][0];
  ({ cart } = await api(`/store/carts/${cart.id}/shipping-methods`, {
    method: "POST",
    body: { option_id: opt.id },
  }));
  chosen.push(`${sellerId.slice(-6)}:${opt.name}`);
}
assert(cart.shipping_methods.length > 0, "Shipping method was not attached to cart");
ok(
  `Shipping method added for ${sellerIds.length} seller(s)`,
  `${chosen.join(", ")} — PKR ${cart.shipping_methods.reduce((s, m) => s + Number(m.amount), 0)}`
);

// 7. Payment session ----------------------------------------------------------
const { payment_providers: providers } = await api(
  `/store/payment-providers?region_id=${region.id}`
);
assert(providers.length > 0, "No payment providers for the PKR region");
const { payment_collection } = await api("/store/payment-collections", {
  method: "POST",
  body: { cart_id: cart.id },
});
await api(`/store/payment-collections/${payment_collection.id}/payment-sessions`, {
  method: "POST",
  body: { provider_id: providers[0].id },
});
ok("Payment session initialized", providers[0].id);

// 8. Complete the cart ---------------------------------------------------------
// A multi-vendor cart does not settle into a single order: it splits into one
// order per seller, wrapped in an order_group. A single-seller cart still comes
// back as a group with one child order.
const completed = await api(`/store/carts/${cart.id}/complete`, { method: "POST" });
assert(
  completed.type === "order_group" || completed.type === "order",
  `Cart did not complete: ${JSON.stringify(completed).slice(0, 400)}`
);

let orders;
let groupTotal;
if (completed.type === "order_group") {
  const groupId = completed.order_group.id;
  const { order_group: group } = await api(`/store/order-groups/${groupId}`);
  orders = group.orders;
  groupTotal = Number(group.total);
  assert(orders?.length > 0, `Order group ${groupId} contains no orders`);
  assert(
    group.seller_count === sellerIds.length,
    `Group seller_count ${group.seller_count} != ${sellerIds.length} sellers in cart`
  );
  assert(
    orders.length === sellerIds.length,
    `Group has ${orders.length} orders for ${sellerIds.length} sellers — expected one order per seller`
  );
  ok(
    "Order group created",
    `${groupId} — ${orders.length} order(s) across ${group.seller_count} seller(s), PKR ${groupTotal}`
  );
} else {
  orders = [completed.order];
  groupTotal = Number(completed.order.total);
  ok("Order placed", `${completed.order.id} — PKR ${groupTotal}`);
}

// 9. Money assertions ----------------------------------------------------------
// Two endpoints, two different truths (verified against the DB on 2026-08-12):
//   /store/order-groups/:id  -> correct `seller`, but per-order totals are NOT
//                               hydrated (item_total comes back 0).
//   /store/orders/:id        -> correct totals, but `seller` is null.
// So read the seller from the group and the money from the per-order endpoint.
// Never trust order-group nested totals for anything financial.
const expectedItemTotal = unitPrice * 2;
let sumItems = 0;
let sumShipping = 0;
let sumTax = 0;
let sumTotal = 0;

for (const groupOrder of orders) {
  const seller = groupOrder.seller;
  assert(
    seller?.id,
    `Order ${groupOrder.id} has no seller — commission cannot be attributed`
  );

  const { order: o } = await api(`/store/orders/${groupOrder.id}`);
  assert(o.currency_code === "pkr", `Order ${o.id} currency is ${o.currency_code}, expected pkr`);
  assert(Number(o.total) > 0, `Order ${o.id} total is ${o.total}, expected > 0`);
  assert(
    Number(o.item_total) > 0,
    `Order ${o.id} item_total is ${o.item_total} — totals did not hydrate`
  );

  sumItems += Number(o.item_total ?? 0);
  sumShipping += Number(o.shipping_total ?? 0);
  sumTax += Number(o.tax_total ?? 0);
  sumTotal += Number(o.total);
}

assert(
  Math.abs(sumItems - expectedItemTotal) < 0.01,
  `Item total ${sumItems} != expected ${expectedItemTotal} (2 x ${unitPrice})`
);
assert(
  Math.abs(sumTotal - (sumItems + sumShipping + sumTax)) < 0.01,
  `Order totals do not reconcile: items ${sumItems} + shipping ${sumShipping} + tax ${sumTax} != ${sumTotal}`
);
assert(
  Math.abs(sumTotal - groupTotal) < 0.01,
  `Sum of order totals ${sumTotal} != group total ${groupTotal}`
);
ok(
  "Order money reconciles",
  `items ${sumItems} + shipping ${sumShipping} + tax ${sumTax} = ${sumTotal} PKR`
);

console.log(
  `\nAll ${step} checks passed. ${orders.length} PKR order(s) totalling ${sumTotal}.\n`
);
