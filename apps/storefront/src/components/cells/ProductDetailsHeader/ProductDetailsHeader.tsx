"use client"

import { useState } from "react"
import { Button } from "@/components/atoms"
import { HttpTypes } from "@medusajs/types"
import { ProductVariants } from "@/components/molecules"
import useGetAllSearchParams from "@/hooks/useGetAllSearchParams"
import { getProductPrice } from "@/lib/helpers/get-product-price"
import { convertToLocale } from "@/lib/helpers/money"
import {
  getBuyboxWinner,
  getOfferAmount,
  getOfferStock,
  getVariantOffers,
  StoreOffer,
} from "@/lib/helpers/buybox"
import { Chat } from "@/components/organisms/Chat/Chat"
import { CompareOffersModal } from "@/components/organisms/CompareOffersModal/CompareOffersModal"
import { SellerDTO } from "@mercurjs/types"
import { toast } from "@/lib/helpers/toast"
import { useCartContext } from "@/components/providers"

/** Flat nationwide delivery, per seller. Mirrors DELIVERY_FEE in BazaarPdp. */
const DELIVERY_FEE = 250

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"]
) => {
  return variantOptions?.reduce(
    (
      acc: Record<string, string>,
      varopt: HttpTypes.StoreProductOptionValue
    ) => {
      acc[varopt.option?.title.toLowerCase() || ""] = varopt.value

      return acc
    },
    {}
  )
}

