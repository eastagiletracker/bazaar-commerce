#!/usr/bin/env python3
"""Derive the Pakistan seed from Mercur's demo seed.

Every replacement is asserted, so a Mercur upgrade that changes the demo seed
fails this script loudly instead of silently emitting a half-localized seed.
"""
import re
import sys
import pathlib

SRC = pathlib.Path.home() / "pk-marketplace/packages/api/src/scripts/seed.ts"
DST = pathlib.Path.home() / "pk-marketplace/packages/api/src/scripts/seed-pk.ts"

s = SRC.read_text()
applied = []


def sub(old, new, label, count=None):
    """Exact-substring replace, asserting it actually matched."""
    global s
    n = s.count(old)
    if n == 0:
        sys.exit(f"FAIL [{label}]: pattern not found:\n{old[:200]}")
    if count is not None and n != count:
        sys.exit(f"FAIL [{label}]: expected {count} occurrences, found {n}")
    s = s.replace(old, new)
    applied.append(f"{label} ({n}x)")


# 1. Countries -------------------------------------------------------------
sub(
    'const countries = ["gb", "de", "dk", "se", "fr", "es", "it"];',
    'const countries = ["pk"];',
    "countries -> pk",
    1,
)

# 2. Store supported currencies -------------------------------------------
sub(
    """      supported_currencies: [
        {
          currency_code: "eur",
          is_default: true,
        },
        {
          currency_code: "usd",
        },
      ],""",
    """      supported_currencies: [
        {
          currency_code: "pkr",
          is_default: true,
        },
      ],""",
    "store currencies -> pkr only",
    1,
)

# 6. Shipping option prices -> PKR ----------------------------------------
sub(
    """            prices: [
              { currency_code: "usd", amount: 10 },
              { currency_code: "eur", amount: 10 },
              { region_id: region.id, amount: 10 },
            ],""",
    """            prices: [
              { currency_code: "pkr", amount: 250 },
              { region_id: region.id, amount: 250 },
            ],""",
    "shipping prices -> PKR 250",
    2,
)

# 7. Offer prices -> PKR ---------------------------------------------------
sub(
    """          const jitter = 1 + (rand() * 0.3 - 0.15); // ±15%
          const eur = Math.max(1, Math.round(basePrice * jitter));
          const usd = Math.round(eur * 1.08);""",
    """          const jitter = 1 + (rand() * 0.3 - 0.15); // ±15%
          // Round to the nearest PKR 50 so listings look like real rupee prices.
          const pkr = Math.max(
            100,
            Math.round((basePrice * jitter) / 50) * 50
          );""",
    "offer price calc -> PKR",
    1,
)
sub(
    """            prices: [
              { amount: eur, currency_code: "eur" },
              { amount: usd, currency_code: "usd" },
            ],""",
    """            prices: [{ amount: pkr, currency_code: "pkr" }],""",
    "offer prices array -> PKR",
    1,
)

# 3. Region name + currency ------------------------------------------------
sub('name: "Europe",', 'name: "Pakistan",', "region name", 2)
sub('currency_code: "eur",', 'currency_code: "pkr",', "region+seller currency", 3)

# 4. Store name ------------------------------------------------------------
sub("name: 'Mercur Marketplace',", "name: 'Bazaar',", "store name", 1)

# 5. Service zone label ----------------------------------------------------
sub(
    'name: `${sellerConfig.name} Europe`,',
    'name: `${sellerConfig.name} Pakistan`,',
    "service zone name",
    1,
)

# 8. Catalog prices EUR -> PKR (x300, rounded to nearest 100) --------------
def reprice(m):
    eur = int(m.group(1))
    return f"price: {round(eur * 300 / 100) * 100},"


s, n = re.subn(r"price: (\d+),", reprice, s)
if n != 12:
    sys.exit(f"FAIL [catalog reprice]: expected 12 prices, repriced {n}")
applied.append(f"catalog reprice EURx300 ({n}x)")

# 9. Sellers ---------------------------------------------------------------
sub(
    """  const SELLER_CONFIGS = [
    { name: "Sole Society", email: "seller@mercur.dev", first_name: "Demo", last_name: "Seller", city: "Berlin", country_code: "DE", address_1: "Alexanderplatz 1" },
    { name: "Kickz Corner", email: "kickz@mercur.dev", first_name: "Kai", last_name: "Corner", city: "Amsterdam", country_code: "NL", address_1: "Damrak 12" },
    { name: "Trailhead Outfitters", email: "trailhead@mercur.dev", first_name: "Tara", last_name: "Head", city: "Munich", country_code: "DE", address_1: "Marienplatz 3" },
  ];""",
    """  const SELLER_CONFIGS = [
    { name: "Karachi Traders", email: "karachi@bazaar.pk", first_name: "Bilal", last_name: "Ahmed", city: "Karachi", country_code: "PK", address_1: "Shahrah-e-Faisal, Block 6, PECHS" },
    { name: "Lahore Bazaar Co", email: "lahore@bazaar.pk", first_name: "Ayesha", last_name: "Iqbal", city: "Lahore", country_code: "PK", address_1: "Main Boulevard, Gulberg III" },
    { name: "Islamabad Retail", email: "islamabad@bazaar.pk", first_name: "Hamza", last_name: "Raza", city: "Islamabad", country_code: "PK", address_1: "Jinnah Avenue, Blue Area" },
  ];""",
    "seller configs -> PK",
    1,
)

sub(
    'description: `${sellerConfig.name} — a demo marketplace footwear seller.`,',
    'description: `${sellerConfig.name} is a demo seller on the Bazaar marketplace.`,',
    "seller description",
    1,
)

# 10. Entry point name -----------------------------------------------------
sub(
    "export default async function seedDemoData({ container }: ExecArgs) {",
    "export default async function seedPakistanData({ container }: ExecArgs) {",
    "entrypoint name",
    1,
)

# 11. Header comment -------------------------------------------------------
header = """// PAKISTAN SEED - derived from Mercur's demo seed by scripts/make_pk_seed.py.
//
// Localized to Pakistan: single `pk` region, PKR as the only store currency,
// PKR 250 flat delivery, three PK sellers, and catalog prices converted from the
// demo's EUR figures at a flat 300x (indicative only, not a live FX rate).
//
// The CATALOG ITSELF IS STILL MERCUR'S DEMO FOOTWEAR SET. It exists to prove
// checkout works end to end in PKR. Real catalog arrives via the Phase 2 CSV
// importer and Shopify connector; do not treat these products as PK assortment.
//
// Regenerate rather than hand-edit, so a Mercur upgrade surfaces conflicts:
//   python3 scripts/make_pk_seed.py
"""
s = header + s

DST.write_text(s)
print("Wrote", DST)
print("\nReplacements applied:")
for a in applied:
    print("  -", a)

# Guard: no stray EUR/USD left in the money paths.
leftovers = [
    ln
    for ln in s.splitlines()
    if re.search(r'currency_code: "(eur|usd)"', ln)
]
if leftovers:
    sys.exit("FAIL: leftover eur/usd currency codes:\n" + "\n".join(leftovers))
print("\nGuard passed: no eur/usd currency codes remain.")
