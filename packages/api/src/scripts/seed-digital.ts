import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { CommissionRateType, MercurModules } from "@mercurjs/types";
import {
  batchCommissionRulesWorkflow,
  createCommissionRatesWorkflow,
} from "@mercurjs/core/workflows";
import { createProductCategoriesWorkflow } from "@medusajs/medusa/core-flows";
import { createSellerShippingOptionsWorkflow } from "@mercurjs/core/workflows";

/**
 * Digital products and services: categories, fulfilment types, commission and
 * the delivery option that lets a digital cart check out.
 *
 * Run after seed-pk and seed-commissions:
 *   bun run seed:digital
 *
 * See docs/marketplace/digital-products.md for why these categories and not
 * others, and which of them we are not legally allowed to sell.
 */

// ---------------------------------------------------------------- categories

/**
 * Departments and their leaves.
 *
 * Leaves matter more than they look: Mercur's commission engine matches a
 * product's DIRECT categories with no ancestor walk, so a rate attached to
 * "Digital Goods" would never fire on a product filed under "Game Credits".
 * Every rate below targets leaves for that reason.
 */
const DIGITAL_DEPARTMENTS: Record<string, string[]> = {
  "Game Credits & Top-ups": [
    "PUBG Mobile UC",
    "Free Fire Diamonds",
    "Roblox & Steam",
    "Other Game Credits",
  ],
  "Mobile Load & Bundles": [
    "Jazz",
    "Zong",
    "Telenor",
    "Ufone",
  ],
  "Entertainment & Subscriptions": [
    "Streaming Gift Cards",
    "Music & Audio",
    "Cinema & Event Tickets",
  ],
  "Software & Security": [
    "Antivirus & Security",
    "Productivity & Design",
    "AI Tools",
  ],
  "Learning & Test Prep": [
    "MDCAT & ECAT",
    "CSS & Competitive Exams",
    "Online Courses",
    "Quran & Islamic Learning",
  ],
  "Bill Payments": [
    "Electricity",
    "Gas & Water",
    "Internet & Landline",
  ],
  "eSIM & Travel": [
    "Umrah & Hajj eSIM",
    "International eSIM",
    "Travel Insurance",
  ],
  "Gift Cards & Vouchers": [
    "Shopping Gift Cards",
    "Food & Dining Vouchers",
    "Beauty & Wellness Vouchers",
  ],
  "Home Services": [
    "AC Service & Repair",
    "Home Cleaning",
    "Electrician & Plumber",
    "Pest Control",
  ],
  "Insurance & Financial": [
    "Motor Insurance",
    "Health & Takaful",
    "Credit Cards",
    "Personal Loans",
  ],
};

/**
 * Commission per department. ILLUSTRATIVE DEFAULTS, not a recommendation.
 *
 * These are far below the physical rates and that is not generosity, it is
 * arithmetic. A game-credit reseller works on 3-8% gross, so an 8% marketplace
 * fee is more than their entire margin and they simply would not list. Getting
 * this wrong does not produce complaints, it produces silence.
 *
 * The reverse holds at the other end: eSIM and vouchers carry real margin and
 * can support a normal rate.
 */
const DIGITAL_RATES: Record<string, number> = {
  "Game Credits & Top-ups": 4,
  // Operator load is close to zero-margin everywhere in the world. We take
  // almost nothing; it is here for weekly repeat visits, not for revenue.
  "Mobile Load & Bundles": 1.5,
  "Entertainment & Subscriptions": 6,
  "Software & Security": 10,
  "Learning & Test Prep": 15,
  // A fixed fee per bill would be the right shape. The engine is percentage
  // based, so this approximates it and should be revisited.
  "Bill Payments": 1,
  "eSIM & Travel": 15,
  "Gift Cards & Vouchers": 8,
  "Home Services": 15,
  // Lead generation: the buyer pays nothing and the partner pays us a bounty.
  // Percentage commission on a zero-rupee order is meaningless, so this is 0
  // and the money is booked separately. See the doc.
  "Insurance & Financial": 0,
};

