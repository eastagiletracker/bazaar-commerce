/**
 * WhatsApp Business messaging, behind a driver interface.
 *
 * WhatsApp rather than SMS as the first choice because it is where Pakistani
 * buyers actually are, it carries buttons the buyer can tap, and delivery is
 * visible. SMS stays as the fallback for the minority without it.
 *
 * The interface is shaped around the constraint that trips up everyone building
 * this for the first time: **a business cannot send free-form WhatsApp text to
 * someone who has not messaged it in the last 24 hours.** Business-initiated
 * messages must use a template approved in advance by Meta, and the only thing
 * you may vary at send time are the numbered parameters. So the interface takes
 * a template name plus parameters, not a message body. Writing it the other way
 * round produces code that works perfectly against a mock and fails against
 * every real gateway.
 *
 * Category matters too: order confirmation is a **utility** template. Sent as
 * marketing it costs more, is rate limited harder, and can be blocked outright
 * by the user's marketing opt-out.
 *
 * Contracting is a commercial step with a lead time — a Meta Business
 * verification plus a BSP such as Twilio, 360dialog or Interakt, and template
 * approval on top. Worth starting before the code is needed.
 */

export type TemplateParams = Record<string, string>;

export interface WhatsAppDriver {
  readonly name: string;
  /** False when no gateway is contracted, so callers fall through to SMS. */
  readonly available: boolean;
  sendTemplate(input: {
    to: string;
    template: string;
    /** Ordered substitutions for the template's {{1}}, {{2}} placeholders. */
    params: string[];
    /** Appended to the template's button URL, if it has one. */
    buttonUrlSuffix?: string;
  }): Promise<{ id: string }>;
}

/** Development driver. Prints instead of sending. */
export class ConsoleWhatsAppDriver implements WhatsAppDriver {
  readonly name = "console";
  readonly available = true;

  async sendTemplate({
    to,
    template,
    params,
    buttonUrlSuffix,
  }: {
    to: string;
    template: string;
    params: string[];
    buttonUrlSuffix?: string;
  }) {
    console.log(
      `\n  [WhatsApp → ${to}] template=${template}\n` +
        params.map((p, i) => `      {{${i + 1}}} = ${p}`).join("\n") +
        (buttonUrlSuffix ? `\n      button → ${buttonUrlSuffix}` : "") +
        "\n"
    );
    return { id: `wa_console_${Date.now()}` };
  }
}

/**
 * Driver used when nothing is contracted yet. Reports itself unavailable so the
 * caller falls through to SMS rather than logging a message nobody receives.
 */
export class UnavailableWhatsAppDriver implements WhatsAppDriver {
  readonly name = "unavailable";
  readonly available = false;

  async sendTemplate(): Promise<{ id: string }> {
    throw new Error("No WhatsApp gateway is configured.");
  }
}

let driver: WhatsAppDriver =
  process.env.PK_WHATSAPP_DRIVER === "none"
    ? new UnavailableWhatsAppDriver()
    : new ConsoleWhatsAppDriver();

export const setWhatsAppDriver = (d: WhatsAppDriver) => {
  driver = d;
};
export const getWhatsAppDriver = () => driver;

/**
 * Template names, as they must be registered with Meta.
 *
 * Kept here so the copy that needs approving is visible in one place rather
 * than scattered across call sites.
 *
 * `order_confirm_v1` body, for submission:
 *
 *   Assalam o Alaikum {{1}}, your Bazaar order {{2}} for {{3}} is ready to be
 *   packed by {{4}}. Please confirm you still want it. If we do not hear back
 *   we will contact you again.
 *
 *   [Yes, send it]  [No, cancel]
 */
export const TEMPLATES = {
  ORDER_CONFIRM: process.env.PK_WA_TEMPLATE_CONFIRM ?? "order_confirm_v1",
} as const;