export const ProductDetailsHeader = ({
  product,
  locale,
  user,
  offers = [],
  seller,
}: {
  product: HttpTypes.StoreProduct
  locale: string
  user: HttpTypes.StoreCustomer | null
  offers?: StoreOffer[]
  seller?: SellerDTO
}) => {
  const { addToCart, onAddToCart, cart, isAddingItem } = useCartContext()
  const { allSearchParams } = useGetAllSearchParams()
  const [isCompareOpen, setIsCompareOpen] = useState(false)

  const { cheapestVariant, cheapestPrice } = getProductPrice({
    product,
  })

  const hasAnyPrice = cheapestPrice !== null && cheapestVariant !== null

  const selectedVariant = hasAnyPrice
    ? {
        ...optionsAsKeymap(cheapestVariant.options ?? null),
        ...allSearchParams,
      }
    : allSearchParams

  const variantId =
    product.variants?.find(({ options }: { options: any }) =>
      options?.every((option: any) =>
        selectedVariant[option.option?.title.toLowerCase() || ""]?.includes(
          option.value
        )
      )
    )?.id || ""

  const { variantPrice } = getProductPrice({
    product,
    variantId,
  })

  // Buybox: the winning offer for the selected variant sets the price shown and
  // the offer that add-to-cart uses. Products are sold through offers, not the
  // variant's base price.
  const variantOffers = getVariantOffers(offers, variantId)
  const winnerOffer = getBuyboxWinner(variantOffers)
  const otherOffersCount = Math.max(variantOffers.length - 1, 0)

  const offerAmount = winnerOffer ? getOfferAmount(winnerOffer) : null
  const offerCurrency =
    winnerOffer?.calculated_price?.currency_code ||
    variantPrice?.currency_code ||
    "eur"
  const offerStock = winnerOffer ? getOfferStock(winnerOffer) : 0
  const hasOffer = !!winnerOffer && offerAmount !== null

  const displayPrice = hasOffer
    ? convertToLocale({ amount: offerAmount as number, currency_code: offerCurrency })
    : variantPrice?.calculated_price

  const quantityInCart =
    cart?.items?.find((item) => item.metadata?.offer_id === winnerOffer?.id)
      ?.quantity ?? 0
  const isStockMaxLimitReached = quantityInCart >= offerStock

  const isAddToCartDisabled =
    !hasOffer || !offerStock || isStockMaxLimitReached

  const handleAddToCart = async () => {
    if (!winnerOffer || isAddToCartDisabled) return

    const total = offerAmount as number
    const subtotal =
      winnerOffer.calculated_price?.calculated_amount_without_tax ?? total

    const storeCartLineItem = {
      thumbnail: product.thumbnail || "",
      product_title: product.title,
      quantity: 1,
      subtotal,
      total,
      tax_total: total - subtotal,
      variant_id: variantId,
      product_id: product.id,
      variant: product.variants?.find(({ id }) => id === variantId),
      metadata: { offer_id: winnerOffer.id },
    }

    onAddToCart(storeCartLineItem, offerCurrency)

    try {
      await addToCart({
        offerId: winnerOffer.id,
        quantity: 1,
        countryCode: locale,
      })
    } catch (error) {
      toast.error({
        title: "Error adding to cart",
        description: "This offer does not have the required inventory",
      })
    }
  }

  return (
    <>
      <div
      className="rounded-lg border border-primary bg-component p-5"
      data-testid="product-details-header"
    >
      {/* Title first, then price as the largest thing on the page. In a
          marketplace the price is what the eye is looking for, and the old
          hierarchy had it the same weight as the heading. */}
      <h1
        className="text-xl font-bold leading-snug text-primary sm:text-2xl"
        data-testid="product-title"
      >
        {product.title}
      </h1>
      <div className="mt-3" data-testid="product-price-container">
        {hasOffer ? (
          <span
            className="text-[32px] font-extrabold leading-none tabular-nums text-primary"
            data-testid="product-price-current"
          >
            {displayPrice}
          </span>
        ) : hasAnyPrice && variantPrice ? (
          <span
            className="text-[32px] font-extrabold leading-none tabular-nums text-primary"
            data-testid="product-price-current"
          >
            {variantPrice.calculated_price}
          </span>
        ) : (
          <span
            className="text-sm text-secondary"
            data-testid="product-price-unavailable"
          >
            Not available in your region
          </span>
        )}
      </div>
      {hasAnyPrice && (
        <ProductVariants product={product} selectedVariant={selectedVariant} />
      )}
      <Button
        onClick={handleAddToCart}
        disabled={isAddToCartDisabled}
        loading={isAddingItem}
        className="mt-5 mb-3 flex w-full justify-center py-3.5 text-[15px] font-semibold"
        size="large"
        data-testid="product-add-to-cart-button"
      >
        {!hasOffer
          ? "Not available"
          : offerStock
          ? "Add to basket"
          : "Out of stock"}
      </Button>
      {otherOffersCount > 0 && (
        <Button
          variant="tonal"
          onClick={() => setIsCompareOpen(true)}
          className="mb-2 w-full text-[14px] font-semibold"
          data-testid="compare-offers-button"
        >
          {`Compare ${otherOffersCount} other seller${otherOffersCount === 1 ? "" : "s"}`}
        </Button>
      )}
      {isCompareOpen && (
        <CompareOffersModal
          offers={variantOffers}
          locale={locale}
          variantLabel={
            product.variants?.find(({ id }) => id === variantId)?.title ||
            undefined
          }
          onClose={() => setIsCompareOpen(false)}
        />
      )}
      {hasOffer && offerAmount !== null && (
        <div className="mt-4 border-t border-primary pt-4">
          {/* Computed from the same offerAmount as the headline price, and
              inside the same client component, so selecting a different
              variant moves both together. Deriving this separately on the
              server showed a different figure to the headline — two prices for
              one product, on the page whose whole job is trust. */}
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-secondary">Item price</dt>
              <dd className="font-semibold tabular-nums text-primary">{displayPrice}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-secondary">Delivery</dt>
              <dd className="font-semibold tabular-nums text-primary">
                {convertToLocale({ amount: DELIVERY_FEE, currency_code: offerCurrency })}
              </dd>
            </div>
            <div className="!mt-3 flex items-center justify-between border-t border-primary pt-3">
              <dt className="font-bold text-primary">Total to pay</dt>
              <dd className="text-lg font-extrabold tabular-nums text-primary">
                {convertToLocale({
                  amount: (offerAmount as number) + DELIVERY_FEE,
                  currency_code: offerCurrency,
                })}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[13px] text-secondary">
            Pay cash when the rider hands it over. No card needed.
          </p>
        </div>
      )}

      {user && seller && (
        <Chat
          user={user}
          seller={seller}
          buttonClassNames="w-full"
          product={product}
        />
      )}
      </div>

      {/*
        Sticky buy bar, mobile only.

        On a phone the add-to-cart button scrolls out of view within a swipe or
        two, and the buyer then has to scroll back up to act on a decision they
        already made. Every large marketplace pins this for that reason. Hidden
        on desktop, where the buy rail is already sticky.

        pb-[env(safe-area-inset-bottom)] keeps it clear of the iPhone home
        indicator.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-primary bg-component px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-up lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {/* Says "Price", not "Total": this figure excludes delivery, and
                the full breakdown lives in the cost block above. Labelling an
                item price as a total is precisely the bait-and-switch this
                page exists to avoid. */}
            <p className="text-[11px] font-medium text-secondary">Price</p>
            <p className="truncate text-lg font-extrabold tabular-nums text-primary">
              {hasOffer ? displayPrice : variantPrice?.calculated_price ?? "—"}
            </p>
          </div>
          <Button
            onClick={handleAddToCart}
            disabled={isAddToCartDisabled}
            loading={isAddingItem}
            className="flex-[1.3] justify-center py-3.5 text-[15px] font-semibold"
            size="large"
            data-testid="product-add-to-cart-button-sticky"
          >
            {!hasOffer ? "Not available" : offerStock ? "Add to basket" : "Out of stock"}
          </Button>
        </div>
      </div>
    </>
  )
}
