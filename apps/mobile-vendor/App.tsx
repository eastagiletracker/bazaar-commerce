import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { color } from "./src/theme";
import {
  formatPkr,
  getPayoutAccount,
  getSeller,
  listMySellers,
  listOrders,
  listPayouts,
  login,
  setAuthToken,
  setSellerId,
  type SellerSummary,
  type VendorOrder,
  type VendorPayout,
} from "./src/api";

/**
 * Bazaar seller app.
 *
 * What a Pakistani seller actually needs on a phone: today's orders, and an
 * honest answer to "when do I get my money". The payouts tab is deliberately
 * explicit that COD cash sits with the courier until it is remitted, because
 * that gap is the single biggest source of seller mistrust on a COD
 * marketplace.
 */

type Tab = "orders" | "payouts" | "account";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [shops, setShops] = useState<SellerSummary[]>([]);

  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [payouts, setPayouts] = useState<VendorPayout[]>([]);
  const [payoutAccount, setPayoutAccount] = useState<any | null>(null);
  const [seller, setSeller] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, p, acc, s] = await Promise.all([
        listOrders().catch(() => []),
        listPayouts().catch(() => []),
        getPayoutAccount().catch(() => null),
        getSeller().catch(() => null),
      ]);
      setOrders(o);
      setPayouts(p);
      setPayoutAccount(acc);
      setSeller(s);
    } catch (e: any) {
      setError(e.message ?? "Could not load your account");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      setLoading(true);
      load();
    }
  }, [token, load]);

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const t = await login(email.trim(), password);
      setAuthToken(t);

      // A member can hold more than one shop, and every /vendor route needs an
      // x-seller-id. Pick the only one automatically; otherwise ask.
      const mine = await listMySellers();
      if (!mine.length) {
        setAuthToken(null);
        setError("This account is not a member of any shop yet.");
        return;
      }
      setShops(mine);
      setSellerId(mine[0].id);
      setToken(t);
    } catch (e: any) {
      setError(e.message ?? "Sign in failed");
    } finally {
      setSigningIn(false);
    }
  };

  const switchShop = (id: string) => {
    setSellerId(id);
    setLoading(true);
    load();
  };

  const signOut = () => {
    setAuthToken(null);
    setSellerId(null);
    setToken(null);
    setShops([]);
    setOrders([]);
    setPayouts([]);
  };

  // -------------------------------------------------------------- sign in

  if (!token) {
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={s.authWrap}>
          <Text style={s.brand}>Bazaar</Text>
          <Text style={s.brandSub}>Seller</Text>

          {error && <Text style={s.errorText}>{error}</Text>}

          <View style={s.field}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@yourshop.pk"
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Password</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <Pressable
            style={[s.primary, (!email || !password || signingIn) && s.disabled]}
            disabled={!email || !password || signingIn}
            onPress={signIn}
          >
            <Text style={s.primaryText}>{signingIn ? "Signing in…" : "Sign in"}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------- signed in

  const pendingOrders = orders.filter(
    (o) => o.fulfillment_status !== "fulfilled" && o.fulfillment_status !== "delivered"
  ).length;

  const paidOut = payouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  const inFlight = payouts
    .filter((p) => p.status === "processing" || p.status === "pending")
    .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <View>
          <Text style={s.brand}>Bazaar</Text>
          <Text style={s.brandSub}>{seller?.name ?? "Seller"}</Text>
        </View>
        <Pressable onPress={signOut}>
          <Text style={s.link}>Sign out</Text>
        </Pressable>
      </View>

      <View style={s.tabs}>
        {(["orders", "payouts", "account"] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t[0].toUpperCase() + t.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && (
        <View style={s.errorBar}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={color.link} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
        >
          {tab === "orders" && (
            <>
              <View style={s.statRow}>
                <Stat label="Orders" value={String(orders.length)} />
                <Stat label="To fulfil" value={String(pendingOrders)} accent />
              </View>
              {orders.length === 0 && <Text style={s.muted}>No orders yet.</Text>}
              {orders.map((o) => (
                <View key={o.id} style={s.card}>
                  <View style={s.cardHead}>
                    <Text style={s.cardTitle}>#{o.display_id ?? o.id.slice(-6)}</Text>
                    <Text style={s.cardAmount}>{formatPkr(o.total)}</Text>
                  </View>
                  <Text style={s.muted}>
                    {(o.items ?? [])
                      .map((i) => `${i.quantity} × ${i.title}`)
                      .join(", ") || "Order"}
                  </Text>
                  <View style={s.badges}>
                    <Badge text={o.fulfillment_status ?? "not fulfilled"} />
                    <Badge text={o.payment_status ?? "unpaid"} />
                  </View>
                </View>
              ))}
            </>
          )}

          {tab === "payouts" && (
            <>
              <View style={s.statRow}>
                <Stat label="Paid out" value={formatPkr(paidOut)} />
                <Stat label="On the way" value={formatPkr(inFlight)} accent />
              </View>

              <View style={s.noteBox}>
                <Text style={s.noteTitle}>How cash on delivery pays out</Text>
                <Text style={s.muted}>
                  The courier collects cash from the buyer and holds it until their remittance
                  reaches us. Your payout is released after that, minus commission and tax. An
                  order marked delivered is not payable until the courier has actually remitted.
                </Text>
              </View>

              {payouts.length === 0 && <Text style={s.muted}>No payouts yet.</Text>}
              {payouts.map((p) => (
                <View key={p.id} style={s.card}>
                  <View style={s.cardHead}>
                    <Text style={s.cardTitle}>{formatPkr(p.amount)}</Text>
                    <Badge text={p.status ?? "pending"} />
                  </View>
                  {p.created_at && (
                    <Text style={s.muted}>
                      {new Date(p.created_at).toLocaleDateString("en-PK")}
                    </Text>
                  )}
                </View>
              ))}
            </>
          )}

          {tab === "account" && (
            <>
              <View style={s.card}>
                <Text style={s.cardTitle}>Payout account</Text>
                {payoutAccount ? (
                  <>
                    <Text style={s.muted}>Status: {payoutAccount.status ?? "unknown"}</Text>
                    {payoutAccount.status !== "active" && (
                      <Text style={s.warn}>
                        Payouts are on hold until your account is verified.
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={s.warn}>
                    No payout account yet. Add your bank details (IBAN) and CNIC or NTN in the
                    seller panel before your first payout.
                  </Text>
                )}
              </View>

              <View style={s.card}>
                <Text style={s.cardTitle}>Shop</Text>
                <Text style={s.muted}>{seller?.name ?? "—"}</Text>
                <Text style={s.muted}>{seller?.email ?? ""}</Text>
              </View>

              {shops.length > 1 && (
                <View style={s.card}>
                  <Text style={s.cardTitle}>Switch shop</Text>
                  {shops.map((shop) => (
                    <Pressable key={shop.id} onPress={() => switchShop(shop.id)}>
                      <Text style={s.link}>{shop.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[s.stat, accent && s.statAccent]}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <View style={s.badge}>
      <Text style={s.badgeText}>{text.replace(/_/g, " ")}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  authWrap: { padding: 24, gap: 14, flexGrow: 1, justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  brand: { fontSize: 22, fontWeight: "800", color: color.link, letterSpacing: -0.5 },
  brandSub: { fontSize: 13, color: color.textMuted },
  link: { color: color.link, fontWeight: "600" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", paddingHorizontal: 8 },
  tab: { paddingVertical: 12, paddingHorizontal: 16 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: color.link },
  tabText: { color: color.textMuted, fontWeight: "600" },
  tabTextActive: { color: color.link },
  list: { padding: 16, gap: 12 },
  statRow: { flexDirection: "row", gap: 12 },
  stat: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: color.border,
  },
  statAccent: { backgroundColor: color.successTint, borderColor: color.successTint },
  statValue: { fontSize: 20, fontWeight: "800", color: color.text },
  statLabel: { fontSize: 12, color: color.textMuted, marginTop: 2 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: color.border,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontWeight: "700", color: color.text, fontSize: 15 },
  cardAmount: { fontWeight: "800", color: color.text },
  badges: { flexDirection: "row", gap: 8, marginTop: 4 },
  badge: {
    backgroundColor: color.surfaceSunken,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { fontSize: 11, color: color.textMuted, fontWeight: "600" },
  noteBox: {
    backgroundColor: color.warningTint,
    borderRadius: 12,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: color.warningTint,
  },
  noteTitle: { fontWeight: "700", color: color.warning },
  field: { gap: 6 },
  label: { fontSize: 13, color: color.textMuted, fontWeight: "500" },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: color.borderControl,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  primary: {
    backgroundColor: color.link,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
  muted: { color: color.textMuted, fontSize: 13, lineHeight: 19 },
  warn: { color: color.warning, fontSize: 13, lineHeight: 19 },
  errorBar: { backgroundColor: color.dangerTint, padding: 12 },
  errorText: { color: color.danger, fontSize: 13 },
});
