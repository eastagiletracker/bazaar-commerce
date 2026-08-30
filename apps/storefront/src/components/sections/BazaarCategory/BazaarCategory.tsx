"use client"

import { useMemo, useState } from "react"
import { HttpTypes } from "@medusajs/types"

import { ProductCard } from "@/components/organisms/ProductCard/ProductCard"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { applyFacets, buildFacets } from "./facets"

/**
 * Category listing.
 *
 * Layout follows Amazon's department pages, because it is the pattern that
 * handles a wide catalogue best: subcategories as tiles across the top so you
 * can narrow by browsing, then filters down the left and the grid to the right
 * for narrowing by attribute.
 *
 * The rule the client asked for, and the one that matters most: a filter with
 * nothing behind it is hidden. Facets are computed from the products actually
 * present, groups with fewer than two options disappear entirely, and every
 * option carries its real count. Filters that return zero results teach people
 * the filters are broken, and then they stop narrowing and leave.
 *
 * On mobile the filters are a bottom sheet rather than a separate page, so the
 * results stay in context while you choose.
 */

type ProductLike = HttpTypes.StoreProduct & {
  seller?: { id?: string; name?: string } | null
}

type Subcategory = { id: string; name: string; handle: string; image?: string | null }

const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "newest", label: "Newest arrivals" },
] as const

const cheapest = (p: ProductLike): number => {
  const amounts = (p.variants ?? [])
    .map((v) => (v as { calculated_price?: { calculated_amount?: number } }).calculated_price?.calculated_amount)
    .filter((n): n is number => typeof n === "number" && n > 0)
  return amounts.length ? Math.min(...amounts) : Number.POSITIVE_INFINITY
}

