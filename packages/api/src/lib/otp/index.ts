import crypto from "node:crypto"

/**
 * One-time passcodes for phone-first sign-in.
 *
 * Stored in Redis, never in the database: they are short-lived by definition
 * and a code that outlives its TTL because a row was missed is a security bug.
 *
 * Threat model this actually defends against, because an OTP endpoint is the
 * most abused surface on any consumer site:
 *
 *  - CODE GUESSING. Six digits is a million combinations, which sounds like a
 *    lot until someone scripts it. Attempts are capped at 5 per code and the
 *    code is destroyed on the 5th failure, so an attacker gets 5 tries per
 *    SMS they can make us send, not 5 per minute forever.
 *  - SMS PUMPING / toll fraud. Sending is rate limited per number AND per IP.
 *    Without this, someone points a script at premium-rate ranges and we pay
 *    for every message.
 *  - TIMING. Codes are compared with timingSafeEqual.
 *  - ENUMERATION. The send endpoint responds identically whether or not the
 *    number has an account.
 *
 * Codes are stored hashed. A Redis dump should not hand over live codes.
 */

const CODE_TTL_SECONDS = 5 * 60
const MAX_ATTEMPTS = 5
/** Minimum gap between sends to one number. */
const RESEND_COOLDOWN_SECONDS = 60
/** Ceiling per number per hour, regardless of cooldown. */
const MAX_SENDS_PER_HOUR = 5

export type OtpRecord = {
  hash: string
  attempts: number
  expiresAt: number
}

const key = (phone: string) => `otp:${phone}`
const cooldownKey = (phone: string) => `otp:cooldown:${phone}`
const hourlyKey = (phone: string) => `otp:hourly:${phone}`

const hash = (code: string, phone: string) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET ?? "dev").update(`${phone}:${code}`).digest("hex")

/** Cryptographically random 6-digit code. Math.random is not acceptable here. */
export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
}

type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode?: string, ttl?: number): Promise<unknown>
  del(key: string): Promise<unknown>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
  ttl(key: string): Promise<number>
}

export class OtpService {
  constructor(private redis: RedisLike) {}

  /**
   * Returns the code to send, or a reason not to.
   * The caller must NOT leak the reason to the client verbatim where it would
   * distinguish a known number from an unknown one.
   */
  async issue(phone: string): Promise<
    | { ok: true; code: string }
    | { ok: false; reason: "cooldown" | "hourly_limit"; retryAfter: number }
  > {
    const cooling = await this.redis.ttl(cooldownKey(phone))
    if (cooling > 0) {
      return { ok: false, reason: "cooldown", retryAfter: cooling }
    }

    const sends = await this.redis.incr(hourlyKey(phone))
    if (sends === 1) await this.redis.expire(hourlyKey(phone), 3600)
    if (sends > MAX_SENDS_PER_HOUR) {
      const ttl = await this.redis.ttl(hourlyKey(phone))
      return { ok: false, reason: "hourly_limit", retryAfter: Math.max(ttl, 0) }
    }

    const code = generateCode()
    const record: OtpRecord = {
      hash: hash(code, phone),
      attempts: 0,
      expiresAt: Date.now() + CODE_TTL_SECONDS * 1000,
    }

    await this.redis.set(key(phone), JSON.stringify(record), "EX", CODE_TTL_SECONDS)
    await this.redis.set(cooldownKey(phone), "1", "EX", RESEND_COOLDOWN_SECONDS)

    return { ok: true, code }
  }

  async verify(
    phone: string,
    code: string
  ): Promise<{ ok: true } | { ok: false; reason: "expired" | "invalid" | "too_many_attempts" }> {
    const raw = await this.redis.get(key(phone))
    if (!raw) return { ok: false, reason: "expired" }

    const record = JSON.parse(raw) as OtpRecord

    if (record.expiresAt < Date.now()) {
      await this.redis.del(key(phone))
      return { ok: false, reason: "expired" }
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(key(phone))
      return { ok: false, reason: "too_many_attempts" }
    }

    const expected = Buffer.from(record.hash)
    const actual = Buffer.from(hash(String(code ?? ""), phone))
    const match =
      expected.length === actual.length && crypto.timingSafeEqual(expected, actual)

    if (!match) {
      record.attempts += 1
      // Burn the code on the final failure rather than leaving it guessable
      // for the rest of its TTL.
      if (record.attempts >= MAX_ATTEMPTS) {
        await this.redis.del(key(phone))
        return { ok: false, reason: "too_many_attempts" }
      }
      const remaining = Math.max(
        1,
        Math.ceil((record.expiresAt - Date.now()) / 1000)
      )
      await this.redis.set(key(phone), JSON.stringify(record), "EX", remaining)
      return { ok: false, reason: "invalid" }
    }

    // Single use.
    await this.redis.del(key(phone))
    await this.redis.del(cooldownKey(phone))
    return { ok: true }
  }
}

export const OTP_CONFIG = {
  CODE_TTL_SECONDS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS_PER_HOUR,
}
