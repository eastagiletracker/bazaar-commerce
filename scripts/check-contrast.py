#!/usr/bin/env python3
"""Verify the Bazaar palette against WCAG contrast requirements.

A marketplace is read on cheap phones in daylight. Contrast is not a
box-ticking exercise here, it is whether the price is legible outdoors.

The palette is deliberately Amazon-ADJACENT, not Amazon: every value is shifted
far enough to be our own colour while keeping the familiarity that makes a
marketplace feel trustworthy on first visit. Amazon's actual values are noted
alongside so the distance is visible and intentional.
"""

def srgb_to_lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_color):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * srgb_to_lin(r) + 0.7152 * srgb_to_lin(g) + 0.0722 * srgb_to_lin(b)


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# Chrome — the dark header stack.        Amazon's:
NAVY_900 = "#16202C"                    # #131921
NAVY_700 = "#26374B"                    # #232F3E
NAVY_600 = "#3A4C63"                    # #37475A

# Calls to action.
CTA_YELLOW = "#FFD12E"                  # #FFD814
CTA_ORANGE = "#FF9F2E"                  # #FFA41C
ACCENT = "#F98B12"                      # #FF9900

# Text and links.
LINK = "#0A7382"                        # #007185
LINK_HOVER = "#0F5C66"
PRICE_RED = "#B32D12"                   # #B12704
DEAL_RED = "#CC2A20"

# Surfaces.
PAGE = "#EDEFEF"                        # #EAEDED
WHITE = "#FFFFFF"
INK = "#0F1111"
INK_MUTED = "#565959"
BORDER = "#D5D9D9"
BORDER_CONTROL = "#8D9296"

# Trust green, kept from the previous system for COD/verified messaging.
JADE_600 = "#077C5C"
JADE_700 = "#06624A"
JADE_25 = "#F0FDF8"

print("BAZAAR PALETTE (Amazon-adjacent) — WCAG contrast\n")
print("Text needs 4.5:1 (AA) / 7:1 (AAA). Large text and UI need 3:1.\n")

checks = [
    ("Header: white on navy-900", WHITE, NAVY_900, 4.5),
    ("Header: white on navy-700", WHITE, NAVY_700, 4.5),
    ("Header: white on navy-600 (hover)", WHITE, NAVY_600, 4.5),
    ("CTA: ink on yellow button", INK, CTA_YELLOW, 4.5),
    ("CTA: ink on orange button", INK, CTA_ORANGE, 4.5),
    ("Accent: ink on accent orange", INK, ACCENT, 4.5),
    ("Link teal on white", LINK, WHITE, 4.5),
    ("Link teal on page grey", LINK, PAGE, 4.5),
    ("Link hover on white", LINK_HOVER, WHITE, 4.5),
    ("Price red on white", PRICE_RED, WHITE, 4.5),
    ("Deal red on white", DEAL_RED, WHITE, 4.5),
    ("Body ink on white", INK, WHITE, 7.0),
    ("Body ink on page grey", INK, PAGE, 7.0),
    ("Muted text on white", INK_MUTED, WHITE, 4.5),
    ("Muted text on page grey", INK_MUTED, PAGE, 4.5),
    ("Control border on white", BORDER_CONTROL, WHITE, 3.0),
    ("Hairline divider (decorative)", BORDER, WHITE, 1.2),
    ("Trust: jade-700 on jade-25", JADE_700, JADE_25, 4.5),
    ("Trust: white on jade-600", WHITE, JADE_600, 4.5),
]

worst = []
for label, fg, bg, need in checks:
    r = ratio(fg, bg)
    ok = r >= need
    if not ok:
        worst.append((label, r, need))
    print(f"  {'PASS' if ok else 'FAIL'}  {r:5.2f}:1  (need {need})  {label}")

# Options considered and rejected, kept so the reasoning is not lost.
print("\nRejected (documented so they do not get reintroduced):")
for label, fg, bg, need in [
    ("white text on any CTA yellow/orange", WHITE, CTA_YELLOW, 4.5),
    ("stone-300 #C1BBB6 as a control border", "#C1BBB6", WHITE, 3.0),
]:
    print(f"  {ratio(fg, bg):5.2f}:1  (needs {need})  {label}")

# How far the palette sits from Amazon's, so the shift stays deliberate.
print("\nDistance from Amazon's values (sRGB channel deltas):")
for name, ours, theirs in [
    ("header dark", NAVY_900, "#131921"),
    ("header mid", NAVY_700, "#232F3E"),
    ("CTA yellow", CTA_YELLOW, "#FFD814"),
    ("accent orange", ACCENT, "#FF9900"),
    ("link teal", LINK, "#007185"),
    ("price red", PRICE_RED, "#B12704"),
]:
    a = [int(ours.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    b = [int(theirs.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    delta = sum(abs(x - y) for x, y in zip(a, b))
    print(f"  {ours} vs {theirs}  total delta {delta:>3}  {name}")

print()
if worst:
    print("FAILURES — palette needs adjusting:")
    for label, r, need in worst:
        print(f"  - {label}: {r:.2f} < {need}")
    raise SystemExit(1)
print("All contrast requirements met.")
