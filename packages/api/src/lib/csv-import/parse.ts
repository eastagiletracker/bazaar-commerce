/**
 * CSV catalogue parser and validator.
 *
 * This is the onboarding path that actually reaches Daraz sellers, who sell
 * through Daraz Seller Center and are generally not Shopify merchants. It has
 * to tolerate spreadsheets exported from Excel by people who are not thinking
 * about data hygiene: BOMs, Windows line endings, thousands separators in
 * prices, "Rs." prefixes, smart quotes, and trailing blank rows.
 *
 * Validation is all-or-nothing by design. A partial import leaves a seller
 * unable to tell what landed and what did not, and the support cost of
 * reconciling that by hand is worse than making them fix the file. So every row
 * is validated first and a single bad row rejects the batch, with an error
 * naming the row and column.
 */

export type ImportRow = {
  /** 1-based row number as it appears in the sheet, header included. */
  rowNumber: number;
  handle: string;
  sku: string;
  title: string;
  description: string;
  category: string;
  pricePkr: number;
  stock: number;
  brand?: string;
  images: string[];
  optionName?: string;
  optionValue?: string;
};

export type RowError = {
  rowNumber: number;
  column: string;
  value: string;
  message: string;
};

export type ParseResult = {
  rows: ImportRow[];
  errors: RowError[];
  /** Products after grouping rows by handle. */
  productCount: number;
};

export const REQUIRED_COLUMNS = [
  "handle",
  "sku",
  "title",
  "category",
  "price_pkr",
  "stock",
] as const;

export const OPTIONAL_COLUMNS = [
  "description",
  "brand",
  "images",
  "option_name",
  "option_value",
] as const;

/** The template we hand sellers. */
export const CSV_TEMPLATE_HEADER = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(",");

// Column order must match CSV_TEMPLATE_HEADER exactly:
// handle,sku,title,category,price_pkr,stock,description,brand,images,option_name,option_value
export const CSV_TEMPLATE_EXAMPLE = [
  CSV_TEMPLATE_HEADER,
  "lawn-suit-3pc,LWN-3PC-BLU-S,Unstitched Lawn Suit 3 Piece,Women's Fashion,4500,25,Three piece unstitched lawn,Gul Ahmed,https://example.com/a.jpg,Size,Small",
  "lawn-suit-3pc,LWN-3PC-BLU-M,Unstitched Lawn Suit 3 Piece,Women's Fashion,4500,30,Three piece unstitched lawn,Gul Ahmed,https://example.com/a.jpg,Size,Medium",
  "wireless-earbuds,EAR-BT-BLK,Wireless Bluetooth Earbuds,Mobile Accessories,2999,100,Bluetooth 5.3 earbuds,Audionic,https://example.com/b.jpg,,",
].join("\n");

/**
 * Split one CSV line, honouring quoted fields containing commas.
 * Hand-rolled rather than pulling a dependency: the format we accept is narrow
 * and a parser we control gives better error messages.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

/**
 * Normalise a price cell.
 * Accepts "4500", "4,500", "Rs. 4500", "PKR 4500", "4500.00".
 * Rejects anything else rather than silently coercing to NaN or 0 — a price
 * that quietly becomes zero is a listing sold at no cost.
 */
