'use client';

import { useState } from 'react';
import Link from 'next/link';

import { LoginForm } from '../LoginForm/LoginForm';
import { PhoneLoginForm } from './PhoneLoginForm';

/**
 * Sign-in entry point.
 *
 * Phone is the default and email is one tap away, rather than tabs of equal
 * weight. Presenting them as equals would be designing for a customer who is
 * not here: most buyers in this market do not use email, and the phone is what
 * the courier calls regardless.
 */
export const SignInPanel = () => {
  const [mode, setMode] = useState<'phone' | 'email'>('phone');

  return (
    <main className="container" data-testid="login-page">
      <div className="mx-auto mt-6 w-full max-w-md space-y-4 pb-10">
        {mode === 'phone' ? (
          <PhoneLoginForm onUseEmail={() => setMode('email')} />
        ) : (
          <div>
            <LoginForm embedded />
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setMode('phone')}
                className="text-sm font-semibold text-action hover:underline"
                data-testid="use-phone-button"
              >
                Sign in with your mobile number instead
              </button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-primary bg-component p-5 text-center">
          <p className="text-sm text-secondary">
            Buying something? You do not need an account —{' '}
            <Link href="/cart" className="font-semibold text-action hover:underline">
              check out as a guest
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
};
