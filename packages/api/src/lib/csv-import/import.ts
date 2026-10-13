import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import {
  createProductsWorkflow,
  createOffersWorkflow,
  createProductAttributesWorkflow,
  createProductAttributeValuesWorkflow,
} from "@mercurjs/core/workflows";
import { MercurModules } from "@mercurjs/types";

import { parseCatalogCsv, type ImportRow, type RowError } from "./parse";

export type ImportOutcome = {
  ok: boolean;
  errors: RowError[];
  productsCreated: number;
  offersCreated: number;
  /** Handles that already existed for this seller and were skipped. */
  skippedHandles: string[];
};

/**
 * Turn a validated CSV into products and offers for one seller.
 *
 * Validation runs first and rejects the whole file on any error, so nothing
 * here has to cope with a half-valid batch.
 *
 * Mercur is offer-based: a product is the shared catalogue entry and an offer is
 * a specific seller's listing of a variant, carrying the price, the stock and
 * the seller_id that commission and settlement key off. So every imported row
 * produces both a variant and the offer that makes it buyable.
 */
export async function importCatalogCsv(
  container: any,
  input: {
    sellerId: string;
    memberId: string;
    csv: string;
    /** Dry run: validate and report, write nothing. */
    validateOnly?: boolean;
  }
): Promise<ImportOutcome> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productModule = container.resolve(Modules.PRODUCT);
  const sellerService: any = container.resolve(MercurModules.SELLER);

  // Categories are matched by name, case-insensitively, so a seller does not
  // have to know our internal ids.
  const categories = await productModule.listProductCategories(
    {},
    { select: ["id", "name"], take: 1000 }
  );
  const categoryByName = new Map<string, string>(
    categories.map((c: any) => [String(c.name).toLowerCase(), c.id])
  );

  const parsed = parseCatalogCsv(input.csv, {
    knownCategories: new Set(categoryByName.keys()),
  });

  if (parsed.errors.length) {
    return {
      ok: false,
      errors: parsed.errors,
      productsCreated: 0,
      offersCreated: 0,
      skippedHandles: [],
    };
  }

  if (input.validateOnly) {
    return {
      ok: true,
      errors: [],
      productsCreated: parsed.productCount,
      offersCreated: parsed.rows.length,
      skippedHandles: [],
    };
  }

  // The seller needs somewhere to hold stock and a shipping profile to sell
  // under. Both are created at seller onboarding; failing loudly here beats
  // creating orphan products nobody can buy.
  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id"],
    filters: { id: await sellerStockLocationIds(query, input.sellerId) },
  });
  const stockLocationId = stockLocations?.[0]?.id;
  if (!stockLocationId) {
    throw new Error(
      `Seller ${input.sellerId} has no stock location. Complete seller onboarding before importing.`
    );
  }

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
    filters: { name: "Marketplace Shipping" },
  });
  const shippingProfileId = profiles?.[0]?.id;
  if (!shippingProfileId) {
    throw new Error(
      'No "Marketplace Shipping" profile exists. Run the marketplace seed first.'
    );
  }

  // Group rows into products.
  const groups = new Map<string, ImportRow[]>();
  for (const row of parsed.rows) {
    const bucket = groups.get(row.handle) ?? [];
    bucket.push(row);
    groups.set(row.handle, bucket);
  }

  // Skip handles that already exist rather than duplicating the catalogue.
  // Re-uploading a corrected file is the normal case, not an edge case.
  const handles = [...groups.keys()];
  const existing = await productModule.listProducts(
    { handle: handles },
    { select: ["id", "handle"] }
  );
  const existingHandles = new Set(existing.map((p: any) => p.handle));
  const skippedHandles = handles.filter((h) => existingHandles.has(h));

  const toCreate = [...groups.entries()].filter(([h]) => !existingHandles.has(h));
  if (!toCreate.length) {
    return {
      ok: true,
      errors: [],
      productsCreated: 0,
      offersCreated: 0,
      skippedHandles,
    };
  }

  // Variant axes come from Mercur's product-attribute module, not from native
  // Medusa product options: passing `options` directly is rejected because the
  // workflow injects a `__default__` option of its own.
  //
  // A value is only usable once it is mirrored onto the Medusa product option,
  // and that depends on the AXIS: an attribute with a product_option_id (made
  // by createProductAttributesWorkflow, as seed:pk does) has every new value
  // mirrored by createProductAttributeValuesWorkflow; an attribute without one
  // (made through the module service) never gets a mirrored value, and the
  // product would fail with "Option value X does not exist for option Y".
  // Rows on such an axis are reported as row-level errors rather than
  // half-imported or silently flattened into separate products, which would
  // misrepresent what the seller uploaded. Single-variant rows are unaffected.
  const attributeByName = await ensureVariantAxes(container, toCreate);

  const unsupported: RowError[] = [];
  for (const [handle, rows] of toCreate) {
    for (const row of rows) {
      if (!row.optionName || !row.optionValue) continue;
      const axis = attributeByName.get(row.optionName.toLowerCase());
      if (!axis?.valueIdByName.has(row.optionValue.toLowerCase())) {
        unsupported.push({
          rowNumber: row.rowNumber,
          column: "option_value",
          value: row.optionValue,
          message:
            `variant option "${row.optionName}: ${row.optionValue}" is not available yet. ` +
            `Existing values for "${row.optionName}": ` +
            `${axis ? [...axis.valueIdByName.keys()].join(", ") || "none" : "the axis does not exist"}. ` +
            `Ask support to add it, or upload this product without variants.`,
        });
      }
    }
    void handle;
  }

  if (unsupported.length) {
    return {
      ok: false,
      errors: unsupported,
      productsCreated: 0,
      offersCreated: 0,
      skippedHandles: [],
    };
  }

  const products = toCreate.map(([handle, rows]) => {
    const first = rows[0];
    const images = [...new Set(rows.flatMap((r) => r.images))].map((url) => ({ url }));
    const optionName = first.optionName;

    const base = {
      title: first.title,
      handle,
      description: first.description || first.title,
      status: ProductStatus.PUBLISHED,
      category_ids: [categoryByName.get(first.category.toLowerCase())!],
      ...(images.length ? { thumbnail: images[0].url, images } : {}),
    };

    // Single-variant product with no axis: omit attributes and variant options
    // entirely and let Mercur create its __default__ option.
    if (!optionName) {
      return {
        ...base,
        variants: rows.map((r) => ({ title: first.title, sku: r.sku })),
      };
    }

    const attribute = attributeByName.get(optionName.toLowerCase())!;
    const valueIds = rows
      .map((r) => attribute.valueIdByName.get((r.optionValue ?? "").toLowerCase()))
      .filter((id): id is string => Boolean(id));

    return {
      ...base,
      attributes: [{ id: attribute.id, value_ids: valueIds }],
      variants: rows.map((r) => ({
        title: r.optionValue!,
        sku: r.sku,
        options: { [attribute.name]: r.optionValue! },
      })),
    };
  });

  await createProductsWorkflow(container).run({
    input: { created_by: input.memberId, products: products as any },
  });

  // Re-read to get variant ids, then create one offer per imported row.
  const { data: created } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "variants.id", "variants.sku"],
    filters: { handle: toCreate.map(([h]) => h) },
  });

  const priceBySku = new Map(parsed.rows.map((r) => [r.sku, r]));
  const offers: any[] = [];

  for (const product of created) {
    for (const variant of (product.variants ?? []) as { id: string; sku: string }[]) {
      const row = priceBySku.get(variant.sku);
      if (!row) continue;

      offers.push({
        seller_id: input.sellerId,
        created_by: input.memberId,
        sku: variant.sku,
        variant_id: variant.id,
        shipping_profile_id: shippingProfileId,
        inventory_items: [
          {
            sku: variant.sku,
            stock_levels: [{ location_id: stockLocationId, stocked_quantity: row.stock }],
          },
        ],
        prices: [{ amount: row.pricePkr, currency_code: "pkr" }],
      });
    }
  }

  if (offers.length) {
    await createOffersWorkflow(container).run({ input: { offers } });
  }

  return {
    ok: true,
    errors: [],
    productsCreated: created.length,
    offersCreated: offers.length,
    skippedHandles,
  };
}

