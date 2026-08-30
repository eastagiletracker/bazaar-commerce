import { ProductCard } from "@/components/organisms/ProductCard/ProductCard"
import { listProducts } from "@/lib/data/products"
import { SectionHead } from "./BazaarHome"

/**
 * Product rail as a GRID, not a carousel.
 *
 * A carousel shows four items and hides the rest behind a swipe most people
 * never make. A grid puts ten in front of them at once, which is the whole job
 * of a homepage rail. It also removes the horizontal-scroll interaction, which
 * is awkward on desktop and competes with vertical scroll on mobile.
 */
export const TrendingGrid = async ({
  locale,
  title,
  subtitle,
  limit = 10,
}: {
  locale: string
  title: string
  subtitle?: string
  limit?: number
}) => {
  const {
    response: { products },
  } = await listProducts({
    countryCode: locale,
    queryParams: { limit, order: "created_at" },
  })

  if (!products?.length) return null

  return (
    <section className="container mx-auto px-4 py-12 lg:py-16">
      <SectionHead
        title={title}
        subtitle={subtitle}
        href="/categories"
        linkLabel="See all"
      />
      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-5">
        {products.map((product, i) => (
          <ProductCard
            key={product.id}
            product={product as never}
            priority={i < 5}
          />
        ))}
      </div>
    </section>
  )
}
