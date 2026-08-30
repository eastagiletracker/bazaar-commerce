import crypto from "node:crypto";

/**
 * Encryption for the code vault.
 *
 * A game PIN or licence key is a bearer instrument: whoever reads it can spend
 * it, and unlike a parcel it cannot be recalled once gone. So the plaintext
 * exists in three places only, all of them transient: in the request that
 * uploads it, in memory during allocation, and in the response that reveals it
 * to the buyer who paid. It is never written to a column, a log line or an
 * error message.
 *
 * AES-256-GCM rather than CBC because GCM authenticates: a tampered ciphertext
 * fails to decrypt rather than silently producing a wrong code that we would
 * then hand to a customer.
 */

const ALGORITHM = "aes-256-gcm";

/**
 * The vault key is deliberately NOT `JWT_SECRET`.
 *
 * Session secrets get rotated, shared with services that need to verify tokens,
 * and occasionally pasted into a terminal. The key that protects unsold
 * inventory should have none of that blast radius. Keep it in a secrets manager
 * or your platform's keychain, never in the repository.
 *
 * Generate one with:  openssl rand -base64 32
 */
function vaultKey(): Buffer {
  const raw = process.env.PK_VAULT_KEY;

  if (!raw) {
    // Refusing outside development is the whole point. A silent fallback key
    // would mean production codes encrypted with a value that is in the source
    // history, which is indistinguishable from storing them in plaintext.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "PK_VAULT_KEY is not set. The digital code vault cannot run without " +
          "it. Generate one with `openssl rand -base64 32` and put it in the " +
          "environment, never in the repo."
      );
    }
    return crypto
      .createHash("sha256")
      .update("pk-marketplace-development-vault-key-not-for-production")
      .digest();
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `PK_VAULT_KEY must decode to 32 bytes, got ${key.length}. ` +
        "Generate one with `openssl rand -base64 32`."
    );
  }
  return key;
}

export type SealedCode = {
  ciphertext: string;
  iv: string;
  auth_tag: string;
};

/** Encrypt a code for storage. */
export function seal(plaintext: string): SealedCode {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, vaultKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Decrypt a stored code.
 *
 * Throws on a tampered or truncated record rather than returning something
 * that looks like a code. Handing a customer a corrupted PIN is worse than an
 * error, because they will try to redeem it and then open a dispute.
 */
export function unseal(sealed: SealedCode): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    vaultKey(),
    Buffer.from(sealed.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(sealed.auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Deduplication fingerprint.
 *
 * Two problems this solves at once. A vendor pasting the same batch twice must
 * not create two sellable rows for one code, and we cannot detect that by
 * comparing ciphertexts because a fresh IV makes every encryption of the same
 * value different.
 *
 * Keyed by seller: two vendors legitimately holding the same code is possible
 * (a reseller chain), and it is not our place to tell one of them their stock
 * is invalid.
 */
export function fingerprint(sellerId: string, plaintext: string): string {
  return crypto
    .createHmac("sha256", vaultKey())
    .update(`${sellerId}:${plaintext.trim()}`)
    .digest("hex");
}

/**
 * A safe rendering for logs and vendor-facing lists.
 *
 * Enough for a vendor to recognise which code a row refers to when
 * reconciling, useless to anyone who intercepts it.
 */
export function maskCode(plaintext: string): string {
  const s = plaintext.trim();
  if (s.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}
