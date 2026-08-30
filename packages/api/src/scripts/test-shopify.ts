import { ExecArgs } from "@medusajs/framework/types";
import {
  MemoryTokenStore,
  isValidShopDomain,
  needsRefresh,
  isExpired,
  verifyWebhookHmac,
  verifyOAuthCallback,
  REFRESH_MARGIN_MS,
  type ShopifyToken,
} from "../lib/shopify/tokens";
import {
  ShopifyAuthError,
  ShopifyClient,
  ShopifyThrottleError,
  type FetchLike,
} from "../lib/shopify/client";

/**
 * Shopify connector tests.
 *
 * Runs entirely against a fake Shopify. Real Partner credentials do not exist
 * yet (see docs/marketplace/phase0-decisions.md), and the behaviour that
 * matters — token rotation, throttling, HMAC verification — is exactly the
 * behaviour that is hard to exercise against a live store anyway.
 *
 * Run:  bun run test:shopify
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

const SECRET = "shpss_test_secret";

/** A scriptable stand-in for Shopify. */
function fakeShopify(script: {
  responses?: any[];
  refreshResponse?: { ok: boolean; body?: any };
}) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, body, headers: init.headers });

    if (url.includes("/admin/oauth/access_token")) {
      const r = script.refreshResponse ?? { ok: true };
      return {
        ok: r.ok,
        status: r.ok ? 200 : 400,
        text: async () =>
          JSON.stringify(
            r.body ?? {
              access_token: "shpat_rotated",
              refresh_token: "shprt_rotated",
              expires_in: 86400,
              scope: "read_products",
            }
          ),
      };
    }

    const next = script.responses?.[index++] ?? {
      status: 200,
      body: { data: { ok: true } },
    };
    return {
      ok: next.status < 400,
      status: next.status,
      text: async () => JSON.stringify(next.body ?? {}),
    };
  };

  return { fetchImpl, calls };
}

