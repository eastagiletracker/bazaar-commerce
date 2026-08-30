"use client"

import { useRouter, useParams } from "next/navigation"
import { useState } from "react"

/**
 * Header search.
 *
 * Submits on Enter to the existing /categories listing with a `query` param.
 * Kept deliberately plain: no autocomplete dropdown yet, because a suggestion
 * list that returns nothing useful is worse than no suggestions, and there is
 * no search index behind this yet to make it useful.
 */
export const HeaderSearch = () => {
  const router = useRouter()
  const params = useParams()
  const locale = (params?.locale as string) || "pk"
  const [value, setValue] = useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = value.trim()
    router.push(q ? `/${locale}/categories?query=${encodeURIComponent(q)}` : `/${locale}/categories`)
  }

  return (
    <form onSubmit={submit} role="search" className="relative w-full">
      <label htmlFor="site-search" className="sr-only">
        Search products
      </label>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
        aria-hidden
      >
        <circle cx="9" cy="9" r="6" />
        <path d="M13.5 13.5L17 17" strokeLinecap="round" />
      </svg>
      <input
        id="site-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search products and brands"
        // h-11 keeps the control at a comfortable tap size, and the border is
        // --border-input (stone-400) so it stays visible in daylight.
        className="h-11 w-full rounded-md border border-input bg-secondary pl-10 pr-24 text-[15px] text-primary outline-none transition-shadow placeholder:text-secondary focus:border-action focus:shadow-focus"
      />
      <button
        type="submit"
        className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded px-4 text-sm font-semibold text-action-on-primary transition-colors"
        style={{ backgroundColor: "rgb(var(--bg-action-primary))" }}
      >
        Search
      </button>
    </form>
  )
}
