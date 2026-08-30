import { ProductDetails, ProductGallery } from "@/components/organisms"
import { listProducts } from "@/lib/data/products"
import { listOffers } from "@/lib/data/offers"
import { getBuyboxWinner, rankOffers, StoreOffer } from "@/lib/helpers/buybox"
import NotFound from "@/app/not-found"
import { TrendingGrid } from "../BazaarHome/TrendingGrid"
import {
  AssuranceRow,
  Breadcrumb,
  DeliveryEstimate,
  DescriptionSection,
  ReviewsSection,
  SellerCard,
} from "./BazaarPdp"

/**
 * Product page.
 *
 * Two columns above the fold: gallery on the left, a STICKY buy rail on the
 * right. The rail keeps price, variant choice, the seller, the full cost and
 * the delivery window on screen for the whole scroll, so the buyer never has
 * to hunt back up the page to re-check what they are committing to.
 *
 * Order inside the rail is deliberate and matches the order of objections:
 * price and variant, then WHO is selling, then WHEN it arrives, then the TOTAL.
 * The previous layout put the seller in a thin strip near the bottom and never
 * mentioned delivery cost at all.
 *
 * Description and specifications move below the fold. They matter, but not
 * before the four questions above are answered.
 */
export const ProductDetailsPage = async ({
  handle,
  locale,
}: {
  handle: string
  locale: string
}) => {
  const prod = await listProducts({
    countryCode: locale,
    queryParams: { handle: [handle], limit: 1 },
  }).then(({ response }) => response.products[0])

  if (!prod) return null

  if (prod.seller?.store_status === "SUSPENDED") {
    return NotFound()
  }

  const { offers } = await listOffers({
    productId: prod.id,
    countryCode: locale,
  })

  // Products are sold through offers, so the buybox winner is what the page is
  // actually quoting — both the seller shown and the price used for the total.
  const ranked = rankOffers(offers as StoreOffer[])
  const winner = getBuyboxWinner(ranked)
  const seller = winner?.seller ?? prod.seller
  const category = prod.categories?.[0]

  return (
    <div className="container mx-auto px-4 lg:px-8" data-testid="product-details-page">
      <div className="pt-5">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            ...(category
              ? [{ label: category.name, href: `/categories/${category.handle}` }]
              : []),
            { label: prod.title },
          ]}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7" data-testid="product-gallery-container">
          <ProductGallery images={prod?.images || []} />
        </div>

        <div className="lg:col-span-5" data-testid="product-details-container">
          {/* Sticky on desktop only. On mobile it would fight the scroll. */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-28">
            <ProductDetails
              product={prod}
              locale={locale}
              offers={offers as StoreOffer[]}
            />
            <SellerCard seller={seller} />
            <DeliveryEstimate />
            <AssuranceRow />
          </div>
        </div>
      </div>

      <DescriptionSection
        description={prod.description}
        attributes={(prod as { attribute_values?: never[] }).attribute_values}
      />

      <ReviewsSection />

      <div className="border-t border-primary">
        <TrendingGrid
          locale={locale}
          title="You might also like"
          subtitle="Other items buyers looked at alongside this one."
          limit={5}
        />
      </div>
    </div>
  )
}