function parsePrice(raw: string): number | null {
  const cleaned = raw
    .replace(/[ \s]/g, "")
    .replace(/^(rs\.?|pkr|₨)/i, "")
    .replace(/,/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function parseIntStrict(raw: string): number | null {
  const cleaned = raw.replace(/[ \s,]/g, "");
  // Accept a leading minus so a negative value reaches the range check below.
  // Rejecting "-5" as "not a whole number" tells the seller the wrong thing.
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseCatalogCsv(
  content: string,
  options: { knownCategories?: Set<string>; maxRows?: number } = {}
): ParseResult {
  const errors: RowError[] = [];
  const rows: ImportRow[] = [];

  // Strip a UTF-8 BOM: Excel adds one and it corrupts the first header name.
  const text = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((l, i) => i === 0 || l.trim() !== "");

  if (lines.length === 0 || !lines[0].trim()) {
    return {
      rows: [],
      errors: [{ rowNumber: 1, column: "file", value: "", message: "The file is empty" }],
      productCount: 0,
    };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return {
      rows: [],
      errors: [
        {
          rowNumber: 1,
          column: missing.join(", "),
          value: header.join(","),
          message: `Missing required column(s): ${missing.join(", ")}. Expected header: ${CSV_TEMPLATE_HEADER}`,
        },
      ],
      productCount: 0,
    };
  }

  const col = (name: string) => header.indexOf(name);
  const dataLines = lines.slice(1);

  const maxRows = options.maxRows ?? 5000;
  if (dataLines.length > maxRows) {
    return {
      rows: [],
      errors: [
        {
          rowNumber: 1,
          column: "file",
          value: String(dataLines.length),
          message: `File has ${dataLines.length} rows; the limit is ${maxRows}. Split it into smaller files.`,
        },
      ],
      productCount: 0,
    };
  }

  const seenSku = new Map<string, number>();

  dataLines.forEach((line, index) => {
    const rowNumber = index + 2; // header is row 1
    const cells = splitCsvLine(line);
    const get = (name: string) => (cells[col(name)] ?? "").trim();

    const push = (column: string, value: string, message: string) =>
      errors.push({ rowNumber, column, value, message });

    const handle = get("handle").toLowerCase();
    const sku = get("sku");
    const title = get("title");
    const category = get("category");
    const priceRaw = get("price_pkr");
    const stockRaw = get("stock");

    if (!handle) push("handle", handle, "handle is required; rows sharing a handle become one product");
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(handle))
      push("handle", handle, "handle may only contain lowercase letters, numbers and hyphens");

    if (!sku) push("sku", sku, "sku is required");
    else if (seenSku.has(sku))
      push("sku", sku, `duplicate sku, already used on row ${seenSku.get(sku)}`);
    else seenSku.set(sku, rowNumber);

    if (!title) push("title", title, "title is required");
    else if (title.length > 250) push("title", title, "title must be 250 characters or fewer");

    if (!category) push("category", category, "category is required");
    else if (options.knownCategories && !options.knownCategories.has(category.toLowerCase()))
      push(
        "category",
        category,
        "unknown category; use one from the marketplace category list"
      );

    const price = parsePrice(priceRaw);
    if (price === null)
      push("price_pkr", priceRaw, "price must be a number, for example 4500 or 4,500 or Rs. 4500");
    else if (price <= 0) push("price_pkr", priceRaw, "price must be greater than zero");
    else if (price > 10_000_000)
      push("price_pkr", priceRaw, "price looks wrong; over PKR 10,000,000");

    const stock = parseIntStrict(stockRaw);
    if (stock === null) push("stock", stockRaw, "stock must be a whole number");
    else if (stock < 0) push("stock", stockRaw, "stock cannot be negative");

    const images = get("images")
      .split(/[|;]/)
      .map((u) => u.trim())
      .filter(Boolean);
    for (const url of images) {
      if (!/^https?:\/\//i.test(url))
        push("images", url, "image must be a full http(s) URL");
    }

    const optionName = get("option_name") || undefined;
    const optionValue = get("option_value") || undefined;
    if (optionName && !optionValue)
      push("option_value", "", `option_name "${optionName}" needs an option_value`);
    if (optionValue && !optionName)
      push("option_name", "", `option_value "${optionValue}" needs an option_name`);

    if (price !== null && stock !== null && handle && sku && title && category) {
      rows.push({
        rowNumber,
        handle,
        sku,
        title,
        description: get("description"),
        category,
        pricePkr: price,
        stock,
        brand: get("brand") || undefined,
        images,
        optionName,
        optionValue,
      });
    }
  });

  // Rows sharing a handle must agree on the fields that belong to the product
  // rather than the variant, otherwise the import is ambiguous.
  const byHandle = new Map<string, ImportRow[]>();
  for (const row of rows) {
    const bucket = byHandle.get(row.handle) ?? [];
    bucket.push(row);
    byHandle.set(row.handle, bucket);
  }

  for (const [handle, group] of byHandle) {
    const first = group[0];
    for (const row of group.slice(1)) {
      if (row.title !== first.title)
        errors.push({
          rowNumber: row.rowNumber,
          column: "title",
          value: row.title,
          message: `rows sharing handle "${handle}" must have the same title (row ${first.rowNumber} says "${first.title}")`,
        });
      if (row.category !== first.category)
        errors.push({
          rowNumber: row.rowNumber,
          column: "category",
          value: row.category,
          message: `rows sharing handle "${handle}" must have the same category (row ${first.rowNumber} says "${first.category}")`,
        });
    }

    // A multi-row product is a variant group, so it needs an option axis.
    if (group.length > 1) {
      const missingOption = group.filter((r) => !r.optionName || !r.optionValue);
      for (const row of missingOption) {
        errors.push({
          rowNumber: row.rowNumber,
          column: "option_name",
          value: "",
          message: `handle "${handle}" has ${group.length} rows, so each needs option_name and option_value to tell the variants apart`,
        });
      }
      // Flag the repeat, not the first legitimate use of the value.
      const seenValues = new Set<string>();
      for (const row of group) {
        if (!row.optionValue) continue;
        if (seenValues.has(row.optionValue)) {
          errors.push({
            rowNumber: row.rowNumber,
            column: "option_value",
            value: row.optionValue,
            message: `handle "${handle}" has two variants with option_value "${row.optionValue}"`,
          });
        }
        seenValues.add(row.optionValue);
      }
    }
  }

  return {
    rows: errors.length ? [] : rows,
    errors,
    productCount: errors.length ? 0 : byHandle.size,
  };
}
