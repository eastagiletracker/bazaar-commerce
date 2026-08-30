/**
 * SMS sending, behind a driver interface.
 *
 * No SMS gateway is contracted yet. Rather than hardcode one, this mirrors the
 * payout-provider pattern: a narrow interface shaped like what the Pakistani
 * gateways actually expose, with a console driver for development. Wiring a
 * real gateway is implementing one method.
 *
 * Candidates when the time comes: Telenor Bulk SMS, Jazz Business, Twilio
 * (works but prices in USD, which is painful here), or an aggregator like
 * Branded SMS Pakistan. All of them require a registered sender mask, which is
 * a commercial step with a lead time — worth starting early.
 */

export interface SmsDriver {
  readonly name: string
  send(input: { to: string; body: string }): Promise<{ id: string }>
}

/** Development driver. Prints instead of sending. */
export class ConsoleSmsDriver implements SmsDriver {
  readonly name = "console"

  async send({ to, body }: { to: string; body: string }) {
    // Deliberately loud. Silently swallowing a "sent" SMS in development is
    // how you discover on launch day that nothing was ever wired up.
    console.log(`\n  [SMS → ${to}] ${body}\n`)
    return { id: `console_${Date.now()}` }
  }
}

let driver: SmsDriver = new ConsoleSmsDriver()

export const setSmsDriver = (d: SmsDriver) => {
  driver = d
}
export const getSmsDriver = () => driver

/**
 * Normalise a Pakistani mobile number to E.164.
 *
 * Accepts everything people actually type: 03001234567, 0300-1234567,
 * +92 300 1234567, 92 300 1234567, 3001234567. Returns null when it is not a
 * plausible PK mobile, so callers can reject rather than send into the void.
 *
 * PK mobiles are +92 3XX XXXXXXX — the subscriber part always starts with 3
 * and is 10 digits.
 */
export function normalisePkMobile(input: string): string | null {
  const digits = String(input ?? "").replace(/\D/g, "")
  if (!digits) return null

  let national: string
  if (digits.startsWith("92")) national = digits.slice(2)
  else if (digits.startsWith("0")) national = digits.slice(1)
  else national = digits

  if (national.length !== 10) return null
  if (!national.startsWith("3")) return null

  return `+92${national}`
}
