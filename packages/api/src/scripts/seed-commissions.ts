import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { CommissionRateType, MercurModules } from "@mercurjs/types";
import {
  batchCommissionRulesWorkflow,
  createCommissionRatesWorkflow,
  updateCommissionRatesWorkflow,
} from "@mercurjs/core/workflows";
import { createProductCategoriesWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Pakistan commission configuration.
 *
 * How Mercur resolves a rate for a line item (see CommissionModuleService):
 *   - Rules are grouped by `reference` (the dimension: seller, product_category,
 *     product_type, product_collection, product). A rate matches when EVERY
 *     dimension present has at least one matching rule — AND across dimensions,
 *     OR within one.
 *   - Ties break on specificity (number of distinct dimensions), then on
 *     created_at ASC. So a seller+category rate beats a category-only rate.
 *   - A rate with no rules is the global fallback (`is_default`).
 *   - IMPORTANT: product_category rules match the product's DIRECT categories
 *     only. There is no ancestor walk, so rules must target the leaf categories
 *     products are actually assigned to, not the department above them.
 *
 * Rates below are indicative, benchmarked against Daraz's published seller
 * commissions. They are a commercial decision, not a technical one — confirm
 * before launch. Provincial sales tax on services (SRB/PRA) and s.153
 * withholding are NOT handled here: commission is the gross marketplace fee.
 * Tax is applied at settlement, in the ledger module.
 */

// Leaf categories the demo catalog actually uses, mapped to the rate that
// should govern them. Replace when the real PK assortment lands.
const DEMO_FOOTWEAR_LEAVES = [
  "Slides",
  "Clogs",
  "Flip Flops",
  "High Top",
  "Low Top",
  "Retro",
  "Chelsea Boots",
  "Winter Boots",
  "Work Boots",
  "Running",
  "Football",
  "Basketball",
  "Bags",
  "Headwear",
  "Wallets",
];

// The real Pakistan department tree, seeded now so the Phase 2 importer has
// somewhere to map into. department -> leaf categories.
const PK_DEPARTMENTS: Record<string, string[]> = {
  "Mobiles & Tablets": ["Smartphones", "Tablets", "Mobile Accessories"],
  "Electronics & Appliances": ["Home Appliances", "TV & Audio", "Cameras"],
  "Computers & Accessories": ["Laptops", "Computer Accessories", "Networking"],
  Fashion: ["Men's Fashion", "Women's Fashion", "Kids Fashion", "Footwear", "Watches & Jewellery"],
  "Beauty & Personal Care": ["Makeup", "Skincare", "Fragrances", "Personal Care"],
  "Home & Living": ["Kitchen & Dining", "Furniture", "Home Decor", "Bedding"],
  Groceries: ["Pantry Staples", "Beverages", "Snacks", "Household Supplies"],
  "Health & Nutrition": ["Supplements", "Medical Supplies"],
  "Baby & Toys": ["Baby Care", "Toys & Games"],
  "Books & Stationery": ["Books", "Stationery"],
  "Sports & Outdoor": ["Sports Equipment", "Outdoor & Camping"],
  Automotive: ["Car Accessories", "Motorbike Accessories"],
};

// ILLUSTRATIVE DEFAULTS. These are example rates for a seeded demo catalogue,
// not a recommendation. Commission is a commercial decision that depends on
// your category mix, your competitors and your cost base. Set your own before
// onboarding a real seller.
//
// Commission percentage per department. Low-margin, high-ticket categories sit
// low; impulse and high-margin categories sit high.
const DEPARTMENT_RATES: Record<string, number> = {
  "Mobiles & Tablets": 5,
  "Electronics & Appliances": 6,
  "Computers & Accessories": 6,
  Fashion: 13,
  "Beauty & Personal Care": 13,
  "Home & Living": 11,
  Groceries: 5,
  "Health & Nutrition": 10,
  "Baby & Toys": 11,
  "Books & Stationery": 8,
  "Sports & Outdoor": 11,
  Automotive: 8,
};

const GLOBAL_RATE = 8;

export default async function seedCommissions({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productModule = container.resolve(Modules.PRODUCT);
  const commissionService: any = container.resolve(MercurModules.COMMISSION);

  // ---------------------------------------------------------------- categories
  logger.info("Ensuring Pakistan department tree...");
  const departmentNames = Object.keys(PK_DEPARTMENTS);
  const leafNames = Object.values(PK_DEPARTMENTS).flat();

  // `select` is required: listProductCategories does not return `name` by
  // default, so without it every entry keys the map under `undefined` and the
  // script silently believes no category exists.
  const existing = await productModule.listProductCategories(
    { name: [...departmentNames, ...leafNames, ...DEMO_FOOTWEAR_LEAVES] },
    { select: ["id", "name"] }
  );
  const byName = new Map(existing.map((c) => [c.name, c]));

  const missingDepartments = departmentNames.filter((n) => !byName.has(n));
  if (missingDepartments.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingDepartments.map((name) => ({
          name,
          is_active: true,
          rank: departmentNames.indexOf(name),
        })),
      },
    });
    result.forEach((c) => byName.set(c.name, c));
    logger.info(`  created ${missingDepartments.length} departments`);
  }

  const missingLeaves: { name: string; parent: string; rank: number }[] = [];
  for (const [department, leaves] of Object.entries(PK_DEPARTMENTS)) {
    leaves.forEach((leaf, rank) => {
      if (!byName.has(leaf)) missingLeaves.push({ name: leaf, parent: department, rank });
    });
  }
  if (missingLeaves.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingLeaves.map((l) => ({
          name: l.name,
          is_active: true,
          rank: l.rank,
          parent_category_id: byName.get(l.parent)!.id,
        })),
      },
    });
    result.forEach((c) => byName.set(c.name, c));
    logger.info(`  created ${missingLeaves.length} leaf categories`);
  }

  // ------------------------------------------------------------- global rate
  logger.info(`Setting the global commission to ${GLOBAL_RATE}%...`);
  const [defaultRate] = await commissionService.listCommissionRates(
    { is_default: true },
    { take: 1 }
  );
  if (!defaultRate) {
    throw new Error(
      "No is_default commission rate exists. Mercur seeds one at boot; is the backend running against this database?"
    );
  }
  await updateCommissionRatesWorkflow(container).run({
    input: [
      {
        id: defaultRate.id,
        name: "Global Commission",
        type: CommissionRateType.PERCENTAGE,
        value: GLOBAL_RATE,
        is_enabled: true,
        include_tax: false,
        // We do not take a cut of delivery. Shipping is cost recovery for the
        // seller or the courier, not marketplace revenue.
        include_shipping: false,
      },
    ],
  });

  // --------------------------------------------------------- category rates
  // Existing rates are matched by code so the script is re-runnable.
  const allRates = await commissionService.listCommissionRates({}, { relations: ["rules"] });
  const rateByCode = new Map<string, any>(allRates.map((r: any) => [r.code, r]));

  type PlannedRate = {
    code: string;
    name: string;
    value: number;
    categories: string[];
    sellerId?: string;
  };

  const planned: PlannedRate[] = [];

  for (const [department, leaves] of Object.entries(PK_DEPARTMENTS)) {
    const value = DEPARTMENT_RATES[department];
    // One rate per department, with an OR-rule per leaf inside it.
    planned.push({
      code: `pk-${slug(department)}`,
      name: `${department} commission`,
      value,
      categories: leaves,
    });
  }

  // The demo catalog is footwear, so give it the Fashion rate. Without this the
  // seeded products would silently fall through to the global rate and the
  // category engine would look untested.
  planned.push({
    code: "pk-demo-footwear",
    name: "Demo footwear commission",
    value: DEPARTMENT_RATES["Fashion"],
    categories: DEMO_FOOTWEAR_LEAVES,
  });

  let created = 0;
  let updated = 0;

  for (const plan of planned) {
    const categoryIds = plan.categories
      .map((name) => byName.get(name)?.id)
      .filter((id): id is string => Boolean(id));

    if (!categoryIds.length) {
      logger.warn(`  skipping "${plan.name}": none of its categories exist`);
      continue;
    }

    let rate = rateByCode.get(plan.code);
    if (rate) {
      await updateCommissionRatesWorkflow(container).run({
        input: [
          {
            id: rate.id,
            name: plan.name,
            type: CommissionRateType.PERCENTAGE,
            value: plan.value,
            is_enabled: true,
          },
        ],
      });
      updated += 1;
    } else {
      const { result } = await createCommissionRatesWorkflow(container).run({
        input: [
          {
            name: plan.name,
            code: plan.code,
            type: CommissionRateType.PERCENTAGE,
            value: plan.value,
            is_enabled: true,
            is_default: false,
            include_tax: false,
            include_shipping: false,
          },
        ],
      });
      rate = result[0];
      created += 1;
    }

    // Replace the rule set so re-runs converge instead of accumulating.
    const currentRules = (rate.rules ?? []) as { id: string; reference_id: string }[];
    const wanted = new Set(categoryIds);
    const have = new Set(currentRules.map((r) => r.reference_id));

    const toCreate = categoryIds
      .filter((id) => !have.has(id))
      .map((id) => ({ reference: "product_category", reference_id: id }));
    const toDelete = currentRules.filter((r) => !wanted.has(r.reference_id)).map((r) => r.id);

    if (toCreate.length || toDelete.length) {
      await batchCommissionRulesWorkflow(container).run({
        input: {
          commission_rate_id: rate.id,
          create: toCreate,
          update: [],
          delete: toDelete,
        },
      });
    }
  }

  logger.info(`Commission rates: ${created} created, ${updated} updated.`);

  // ------------------------------------------------- seller promo (2 dimensions)
  // Demonstrates the specificity tie-break: seller + category = 2 dimensions,
  // so this beats the category-only rate for that seller's Slides.
  const sellerService: any = container.resolve(MercurModules.SELLER);
  const [promoSeller] = await sellerService.listSellers({ email: "karachi@bazaar.pk" }, { take: 1 });
  const slidesId = byName.get("Slides")?.id;

  if (promoSeller && slidesId) {
    const code = "pk-launch-promo-karachi";
    let rate = rateByCode.get(code);
    if (!rate) {
      const { result } = await createCommissionRatesWorkflow(container).run({
        input: [
          {
            name: "Launch promo — Karachi Traders slides",
            code,
            type: CommissionRateType.PERCENTAGE,
            value: 4,
            is_enabled: true,
            is_default: false,
            include_tax: false,
            include_shipping: false,
          },
        ],
      });
      rate = result[0];
      await batchCommissionRulesWorkflow(container).run({
        input: {
          commission_rate_id: rate.id,
          create: [
            { reference: "seller", reference_id: promoSeller.id },
            { reference: "product_category", reference_id: slidesId },
          ],
          update: [],
          delete: [],
        },
      });
      logger.info("  created the 2-dimension launch promo rate (seller + category)");
    }
  } else {
    logger.warn("  skipped seller promo: seller or Slides category not found");
  }

  logger.info("Finished seeding commissions.");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
