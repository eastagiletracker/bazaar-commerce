/**
 * Store API client for the Bazaar customer app.
 *
 * Talks to the same Medusa/Mercur Store API the web storefront uses, so there
 * is no mobile-specific backend to keep in sync.
 *
 * On a physical device localhost is the phone, not the Mac, so the host has to
 * be the machine's LAN address. Set EXPO_PUBLIC_API_URL in .env to override.
 */

import Constants from "expo-constants";

function defaultBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured;

  // Derive the dev machine's LAN IP from the Expo host so a device on the same
  // Wi-Fi reaches the API without hand-editing a config file.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = hostUri?.split(":")[0];
  return host ? `http://${host}:3101` : "http://localhost:3101";
}

export const BASE_URL = defaultBaseUrl();

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "";

let authToken: string | null = null;
export const setAuthToken = (token: string | null) => {
  authToken = token;
};
export const getAuthToken = () => authToken;

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
      "x-publishable-api-key": PUBLISHABLE_KEY,
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
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

// ----------------------------------------------------------------- domain

export type Offer = {
  id: string;
  sku: string;
  seller_id: string;
  seller?: { id: string; name: string; handle: string };
  product?: { id: string; title: string; handle: string; thumbnail?: string | null };
  product_variant?: { id: string; title: string; sku: string };
  calculated_price?: {
    calculated_amount: number;
    original_amount?: number;
    currency_code: string;
  };
  /** Flattened from product.thumbnail so the card does not have to dig. */
  thumbnail?: string | null;
};

export type Region = { id: string; name: string; currency_code: string };

export const formatPkr = (amount: number | string | undefined) =>
  amount === undefined || amount === null
    ? ""
    : `Rs ${Number(amount).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

export async function getPakistanRegion(): Promise<Region> {
  const { regions } = await api<{ regions: Region[] }>("/store/regions");
  const region = regions.find((r) => r.currency_code === "pkr") ?? regions[0];
  if (!region) throw new Error("No region configured on the backend");
  return region;
}

/**
 * Offers come back with prices but no product imagery, and asking for `fields`
 * to get the image SILENTLY DROPS calculated_price — the price is decorated
 * onto the default selection only, so any explicit field list loses it. None of
 * `calculated_price`, `*calculated_price`, `+calculated_price` or
 * `calculated_price.calculated_amount` bring it back.
 *
 * So: take the default offer payload for prices, then fetch the products by id
 * for their thumbnails and merge. Two requests, both cacheable, and no chance
 * of a listing rendering at Rs 0.
 */
export async function listOffers(regionId: string, limit = 40): Promise<Offer[]> {
  const { offers } = await api<{ offers: Offer[] }>(
    `/store/offers?limit=${limit}&region_id=${regionId}`
  );

  const priced = offers.filter(
    (o) => (o.calculated_price?.calculated_amount ?? 0) > 0
  );

  const productIds = [...new Set(priced.map((o) => (o as any).product_id).filter(Boolean))];
  if (!productIds.length) return priced;

  const query = productIds.map((id) => `id=${encodeURIComponent(id)}`).join("&");
  const { products } = await api<{
    products: { id: string; title: string; handle: string; thumbnail?: string | null }[];
  }>(`/store/products?limit=${productIds.length}&${query}`).catch(() => ({ products: [] }));

  const byId = new Map(products.map((p) => [p.id, p]));

  return priced.map((o) => {
    const product = byId.get((o as any).product_id);
    return {
      ...o,
      product,
      thumbnail: product?.thumbnail ?? null,
    };
  });
}

/**
 * Cart lines reference an OFFER, not a variant: on a marketplace you buy a
 * specific seller's listing, and that is what carries seller_id through to
 * commission and settlement.
 */
export async function createCart(regionId: string, email: string) {
  const { cart } = await api<{ cart: any }>("/store/carts", {
    method: "POST",
    body: { region_id: regionId, email },
  });
  return cart;
}

export async function addOfferToCart(cartId: string, offerId: string, quantity = 1) {
  const { cart } = await api<{ cart: any }>(`/store/carts/${cartId}/line-items`, {
    method: "POST",
    body: { offer_id: offerId, quantity },
  });
  return cart;
}

export async function setCartAddress(cartId: string, address: Record<string, string>) {
  const { cart } = await api<{ cart: any }>(`/store/carts/${cartId}`, {
    method: "POST",
    body: { shipping_address: address, billing_address: address },
  });
  return cart;
}

/**
 * Shipping options come back keyed by seller, because a multi-vendor cart needs
 * a shipping method per seller or it will not complete.
 */
export async function addShippingMethods(cartId: string) {
  const { shipping_options } = await api<{ shipping_options: Record<string, any[]> }>(
    `/store/shipping-options?cart_id=${cartId}`
  );
  let cart: any = null;
  for (const sellerId of Object.keys(shipping_options ?? {})) {
    const option = shipping_options[sellerId][0];
    if (!option) continue;
    ({ cart } = await api<{ cart: any }>(`/store/carts/${cartId}/shipping-methods`, {
      method: "POST",
      body: { option_id: option.id },
    }));
  }
  if (!cart) throw new Error("No delivery option is available for this address");
  return cart;
}

export async function completeCart(cartId: string, regionId: string) {
  const { payment_providers } = await api<{ payment_providers: { id: string }[] }>(
    `/store/payment-providers?region_id=${regionId}`
  );
  const { payment_collection } = await api<{ payment_collection: any }>(
    "/store/payment-collections",
    { method: "POST", body: { cart_id: cartId } }
  );
  await api(`/store/payment-collections/${payment_collection.id}/payment-sessions`, {
    method: "POST",
    body: { provider_id: payment_providers[0].id },
  });
  return await api<any>(`/store/carts/${cartId}/complete`, { method: "POST" });
}

export async function login(email: string, password: string): Promise<string> {
  const { token } = await api<{ token: string }>("/auth/customer/emailpass", {
    method: "POST",
    body: { email, password },
  });
  return token;
}

export async function register(email: string, password: string): Promise<string> {
  await api("/auth/customer/emailpass/register", {
    method: "POST",
    body: { email, password },
  }).catch(() => null);

  // The register token cannot act as the customer; log in for a scoped one.
  const registerToken = await api<{ token: string }>("/auth/customer/emailpass/register", {
    method: "POST",
    body: { email, password },
  })
    .then((r) => r.token)
    .catch(() => null);

  if (registerToken) {
    setAuthToken(registerToken);
    await api("/store/customers", {
      method: "POST",
      body: { email },
    }).catch(() => null);
  }
  return await login(email, password);
}
