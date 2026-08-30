import type { Metadata } from 'next';
import Link from 'next/link';

import { OrderConfirmPanel } from '@/components/sections/OrderConfirm/OrderConfirmPanel';
import { getConfirmation } from '@/lib/data/order-confirmation';

/**
 * /confirm/<token> — the buyer's one-tap order confirmation.
 *
 * Outside the (main) group on purpose. This page has exactly one job and every
 * piece of site chrome around it is a way to leave without answering: a search
 * bar, a basket, a category menu. Just the logo, so the buyer can see who is
 * asking.
 *
 * noindex because the URL carries a live credential. Without it a link pasted
 * into a public group could end up in a search index, which would put a
 * working confirm-or-cancel control on the open web.
 */
export const metadata: Metadata = {
  title: 'Confirm your order',
  robots: { index: false, follow: false }
};

export const dynamic = 'force-dynamic';

export default async function ConfirmPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const confirmation = await getConfirmation(token);

  return (
    <main className="min-h-screen bg-primary">
      <header className="border-b border-primary bg-component">
        <div className="mx-auto flex h-14 max-w-md items-center px-4">
          <Link href="/" className="text-lg font-bold text-primary">
            Bazaar
          </Link>
        </div>
      </header>

      {confirmation ? (
        <OrderConfirmPanel token={token} initial={confirmation} />
      ) : (
        <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-primary">
            This link is no longer valid
          </h1>
          {/* One message for expired, already-answered and never-existed. The
              buyer cannot act on the difference, and spelling it out would tell
              anyone holding a guessed token which case they had hit. */}
          <p className="mt-2 text-[15px] leading-relaxed text-secondary">
            It may have already been used, or it may have expired. If you still
            need to change an order, your orders page has the details.
          </p>
          <Link
            href="/user/orders"
            className="mt-8 inline-block text-[15px] font-semibold text-action-primary hover:underline"
          >
            Go to my orders
          </Link>
        </div>
      )}
    </main>
  );
}
