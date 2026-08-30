import { model } from "@medusajs/framework/utils";

/**
 * One sellable code, encrypted at rest.
 *
 * This table IS the inventory for a `digital_code` product. A vendor uploads a
 * batch of PINs and each row is one unit of stock, so "how many are available"
 * is a count over this table rather than a number someone maintains by hand.
 *
 * The code itself is never in a column. `ciphertext`, `iv` and `auth_tag` are
 * an AES-256-GCM sealed box; `fingerprint` is a keyed hash used only to reject
 * a duplicate upload. Neither can be turned back into a code without the vault
 * key, which lives in the environment.
 */

export const CodeStatus = {
  /** Uploaded, unsold, allocatable. */
  AVAILABLE: "available",
  /** Claimed by an order line. No longer sellable. */
  ALLOCATED: "allocated",
  /** Handed to the buyer. Terminal for refund purposes. */
  DELIVERED: "delivered",
  /** Vendor withdrew it, or it expired unsold. */
  VOIDED: "voided",
} as const;

export type CodeStatusValue = (typeof CodeStatus)[keyof typeof CodeStatus];

const DigitalCode = model
  .define("pk_digital_code", {
    id: model.id({ prefix: "dcode" }).primaryKey(),
    seller_id: model.text(),
    /** The offer this stock belongs to; what a buyer actually purchases. */
    offer_id: model.text(),
    variant_id: model.text().nullable(),

    status: model.enum(Object.values(CodeStatus)).default("available"),

    ciphertext: model.text(),
    iv: model.text(),
    auth_tag: model.text(),
    /**
     * Keyed hash of (seller, code). Unique per seller so a vendor re-pasting a
     * batch cannot create a second sellable row for one code. Ciphertexts
     * cannot serve this purpose: a fresh IV makes every encryption differ.
     */
    fingerprint: model.text(),
    /** Last four characters, for vendor reconciliation. Never the whole code. */
    masked: model.text(),

    /** Optional, for codes with a shelf life. */
    expires_at: model.dateTime().nullable(),

    /** The order line that claimed this code. One code, one line, forever. */
    allocated_to_line_id: model.text().nullable(),
    allocated_to_order_id: model.text().nullable(),
    allocated_at: model.dateTime().nullable(),
    delivered_at: model.dateTime().nullable(),

    /** Set when a vendor voids stock, for an audit trail. */
    voided_reason: model.text().nullable(),

    batch_id: model.text().nullable(),
  })
  .indexes([
    // The duplicate-upload guard. Partial on deleted_at so a voided-and-deleted
    // code does not block the vendor re-adding it.
    {
      name: "IDX_pk_digital_code_fingerprint_unique",
      on: ["seller_id", "fingerprint"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    // Belt and braces on allocation: even if two allocations raced past the
    // lock, the second write to the same line would violate this.
    {
      name: "IDX_pk_digital_code_line_unique",
      on: ["allocated_to_line_id"],
      unique: true,
      where: "deleted_at IS NULL AND allocated_to_line_id IS NOT NULL",
    },
    // The hot path: find an available code for this offer.
    { on: ["offer_id", "status"] },
    { on: ["seller_id", "status"] },
  ]);

export default DigitalCode;
