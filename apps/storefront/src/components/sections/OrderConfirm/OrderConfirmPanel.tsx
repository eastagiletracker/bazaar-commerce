'use client';

import { useState } from 'react';

import {
  cancelOrder,
  confirmOrder,
  type ConfirmationView
} from '@/lib/data/order-confirmation';

/**
 * The page a buyer lands on from the WhatsApp confirmation message.
 *
 * Almost certainly opened on a mid-range Android, over mobile data, by someone
 * who tapped a notification and has about three seconds of patience. So:
 * everything above the fold, one obvious action, tap targets you cannot miss
 * with a thumb, and no dependency on anything loading before the buttons work.
 *
 * Confirm is visually dominant and cancel is quiet but plainly there. That
 * hierarchy is deliberate and it is not a dark pattern: the buyer who wants to
 * cancel must be able to, easily, because a cancel here costs us nothing while
 * the same decision made at the door costs the seller two legs of freight. What
 * we are avoiding is the accidental cancel from a mis-tap, not the intentional
 * one.
 */

type Phase = 'deciding' | 'confirmed' | 'cancelled' | 'error';

export const OrderConfirmPanel = ({
  token,
  initial
}: {
  token: string;
  initial: ConfirmationView;
}) => {
  const [phase, setPhase] = useState<Phase>(
    initial.resolved
      ? initial.status === 'confirmed'
        ? 'confirmed'
        : 'cancelled'
      : 'deciding'
  );
  const [busy, setBusy] = useState<null | 'confirm' | 'cancel'>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [askingReason, setAskingReason] = useState(false);

  const onConfirm = async () => {
    setBusy('confirm');
    const res = await confirmOrder(token);
    setBusy(null);
    setMessage(res.message);
    setPhase(res.success ? 'confirmed' : 'error');
  };

  const onCancel = async (reason?: string) => {
    setBusy('cancel');
    const res = await cancelOrder(token, reason);
    setBusy(null);
    setMessage(res.message);
    setPhase(res.success ? 'cancelled' : 'error');
  };

  if (phase === 'confirmed') {
    return (
      <Result
        tone="positive"
        title="Thank you, your order is confirmed"
        body="The seller is packing it now. You will pay the rider in cash when it arrives."
      />
    );
  }

  if (phase === 'cancelled') {
    return (
      <Result
        tone="neutral"
        title="Your order has been cancelled"
        body="Nothing will be delivered and you will not be charged. Thank you for telling us."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-2xl font-bold text-primary">
        Do you still want this order?
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-secondary">
        Please confirm so the seller can send it. You pay cash when it arrives.
      </p>

      <OrderCard view={initial} />

      {message && phase === 'error' && (
        <div
          role="alert"
          className="mt-4 rounded-md bg-negative-secondary px-3 py-2 text-sm text-negative-on-secondary"
        >
          {message}
        </div>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={busy !== null}
        className="mt-6 h-14 w-full rounded-lg bg-action text-[17px] font-bold text-action-on-primary transition-colors hover:bg-action-hover disabled:opacity-60"
        data-testid="confirm-order-button"
      >
        {busy === 'confirm' ? 'Confirming…' : 'Yes, send it'}
      </button>

      {!askingReason ? (
        <button
          type="button"
          onClick={() => setAskingReason(true)}
          disabled={busy !== null}
          className="mt-3 h-12 w-full rounded-lg border border-primary bg-component text-[15px] font-semibold text-primary transition-colors disabled:opacity-60"
          data-testid="open-cancel-button"
        >
          No, cancel my order
        </button>
      ) : (
        <CancelReason
          busy={busy === 'cancel'}
          onBack={() => setAskingReason(false)}
          onCancel={onCancel}
        />
      )}

      <p className="mt-6 text-center text-xs text-secondary">
        If you do nothing, we may contact you by phone before sending your order.
      </p>
    </div>
  );
};

/**
 * Reason capture. One tap on a preset, not a text box.
 *
 * These cover almost everything, they take a thumb rather than a keyboard, and
 * unlike free text they aggregate into something we can act on. "Found it
 * cheaper" and "ordered by mistake" point at completely different fixes.
 */
const REASONS = [
  'I changed my mind',
  'I found it cheaper somewhere else',
  'It is taking too long',
  'I ordered by mistake'
];

const CancelReason = ({
  busy,
  onBack,
  onCancel
}: {
  busy: boolean;
  onBack: () => void;
  onCancel: (reason?: string) => void;
}) => (
  <div className="mt-3 rounded-lg border border-primary bg-component p-4">
    <p className="mb-3 text-sm font-semibold text-primary">
      Why are you cancelling?
    </p>
    <div className="flex flex-col gap-2">
      {[...REASONS, 'Another reason'].map((r) => (
        <button
          key={r}
          type="button"
          disabled={busy}
          onClick={() => onCancel(r === 'Another reason' ? undefined : r)}
          className="h-12 rounded-md border border-primary px-3 text-left text-[15px] text-primary disabled:opacity-60"
        >
          {r}
        </button>
      ))}
    </div>
    <button
      type="button"
      onClick={onBack}
      disabled={busy}
      className="mt-3 text-sm font-semibold text-action-primary hover:underline"
    >
      Go back
    </button>
  </div>
);

const OrderCard = ({ view }: { view: ConfirmationView }) => (
  <div className="mt-5 rounded-lg border border-primary bg-component p-4">
    {view.order.displayId && (
      <p className="text-xs font-medium uppercase tracking-wide text-secondary">
        Order {String(view.order.displayId)}
      </p>
    )}

    <ul className="mt-2 flex flex-col gap-1.5">
      {view.order.items.map((item, i) => (
        <li key={i} className="flex justify-between gap-3 text-[15px] text-primary">
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          <span className="shrink-0 text-secondary">x{item.quantity}</span>
        </li>
      ))}
    </ul>

    <div className="mt-3 flex items-baseline justify-between border-t border-primary pt-3">
      <span className="text-sm text-secondary">Total to pay on delivery</span>
      <span className="text-xl font-bold text-primary">
        Rs {Math.round(view.order.total).toLocaleString('en-PK')}
      </span>
    </div>

    {view.order.city && (
      <p className="mt-2 text-sm text-secondary">Delivering to {view.order.city}</p>
    )}
  </div>
);

const Result = ({
  tone,
  title,
  body
}: {
  tone: 'positive' | 'neutral';
  title: string;
  body: string;
}) => (
  <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
    <div
      className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
        tone === 'positive' ? 'bg-positive-secondary' : 'bg-component-secondary'
      }`}
      aria-hidden
    >
      <span className="text-3xl">{tone === 'positive' ? '✓' : '×'}</span>
    </div>
    <h1 className="mt-5 text-2xl font-bold text-primary">{title}</h1>
    <p className="mt-2 text-[15px] leading-relaxed text-secondary">{body}</p>
    <a
      href="/"
      className="mt-8 inline-block text-[15px] font-semibold text-action-primary hover:underline"
    >
      Continue shopping
    </a>
  </div>
);
