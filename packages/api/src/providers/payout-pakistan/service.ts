import {
  MockPspDriver,
  type PspAccountStatus,
  type PspDriver,
  type PspSellerDetails,
} from "./psp";

/**
 * Pakistan payout provider for Mercur's payout module.
 *
 * Implements the same four-method contract as Mercur's Stripe Connect provider
 * (IPayoutProvider): createPayoutAccount, createOnboarding, createPayout and
 * getWebhookActionAndData. Mercur never interprets the `data` field, so all
 * PSP-specific values travel in there and the module's code path is unchanged.
 *
 * Stripe Connect is unavailable to Pakistan-registered businesses, so this
 * exists to replace it rather than supplement it. The payout module registers
 * exactly one provider, which is fine while the marketplace is Pakistan-only.
 *
 * The actual PSP sits behind PspDriver. Until one is contracted the mock driver
 * is used, and it models pending KYC, restricted accounts and failed
 * disbursements rather than pretending everything succeeds.
 */

// Mirrors @mercurjs/types PayoutAccountStatus / PayoutStatus without importing
// them, so this provider stays compilable if the package layout shifts.
const AccountStatus = {
  PENDING: "pending",
  ACTIVE: "active",
  RESTRICTED: "restricted",
  REJECTED: "rejected",
} as const;

const PayoutStatus = {
  PENDING: "pending",
  PROCESSING: "processing",
  PAID: "paid",
  FAILED: "failed",
  CANCELED: "canceled",
} as const;

type WebhookAction = "authorized" | "captured" | "failed" | "not_supported";

export type PayoutPakistanOptions = {
  /** Which PSP driver to use. Only "mock" exists until one is contracted. */
  driver?: "mock";
  /** Sellers whose disbursements should fail, for exercising the failure path. */
  failForSellers?: string[];
  /** Skip the KYC wait. Never enable outside local development. */
  autoActivate?: boolean;
  /** Where the PSP returns the seller after KYC. */
  onboardingReturnUrl?: string;
};

export default class PayoutPakistanProviderService {
  static identifier = "pakistan";

  protected driver: PspDriver;
  protected options: PayoutPakistanOptions;

  constructor(_container: unknown, options: PayoutPakistanOptions = {}) {
    this.options = options;

    // Only the mock exists today. Selecting an uncontracted PSP by name should
    // fail loudly rather than silently fall back to a driver that always says
    // "paid" — that failure mode is invisible until real money is at stake.
    const driverName = options.driver ?? "mock";
    if (driverName !== "mock") {
      throw new Error(
        `payout-pakistan: unknown PSP driver "${driverName}". Only "mock" is ` +
          `implemented; see docs/marketplace/phase0-decisions.md before wiring a real PSP.`
      );
    }

    this.driver = new MockPspDriver({
      failForSellers: options.failForSellers,
      autoActivate: options.autoActivate,
    });
  }

  /** Register the seller as a sub-merchant with the PSP. */
  async createPayoutAccount(input: {
    context?: { idempotency_key?: string };
    data?: Record<string, unknown>;
  }): Promise<{ id: string; status?: string; data: Record<string, unknown> }> {
    const details = this.toSellerDetails(input.data ?? {});
    const account = await this.driver.createSubMerchant(details);

    return {
      id: account.id,
      status: this.mapAccountStatus(account.status),
      data: {
        psp: this.driver.name,
        account_id: account.id,
        // Recorded so a later compliance question can be answered without
        // re-deriving what we sent.
        submitted: {
          has_iban: Boolean(details.iban),
          has_cnic: Boolean(details.cnic),
          has_ntn: Boolean(details.ntn),
        },
        ...account.metadata,
      },
    };
  }

