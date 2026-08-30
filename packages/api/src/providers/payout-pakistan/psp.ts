/**
 * The PSP boundary.
 *
 * No Pakistani PSP is contracted yet (see docs/marketplace/phase0-decisions.md),
 * and Stripe Connect — which both Mercur and Spree ship as their payout rail —
 * does not serve Pakistan-registered businesses at all. So the provider is
 * written against this narrow interface, and the concrete PSP slots in behind
 * it once a contract exists.
 *
 * The shape is deliberately the intersection of what Safepay, PayPro, JazzCash
 * and Easypaisa all expose for a sub-merchant arrangement:
 *   - register a seller as a sub-merchant
 *   - send them somewhere to complete KYC
 *   - disburse money to them
 *   - receive webhooks about both
 *
 * Under the sub-merchant model the licensed PSP holds and moves the funds. We
 * never take custody, which is what keeps this outside SBP's PSO/PSP licensing
 * regime (PKR 200m paid-up capital, 12-16 months). That is a legal position to
 * be confirmed with counsel, not an engineering one.
 */

export type PspAccountStatus = "pending" | "active" | "restricted" | "rejected";

export interface PspSubMerchant {
  /** The PSP's identifier for this sub-merchant. */
  id: string;
  status: PspAccountStatus;
  /** Anything the PSP wants echoed back on later calls. */
  metadata?: Record<string, unknown>;
}

export interface PspDisbursement {
  id: string;
  status: "pending" | "processing" | "paid" | "failed";
  /** PSP-side failure reason, when status is failed. */
  failureReason?: string;
  metadata?: Record<string, unknown>;
}

export interface PspSellerDetails {
  sellerId: string;
  legalName?: string;
  email?: string;
  phone?: string;
  /** National identity number, the primary KYC key for a sole trader. */
  cnic?: string;
  /** National tax number, for a registered company. */
  ntn?: string;
  /** IBAN is the reliable payout key in Pakistan. */
  iban?: string;
  bankName?: string;
  accountTitle?: string;
}

export interface PspDriver {
  readonly name: string;

  createSubMerchant(details: PspSellerDetails): Promise<PspSubMerchant>;

  /** A URL (or payload) the seller uses to finish KYC with the PSP. */
  createOnboardingLink(input: {
    accountId: string;
    returnUrl?: string;
  }): Promise<{ url?: string; data: Record<string, unknown> }>;

  disburse(input: {
    accountId: string;
    amount: number;
    currency: string;
    /** Passed to the PSP so a retried request cannot pay twice. */
    idempotencyKey?: string;
    reference?: string;
  }): Promise<PspDisbursement>;

  /**
   * Verify and decode a webhook.
   *
   * Returning `null` means "not for us / not understood" and the caller treats
   * it as unsupported rather than guessing.
   */
  parseWebhook(input: {
    rawBody: string | Buffer;
    headers: Record<string, unknown>;
  }): Promise<
    | { kind: "account"; accountId: string; status: PspAccountStatus }
    | { kind: "payout"; payoutId: string; status: PspDisbursement["status"] }
    | null
  >;
}

/**
 * Stand-in driver used until a PSP is signed.
 *
 * It deliberately does NOT pretend everything succeeds. A driver that always
 * returns "paid" lets failure handling go unwritten and untested until the day
 * real money is moving, which is the worst possible time to discover it. So it
 * models the states a real PSP produces — pending KYC, restricted accounts,
 * failed disbursements — driven by explicit, deterministic rules.
 */
export class MockPspDriver implements PspDriver {
  readonly name = "mock";

  private accounts = new Map<string, PspSubMerchant>();
  private payouts = new Map<string, PspDisbursement>();

  constructor(
    private options: {
      /** Sellers whose disbursements should fail, for exercising the path. */
      failForSellers?: string[];
      /** Accounts start pending unless KYC is explicitly completed. */
      autoActivate?: boolean;
    } = {}
  ) {}

  async createSubMerchant(details: PspSellerDetails): Promise<PspSubMerchant> {
    // A real PSP rejects an application with no payout destination, so this one
    // does too — otherwise we would only find out at the first disbursement.
    const status: PspAccountStatus =
      !details.iban && !details.cnic
        ? "restricted"
        : this.options.autoActivate
          ? "active"
          : "pending";

    const account: PspSubMerchant = {
      id: `mockacct_${details.sellerId}`,
      status,
      metadata: { seller_id: details.sellerId, driver: this.name },
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async createOnboardingLink(input: {
    accountId: string;
    returnUrl?: string;
  }): Promise<{ url?: string; data: Record<string, unknown> }> {
    return {
      url: `https://mock-psp.local/kyc/${input.accountId}`,
      data: {
        account_id: input.accountId,
        return_url: input.returnUrl ?? null,
        // Signals to the caller that this is not a real onboarding flow.
        mock: true,
      },
    };
  }

  async disburse(input: {
    accountId: string;
    amount: number;
    currency: string;
    idempotencyKey?: string;
    reference?: string;
  }): Promise<PspDisbursement> {
    if (input.idempotencyKey && this.payouts.has(input.idempotencyKey)) {
      return this.payouts.get(input.idempotencyKey)!;
    }

    const sellerId = input.accountId.replace(/^mockacct_/, "");
    const shouldFail = this.options.failForSellers?.includes(sellerId);

    const result: PspDisbursement = shouldFail
      ? {
          id: `mockpout_${input.idempotencyKey ?? Math.random().toString(36).slice(2)}`,
          status: "failed",
          failureReason: "Mock driver: seller configured to fail",
        }
      : {
          id: `mockpout_${input.idempotencyKey ?? Math.random().toString(36).slice(2)}`,
          // Real bank rails are asynchronous. Returning "processing" keeps the
          // caller honest about waiting for a webhook.
          status: "processing",
          metadata: { amount: input.amount, currency: input.currency },
        };

    if (input.idempotencyKey) this.payouts.set(input.idempotencyKey, result);
    return result;
  }

  async parseWebhook(input: {
    rawBody: string | Buffer;
    headers: Record<string, unknown>;
  }): Promise<
    | { kind: "account"; accountId: string; status: PspAccountStatus }
    | { kind: "payout"; payoutId: string; status: PspDisbursement["status"] }
    | null
  > {
    try {
      const body = JSON.parse(input.rawBody.toString());
      if (body.type === "account.updated" && body.account_id) {
        return { kind: "account", accountId: body.account_id, status: body.status };
      }
      if (body.type === "payout.updated" && body.payout_id) {
        return { kind: "payout", payoutId: body.payout_id, status: body.status };
      }
      return null;
    } catch {
      return null;
    }
  }
}
