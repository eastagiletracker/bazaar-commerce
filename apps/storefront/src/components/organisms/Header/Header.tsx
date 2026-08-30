import { HttpTypes } from "@medusajs/types"

import { listCategories } from "@/lib/data/categories"
import { retrieveCustomer } from "@/lib/data/customer"
import { ChromeHeader } from "./ChromeHeader"

/**
 * Server shell for the chrome header: fetches the customer and the department
 * tree, then hands both to the client component that owns the interactive bits
 * (search, mega menu, cart count).
 */
export const Header = async ({ locale }: { locale: string }) => {
  const user = await retrieveCustomer().catch(() => null)

  const { parentCategories } = (await listCategories({
    query: { include_ancestors_tree: true },
  })) as {
    categories: HttpTypes.StoreProductCategory[]
    parentCategories: HttpTypes.StoreProductCategory[]
  }

  const categories = (parentCategories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    handle: c.handle,
  }))

  return (
    <ChromeHeader
      categories={categories}
      isLoggedIn={Boolean(user)}
      userName={user?.first_name ?? null}
      vendorUrl={process.env.NEXT_PUBLIC_VENDOR_URL || "https://vendor.mercurjs.com"}
      deliverTo="Pakistan"
    />
  )
}