  /** Produce the KYC link the seller completes with the PSP. */
  async createOnboarding(input: {
    context?: { idempotency_key?: string };
    data?: Record<string, unknown>;
  }): Promise<{ data: Record<string, unknown> }> {
    const accountId = String(
      input.data?.account_id ?? input.data?.id ?? ""
    );
    if (!accountId) {
      throw new Error(
        "payout-pakistan: createOnboarding needs an account_id in data"
      );
    }

    const { url, data } = await this.driver.createOnboardingLink({
      accountId,
      returnUrl: this.options.onboardingReturnUrl,
    });

    return { data: { psp: this.driver.name, onboarding_url: url, ...data } };
  }

  /** Disburse to the seller. */
  async createPayout(input: {
    amount: number | string;
    currency_code: string;
    account_id: string;
    context?: { idempotency_key?: string };
    data?: Record<string, unknown>;
  }): Promise<{ status?: string; data: Record<string, unknown> }> {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`payout-pakistan: refusing to disburse ${input.amount}`);
    }

    const currency = (input.currency_code ?? "pkr").toLowerCase();
    if (currency !== "pkr") {
      throw new Error(
        `payout-pakistan: only PKR is supported, got "${input.currency_code}"`
      );
    }

    const result = await this.driver.disburse({
      accountId: input.account_id,
      amount,
      currency,
      // Mercur passes the order id here, so a re-emitted payout.requested
      // cannot pay twice — provided we forward it to the PSP, which we do.
      idempotencyKey: input.context?.idempotency_key,
      reference: input.data?.reference as string | undefined,
    });

    return {
      status: this.mapPayoutStatus(result.status),
      data: {
        psp: this.driver.name,
        payout_id: result.id,
        failure_reason: result.failureReason ?? null,
        ...result.metadata,
      },
    };
  }

  /** Decode a PSP webhook into the module's vocabulary. */
  async getWebhookActionAndData(payload: {
    data: Record<string, unknown>;
    rawData: string | Buffer;
    headers: Record<string, unknown>;
  }): Promise<{ action: WebhookAction; data?: { id: string } }> {
    const parsed = await this.driver.parseWebhook({
      rawBody: payload.rawData,
      headers: payload.headers,
    });

    if (!parsed) return { action: "not_supported" };

    if (parsed.kind === "payout") {
      if (parsed.status === "paid") {
        return { action: "captured", data: { id: parsed.payoutId } };
      }
      if (parsed.status === "failed") {
        return { action: "failed", data: { id: parsed.payoutId } };
      }
      return { action: "not_supported" };
    }

    // Account lifecycle. The module has no dedicated action for it, so report
    // unsupported rather than misreporting it as a money movement; the
    // subscriber updates account status from the same payload separately.
    return { action: "not_supported", data: { id: parsed.accountId } };
  }

  // ---------------------------------------------------------------- helpers

  private toSellerDetails(data: Record<string, unknown>): PspSellerDetails {
    const payment = (data.payment_details ?? {}) as Record<string, unknown>;
    return {
      sellerId: String(data.seller_id ?? data.id ?? "unknown"),
      legalName: (data.legal_name ?? data.name) as string | undefined,
      email: data.email as string | undefined,
      phone: data.phone as string | undefined,
      cnic: (data.cnic ?? payment.cnic) as string | undefined,
      ntn: (data.ntn ?? payment.ntn) as string | undefined,
      iban: (payment.iban ?? data.iban) as string | undefined,
      bankName: (payment.bank_name ?? data.bank_name) as string | undefined,
      accountTitle: (payment.holder_name ?? data.account_title) as string | undefined,
    };
  }

  private mapAccountStatus(status: PspAccountStatus): string {
    switch (status) {
      case "active":
        return AccountStatus.ACTIVE;
      case "restricted":
        return AccountStatus.RESTRICTED;
      case "rejected":
        return AccountStatus.REJECTED;
      default:
        return AccountStatus.PENDING;
    }
  }

  private mapPayoutStatus(status: string): string {
    switch (status) {
      case "paid":
        return PayoutStatus.PAID;
      case "failed":
        return PayoutStatus.FAILED;
      case "processing":
        return PayoutStatus.PROCESSING;
      default:
        return PayoutStatus.PENDING;
    }
  }
}