/**
 * Product types encode HOW a thing is delivered, which is the only distinction
 * the system actually needs to act on. Categories are for browsing; types are
 * for fulfilment.
 *
 * Usefully, Mercur's commission engine can already scope a rate by product
 * type, so "all top-ups at 1.5% regardless of which operator" is configuration
 * rather than code.
 */
const PRODUCT_TYPES: { value: string; description: string }[] = [
  {
    value: "digital_code",
    description:
      "A secret we hold and hand over once: a voucher code, a game PIN, a licence key. Delivered instantly from stock.",
  },
  {
    value: "digital_topup",
    description:
      "Credit applied to an account the buyer names, such as a game ID or a mobile number. Needs an identifier at checkout and a vendor or operator API to fulfil.",
  },
  {
    value: "voucher",
    description:
      "Redeemed in person at a merchant. Carries an expiry and needs a redemption endpoint so it cannot be used twice.",
  },
  {
    value: "service_booking",
    description:
      "Prepaid service where the provider contacts the buyer to arrange a time. Deliberately not a scheduling engine.",
  },
  {
    value: "lead",
    description:
      "Regulated referral: insurance and banking. The buyer pays nothing, we pass a consented enquiry to a licensed partner, the partner pays us.",
  },
];

export default async function seedDigital({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModule = container.resolve(Modules.PRODUCT);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const commissionService: any = container.resolve(MercurModules.COMMISSION);

  // ------------------------------------------------------------- categories
  logger.info("Seeding digital categories...");

  const departmentNames = Object.keys(DIGITAL_DEPARTMENTS);
  const leafNames = Object.values(DIGITAL_DEPARTMENTS).flat();

  // `select` is required. listProductCategories omits `name` by default, so
  // without it every entry keys the map under undefined and the script decides
  // nothing exists yet. Same trap as seed-commissions.
  const existing = await productModule.listProductCategories(
    { name: [...departmentNames, ...leafNames] },
    { select: ["id", "name", "parent_category_id"] }
  );
  const byName = new Map(existing.map((c) => [c.name, c]));

  // Digital departments start after the physical ones so navigation order is
  // stable and physical stays first.
  const rankOffset = 20;

  const missingDepartments = departmentNames.filter((n) => !byName.has(n));
  if (missingDepartments.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingDepartments.map((name) => ({
          name,
          is_active: true,
          rank: rankOffset + departmentNames.indexOf(name),
        })),
      },
    });
    result.forEach((c: any) => byName.set(c.name, c));
    logger.info(`  created ${result.length} departments`);
  }

  const missingLeaves: any[] = [];
  for (const dept of departmentNames) {
    const parent = byName.get(dept);
    if (!parent) continue;
    DIGITAL_DEPARTMENTS[dept].forEach((leaf, rank) => {
      if (byName.has(leaf)) return;
      missingLeaves.push({
        name: leaf,
        is_active: true,
        rank,
        parent_category_id: parent.id,
      });
    });
  }

  if (missingLeaves.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: missingLeaves },
    });
    result.forEach((c: any) => byName.set(c.name, c));
    logger.info(`  created ${result.length} leaf categories`);
  }

  // ----------------------------------------------------------- product types
  logger.info("Seeding digital product types...");

  // The filter takes an array at runtime, which the published types do not
  // admit. Verified working: a re-run finds all five and creates none.
  const existingTypes = await productModule.listProductTypes(
    { value: PRODUCT_TYPES.map((t) => t.value) } as never,
    { select: ["id", "value"] }
  );
  const haveTypes = new Set(existingTypes.map((t) => t.value));
  const newTypes = PRODUCT_TYPES.filter((t) => !haveTypes.has(t.value));

  if (newTypes.length) {
    await productModule.createProductTypes(
      newTypes.map((t) => ({
        value: t.value,
        metadata: { description: t.description },
      }))
    );
    logger.info(`  created ${newTypes.length} product types`);
  }

  // ------------------------------------------------------------- commission
  logger.info("Seeding digital commission rates...");

  let ratesCreated = 0;
  for (const [dept, percent] of Object.entries(DIGITAL_RATES)) {
    const leaves = DIGITAL_DEPARTMENTS[dept]
      .map((n) => byName.get(n))
      .filter(Boolean) as any[];
    if (!leaves.length) continue;

    const code = `pk-digital-${slug(dept)}`;

    const existingRates = await commissionService.listCommissionRates(
      { code } as any,
      { take: 1 }
    );
    if (existingRates.length) continue;

    // Shape copied from seed-commissions: an ARRAY input, `value` not
    // `percentage_rate`, and `code` is required. Getting it wrong fails deep
    // inside MikroORM with a stack that names none of those.
    const { result } = await createCommissionRatesWorkflow(container).run({
      input: [
        {
          name: dept,
          code,
          type: CommissionRateType.PERCENTAGE,
          value: percent,
          is_enabled: true,
          is_default: false,
          include_tax: false,
          include_shipping: false,
        },
      ],
    });

    const rate = (result as any[])[0];

    await batchCommissionRulesWorkflow(container).run({
      input: {
        commission_rate_id: rate.id,
        create: leaves.map((leaf) => ({
          reference: "product_category",
          reference_id: leaf.id,
        })),
        update: [],
        delete: [],
      },
    });

    ratesCreated += 1;
    logger.info(`  ${dept.padEnd(32)} ${percent}%  (${leaves.length} leaves)`);
  }
  logger.info(`  created ${ratesCreated} commission rates`);

  // -------------------------------------------------------- instant delivery
  //
  // Mercur hardcodes requires_shipping: true on every cart line item, in
  // apps/.../store/carts/[id]/line-items/route.ts. So a digital cart WILL demand
  // a shipping method however the product is configured: no product shipping
  // profile, no inventory shipping flag, none of it makes any difference.
  //
  // Rather than fork that route, give digital something free to select. The
  // buyer sees "Instant delivery, Rs 0", which is a better checkout line than
  // anything a fork would have produced.
  logger.info("Ensuring an Instant delivery option per seller...");

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "name"],
  });

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
    pagination: { take: 1 },
  });

  const { data: zones } = await query.graph({
    entity: "service_zone",
    fields: ["id", "name"],
  });

  const { data: existingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name"],
  });
  const alreadyHave = new Set(
    existingOptions.filter((o: any) => o.name === INSTANT_NAME).map(() => true)
  );

  let optionsCreated = 0;
  for (const seller of sellers) {
    // The seller's own zone, matched by the naming the PK seed uses.
    const zone = zones.find((z: any) =>
      String(z.name ?? "").startsWith(seller.name)
    );
    if (!zone) {
      logger.warn(`  ${seller.name}: no service zone, skipping`);
      continue;
    }

    const { data: sellerOptions } = await query.graph({
      entity: "shipping_option",
      fields: ["id", "name", "service_zone_id"],
      filters: { service_zone_id: zone.id },
    });
    if (sellerOptions.some((o: any) => o.name === INSTANT_NAME)) continue;

    await createSellerShippingOptionsWorkflow(container).run({
      input: {
        seller_id: seller.id,
        shipping_options: [
          {
            name: INSTANT_NAME,
            price_type: "flat",
            provider_id: "manual_manual",
            service_zone_id: zone.id,
            shipping_profile_id: profiles[0].id,
            type: {
              label: "Instant",
              description: "Sent to your phone straight away.",
              code: "instant",
            },
            prices: [{ currency_code: "pkr", amount: 0 }],
            rules: [
              { attribute: "enabled_in_store", value: "true", operator: "eq" },
              { attribute: "is_return", value: "false", operator: "eq" },
              // A `cart_kind = digital` rule belongs here and is NOT here yet.
              // See src/workflows/hooks/shipping-options-context.ts for why,
              // and docs/marketplace/multi-vendor-orders.md for the launch
              // blocker it leaves open.
            ],
          },
        ],
      },
    });
    optionsCreated += 1;
  }
  logger.info(`  created ${optionsCreated} Instant delivery options`);

  logger.info("Finished seeding digital categories.");
  if (alreadyHave.size) {
    logger.info("(some Instant delivery options already existed)");
  }
}

const INSTANT_NAME = "Instant delivery";

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
