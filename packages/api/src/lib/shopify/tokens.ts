/**
 * Shopify OAuth token handling.
 *
 * As of 2026-04-01 new public apps must use EXPIRING offline access tokens, so
 * rotation is normal operation rather than an edge case. Building it in from
 * the start is the whole point of this module: an app that assumes a permanent
 * token silently stops syncing a day after install, and the failure looks like
 * "the seller's catalogue went stale" rather than "auth expired".
 *
 * Token storage is deliberately behind an interface. Access tokens are seller
 * credentials; in production they belong in a secrets store, not a plain column.
 */

export type ShopifyToken = {
  shop: string;
  accessToken: string;
  /** Absolute expiry. Legacy permanent tokens have none. */
  expiresAt?: Date | null;
  refreshToken?: string | null;
  scope: string;
};

export interface TokenStore {
  get(shop: string): Promise<ShopifyToken | null>;
  put(token: ShopifyToken): Promise<void>;
  delete(shop: string): Promise<void>;
}

/** In-memory store for tests and local development only. */
export class MemoryTokenStore implements TokenStore {
  private tokens = new Map<string, ShopifyToken>();
  async get(shop: string) {
    return this.tokens.get(shop) ?? null;
  }
  async put(token: ShopifyToken) {
    this.tokens.set(token.shop, token);
  }
  async delete(shop: string) {
    this.tokens.delete(shop);
  }
}

/**
 * Refresh a token before it expires rather than after.
 *
 * A token that expires mid-sync fails the request that happens to be in flight,
 * so refresh early with a safety margin. The default margin is generous because
 * a needless refresh is cheap and a failed order push is not.
 */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000; // 10 minutes

export function needsRefresh(token: ShopifyToken, now: Date = new Date()): boolean {
  // No expiry means a legacy permanent token: nothing to refresh.
  if (!token.expiresAt) return false;
  return token.expiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS;
}

export function isExpired(token: ShopifyToken, now: Date = new Date()): boolean {
  if (!token.expiresAt) return false;
  return token.expiresAt.getTime() <= now.getTime();
}

/**
 * Verify a Shopify webhook HMAC.
 *
 * Compared in constant time: a plain string compare leaks how much of the
 * signature matched, which is enough to forge one given time.
 */
export async function verifyWebhookHmac(input: {
  rawBody: string | Buffer;
  hmacHeader: string | undefined;
  secret: string;
}): Promise<boolean> {
  if (!input.hmacHeader) return false;

  const crypto = await import("node:crypto");
  const digest = crypto
    .createHmac("sha256", input.secret)
    .update(Buffer.from(input.rawBody as any))
    .digest("base64");

  const a = Buffer.from(digest);
  const b = Buffer.from(input.hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Validate the shop domain before using it anywhere.
 *
 * The shop parameter arrives from a redirect and is attacker-controllable. It
 * is interpolated into an API hostname, so an unvalidated value is a request
 * forgery straight out of our backend.
 */
export function isValidShopDomain(shop: string | undefined | null): boolean {
  if (!shop) return false;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}

/**
 * Verify the HMAC on an OAuth callback query string.
 */
export async function verifyOAuthCallback(input: {
  query: Record<string, string>;
  secret: string;
}): Promise<boolean> {
  const { hmac, signature, ...rest } = input.query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("&");

  const crypto = await import("node:crypto");
  const digest = crypto.createHmac("sha256", input.secret).update(message).digest("hex");

  const a = Buffer.from(digest);
  const b = Buffer.from(hmac);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
