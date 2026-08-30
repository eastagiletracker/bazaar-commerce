'use server';

/**
 * The buyer-facing confirmation link.
 *
 * Deliberately not on the SDK client: this flow has no session, no publishable
 * key requirement beyond the store default, and no cart. It is a stranger with
 * a token, arriving from WhatsApp.
 */

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000';

const headers = {
  'content-type': 'application/json',
  'x-publishable-api-key': process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY as string
};

export type ConfirmationView = {
  status: string;
  resolved: boolean;
  confirmedVia: string | null;
  order: {
    displayId?: string | number;
    city?: string | null;
    items: Array<{ title: string; quantity: number }>;
    total: number;
  };
};

export async function getConfirmation(token: string): Promise<ConfirmationView | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/store/order-confirmation/${token}`, {
      headers,
      cache: 'no-store'
    });
    if (!res.ok) return null;

    const body = await res.json();
    return {
      status: body.confirmation.status,
      resolved: body.confirmation.resolved,
      confirmedVia: body.confirmation.confirmed_via ?? null,
      order: {
        displayId: body.order.display_id,
        city: body.order.city,
        items: body.order.items ?? [],
        total: Number(body.order.total ?? 0)
      }
    };
  } catch {
    return null;
  }
}

export async function confirmOrder(token: string) {
  return await act(token, 'confirm');
}

export async function cancelOrder(token: string, reason?: string) {
  return await act(token, 'cancel', reason);
}

async function act(token: string, action: 'confirm' | 'cancel', reason?: string) {
  try {
    const res = await fetch(
      `${BACKEND_URL}/store/order-confirmation/${token}/${action}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(reason ? { reason } : {}),
        cache: 'no-store'
      }
    );
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false as const,
        message: body?.message || 'Something went wrong. Please try again.'
      };
    }
    return { success: true as const, message: body.message as string };
  } catch {
    return {
      success: false as const,
      message: 'Could not reach Bazaar. Check your connection and try again.'
    };
  }
}
