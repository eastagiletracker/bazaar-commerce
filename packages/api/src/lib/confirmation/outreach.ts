import { getSmsDriver } from "../sms";
import { getWhatsAppDriver, TEMPLATES } from "../whatsapp";

/**
 * Sending one confirmation request to a buyer.
 *
 * WhatsApp first, SMS if WhatsApp is unavailable or the send fails. The
 * fallback is not a nicety: WhatsApp template sends fail for ordinary reasons
 * (the number has no WhatsApp, the user blocked business messages, the template
 * is temporarily paused for quality), and an order silently held because a
 * message could not be sent is worse than an SMS that costs a rupee.
 */

export type OutreachResult = {
  channel: "whatsapp" | "sms";
  status: "sent" | "failed";
  providerMessageId?: string;
  error?: string;
  /** Channels tried and skipped before this one, for the attempt log. */
  skipped: Array<{ channel: "whatsapp"; error: string }>;
};

export type OutreachInput = {
  phone: string;
  buyerName: string;
  orderDisplayId: string;
  amountLabel: string;
  sellerName: string;
  confirmUrl: string;
};

export async function sendConfirmationRequest(
  input: OutreachInput
): Promise<OutreachResult> {
  const skipped: OutreachResult["skipped"] = [];
  const wa = getWhatsAppDriver();

  if (wa.available) {
    try {
      const { id } = await wa.sendTemplate({
        to: input.phone,
        template: TEMPLATES.ORDER_CONFIRM,
        params: [
          input.buyerName,
          input.orderDisplayId,
          input.amountLabel,
          input.sellerName,
        ],
        buttonUrlSuffix: input.confirmUrl,
      });
      return { channel: "whatsapp", status: "sent", providerMessageId: id, skipped };
    } catch (e) {
      skipped.push({ channel: "whatsapp", error: String((e as Error)?.message ?? e) });
    }
  } else {
    skipped.push({ channel: "whatsapp", error: "No WhatsApp gateway configured." });
  }

  // SMS fallback. Kept inside one 160-character segment where possible: PK
  // gateways bill per segment and a two-segment message doubles the cost of
  // every confirmation we send.
  try {
    const { id } = await getSmsDriver().send({
      to: input.phone,
      body: `Bazaar: confirm order ${input.orderDisplayId} for ${input.amountLabel}. Tap to confirm or cancel: ${input.confirmUrl}`,
    });
    return { channel: "sms", status: "sent", providerMessageId: id, skipped };
  } catch (e) {
    return {
      channel: "sms",
      status: "failed",
      error: String((e as Error)?.message ?? e),
      skipped,
    };
  }
}

/**
 * The link the buyer taps.
 *
 * Points at the storefront rather than the API so the buyer sees a page they
 * recognise, with the order on it, before committing to anything. A raw API
 * endpoint that acts on GET would also be confirmed by every link previewer and
 * antivirus scanner that fetches the URL, which would confirm orders nobody
 * ever looked at.
 */
export function confirmUrlFor(token: string): string {
  const base = (
    process.env.STOREFRONT_URL ?? "http://localhost:3100"
  ).replace(/\/$/, "");
  return `${base}/confirm/${token}`;
}
