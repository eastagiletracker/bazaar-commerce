import { ProductDetailsHeader } from "@/components/cells"

import { retrieveCustomer } from "@/lib/data/customer"
import { getBuyboxWinner, rankOffers, StoreOffer } from "@/lib/helpers/buybox"
import { AdditionalAttributeProps } from "@/types/product"
import { HttpTypes } from "@medusajs/types"

/**
 * The buy controls: title, price, variant selection, add to cart, compare
 * offers, and the seller chat.
 *
 * Everything else that used to live here — the seller strip, shipping copy,
 * description, attributes, tags — now renders from ProductDetailsPage so the
 * page can control its own order. That order matters: the seller and the total
 * cost belong high on the page, and a description belongs below the fold.
 * Leaving those blocks here as well would duplicate them.
 */
export const ProductDetails = async ({
  product,
  locale,
  offers = [],
}: {
  product: HttpTypes.StoreProduct & {
    attribute_values?: AdditionalAttributeProps[]
  }
  locale: string
  offers?: StoreOffer[]
}) => {
  const user = await retrieveCustomer()

  // Master products have no seller of their own; it comes from the winning offer.
  const seller = getBuyboxWinner(rankOffers(offers))?.seller

  return (
    <ProductDetailsHeader
      product={product}
      locale={locale}
      user={user}
      offers={offers}
      seller={seller}
    />
  )
}
