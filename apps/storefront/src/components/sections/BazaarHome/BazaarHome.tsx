import Image from "next/image"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"

/**
 * Bazaar homepage sections.
 *
 * Structure is modelled on what large marketplaces actually do — announcement
 * bar, hero, category grid, trust strip, product rails, seller recruitment —
 * because those blocks exist for good reasons and shoppers expect them.
 *
 * What is deliberately NOT here, and why:
 *  - no auto-rotating hero carousel. Engagement past the first slide is
 *    negligible, it pushes real content below the fold, and it costs bandwidth
 *    that is expensive on a Pakistani mobile connection.
 *  - no countdown timers. Fake urgency is the fastest way to lose a sceptical
 *    buyer, and this whole brand is a bet on trust.
 *  - no popups or interstitials.
 *  - a deals rail only renders when real markdowns exist. It disappears rather
 *    than manufacturing "deals".
 */

/* ---------------------------------------------------------- announcement */

export const AnnouncementBar = () => (
  <div className="w-full bg-tertiary">
    <div className="container mx-auto flex items-center justify-center gap-x-6 gap-y-1 px-4 py-2 text-center text-xs font-medium text-tertiary sm:text-[13px]">
      <span className="whitespace-nowrap">Cash on delivery across Pakistan</span>
      <span aria-hidden className="hidden opacity-40 sm:inline">•</span>
      <span className="hidden whitespace-nowrap sm:inline">Free delivery over Rs 2,500</span>
      <span aria-hidden className="hidden opacity-40 md:inline">•</span>
      <span className="hidden whitespace-nowrap md:inline">7-day easy returns</span>
    </div>
  </div>
)

/* ---------------------------------------------------------------- hero */

