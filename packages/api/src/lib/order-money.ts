/**
 * Reading money off an order, safely.
 *
 * Medusa exposes two very different kinds of "amount" on an order, and mixing
 * them up produces a plausible number rather than an error. Both mistakes have
 * already been made in this codebase:
 *
 *  - `order.total` is COMPUTED from whichever item fields the query asked for.
 *    Requesting a partial item selection reported a PKR 156,050 order as PKR
 *    250, silently disabling every value-based risk rule.
 *  - `order_line_item.total` is also computed, and is NOT a database column.
 *    Inside an `order.placed` subscriber the totals calculator has not run, so
 *    it reads 0 while `unit_price` sits right there holding 1750.
 *
 * `unit_price` and `quantity` are real stored values and are correct at every
 * point in the lifecycle, so anything that has to be right during checkout
 * derives from those.
 */

/**
 * What one order line is worth.
 *
 * Prefers the computed total when it is present and sane, because it includes
 * line-level discounts and tax. Falls back to unit price times quantity, which
 * is always available.
 */
export function lineAmount(line: any): number {
  const computed = Number(line?.total ?? 0);
  const raw = Number(line?.unit_price ?? 0) * Number(line?.quantity ?? 0);

  // A computed total below the raw price means the calculator has not run yet,
  // not that the buyer got a 100% discount.
  if (computed > 0 && computed >= raw - 1) return computed;
  return raw;
}

/**
 * What a whole order is worth, cross-checked against its own lines.
 *
 * An order total can never be less than the sum of its lines. When it is,
 * something upstream is wrong and the sum is the safer figure: it is the one
 * that keeps a large order out of an auto-approve band.
 */
export function reconciledOrderTotal(
  order: any,
  onMismatch?: (message: string) => void
): number {
  const stated = Number(order?.total ?? 0);
  const lines = ((order?.items ?? []) as any[]).reduce(
    (sum, i) => sum + lineAmount(i),
    0
  );
  const shipping = ((order?.shipping_methods ?? []) as any[]).reduce(
    (sum, m) => sum + Number(m?.total ?? m?.amount ?? 0),
    0
  );
  const computed = lines + shipping;

  if (computed > stated + 1) {
    onMismatch?.(
      `Reported order total ${stated} is below its own lines ` +
        `(${lines} items + ${shipping} shipping = ${computed}). Using ${computed}.`
    );
    return computed;
  }
  return stated;
}
