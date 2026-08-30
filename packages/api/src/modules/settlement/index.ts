import { Module } from "@medusajs/framework/utils";
import SettlementModuleService from "./service";

export const SETTLEMENT_MODULE = "pk_settlement";

export default Module(SETTLEMENT_MODULE, {
  service: SettlementModuleService,
});

export * from "./models";
export { splitOrderMoney, round2 } from "./tax";
export type { SellerTaxProfile } from "./tax";
