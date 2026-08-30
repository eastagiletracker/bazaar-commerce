import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { DIGITAL_FULFILMENT_MODULE } from "../../modules/digital-fulfilment";
import { assessFraud } from "../../modules/digital-fulfilment/fraud";
import {
  DeliveryStatus,
  FraudDecision,
} from "../../modules/digital-fulfilment/models/digital-delivery";

/**
 * Assess a digital delivery and, if it clears, fulfil it.
 *
 * Every path that can deliver a code runs through here: the order subscriber,
 * an ops agent releasing a hold, and a retry. One function so the fraud gate
 * cannot be bypassed by whichever caller was written last.
 */

/** Distributed lock lifetime. Long enough for an allocation, short enough that
 * a crashed worker does not wedge a SKU. */
const LOCK_SECONDS = 10;

export async function assessAndFulfil(
  container: any,
  deliveryId: string
): Promise<{ status: string; code?: string | null }> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const digital: any = container.resolve(DIGITAL_FULFILMENT_MODULE);

  const delivery = await digital.retrieveDigitalDelivery(deliveryId);

  if (
    delivery.status === DeliveryStatus.DELIVERED ||
    delivery.status === DeliveryStatus.REFUSED
  ) {
    return { status: delivery.status };
  }

  // Only assess once. A held delivery that an agent later releases must not be
  // re-scored on the way out, or the agent's decision is silently overturned by
  // the machine that raised the flag in the first place.
  if (!delivery.fraud_decision) {
    const velocity = await digital.velocityForPhone(
      delivery.phone ?? "",
      delivery.order_line_id
    );

    const assessment = assessFraud({
      amount: Number(delivery.amount ?? 0),
      phoneVerified: Boolean(delivery.buyer_verified),
      isGuest: !delivery.buyer_verified,
      velocity,
      productType: delivery.product_type,
    });

    await digital.recordFraudDecision(delivery.id, assessment);

    logger.info(
      `Digital delivery ${delivery.id}: ${assessment.decision} ` +
        `(score ${assessment.score}) — ${assessment.reasons[0]}`
    );

    if (assessment.decision !== FraudDecision.RELEASE) {
      return { status: assessment.decision === FraudDecision.HOLD ? DeliveryStatus.HELD : DeliveryStatus.REFUSED };
    }
  }

  return await fulfil(container, deliveryId);
}

/**
 * Hand over the goods. Assumes the fraud gate has already cleared.
 *
 * Exported separately so an ops agent releasing a hold reaches this directly
 * rather than going back through scoring.
 */
export async function fulfil(
  container: any,
  deliveryId: string
): Promise<{ status: string; code?: string | null }> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const digital: any = container.resolve(DIGITAL_FULFILMENT_MODULE);

  const delivery = await digital.retrieveDigitalDelivery(deliveryId);

  // A top-up has no code to allocate. It is an instruction the vendor acts on,
  // so clearing the gate means putting it on their queue with an SLA, not
  // handing the buyer anything.
  if (delivery.product_type !== "digital_code") {
    await digital.updateDigitalDeliveries({
      id: delivery.id,
      status: DeliveryStatus.READY,
      sla_due_at: new Date(Date.now() + 30 * 60 * 1000),
    } as any);
    return { status: DeliveryStatus.READY };
  }

  const allocated = await withOfferLock(
    container,
    delivery.offer_id,
    async () =>
      await digital.allocateCode({
        offerId: delivery.offer_id,
        orderLineId: delivery.order_line_id,
        orderId: delivery.order_id,
      })
  );

  if (!allocated) {
    // The buyer has paid and there is nothing to give them. A real operational
    // state, and the one that most needs to be loud: it means the vendor's
    // stock count and their actual codes disagree.
    await digital.markOutOfStock(delivery.id);
    logger.error(
      `Digital delivery ${delivery.id} cleared but offer ${delivery.offer_id} ` +
        `has no codes left. Order ${delivery.order_id} is paid and ` +
        `undeliverable; refund or restock.`
    );
    return { status: DeliveryStatus.OUT_OF_STOCK };
  }

  await digital.markDelivered(delivery.id);
  await digital.issueToken(delivery.id);

  // Deliberately not returning or logging the plaintext here. It is fetched
  // only when the buyer opens their reveal link.
  return { status: DeliveryStatus.DELIVERED };
}

/**
 * Serialise allocation per offer.
 *
 * Without this, two buyers checking out the same SKU in the same instant both
 * read "the oldest available code" and both get it. That failure is
 * unrecoverable: both have paid, and the second to redeem finds the PIN spent.
 *
 * Keyed on the offer rather than globally so unrelated SKUs never wait on each
 * other. Redis-backed, which is why medusa-config refuses to boot without a
 * real Redis rather than falling back to the in-memory stub.
 */
async function withOfferLock<T>(
  container: any,
  offerId: string,
  fn: () => Promise<T>
): Promise<T> {
  let locking: any;
  try {
    locking = container.resolve(Modules.LOCKING);
  } catch {
    // No locking module. The service still re-reads the row before writing, so
    // this degrades rather than corrupts, but it is worth saying out loud.
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    logger.warn(
      "Locking module unavailable; allocating a digital code without a lock."
    );
    return await fn();
  }

  return await locking.execute(`digital-code:${offerId}`, fn, {
    expire: LOCK_SECONDS,
  });
}