export const BazaarHero = ({ vendorUrl }: { vendorUrl: string }) => (
  <section className="w-full bg-secondary">
    <div className="container mx-auto grid items-center gap-8 px-4 py-10 lg:grid-cols-2 lg:gap-12 lg:py-16">
      <div className="order-2 lg:order-1">
        <span className="inline-flex items-center gap-2 rounded-full bg-deal-subtle px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
          Now delivering nationwide
        </span>

        {/* One clear promise. Marketplaces that open with a discount claim have
            to keep escalating it; a promise about how the service behaves
            does not decay. */}
        <h1 className="mt-4 text-[34px] font-extrabold leading-[1.08] tracking-tight text-primary sm:text-5xl lg:text-[56px]">
          Pakistan&rsquo;s marketplace,
          <br />
          <span className="text-action">without the guesswork.</span>
        </h1>

        <p className="mt-4 max-w-lg text-base leading-relaxed text-secondary sm:text-lg">
          Verified sellers, real delivery dates and cash on delivery on every
          order. You see the full price before you buy, not at checkout.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <LocalizedClientLink
            href="/categories"
            className="inline-flex h-12 items-center justify-center rounded-md bg-action px-7 text-[15px] font-semibold text-action-on-primary transition-colors hover:bg-action-hover"
          >
            Start shopping
          </LocalizedClientLink>
          <a
            href={vendorUrl}
            className="inline-flex h-12 items-center justify-center rounded-md border border-input bg-component px-7 text-[15px] font-semibold text-primary transition-colors hover:bg-component-hover"
          >
            Sell on Bazaar
          </a>
        </div>

        <dl className="mt-9 grid max-w-md grid-cols-3 gap-4 border-t border-primary pt-6">
          {[
            ["12k+", "Products"],
            ["500+", "Verified sellers"],
            ["4.8", "Average rating"],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="text-xl font-extrabold tabular-nums text-primary sm:text-2xl">
                {value}
              </dt>
              <dd className="mt-0.5 text-xs text-secondary">{label}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="order-1 lg:order-2">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-component lg:aspect-[5/4]">
          <Image
            src="/brand/hero-unboxing.png"
            alt="A customer opening a Bazaar parcel at home"
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>
    </div>
  </section>
)

/* ----------------------------------------------------------- trust strip */

const TRUST = [
  {
    title: "Cash on delivery",
    body: "Pay the rider. No card needed, anywhere in Pakistan.",
    icon: (
      <path d="M3 7h18v10H3zM7 12h.01M17 12h.01M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" />
    ),
  },
  {
    title: "Verified sellers only",
    body: "Every shop is identity-checked before it can list.",
    icon: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" />,
  },
  {
    title: "Real delivery dates",
    body: "The date you see is the date the courier committed to.",
    icon: <path d="M3 8h18M7 3v3m10-3v3M5 8h14v13H5zM9 13h6" />,
  },
  {
    title: "7-day returns",
    body: "Not right? Send it back within a week, no argument.",
    icon: <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />,
  },
]

export const TrustStrip = () => (
  <section className="w-full border-y border-primary bg-component">
    <div className="container mx-auto grid grid-cols-2 gap-x-8 gap-y-8 px-4 py-9 lg:grid-cols-4 lg:py-12">
      {TRUST.map((item) => (
        <div key={item.title} className="flex gap-3">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 h-7 w-7 shrink-0 text-action"
            aria-hidden
          >
            {item.icon}
          </svg>
          <div>
            <h3 className="text-[15px] font-bold leading-tight text-primary">
              {item.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">{item.body}</p>
          </div>
        </div>
      ))}
    </div>
  </section>
)

/* -------------------------------------------------------- category grid */

const CATEGORIES = [
  { label: "Mobiles & Tablets", image: "/brand/cat-mobiles.png", href: "/categories" },
  { label: "Computers", image: "/brand/cat-computers.png", href: "/categories" },
  { label: "Fashion", image: "/brand/cat-fashion.png", href: "/categories" },
  { label: "Beauty", image: "/brand/cat-beauty.png", href: "/categories" },
  { label: "Home & Living", image: "/brand/cat-home.png", href: "/categories" },
  { label: "Groceries", image: "/brand/cat-grocery.png", href: "/categories" },
  { label: "Baby & Toys", image: "/brand/cat-baby.png", href: "/categories" },
  { label: "Sports", image: "/brand/cat-sports.png", href: "/categories" },
]

export const CategoryGrid = () => (
  <section className="container mx-auto px-4 py-12 lg:py-16">
    <SectionHead
      title="Shop by category"
      subtitle="Everything from a new phone to this week's groceries."
      href="/categories"
      linkLabel="All categories"
    />

    {/* A grid, not a carousel. Every option is visible at once; horizontal
        hunting hides half the catalogue behind a swipe. */}
    <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
      {CATEGORIES.map((cat) => (
        <LocalizedClientLink
          key={cat.label}
          href={cat.href}
          className="group overflow-hidden rounded-xl border border-primary bg-component transition-shadow hover:shadow-md"
        >
          <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
            <Image
              src={cat.image}
              alt=""
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.05]"
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-4 py-3.5">
            <h3 className="text-[15px] font-semibold leading-tight text-primary">
              {cat.label}
            </h3>
            <span
              aria-hidden
              className="text-secondary transition-transform group-hover:translate-x-0.5"
            >
              &rarr;
            </span>
          </div>
        </LocalizedClientLink>
      ))}
    </div>
  </section>
)

/* ------------------------------------------------------------- banners */

export const DeliveryBanner = () => (
  <section className="container mx-auto px-4 py-6">
    <div className="relative overflow-hidden rounded-2xl bg-tertiary">
      <div className="grid items-center lg:grid-cols-2">
        <div className="order-2 p-8 lg:order-1 lg:p-14">
          <p className="text-xs font-bold uppercase tracking-widest text-tertiary opacity-70">
            Delivery
          </p>
          <h2 className="mt-3 text-2xl font-extrabold leading-tight text-tertiary sm:text-3xl lg:text-4xl">
            2 to 4 days,
            <br />
            to every city we serve.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-tertiary opacity-80">
            We publish the courier&rsquo;s committed date, not an optimistic
            guess. If it slips, you hear it from us first.
          </p>
          <LocalizedClientLink
            href="/categories"
            className="mt-7 inline-flex h-12 items-center justify-center rounded-md bg-component px-7 text-[15px] font-semibold text-primary transition-opacity hover:opacity-90"
          >
            Browse products
          </LocalizedClientLink>
        </div>
        <div className="relative order-1 aspect-[16/10] lg:order-2 lg:aspect-[4/3]">
          <Image
            src="/brand/promo-delivery.png"
            alt="A Bazaar rider handing a parcel to a customer"
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>
    </div>
  </section>
)

export const SellerBanner = ({ vendorUrl }: { vendorUrl: string }) => (
  <section className="container mx-auto px-4 py-6 pb-14">
    <div className="overflow-hidden rounded-2xl border border-primary bg-component">
      <div className="grid items-center lg:grid-cols-2">
        <div className="relative aspect-[16/10] lg:aspect-[4/3]">
          <Image
            src="/brand/promo-sellers.png"
            alt="A seller packing orders in their warehouse"
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
        <div className="p-8 lg:p-14">
          <p className="text-xs font-bold uppercase tracking-widest text-action">
            For sellers
          </p>
          <h2 className="mt-3 text-2xl font-extrabold leading-tight text-primary sm:text-3xl lg:text-4xl">
            Already selling online?
            <br />
            Bring your shop across.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-secondary">
            Connect a Shopify store or upload a spreadsheet and your catalogue
            is live the same day. Commission from 5%, and you see exactly what
            you are owed and when it lands.
          </p>

          <ul className="mt-6 space-y-2.5">
            {[
              "No monthly fee, commission only",
              "Payout tracking down to the individual order",
              "Cash-on-delivery reconciled for you",
            ].map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm text-primary">
                <svg
                  viewBox="0 0 20 20"
                  className="mt-0.5 h-4 w-4 shrink-0 text-action"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zm4 6l-5 5-3-3 1.1-1.1L9 10.3l3.9-3.9z" />
                </svg>
                {point}
              </li>
            ))}
          </ul>

          <a
            href={vendorUrl}
            className="mt-8 inline-flex h-12 items-center justify-center rounded-md bg-action px-7 text-[15px] font-semibold text-action-on-primary transition-colors hover:bg-action-hover"
          >
            Open a seller account
          </a>
        </div>
      </div>
    </div>
  </section>
)

/* -------------------------------------------------------------- shared */

export const SectionHead = ({
  title,
  subtitle,
  href,
  linkLabel,
}: {
  title: string
  subtitle?: string
  href?: string
  linkLabel?: string
}) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 className="text-2xl font-extrabold tracking-tight text-primary sm:text-[28px]">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-2 text-[15px] text-secondary">{subtitle}</p>
      )}
    </div>
    {href && linkLabel && (
      <LocalizedClientLink
        href={href}
        className="text-sm font-semibold text-action hover:underline"
      >
        {linkLabel} &rarr;
      </LocalizedClientLink>
    )}
  </div>
)
