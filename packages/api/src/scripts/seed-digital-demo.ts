import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createOffersWorkflow } from "@mercurjs/core/workflows";

import { DIGITAL_FULFILMENT_MODULE } from "../modules/digital-fulfilment";

/**
 * A demo digital product with real stock, so the vault can be exercised end to
 * end without a vendor.
 *
 * Creates a PUBG UC listing with no product shipping profile, an offer, and 25
 * codes in the vault.
 *
 * Run:  bun run seed:digital-demo
 */
export default async function seedDigitalDemo({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productModule: any = container.resolve(Modules.PRODUCT);
  const digital: any = container.resolve(DIGITAL_FULFILMENT_MODULE);

  const handle = "pubg-mobile-uc-660";

  const existing = await productModule.listProducts(
    { handle },
    { select: ["id"], take: 1 }
  );
  if (existing.length) {
    logger.info(`Demo digital product already exists (${existing[0].id}).`);
    const { data: offers } = await query.graph({
      entity: "offer",
      fields: ["id"],
      filters: { product_id: existing[0].id },
    });
    if (offers?.[0]) {
      logger.info(
        `  offer ${offers[0].id}, ${await digital.availableStock(offers[0].id)} codes in stock`
      );
    }
    return;
  }

  const { data: types } = await query.graph({
    entity: "product_type",
    fields: ["id", "value"],
    filters: { value: "digital_code" },
  });
  const { data: cats } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
    filters: { name: "PUBG Mobile UC" },
  });

  // No shipping_profile_id. Checkout still works because every seller has the
  // Rs 0 "Instant delivery" option seeded by seed-digital.
  const created = await productModule.createProducts({
    title: "PUBG Mobile 660 UC",
    handle,
    description:
      "660 Unknown Cash for PUBG Mobile, delivered instantly. Redeem in the " +
      "game's UC shop using the code we send you.",
    status: "published",
    type_id: types?.[0]?.id,
    category_ids: cats?.[0]?.id ? [cats[0].id] : undefined,
    options: [{ title: "Denomination", values: ["660 UC"] }],
    variants: [
      {
        title: "660 UC",
        sku: "PUBG-UC-660",
        manage_inventory: false,
        options: { Denomination: "660 UC" },
      },
    ],
  });

  const product = Array.isArray(created) ? created[0] : created;

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "name", "members.id"],
    pagination: { take: 1 },
  });
  const seller = sellers[0];
  const memberId = seller?.members?.[0]?.id;
  if (!memberId) {
    logger.error("No seller member found; run seed:pk first.");
    return;
  }

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
    pagination: { take: 1 },
  });
  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id"],
    pagination: { take: 1 },
  });

  const { result } = await createOffersWorkflow(container).run({
    input: {
      offers: [
        {
          seller_id: seller.id,
          created_by: memberId,
          sku: "OFFER-PUBG-UC-660",
          variant_id: product.variants[0].id,
          // Non-nullable on Mercur's offer model even for digital.
          shipping_profile_id: profiles[0].id,
          inventory_items: [
            {
              sku: "INV-PUBG-UC-660",
              stock_levels: [
                { location_id: locations[0].id, stocked_quantity: 25 },
              ],
            },
          ],
          prices: [{ amount: 1750, currency_code: "pkr" }],
        },
      ],
    },
  });

  const offer = (result as any[])[0];

  // Stock the vault. Obviously fake codes; a real vendor uploads their own.
  const codes = Array.from(
    { length: 25 },
    (_, i) => `PUBG-DEMO-${String(i + 1).padStart(4, "0")}-${randomBlock()}`
  );
  const upload = await digital.uploadCodes({
    sellerId: seller.id,
    offerId: offer.id,
    variantId: product.variants[0].id,
    codes,
  });

  logger.info(
    `Demo digital product ready: product ${product.id}, offer ${offer.id}, ` +
      `${upload.added} codes in the vault for ${seller.name}.`
  );
}

function randomBlock() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}
