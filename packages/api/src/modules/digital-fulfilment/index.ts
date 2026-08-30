import { Module } from "@medusajs/framework/utils";
import DigitalFulfilmentModuleService from "./service";

export const DIGITAL_FULFILMENT_MODULE = "pk_digital_fulfilment";

export default Module(DIGITAL_FULFILMENT_MODULE, {
  service: DigitalFulfilmentModuleService,
});

export * from "./models";
export { assessFraud, FRAUD_CONFIG } from "./fraud";
export type { FraudInput, FraudAssessment, DigitalVelocity } from "./fraud";
export { seal, unseal, fingerprint, maskCode } from "./vault-crypto";
