import Image from "next/image"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { convertToLocale } from "@/lib/helpers/money"

/**
 * Product page blocks.
 *
 * The job of a product page on a marketplace is not description, it is
 * objection-handling, in this order:
 *
 *   1. who is actually selling this to me?
 *   2. when will it turn up?
 *   3. what will it cost me in total?
 *   4. what happens if it is wrong?
 *
 * Daraz and AliExpress answer (1) in a thin strip near the bottom and (3) only
 * at checkout. Both are answered here, high on the page, before the buyer has
 * to ask.
 */

/* ------------------------------------------------------------ breadcrumb */

export const Breadcrumb = ({
  items,
}: {
  items: { label: string; href?: string }[]
}) => (
  <nav aria-label="Breadcrumb" className="mb-5">
    <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-secondary">
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="opacity-50">/</span>}
          {item.href ? (
            <LocalizedClientLink href={item.href} className="hover:text-primary hover:underline">
              {item.label}
            </LocalizedClientLink>
          ) : (
            <span className="text-primary">{item.label}</span>
          )}
        </li>
      ))}
    </ol>
  </nav>
)

/* ----------------------------------------------------------- seller card */

export const SellerCard = ({
  seller,
}: {
  seller?: { id?: string; name?: string; handle?: string; photo?: string | null } | null
}) => {
  if (!seller?.name) return null
  const initials = seller.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()

  return (
    <div className="rounded-lg border border-primary bg-component p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-action-secondary">
          {seller.photo ? (
            <Image src={seller.photo} alt="" width={44} height={44} className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-action">{initials}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
            Sold by
          </p>
          <p className="truncate text-[15px] font-bold text-primary">{seller.name}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-positive-secondary px-2.5 py-1 text-[11px] font-bold text-positive-on-secondary">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
            <path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zm4 6l-5 5-3-3 1.1-1.1L9 10.3l3.9-3.9z" />
          </svg>
          Verified
        </span>
      </div>
      {seller.handle && (
        <LocalizedClientLink
          href={`/sellers/${seller.handle}`}
          className="mt-3 inline-block text-[13px] font-semibold text-action hover:underline"
        >
          Visit shop &rarr;
        </LocalizedClientLink>
      )}
    </div>
  )
}

/* -------------------------------------------------------- cost + delivery */

const DELIVERY_FEE = 250

/**
 * The anti-bait-and-switch block.
 *
 * Delivery appearing for the first time at checkout is the most common reason
 * a marketplace basket is abandoned, and it feels like a trick even when it is
 * not. The arithmetic is shown here instead.
 */
export const CostBlock = ({
  amount,
  currencyCode,
}: {
  amount: number | null
  currencyCode: string
}) => {
  if (amount === null) return null

  const fmt = (n: number) => convertToLocale({ amount: n, currency_code: currencyCode })

  return (
    <div className="rounded-lg border border-primary bg-component p-4">
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-secondary">Item price</dt>
          <dd className="font-semibold tabular-nums text-primary">{fmt(amount)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-secondary">Delivery</dt>
          <dd className="font-semibold tabular-nums text-primary">{fmt(DELIVERY_FEE)}</dd>
        </div>
        <div className="!mt-3 flex items-center justify-between border-t border-primary pt-3">
          <dt className="font-bold text-primary">Total to pay</dt>
          <dd className="text-lg font-extrabold tabular-nums text-primary">
            {fmt(amount + DELIVERY_FEE)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[13px] text-secondary">
        Pay cash when the rider hands it over. No card needed.
      </p>
    </div>
  )
}

/**
 * Delivery window.
 *
 * Deliberately expressed as the standard 2-4 working day window rather than a
 * specific promised date: no courier integration exists yet, and inventing a
 * precise date we cannot honour is exactly the behaviour this brand is
 * positioned against. Becomes a courier-committed date once the integration
 * lands (see docs/marketplace/phase0-decisions.md).
 */
export const DeliveryEstimate = () => (
  <div className="rounded-lg border border-primary bg-secondary p-4">
    <div className="flex gap-3">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-5 w-5 shrink-0 text-action"
        aria-hidden
      >
        <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7zM7.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
      </svg>
      <div>
        <p className="text-sm font-bold text-primary">Arrives in 2 to 4 working days</p>
        <p className="mt-1 text-[13px] leading-relaxed text-secondary">
          Delivered nationwide. You get a tracking number as soon as the seller
          hands it to the courier.
        </p>
      </div>
    </div>
  </div>
)

/* -------------------------------------------------------------- assurance */

const POINTS = [
  { label: "Cash on delivery", detail: "Pay the rider" },
  { label: "7-day returns", detail: "From delivery" },
  { label: "Verified seller", detail: "Identity checked" },
]

export const AssuranceRow = () => (
  <div className="grid grid-cols-3 gap-2">
    {POINTS.map((p) => (
      <div
        key={p.label}
        className="rounded-lg border border-primary bg-component px-2.5 py-3 text-center"
      >
        <p className="text-[12px] font-bold leading-tight text-primary">{p.label}</p>
        <p className="mt-0.5 text-[11px] text-secondary">{p.detail}</p>
      </div>
    ))}
  </div>
)

/* ---------------------------------------------------------------- reviews */

/**
 * Reviews are not wired to data yet, so this states that plainly instead of
 * rendering invented stars. A marketplace that fakes its first reviews has
 * nothing left to be trusted on.
 */
export const ReviewsSection = ({ count = 0 }: { count?: number }) => (
  <section className="border-t border-primary py-10">
    <h2 className="text-xl font-extrabold tracking-tight text-primary">
      Ratings and reviews
    </h2>
    {count === 0 ? (
      <div className="mt-5 rounded-lg border border-primary bg-secondary p-6 text-center">
        <p className="text-sm font-semibold text-primary">No reviews yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-secondary">
          Reviews appear here once buyers have received this item. Only people
          who actually bought it on Bazaar can leave one.
        </p>
      </div>
    ) : null}
  </section>
)

/* ------------------------------------------------------------ description */

export const DescriptionSection = ({
  description,
  attributes,
}: {
  description?: string | null
  attributes?: { id: string; value: string; attribute?: { name: string } }[]
}) => {
  const specs = (attributes ?? []).filter((a) => a.attribute?.name && a.value)
  if (!description && !specs.length) return null

  return (
    <section className="border-t border-primary py-10">
      <div className="grid gap-10 lg:grid-cols-2">
        {description && (
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-primary">
              About this item
            </h2>
            <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-secondary">
              {description}
            </p>
          </div>
        )}
        {specs.length > 0 && (
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-primary">
              Specifications
            </h2>
            <dl className="mt-4 overflow-hidden rounded-lg border border-primary">
              {specs.map((spec, i) => (
                <div
                  key={spec.id}
                  className={`flex gap-4 px-4 py-3 text-sm ${
                    i % 2 ? "bg-component" : "bg-secondary"
                  }`}
                >
                  <dt className="w-2/5 shrink-0 text-secondary">
                    {spec.attribute?.name}
                  </dt>
                  <dd className="font-medium text-primary">{spec.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  )
}
