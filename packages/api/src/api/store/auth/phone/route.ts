import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { getSmsDriver, normalisePkMobile } from "../../../../lib/sms"
import { OtpService } from "../../../../lib/otp"

/**
 * POST /store/auth/phone   — request a sign-in code
 *
 * Phone-first sign-in, because in this market the mobile number is the
 * identity and requiring an email costs orders.
 *
 * The response is deliberately identical whether or not the number has an
 * account. Telling an anonymous caller "no account with that number" turns
 * this into a user-enumeration oracle, and the sign-in flow does not need the
 * distinction anyway: an unknown number simply gets an account on first
 * successful verify.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body ?? {}) as { phone?: string }

  const phone = normalisePkMobile(body.phone ?? "")
  if (!phone) {
    return res.status(400).json({
      message:
        "Enter a valid Pakistani mobile number, for example 03001234567.",
    })
  }

  const redis = getRedis(req)
  if (!redis) {
    logger.error("OTP requested but no Redis connection is available")
    return res.status(503).json({ message: "Sign-in is temporarily unavailable." })
  }

  const otp = new OtpService(redis)
  const issued = await otp.issue(phone)

  if (!issued.ok) {
    // 429 with a retry hint. Being explicit here is fine — it leaks nothing
    // about whether the account exists, only that WE are throttling.
    return res.status(429).json({
      message:
        issued.reason === "cooldown"
          ? `Please wait ${issued.retryAfter}s before requesting another code.`
          : "Too many codes requested. Try again later.",
      retry_after: issued.retryAfter,
    })
  }

  await getSmsDriver().send({
    to: phone,
    body: `${issued.code} is your Bazaar sign-in code. It expires in 5 minutes. Never share it with anyone.`,
  })

  return res.json({ sent: true, phone_masked: maskPhone(phone) })
}

function maskPhone(e164: string) {
  return e164.replace(/^(\+92)(\d{3})(\d{4})(\d{3})$/, "$1 $2 ****$4")
}

export function getRedis(req: MedusaRequest): any | null {
  // The cache module holds the ioredis client in this setup. Resolving it here
  // keeps OtpService free of Medusa specifics and unit-testable.
  try {
    const cache = req.scope.resolve(Modules.CACHE) as unknown as {
      client?: unknown
      redis?: unknown
    }
    return (cache?.client ?? cache?.redis ?? null) as any
  } catch {
    return null
  }
}
