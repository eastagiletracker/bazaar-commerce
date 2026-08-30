"use client"

import Image from "next/image"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { useCartContext } from "@/components/providers"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"

/**
 * Marketplace chrome header.
 *
 * Modelled on Amazon's, because that layout is the most rehearsed navigation
 * pattern in e-commerce and a first-time Pakistani buyer reads it as "a real
 * marketplace" before reading a single word. Familiarity is worth more here
 * than novelty: the objection this business has to overcome is trust, and an
 * unfamiliar header spends trust rather than earning it.
 *
 * Structure:
 *   row 1 (dark)  logo · deliver-to · search with scope · language · account ·
 *                 orders · cart
 *   row 2 (mid)   "All" mega menu · shortcut links
 *
 * Sticky, because search is the primary navigation on a marketplace and it
 * should never be more than a glance away.
 *
 * Mobile collapses to: hamburger · logo · account · cart / search / deliver-to,
 * which is Amazon's mobile stack and for the same reason — the search field
 * needs the full width to be usable at 360px.
 */

type Category = { id: string; name: string; handle: string }

const SCOPES = [
  "All",
  "Mobiles & Tablets",
  "Electronics",
  "Fashion",
  "Beauty",
  "Home & Living",
  "Groceries",
]

export const ChromeHeader = ({
  categories,
  isLoggedIn,
  userName,
  vendorUrl,
  deliverTo = "Pakistan",
}: {
  categories: Category[]
  isLoggedIn: boolean
  userName?: string | null
  vendorUrl: string
  deliverTo?: string
}) => {
  const router = useRouter()
  const params = useParams()
  const locale = (params?.locale as string) || "pk"

  const { cart } = useCartContext()
  const cartCount = cart?.items?.reduce((n, i) => n + i.quantity, 0) ?? 0

  const [query, setQuery] = useState("")
  const [scope, setScope] = useState("All")
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileSearchFocused, setMobileSearchFocused] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Escape closes the mega menu. A full-screen overlay with no keyboard exit
  // is a trap for anyone not using a mouse.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false)
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [menuOpen])

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    const parts = [q && `query=${encodeURIComponent(q)}`, scope !== "All" && `scope=${encodeURIComponent(scope)}`]
      .filter(Boolean)
      .join("&")
    router.push(`/${locale}/categories${parts ? `?${parts}` : ""}`)
  }

  return (
    <header className="sticky top-0 z-50" data-testid="header">
      {/* ------------------------------------------------------------ row 1 */}
      <div className="bg-chrome text-white">
        <div className="mx-auto flex h-auto max-w-[1500px] flex-wrap items-center gap-x-1 gap-y-2 px-2 py-2 lg:h-[60px] lg:flex-nowrap lg:gap-x-2 lg:px-4 lg:py-0">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="rounded-sm border border-transparent p-2 hover:border-white/60 lg:hidden"
          >
            <BurgerIcon />
          </button>

          <LocalizedClientLink
            href="/"
            aria-label="Bazaar home"
            className="shrink-0 rounded-sm border border-transparent px-2 py-1.5 hover:border-white/60"
            data-testid="header-logo-link"
          >
            <Image
              src="/brand/logo-light.svg"
              width={116}
              height={28}
              alt="Bazaar"
              priority
              className="h-6 w-auto lg:h-7"
            />
          </LocalizedClientLink>

          {/* Deliver-to. On a COD marketplace the destination changes what is
              available and what delivery costs, so it belongs in the chrome. */}
          <button
            type="button"
            className="hidden shrink-0 items-center gap-1 rounded-sm border border-transparent px-2 py-1.5 text-left hover:border-white/60 lg:flex"
          >
            <PinIcon />
            <span className="leading-tight">
              <span className="block text-[11px] text-white/70">Deliver to</span>
              <span className="block text-[13px] font-bold">{deliverTo}</span>
            </span>
          </button>

          {/* Search: the widest thing on the row, with a scope selector. */}
          <form
            onSubmit={submitSearch}
            role="search"
            // basis-full forces its own row on mobile. Without it flex-1 just
            // shrinks the field to a few characters wide instead of wrapping.
            className="order-last flex h-10 w-full min-w-0 flex-1 basis-full overflow-hidden rounded-md focus-within:ring-2 focus-within:ring-action lg:order-none lg:basis-auto lg:h-[40px]"
          >
            <label htmlFor="scope" className="sr-only">
              Search category
            </label>
            <select
              id="scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="hidden max-w-[130px] shrink-0 cursor-pointer border-r border-neutral-300 bg-[rgb(var(--neutral-50))] px-2 text-xs text-primary outline-none sm:block"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label htmlFor="q" className="sr-only">
              Search products
            </label>
            <input
              id="q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setMobileSearchFocused(true)}
              onBlur={() => setMobileSearchFocused(false)}
              placeholder="Search Bazaar"
              className="min-w-0 flex-1 bg-white px-3 text-[15px] text-primary outline-none placeholder:text-secondary"
            />
            <button
              type="submit"
              aria-label="Search"
              className="grid w-11 shrink-0 place-items-center bg-action text-action-on-primary hover:bg-action-hover"
            >
              <SearchIcon />
            </button>
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 lg:gap-1">
            <Link
              href={`/${locale === "pk" ? "ur" : "pk"}`}
              className="hidden items-center gap-1 rounded-sm border border-transparent px-2 py-1.5 text-[13px] font-bold hover:border-white/60 lg:flex"
              aria-label="Switch language"
            >
              <GlobeIcon />
              {locale === "ur" ? "اردو" : "EN"}
            </Link>

            <LocalizedClientLink
              href={isLoggedIn ? "/user" : "/login"}
              className="rounded-sm border border-transparent px-2 py-1.5 leading-tight hover:border-white/60"
            >
              <span className="hidden text-[11px] text-white/70 lg:block">
                {isLoggedIn ? `Hello, ${userName ?? "you"}` : "Hello, sign in"}
              </span>
              <span className="hidden text-[13px] font-bold lg:block">Account</span>
              <span className="lg:hidden">
                <UserIcon />
              </span>
            </LocalizedClientLink>

            <LocalizedClientLink
              href="/user/orders"
              className="hidden rounded-sm border border-transparent px-2 py-1.5 leading-tight hover:border-white/60 lg:block"
            >
              <span className="block text-[11px] text-white/70">Returns</span>
              <span className="block text-[13px] font-bold">&amp; Orders</span>
            </LocalizedClientLink>

            <LocalizedClientLink
              href="/cart"
              className="flex items-end gap-1 rounded-sm border border-transparent px-2 py-1.5 hover:border-white/60"
              aria-label={`Basket, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
            >
              <span className="relative">
                <BasketIcon />
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[13px] font-bold text-action">
                  {cartCount}
                </span>
              </span>
              <span className="hidden text-[13px] font-bold lg:block">Basket</span>
            </LocalizedClientLink>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ row 2 */}
      <div className="bg-chrome-sub text-white">
        <div className="mx-auto flex max-w-[1500px] items-center gap-1 overflow-x-auto px-2 scrollbar-hide lg:px-4">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="hidden shrink-0 items-center gap-1.5 rounded-sm border border-transparent px-2 py-2 text-[14px] font-bold hover:border-white/60 lg:flex"
          >
            <BurgerIcon />
            All
          </button>

          {categories.slice(0, 8).map((cat) => (
            <LocalizedClientLink
              key={cat.id}
              href={`/categories/${cat.handle}`}
              className="shrink-0 whitespace-nowrap rounded-sm border border-transparent px-2.5 py-2 text-[14px] hover:border-white/60"
            >
              {cat.name}
            </LocalizedClientLink>
          ))}

          <a
            href={vendorUrl}
            className="ml-auto hidden shrink-0 whitespace-nowrap rounded-sm border border-transparent px-2.5 py-2 text-[14px] font-semibold hover:border-white/60 lg:block"
          >
            Sell on Bazaar
          </a>
        </div>
      </div>

      {/* Deliver-to gets its own strip on mobile, where row 1 has no space. */}
      <div className="flex items-center gap-1.5 bg-chrome-hover px-3 py-1.5 text-[13px] text-white lg:hidden">
        <PinIcon />
        <span>
          Deliver to <span className="font-bold">{deliverTo}</span>
        </span>
      </div>

      {/* ------------------------------------------------------- mega menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="All categories">
          <button
            className="absolute inset-0 bg-black/60"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={menuRef}
            className="absolute inset-y-0 left-0 w-[85%] max-w-sm overflow-y-auto bg-white shadow-lg"
          >
            <div className="flex items-center gap-3 bg-chrome-sub px-5 py-4 text-white">
              <UserIcon />
              <p className="text-[17px] font-bold">
                {isLoggedIn ? `Hello, ${userName ?? "you"}` : "Hello, sign in"}
              </p>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="ml-auto text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            <nav className="py-2">
              <p className="px-5 pb-1 pt-4 text-[17px] font-bold text-primary">
                Shop by category
              </p>
              {categories.map((cat) => (
                <LocalizedClientLink
                  key={cat.id}
                  href={`/categories/${cat.handle}`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between px-5 py-3 text-[15px] text-primary hover:bg-component-secondary"
                >
                  {cat.name}
                  <span aria-hidden className="text-secondary">
                    &rsaquo;
                  </span>
                </LocalizedClientLink>
              ))}

              <div className="my-2 h-px bg-[rgb(var(--border-primary))]" />

              <p className="px-5 pb-1 pt-3 text-[17px] font-bold text-primary">Help &amp; settings</p>
              <LocalizedClientLink
                href="/user"
                onClick={() => setMenuOpen(false)}
                className="block px-5 py-3 text-[15px] text-primary hover:bg-component-secondary"
              >
                Your account
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/user/orders"
                onClick={() => setMenuOpen(false)}
                className="block px-5 py-3 text-[15px] text-primary hover:bg-component-secondary"
              >
                Your orders
              </LocalizedClientLink>
              <a href={vendorUrl} className="block px-5 py-3 text-[15px] text-primary hover:bg-component-secondary">
                Sell on Bazaar
              </a>
              <Link
                href={`/${locale === "pk" ? "ur" : "pk"}`}
                className="block px-5 py-3 text-[15px] text-primary hover:bg-component-secondary"
              >
                {locale === "ur" ? "English" : "اردو میں دیکھیں"}
              </Link>
            </nav>
          </div>
        </div>
      )}

      {/* Screen-reader-only status so the mobile search focus state is not a
          purely visual affordance. */}
      <span className="sr-only" aria-live="polite">
        {mobileSearchFocused ? "Search focused" : ""}
      </span>
    </header>
  )
}

/* ------------------------------------------------------------------ icons */
/* Inline SVG rather than an icon font: a handful of bytes, no extra request,
   and no flash of missing glyphs on a slow connection. */

const BurgerIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
    <circle cx="9" cy="9" r="6" />
    <path d="M13.5 13.5L18 18" strokeLinecap="round" />
  </svg>
)

const PinIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden>
    <path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
  </svg>
)

const UserIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0116 0" strokeLinecap="round" />
  </svg>
)

const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
  </svg>
)

const BasketIcon = () => (
  <svg viewBox="0 0 32 26" className="h-7 w-8" fill="currentColor" aria-hidden>
    <path d="M3 4h4l3.2 11.5A2.5 2.5 0 0012.6 17H24a2.5 2.5 0 002.4-1.8L29 7H9" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="13" cy="22" r="2" />
    <circle cx="24" cy="22" r="2" />
  </svg>
)
