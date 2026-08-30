import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"

import { normalisePkMobile } from "../../../../../lib/sms"
import { OtpService } from "../../../../../lib/otp"
import { getRedis } from "../route"

/**
 * POST /store/auth/phone/verify   — exchange a code for a session
 *
 * On success: finds or creates the customer for this number and returns a
 * customer-scoped JWT, the same shape the emailpass flow returns so the
 * storefront can treat them identically.
 *
 * "Find or create" is intentional. Requiring a separate registration step for
 * a number we have just proven the caller controls adds friction for no
 * security gain, and account creation is the second-largest cause of cart
 * abandonment.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body ?? {}) as { phone?: string; code?: string }

  const phone = normalisePkMobile(body.phone ?? "")
  if (!phone || !body.code) {
    return res.status(400).json({ message: "Phone and code are both required." })
  }

  const redis = getRedis(req)
  if (!redis) {
    logger.error("OTP verify attempted but no Redis connection is available")
    return res.status(503).json({ message: "Sign-in is temporarily unavailable." })
  }

  const result = await new OtpService(redis).verify(phone, String(body.code))

  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "That code has expired. Request a new one."
        : result.reason === "too_many_attempts"
          ? "Too many incorrect attempts. Request a new code."
          : "That code is not correct."
    // 401 for a bad code, not 400: it is an authentication failure.
    return res.status(401).json({ message })
  }

  const customerModule = req.scope.resolve(Modules.CUSTOMER)

  // The synthesised address is the same one guest checkout uses, so a guest
  // who later signs in with the same number lands on the same customer rather
  // than a duplicate.
  const email = `${phone.replace(/\D/g, "")}@guest.bazaar.pk`

  let [customer] = await customerModule.listCustomers({ phone } as never, { take: 1 })
  if (!customer) {
    ;[customer] = await customerModule.listCustomers({ email } as never, { take: 1 })
  }
  if (!customer) {
    // createCustomers is overloaded: given one object it returns one customer,
    // given an array it returns an array. The published types only describe the
    // array form, so the single-object call has to be narrowed by hand.
    const created = await customerModule.createCustomers({
      email,
      phone,
      has_account: true,
    } as never)
    customer = (Array.isArray(created) ? created[0] : created) as typeof customer
  } else if (!customer.phone) {
    await customerModule.updateCustomers(customer.id, { phone } as never)
  }

  const secret = process.env.JWT_SECRET
  if (!secret) {
    logger.error("JWT_SECRET is not set; cannot issue a session")
    return res.status(500).json({ message: "Sign-in is temporarily unavailable." })
  }

  const token = jwt.sign(
    {
      actor_id: customer.id,
      actor_type: "customer",
      auth_identity_id: `phone_${phone}`,
      app_metadata: { customer_id: customer.id },
    },
    secret,
    { expiresIn: "7d" }
  )

  return res.json({
    token,
    customer: { id: customer.id, phone: customer.phone, email: customer.email },
  })
}
