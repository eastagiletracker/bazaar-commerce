import { HttpTypes } from "@medusajs/types"

/**
 * Derive filter facets from the products actually in view.
 *
 * The requirement driving this: a filter with nothing behind it is noise. A
 * "Colour" group on a category where no seller has tagged a colour, or a
 * "Under Rs 1,000" band with zero matches, teaches shoppers that the filters
 * do not work — and once they stop trusting the filters they stop narrowing,
 * which on a large catalogue means they leave.
 *
 * So every facet here is computed from real products and carries a real count,
 * and the UI drops any group that ends up with fewer than two options (one
 * option filters nothing).
 *
 * LIMITATION, worth being honest about: these counts describe the products on
 * the current page, not the whole category, because the Store API has no
 * faceted-count endpoint. Correct counts across a full category need a search
 * index — Mercur supports Algolia and Meilisearch, and that is the upgrade
 * path once the catalogue is big enough for it to matter.
 */

export type FacetOption = { value: string; label: string; count: number }
export type Facet = { key: string; label: string; options: FacetOption[] }

const PRICE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "Under Rs 1,000", min: 0, max: 1000 },
  { label: "Rs 1,000 - Rs 5,000", min: 1000, max: 5000 },
  { label: "Rs 5,000 - Rs 15,000", min: 5000, max: 15000 },
  { label: "Rs 15,000 - Rs 50,000", min: 15000, max: 50000 },
  { label: "Rs 50,000 and above", min: 50000, max: Infinity },
]

type ProductLike = HttpTypes.StoreProduct & {
  seller?: { id?: string; name?: string } | null
}

const cheapest = (p: ProductLike): number | null => {
  const amounts = (p.variants ?? [])
    .map((v) => (v as { calculated_price?: { calculated_amount?: number } }).calculated_price?.calculated_amount)
    .filter((n): n is number => typeof n === "number" && n > 0)
  return amounts.length ? Math.min(...amounts) : null
}

/**
 * A facet whose every option matches every product cannot narrow anything —
 * a Size group where all 12 products carry all 6 sizes, for instance. It looks
 * like a filter, does nothing when used, and is the same noise as an empty
 * facet, just less obvious.
 */
function canNarrow(options: FacetOption[], total: number): boolean {
  if (options.length < 2) return false
  return options.some((o) => o.count < total)
}

export function buildFacets(products: ProductLike[]): Facet[] {
  const facets: Facet[] = []
  const total = products.length

  // --- price -----------------------------------------------------------
  const priced = products.map(cheapest).filter((n): n is number => n !== null)
  if (priced.length) {
    const bands = PRICE_BANDS.map((band) => ({
      value: `${band.min}-${band.max === Infinity ? "" : band.max}`,
      label: band.label,
      count: priced.filter((n) => n >= band.min && n < band.max).length,
    })).filter((b) => b.count > 0)

    if (canNarrow(bands, total)) {
      facets.push({ key: "price", label: "Price", options: bands })
    }
  }

  // --- seller ----------------------------------------------------------
  const sellerCounts = new Map<string, { label: string; count: number }>()
  for (const p of products) {
    const name = p.seller?.name
    if (!name) continue
    const entry = sellerCounts.get(name) ?? { label: name, count: 0 }
    entry.count += 1
    sellerCounts.set(name, entry)
  }
  const sellerOptions = [...sellerCounts.entries()]
    .map(([value, v]) => ({ value, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
  if (canNarrow(sellerOptions, total)) {
    facets.push({ key: "seller", label: "Seller", options: sellerOptions })
  }

  // --- variant options (Size, Colour, whatever sellers actually used) ---
  const optionCounts = new Map<string, Map<string, number>>()
  for (const p of products) {
    for (const option of p.options ?? []) {
      const title = option.title
      if (!title) continue
      const bucket = optionCounts.get(title) ?? new Map<string, number>()
      const seen = new Set<string>()
      for (const val of option.values ?? []) {
        const v = (val as { value?: string }).value
        // Count each product once per value, not once per variant.
        if (!v || seen.has(v)) continue
        seen.add(v)
        bucket.set(v, (bucket.get(v) ?? 0) + 1)
      }
      optionCounts.set(title, bucket)
    }
  }
  for (const [title, values] of optionCounts) {
    // Mercur's internal default option is not a real axis.
    if (title.startsWith("__")) continue
    const options = [...values.entries()]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    if (!canNarrow(options, total)) continue
    facets.push({ key: `opt:${title}`, label: title, options })
  }

  return facets
}

/** Apply the selected facets to the product list. */
export function applyFacets(
  products: ProductLike[],
  selected: Record<string, string[]>
): ProductLike[] {
  return products.filter((p) => {
    for (const [key, values] of Object.entries(selected)) {
      if (!values.length) continue

      if (key === "price") {
        const price = cheapest(p)
        if (price === null) return false
        const inAny = values.some((band) => {
          const [minRaw, maxRaw] = band.split("-")
          const min = Number(minRaw)
          const max = maxRaw === "" ? Infinity : Number(maxRaw)
          return price >= min && price < max
        })
        if (!inAny) return false
        continue
      }

      if (key === "seller") {
        if (!p.seller?.name || !values.includes(p.seller.name)) return false
        continue
      }

      if (key.startsWith("opt:")) {
        const title = key.slice(4)
        const option = (p.options ?? []).find((o) => o.title === title)
        const optionValues = (option?.values ?? []).map(
          (v) => (v as { value?: string }).value
        )
        if (!values.some((v) => optionValues.includes(v))) return false
      }
    }
    return true
  })
}
