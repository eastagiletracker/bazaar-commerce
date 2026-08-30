import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { MercurModules } from "@mercurjs/types";
import { importCatalogCsv } from "../lib/csv-import/import";
import {
  CSV_TEMPLATE_EXAMPLE,
  parseCatalogCsv,
  type RowError,
} from "../lib/csv-import/parse";

/**
 * CSV importer validation tests.
 *
 * The behaviour that matters: a malformed file produces row-level errors and
 * imports NOTHING. A partial import leaves a seller unable to tell what landed.
 *
 * Run:  bun run test:csv
 */

let checks = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  console.log(
    `  ${String(checks).padStart(2, "0")}. ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`
  );
  if (!condition) failures.push(label);
}

const has = (errors: RowError[], row: number, column: string, fragment?: string) =>
  errors.some(
    (e) =>
      e.rowNumber === row &&
      e.column === column &&
      (!fragment || e.message.toLowerCase().includes(fragment.toLowerCase()))
  );

export default async function testCsvImport({ container }: ExecArgs) {
  console.log("\nCSV importer test\n");

  const productModule = container.resolve(Modules.PRODUCT);
  const categories = await productModule.listProductCategories(
    {},
    { select: ["id", "name"], take: 500 }
  );
  const known = new Set(categories.map((c: any) => String(c.name).toLowerCase()));
  check("Loaded marketplace categories", known.size > 0, `${known.size} categories`);

  // ------------------------------------------------------------- happy path
  const good = parseCatalogCsv(CSV_TEMPLATE_EXAMPLE, { knownCategories: known });
  check("Template example parses clean", good.errors.length === 0,
    good.errors.map((e) => `r${e.rowNumber} ${e.column}: ${e.message}`).join("; "));
  check("Three rows parsed", good.rows.length === 3, `${good.rows.length} rows`);
  check("Grouped into two products", good.productCount === 2, `${good.productCount} products`);

  // Messy but legal cells Excel actually produces.
  const messy = [
    "handle,sku,title,category,price_pkr,stock,description,brand,images,option_name,option_value",
    'kettle,KTL-1,"Electric Kettle, 1.7L",Home Appliances,"Rs. 3,499",12,,Westpoint,,,',
  ].join("\r\n");
  const messyResult = parseCatalogCsv(messy, { knownCategories: known });
  check("Handles CRLF, quoted commas and 'Rs. 3,499'", messyResult.errors.length === 0,
    messyResult.errors.map((e) => e.message).join("; "));
  check("Price normalised to 3499", messyResult.rows[0]?.pricePkr === 3499,
    String(messyResult.rows[0]?.pricePkr));

  const bom = parseCatalogCsv("﻿" + CSV_TEMPLATE_EXAMPLE, { knownCategories: known });
  check("Strips the Excel BOM", bom.errors.length === 0,
    bom.errors.map((e) => e.message).join("; "));

  // ----------------------------------------------------- malformed: the core
  const malformed = [
    "handle,sku,title,category,price_pkr,stock,description,brand,images,option_name,option_value",
    "good-item,GD-1,A Good Item,Home Decor,1500,10,,,,,",           // row 2 ok
    ",NO-HANDLE,Missing Handle,Home Decor,1500,10,,,,,",            // row 3 no handle
    "bad-price,BP-1,Bad Price,Home Decor,free,10,,,,,",             // row 4 price
    "neg-stock,NS-1,Negative Stock,Home Decor,1500,-5,,,,,",        // row 5 stock
    "unknown-cat,UC-1,Unknown Category,Nonexistent Dept,1500,10,,,,,", // row 6 category
    "good-item,GD-1,A Good Item,Home Decor,1500,10,,,,,",           // row 7 duplicate sku
    "bad-img,BI-1,Bad Image,Home Decor,1500,10,,,not-a-url,,",      // row 8 image
    "Bad Handle,BH-1,Bad Handle,Home Decor,1500,10,,,,,",           // row 9 handle format
    "half-opt,HO-1,Half Option,Home Decor,1500,10,,,,Size,",        // row 10 option pair
  ].join("\n");

  const bad = parseCatalogCsv(malformed, { knownCategories: known });

  check("Malformed file imports NOTHING", bad.rows.length === 0 && bad.productCount === 0,
    `${bad.rows.length} rows, ${bad.productCount} products`);
  check("Errors are row-level, not one blanket failure", bad.errors.length >= 8,
    `${bad.errors.length} errors`);

  check("Row 3 missing handle", has(bad.errors, 3, "handle", "required"));
  check("Row 4 bad price", has(bad.errors, 4, "price_pkr", "number"));
  check("Row 5 negative stock", has(bad.errors, 5, "stock", "negative"));
  check("Row 6 unknown category", has(bad.errors, 6, "category", "unknown"));
  check("Row 7 duplicate sku names the earlier row", has(bad.errors, 7, "sku", "row 2"));
  check("Row 8 bad image URL", has(bad.errors, 8, "images", "url"));
  check("Row 9 bad handle format", has(bad.errors, 9, "handle", "lowercase"));
  check("Row 10 half-specified option", has(bad.errors, 10, "option_value", "option_value"));

  check(
    "Every error names a row, a column and a value",
    bad.errors.every((e) => e.rowNumber > 0 && e.column && typeof e.value === "string")
  );

  // The valid row 2 must NOT sneak through alongside the invalid ones.
  check("A valid row in a bad file is still not imported",
    !bad.rows.some((r) => r.sku === "GD-1"));

  // ------------------------------------------------------ structural errors
  const noHeader = parseCatalogCsv("just,some,random,text\n1,2,3,4", { knownCategories: known });
  check("Missing required columns rejected at the header",
    noHeader.errors.length === 1 && noHeader.errors[0].column.includes("handle"),
    noHeader.errors[0]?.message?.slice(0, 60));

  const empty = parseCatalogCsv("", { knownCategories: known });
  check("Empty file rejected", empty.errors.length === 1 && /empty/i.test(empty.errors[0].message));

  const tooBig = parseCatalogCsv(
    [CSV_TEMPLATE_EXAMPLE.split("\n")[0], ...Array.from({ length: 20 }, (_, i) =>
      `item-${i},SKU-${i},Item ${i},Home Decor,100,1,,,,,`)].join("\n"),
    { knownCategories: known, maxRows: 10 }
  );
  check("Oversized file rejected with the limit stated",
    tooBig.errors.length === 1 && /limit is 10/.test(tooBig.errors[0].message));

  // ------------------------------------------------- variant group coherence
  const incoherent = [
    "handle,sku,title,category,price_pkr,stock,description,brand,images,option_name,option_value",
    "shirt,SH-S,Cotton Shirt,Men's Fashion,2000,5,,,,Size,Small",
    "shirt,SH-M,Cotton Shirtt,Men's Fashion,2000,5,,,,Size,Medium",   // title differs
    "shoes,SHO-1,Runner,Footwear,5000,5,,,,,",
    "shoes,SHO-2,Runner,Footwear,5000,5,,,,,",                        // no option axis
    "cap,CAP-1,Cap,Headwear,900,5,,,,Size,One Size",
    "cap,CAP-2,Cap,Headwear,900,5,,,,Size,One Size",                  // duplicate option value
  ].join("\n");
  const groups = parseCatalogCsv(incoherent, { knownCategories: known });

  check("Variant rows must share a title", has(groups.errors, 3, "title", "same title"));
  check("Multi-row product needs an option axis", has(groups.errors, 4, "option_name", "tell the variants apart"));
  check("Duplicate option value caught", has(groups.errors, 7, "option_value", "two variants"));

  // ------------------------------------------------------- live import
  const sellerService: any = container.resolve(MercurModules.SELLER);
  const [seller] = await sellerService.listSellers({ email: "karachi@bazaar.pk" }, { take: 1 });
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: members } = await query.graph({
    entity: "member",
    fields: ["id"],
    filters: { email: "karachi@bazaar.pk" },
  });

  if (!seller || !members?.[0]) {
    check("Seller available for a live import", false, "run seed:pk first");
  } else {
    const stamp = Date.now().toString(36);
    const header = CSV_TEMPLATE_EXAMPLE.split("\n")[0];

    // Single-variant products: the bulk of Pakistani SME listings, and the
    // shape the importer fully supports today.
    const simpleCsv = [
      header,
      `pk-kettle-${stamp},KTL-${stamp},Electric Kettle 1.7L,Home Appliances,3499,20,Fast boil kettle,Westpoint,,,`,
      `pk-iron-${stamp},IRN-${stamp},Dry Iron 1000W,Home Appliances,2199,35,Non-stick soleplate,Westpoint,,,`,
    ].join("\n");

    const dry = await importCatalogCsv(container, {
      sellerId: seller.id,
      memberId: members[0].id,
      csv: simpleCsv,
      validateOnly: true,
    });
    check("Dry run validates without writing", dry.ok && dry.productsCreated === 2,
      `ok=${dry.ok} products=${dry.productsCreated}`);

    const result = await importCatalogCsv(container, {
      sellerId: seller.id,
      memberId: members[0].id,
      csv: simpleCsv,
    });
    check("Live import created 2 products", result.ok && result.productsCreated === 2,
      `${result.productsCreated} products, ${result.offersCreated} offers, errors: ${result.errors.map((e) => e.message).join("; ")}`);
    check("One offer per row", result.offersCreated === 2, `${result.offersCreated} offers`);

    // Re-uploading a corrected file is the normal case, not an edge case.
    const again = await importCatalogCsv(container, {
      sellerId: seller.id,
      memberId: members[0].id,
      csv: simpleCsv,
    });
    check("Re-importing the same file does not duplicate",
      again.productsCreated === 0 && again.skippedHandles.length === 2,
      `created ${again.productsCreated}, skipped ${again.skippedHandles.length}`);

    // The imported offer must be buyable, priced in PKR, and attributed.
    const { data: offers } = await query.graph({
      entity: "offer",
      fields: ["id", "sku", "seller_id", "prices.amount", "prices.currency_code"],
      filters: { sku: `KTL-${stamp}` },
    });
    const offer = offers?.[0];
    check("Imported offer is attributed to the seller", offer?.seller_id === seller.id);
    check("Imported offer is priced in PKR at the CSV price",
      Number(offer?.prices?.[0]?.amount) === 3499 && offer?.prices?.[0]?.currency_code === "pkr",
      `${offer?.prices?.[0]?.amount} ${offer?.prices?.[0]?.currency_code}`);

    // Known limitation: a variant axis value that is not mirrored onto the
    // Medusa option cannot be used. It must fail loudly and import nothing,
    // never half-import or flatten the variants into separate products.
    const variantCsv = [
      header,
      `pk-kurta-${stamp},KRT-${stamp}-S,Cotton Kurta,Men's Fashion,2499,15,Summer kurta,Bonanza,,Size,Small`,
      `pk-kurta-${stamp},KRT-${stamp}-M,Cotton Kurta,Men's Fashion,2499,18,Summer kurta,Bonanza,,Size,Medium`,
    ].join("\n");

    const variantResult = await importCatalogCsv(container, {
      sellerId: seller.id,
      memberId: members[0].id,
      csv: variantCsv,
    });
    check("Unsupported variant axis value is rejected, not half-imported",
      !variantResult.ok && variantResult.productsCreated === 0,
      `ok=${variantResult.ok} products=${variantResult.productsCreated}`);
    check("Rejection is row-level and names the offending value",
      variantResult.errors.length === 2 &&
        variantResult.errors.every((e) => e.column === "option_value") &&
        variantResult.errors.some((e) => /not available yet/.test(e.message)),
      variantResult.errors[0]?.message?.slice(0, 90));

    const { data: leaked } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: { handle: `pk-kurta-${stamp}` },
    });
    check("Rejected variant product left nothing behind", (leaked ?? []).length === 0);
  }

  console.log("");
  if (failures.length) {
    console.log(`${failures.length} of ${checks} checks FAILED:`);
    failures.forEach((f) => console.log(`  - ${f}`));
    throw new Error(`${failures.length} CSV importer checks failed`);
  }
  console.log(`All ${checks} CSV importer checks passed.\n`);
}
