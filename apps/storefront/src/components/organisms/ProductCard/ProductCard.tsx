"use client"

import Image from "next/image"
import { HttpTypes } from "@medusajs/types"
import { cn } from "@/lib/utils"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { getProductPrice } from "@/lib/helpers/get-product-price"
import { Product } from "@/types/product"

/**
 * Product card — the most-repeated object on the site, so it sets the tone for
 * everything. Home, category, search and seller pages all render this.
 *
 * Deliberate departures from how Daraz, AliExpress and Amazon build this card:
 *
 * - THE SELLER IS NAMED. This is a marketplace; who you are buying from is
 *   primary information, not a footnote on the product page. Daraz buries it,
 *   which is a large part of why buyers do not trust what arrives.
 * - NOTHING IS HOVER-ONLY. The old card hid its call to action behind
 *   :hover, which simply does not exist for the overwhelmingly mobile
 *   Pakistani audience. Everything actionable is visible at rest.
 * - PRICE IS THE LOUDEST ELEMENT. Not the title, not the badge. Price is what
 *   the eye is scanning for in a grid.
 * - DELIVERY COST IS ON THE CARD. "Free delivery" changes the decision before
 *   the click, so it belongs before the click.
 * - DISCOUNTS ARE COMPUTED, NOT DECORATED. The badge only appears when there
 *   is a real markdown, and it shows the actual percentage. No countdowns, no
 *   invented scarcity — the thing that makes those sites tiring and, over
 *   time, untrustworthy.
 */

type ProductCardProps = {
  product: (HttpTypes.StoreProduct | Product) & {
    seller?: { name?: string; handle?: string } | null
    rating?: number | null
    review_count?: number | null
    sold_count?: number | null
    free_shipping?: boolean | null
  }
  className?: string
  /** Grid cards size to their column; carousels need a fixed width. */
  fixedWidth?: boolean
  priority?: boolean
}

const parseAmount = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  // Price helpers return pre-formatted strings like "PKR 61,300".
  const digits = value.replace(/[^0-9.]/g, "")
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}

export const ProductCard = ({
  product,
  className,
  fixedWidth,
  priority = false,
}: ProductCardProps) => {
  if (!product) return null

  const { cheapestPrice } = getProductPrice({
    product: product as HttpTypes.StoreProduct,
  })

  const productName = String(product.title || "Product")
  const href = `/products/${product.handle}`

  const current = parseAmount(cheapestPrice?.calculated_price)
  const original = parseAmount(cheapestPrice?.original_price)
  const hasMarkdown = Boolean(current && original && original > current)
  const discountPct = hasMarkdown
    ? Math.round(((original! - current!) / original!) * 100)
    : 0

  const rating = typeof product.rating === "number" ? product.rating : null
  const reviewCount = product.review_count ?? 0
  const sellerName = product.seller?.name

  return (
    <article
      className={cn(
        "group relative flex w-full flex-col overflow-hidden rounded-lg border border-primary bg-component",
        "transition-shadow duration-200 hover:shadow-md focus-within:shadow-md",
        fixedWidth && "w-[220px] shrink-0 sm:w-[240px]",
        className
      )}
      data-testid="product-card"
      data-product-handle={product.handle}
    >
      {/* Image. Square so the grid keeps an even rhythm whatever sellers
          upload, and contained so nothing is cropped into nonsense. */}
      <LocalizedClientLink
        href={href}
        aria-label={productName}
        className="relative block aspect-square overflow-hidden bg-secondary"
        data-testid="product-card-link"
      >
        <Image
          src={
            product.thumbnail
              ? decodeURIComponent(product.thumbnail)
              : "/images/placeholder.svg"
          }
          alt={productName}
          fill
          priority={priority}
          sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-contain p-3 transition-transform duration-300 group-hover:scale-[1.04]"
          data-testid="product-card-image"
        />

        {hasMarkdown && discountPct >= 5 && (
          <span
            className="absolute left-2 top-2 rounded-sm bg-deal px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-primary"
            data-testid="product-card-discount"
          >
            -{discountPct}%
          </span>
        )}
      </LocalizedClientLink>

      <div className="flex flex-1 flex-col gap-1 p-3">
        {sellerName && (
          <p
            className="truncate text-[11px] font-medium uppercase tracking-wide text-secondary"
            data-testid="product-card-seller"
          >
            {sellerName}
          </p>
        )}

        <LocalizedClientLink href={href} className="group/title">
          {/* Two lines, then clip. A ragged grid from variable title lengths
              is the single ugliest thing about Daraz's listings. */}
          <h3
            className="line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-primary group-hover/title:underline"
            data-testid="product-card-title"
          >
            {productName}
          </h3>
        </LocalizedClientLink>

        {rating !== null && (
          <div
            className="flex items-center gap-1 text-xs text-secondary"
            data-testid="product-card-rating"
          >
            <Stars value={rating} />
            <span className="tabular-nums">{rating.toFixed(1)}</span>
            {reviewCount > 0 && <span>({reviewCount})</span>}
          </div>
        )}

        <div className="mt-auto pt-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span
              className="text-base font-bold tabular-nums text-primary"
              data-testid="product-card-current-price"
            >
              {cheapestPrice?.calculated_price}
            </span>
            {hasMarkdown && (
              <span
                className="text-xs tabular-nums text-secondary line-through"
                data-testid="product-card-original-price"
              >
                {cheapestPrice?.original_price}
              </span>
            )}
          </div>

          {product.free_shipping && (
            <p className="mt-1 text-[11px] font-medium text-positive">
              Free delivery
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

/** Rating stars. Inline SVG rather than an icon font: it is a handful of bytes
 *  and costs no extra request on a slow connection. */
function Stars({ value }: { value: number }) {
  return (
    <span className="flex items-center" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i))
        return (
          <svg key={i} viewBox="0 0 20 20" className="h-3 w-3">
            <defs>
              <linearGradient id={`s${i}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor="rgb(var(--accent-400))" />
                <stop offset={`${fill * 100}%`} stopColor="rgb(var(--neutral-200))" />
              </linearGradient>
            </defs>
            <path
              fill={`url(#s${i}-${Math.round(fill * 100)})`}
              d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z"
            />
          </svg>
        )
      })}
    </span>
  )
}
