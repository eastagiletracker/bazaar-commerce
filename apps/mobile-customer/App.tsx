import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import {
  addOfferToCart,
  addShippingMethods,
  completeCart,
  createCart,
  getPakistanRegion,
  listOffers,
  setCartAddress,
  type Offer,
  type Region,
} from "./src/api";
import {
  Badge,
  Button,
  CardSkeleton,
  EmptyState,
  ProductCard,
  SectionHeader,
  TrustRow,
} from "./src/components";
import { color, formatPkr, radius, shadow, space, TAP_MIN, type } from "./src/theme";

/**
 * Bazaar — customer app.
 *
 * Layout follows the conventions Pakistani shoppers already know from Daraz and
 * AliExpress (bottom tab bar, 2-up product grid, sticky buy bar), because
 * fighting a learned navigation pattern costs conversions and wins nothing.
 * The DIFFERENCES are deliberate and all point the same way — toward trust,
 * which is the incumbents' weak spot rather than price:
 *
 *  - no countdown timers or invented scarcity
 *  - the seller is named on every card and again on the product page
 *  - delivery cost and payment method are stated before checkout, not after
 *  - one primary action per screen
 *  - skeletons rather than spinners, because most of this market is on a slow
 *    connection and a spinner communicates nothing
 *
 * Navigation is a small state machine rather than react-navigation: it keeps
 * the dependency surface tiny, which matters for app size on cheap Android.
 * Swap it for a router when deep links and push notifications arrive.
 */

type Tab = "home" | "categories" | "cart" | "account";
type Route =
  | { name: "tabs" }
  | { name: "product"; offer: Offer }
  | { name: "checkout" }
  | { name: "success"; reference: string };

type CartLine = { offer: Offer; quantity: number };

const CATEGORIES = [
  { icon: "📱", label: "Mobiles" },
  { icon: "💻", label: "Computers" },
  { icon: "👗", label: "Fashion" },
  { icon: "💄", label: "Beauty" },
  { icon: "🏠", label: "Home" },
  { icon: "🛒", label: "Grocery" },
  { icon: "🧸", label: "Baby & Toys" },
  { icon: "⚽", label: "Sports" },
];

