import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { DIGITAL_FULFILMENT_MODULE } from "../../../../modules/digital-fulfilment";
import { DeliveryStatus } from "../../../../modules/digital-fulfilment/models/digital-delivery";

/**
 * GET /store/digital-delivery/:token — the buyer's code.
 *
 * The only endpoint in the system that returns a decrypted code, and the only
 * place the plaintext exists after upload.
 *
 * Unauthenticated, for the same reason the order confirmation page is: the link
 * arrives by WhatsApp on a phone that is probably not signed in. The token is 32
 * bytes of entropy derived from a stored salt, so it is not guessable, and the
 * response contains only what the holder needs.
 *
 * A GET that changes state, which is normally wrong. It is right here: the
 * reveal timestamp is what makes the order non-refundable, and it must be
 * recorded on the request that actually shows the code. Recording it on a
 * subsequent POST would leave a window where the buyer has read their code and
 * our records say they have not.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const digital: any = req.scope.resolve(DIGITAL_FULFILMENT_MODULE);

  const delivery = await digital.findByToken(String(req.params.token ?? ""));
  if (!delivery) {
    return res.status(404).json({ message: "This link is no longer valid." });
  }

  // Held or refused deliveries reach this endpoint too: the buyer was sent a
  // link, then the gate stopped it. Say something true and non-alarming rather
  // than 404-ing, which would read as though their order vanished.
  if (delivery.status !== DeliveryStatus.DELIVERED) {
    return res.json({
      status: delivery.status,
      ready: false,
      message: statusMessage(delivery.status),
    });
  }

  const [code] = await digital.listDigitalCodes(
    { allocated_to_line_id: delivery.order_line_id } as any,
    { take: 1 }
  );

  if (!code) {
    logger.error(
      `Delivery ${delivery.id} is marked delivered but has no allocated code.`
    );
    return res.status(500).json({
      message:
        "Something went wrong finding your code. Our team has been alerted.",
    });
  }

  // Counted BEFORE the code is returned. If the response is lost in transit we
  // would rather have wrongly marked it seen than wrongly refunded a code the
  // buyer already read.
  await digital.countReveal(delivery.id);

  const plaintext = await digital.revealCode(code.id);

  return res.json({
    status: DeliveryStatus.DELIVERED,
    ready: true,
    code: plaintext,
    // Said plainly, at the moment it becomes true, rather than buried in terms
    // the buyer accepted at checkout.
    notice:
      "Keep this code safe. Now that it has been shown, this order cannot be refunded.",
    delivered_at: delivery.delivered_at,
  });
}

function statusMessage(status: string): string {
  switch (status) {
    case DeliveryStatus.HELD:
      return (
        "We are running a quick security check on this order. It usually takes " +
        "a few minutes and we will message you as soon as it clears."
      );
    case DeliveryStatus.REFUSED:
      return (
        "We could not complete this order. If you have been charged, the refund " +
        "is on its way. Please contact support if you think this is wrong."
      );
    case DeliveryStatus.OUT_OF_STOCK:
      return (
        "The seller has run out of stock for this item. We are sorting out your " +
        "refund now."
      );
    case DeliveryStatus.READY:
      return "Your order is being processed and will be ready shortly.";
    default:
      return "Your order is being prepared.";
  }
}
