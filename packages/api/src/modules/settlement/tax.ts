/**
 * Pakistan tax parameters for settlement.
 *
 * THESE DEFAULTS ARE PLACEHOLDERS AND MUST BE CONFIRMED WITH A TAX ADVISOR
 * BEFORE ANY REAL MONEY MOVES. They are wired as configuration precisely so
 * that confirming them is a config change, not a code change.
 *
 * Two distinct taxes apply, and they are often conflated:
 *
 * 1. Provincial sales tax on services. Marketplace commission is a service sold
 *    to the seller, so it is taxable by the province the service is rendered in
 *    (SRB in Sindh, PRA in Punjab, and equivalents elsewhere). It is charged ON
 *    TOP of commission and is our liability to remit.
 *
 * 2. Income tax withholding on payments to sellers. A marketplace paying
 *    sellers is a withholding agent; the rate turns on whether the seller is on
 *    the Active Taxpayers List. We deduct it from the seller's proceeds and
 *    remit it to FBR.
 *
 * The rate a seller actually attracts depends on their province and filer
 * status, so both are resolved per seller rather than hardcoded globally.
 */

export type SellerTaxProfile = {
  /** Province the seller is registered in, lowercase. */
  province?: string | null;
  /** On the Active Taxpayers List. Non-filers attract a higher rate. */
  is_filer?: boolean | null;
  /** Sales tax registration number, if any. */
  strn?: string | null;
};

/** Provincial sales tax on services, by province. Confirm before launch. */
const SALES_TAX_ON_SERVICES: Record<string, number> = {
  sindh: 15,
  punjab: 16,
  kpk: 15,
  balochistan: 15,
  islamabad: 15,
};

const DEFAULT_SALES_TAX_RATE = 15;

/** Income tax withheld from seller proceeds. Confirm before launch. */
const WITHHOLDING_FILER = 1;
const WITHHOLDING_NON_FILER = 2;

export function salesTaxRateOnCommission(profile: SellerTaxProfile): number {
  const override = process.env.PK_SALES_TAX_RATE;
  if (override !== undefined) return Number(override);

  const province = (profile.province ?? "").trim().toLowerCase();
  return SALES_TAX_ON_SERVICES[province] ?? DEFAULT_SALES_TAX_RATE;
}

export function withholdingTaxRate(profile: SellerTaxProfile): number {
  const override = process.env.PK_WITHHOLDING_RATE;
  if (override !== undefined) return Number(override);

  return profile.is_filer ? WITHHOLDING_FILER : WITHHOLDING_NON_FILER;
}

/**
 * Split an order into what each party gets.
 *
 * Commission comes off the gross. Sales tax is charged on the commission, on
 * top of it, and also comes out of the seller's proceeds (the seller is the
 * customer for that service). Withholding is computed on the gross payment to
 * the seller, per the withholding regime, not on the net after commission.
 *
 * Rounding: every component is rounded to 2dp independently, then net is
 * derived by subtraction so the parts always sum exactly to the gross. Deriving
 * net by its own rounded formula is how ledgers end up a paisa out.
 */
export function splitOrderMoney(input: {
  gross: number;
  commission: number;
  profile: SellerTaxProfile;
}): {
  gross: number;
  commission: number;
  commissionTax: number;
  withholdingTax: number;
  netPayable: number;
  salesTaxRate: number;
  withholdingRate: number;
} {
  const salesTaxRate = salesTaxRateOnCommission(input.profile);
  const withholdingRate = withholdingTaxRate(input.profile);

  const gross = round2(input.gross);
  const commission = round2(input.commission);
  const commissionTax = round2((commission * salesTaxRate) / 100);
  const withholdingTax = round2((gross * withholdingRate) / 100);
  const netPayable = round2(gross - commission - commissionTax - withholdingTax);

  return {
    gross,
    commission,
    commissionTax,
    withholdingTax,
    netPayable,
    salesTaxRate,
    withholdingRate,
  };
}

export function round2(value: number): number {
  // Scale-and-round rather than toFixed: toFixed on a binary float can round
  // the wrong way on exact .005 cases.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
