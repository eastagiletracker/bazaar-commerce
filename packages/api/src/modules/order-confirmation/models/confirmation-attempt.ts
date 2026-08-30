import { model } from "@medusajs/framework/utils";

/**
 * One outbound contact attempt. Append-only.
 *
 * Worth its own table rather than a counter on the confirmation, for two
 * reasons. First, when a seller asks why their order was cancelled, "we sent a
 * WhatsApp at 14:02 and an SMS at 15:04, neither answered" is an answer;
 * "attempts: 2" is not. Second, delivery rates per channel are the only way to
 * find out whether WhatsApp templates are actually landing before we have spent
 * a month of message fees discovering they were not.
 */

export const ContactChannel = {
  WHATSAPP: "whatsapp",
  SMS: "sms",
  /** A human dialling. Logged when an agent works the escalation queue. */
  CALL: "call",
} as const;

export const AttemptStatus = {
  SENT: "sent",
  FAILED: "failed",
  /** Channel unavailable or not contracted; we fell through to the next one. */
  SKIPPED: "skipped",
} as const;

const ConfirmationAttempt = model
  .define("pk_confirmation_attempt", {
    id: model.id({ prefix: "cnfatt" }).primaryKey(),
    confirmation_id: model.text(),
    order_id: model.text(),

    /** 1 for the first contact, 2 for the retry, and so on. */
    sequence: model.number(),
    channel: model.enum(Object.values(ContactChannel)),
    status: model.enum(Object.values(AttemptStatus)),

    /** Gateway message id, for chasing a delivery report later. */
    provider_message_id: model.text().nullable(),
    error: model.text().nullable(),
    /** Agent id when channel is `call`. */
    agent_id: model.text().nullable(),
    note: model.text().nullable(),
  })
  .indexes([{ on: ["confirmation_id"] }, { on: ["order_id"] }]);

export default ConfirmationAttempt;
