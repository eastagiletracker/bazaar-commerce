import { Module } from "@medusajs/framework/utils";
import OrderConfirmationModuleService from "./service";

export const ORDER_CONFIRMATION_MODULE = "pk_order_confirmation";

export default Module(ORDER_CONFIRMATION_MODULE, {
  service: OrderConfirmationModuleService,
});

export * from "./models";
export { assessRisk, policyFor, RISK_CONFIG } from "./risk";
export type { RiskInput, RiskAssessment, BuyerHistory } from "./risk";
export { CONFIRM_CONFIG } from "./service";