export const BazaarCategory = ({
  title,
  description,
  subcategories,
  products,
}: {
  title: string
  description?: string | null
  subcategories: Subcategory[]
  products: ProductLike[]
}) => {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("featured")
  const [sheetOpen, setSheetOpen] = useState(false)

  const facets = useMemo(() => buildFacets(products), [products])

  const visible = useMemo(() => {
    const filtered = applyFacets(products, selected)
    const sorted = [...filtered]
    if (sort === "price_asc") sorted.sort((a, b) => cheapest(a) - cheapest(b))
    if (sort === "price_desc") sorted.sort((a, b) => cheapest(b) - cheapest(a))
    if (sort === "newest") {
      sorted.sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      )
    }
    return sorted
  }, [products, selected, sort])

  const activeCount = Object.values(selected).flat().length

  const toggle = (key: string, value: string) =>
    setSelected((prev) => {
      const current = prev[key] ?? []
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      return { ...prev, [key]: next }
    })

  const clearAll = () => setSelected({})

  const filterPanel = (
    <div className="space-y-6">
      {facets.map((facet) => (
        <fieldset key={facet.key}>
          <legend className="mb-2 text-[15px] font-bold text-primary">{facet.label}</legend>
          <div className="space-y-1.5">
            {facet.options.map((opt) => {
              const checked = (selected[facet.key] ?? []).includes(opt.value)
              return (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2.5 text-[14px] text-primary"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(facet.key, opt.value)}
                    className="h-4 w-4 shrink-0 accent-[rgb(var(--cta-500))]"
                  />
                  <span className="flex-1">{opt.label}</span>
                  <span className="text-[13px] tabular-nums text-secondary">{opt.count}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}

      {/* Nothing to filter on is a real state, and saying so is better than an
          empty column the shopper reads as a broken page. */}
      {facets.length === 0 && (
        <p className="text-[13px] leading-relaxed text-secondary">
          No filters are available for this selection yet. They appear as
          sellers add more detail to their listings.
        </p>
      )}
    </div>
  )

  return (
    <div className="bg-secondary">
      <div className="mx-auto max-w-[1500px] px-4 py-5 lg:px-6">
        {/* ------------------------------------------------- title band */}
        <div className="rounded-lg bg-component px-6 py-7 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-primary sm:text-[32px]">
            {title}
          </h1>
          {description && (
            <p className="mx-auto mt-2 max-w-2xl text-sm text-secondary">{description}</p>
          )}
        </div>

        {/* ------------------------------------------- subcategory tiles */}
        {subcategories.length > 0 && (
          <section className="mt-5 rounded-lg bg-component p-5">
            <h2 className="mb-4 text-lg font-bold text-primary">Shop by category</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {subcategories.map((sub) => (
                <LocalizedClientLink
                  key={sub.id}
                  href={`/categories/${sub.handle}`}
                  className="group w-[124px] shrink-0 text-center"
                >
                  <div className="aspect-square w-full overflow-hidden rounded-lg bg-secondary transition-shadow group-hover:shadow-md">
                    {sub.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sub.image}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-2xl text-secondary">
                        {sub.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[13px] font-medium leading-tight text-primary group-hover:text-action group-hover:underline">
                    {sub.name}
                  </p>
                </LocalizedClientLink>
              ))}
            </div>
          </section>
        )}

        {/* ------------------------------------------------ results area */}
        <div className="mt-5 gap-5 lg:flex">
          {/* Sidebar only renders when there is something to put in it. */}
          {facets.length > 0 && (
            <aside className="hidden w-[240px] shrink-0 lg:block">
              <div className="sticky top-[124px] rounded-lg bg-component p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[15px] font-bold text-primary">Filters</h2>
                  {activeCount > 0 && (
                    <button onClick={clearAll} className="text-[13px] font-semibold text-action hover:underline">
                      Clear
                    </button>
                  )}
                </div>
                {filterPanel}
              </div>
            </aside>
          )}

          <div className="min-w-0 flex-1">
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-component px-4 py-3">
              <p className="text-[14px] text-secondary">
                <span className="font-bold text-primary">{visible.length}</span>{" "}
                {visible.length === 1 ? "result" : "results"}
                {activeCount > 0 && ` of ${products.length}`}
              </p>

              {facets.length > 0 && (
                <button
                  onClick={() => setSheetOpen(true)}
                  className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-[14px] font-semibold text-primary lg:hidden"
                >
                  Filters
                  {activeCount > 0 && (
                    <span className="rounded-full bg-action px-1.5 text-[12px] font-bold text-action-on-primary">
                      {activeCount}
                    </span>
                  )}
                </button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <label htmlFor="sort" className="text-[14px] text-secondary">
                  Sort by
                </label>
                <select
                  id="sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="rounded-md border border-input bg-component px-2 py-1.5 text-[14px] text-primary outline-none"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Active filters as removable chips: the shopper can always see
                why they are looking at a smaller list. */}
            {activeCount > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {Object.entries(selected).flatMap(([key, values]) =>
                  values.map((v) => (
                    <button
                      key={`${key}-${v}`}
                      onClick={() => toggle(key, v)}
                      className="flex items-center gap-1.5 rounded-full border border-input bg-component px-3 py-1 text-[13px] text-primary hover:bg-component-hover"
                    >
                      {v}
                      <span aria-hidden className="text-secondary">&times;</span>
                      <span className="sr-only">Remove filter</span>
                    </button>
                  ))
                )}
                <button onClick={clearAll} className="text-[13px] font-semibold text-action hover:underline">
                  Clear all
                </button>
              </div>
            )}

            {visible.length === 0 ? (
              <div className="rounded-lg bg-component p-10 text-center">
                <p className="text-[17px] font-bold text-primary">No matching products</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-secondary">
                  Try removing a filter or two.
                </p>
                <button
                  onClick={clearAll}
                  className="mt-5 rounded-md bg-action px-6 py-2.5 text-[15px] font-semibold text-action-on-primary hover:bg-action-hover"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 lg:gap-4">
                {visible.map((p, i) => (
                  <ProductCard key={p.id} product={p as never} priority={i < 5} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ mobile sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button
            className="absolute inset-0 bg-black/50"
            aria-label="Close filters"
            onClick={() => setSheetOpen(false)}
          />
          {/* A sheet, not a separate page: the results stay behind it, so the
              shopper never loses their place while narrowing. */}
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-component">
            <div className="sticky top-0 flex items-center justify-between border-b border-primary bg-component px-5 py-4">
              <h2 className="text-[17px] font-bold text-primary">Filters</h2>
              <button onClick={() => setSheetOpen(false)} aria-label="Close" className="text-2xl leading-none text-secondary">
                &times;
              </button>
            </div>
            <div className="px-5 py-5">{filterPanel}</div>
            <div className="sticky bottom-0 flex gap-3 border-t border-primary bg-component px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                onClick={clearAll}
                className="flex-1 rounded-md border border-input py-3 text-[15px] font-semibold text-primary"
              >
                Clear
              </button>
              <button
                onClick={() => setSheetOpen(false)}
                className="flex-[1.5] rounded-md bg-action py-3 text-[15px] font-semibold text-action-on-primary"
              >
                Show {visible.length} {visible.length === 1 ? "result" : "results"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
