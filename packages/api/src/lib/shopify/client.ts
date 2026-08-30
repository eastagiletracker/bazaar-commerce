import {
  isExpired,
  isValidShopDomain,
  needsRefresh,
  type ShopifyToken,
  type TokenStore,
} from "./tokens";

/**
 * Shopify Admin GraphQL client with token rotation and cost-aware throttling.
 *
 * Shopify's Admin GraphQL API bills by query COST against a leaky bucket, not
 * by request count, so "requests per second" is the wrong thing to limit on.
 * Every response reports the bucket state, and this client waits when the
 * bucket runs low instead of discovering the limit by getting a 429 mid-import.
 */

export const SHOPIFY_API_VERSION = "2026-07";

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export type ShopifyClientOptions = {
  tokenStore: TokenStore;
  apiKey: string;
  apiSecret: string;
  /** Injected for tests. */
  fetchImpl?: FetchLike;
  /** Injected so tests do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  apiVersion?: string;
};

export class ShopifyAuthError extends Error {}
export class ShopifyThrottleError extends Error {}

export class ShopifyClient {
  private fetchImpl: FetchLike;
  private sleep: (ms: number) => Promise<void>;
  private apiVersion: string;

  /** Last observed leaky-bucket state, per shop. */
  readonly throttleState = new Map<string, { available: number; restoreRate: number }>();
  /** Counts how often we deliberately waited, so throttling is observable. */
  waits = 0;
  refreshes = 0;

  constructor(private options: ShopifyClientOptions) {
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.apiVersion = options.apiVersion ?? SHOPIFY_API_VERSION;
  }

  /**
   * Return a usable token, refreshing it first if it is close to expiry.
   *
   * Refreshing before the deadline rather than on failure is the difference
   * between a seller's catalogue staying in sync and it silently stopping.
   */
  async getUsableToken(shop: string): Promise<ShopifyToken> {
    if (!isValidShopDomain(shop)) {
      throw new ShopifyAuthError(`Refusing to call an invalid shop domain: ${shop}`);
    }

    const token = await this.options.tokenStore.get(shop);
    if (!token) {
      throw new ShopifyAuthError(`${shop} is not connected`);
    }

    if (needsRefresh(token)) {
      const refreshed = await this.refresh(token);
      await this.options.tokenStore.put(refreshed);
      this.refreshes += 1;
      return refreshed;
    }

    if (isExpired(token)) {
      throw new ShopifyAuthError(
        `${shop}'s access token expired and could not be refreshed; the seller must reconnect`
      );
    }

    return token;
  }

  private async refresh(token: ShopifyToken): Promise<ShopifyToken> {
    const res = await this.fetchImpl(
      `https://${token.shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: this.options.apiKey,
          client_secret: this.options.apiSecret,
          grant_type: "refresh_token",
          refresh_token: token.refreshToken,
        }),
      }
    );

    if (!res.ok) {
      throw new ShopifyAuthError(
        `Token refresh failed for ${token.shop} (${res.status}); the seller must reconnect`
      );
    }

    const body = JSON.parse(await res.text());
    return {
      shop: token.shop,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? token.refreshToken,
      expiresAt: body.expires_in
        ? new Date(Date.now() + Number(body.expires_in) * 1000)
        : null,
      scope: body.scope ?? token.scope,
    };
  }

  /**
   * Run a GraphQL query, waiting when the cost bucket is low and retrying on a
   * throttle response.
   */
  async graphql<T = any>(
    shop: string,
    query: string,
    variables: Record<string, unknown> = {},
    attempt = 0
  ): Promise<T> {
    const token = await this.getUsableToken(shop);
    await this.waitForBudget(shop);

    const res = await this.fetchImpl(
      `https://${shop}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": token.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    if (res.status === 401) {
      throw new ShopifyAuthError(`${shop} rejected our token; the seller must reconnect`);
    }

    if (res.status === 429) {
      if (attempt >= 3) {
        throw new ShopifyThrottleError(`${shop} kept throttling after ${attempt} retries`);
      }
      this.waits += 1;
      await this.sleep(2 ** attempt * 1000);
      return this.graphql<T>(shop, query, variables, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(`Shopify returned ${res.status} for ${shop}`);
    }

    const body = JSON.parse(await res.text());

    // Record the bucket so the NEXT call can wait before being throttled.
    const cost = body?.extensions?.cost;
    if (cost?.throttleStatus) {
      this.throttleState.set(shop, {
        available: Number(cost.throttleStatus.currentlyAvailable),
        restoreRate: Number(cost.throttleStatus.restoreRate),
      });
    }

    if (body.errors?.length) {
      const throttled = body.errors.some(
        (e: any) => e?.extensions?.code === "THROTTLED"
      );
      if (throttled) {
        if (attempt >= 3) {
          throw new ShopifyThrottleError(`${shop} kept throttling after ${attempt} retries`);
        }
        this.waits += 1;
        await this.sleep(2 ** attempt * 1000);
        return this.graphql<T>(shop, query, variables, attempt + 1);
      }
      throw new Error(
        `Shopify GraphQL error for ${shop}: ${body.errors.map((e: any) => e.message).join("; ")}`
      );
    }

    return body.data as T;
  }

  /** Wait until the leaky bucket has refilled enough to be worth calling. */
  private async waitForBudget(shop: string, needed = 100): Promise<void> {
    const state = this.throttleState.get(shop);
    if (!state || state.available >= needed) return;

    const deficit = needed - state.available;
    const waitMs = Math.ceil((deficit / Math.max(state.restoreRate, 1)) * 1000);
    this.waits += 1;
    await this.sleep(waitMs);
    // Assume the bucket refilled; the next response corrects this.
    this.throttleState.set(shop, { ...state, available: needed });
  }
}
