import { ExecArgs } from "@medusajs/framework/types";

import { DIGITAL_FULFILMENT_MODULE } from "../modules/digital-fulfilment";

/**
 * Print the buyer's reveal link for the most recent digital delivery.
 *
 * A development tool. In production the link only ever reaches the buyer's
 * phone, and the token is not recoverable from the database, so there is no way
 * to look one up by hand.
 *
 * Run:  bun run digital:link
 */
export default async function digitalLink({ container }: ExecArgs) {
  const digital: any = container.resolve(DIGITAL_FULFILMENT_MODULE);

  const [d] = await digital.listDigitalDeliveries({} as any, {
    take: 1,
    order: { created_at: "DESC" },
  });

  if (!d) {
    console.log("\n  No digital deliveries yet. Place an order first.\n");
    return;
  }

  const stock = d.offer_id ? await digital.availableStock(d.offer_id) : "?";
  const base = (process.env.STOREFRONT_URL ?? "http://localhost:3100").replace(/\/$/, "");
  const token = await digital.issueToken(d.id);

  console.log(`
  order        ${d.order_id}
  line         ${d.order_line_id}
  type         ${d.product_type}
  amount       ${d.currency_code.toUpperCase()} ${Number(d.amount).toLocaleString("en-PK")}
  status       ${d.status}
  fraud        ${d.fraud_decision ?? "not assessed"} (score ${d.fraud_score})
  reasons      ${(d.fraud_reasons ?? []).join("\n               ")}
  revealed     ${d.first_revealed_at ? `yes, ${d.reveal_count} time(s)` : "not yet"}
  refundable   ${d.first_revealed_at ? "no, the buyer has seen the code" : "yes"}
  stock left   ${stock}

  buyer link   ${base}/code/${token}
  api          curl -s -H "x-publishable-api-key: <pk>" ${process.env.MEDUSA_BACKEND_URL ?? "http://localhost:3101"}/store/digital-delivery/${token}
`);
}
