'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { requestPhoneCode, verifyPhoneCode } from '@/lib/data/customer';
import { transferCart } from '@/lib/data/customer';

/**
 * Phone sign-in.
 *
 * The default path, because in this market the mobile number is the identity:
 * most buyers do not have or want to type an email, and it is the number the
 * courier will call anyway. Email and password stay available for anyone who
 * prefers them.
 *
 * Two steps, one field each. Asking for a phone and a code on the same screen
 * means showing a field that cannot be filled yet.
 */

const RESEND_SECONDS = 60;

export const PhoneLoginForm = ({ onUseEmail }: { onUseEmail: () => void }) => {
  const router = useRouter();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [masked, setMasked] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const codeRef = useRef<HTMLInputElement>(null);

  // Count the resend cooldown down so the button explains itself rather than
  // just being disabled for no visible reason.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const send = async (isResend = false) => {
    setBusy(true);
    setError(null);
    const res = await requestPhoneCode(phone);
    setBusy(false);

    if (!res.success) {
      setError(res.message);
      if (res.retryAfter) setCooldown(res.retryAfter);
      return;
    }
    setMasked(res.maskedPhone ?? phone);
    setCooldown(RESEND_SECONDS);
    if (!isResend) setStep('code');
  };

  /**
   * `submitted` is passed explicitly rather than read from state. The
   * auto-submit fires from inside onChange, where `code` is still the value
   * from the previous render — posting an empty code and failing with
   * "Phone and code are both required". A stale closure on the primary
   * sign-in path.
   */
  const verify = async (submitted?: string) => {
    const value = submitted ?? code;
    setBusy(true);
    setError(null);
    const res = await verifyPhoneCode(phone, value);

    if (!res.success) {
      setBusy(false);
      setError(res.message);
      setCode('');
      codeRef.current?.focus();
      return;
    }

    // Move the guest basket onto the account so signing in mid-shop does not
    // silently empty it — the fastest way to lose an order at the last step.
    await transferCart().catch(() => null);
    router.push('/user');
    router.refresh();
  };

  return (
    <div className="rounded-lg border border-primary bg-component p-5" data-testid="phone-login-form">
      <h1 className="mb-1 text-xl font-bold text-primary">Sign in</h1>
      <p className="mb-5 text-sm text-secondary">
        {step === 'phone'
          ? 'We will text you a code. No password to remember.'
          : `Enter the 6-digit code we sent to ${masked}.`}
      </p>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md bg-negative-secondary px-3 py-2 text-sm text-negative-on-secondary"
        >
          {error}
        </div>
      )}

      {step === 'phone' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-primary">
            Mobile number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            required
            placeholder="03xx xxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-12 w-full rounded-md border border-input bg-component px-3 text-[16px] text-primary outline-none focus:border-action focus:shadow-focus"
            data-testid="phone-input"
          />

          <button
            type="submit"
            disabled={busy || phone.trim().length < 10}
            className="mt-5 h-12 w-full rounded-md bg-action text-[15px] font-semibold text-action-on-primary transition-colors hover:bg-action-hover disabled:opacity-50"
            data-testid="send-code-button"
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-primary">
            Code
          </label>
          <input
            ref={codeRef}
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            // one-time-code lets iOS and Android offer the SMS straight from
            // the keyboard, which removes the app-switch entirely.
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            placeholder="123456"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(v);
              // Submit on the sixth digit. Making someone tap a button after
              // typing a code they just read is a pointless extra step.
              if (v.length === 6 && !busy) {
                setTimeout(() => verify(v), 0);
              }
            }}
            className="h-12 w-full rounded-md border border-input bg-component px-3 text-center text-[22px] font-bold tracking-[0.4em] text-primary outline-none focus:border-action focus:shadow-focus"
            data-testid="code-input"
          />

          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="mt-5 h-12 w-full rounded-md bg-action text-[15px] font-semibold text-action-on-primary transition-colors hover:bg-action-hover disabled:opacity-50"
            data-testid="verify-code-button"
          >
            {busy ? 'Checking…' : 'Sign in'}
          </button>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
              className="font-semibold text-action hover:underline"
            >
              Change number
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || busy}
              onClick={() => send(true)}
              className="font-semibold text-action hover:underline disabled:text-secondary disabled:no-underline"
              data-testid="resend-button"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 border-t border-primary pt-4 text-center">
        <button
          type="button"
          onClick={onUseEmail}
          className="text-sm font-semibold text-action hover:underline"
          data-testid="use-email-button"
        >
          Sign in with email instead
        </button>
      </div>
    </div>
  );
};
