import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { color, formatPkr, radius, shadow, space, TAP_MIN, type } from "./theme";
import type { Offer } from "./api";

/* ------------------------------------------------------------------ Button */

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
  fullWidth,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
}) {
  const isPrimary = variant === "primary";
  const isSecondary = variant === "secondary";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Pressed state darkens rather than fades: a control should gain weight
      // under the finger, not look like it is switching off.
      style={({ pressed }) => [
        s.btn,
        isPrimary && { backgroundColor: pressed ? color.primaryPressed : color.primary },
        isSecondary && {
          backgroundColor: pressed ? color.linkTint : color.surface,
          borderWidth: 1,
          borderColor: color.borderControl,
        },
        variant === "ghost" && { backgroundColor: "transparent" },
        fullWidth && { alignSelf: "stretch" },
        (disabled || loading) && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? color.onPrimary : color.link} />
      ) : (
        <Text
          style={[
            type.bodyStrong,
            // Dark ink on the yellow CTA. White here is 1.46:1.
            { color: isPrimary ? color.onPrimary : color.link, fontSize: 15 },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------- Badge */

export function Badge({
  children,
  tone = "deal",
}: {
  children: ReactNode;
  tone?: "deal" | "success" | "danger" | "neutral";
}) {
  const tones = {
    // Red badge with white text (5.36:1). The old amber badge needed dark
    // text; the CTA yellow is now reserved for buttons.
    deal: { bg: color.deal, fg: color.onDeal },
    success: { bg: color.successTint, fg: color.success },
    danger: { bg: color.dangerTint, fg: color.danger },
    neutral: { bg: color.surfaceSunken, fg: color.textMuted },
  }[tone];

  return (
    <View style={[s.badge, { backgroundColor: tones.bg }]}>
      <Text style={[type.tiny, { color: tones.fg }]}>{children}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------- Stars */

export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 1 }} accessibilityLabel={`${value} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Text key={i} style={{ fontSize: size, color: value - i >= 0.5 ? color.primaryPressed : color.border }}>
          ★
        </Text>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------- ProductCard */

/**
 * The most-repeated object in the app, so it sets the tone for everything.
 *
 * Departures from how Daraz and AliExpress build this:
 *  - the seller is NAMED (it is a marketplace; who you buy from is primary)
 *  - the price is the loudest element, not the title
 *  - discounts are computed from real prices, never decorative
 *  - no hover-dependent anything; every affordance is visible at rest
 */
export function ProductCard({
  offer,
  onPress,
  width,
}: {
  offer: Offer;
  onPress: () => void;
  width: number;
}) {
  const price = Number(offer.calculated_price?.calculated_amount ?? 0);
  const original = Number(offer.calculated_price?.original_amount ?? 0);
  const hasMarkdown = original > price && price > 0;
  const pct = hasMarkdown ? Math.round(((original - price) / original) * 100) : 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.card, { width }, pressed && { opacity: 0.85 }]}
    >
      <View style={s.cardImageWrap}>
        {offer.thumbnail ? (
          <Image source={{ uri: offer.thumbnail }} style={s.cardImage} resizeMode="contain" />
        ) : (
          <View style={[s.cardImage, s.cardImageEmpty]}>
            <Text style={{ fontSize: 28 }}>📦</Text>
          </View>
        )}
        {hasMarkdown && pct >= 5 && (
          <View style={s.cardDiscount}>
            <Text style={[type.tiny, { color: color.onDeal }]}>-{pct}%</Text>
          </View>
        )}
      </View>

      <View style={s.cardBody}>
        {offer.seller?.name && (
          <Text numberOfLines={1} style={[type.tiny, { color: color.textMuted }]}>
            {offer.seller.name.toUpperCase()}
          </Text>
        )}
        {/* The PRODUCT name leads. The variant ("EU 43") is a qualifier and
            means nothing on its own in a grid.
            Fixed two lines so the grid keeps an even rhythm however long the
            seller's title is. A ragged grid is the ugliest thing about Daraz. */}
        <Text numberOfLines={2} style={[type.body, s.cardTitle]}>
          {offer.product?.title ?? offer.product_variant?.title ?? offer.sku}
        </Text>
        {offer.product_variant?.title && (
          <Text numberOfLines={1} style={[type.small, { color: color.textMuted }]}>
            {offer.product_variant.title}
          </Text>
        )}

        <View style={s.cardPriceRow}>
          <Text style={[type.price, { color: color.text }]}>{formatPkr(price)}</Text>
          {hasMarkdown && (
            <Text style={[type.small, s.cardStrike]}>{formatPkr(original)}</Text>
          )}
        </View>

        <Text style={[type.tiny, { color: color.success }]}>Cash on delivery</Text>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------- Skeletons */

/**
 * Skeletons, not spinners. On a slow connection a spinner tells you nothing;
 * a skeleton tells you what is about to appear and how much of it there is.
 */
export function CardSkeleton({ width }: { width: number }) {
  return (
    <View style={[s.card, { width }]}>
      <View style={[s.cardImageWrap, { backgroundColor: color.surfaceSunken }]} />
      <View style={s.cardBody}>
        <View style={[s.skelLine, { width: "45%" }]} />
        <View style={[s.skelLine, { width: "90%" }]} />
        <View style={[s.skelLine, { width: "60%" }]} />
        <View style={[s.skelLine, { width: "35%", height: 16, marginTop: 4 }]} />
      </View>
    </View>
  );
}

/* --------------------------------------------------------------- Section */

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.sectionHeader}>
      <Text style={[type.h2, { color: color.text }]}>{title}</Text>
      {action && (
        <Pressable onPress={onAction} hitSlop={12}>
          <Text style={[type.bodyStrong, { color: color.link }]}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A row of trust signals. In a COD market this is what closes the sale. */
export function TrustRow() {
  const items = [
    { icon: "💵", label: "Cash on\ndelivery" },
    { icon: "↩️", label: "7-day\nreturns" },
    { icon: "✅", label: "Verified\nsellers" },
  ];
  return (
    <View style={s.trustRow}>
      {items.map((it) => (
        <View key={it.label} style={s.trustItem}>
          <Text style={{ fontSize: 18 }}>{it.icon}</Text>
          <Text style={[type.tiny, { color: color.textMuted, textAlign: "center" }]}>
            {it.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  body,
  action,
  onAction,
}: {
  icon: string;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.empty}>
      <Text style={{ fontSize: 44 }}>{icon}</Text>
      <Text style={[type.h2, { color: color.text, textAlign: "center" }]}>{title}</Text>
      {body && (
        <Text style={[type.body, { color: color.textMuted, textAlign: "center" }]}>{body}</Text>
      )}
      {action && <Button label={action} onPress={onAction} style={{ marginTop: space.sm }} />}
    </View>
  );
}

/* ----------------------------------------------------------------- styles */

const s = StyleSheet.create({
  btn: {
    minHeight: TAP_MIN,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.border,
    ...shadow.card,
  },
  cardImageWrap: {
    aspectRatio: 1,
    backgroundColor: color.surfaceSunken,
    position: "relative",
  },
  cardImage: { width: "100%", height: "100%" },
  cardImageEmpty: { alignItems: "center", justifyContent: "center" },
  cardDiscount: {
    position: "absolute",
    top: space.sm,
    left: space.sm,
    backgroundColor: color.deal,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  cardBody: { padding: space.md, gap: 3 },
  cardTitle: { color: color.text, minHeight: 38, lineHeight: 19 },
  cardPriceRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm, marginTop: 2 },
  cardStrike: { color: color.textMuted, textDecorationLine: "line-through" },
  skelLine: {
    height: 10,
    borderRadius: 4,
    backgroundColor: color.surfaceSunken,
    marginTop: 6,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space["2xl"],
    paddingBottom: space.md,
  },
  trustRow: {
    flexDirection: "row",
    backgroundColor: color.surface,
    marginHorizontal: space.lg,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    borderWidth: 1,
    borderColor: color.border,
  },
  trustItem: { flex: 1, alignItems: "center", gap: 4 },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    padding: space["3xl"],
  },
});
