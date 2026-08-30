import { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

/**
 * Move the seeded demo footwear roots under Fashion.
 *
 * MUST go through the product module, not raw SQL. Medusa stores the category
 * tree as a materialised path (`mpath`) alongside `parent_category_id`, and
 * every tree query — including the storefront's descendants tree — reads the
 * mpath. Updating the foreign key directly leaves mpath stale, so the API keeps
 * returning the OLD tree while the database shows the new parent. That is
 * exactly what happened here: the DB had ten children under Fashion and the
 * API returned five.
 *
 * Run: bun run reparent:demo
 */

const DEMO_ROOTS = ["Sandals", "Sneakers", "Boots", "Sport", "Accessories"];

export default async function reparentDemoCategories({ container }: ExecArgs) {
  const productModule = container.resolve(Modules.PRODUCT);

  const all = await productModule.listProductCategories(
    {},
    { select: ["id", "name", "parent_category_id", "mpath"], take: 500 }
  );

  const fashion = all.find(
    (c: any) => c.name === "Fashion" && !c.parent_category_id
  );
  if (!fashion) throw new Error("No top-level Fashion category found");

  const targets = all.filter((c: any) => DEMO_ROOTS.includes(c.name));
  if (!targets.length) {
    console.log("Nothing to reparent.");
    return;
  }

  for (const cat of targets as any[]) {
    if (cat.mpath?.startsWith(`${fashion.id}.`)) {
      console.log(`  ${cat.name}: already correct`);
      continue;
    }

    // Two steps on purpose. The module only rebuilds mpath when it sees
    // parent_category_id actually CHANGE. Raw SQL had already set the foreign
    // key, so assigning the same value again is a no-op and the stale path
    // survives. Detaching to root first forces the recompute.
    if (cat.parent_category_id) {
      await productModule.updateProductCategories(cat.id, {
        parent_category_id: null,
      } as never);
    }
    await productModule.updateProductCategories(cat.id, {
      parent_category_id: fashion.id,
    } as never);
    console.log(`  ${cat.name} -> Fashion`);
  }

  // Prove the path actually moved. A silent no-op here is the whole failure
  // mode this script exists to fix.
  const after = await productModule.listProductCategories(
    { name: [...DEMO_ROOTS, "Slides"] },
    { select: ["id", "name", "parent_category_id", "mpath"], take: 50 }
  );

  let bad = 0;
  for (const cat of after as any[]) {
    const ok = cat.mpath?.includes(fashion.id);
    if (!ok) bad += 1;
    console.log(`  ${ok ? "OK  " : "FAIL"} ${cat.name}  mpath=${cat.mpath}`);
  }

  if (bad) {
    throw new Error(
      `${bad} categor${bad === 1 ? "y" : "ies"} still have an mpath that does not include Fashion`
    );
  }
  console.log("All demo categories reparented, mpath consistent.");
}
