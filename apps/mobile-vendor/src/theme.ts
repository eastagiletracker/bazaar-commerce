import type { TextStyle } from "react-native";

/**
 * Bazaar design tokens for React Native.
 *
 * Mirrors apps/storefront/src/app/colors.css. Amazon-ADJACENT, not Amazon:
 * every value is shifted 15-38 in summed sRGB channel distance from Amazon's
 * actual colour — distinct to a colour picker, invisible to a shopper. Their
 * real values are noted so the gap stays deliberate.
 *
 * Two rules are binding, not preferences, both verified by
 * scripts/check-contrast.py at the repo root:
 *   1. CTA yellow and orange NEVER carry white text (1.46:1). Dark ink only.
 *      This is the trap when porting from the old jade theme, where the button
 *      label WAS white.
 *   2. Control borders are stone-400 or darker. Anything lighter fails the 3:1
 *      that WCAG 1.4.11 requires for a control boundary.
 */

/** The dark chrome. Amazon: #131921 / #232F3E / #37475A */
export const navy = {
  900: "#16202C",
  800: "#1E2C3D",
  700: "#26374B",
  600: "#3A4C63",
  500: "#4A627F",
  300: "#6A83A1",
  100: "#BFCBD8",
  25: "#F0F3F6",
} as const;

/** Calls to action. Amazon: #FFD814 / #FFA41C / #FF9900 */
export const cta = {
  50: "#FFF4CB",
  100: "#FFE999",
  200: "#FFDE64",
  300: "#FFD12E", // primary button
  400: "#FF9F2E", // pressed / secondary
  500: "#F98B12", // accent
  600: "#D06F0A",
  700: "#A35708",
} as const;

/** Links. The only teal on screen, so a teal word always means "tappable".
 *  Amazon: #007185 */
export const teal = {
  500: "#0A7382",
  600: "#0F5C66",
  100: "#A8DEE5",
  25: "#F0FAFB",
} as const;

/** Prices and errors. Amazon: #B12704 */
export const red = {
  500: "#CC2A20", // deal badge
  600: "#B32D12", // price
  700: "#94250F",
  50: "#FEE4E2",
} as const;

export const stone = {
  0: "#FFFFFF",
  25: "#F7F8F8",
  50: "#EDEFEF", // page background
  100: "#E3E6E6",
  200: "#D5D9D9", // hairline divider
  300: "#BBBFBF",
  400: "#8D9296", // minimum for a control border
  500: "#565959", // muted text
  700: "#3A4C63",
  900: "#16202C",
  1000: "#0F1111", // body ink
} as const;

/** Jade is retained ONLY for trust signals — COD, verified, in stock — where
 *  green reads as confirmation rather than as the brand. */
export const jade = {
  600: "#077C5C",
  700: "#06624A",
  25: "#F0FDF8",
} as const;

export const color = {
  // surfaces
  bg: stone[50],
  surface: stone[0],
  surfaceSunken: stone[25],
  // chrome
  chrome: navy[900],
  chromeSub: navy[700],
  chromeHover: navy[600],
  onChrome: stone[0],
  onChromeMuted: "rgba(255,255,255,0.72)",
  // text
  text: stone[1000],
  textMuted: stone[500],
  textOnDark: stone[0],
  // action: yellow button with DARK text
  primary: cta[300],
  primaryPressed: cta[400],
  onPrimary: stone[1000],
  primaryTint: cta[50],
  // links
  link: teal[500],
  linkPressed: teal[600],
  linkTint: teal[25],
  // prices
  price: stone[1000],
  priceSale: red[600],
  deal: red[500],
  onDeal: stone[0],
  // lines
  border: stone[200],
  borderControl: stone[400],
  // status
  success: jade[700],
  successTint: jade[25],
  warning: cta[700],
  warningTint: cta[50],
  danger: red[700],
  dangerTint: red[50],
} as const;

/**
 * 4pt spacing scale. Everything snaps to it, which is most of what makes an
 * interface feel deliberate rather than assembled.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  "2xl": 18,
  full: 999,
} as const;

/**
 * Type scale. Prices are tabular so digits line up down a grid — a column of
 * prices that jitters is the fastest way to look cheap.
 */
export const type: Record<string, TextStyle> = {
  display: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  h1: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  h2: { fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  h3: { fontSize: 15, fontWeight: "700" },
  body: { fontSize: 14, fontWeight: "400" },
  bodyStrong: { fontSize: 14, fontWeight: "600" },
  small: { fontSize: 12, fontWeight: "400" },
  tiny: { fontSize: 11, fontWeight: "600" },
  price: { fontSize: 17, fontWeight: "800", fontVariant: ["tabular-nums"] },
  priceLarge: { fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
};

export const shadow = {
  card: {
    shadowColor: stone[900],
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  // The sticky buy bar must read as floating above the page, so its shadow
  // points upward.
  bar: {
    shadowColor: stone[900],
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
} as const;

/**
 * Minimum tap target. 44pt is Apple's floor and 48dp is Google's; take the
 * larger. Undersized targets are the most common reason someone on a cheap
 * phone gives up on a checkout.
 */
export const TAP_MIN = 48;

export const formatPkr = (amount: number | string | null | undefined) => {
  if (amount === null || amount === undefined || amount === "") return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
};