export default async function testShopify(_: ExecArgs) {
  console.log("\nShopify connector test\n");

  // ------------------------------------------------------- shop validation
  check("Accepts a real shop domain", isValidShopDomain("bazaar-seller.myshopify.com"));
  for (const bad of [
    "evil.com",
    "shop.myshopify.com.evil.com",
    "../../etc/passwd",
    "",
    undefined,
  ]) {
    check(
      `Rejects shop domain ${JSON.stringify(bad)}`,
      !isValidShopDomain(bad as any),
      "the shop param comes from a redirect and is interpolated into a hostname"
    );
  }

  // ------------------------------------------------------- expiry handling
  const soon: ShopifyToken = {
    shop: "s.myshopify.com",
    accessToken: "a",
    expiresAt: new Date(Date.now() + REFRESH_MARGIN_MS - 1000),
    refreshToken: "r",
    scope: "read_products",
  };
  const later: ShopifyToken = { ...soon, expiresAt: new Date(Date.now() + 3600_000) };
  const legacy: ShopifyToken = { ...soon, expiresAt: null };
  const dead: ShopifyToken = { ...soon, expiresAt: new Date(Date.now() - 1000) };

  check("Refreshes inside the safety margin", needsRefresh(soon));
  check("Leaves a fresh token alone", !needsRefresh(later));
  check("Legacy permanent token never needs refresh", !needsRefresh(legacy));
  check("Detects an expired token", isExpired(dead));
  check("Legacy permanent token is never expired", !isExpired(legacy));

  // ------------------------------------------------------ automatic rotation
  {
    const store = new MemoryTokenStore();
    await store.put(soon);
    const { fetchImpl, calls } = fakeShopify({
      responses: [{ status: 200, body: { data: { shop: { name: "Test" } } } }],
    });
    const client = new ShopifyClient({
      tokenStore: store,
      apiKey: "k",
      apiSecret: SECRET,
      fetchImpl,
      sleep: async () => {},
    });

    await client.graphql("s.myshopify.com", "{ shop { name } }");

    check("Rotates a near-expiry token before calling", client.refreshes === 1);
    const stored = await store.get("s.myshopify.com");
    check("Persists the rotated token", stored?.accessToken === "shpat_rotated", stored?.accessToken);
    check(
      "Uses the NEW token on the API call",
      calls.at(-1)?.headers["X-Shopify-Access-Token"] === "shpat_rotated",
      calls.at(-1)?.headers["X-Shopify-Access-Token"]
    );
    check("Stores the new expiry", Boolean(stored?.expiresAt));
  }

  // A failed refresh must be explicit: the seller has to reconnect.
  {
    const store = new MemoryTokenStore();
    await store.put(soon);
    const { fetchImpl } = fakeShopify({ refreshResponse: { ok: false } });
    const client = new ShopifyClient({
      tokenStore: store,
      apiKey: "k",
      apiSecret: SECRET,
      fetchImpl,
      sleep: async () => {},
    });
    let threw = false;
    try {
      await client.graphql("s.myshopify.com", "{ shop { name } }");
    } catch (e) {
      threw = e instanceof ShopifyAuthError;
    }
    check("Failed refresh raises a reconnect error", threw);
  }

  // An unconnected shop must not silently no-op.
  {
    const client = new ShopifyClient({
      tokenStore: new MemoryTokenStore(),
      apiKey: "k",
      apiSecret: SECRET,
      fetchImpl: fakeShopify({}).fetchImpl,
      sleep: async () => {},
    });
    let threw = false;
    try {
      await client.graphql("nope.myshopify.com", "{ shop { name } }");
    } catch (e) {
      threw = e instanceof ShopifyAuthError;
    }
    check("Unconnected shop raises rather than no-ops", threw);
  }

  // Invalid shop domains must never reach fetch.
  {
    const { fetchImpl, calls } = fakeShopify({});
    const client = new ShopifyClient({
      tokenStore: new MemoryTokenStore(),
      apiKey: "k",
      apiSecret: SECRET,
      fetchImpl,
      sleep: async () => {},
    });
    try {
      await client.graphql("evil.com", "{ shop { name } }");
    } catch {
      /* expected */
    }
    check("An invalid shop domain never reaches the network", calls.length === 0);
  }

  // --------------------------------------------------------- cost throttling
  {
    const store = new MemoryTokenStore();
    await store.put(later);
    let slept = 0;
    const { fetchImpl } = fakeShopify({
      responses: [
        {
          status: 200,
          body: {
            data: { ok: true },
            extensions: {
              cost: { throttleStatus: { currentlyAvailable: 5, restoreRate: 50 } },
            },
          },
        },
        { status: 200, body: { data: { ok: true } } },
      ],
    });
    const client = new ShopifyClient({
      tokenStore: store,
      apiKey: "k",
      apiSecret: SECRET,
      fetchImpl,
      sleep: async (ms) => {
        slept += ms;
      },
    });

    await client.graphql("s.myshopify.com", "{ a }");
    check("Records the cost bucket from the response",
      client.throttleState.get("s.myshopify.com")?.available === 5);

    await client.graphql("s.myshopify.com", "{ b }");
    check("Waits when the cost bucket is low before calling again", slept > 0, `${slept}ms`);
  }

  // A 429 retries with backoff, then gives up rather than looping forever.
  {
    const store = new MemoryTokenStore();
    await store.put(later);
    const { fetchImpl } = fakeShopify({
      responses: Array.from({ length: 6 }, () => ({ status: 429, body: {} })),
    });
    const client = new ShopifyClient({
      tokenStore: store,
      apiKey: "k",
      apiSecret: SECRET,
      fetchImpl,
      sleep: async () => {},
    });
    let threw = false;
    try {
      await client.graphql("s.myshopify.com", "{ a }");
    } catch (e) {
      threw = e instanceof ShopifyThrottleError;
    }
    check("Persistent 429 gives up instead of looping forever", threw);
  }

  // A GraphQL-level THROTTLED error is retried too — Shopify returns 200 for it.
  {
    const store = new MemoryTokenStore();
    await store.put(later);
    const { fetchImpl } = fakeShopify({
      responses: [
        { status: 200, body: { errors: [{ extensions: { code: "THROTTLED" } }] } },
        { status: 200, body: { data: { recovered: true } } },
      ],
    });
    const client = new ShopifyClient({
      tokenStore: store,
      apiKey: "k",
      apiSecret: SECRET,
      fetchImpl,
      sleep: async () => {},
    });
    const data = await client.graphql<any>("s.myshopify.com", "{ a }");
    check("Retries a 200-with-THROTTLED response", data?.recovered === true);
  }

  // 401 means the token is dead server-side even if it looks valid to us.
  {
    const store = new MemoryTokenStore();
    await store.put(later);
    const { fetchImpl } = fakeShopify({ responses: [{ status: 401, body: {} }] });
    const client = new ShopifyClient({
      tokenStore: store,
      apiKey: "k",
      apiSecret: SECRET,
      fetchImpl,
      sleep: async () => {},
    });
    let threw = false;
    try {
      await client.graphql("s.myshopify.com", "{ a }");
    } catch (e) {
      threw = e instanceof ShopifyAuthError;
    }
    check("A 401 surfaces as a reconnect error", threw);
  }

  // ------------------------------------------------------------- webhook HMAC
  {
    const crypto = await import("node:crypto");
    const payload = JSON.stringify({ id: 123, title: "A product" });
    const valid = crypto.createHmac("sha256", SECRET).update(payload).digest("base64");

    check(
      "Accepts a correctly signed webhook",
      await verifyWebhookHmac({ rawBody: payload, hmacHeader: valid, secret: SECRET })
    );
    check(
      "Rejects a tampered body",
      !(await verifyWebhookHmac({
        rawBody: payload.replace("123", "124"),
        hmacHeader: valid,
        secret: SECRET,
      }))
    );
    check(
      "Rejects a wrong secret",
      !(await verifyWebhookHmac({ rawBody: payload, hmacHeader: valid, secret: "other" }))
    );
    check(
      "Rejects a missing signature",
      !(await verifyWebhookHmac({ rawBody: payload, hmacHeader: undefined, secret: SECRET }))
    );
  }

  // -------------------------------------------------------- OAuth callback HMAC
  {
    const crypto = await import("node:crypto");
    const params: Record<string, string> = {
      code: "abc123",
      shop: "bazaar-seller.myshopify.com",
      state: "nonce",
      timestamp: "1786000000",
    };
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    const hmac = crypto.createHmac("sha256", SECRET).update(message).digest("hex");

    check(
      "Accepts a genuine OAuth callback",
      await verifyOAuthCallback({ query: { ...params, hmac }, secret: SECRET })
    );
    check(
      "Rejects a forged OAuth callback",
      !(await verifyOAuthCallback({
        query: { ...params, shop: "evil.myshopify.com", hmac },
        secret: SECRET,
      }))
    );
  }

  console.log("");
  if (failures.length) {
    console.log(`${failures.length} of ${checks} checks FAILED:`);
    failures.forEach((f) => console.log(`  - ${f}`));
    throw new Error(`${failures.length} Shopify checks failed`);
  }
  console.log(`All ${checks} Shopify connector checks passed.\n`);
}