export default function App() {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>("home");
  const [route, setRoute] = useState<Route>({ name: "tabs" });

  const [region, setRegion] = useState<Region | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const [address, setAddress] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    address_1: "",
    city: "Karachi",
    province: "Sindh",
    postal_code: "",
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await getPakistanRegion();
      setRegion(r);
      setOffers(await listOffers(r.id, 40));
    } catch (e: any) {
      setError(e?.message ?? "Could not reach Bazaar");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cartCount = lines.reduce((n, l) => n + l.quantity, 0);
  const subtotal = lines.reduce(
    (sum, l) => sum + Number(l.offer.calculated_price?.calculated_amount ?? 0) * l.quantity,
    0
  );

  // Multi-vendor carts split per seller, and delivery is charged per seller.
  // Showing that here rather than at checkout avoids the nasty surprise that
  // makes people abandon on Daraz.
  const sellerGroups = useMemo(() => {
    const map = new Map<string, { name: string; lines: CartLine[] }>();
    for (const line of lines) {
      const id = line.offer.seller_id;
      const entry = map.get(id) ?? { name: line.offer.seller?.name ?? "Seller", lines: [] };
      entry.lines.push(line);
      map.set(id, entry);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [lines]);

  const DELIVERY_PER_SELLER = 250;
  const delivery = sellerGroups.length * DELIVERY_PER_SELLER;
  const total = subtotal + delivery;

  const visibleOffers = useMemo(() => {
    if (!query.trim()) return offers;
    const q = query.toLowerCase();
    return offers.filter(
      (o) =>
        (o.product?.title ?? "").toLowerCase().includes(q) ||
        (o.seller?.name ?? "").toLowerCase().includes(q)
    );
  }, [offers, query]);

  const addToCart = (offer: Offer, qty = 1) =>
    setLines((prev) => {
      const found = prev.find((l) => l.offer.id === offer.id);
      return found
        ? prev.map((l) => (l.offer.id === offer.id ? { ...l, quantity: l.quantity + qty } : l))
        : [...prev, { offer, quantity: qty }];
    });

  const changeQty = (offerId: string, delta: number) =>
    setLines((prev) =>
      prev
        .map((l) => (l.offer.id === offerId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );

  const placeOrder = async () => {
    if (!region) return;
    setPlacing(true);
    setError(null);
    try {
      const email = `${address.phone.replace(/\D/g, "") || "guest"}@bazaar.pk`;
      const cart = await createCart(region.id, email);
      for (const line of lines) {
        await addOfferToCart(cart.id, line.offer.id, line.quantity);
      }
      await setCartAddress(cart.id, { ...address, country_code: "pk" });
      await addShippingMethods(cart.id);
      const done = await completeCart(cart.id, region.id);
      const reference =
        done?.order_group?.display_id ?? done?.order_group?.id ?? done?.order?.id ?? "confirmed";
      setLines([]);
      setRoute({ name: "success", reference: String(reference) });
    } catch (e: any) {
      setError(e?.message ?? "Could not place the order");
    } finally {
      setPlacing(false);
    }
  };

  const gap = space.md;
  const cardWidth = (width - space.lg * 2 - gap) / 2;

  /* ------------------------------------------------------------- product */

  if (route.name === "product") {
    const offer = route.offer;
    const price = Number(offer.calculated_price?.calculated_amount ?? 0);
    const inCart = lines.find((l) => l.offer.id === offer.id)?.quantity ?? 0;

    return (
      <SafeAreaView style={s.screen}>
        <StatusBar barStyle="dark-content" />
        <TopBar title="" onBack={() => setRoute({ name: "tabs" })} />

        <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={s.gallery}>
            {offer.thumbnail ? (
              <Image source={{ uri: offer.thumbnail }} style={s.galleryImage} resizeMode="contain" />
            ) : (
              <Text style={{ fontSize: 64 }}>📦</Text>
            )}
          </View>

          <View style={s.pdpBlock}>
            <Text style={[type.priceLarge, { color: color.text }]}>{formatPkr(price)}</Text>
            <Text style={[type.h2, { color: color.text, marginTop: space.xs }]}>
              {offer.product?.title ?? offer.sku}
            </Text>
            {offer.product_variant?.title && (
              <Text style={[type.small, { color: color.textMuted }]}>
                {offer.product_variant.title}
              </Text>
            )}
          </View>

          {/* Seller card. On a marketplace this is the single most important
              block on the page and the incumbents bury it. */}
          <View style={s.sellerCard}>
            <View style={s.sellerAvatar}>
              <Text style={{ fontSize: 18 }}>🏪</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: color.text }]}>
                {offer.seller?.name ?? "Seller"}
              </Text>
              <Text style={[type.small, { color: color.textMuted }]}>Verified seller</Text>
            </View>
            <Badge tone="success">✓ Verified</Badge>
          </View>

          {/* Total cost stated up front. The delivery fee appearing only at
              checkout is the classic marketplace bait-and-switch. */}
          <View style={s.factsCard}>
            <Fact label="Delivery" value={`${formatPkr(DELIVERY_PER_SELLER)} · 2-4 days`} />
            <Fact label="Payment" value="Cash on delivery" />
            <Fact label="Returns" value="7 days from delivery" />
            <View style={s.factDivider} />
            <Fact
              label="Total to pay"
              value={formatPkr(price + DELIVERY_PER_SELLER)}
              strong
            />
          </View>

          <View style={{ marginTop: space.xl }}>
            <TrustRow />
          </View>
        </ScrollView>

        {/* Sticky buy bar: thumb-reachable, one primary action. */}
        <View style={s.buyBar}>
          <View style={{ flex: 1 }}>
            <Text style={[type.tiny, { color: color.textMuted }]}>
              {inCart > 0 ? `${inCart} in basket` : "Total"}
            </Text>
            <Text style={[type.price, { color: color.text }]}>{formatPkr(price)}</Text>
          </View>
          <Button
            label={inCart > 0 ? "Add another" : "Add to basket"}
            onPress={() => addToCart(offer)}
            style={{ flex: 1.4 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------ checkout */

  if (route.name === "checkout") {
    const ready =
      address.first_name.trim() && address.phone.trim() && address.address_1.trim();

    return (
      <SafeAreaView style={s.screen}>
        <StatusBar barStyle="dark-content" />
        <TopBar title="Checkout" onBack={() => setRoute({ name: "tabs" })} />

        {error && <ErrorBar message={error} />}

        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.lg }}>
          <View style={s.panel}>
            <Text style={[type.h3, { color: color.text, marginBottom: space.md }]}>
              Delivery address
            </Text>
            {(
              [
                ["first_name", "Full name", "words"],
                ["phone", "Mobile number", "none"],
                ["address_1", "Street address", "words"],
                ["city", "City", "words"],
                ["province", "Province", "words"],
              ] as const
            ).map(([key, label, cap]) => (
              <View key={key} style={{ marginBottom: space.md }}>
                <Text style={[type.small, s.label]}>{label}</Text>
                <TextInput
                  style={s.input}
                  value={(address as any)[key]}
                  onChangeText={(v) => setAddress((a) => ({ ...a, [key]: v }))}
                  keyboardType={key === "phone" ? "phone-pad" : "default"}
                  autoCapitalize={cap as any}
                  placeholder={key === "phone" ? "03xx xxxxxxx" : undefined}
                  placeholderTextColor={color.textMuted}
                />
              </View>
            ))}
          </View>

          <View style={s.panel}>
            <Text style={[type.h3, { color: color.text, marginBottom: space.md }]}>Payment</Text>
            {/* COD is the default because it is ~95% of this market. Presenting
                card first would be designing for a customer who is not here. */}
            <View style={s.paymentSelected}>
              <View style={s.radioOn}>
                <View style={s.radioDot} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, { color: color.text }]}>Cash on delivery</Text>
                <Text style={[type.small, { color: color.textMuted }]}>
                  Pay the rider when your order arrives
                </Text>
              </View>
            </View>
            <Text style={[type.small, { color: color.textMuted, marginTop: space.md }]}>
              Card and wallet payment arrive once our payment partner is live.
            </Text>
          </View>

          <View style={s.panel}>
            <Text style={[type.h3, { color: color.text, marginBottom: space.md }]}>Summary</Text>
            <SummaryRow label={`Items (${cartCount})`} value={formatPkr(subtotal)} />
            <SummaryRow
              label={`Delivery · ${sellerGroups.length} seller${sellerGroups.length === 1 ? "" : "s"}`}
              value={formatPkr(delivery)}
            />
            <View style={s.factDivider} />
            <SummaryRow label="Total" value={formatPkr(total)} strong />
          </View>
        </ScrollView>

        <View style={s.buyBar}>
          <View style={{ flex: 1 }}>
            <Text style={[type.tiny, { color: color.textMuted }]}>Pay on delivery</Text>
            <Text style={[type.price, { color: color.text }]}>{formatPkr(total)}</Text>
          </View>
          <Button
            label={placing ? "Placing…" : "Place order"}
            onPress={placeOrder}
            disabled={!ready}
            loading={placing}
            style={{ flex: 1.4 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------- success */

  if (route.name === "success") {
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar barStyle="dark-content" />
        <View style={s.successWrap}>
          <View style={s.successTick}>
            <Text style={{ fontSize: 40 }}>✓</Text>
          </View>
          <Text style={[type.h1, { color: color.text }]}>Order placed</Text>
          <Text style={[type.body, { color: color.textMuted, textAlign: "center" }]}>
            Order #{route.reference}. You will pay cash when the rider delivers.
          </Text>
          <View style={s.successFacts}>
            <Fact label="Arrives" value="2-4 working days" />
            <Fact label="Pay" value="Cash on delivery" />
          </View>
          <Button
            label="Keep shopping"
            onPress={() => {
              setTab("home");
              setRoute({ name: "tabs" });
            }}
            fullWidth
          />
        </View>
      </SafeAreaView>
    );
  }

  /* ---------------------------------------------------------------- tabs */

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" />

      {tab === "home" && (
        <>
          <View style={s.header}>
            <Text style={s.brand}>Bazaar</Text>
            <View style={s.searchWrap}>
              <Text style={{ fontSize: 15, color: color.textMuted }}>🔍</Text>
              <TextInput
                style={s.search}
                placeholder="Search for anything"
                placeholderTextColor={color.textMuted}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery("")} hitSlop={10}>
                  <Text style={{ color: color.textMuted, fontSize: 16 }}>✕</Text>
                </Pressable>
              )}
            </View>
          </View>

          {error && <ErrorBar message={error} />}

          <FlatList
            data={loading ? [] : visibleOffers}
            keyExtractor={(o) => o.id}
            numColumns={2}
            columnWrapperStyle={{ gap, paddingHorizontal: space.lg }}
            contentContainerStyle={{ paddingBottom: space["3xl"], gap }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load();
                }}
                tintColor={color.link}
              />
            }
            ListHeaderComponent={
              <View>
                {/* Category grid rather than a carousel: everything is
                    reachable in one glance, no horizontal hunting. */}
                <View style={s.catGrid}>
                  {CATEGORIES.map((c) => (
                    <Pressable key={c.label} style={s.catItem} onPress={() => setTab("categories")}>
                      <View style={s.catIcon}>
                        <Text style={{ fontSize: 22 }}>{c.icon}</Text>
                      </View>
                      <Text numberOfLines={1} style={[type.tiny, s.catLabel]}>
                        {c.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <TrustRow />

                <SectionHeader
                  title={query ? `Results for "${query}"` : "Popular right now"}
                />
                {loading && (
                  <View style={{ flexDirection: "row", gap, paddingHorizontal: space.lg }}>
                    <CardSkeleton width={cardWidth} />
                    <CardSkeleton width={cardWidth} />
                  </View>
                )}
              </View>
            }
            ListEmptyComponent={
              loading ? null : (
                <EmptyState
                  icon="🔍"
                  title={query ? "Nothing matched" : "No listings yet"}
                  body={
                    query
                      ? "Try a different search."
                      : "Seed the marketplace to see products here."
                  }
                />
              )
            }
            renderItem={({ item }) => (
              <ProductCard
                offer={item}
                width={cardWidth}
                onPress={() => setRoute({ name: "product", offer: item })}
              />
            )}
          />
        </>
      )}

      {tab === "categories" && (
        <>
          <View style={s.header}>
            <Text style={[type.h1, { color: color.text }]}>Categories</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c.label}
                style={s.catRow}
                onPress={() => {
                  setQuery("");
                  setTab("home");
                }}
              >
                <View style={s.catIcon}>
                  <Text style={{ fontSize: 20 }}>{c.icon}</Text>
                </View>
                <Text style={[type.bodyStrong, { color: color.text, flex: 1 }]}>{c.label}</Text>
                <Text style={{ color: color.textMuted, fontSize: 18 }}>›</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {tab === "cart" && (
        <>
          <View style={s.header}>
            <Text style={[type.h1, { color: color.text }]}>Basket</Text>
          </View>

          {lines.length === 0 ? (
            <EmptyState
              icon="🛍️"
              title="Your basket is empty"
              body="Browse and add something you like."
              action="Start shopping"
              onAction={() => setTab("home")}
            />
          ) : (
            <>
              <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 140 }}>
                {/* Grouped by seller, because that is how the order will
                    actually ship and be paid out. Hiding it would make the
                    per-seller delivery fee look arbitrary. */}
                {sellerGroups.map((group) => (
                  <View key={group.id} style={s.panel}>
                    <View style={s.groupHead}>
                      <Text style={{ fontSize: 14 }}>🏪</Text>
                      <Text style={[type.bodyStrong, { color: color.text, flex: 1 }]}>
                        {group.name}
                      </Text>
                      <Badge tone="neutral">{formatPkr(DELIVERY_PER_SELLER)} delivery</Badge>
                    </View>

                    {group.lines.map((line) => (
                      <View key={line.offer.id} style={s.cartLine}>
                        <View style={s.cartThumb}>
                          {line.offer.thumbnail ? (
                            <Image
                              source={{ uri: line.offer.thumbnail }}
                              style={{ width: "100%", height: "100%" }}
                              resizeMode="contain"
                            />
                          ) : (
                            <Text style={{ fontSize: 20 }}>📦</Text>
                          )}
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text numberOfLines={2} style={[type.body, { color: color.text }]}>
                            {line.offer.product?.title ?? line.offer.sku}
                          </Text>
                          <Text style={[type.price, { color: color.text }]}>
                            {formatPkr(
                              Number(line.offer.calculated_price?.calculated_amount ?? 0) *
                                line.quantity
                            )}
                          </Text>
                          <View style={s.stepper}>
                            <Pressable
                              style={s.stepBtn}
                              onPress={() => changeQty(line.offer.id, -1)}
                              hitSlop={8}
                            >
                              <Text style={s.stepText}>−</Text>
                            </Pressable>
                            <Text style={[type.bodyStrong, s.stepQty]}>{line.quantity}</Text>
                            <Pressable
                              style={s.stepBtn}
                              onPress={() => changeQty(line.offer.id, 1)}
                              hitSlop={8}
                            >
                              <Text style={s.stepText}>+</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}

                <View style={s.panel}>
                  <SummaryRow label={`Items (${cartCount})`} value={formatPkr(subtotal)} />
                  <SummaryRow label="Delivery" value={formatPkr(delivery)} />
                  <View style={s.factDivider} />
                  <SummaryRow label="Total" value={formatPkr(total)} strong />
                </View>
              </ScrollView>

              <View style={s.buyBar}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.tiny, { color: color.textMuted }]}>Total</Text>
                  <Text style={[type.price, { color: color.text }]}>{formatPkr(total)}</Text>
                </View>
                <Button
                  label="Checkout"
                  onPress={() => setRoute({ name: "checkout" })}
                  style={{ flex: 1.4 }}
                />
              </View>
            </>
          )}
        </>
      )}

      {tab === "account" && (
        <>
          <View style={s.header}>
            <Text style={[type.h1, { color: color.text }]}>Account</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
            {[
              { icon: "📦", label: "My orders" },
              { icon: "📍", label: "Addresses" },
              { icon: "↩️", label: "Returns" },
              { icon: "🏪", label: "Sell on Bazaar" },
              { icon: "💬", label: "Help & support" },
            ].map((item) => (
              <Pressable key={item.label} style={s.catRow}>
                <View style={s.catIcon}>
                  <Text style={{ fontSize: 18 }}>{item.icon}</Text>
                </View>
                <Text style={[type.bodyStrong, { color: color.text, flex: 1 }]}>{item.label}</Text>
                <Text style={{ color: color.textMuted, fontSize: 18 }}>›</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {/* Bottom tabs: the pattern every shopper in this market already knows. */}
      <View style={s.tabBar}>
        {(
          [
            ["home", "Home", "🏠"],
            ["categories", "Categories", "☰"],
            ["cart", "Basket", "🛍️"],
            ["account", "Account", "👤"],
          ] as const
        ).map(([key, label, icon]) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              style={s.tabItem}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View>
                <Text style={{ fontSize: 20, opacity: active ? 1 : 0.55 }}>{icon}</Text>
                {key === "cart" && cartCount > 0 && (
                  <View style={s.tabBadge}>
                    <Text style={s.tabBadgeText}>{cartCount}</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  type.tiny,
                  { color: active ? color.link : color.textMuted },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

/* --------------------------------------------------------------- helpers */

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={s.topBar}>
      <Pressable onPress={onBack} hitSlop={12} style={s.backBtn} accessibilityLabel="Go back">
        <Text style={{ fontSize: 22, color: color.text }}>‹</Text>
      </Pressable>
      <Text style={[type.h3, { color: color.text }]}>{title}</Text>
      <View style={{ width: TAP_MIN }} />
    </View>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.factRow}>
      <Text style={[type.body, { color: color.textMuted }]}>{label}</Text>
      <Text style={[strong ? type.price : type.bodyStrong, { color: color.text }]}>{value}</Text>
    </View>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.factRow}>
      <Text style={[strong ? type.bodyStrong : type.body, { color: strong ? color.text : color.textMuted }]}>
        {label}
      </Text>
      <Text style={[strong ? type.price : type.bodyStrong, { color: color.text }]}>{value}</Text>
    </View>
  );
}

function ErrorBar({ message }: { message: string }) {
  return (
    <View style={s.errorBar}>
      <Text style={[type.small, { color: color.danger }]}>{message}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- styles */

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },

  // Navy chrome, matching the web header. A shopper moving between the site
  // and the app should not feel they have changed product.
  header: {
    backgroundColor: color.chrome,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.md,
  },
  brand: { fontSize: 24, fontWeight: "800", color: color.onChrome, letterSpacing: -0.7 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    height: TAP_MIN,
  },
  search: { flex: 1, fontSize: 15, color: color.text },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: color.surface,
    paddingHorizontal: space.sm,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  backBtn: {
    width: TAP_MIN,
    height: TAP_MIN,
    alignItems: "center",
    justifyContent: "center",
  },

  catGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  catItem: { width: "25%", alignItems: "center", gap: 6, paddingVertical: space.sm },
  catIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.xl,
    backgroundColor: color.linkTint,
    alignItems: "center",
    justifyContent: "center",
  },
  catLabel: { color: color.text, fontWeight: "500" },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: space.md,
    minHeight: TAP_MIN + 16,
    borderWidth: 1,
    borderColor: color.border,
  },

  gallery: {
    aspectRatio: 1,
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  galleryImage: { width: "100%", height: "100%" },
  pdpBlock: {
    backgroundColor: color.surface,
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  sellerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: color.surface,
    marginTop: space.md,
    padding: space.lg,
  },
  sellerAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: color.linkTint,
    alignItems: "center",
    justifyContent: "center",
  },
  factsCard: { backgroundColor: color.surface, marginTop: space.md, padding: space.lg },
  factRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  factDivider: { height: 1, backgroundColor: color.border, marginVertical: space.sm },

  buyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: color.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xl,
    borderTopWidth: 1,
    borderTopColor: color.border,
    ...shadow.bar,
  },

  panel: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: color.border,
  },
  label: { color: color.textMuted, marginBottom: 6, fontWeight: "500" },
  input: {
    height: TAP_MIN,
    borderWidth: 1,
    // stone-400: the lightest border that stays visible outdoors.
    borderColor: color.borderControl,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 15,
    color: color.text,
    backgroundColor: color.surface,
  },
  paymentSelected: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderWidth: 1.5,
    borderColor: color.success,
    backgroundColor: color.successTint,
    borderRadius: radius.md,
    padding: space.md,
  },
  radioOn: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: color.success,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: color.success,
  },

  groupHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingBottom: space.md,
    marginBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  cartLine: { flexDirection: "row", gap: space.md, paddingVertical: space.sm },
  cartThumb: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 4 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderControl,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 17, fontWeight: "700", color: color.text },
  stepQty: { minWidth: 22, textAlign: "center", color: color.text },

  tabBar: {
    flexDirection: "row",
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingBottom: space.sm,
    paddingTop: space.sm,
  },
  tabItem: { flex: 1, alignItems: "center", gap: 3, minHeight: TAP_MIN },
  tabBadge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 17,
    height: 17,
    borderRadius: radius.full,
    backgroundColor: color.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  // Dark ink on the yellow pill. White would be 1.46:1.
  tabBadgeText: { color: color.onPrimary, fontSize: 10, fontWeight: "800" },

  errorBar: {
    backgroundColor: color.dangerTint,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },

  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    padding: space["3xl"],
  },
  successTick: {
    width: 84,
    height: 84,
    borderRadius: radius.full,
    backgroundColor: color.successTint,
    alignItems: "center",
    justifyContent: "center",
  },
  successFacts: {
    alignSelf: "stretch",
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: color.border,
    marginVertical: space.md,
  },
});