type VariantAxis = {
  id: string;
  name: string;
  valueIdByName: Map<string, string>;
};

/**
 * Make sure every option axis in the batch exists as a global variant-axis
 * attribute, with every value the file uses.
 *
 * Attributes are marketplace-wide, not per seller, which is deliberate: two
 * sellers both listing "Size: Medium" should filter together on the storefront.
 * The cost is that one seller's typo becomes everyone's attribute value, so
 * this is a candidate for admin review once seller volume is real.
 */
async function ensureVariantAxes(
  container: any,
  groups: [string, ImportRow[]][]
): Promise<Map<string, VariantAxis>> {
  const attributeModule: any = container.resolve(MercurModules.PRODUCT_ATTRIBUTE);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // The module service does not hydrate `values` via `relations`, it comes back
  // empty. Read through query.graph instead, which is what Mercur's own seed
  // does. Getting this wrong silently yields zero value_ids and the product
  // workflow then rejects every variant.
  const loadAttribute = async (id: string) => {
    const { data } = await query.graph({
      entity: "product_attribute",
      fields: ["id", "name", "handle", "values.id", "values.name", "values.product_option_value_id"],
      filters: { id },
    });
    return data?.[0];
  };

  // Axis name -> the set of values the file needs.
  const needed = new Map<string, Set<string>>();
  for (const [, rows] of groups) {
    for (const row of rows) {
      if (!row.optionName || !row.optionValue) continue;
      const key = row.optionName.toLowerCase();
      const set = needed.get(key) ?? new Set<string>();
      set.add(row.optionValue);
      needed.set(key, set);
    }
  }

  const result = new Map<string, VariantAxis>();
  if (!needed.size) return result;

  const { data: existing } = await query.graph({
    entity: "product_attribute",
    fields: ["id", "name", "handle", "values.id", "values.name", "values.product_option_value_id"],
    filters: { product_id: null },
  });
  const existingByHandle = new Map<string, any>(
    (existing ?? []).map((a: any) => [String(a.handle ?? a.name).toLowerCase(), a])
  );

  for (const [axisKey, values] of needed) {
    const handle = axisKey.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    // Preserve the seller's capitalisation on first creation.
    const displayName =
      groups
        .flatMap(([, rows]) => rows)
        .find((r) => r.optionName?.toLowerCase() === axisKey)!.optionName!;

    let attribute = existingByHandle.get(handle) ?? existingByHandle.get(axisKey);

    if (!attribute) {
      // Must go through the workflow, not the module service. The workflow also
      // creates the mirrored Medusa product option; creating the attribute
      // directly leaves that missing and every variant is then rejected with
      // "Product has 0 option values".
      const { result } = await createProductAttributesWorkflow(container).run({
        input: {
          attributes: [
            {
              name: displayName,
              handle,
              type: "multi_select",
              is_variant_axis: true,
              is_filterable: true,
              values: [...values].map((name, rank) => ({ name, rank })),
            },
          ],
        } as any,
      });
      attribute = Array.isArray(result) ? result[0] : result;
    }

    // Reload so newly created values come back with ids.
    attribute = (await loadAttribute(attribute.id)) ?? attribute;

    // Only values that have been MIRRORED onto the Medusa product option are
    // usable: product creation validates variant options against the mirror,
    // not against the attribute. A value with no product_option_value_id will
    // fail with "Option value X does not exist for option Y".
    const mirrored = (attribute.values ?? []).filter(
      (v: any) => v.product_option_value_id
    );
    const valueIdByName = new Map<string, string>(
      mirrored.map((v: any) => [String(v.name).toLowerCase(), v.id])
    );

    // "Exists on the attribute" and "usable on a product" are different things.
    // Only create values that are absent entirely; a value that exists but is
    // unmirrored must not be recreated (the handle is unique) and is reported
    // as unsupported by the caller.
    const allValueNames = new Set(
      (attribute.values ?? []).map((v: any) => String(v.name).toLowerCase())
    );
    const missingValues = [...values].filter((v) => !allValueNames.has(v.toLowerCase()));
    if (missingValues.length) {
      // Same reason as above: the workflow mirrors each new value onto the
      // Medusa option, the module service does not.
      await createProductAttributeValuesWorkflow(container).run({
        input: {
          attribute_id: attribute.id,
          values: missingValues.map((name, rank) => ({
            name,
            rank: valueIdByName.size + rank,
          })),
        } as any,
      });
      const reloaded = await loadAttribute(attribute.id);
      for (const v of reloaded?.values ?? []) {
        if (!v.product_option_value_id) continue;
        valueIdByName.set(String(v.name).toLowerCase(), v.id);
      }
    }

    result.set(axisKey, {
      id: attribute.id,
      name: attribute.name,
      valueIdByName,
    });
  }

  return result;
}

async function sellerStockLocationIds(query: any, sellerId: string): Promise<string[]> {
  const { data } = await query.graph({
    entity: "seller",
    fields: ["id", "stock_locations.id"],
    filters: { id: sellerId },
  });
  return (data?.[0]?.stock_locations ?? []).map((l: any) => l.id);
}
