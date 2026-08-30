/**
 * Vendor API client for the Bazaar seller app.
 *
 * Uses Mercur's /vendor API surface with a seller-scoped JWT, the same one the
 * web vendor panel uses.
 */

import Constants from "expo-constants";

function defaultBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured;
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = hostUri?.split(":")[0];
  return host ? `http://${host}:3101` : "http://localhost:3101";
}

export const BASE_URL = defaultBaseUrl();

let authToken: string | null = null;
export const setAuthToken = (t: string | null) => {
  authToken = t;
};

/**
 * Every /vendor route requires an x-seller-id header, because a member can
 * belong to more than one shop. Without it the API returns 400, not 401, which
 * is easy to misread as an auth problem.
 */
let sellerId: string | null = null;
export const setSellerId = (id: string | null) => {
  sellerId = id;
};
export const getSellerId = () => sellerId;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(sellerId ? { "x-seller-id": sellerId } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`Unexpected response from ${path}`, res.status);
  }
  if (!res.ok) {
    throw new ApiError(json?.message ?? `Request failed (${res.status})`, res.status);
  }
  return json as T;
}

export const formatPkr = (amount: number | string | undefined | null) =>
  amount === undefined || amount === null
    ? "Rs 0"
    : `Rs ${Number(amount).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

export type SellerSummary = { id: string; name: string; handle?: string };

/**
 * Sellers authenticate as the `member` actor, not `user` or `seller`. The other
 * two return a 200 with an EMPTY actor_id, and every /vendor call then 401s —
 * a token that looks valid but is bound to nobody.
 */
export async function login(email: string, password: string): Promise<string> {
  const { token } = await api<{ token: string }>("/auth/member/emailpass", {
    method: "POST",
    body: { email, password },
  });
  return token;
}

/** The shops this member can act for. */
export async function listMySellers(): Promise<SellerSummary[]> {
  const { seller_members } = await api<{
    seller_members: { seller: SellerSummary }[];
  }>("/vendor/sellers");
  return (seller_members ?? []).map((m) => m.seller).filter(Boolean);
}

export type VendorOrder = {
  id: string;
  display_id?: number;
  status?: string;
  fulfillment_status?: string;
  payment_status?: string;
  total?: number;
  currency_code?: string;
  created_at?: string;
  items?: { id: string; title: string; quantity: number }[];
};

/**
 * `fields` is not optional here. Without it the list endpoint returns every
 * order with `total: null`, and the app cheerfully renders "Rs 0" for real
 * money. Asking for the money fields explicitly is what hydrates them.
 */
const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
  "fulfillment_status",
  "payment_status",
  "currency_code",
  "created_at",
  "total",
  "item_total",
  "shipping_total",
  "tax_total",
  "items.id",
  "items.title",
  "items.quantity",
].join(",");

export async function listOrders(limit = 30): Promise<VendorOrder[]> {
  const { orders } = await api<{ orders: VendorOrder[] }>(
    `/vendor/orders?limit=${limit}&fields=${ORDER_FIELDS}`
  );
  return orders ?? [];
}

export type VendorPayout = {
  id: string;
  amount?: number;
  currency_code?: string;
  status?: string;
  created_at?: string;
};

export async function listPayouts(limit = 30): Promise<VendorPayout[]> {
  const { payouts } = await api<{ payouts: VendorPayout[] }>(
    `/vendor/payouts?limit=${limit}&fields=id,amount,currency_code,status,created_at`
  );
  return payouts ?? [];
}

export async function getPayoutAccount(): Promise<any | null> {
  try {
    const res = await api<any>("/vendor/payout-accounts");
    return res?.payout_accounts?.[0] ?? res?.payout_account ?? null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function getSeller(): Promise<any | null> {
  try {
    const { seller } = await api<{ seller: any }>("/vendor/sellers/me");
    return seller;
  } catch {
    return null;
  }
}
