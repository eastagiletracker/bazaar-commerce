import { ExecArgs } from "@medusajs/framework/types";

import { ORDER_CONFIRMATION_MODULE } from "../modules/order-confirmation";
import { confirmUrlFor } from "../lib/confirmation/outreach";

/**
 * Print the buyer confirmation link for the most recent open order.
 *
 * A development and demo tool. In production the link only ever reaches the
 * buyer's phone, and the token is not recoverable from the database, so there
 * is no way to look one up by hand. This regenerates it through the same code
 * path the sweep job uses.
 *
 * Run:  bun run confirm:link
 */
export default async function confirmationLink({ container, args }: ExecArgs) {
  const svc: any = container.resolve(ORDER_CONFIRMATION_MODULE);

  const filters: Record<string, unknown> = {
    status: ["pending", "awaiting_buyer", "escalated"],
  };
  if (args?.[0]) filters.order_id = args[0];

  const [c] = await svc.listOrderConfirmations(filters as any, {
    take: 1,
    order: { created_at: "DESC" },
  });

  if (!c) {
    console.log("\n  No open confirmations. Place an order first.\n");
    return;
  }

  const token = await svc.issueToken(c.id);

  console.log(`
  order       ${c.order_id}
  amount      ${c.currency_code.toUpperCase()} ${Number(c.order_amount).toLocaleString("en-PK")}
  phone       ${c.phone}
  status      ${c.status}  (policy: ${c.policy}, ${c.risk_band} risk, score ${c.risk_score})
  reasons     ${(c.risk_reasons ?? []).join("\n              ")}

  buyer link  ${confirmUrlFor(token)}
`);
}
